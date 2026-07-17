// tmx-import.mjs — Tiled (.tmx) map -> flattened RGBA pixels.
// BROWSER-SAFE (pure JS string/byte parsing — no DOM, no fs).
//
// IMPORT ONLY: we read Tiled's real format (doc.mapeditor.org/en/stable/
// reference/tmx-map-format/) — we never write .tmx or invent a sibling format.
// All visible tile layers are composited in document order onto one RGBA
// image the size of the map; feed the result to encodePng() +
// mapAssetHeader()/mode7AssetHeader() (their tile dedup makes the round trip
// cheap — a 512x512 map with 40 unique tiles stays 40 unique tiles).
//
// Supported: orthogonal maps, embedded tilesets (image referenced by file
// name, bytes supplied by the caller), CSV and base64(+zlib) layer data, and
// the three gid flip flags. External .tsx tilesets are rejected with a
// pointer (embed the tileset in the map: Tiled > Map > Embed Tileset).

import { decodePng, inflate } from "./png-tiles.mjs";

const FLIP_H = 0x80000000, FLIP_V = 0x40000000, FLIP_D = 0x20000000;

// minimal attribute reader for one XML tag string.
const attr = (tag, name) => {
  const m = tag.match(new RegExp(`\\b${name}="([^"]*)"`));
  return m ? m[1] : undefined;
};
const attrNum = (tag, name, dflt) => {
  const v = attr(tag, name);
  return v === undefined ? dflt : Number(v);
};

// pure-JS base64 decode (no atob in Node, no Buffer in browsers).
const B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
function base64Decode(s) {
  s = s.replace(/[^A-Za-z0-9+/=]/g, "");
  const out = [];
  for (let i = 0; i < s.length; i += 4) {
    const n = (B64.indexOf(s[i]) << 18) | (B64.indexOf(s[i + 1]) << 12) |
      ((B64.indexOf(s[i + 2]) & 63) << 6) | (B64.indexOf(s[i + 3]) & 63);
    out.push((n >> 16) & 0xff);
    if (s[i + 2] !== "=") out.push((n >> 8) & 0xff);
    if (s[i + 3] !== "=") out.push(n & 0xff);
  }
  return new Uint8Array(out);
}

// <data> text -> Uint32Array of gids.
function decodeLayerData(dataTag, inner, count) {
  const encoding = attr(dataTag, "encoding");
  const compression = attr(dataTag, "compression");
  if (encoding === "csv") {
    const gids = inner.trim().split(",").map((s) => Number(s.trim()) >>> 0);
    if (gids.length !== count) throw new Error(`tmx: csv layer has ${gids.length} cells, expected ${count}`);
    return Uint32Array.from(gids);
  }
  if (encoding === "base64") {
    let bytes = base64Decode(inner.trim());
    if (compression === "zlib") bytes = inflate(bytes);
    else if (compression) throw new Error(`tmx: ${compression} compression unsupported (use zlib or none)`);
    const gids = new Uint32Array(count);
    for (let i = 0; i < count; i++) {
      gids[i] = (bytes[i * 4] | (bytes[i * 4 + 1] << 8) | (bytes[i * 4 + 2] << 16) | (bytes[i * 4 + 3] << 24)) >>> 0;
    }
    return gids;
  }
  throw new Error(`tmx: layer encoding "${encoding ?? "xml"}" unsupported (use csv or base64)`);
}

/**
 * List the tileset image files a .tmx references (for callers that need to
 * load them before calling tmxToRgba — the CLI reads them from disk, the web
 * IDE asks the user for them).
 * @param {string} tmxText
 * @returns {string[]} the source attributes as written (may include paths)
 */
export function listTmxImages(tmxText) {
  const out = [];
  const tsRe = /<tileset\b[^>]*(?:\/>|>[\s\S]*?<\/tileset>)/g;
  for (const ts of tmxText.match(tsRe) ?? []) {
    const imgTag = ts.match(/<image\b[^>]*\/?>/)?.[0];
    const src = imgTag && attr(imgTag, "source");
    if (src) out.push(src);
  }
  return out;
}

/**
 * Render a Tiled .tmx map to flat RGBA.
 * @param {string} tmxText - the .tmx file contents
 * @param {Record<string, Uint8Array>} images - tileset image bytes keyed by the
 *   file name the map references (basename match, so "tiles.png" satisfies
 *   source="../art/tiles.png")
 * @returns {{width:number, height:number, rgba:Uint8Array,
 *   tileWidth:number, tileHeight:number, cols:number, rows:number}}
 */
export function tmxToRgba(tmxText, images = {}) {
  const mapTag = tmxText.match(/<map\b[^>]*>/)?.[0];
  if (!mapTag) throw new Error("tmx: no <map> element");
  if ((attr(mapTag, "orientation") ?? "orthogonal") !== "orthogonal") {
    throw new Error("tmx: only orthogonal maps supported");
  }
  const cols = attrNum(mapTag, "width"), rows = attrNum(mapTag, "height");
  const tileWidth = attrNum(mapTag, "tilewidth"), tileHeight = attrNum(mapTag, "tileheight");
  if (!cols || !rows || !tileWidth || !tileHeight) throw new Error("tmx: map missing width/height/tilewidth/tileheight");

  // ---- tilesets ----
  const tilesets = [];
  const tsRe = /<tileset\b[^>]*(?:\/>|>[\s\S]*?<\/tileset>)/g;
  for (const ts of tmxText.match(tsRe) ?? []) {
    const tsTag = ts.match(/<tileset\b[^>]*>/)[0];
    const firstgid = attrNum(tsTag, "firstgid", 1);
    if (attr(tsTag, "source")) {
      throw new Error(`tmx: external tileset "${attr(tsTag, "source")}" unsupported — embed it (Tiled: Map > Embed Tileset)`);
    }
    const imgTag = ts.match(/<image\b[^>]*\/?>/)?.[0];
    if (!imgTag) continue;                     // e.g. an image-collection tileset
    const source = attr(imgTag, "source") ?? "";
    const base = source.split("/").pop();
    const bytes = images[base] ?? images[source];
    if (!bytes) throw new Error(`tmx: tileset image "${base}" not supplied`);
    const png = decodePng(bytes);
    const tw = attrNum(tsTag, "tilewidth", tileWidth), th = attrNum(tsTag, "tileheight", tileHeight);
    const columns = attrNum(tsTag, "columns", Math.floor(png.width / tw));
    tilesets.push({ firstgid, tw, th, columns, png });
  }
  if (!tilesets.length) throw new Error("tmx: no usable tileset");
  tilesets.sort((a, b) => a.firstgid - b.firstgid);

  // ---- composite all visible tile layers ----
  const width = cols * tileWidth, height = rows * tileHeight;
  const out = new Uint8Array(width * height * 4);
  const layerRe = /<layer\b[^>]*>[\s\S]*?<\/layer>/g;
  let drewLayers = 0;
  for (const layer of tmxText.match(layerRe) ?? []) {
    const layerTag = layer.match(/<layer\b[^>]*>/)[0];
    if (attrNum(layerTag, "visible", 1) === 0) continue;
    const dataM = layer.match(/<data\b[^>]*>([\s\S]*?)<\/data>/);
    if (!dataM) continue;
    const dataTag = dataM[0].match(/<data\b[^>]*>/)[0];
    const gids = decodeLayerData(dataTag, dataM[1], cols * rows);
    drewLayers++;

    for (let cy = 0; cy < rows; cy++)
      for (let cx = 0; cx < cols; cx++) {
        const raw = gids[cy * cols + cx];
        const gid = raw & ~(FLIP_H | FLIP_V | FLIP_D);
        if (!gid) continue;
        let ts = tilesets[0];
        for (const t of tilesets) if (t.firstgid <= gid) ts = t;
        const id = gid - ts.firstgid;
        const sx0 = (id % ts.columns) * ts.tw, sy0 = Math.floor(id / ts.columns) * ts.th;
        const fh = !!(raw & FLIP_H), fv = !!(raw & FLIP_V), fd = !!(raw & FLIP_D);
        for (let py = 0; py < tileHeight; py++)
          for (let px = 0; px < tileWidth; px++) {
            // flip-diagonal swaps axes first, then h/v mirror (Tiled's order)
            let ux = fd ? py : px, uy = fd ? px : py;
            if (fh) ux = tileWidth - 1 - ux;
            if (fv) uy = tileHeight - 1 - uy;
            const so = ((sy0 + uy) * ts.png.width + (sx0 + ux)) * 4;
            const sa = ts.png.rgba[so + 3];
            if (sa === 0) continue;
            const dOff = ((cy * tileHeight + py) * width + (cx * tileWidth + px)) * 4;
            if (sa === 255) {
              out[dOff] = ts.png.rgba[so]; out[dOff + 1] = ts.png.rgba[so + 1];
              out[dOff + 2] = ts.png.rgba[so + 2]; out[dOff + 3] = 255;
            } else {
              const da = out[dOff + 3];
              const ra = sa + (da * (255 - sa)) / 255;
              out[dOff] = (ts.png.rgba[so] * sa + out[dOff] * da * (255 - sa) / 255) / ra;
              out[dOff + 1] = (ts.png.rgba[so + 1] * sa + out[dOff + 1] * da * (255 - sa) / 255) / ra;
              out[dOff + 2] = (ts.png.rgba[so + 2] * sa + out[dOff + 2] * da * (255 - sa) / 255) / ra;
              out[dOff + 3] = ra;
            }
          }
      }
  }
  if (!drewLayers) throw new Error("tmx: no visible tile layers");

  return { width, height, rgba: out, tileWidth, tileHeight, cols, rows };
}
