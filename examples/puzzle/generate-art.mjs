// generate-art.mjs — reproducible sprite art for the GEM WELL puzzle example.
//
// Emits gems.png: a row of five 16x16 faceted gems (one per color) plus a
// 16x16 frame-corner/edge tile set for the well border, all drawn with a
// small fixed palette. mdlua reads the PNG as indexed color (<=15 opaque
// colors + transparent), 8x8 cells row-major. A 16x16 sprite is spr(n,...,2,2)
// where n is the top-left cell.
//
//   node examples/puzzle/generate-art.mjs
//
// Sheet is 128x32 = 16 cells wide, 4 rows. Cell layout (each entry 2x2 cells):
//   gem 1 = spr(0)   gem 2 = spr(2)   gem 3 = spr(4)
//   gem 4 = spr(6)   gem 5 = spr(8)
//   frame tiles start on the SECOND sprite row (cells 32+):
//   wall = spr(32)   floor-cap = spr(34)   glow-cursor = spr(36)

import { writeFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { encodePng } from "../../compiler/png-encode.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));

const W = 128;
const H = 32;
const rgba = new Uint8Array(W * H * 4);

// palette (RGB) — kept well under 15 opaque colors. Index 0 is transparent.
// Each gem uses a dark rim, a mid body, a bright body, and a white glint. To
// stay under the 15-color budget we share ONE rim (near-black) and ONE glint
// (white) across every gem, and give each gem two body shades of its hue.
const T = [0, 0, 0, 0]; // transparent
const RIM = [24, 20, 40, 255]; // shared dark rim / outline
const GLINT = [255, 255, 255, 255]; // shared white sparkle

// gem body pairs: [dark, bright] — every color carries an explicit alpha 255
// so `put` (which reads c[3]) draws them opaque.
const GEMS = [
  [[196, 32, 48, 255], [255, 104, 112, 255]], // 1 ruby  (red)
  [[40, 160, 64, 255], [128, 240, 128, 255]], // 2 emerald (green)
  [[48, 96, 224, 255], [128, 176, 255, 255]], // 3 sapphire (blue)
  [[236, 180, 32, 255], [255, 232, 128, 255]], // 4 topaz (yellow/gold)
  [[176, 64, 208, 255], [232, 160, 255, 255]], // 5 amethyst (purple)
];

// frame / cursor extra colors
const STEEL = [96, 108, 140, 255]; // well wall body
const STEEL_HI = [168, 180, 208, 255]; // well wall highlight lip
const CURSOR = [255, 240, 160, 255]; // landing-cursor glow

function put(x, y, c) {
  if (x < 0 || y < 0 || x >= W || y >= H) return;
  const i = (y * W + x) * 4;
  rgba[i] = c[0];
  rgba[i + 1] = c[1];
  rgba[i + 2] = c[2];
  rgba[i + 3] = c[3];
}

function fill16(cellX, cellY, fn) {
  // cellX/cellY are in 16px units; fn(px,py) with px,py in 0..15 returns a color
  const ox = cellX * 16;
  const oy = cellY * 16;
  for (let py = 0; py < 16; py++) {
    for (let px = 0; px < 16; px++) {
      const c = fn(px, py);
      if (c) put(ox + px, oy + py, c);
    }
  }
}

// ---- a faceted 16x16 gem: rounded diamond, rim + body shading + glint -------
function drawGem(slot, dark, bright) {
  fill16(slot, 0, (px, py) => {
    // distance from center on a diamond metric gives the gem silhouette
    const cx = 7.5;
    const cy = 7.5;
    const dx = Math.abs(px - cx);
    const dy = Math.abs(py - cy);
    const d = dx + dy; // diamond radius
    if (d > 8.2) return T; // outside the gem -> transparent
    if (d > 6.6) return RIM; // dark rim ring
    // body: top-left half is the bright facet, bottom-right the dark facet,
    // with a bevel line down the middle for a cut-gem read.
    const facet = px - py; // >0 top-right, <0 bottom-left
    let body = facet > 1 ? bright : dark;
    // a small bright core near the top-left for the classic gem sparkle
    if (px >= 3 && px <= 6 && py >= 3 && py <= 6 && facet > -2) body = bright;
    // hard white glint pixel cluster
    if ((px === 4 && py === 4) || (px === 5 && py === 4) || (px === 4 && py === 5)) {
      return GLINT;
    }
    return body;
  });
}

for (let g = 0; g < GEMS.length; g++) {
  drawGem(g, GEMS[g][0], GEMS[g][1]);
}

// ---- frame wall tile (slot 16, i.e. cell 32): a beveled steel block --------
// A solid 16x16 metal panel with a highlight on top/left, shadow bottom/right.
fill16(0, 1, (px, py) => {
  if (px === 0 || py === 0) return STEEL_HI;
  if (px === 15 || py === 15) return RIM;
  if (px === 1 || py === 1) return STEEL_HI;
  return STEEL;
});

// ---- floor cap tile (slot 17, cell 34): the well base, flatter -------------
fill16(1, 1, (px, py) => {
  if (py <= 1) return STEEL_HI;
  if (py === 15) return RIM;
  return STEEL;
});

// ---- landing cursor (slot 18, cell 36): a soft hollow glow ring ------------
fill16(2, 1, (px, py) => {
  const cx = 7.5;
  const cy = 7.5;
  const d = Math.abs(px - cx) + Math.abs(py - cy);
  if (d > 7.5 && d <= 8.5) return CURSOR;
  return T;
});

const png = encodePng(rgba, W, H);
const out = join(__dirname, "gems.png");
writeFileSync(out, png);

// report the opaque color count so we stay within the 15-color import budget
const seen = new Set();
for (let i = 0; i < rgba.length; i += 4) {
  if (rgba[i + 3] >= 128) seen.add(`${rgba[i]},${rgba[i + 1]},${rgba[i + 2]}`);
}
console.log(`wrote ${out} (${W}x${H}), ${seen.size} opaque colors`);
if (seen.size > 15) {
  console.error(`ERROR: ${seen.size} opaque colors > 15 — mdlua import will fail`);
  process.exit(1);
}
