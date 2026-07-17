// audio-assets.mjs — the audio asset codecs + C generators for mdlua builds.
//
// BROWSER-SAFE BY CONTRACT: no node:fs, no node:zlib, no Buffer — DataView and
// TextDecoder only (same discipline as png-tiles.mjs). Both the CLI
// (build-md.mjs) and a browser IDE pipeline import THIS module, so the
// generated C — and therefore the ROM bytes — are identical on every host.
//
// One dependency: romdev-xgm2 (pure JS, byte-identical to SGDK's xgm2tool —
// verified: vgmToXgm2(demo.vgm) === demo.xgc). Its package entry has a
// top-level node:zlib import used only for .vgz; gzipped input is therefore
// the CALLER's job to inflate (CLI: zlib; browser: DecompressionStream).
import { vgmToXgm2 } from "romdev-xgm2";

const ascii = (bytes, start, end) => String.fromCharCode(...bytes.subarray(start, end));

/** gzip member? (.vgz) — caller must inflate before songToXgm2. */
export function isGzip(bytes) {
  return bytes.length >= 2 && bytes[0] === 0x1f && bytes[1] === 0x8b;
}

/** raw VGM? ("Vgm " magic) */
export function isVgm(bytes) {
  return bytes.length >= 4 && ascii(bytes, 0, 4) === "Vgm ";
}

/**
 * A song input -> the compiled XGM2 blob the Z80 driver plays.
 * Accepts a raw .vgm (converted via romdev-xgm2) or an already-compiled
 * .xgc blob (passthrough — SGDK/xgm2tool output drops straight in).
 * @param {Uint8Array} bytes
 * @returns {Uint8Array}
 */
export function songToXgm2(bytes) {
  if (isGzip(bytes)) {
    throw new Error(
      "gzipped song (.vgz): inflate it first (CLI does this automatically; " +
      "browsers use DecompressionStream)"
    );
  }
  if (isVgm(bytes)) return vgmToXgm2(bytes, { packed: true });
  return bytes instanceof Uint8Array ? bytes : Uint8Array.from(bytes); // .xgc passthrough
}

/**
 * Minimal PCM WAV reader -> XGM2 PCM (8-bit signed, 13.3 kHz, 256-padded) —
 * the --sfx bank sample format (also what SND_PCM_startPlay rate 3 expects).
 * @param {Uint8Array} bytes
 * @returns {Uint8Array} s8 samples stored as raw bytes
 */
export function wavToXgm2Pcm(bytes) {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (ascii(bytes, 0, 4) !== "RIFF" || ascii(bytes, 8, 12) !== "WAVE")
    throw new Error("--sfx expects a PCM .wav");
  let off = 12, fmt = null, data = null;
  while (off + 8 <= bytes.length) {
    const id = ascii(bytes, off, off + 4);
    const size = dv.getUint32(off + 4, true);
    if (id === "fmt ") fmt = {
      code: dv.getUint16(off + 8, true),
      ch: dv.getUint16(off + 10, true),
      rate: dv.getUint32(off + 12, true),
      bits: dv.getUint16(off + 22, true),
    };
    if (id === "data") data = bytes.subarray(off + 8, off + 8 + size);
    off += 8 + size + (size & 1);
  }
  if (!fmt || !data || fmt.code !== 1) throw new Error("--sfx: unsupported wav (PCM only)");
  // -> mono float
  const ddv = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const n = data.length / (fmt.bits / 8) / fmt.ch;
  const mono = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    let acc = 0;
    for (let c = 0; c < fmt.ch; c++) {
      const idx = i * fmt.ch + c;
      acc += fmt.bits === 16 ? ddv.getInt16(idx * 2, true) / 32768 : (data[idx] - 128) / 128;
    }
    mono[i] = acc / fmt.ch;
  }
  // naive linear resample -> 13312 Hz (XGM2 full rate)
  const RATE = 13312;
  const outN = Math.max(1, Math.round(n * RATE / fmt.rate));
  const padded = (outN + 255) & ~255;
  const out = new Uint8Array(padded);          // s8 stored as u8 bytes
  for (let i = 0; i < outN; i++) {
    const src = i * fmt.rate / RATE;
    const i0 = Math.floor(src), f = src - i0;
    const v = (mono[i0] ?? 0) * (1 - f) + (mono[i0 + 1] ?? 0) * f;
    out[i] = Math.max(-128, Math.min(127, Math.round(v * 127))) & 0xFF;
  }
  return out;
}

const byteList = (u8) => Array.from(u8).join(",");

/**
 * The song bank -> md_songs.c. Every blob MUST be 256-byte aligned in ROM
 * (the Z80 driver pages through XGM2 data in 256-byte units; a byte-aligned
 * array plays SILENCE — measured, in SEED.md).
 * @param {Uint8Array[]} xgcBlobs  compiled XGM2 blobs, bank order = music(n) n
 * @returns {string} C source
 */
export function songsBankC(xgcBlobs) {
  if (!xgcBlobs.length) {
    return "// generated: no music bank\n" +
      "const unsigned char *const md_song_bank[1] = {0};\n" +
      "const int md_song_count = 0;\n";
  }
  let c = "// generated: XGM2 song bank (music(n) plays bank order n).\n" +
    "// 256-byte alignment is REQUIRED (Z80 driver pages in 256-byte units).\n";
  const names = xgcBlobs.map((_, i) => `md_song_${i}`);
  xgcBlobs.forEach((blob, i) => {
    c += `__attribute__((aligned(256))) static const unsigned char ${names[i]}[${blob.length}] = {${byteList(blob)}};\n`;
  });
  c += `const unsigned char *const md_song_bank[${names.length}] = {${names.join(",")}};\n` +
    `const int md_song_count = ${names.length};\n`;
  return c;
}

/**
 * The sfx bank -> md_sfx_data.c (same table shape build-md always emitted).
 * @param {Uint8Array[]} pcmBlobs  wavToXgm2Pcm outputs, bank order = sfx(n) n
 * @returns {string} C source
 */
export function sfxBankC(pcmBlobs) {
  if (!pcmBlobs.length) {
    return "const unsigned char *const md_sfx_bank[1] = {0};\n" +
      "const unsigned long md_sfx_len[1] = {0};\n" +
      "const int md_sfx_count = 0;\n";
  }
  const names = pcmBlobs.map((_, i) => `md_sfx_${i}`);
  let c = "";
  pcmBlobs.forEach((pcm, i) => {
    c += `__attribute__((aligned(256))) static const unsigned char ${names[i]}[${pcm.length}] = {${byteList(pcm)}};\n`;
  });
  c += `const unsigned char *const md_sfx_bank[${names.length}] = {${names.join(",")}};\n` +
    `const unsigned long md_sfx_len[${names.length}] = {${names.map((n) => `sizeof(${n})`).join(",")}};\n` +
    `const int md_sfx_count = ${names.length};\n`;
  return c;
}
