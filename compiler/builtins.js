// gbalua builtin functions - the PICO-8 global API surface (v0.2 slice) plus
// the md-native extras (Genesis hardware verbs).
//
// Param kinds:
//   coord - pixel coordinate/radius: C int; fixed args are floored (>>16)
//   num   - 16.16 number: C long; int args are promoted (<<16)
//   int   - small integer (button index, player): C int; fixed args floored
//   color - a GameTank palette byte 0-255. A static 0-15 literal is baked from
//           the PICO-8 palette at compile time; gt.rgb() gives any byte;
//           optional -> -1 sentinel (keep current draw color)
// Ret kinds: fixed | int | bool | void | same (polymorphic with args)

export const BUILTINS = {
  // ---- graphics -------------------------------------------------------------
  cls:      { params: [["color", true]], ret: "void", c: "gt_p8_cls" },
  camera:   { params: [["coord", true], ["coord", true]], ret: "void", c: "gt_p8_camera" },
  color:    { params: [["color", false]], ret: "void", c: "gt_p8_color" },
  pset:     { params: [["coord", false], ["coord", false], ["color", true]], ret: "void", c: "gt_p8_pset" },
  rect:     { params: [["coord", false], ["coord", false], ["coord", false], ["coord", false], ["color", true]], ret: "void", c: "gt_p8_rect" },
  rectfill: { params: [["coord", false], ["coord", false], ["coord", false], ["coord", false], ["color", true]], ret: "void", c: "gt_p8_rectfill" },
  circ:     { params: [["coord", false], ["coord", false], ["coord", false], ["color", true]], ret: "void", c: "gt_p8_circ" },
  circfill: { params: [["coord", false], ["coord", false], ["coord", false], ["color", true]], ret: "void", c: "gt_p8_circfill" },
  line:     { params: [["coord", false], ["coord", false], ["coord", false], ["coord", false], ["color", true]], ret: "void", c: "gt_p8_line" },
  // clip(x,y,w,h): restrict all subsequent bitmap drawing to a rectangle (HUD
  // panels, masked regions). clip() with no args resets to full screen; cls()
  // also resets it. PICO-8 semantics.
  clip:     { params: [["coord", true], ["coord", true], ["coord", true], ["coord", true]], ret: "void", c: "gt_clip", mdOnly: true },
  // pget(x,y): read a bitmap pixel (color 0..255). sset(x,y,[c]): paint a pixel
  // into the loaded sprite sheet at runtime (0..15). Read-modify-write bitmap /
  // procedural sprite art.
  pget:     { params: [["coord", false], ["coord", false]], ret: "int", c: "gt_pget", mdOnly: true },
  spr:      { params: [["int", false], ["coord", false], ["coord", false], ["int", true], ["int", true], ["flip", true], ["flip", true]], ret: "void", c: "gt_p8_spr" },
  // GBA-only: rotated+scaled hardware sprite. sprr(n, x, y, angle, [scale]).
  // angle is PICO-8 turns (0..1, like sin/cos); scale is a fixed multiplier
  // (default 1.0). Uses a real OBJ affine matrix — the GBA affine hardware the
  // whole SDK leans into. (No GameTank analog; the emitter only reaches this on
  // the gba target.)
  // sprr2(n,x,y,angle,sx,sy): rotated + NON-uniform scale (squash/stretch, spinning coin).
  // spr8(t,x,y,[flip]): an 8x8 sprite from raw tile index t (bullets, pickups).
  spr8:     { params: [["int", false], ["coord", false], ["coord", false], ["flip", true]], ret: "void", c: "gt_spr8", mdOnly: true },
  // per-sprite modifiers for the next spr()/spr8() this frame (reset each frame):
  spr_pal:  { params: [["int", false]], ret: "void", c: "gt_spr_pal", mdOnly: true },
  spr_prio: { params: [["int", false]], ret: "void", c: "gt_spr_prio", mdOnly: true },
  // spr_blend()/spr_blend_off(): next spr() translucent (uses blend weights) or opaque.
  // spr_window(): next spr() is a shaped OBJ-window mask (pair with window_obj).
  // spr_mosaic(on): apply the mosaic() grid to the next spr().

  // ---- GBA hardware tile backgrounds (Mode 0) — the real scrolling-game path ----
  // These control the 4 hardware BG layers. The tileset/tilemap DATA comes from
  // the build (--maptiles/--map convert a PNG to a layer's tiles + map), so the
  // Lua game just shows/scrolls/edits layers — no giant arrays in Lua source.
  // map_show(layer): display the build-bundled tilemap on a layer (loads its
  //   tiles + map, enables it). Call once (usually _init).
  map_show:  { params: [["int", true]], ret: "void", c: "gt_map_show", mdOnly: true },
  layer_show:{ params: [["int", false], ["flip", false]], ret: "void", c: "gt_layer_show", mdOnly: true },
  layer_pri: { params: [["int", false], ["int", false]], ret: "void", c: "gt_layer_priority", mdOnly: true },
  // camera(x,y) already exists (PICO-8) and maps to gba_camera — hardware scroll.
  layer_scroll:{ params: [["int", false], ["coord", false], ["coord", false]], ret: "void", c: "gt_layer_scroll", mdOnly: true },
  // tget/tset: read/set a tile in a layer's map at (col,row). (Distinct from the
  // GameTank mget/mset above, which have a different 2-arg signature.)
  tget:      { params: [["int", false], ["int", false], ["int", false]], ret: "int", c: "gt_mget", mdOnly: true },
  tset:      { params: [["int", false], ["int", false], ["int", false], ["int", false]], ret: "void", c: "gt_mset", mdOnly: true },

  // ---- color effects (hardware blend unit — free, composites in the PPU) ----
  // blend(layer, alpha): draw a layer semi-transparent over the scene behind it
  //   (glass/ghosts/dimmed UI). layer 0..2 tiles, 3 text, 4 sprites; alpha 0..1.
  // fade(amount, [white]): fade the whole screen to black (or white) — the level-
  //   wipe / hit-flash / pause-dim workhorse. amount 0..1; white truthy = to white.
  // blend_off(): clear all color effects.
  // mosaic(n)/mosaic2(bh,bv): hardware pixelate (0=off..15). Dissolve/hit-flash/heat.
  // backdrop(color): the void behind all layers (PICO-8 index or raw). screen_off/on:
  // force-blank the display instantly (hide a mid-frame rebuild, instant cut).
  backdrop:   { params: [["color", false]], ret: "void", c: "gt_backdrop", mdOnly: true },
  screen_off: { params: [], ret: "void", c: "gt_screen_off", mdOnly: true },
  screen_on:  { params: [], ret: "void", c: "gt_screen_on", mdOnly: true },
  // pal(i,r,g,b) / spr_col(i,r,g,b): set a BG / OBJ palette color at runtime (0..255
  // components). Palette swap, day/night, animated cycling (rotate entries each frame).
  // Genesis pal(): REAL runtime CRAM writes — the headline. pal(c0,c1) remaps
  // P8 color c0's CRAM slot to P8 color c1's RGB; pal() resets all 16.
  pal:       { params: [["int", true], ["int", true]], ret: "void", c: "gt_pal", mdOnly: true },
  // SRAM save/load: (slot, array8, count) — battery-backed, the gbalua contract.
  save:      { params: [["int", false], ["array8", false], ["int", false]], ret: "void", c: "gt_save", mdOnly: true },
  load:      { params: [["int", false], ["array8", false], ["int", false]], ret: "int",  c: "gt_load", mdOnly: true },
  // the VDP WINDOW plane: hud(rows) claims the top N tile rows as a fixed HUD
  // strip (unscrolled, above plane A); hud(0) releases it.
  hud:       { params: [["int", false]], ret: "void", c: "gt_hud", mdOnly: true },
  // shadow/highlight mode: the Genesis blend-ish unit (3 levels, honest).
  shade_mode:{ params: [["flip", false]], ret: "void", c: "gt_shade_mode", mdOnly: true },
  // fade(amount[, to_white]): CRAM brightness scale — the classic Genesis fade.
  // Scales every CRAM entry toward black (or white) from the palette shadow.
  fade:      { params: [["num", false], ["flip", true]], ret: "void", c: "gt_fade", mdOnly: true },
  // per-scanline horizontal scroll of plane B — the Genesis raster signature.
  hscroll:   { params: [["int", false], ["int", false]], ret: "void", c: "gt_hscroll", mdOnly: true },
  // hgradient(table): per-scanline BACKDROP gradient via the HBlank IRQ. `table` is
  // an array of 160 raw BGR555 colors (fill with rgb()/color numbers, one per line):
  // sunset skies, underwater bands, a fire glow. Pass it once/frame; nil/0 = off.
  // save(slot, array8, n) / load(slot, array8, n): battery SRAM persistence. `slot`
  // 0..15 (1 KB each); keep game state in an array8 and save/load it. load returns
  // the byte count restored (0 = slot never written -> start fresh).
  // timer_start()/timer_read(): a free-running hardware timer (Timer 3, ~16 kHz) for
  // sub-frame timing + profiling. timer_start resets it; timer_read samples the count
  // (wraps ~every 4 ms). Bracket a routine to profile it, or drive rhythm timing.
  // realframes()/realsecs(): a STEADY real-time clock. t()/time() advance once per
  // game loop (so a slow _draw makes them drift); these tick in a VCOUNT IRQ at a
  // true 60 Hz regardless — use them to pace things by wall-clock (auto-advance,
  // timeouts). realframes = frame count; realsecs = seconds (16.16).
  realframes: { params: [], ret: "int", c: "gt_realframes", mdOnly: true },
  realsecs:   { params: [], ret: "num", c: "gt_realsecs",   mdOnly: true },

  // ---- Mode 7: affine background (rotate/scale/scroll a plane in hardware) ----
  // mode7(): show the bundled --mode7 plane on BG2 (call once in _init).
  // mode7_cam(x,y, angle, [zoom]): per frame, place the camera over the plane.
  //   x,y = world point the screen centers on; angle = turns (0..1); zoom scale.
  // mode7_off(): hide the affine layer.

  // ---- second affine BG (rotate/scale a layer of YOUR OWN tiles, not Mode 7) --
  // abg_setup(tiles, ntiles, map, msize, [pal]): tiles = array8 of 8bpp pixels
  //   (64 bytes/tile), map = array8 of msize*msize tile indices, msize = 16/32/
  //   64/128, pal = array of BGR555 colors (or omit to keep the BG palette).
  // abg_cam(x,y,angle,[zoom]): per-frame camera (same as mode7_cam).
  // abg_off(): hide it. A spinning logo/menu or a second scaled world.

  // ---- DMA bulk moves (DMA3 — fast block copy/fill of gbalua arrays) ---------
  // dma(dst, src, n): copy n 32-bit words src->dst. dma_fill(dst, value, n): fill.
  // For `array` (16.16) n = element count; for array8 pass a word count (bytes/4).

  // ---- 16-bit direct-color bitmap (Mode 5, true color, double-buffered) -------
  // mode15(): switch to the 16-bit bitmap (160x128). rgb15(r,g,b): build a color
  // (0..255 each). cls15(color)/pset15(x,y,color): clear/plot. flip15(): present.
  // For plasmas / gradients / photo blits beyond the 16-color indexed path.

  // ---- windows: hardware rectangular clipping regions (free in the PPU) ----
  // window(x0,y0,x1,y1): SPOTLIGHT — show everything inside the box, hide outside
  //   (iris/reveal/peek). The one-call verb; covers most uses.
  // window_inside(x0,y0,x1,y1, layers): show only `layers` inside the box. `layers`
  //   is a bitmask: 1=BG0 2=BG1 4=BG2 8=text 16=sprites; 31 = all. Build with +.
  // window_outside(layers): what shows OUTSIDE the box (default none = hidden).
  //   Pass 31 to keep the full scene outside and use the box only to override a region.
  // window_off(): disable windowing.
  // window_obj(layers): OBJ window — sprites flagged spr_window() become a shaped
  //   mask; `layers` (same bitmask) shows through the sprite silhouette (torch/keyhole).

  // ---- animation helpers (frame-range cycling, timed off the frame clock) ----
  // anim(slot, first, last, fps): current frame of a LOOPING cycle first..last at
  //   `fps` animation-frames/sec. slot = a small per-actor id (0..31). Feed the
  //   result to spr()/spr8()/sprf(): spr(anim(0,1,4,8), x, y).
  // anim_once(slot, first, last, fps): play once then HOLD on last; anim_done(slot)
  //   goes true at the end. For explosions / one-shots.
  // anim_pingpong(...): bounce first..last..first.
  // anim_reset(slot): restart. anim_done(slot): 1 if a once-anim finished.
  anim:          { params: [["int", false], ["int", false], ["int", false], ["num", false]], ret: "int", c: "gt_anim", mdOnly: true },
  anim_once:     { params: [["int", false], ["int", false], ["int", false], ["num", false]], ret: "int", c: "gt_anim_once", mdOnly: true },
  anim_pingpong: { params: [["int", false], ["int", false], ["int", false], ["num", false]], ret: "int", c: "gt_anim_pingpong", mdOnly: true },
  anim_reset:    { params: [["int", false]], ret: "void", c: "gt_anim_reset", mdOnly: true },
  anim_done:     { params: [["int", false]], ret: "int", c: "gt_anim_done", mdOnly: true },
  // PICO-8 tilemap: map(cx,cy, sx,sy, cw,ch) draws a cw x ch block of the cart's
  // __map__ (imported as a byte array) starting at cell (cx,cy) to screen pixel
  // (sx,sy), one 8x8 sheet sprite per non-zero tile. Software spr()-loop, the
  // same as PICO-8 (neither machine has tilemap hardware). All six args are
  // optional in PICO-8 (default 0,0,0,0,128,32-ish); we require none.
  map:      { params: [["int", true], ["int", true], ["coord", true], ["coord", true], ["int", true], ["int", true]], ret: "void", special: "map" },
  mget:     { params: [["int", false], ["int", false]], ret: "int", special: "mget" },
  // run()/reset() restart the cart from power-on: a full crt0 reset that reruns
  // copydata (restores every top-level initializer), zeroes BSS, and re-enters
  // main() - not just the game's _init(), which would leave top-level state and
  // the runtime stale. gt_p8_run() jumps to the reset entry (never returns).
  run:      { params: [], ret: "void", c: "gt_p8_run" },
  reset:    { params: [], ret: "void", c: "gt_p8_run" },
  // PICO-8 sspr(sx,sy,sw,sh, dx,dy, [dw,dh], [flip_x,flip_y]): scaled sheet blit.
  // dw/dh default to sw/sh (unscaled). Software nearest-neighbor, rounded to an
  // integer scale and cached in GRAM (see gt_p8_sspr). flips pack into one arg.
  sspr:     { params: [["int", false], ["int", false], ["int", false], ["int", false],
                       ["coord", false], ["coord", false], ["int", true], ["int", true],
                       ["flip", true], ["flip", true]], ret: "void", special: "sspr" },

  // ---- input ---------------------------------------------------------------
  btn:      { params: [["int", false], ["int", true]], ret: "bool", c: "gt_p8_btn" },
  btnp:     { params: [["int", false], ["int", true]], ret: "bool", c: "gt_p8_btnp" },

  // ---- sound (maxmod: module music + sample SFX) ---------------------------
  // sfx(n, [ch]) - fire sampled effect n; ch is accepted but ignored.
  // music(n, [loop]) - start module n; music(-1) stops. loop defaults on.
  // `audio` links maxmod + the soundbank at build time.
  sfx:   { params: [["int", false], ["int", true]], ret: "void", c: "gt_sfx", audio: true },
  // sfx_ex(n, [vol], [pan], [pitch]): per-shot volume 0..1024, pan 0..255 (128=center),
  // pitch 16.16 (1.0=normal). sfx_volume(0..1024): master effect volume.
  // `loop` is a truthy flag (default on): music(0) loops, music(0,false) plays once.
  music: { params: [["int", false], ["flip", true]], ret: "void", c: "gt_music", audio: true },

  // ---- math ------------------------------------------------------------------
  flr:   { params: [["num", false]], ret: "int", c: null, special: "flr" },
  ceil:  { params: [["num", false]], ret: "int", c: null, special: "ceil" },
  abs:   { params: [["num", false]], ret: "same", c: null, special: "abs" },
  sgn:   { params: [["num", false]], ret: "int", c: null, special: "sgn" },
  min:   { params: [["num", false], ["num", true]], ret: "same", c: null, special: "min" },
  max:   { params: [["num", false], ["num", true]], ret: "same", c: null, special: "max" },
  mid:   { params: [["num", false], ["num", false], ["num", false]], ret: "same", c: null, special: "mid" },
  sqrt:  { params: [["num", false]], ret: "fixed", c: "gt_fsqrt" },
  sin:   { params: [["num", false]], ret: "fixed", c: "gt_fsin" },
  cos:   { params: [["num", false]], ret: "fixed", c: "gt_fcos" },
  atan2: { params: [["num", false], ["num", false]], ret: "fixed", c: "gt_fatan2" },

  // PICO-8 bitwise FUNCTION forms - exact aliases of the operators gbalua already
  // has (a & b, a | b, ...). Carts use both spellings interchangeably. Emitted
  // as the operator, so zero runtime cost. band/bor/bxor/bnot on the raw bits;
  // shl/shr shift (shr = arithmetic >>, lshr = logical >>>).
  band:  { params: [["num", false], ["num", false]], ret: "same", c: null, special: "bitop", op: "&" },
  bor:   { params: [["num", false], ["num", false]], ret: "same", c: null, special: "bitop", op: "|" },
  bxor:  { params: [["num", false], ["num", false]], ret: "same", c: null, special: "bitop", op: "^^" },
  bnot:  { params: [["num", false]], ret: "same", c: null, special: "bitop", op: "~" },
  shl:   { params: [["num", false], ["num", false]], ret: "same", c: null, special: "bitop", op: "<<" },
  shr:   { params: [["num", false], ["num", false]], ret: "same", c: null, special: "bitop", op: ">>" },
  lshr:  { params: [["num", false], ["num", false]], ret: "same", c: null, special: "bitop", op: ">>>" },
  rnd:   { params: [["num", true]], ret: "fixed", c: "gt_p8_rnd" },
  srand: { params: [["num", false]], ret: "void", c: "gt_p8_srand" },
  t:     { params: [], ret: "fixed", c: "gt_p8_time", isValue: false },
  time:  { params: [], ret: "fixed", c: "gt_p8_time" },

  // fixed-capacity numeric array (v0.3): `local pool = array(16)`.
  // Top-level only; 1-based indexing; #a is the capacity. Checker handles it.
  array: { params: [["int", false], ["num", true]], ret: "array", special: "array" },
  // byte variant: elements 0-255 in one byte each (half RAM, ~half cycles/access)
  array8: { params: [["int", false], ["num", true]], ret: "array", special: "array" },

  // struct pools (v0.3): `local bullets = pool(8)` at top level, then
  // add(bullets, {x=1, y=2}), `for b in all(bullets)`, del(bullets, b).
  // Field set is frozen by the first add(); #pool = live count.
  pool: { params: [["int", false]], ret: "pool", special: "pool" },
  print: { params: [], ret: "int", special: "print" },
  add:  { params: [], ret: "void", special: "add" },
  del:  { params: [], ret: "void", special: "del" },
};

export const CALLBACKS = ["_init", "_update", "_update60", "_draw"];
