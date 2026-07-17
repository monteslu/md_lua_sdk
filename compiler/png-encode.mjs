// png-encode.mjs — minimal pure-JS PNG encoder (RGBA8, no filtering, stored
// deflate blocks). BROWSER-SAFE: no node:zlib, no Buffer usage.
//
// Stored (uncompressed) deflate keeps this tiny and fully deterministic — the
// same pixels always produce the same bytes, which matters for the SDK's
// reproducible-build guarantees. Sprite sheets are small; size is irrelevant.

const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();

function crc32(bytes, start, end) {
  let c = 0xffffffff;
  for (let i = start; i < end; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function adler32(bytes) {
  let a = 1, b = 0;
  for (let i = 0; i < bytes.length; i++) {
    a = (a + bytes[i]) % 65521;
    b = (b + a) % 65521;
  }
  return ((b << 16) | a) >>> 0;
}

// zlib-wrap `data` using stored (BTYPE=00) deflate blocks.
function zlibStore(data) {
  const blocks = Math.max(1, Math.ceil(data.length / 65535));
  const out = new Uint8Array(2 + blocks * 5 + data.length + 4);
  let o = 0;
  out[o++] = 0x78; out[o++] = 0x01;            // CMF/FLG (32K window, no dict)
  for (let i = 0; i < blocks; i++) {
    const start = i * 65535;
    const len = Math.min(65535, data.length - start);
    out[o++] = i === blocks - 1 ? 1 : 0;        // BFINAL, BTYPE=00
    out[o++] = len & 0xff; out[o++] = len >> 8;
    out[o++] = ~len & 0xff; out[o++] = (~len >> 8) & 0xff;
    out.set(data.subarray(start, start + len), o); o += len;
  }
  const ad = adler32(data);
  out[o++] = ad >>> 24; out[o++] = (ad >>> 16) & 0xff; out[o++] = (ad >>> 8) & 0xff; out[o++] = ad & 0xff;
  return out;
}

function chunk(type, data) {
  const out = new Uint8Array(12 + data.length);
  const len = data.length;
  out[0] = len >>> 24; out[1] = (len >>> 16) & 0xff; out[2] = (len >>> 8) & 0xff; out[3] = len & 0xff;
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
  out.set(data, 8);
  const c = crc32(out, 4, 8 + len);
  out[8 + len] = c >>> 24; out[9 + len] = (c >>> 16) & 0xff; out[10 + len] = (c >>> 8) & 0xff; out[11 + len] = c & 0xff;
  return out;
}

/**
 * Encode RGBA pixels as a PNG (8-bit RGBA, filter 0 on every row).
 * @param {Uint8Array} rgba - width*height*4 bytes
 * @param {number} width
 * @param {number} height
 * @returns {Uint8Array} PNG file bytes
 */
export function encodePng(rgba, width, height) {
  if (rgba.length !== width * height * 4) {
    throw new Error(`encodePng: rgba length ${rgba.length} != ${width}x${height}x4`);
  }
  const ihdr = new Uint8Array(13);
  ihdr[0] = width >>> 24; ihdr[1] = (width >>> 16) & 0xff; ihdr[2] = (width >>> 8) & 0xff; ihdr[3] = width & 0xff;
  ihdr[4] = height >>> 24; ihdr[5] = (height >>> 16) & 0xff; ihdr[6] = (height >>> 8) & 0xff; ihdr[7] = height & 0xff;
  ihdr[8] = 8;   // bit depth
  ihdr[9] = 6;   // color type: RGBA
  // compression 0, filter 0, interlace 0 (already zeroed)

  // scanlines: 1 filter byte (0 = none) + width*4 pixel bytes per row.
  const raw = new Uint8Array(height * (1 + width * 4));
  for (let y = 0; y < height; y++) {
    raw.set(rgba.subarray(y * width * 4, (y + 1) * width * 4), y * (1 + width * 4) + 1);
  }

  const sig = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const parts = [sig, chunk("IHDR", ihdr), chunk("IDAT", zlibStore(raw)), chunk("IEND", new Uint8Array(0))];
  const total = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(total);
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}
