// audio-assets.test.js — the browser-safe audio codec + bank generator module.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";

import { wavToXgm2Pcm, songToXgm2, songsBankC, sfxBankC, isVgm, isGzip } from "../compiler/audio-assets.mjs";
import { makePsgVgm } from "./vgm-fixture.mjs";

const REPO = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const MUSIC = path.join(REPO, "node_modules", "romdev-toolchain-m68k-gcc", "share", "genesis", "lib", "sgdk", "music");

// ---- songToXgm2 ---------------------------------------------------------------

test("VGM converts byte-identical to SGDK's own xgm2tool output", () => {
  // the toolchain ships demo.vgm AND the demo.xgc SGDK compiled from it -
  // the pure-JS converter must reproduce it EXACTLY.
  const vgm = new Uint8Array(readFileSync(path.join(MUSIC, "demo.vgm")));
  const xgc = new Uint8Array(readFileSync(path.join(MUSIC, "demo.xgc")));
  const out = songToXgm2(vgm);
  assert.deepEqual(out, xgc);
});

test("compiled .xgc passes through untouched", () => {
  const xgc = new Uint8Array(readFileSync(path.join(MUSIC, "demo.xgc")));
  assert.deepEqual(songToXgm2(xgc), xgc);
});

test("gzipped input throws with an inflate-first pointer", () => {
  const vgz = new Uint8Array(gzipSync(makePsgVgm()));
  assert.ok(isGzip(vgz));
  assert.throws(() => songToXgm2(vgz), /inflate/);
});

test("synthetic (tracker-shaped) VGM converts to a playable-size blob", () => {
  const vgm = makePsgVgm();
  assert.ok(isVgm(vgm));
  const xgc = songToXgm2(vgm);
  assert.ok(xgc.length >= 256, `xgc too small: ${xgc.length}`);
});

// ---- wavToXgm2Pcm -------------------------------------------------------------

function makeWav({ sr = 22050, secs = 0.25, hz = 440, bits = 16, ch = 1 } = {}) {
  const n = Math.floor(sr * secs);
  const bytesPer = bits / 8;
  const data = new Uint8Array(n * bytesPer * ch);
  const dv = new DataView(data.buffer);
  for (let i = 0; i < n; i++) {
    const v = Math.sin(2 * Math.PI * hz * i / sr);
    for (let c = 0; c < ch; c++) {
      if (bits === 16) dv.setInt16((i * ch + c) * 2, Math.round(v * 12000), true);
      else data[i * ch + c] = 128 + Math.round(v * 100);
    }
  }
  const out = new Uint8Array(44 + data.length);
  const hv = new DataView(out.buffer);
  const w = (s, o) => { for (let i = 0; i < s.length; i++) out[o + i] = s.charCodeAt(i); };
  w("RIFF", 0); hv.setUint32(4, 36 + data.length, true); w("WAVE", 8);
  w("fmt ", 12); hv.setUint32(16, 16, true); hv.setUint16(20, 1, true); hv.setUint16(22, ch, true);
  hv.setUint32(24, sr, true); hv.setUint32(28, sr * bytesPer * ch, true);
  hv.setUint16(32, bytesPer * ch, true); hv.setUint16(34, bits, true);
  w("data", 36); hv.setUint32(40, data.length, true);
  out.set(data, 44);
  return out;
}

test("wav -> 13.3kHz s8 PCM: 256-padded, resampled length, non-silent", () => {
  const pcm = wavToXgm2Pcm(makeWav({ sr: 22050, secs: 0.25 }));
  assert.equal(pcm.length % 256, 0, "must be 256-byte padded");
  // 0.25s at 13312 Hz = 3328 samples -> padded to 3328 (already 256-aligned)
  assert.equal(pcm.length, 3328);
  // input sine amplitude 12000/32768 -> s8 peak ~= 0.366 * 127 = 46-47
  let peak = 0;
  for (const b of pcm) { const v = b > 127 ? b - 256 : b; peak = Math.max(peak, Math.abs(v)); }
  assert.ok(peak >= 44 && peak <= 50, `unexpected converted amplitude (peak ${peak}, want ~47)`);
});

test("wav conversion handles 8-bit and stereo inputs", () => {
  for (const opts of [{ bits: 8 }, { ch: 2 }, { bits: 8, ch: 2 }]) {
    const pcm = wavToXgm2Pcm(makeWav(opts));
    assert.equal(pcm.length % 256, 0);
    assert.ok(pcm.length > 0);
  }
});

test("non-wav input is rejected", () => {
  assert.throws(() => wavToXgm2Pcm(makePsgVgm()), /PCM \.wav/);
});

// ---- bank C generators --------------------------------------------------------

test("songsBankC: aligned blobs + bank table + count; stub when empty", () => {
  const c = songsBankC([new Uint8Array([1, 2, 3]), new Uint8Array([4, 5])]);
  assert.match(c, /aligned\(256\)/);
  assert.match(c, /md_song_0\[3\] = \{1,2,3\}/);
  assert.match(c, /md_song_1\[2\] = \{4,5\}/);
  assert.match(c, /md_song_bank\[2\] = \{md_song_0,md_song_1\}/);
  assert.match(c, /md_song_count = 2/);

  const stub = songsBankC([]);
  assert.match(stub, /md_song_count = 0/);
  assert.match(stub, /md_song_bank\[1\] = \{0\}/);
});

test("sfxBankC: aligned samples + len table + count; stub when empty", () => {
  const c = sfxBankC([new Uint8Array(256)]);
  assert.match(c, /aligned\(256\)/);
  assert.match(c, /md_sfx_bank\[1\] = \{md_sfx_0\}/);
  assert.match(c, /md_sfx_len\[1\] = \{sizeof\(md_sfx_0\)\}/);
  assert.match(c, /md_sfx_count = 1/);
  assert.match(sfxBankC([]), /md_sfx_count = 0/);
});
