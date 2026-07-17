// asset-headers.mjs — image bytes -> generated C headers (VDP data).
// Shared by the CLI build and (later) the web IDE so both emit IDENTICAL text.
import { pngToSheet, pngToTilemap } from "./png-tiles.mjs";

// sprite sheet: row-major linear VDP tiles + a 16-color CRAM palette.
export function sheetAssetsHeader(pngBytes, srcName = "sheet.png", varPrefix = "sheet") {
  const { words, pal, tilesAcross, tilesDown } = pngToSheet(pngBytes);
  let h = `// generated from ${srcName} — ${tilesAcross}x${tilesDown} tiles (VDP 4bpp, row-major)\n`;
  h += `#define ${varPrefix}_tiles_count ${words.length / 8}\n`;
  h += `#define ${varPrefix}_cells_across ${tilesAcross}\n`;
  h += `static const unsigned int ${varPrefix}_tiles[${words.length}] = {${words.map((w) => w >>> 0).join(",")}};\n`;
  h += `static const unsigned short ${varPrefix}_pal[16] = {${pal.join(",")}};\n`;
  return h;
}

// background tilemap: deduped tiles + u16 map of tile ids + palette.
export function mapAssetHeader(pngBytes, srcName = "map.png") {
  const { tileWords, map, pal, cols, rows } = pngToTilemap(pngBytes);
  let h = `// generated from ${srcName} — ${cols}x${rows} map, ${tileWords.length / 8} unique tiles\n`;
  h += `#define map_cols ${cols}\n#define map_rows ${rows}\n`;
  h += `#define map_tiles_count ${tileWords.length / 8}\n`;
  h += `static const unsigned int map_tiles[${tileWords.length}] = {${tileWords.map((w) => w >>> 0).join(",")}};\n`;
  h += `static const unsigned short map_data[${map.length}] = {${map.join(",")}};\n`;
  h += `static const unsigned short map_pal[16] = {${pal.join(",")}};\n`;
  return h;
}
