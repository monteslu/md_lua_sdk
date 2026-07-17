// build.test.js — full end-to-end build gates through the in-process WASM
// toolchain (cc1-m68k -> as -> ld -> objcopy, sjasm/bintos for the Z80
// driver). ~2s per build; this is the publish gate that proves the pipeline
// stands alone: registry deps only, no romdev server, no sibling checkouts.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { buildMd } from "../compiler/build-md.mjs";
import { makePsgVgm } from "./vgm-fixture.mjs";

const REPO = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const EX = (name) => path.join(REPO, "examples", name, "main.lua");
const MUSIC = path.join(REPO, "node_modules", "romdev-toolchain-m68k-gcc",
  "share", "genesis", "lib", "sgdk", "music");
const work = mkdtempSync(path.join(tmpdir(), "mdlua-build-"));

// a valid Genesis ROM: finalized size (128KB multiple, >=512KB), the "SEGA"
// console header at $100, and the $18E checksum finalizeGenesisRom wrote.
function assertRomShape(p) {
  const rom = readFileSync(p);
  assert.ok(rom.length >= 512 * 1024, `too small: ${rom.length}`);
  assert.equal(rom.length % (128 * 1024), 0, "not padded to a 128KB boundary");
  assert.match(rom.toString("ascii", 0x100, 0x104), /SEGA/);
  let sum = 0;
  for (let i = 0x200; i + 1 < rom.length; i += 2) sum = (sum + rom.readUInt16BE(i)) & 0xffff;
  assert.equal(rom.readUInt16BE(0x18e), sum, "header checksum wrong");
  return rom;
}

test("hello builds to a valid ROM (no assets)", async () => {
  const out = path.join(work, "hello.bin");
  const r = await buildMd(EX("hello"), out);
  assert.equal(r.ok, true);
  assertRomShape(out);
});

test("builds are deterministic (same source -> byte-identical ROM)", async () => {
  const a = path.join(work, "det_a.bin");
  const b = path.join(work, "det_b.bin");
  await buildMd(EX("hello"), a);
  await buildMd(EX("hello"), b);
  assert.deepEqual(readFileSync(a), readFileSync(b));
});

test("starfall builds with sheet + map assets", async () => {
  const out = path.join(work, "starfall.bin");
  const dir = path.join(REPO, "examples", "starfall");
  const r = await buildMd(EX("starfall"), out, {
    sheetPath: path.join(dir, "shmup_sheet.png"),
    mapPath: path.join(dir, "space_bg.png"),
  });
  assert.equal(r.ok, true);
  assertRomShape(out);
});

test("music example builds with a 2-song --music bank + --sfx, and the songs land in ROM", async () => {
  // song 1 is a synthetic VGM; song 0 the toolchain's demo.vgm. A 0.2s wav sfx.
  const vgmPath = path.join(work, "song.vgm");
  writeFileSync(vgmPath, makePsgVgm());
  const wavPath = path.join(work, "blip.wav");
  writeFileSync(wavPath, makeWav());
  const out = path.join(work, "music.bin");
  const r = await buildMd(EX("music"), out, {
    musicPaths: [path.join(MUSIC, "demo.vgm"), vgmPath],
    sfxPaths: [wavPath],
  });
  assert.equal(r.ok, true);
  const rom = assertRomShape(out);
  // the demo song's XGM2 bytes must be present in the ROM (bank embedded)
  const xgc = readFileSync(path.join(MUSIC, "demo.xgc"));
  assert.ok(rom.includes(xgc.subarray(0, 64)), "demo song bytes not found in ROM");
});

test("callback + coroutine examples build (fn-kind through the real linker)", async () => {
  for (const ex of ["coroutine", "vint_callback"]) {
    const out = path.join(work, `${ex}.bin`);
    const r = await buildMd(EX(ex), out);
    assert.equal(r.ok, true, ex);
    assertRomShape(out);
  }
});

function makeWav() {
  const sr = 22050, n = Math.floor(sr * 0.2);
  const out = new Uint8Array(44 + n * 2);
  const dv = new DataView(out.buffer);
  const w = (s, o) => { for (let i = 0; i < s.length; i++) out[o + i] = s.charCodeAt(i); };
  w("RIFF", 0); dv.setUint32(4, 36 + n * 2, true); w("WAVE", 8);
  w("fmt ", 12); dv.setUint32(16, 16, true); dv.setUint16(20, 1, true); dv.setUint16(22, 1, true);
  dv.setUint32(24, sr, true); dv.setUint32(28, sr * 2, true); dv.setUint16(32, 2, true); dv.setUint16(34, 16, true);
  w("data", 36); dv.setUint32(40, n * 2, true);
  for (let i = 0; i < n; i++) dv.setInt16(44 + i * 2, Math.round(Math.sin(2 * Math.PI * 700 * i / sr) * 11000), true);
  return out;
}
