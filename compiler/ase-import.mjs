// ase-import.mjs — Aseprite (.ase/.aseprite) -> flattened RGBA pixels.
// BROWSER-SAFE (pure JS, Uint8Array in/out — reuses png-tiles' inflate).
//
// IMPORT ONLY: we read Aseprite's real, documented format
// (github.com/aseprite/aseprite/blob/main/docs/ase-file-specs.md) — we never
// write .ase or invent a sibling format. Frame 0 is composited from all
// visible layers (normal alpha blend, layer x cel opacity), which is exactly
// what an exported PNG of that frame looks like. Feed the result to
// encodePng() + the asset-header generators to use it as a sheet/map/mode7.
//
// Supported: 8bpp indexed / 16bpp grayscale / 32bpp RGBA cels, raw (type 0)
// and zlib-compressed (type 2) images, group-layer visibility, both palette
// chunk flavors. Not needed for import and skipped: blend modes beyond
// normal, tilemap cels, linked cels (meaningless on frame 0).

import { inflate } from "./png-tiles.mjs";

class Reader {
  constructor(bytes, pos = 0) { this.b = bytes; this.p = pos; }
  u8() { return this.b[this.p++]; }
  u16() { const v = this.b[this.p] | (this.b[this.p + 1] << 8); this.p += 2; return v; }
  i16() { const v = this.u16(); return v >= 0x8000 ? v - 0x10000 : v; }
  u32() { const v = (this.b[this.p] | (this.b[this.p + 1] << 8) | (this.b[this.p + 2] << 16) | (this.b[this.p + 3] << 24)) >>> 0; this.p += 4; return v; }
  skip(n) { this.p += n; }
  str() { const n = this.u16(); const s = this.b.subarray(this.p, this.p + n); this.p += n; return new TextDecoder().decode(s); }
  bytes(n) { const s = this.b.subarray(this.p, this.p + n); this.p += n; return s; }
}

/**
 * Decode an Aseprite file's first frame to flat RGBA.
 * @param {Uint8Array} bytes - .ase/.aseprite file contents
 * @param {{frame?: number}} [opts] - which frame to composite (default 0)
 * @returns {{width:number, height:number, rgba:Uint8Array, frames:number}}
 */
export function aseToRgba(bytes, opts = {}) {
  bytes = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  const r = new Reader(bytes);
  r.u32();                                   // file size
  if (r.u16() !== 0xa5e0) throw new Error("not an Aseprite file (bad magic)");
  const frames = r.u16();
  const width = r.u16(), height = r.u16();
  const depth = r.u16();                     // 32 RGBA / 16 gray / 8 indexed
  const flags = r.u32();
  const layerOpacityValid = !!(flags & 1);
  r.skip(2 + 4 + 4);                         // speed + two zero dwords
  const transparentIndex = r.u8();
  r.skip(3);
  r.u16();                                   // color count (0 = 256)
  r.p = 128;                                 // header is a fixed 128 bytes

  if (![8, 16, 32].includes(depth)) throw new Error(`Aseprite color depth ${depth} unsupported`);
  const wantFrame = opts.frame ?? 0;
  if (wantFrame >= frames) throw new Error(`frame ${wantFrame} out of range (file has ${frames})`);

  // layers indexed in chunk order; visibility respects group ancestors.
  const layers = [];
  const palette = new Uint8Array(256 * 4);   // rgba per index
  palette.fill(0);

  const out = new Uint8Array(width * height * 4);

  // normal alpha blend src over dst (non-premultiplied, like Aseprite's export)
  const blend = (o, sr, sg, sb, sa) => {
    if (sa === 0) return;
    const da = out[o + 3];
    const ra = sa + (da * (255 - sa)) / 255;
    if (ra === 0) return;
    out[o] = (sr * sa + out[o] * da * (255 - sa) / 255) / ra;
    out[o + 1] = (sg * sa + out[o + 1] * da * (255 - sa) / 255) / ra;
    out[o + 2] = (sb * sa + out[o + 2] * da * (255 - sa) / 255) / ra;
    out[o + 3] = ra;
  };

  const layerVisible = (idx) => {
    // a layer shows only if it and every ancestor group is visible.
    let level = layers[idx].childLevel;
    if (!layers[idx].visible) return false;
    for (let i = idx - 1; i >= 0 && level > 0; i--) {
      if (layers[i].childLevel < level) {
        if (!layers[i].visible) return false;
        level = layers[i].childLevel;
      }
    }
    return true;
  };

  const drawCel = (cel) => {
    const lay = layers[cel.layer];
    if (!lay || !layerVisible(cel.layer)) return;
    const layerAlpha = layerOpacityValid ? lay.opacity : 255;
    const px = cel.pixels;
    for (let y = 0; y < cel.h; y++) {
      const dy = cel.y + y;
      if (dy < 0 || dy >= height) continue;
      for (let x = 0; x < cel.w; x++) {
        const dx = cel.x + x;
        if (dx < 0 || dx >= width) continue;
        const o = (dy * width + dx) * 4;
        const i = y * cel.w + x;
        let sr, sg, sb, sa;
        if (depth === 32) { sr = px[i * 4]; sg = px[i * 4 + 1]; sb = px[i * 4 + 2]; sa = px[i * 4 + 3]; }
        else if (depth === 16) { sr = sg = sb = px[i * 2]; sa = px[i * 2 + 1]; }
        else {
          const idx = px[i];
          if (idx === transparentIndex) continue;
          sr = palette[idx * 4]; sg = palette[idx * 4 + 1]; sb = palette[idx * 4 + 2]; sa = palette[idx * 4 + 3];
        }
        blend(o, sr, sg, sb, (sa * cel.opacity * layerAlpha) / (255 * 255));
      }
    }
  };

  for (let f = 0; f < frames; f++) {
    const frameStart = r.p;
    const frameBytes = r.u32();
    if (r.u16() !== 0xf1fa) throw new Error("bad frame magic");
    const oldChunks = r.u16();
    r.skip(2 + 2);                            // duration + reserved
    const newChunks = r.u32();
    const nChunks = newChunks || oldChunks;
    const cels = [];
    for (let c = 0; c < nChunks; c++) {
      const chunkStart = r.p;
      const size = r.u32();
      const type = r.u16();
      if (type === 0x2004) {                  // layer
        const lflags = r.u16();
        const ltype = r.u16();
        const childLevel = r.u16();
        r.skip(2 + 2 + 2);                    // default w/h + blend mode
        const opacity = r.u8();
        layers.push({ visible: !!(lflags & 1), group: ltype === 1, childLevel, opacity });
      } else if (type === 0x2019) {           // new palette
        r.u32();                               // palette size
        const first = r.u32(), last = r.u32();
        r.skip(8);
        for (let i = first; i <= last; i++) {
          const eflags = r.u16();
          palette[i * 4] = r.u8(); palette[i * 4 + 1] = r.u8();
          palette[i * 4 + 2] = r.u8(); palette[i * 4 + 3] = r.u8();
          if (eflags & 1) r.str();             // color name
        }
      } else if (type === 0x0004) {           // old palette (RGB, alpha=255)
        const packets = r.u16();
        let idx = 0;
        for (let p = 0; p < packets; p++) {
          idx += r.u8();
          let n = r.u8(); if (n === 0) n = 256;
          for (let i = 0; i < n; i++, idx++) {
            palette[idx * 4] = r.u8(); palette[idx * 4 + 1] = r.u8();
            palette[idx * 4 + 2] = r.u8(); palette[idx * 4 + 3] = 255;
          }
        }
      } else if (type === 0x2005 && f === wantFrame) {   // cel
        const layer = r.u16();
        const x = r.i16(), y = r.i16();
        const opacity = r.u8();
        const ctype = r.u16();
        r.skip(7);                             // z-index + reserved
        if (ctype === 0 || ctype === 2) {
          const w = r.u16(), h = r.u16();
          const bpp = depth / 8;
          const rawLen = w * h * bpp;
          const data = r.bytes(chunkStart + size - r.p);
          const pixels = ctype === 2 ? inflate(data) : data;
          if (pixels.length < rawLen) throw new Error("cel pixel data truncated");
          cels.push({ layer, x, y, opacity, w, h, pixels });
        }
        // type 1 (linked) can't target frame 0's own cels; type 3 (tilemap) skipped
      }
      r.p = chunkStart + size;
    }
    // draw this frame's cels bottom-to-top (layer index order)
    if (f === wantFrame) {
      cels.sort((a, b) => a.layer - b.layer);
      for (const cel of cels) drawCel(cel);
      break;                                   // done — later frames irrelevant
    }
    r.p = frameStart + frameBytes;
  }

  return { width, height, rgba: out, frames };
}
