// generate-art.mjs - reproducible pixel art for the mdlua platformer example.
//
// Produces two PNGs consumed by the build:
//   sprites.png  the sprite sheet (16x16 cells, row-major) - player frames,
//                a spinning gem, a goal flag, a cloud puff
//   level.png    the tile map placed on plane B - solid ground + platforms
//                on a TRANSPARENT sky (so tget(0,col,row) ~= 0 means "solid",
//                and the backdrop sky-blue shows through everything else)
//
// Run: node examples/platformer/generate-art.mjs
// (uses mdlua's own PNG encoder, no external deps)

import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { encodePng } from "../../compiler/png-encode.mjs";

const DIR = dirname(fileURLToPath(import.meta.url));

// ---- a small named palette (one char per color) ----------------------------
// "." is transparent. Every other glyph is one RGBA color. The sheet and the
// map are separate 16-color VDP lines, so each may use up to 15 opaque colors.
const T = [0, 0, 0, 0]; // transparent

// shared / sprite colors
const K = [24, 20, 28, 255];    // near-black outline
const W = [255, 241, 232, 255]; // white
const S = [255, 204, 170, 255]; // skin / peach
const R = [255, 40, 80, 255];   // red (shirt, flag)
const r = [170, 30, 60, 255];   // dark red (shading)
const B = [40, 100, 220, 255];  // blue (pants)
const b = [30, 60, 150, 255];   // dark blue
const H = [70, 45, 30, 255];    // hair brown
const G = [0, 228, 140, 255];   // gem cyan-green
const g = [0, 150, 110, 255];   // gem dark
const Y = [255, 236, 40, 255];  // yellow (gem sparkle, flag pole cap)
const P = [150, 160, 175, 255]; // pole grey

// helper: build a WxH RGBA buffer from an array of glyph-string rows using a map
function grid(rows, map, w, h) {
  const out = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++) {
    const row = rows[y] || "";
    for (let x = 0; x < w; x++) {
      const ch = row[x] || ".";
      const c = map[ch] || T;
      const o = (y * w + x) * 4;
      out[o] = c[0]; out[o + 1] = c[1]; out[o + 2] = c[2]; out[o + 3] = c[3];
    }
  }
  return out;
}

// blit a 16x16 cell buffer into the sheet at cell (cx,cy)
function blit(sheet, sheetW, cx, cy, cell) {
  for (let y = 0; y < 16; y++)
    for (let x = 0; x < 16; x++) {
      const so = ((cy * 16 + y) * sheetW + (cx * 16 + x)) * 4;
      const co = (y * 16 + x) * 4;
      sheet[so] = cell[co]; sheet[so + 1] = cell[co + 1];
      sheet[so + 2] = cell[co + 2]; sheet[so + 3] = cell[co + 3];
    }
}

// =============================================================================
// SPRITE SHEET  -  6 cells wide x 1 row of 16x16 sprites (96x16 -> plenty)
// cell 0 = idle, 2 = run A, 4 = run B, 6 = jump, 8 = gem, 10 = flag, 12 = cloud
// (n counts 8x8 cells, so a 16x16 sprite at cell col C is spr(C*2,...))
// =============================================================================
const spMap = { ".": T, K, W, S, R, r, B, b, H, G, g, Y, P };

// --- player: a chunky 16x16 hero. idle stance ---
const idle = grid([
  "....HHHHHH......",
  "...HHHHHHHH.....",
  "...HHSSSSHH.....",
  "...HSSSSSSH.....",
  "...HSSKSKSH.....",   // eyes
  "...HSSSSSSH.....",
  "....SSSSSS......",
  "...RRRRRRRR.....",
  "..RRRRRRRRRR....",
  "..RRSRRRRSRR....",   // hands at sides
  "..rRRRRRRRRr....",
  "...RRRRRRRR.....",
  "...BBBB.BBBB....",
  "...BBB...BBB....",
  "...bbb...bbb....",
  "..KKK.....KKK...",   // shoes
], spMap, 16, 16);

// --- run frame A: leaning, one leg forward ---
const runA = grid([
  "....HHHHHH......",
  "...HHHHHHHH.....",
  "...HHSSSSHH.....",
  "...HSSSSSSH.....",
  "...HSSKSKSH.....",
  "....SSSSSSS.....",
  ".....SSSSS......",
  "...RRRRRRRR.....",
  "..SRRRRRRRRS....",   // arms swung out
  "...RRRRRRRR.....",
  "...rRRRRRRr.....",
  "....BBBBBB......",
  "...BBB..BBBB....",
  "..BBB.....BB....",
  "..bb......bbb...",
  ".KKK.......KK...",
], spMap, 16, 16);

// --- run frame B: opposite stride ---
const runB = grid([
  "....HHHHHH......",
  "...HHHHHHHH.....",
  "...HHSSSSHH.....",
  "...HSSSSSSH.....",
  "...HSSKSKSH.....",
  "....SSSSSSS.....",
  ".....SSSSS......",
  "...RRRRRRRR.....",
  "..SRRRRRRRRS....",
  "...RRRRRRRR.....",
  "...rRRRRRRr.....",
  "....BBBBBB......",
  "..BBBB..BBB.....",
  "..BB.....BBB....",
  ".bbb......bb....",
  ".KK.......KKK...",
], spMap, 16, 16);

// --- jump: arms up, legs tucked ---
const jump = grid([
  "..S.HHHHHH.S....",   // arms raised
  "..SHHHHHHHHS....",
  "...HHSSSSHH.....",
  "...HSSSSSSH.....",
  "...HSSKSKSH.....",
  "...HSSSSSSH.....",
  "....SSSSSS......",
  "...RRRRRRRR.....",
  "..RRRRRRRRRR....",
  "..rRRRRRRRRr....",
  "...RRRRRRRR.....",
  "...BBBBBBBB.....",
  "...BBB..BBB.....",
  "..BBB....BBB....",
  "..bb......bb....",
  "..KK......KK....",
], spMap, 16, 16);

// --- gem: a spinning jewel ---
const gem = grid([
  "......YY........",
  ".....GGGG.......",
  "....GGGGGG......",
  "...GGGWGGGG.....",   // white glint
  "..GGGWWGGGGG....",
  "..GGGGGGGGGG....",
  "..gGGGGGGGGg....",
  "...gGGGGGGg.....",
  "....gGGGGg......",
  ".....gGGg.......",
  "......gg........",
  "......YY........",   // sparkle below
  ".....Y..Y.......",
  "................",
  "................",
  "................",
], spMap, 16, 16);

// --- goal flag: pole + pennant ---
const flag = grid([
  ".....Y..........",
  ".....P..........",
  ".....PRRRRRR....",
  ".....PRRRRRRR...",
  ".....PRRRRRRR...",
  ".....PRRRRRR....",
  ".....PRRRR......",
  ".....P..........",
  ".....P..........",
  ".....P..........",
  ".....P..........",
  ".....P..........",
  ".....P..........",
  ".....P..........",
  "....KKK.........",   // base
  "...KKKKK........",
], spMap, 16, 16);

// --- cloud puff (decorative sprite, drawn in screen space for parallax) ---
const cloud = grid([
  "................",
  "................",
  "......WWWW......",
  "....WWWWWWWW....",
  "...WWWWWWWWWW...",
  "..WWWWWWWWWWWW..",
  ".WWWWWWWWWWWWWW.",
  ".WWWWWWWWWWWWWW.",
  "..WWWWWWWWWWWW..",
  "................",
  "................",
  "................",
  "................",
  "................",
  "................",
  "................",
], spMap, 16, 16);

// lay the cells out: 7 sprites x 16 wide = 112 px, 1 row of 16 -> 112x16
const SHEET_CELLS = 7;
const sheetW = SHEET_CELLS * 16;
const sheetH = 16;
const sheet = new Uint8Array(sheetW * sheetH * 4);
[idle, runA, runB, jump, gem, flag, cloud].forEach((cell, i) => blit(sheet, sheetW, i, 0, cell));
writeFileSync(join(DIR, "sprites.png"), encodePng(sheet, sheetW, sheetH));

// =============================================================================
// LEVEL MAP  -  512x256 px = 64 x 32 cells on plane B.
// Sky is TRANSPARENT (tile 0). Solid tiles are opaque, so in Lua a cell is
// solid iff tget(0,col,row) ~= 0. We paint from a compact 64x32 char grid.
// =============================================================================

// map palette (its own 16-color line, PAL2)
const mSky = T;
const gr = [60, 200, 90, 255];    // grass light
const gd = [40, 150, 60, 255];    // grass mid
const dr = [140, 90, 55, 255];    // dirt
const dd = [105, 65, 40, 255];    // dirt dark
const st = [150, 155, 170, 255];  // stone light
const sd = [95, 100, 120, 255];   // stone dark
const mo = [70, 120, 75, 255];    // moss speckle
const ol = [30, 20, 25, 255];     // outline dark

const mMap = { ".": mSky, g: gr, G: gd, d: dr, D: dd, s: st, S: sd, m: mo, o: ol };

// 8x8 tile stamps (as 8-row glyph strings) -----------------------------------
const tile = {
  grass: [       // ground surface: bright grass lip over dirt
    "gggggggg",
    "gGgGgGgG",
    "dddddddd",
    "dDdddddd",
    "ddddddDd",
    "dDdddddd",
    "ddddDddd",
    "dddddddd",
  ],
  dirt: [        // ground body: dirt with a moss speckle
    "dddddddd",
    "dddDdddd",
    "ddddddmd",
    "dDdddddd",
    "ddddddDd",
    "dmdddddd",
    "ddddDddd",
    "dddddddd",
  ],
  brick: [       // floating platform: stone brick
    "oooooooo",
    "osssssso",
    "osSsssSo",
    "osssssso",
    "osSsssSo",
    "osssssso",
    "oSssssSo",
    "oooooooo",
  ],
};

// draw an 8x8 stamp into the map buffer at cell (cx,cy)
function stamp(buf, bw, cx, cy, rows) {
  for (let y = 0; y < 8; y++) {
    const row = rows[y] || "";
    for (let x = 0; x < 8; x++) {
      const ch = row[x] || ".";
      const c = mMap[ch] || mSky;
      const o = ((cy * 8 + y) * bw + (cx * 8 + x)) * 4;
      buf[o] = c[0]; buf[o + 1] = c[1]; buf[o + 2] = c[2]; buf[o + 3] = c[3];
    }
  }
}

const MCOLS = 64, MROWS = 32;
const mapW = MCOLS * 8, mapH = MROWS * 8;
const map = new Uint8Array(mapW * mapH * 4); // all transparent to start

// The level as a column layout. Row indices are PLANE rows (0..31); the
// visible screen is 28 rows tall. Ground surface sits at row `gy`; below it is
// solid dirt to the bottom. Floating brick platforms are placed explicitly.
// This SAME layout is mirrored in main.lua for collision (kept in sync by
// hand - both describe: "row >= ground[col]" and the platform list).

// ground height per column (the grass-surface row). 0xFF-ish = pit -> value 99
const PIT = 99;
const ground = new Array(MCOLS).fill(24);
// carve a couple of pits + a rise, matched in main.lua
for (let c = 18; c <= 20; c++) ground[c] = PIT;        // pit 1
for (let c = 34; c <= 35; c++) ground[c] = PIT;        // pit 2
for (let c = 44; c <= 63; c++) ground[c] = 22;         // raised final stretch
for (let c = 26; c <= 30; c++) ground[c] = 21;         // a hill
for (let c = 27; c <= 29; c++) ground[c] = 20;

// floating platforms: {col, row, wcells} - matched in main.lua
const plats = [
  { c: 6, r: 19, w: 3 },
  { c: 12, r: 16, w: 3 },
  { c: 18, r: 18, w: 3 },   // bridge over pit 1
  { c: 24, r: 15, w: 2 },
  { c: 32, r: 17, w: 4 },   // over pit 2
  { c: 39, r: 14, w: 3 },
  { c: 48, r: 17, w: 3 },
  { c: 54, r: 14, w: 3 },
];

// paint ground columns
for (let c = 0; c < MCOLS; c++) {
  const gy = ground[c];
  if (gy === PIT) continue;
  stamp(map, mapW, c, gy, tile.grass);
  for (let r = gy + 1; r < MROWS; r++) stamp(map, mapW, c, r, tile.dirt);
}
// paint platforms
for (const p of plats)
  for (let i = 0; i < p.w; i++) stamp(map, mapW, p.c + i, p.r, tile.brick);

writeFileSync(join(DIR, "level.png"), encodePng(map, mapW, mapH));

console.log(`wrote sprites.png (${sheetW}x${sheetH}) and level.png (${mapW}x${mapH})`);
