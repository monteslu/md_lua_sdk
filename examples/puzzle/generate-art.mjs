// generate-art.mjs - reproducible art for the GEM WELL puzzle example.
//
// Emits TWO PNGs:
//   gems.png     - a sprite sheet of five 16x16 faceted gems (2x2 cells each),
//                  used for the falling trio (hardware sprites over the board).
//   gems_map.png - a horizontal strip of 8x8 TILE-PLANE tiles: the well
//                  interior + steel frame + each gem sliced into four 8x8
//                  quarters. The locked board is painted onto plane B with
//                  tset(), so a full 6x12 well costs ZERO sprite budget (a
//                  16x16 sprite is 4 hardware sprites; a full board of sprites
//                  would blow the 80-sprite limit many times over).
//
//   node examples/puzzle/generate-art.mjs
//
// mdlua reads a --sheet PNG as indexed sprite tiles (PAL1) and a --map PNG as
// deduped 8x8 tiles (PAL2). Both cap at 15 opaque colors. Tile 0 of a map is
// always the empty/transparent tile, so an empty board cell is tile 0.
//
// gems.png sprite cells (8x8, row-major, 16 per row): gem color k draws from
// cell (k-1)*2, i.e. ruby=spr(0) emerald=spr(2) sapphire=spr(4) topaz=spr(6)
// amethyst=spr(8).
//
// gems_map.png tile indices (the strip order below, index 0 forced empty):
//   0 = empty                 1 = well interior      2 = steel frame
//   3 + (k-1)*4 + q           = gem color k (1..5), quarter q (0=TL 1=TR 2=BL 3=BR)

import { writeFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { encodePng } from "../../compiler/png-encode.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));

// ---- shared palette (RGBA) - under the 15-opaque-color budget --------------
const T = [0, 0, 0, 0];               // transparent
const RIM = [24, 20, 40, 255];        // shared dark gem rim / outline
const GLINT = [255, 255, 255, 255];   // shared white sparkle

// gem body pairs: [dark, bright] with explicit alpha 255 so both draw opaque.
const GEMS = [
  [[196, 32, 48, 255], [255, 104, 112, 255]], // 1 ruby     (red)
  [[40, 160, 64, 255], [128, 240, 128, 255]], // 2 emerald  (green)
  [[48, 96, 224, 255], [128, 176, 255, 255]], // 3 sapphire (blue)
  [[236, 180, 32, 255], [255, 232, 128, 255]], // 4 topaz    (gold)
  [[176, 64, 208, 255], [232, 160, 255, 255]], // 5 amethyst (purple)
];

// frame / well colors
const STEEL = [96, 108, 140, 255];    // well wall body
const STEEL_HI = [168, 180, 208, 255]; // wall highlight lip
const WELL = [20, 18, 34, 255];       // well interior (dark)

// ---- a 16x16 gem drawn into a fresh RGBA buffer ----------------------------
// Returns a Uint8Array(16*16*4). Faceted rounded diamond: rim + two body
// shades + a white glint, matching the sprite gems exactly.
function makeGem(dark, bright) {
  const g = new Uint8Array(16 * 16 * 4);
  for (let py = 0; py < 16; py++) {
    for (let px = 0; px < 16; px++) {
      const cx = 7.5;
      const cy = 7.5;
      const d = Math.abs(px - cx) + Math.abs(py - cy); // diamond radius
      let c = T;
      if (d <= 8.2) {
        if (d > 6.6) {
          c = RIM;
        } else {
          const facet = px - py;
          c = facet > 1 ? bright : dark;
          if (px >= 3 && px <= 6 && py >= 3 && py <= 6 && facet > -2) c = bright;
          if ((px === 4 && py === 4) || (px === 5 && py === 4) || (px === 4 && py === 5)) {
            c = GLINT;
          }
        }
      }
      const i = (py * 16 + px) * 4;
      g[i] = c[0]; g[i + 1] = c[1]; g[i + 2] = c[2]; g[i + 3] = c[3];
    }
  }
  return g;
}

// blit a 16x16 gem buffer into a target sheet at pixel (ox,oy).
function blitGem(rgba, W, gem, ox, oy) {
  for (let py = 0; py < 16; py++) {
    for (let px = 0; px < 16; px++) {
      const s = (py * 16 + px) * 4;
      const dx = ox + px;
      const dy = oy + py;
      const dI = (dy * W + dx) * 4;
      rgba[dI] = gem[s]; rgba[dI + 1] = gem[s + 1];
      rgba[dI + 2] = gem[s + 2]; rgba[dI + 3] = gem[s + 3];
    }
  }
}

// ================= gems.png - the 16x16 sprite sheet ========================
{
  const W = 128;
  const H = 32;
  const rgba = new Uint8Array(W * H * 4);
  for (let g = 0; g < GEMS.length; g++) {
    blitGem(rgba, W, makeGem(GEMS[g][0], GEMS[g][1]), g * 16, 0);
  }
  const png = encodePng(rgba, W, H);
  writeFileSync(join(__dirname, "gems.png"), png);
  countColors("gems.png", rgba);
}

// ================= gems_map.png - the 8x8 tile strip ========================
// Layout (each entry 8x8): [empty][well][frame] then 5 gems x 4 quarters.
{
  const TILES = 3 + GEMS.length * 4; // 3 + 20 = 23 tiles
  const W = TILES * 8;
  const H = 8;
  const rgba = new Uint8Array(W * H * 4);

  function putTile(idx, fn) {
    const ox = idx * 8;
    for (let py = 0; py < 8; py++) {
      for (let px = 0; px < 8; px++) {
        const c = fn(px, py);
        const i = (py * W + ox + px) * 4;
        rgba[i] = c[0]; rgba[i + 1] = c[1]; rgba[i + 2] = c[2]; rgba[i + 3] = c[3];
      }
    }
  }

  // 0 = empty (leave transparent - encoder forces tile 0 empty anyway).
  putTile(0, () => T);
  // 1 = well interior: flat dark.
  putTile(1, () => WELL);
  // 2 = steel frame: beveled panel (light top/left, dark bottom/right).
  putTile(2, (px, py) => {
    if (px === 0 || py === 0) return STEEL_HI;
    if (px === 7 || py === 7) return RIM;
    return STEEL;
  });

  // gems: slice each 16x16 gem into four 8x8 quarters.
  for (let k = 0; k < GEMS.length; k++) {
    const gem = makeGem(GEMS[k][0], GEMS[k][1]);
    for (let q = 0; q < 4; q++) {
      const qx = (q === 1 || q === 3) ? 8 : 0; // TR/BR take the right half
      const qy = (q === 2 || q === 3) ? 8 : 0; // BL/BR take the bottom half
      const idx = 3 + k * 4 + q;
      putTile(idx, (px, py) => {
        const s = ((qy + py) * 16 + (qx + px)) * 4;
        // transparent gem pixels fall through to the well interior color so a
        // gem cell reads as a filled gem, not a hole to the backdrop.
        if (gem[s + 3] < 128) return WELL;
        return [gem[s], gem[s + 1], gem[s + 2], 255];
      });
    }
  }

  const png = encodePng(rgba, W, H);
  writeFileSync(join(__dirname, "gems_map.png"), png);
  countColors("gems_map.png", rgba);
}

// ---- report opaque color count and fail loudly if over budget --------------
function countColors(name, rgba) {
  const seen = new Set();
  for (let i = 0; i < rgba.length; i += 4) {
    if (rgba[i + 3] >= 128) seen.add(`${rgba[i]},${rgba[i + 1]},${rgba[i + 2]}`);
  }
  console.log(`wrote ${name}, ${seen.size} opaque colors`);
  if (seen.size > 15) {
    console.error(`ERROR: ${name} has ${seen.size} opaque colors > 15 - import will fail`);
    process.exit(1);
  }
}
