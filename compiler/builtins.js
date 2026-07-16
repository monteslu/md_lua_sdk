// gbalua builtin functions - the PICO-8 global API surface (v0.2 slice) plus
// the gt.* GameTank extras.
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
  clip:     { params: [["coord", true], ["coord", true], ["coord", true], ["coord", true]], ret: "void", c: "gba_clip", gbaOnly: true },
  // pget(x,y): read a bitmap pixel (color 0..255). sset(x,y,[c]): paint a pixel
  // into the loaded sprite sheet at runtime (0..15). Read-modify-write bitmap /
  // procedural sprite art.
  pget:     { params: [["coord", false], ["coord", false]], ret: "int", c: "gba_pget", gbaOnly: true },
  sset:     { params: [["coord", false], ["coord", false], ["color", true]], ret: "void", c: "gba_sset", gbaOnly: true },
  spr:      { params: [["int", false], ["coord", false], ["coord", false], ["int", true], ["int", true], ["flip", true], ["flip", true]], ret: "void", c: "gt_p8_spr" },
  // GBA-only: rotated+scaled hardware sprite. sprr(n, x, y, angle, [scale]).
  // angle is PICO-8 turns (0..1, like sin/cos); scale is a fixed multiplier
  // (default 1.0). Uses a real OBJ affine matrix — the GBA affine hardware the
  // whole SDK leans into. (No GameTank analog; the emitter only reaches this on
  // the gba target.)
  sprr:     { params: [["int", false], ["coord", false], ["coord", false], ["num", false], ["num", true]], ret: "void", c: "gba_sprr", gbaOnly: true },
  // sprr2(n,x,y,angle,sx,sy): rotated + NON-uniform scale (squash/stretch, spinning coin).
  sprr2:    { params: [["int", false], ["coord", false], ["coord", false], ["num", false], ["num", false], ["num", false]], ret: "void", c: "gba_sprr2", gbaOnly: true },
  // spr8(t,x,y,[flip]): an 8x8 sprite from raw tile index t (bullets, pickups).
  spr8:     { params: [["int", false], ["coord", false], ["coord", false], ["flip", true]], ret: "void", c: "gba_spr8", gbaOnly: true },
  // per-sprite modifiers for the next spr()/spr8() this frame (reset each frame):
  spr_pal:  { params: [["int", false]], ret: "void", c: "gba_spr_pal", gbaOnly: true },
  spr_prio: { params: [["int", false]], ret: "void", c: "gba_spr_prio", gbaOnly: true },
  // spr_blend()/spr_blend_off(): next spr() translucent (uses blend weights) or opaque.
  spr_blend:     { params: [], ret: "void", c: "gba_spr_blend", gbaOnly: true },
  spr_blend_off: { params: [], ret: "void", c: "gba_spr_blend_off", gbaOnly: true },
  // spr_window(): next spr() is a shaped OBJ-window mask (pair with window_obj).
  spr_window:    { params: [], ret: "void", c: "gba_spr_window", gbaOnly: true },
  // spr_mosaic(on): apply the mosaic() grid to the next spr().
  spr_mosaic:    { params: [["flip", false]], ret: "void", c: "gba_spr_mosaic", gbaOnly: true },

  // ---- GBA hardware tile backgrounds (Mode 0) — the real scrolling-game path ----
  // These control the 4 hardware BG layers. The tileset/tilemap DATA comes from
  // the build (--maptiles/--map convert a PNG to a layer's tiles + map), so the
  // Lua game just shows/scrolls/edits layers — no giant arrays in Lua source.
  // map_show(layer): display the build-bundled tilemap on a layer (loads its
  //   tiles + map, enables it). Call once (usually _init).
  map_show:  { params: [["int", true]], ret: "void", c: "gba_map_show", gbaOnly: true },
  layer_show:{ params: [["int", false], ["flip", false]], ret: "void", c: "gba_layer_show", gbaOnly: true },
  layer_pri: { params: [["int", false], ["int", false]], ret: "void", c: "gba_layer_priority", gbaOnly: true },
  // camera(x,y) already exists (PICO-8) and maps to gba_camera — hardware scroll.
  layer_scroll:{ params: [["int", false], ["coord", false], ["coord", false]], ret: "void", c: "gba_layer_scroll", gbaOnly: true },
  parallax:  { params: [["int", false], ["num", false]], ret: "void", c: "gba_layer_parallax", gbaOnly: true },
  // tget/tset: read/set a tile in a layer's map at (col,row). (Distinct from the
  // GameTank mget/mset above, which have a different 2-arg signature.)
  tget:      { params: [["int", false], ["int", false], ["int", false]], ret: "int", c: "gba_mget", gbaOnly: true },
  tset:      { params: [["int", false], ["int", false], ["int", false], ["int", false]], ret: "void", c: "gba_mset", gbaOnly: true },

  // ---- color effects (hardware blend unit — free, composites in the PPU) ----
  // blend(layer, alpha): draw a layer semi-transparent over the scene behind it
  //   (glass/ghosts/dimmed UI). layer 0..2 tiles, 3 text, 4 sprites; alpha 0..1.
  // fade(amount, [white]): fade the whole screen to black (or white) — the level-
  //   wipe / hit-flash / pause-dim workhorse. amount 0..1; white truthy = to white.
  // blend_off(): clear all color effects.
  blend:     { params: [["int", false], ["num", false]], ret: "void", c: "gba_blend", gbaOnly: true },
  fade:      { params: [["num", false], ["flip", true]], ret: "void", c: "gba_fade", gbaOnly: true },
  blend_off: { params: [], ret: "void", c: "gba_blend_off", gbaOnly: true },
  // mosaic(n)/mosaic2(bh,bv): hardware pixelate (0=off..15). Dissolve/hit-flash/heat.
  mosaic:    { params: [["int", false]], ret: "void", c: "gba_mosaic", gbaOnly: true },
  mosaic2:   { params: [["int", false], ["int", false]], ret: "void", c: "gba_mosaic2", gbaOnly: true },
  // backdrop(color): the void behind all layers (PICO-8 index or raw). screen_off/on:
  // force-blank the display instantly (hide a mid-frame rebuild, instant cut).
  backdrop:   { params: [["color", false]], ret: "void", c: "gba_backdrop", gbaOnly: true },
  screen_off: { params: [], ret: "void", c: "gba_screen_off", gbaOnly: true },
  screen_on:  { params: [], ret: "void", c: "gba_screen_on", gbaOnly: true },
  // pal(i,r,g,b) / spr_col(i,r,g,b): set a BG / OBJ palette color at runtime (0..255
  // components). Palette swap, day/night, animated cycling (rotate entries each frame).
  pal:       { params: [["int", false], ["int", false], ["int", false], ["int", false]], ret: "void", c: "gba_pal", gbaOnly: true },
  spr_col:   { params: [["int", false], ["int", false], ["int", false], ["int", false]], ret: "void", c: "gba_spr_col", gbaOnly: true },
  // hgradient(table): per-scanline BACKDROP gradient via the HBlank IRQ. `table` is
  // an array of 160 raw BGR555 colors (fill with rgb()/color numbers, one per line):
  // sunset skies, underwater bands, a fire glow. Pass it once/frame; nil/0 = off.
  hgradient: { params: [["array", false]], ret: "void", c: "gba_hgradient", gbaOnly: true },
  // save(slot, array8, n) / load(slot, array8, n): battery SRAM persistence. `slot`
  // 0..15 (1 KB each); keep game state in an array8 and save/load it. load returns
  // the byte count restored (0 = slot never written -> start fresh).
  save:      { params: [["int", false], ["array8", false], ["int", false]], ret: "void", c: "gba_save", gbaOnly: true },
  load:      { params: [["int", false], ["array8", false], ["int", false]], ret: "int",  c: "gba_load", gbaOnly: true },
  // timer_start()/timer_read(): a free-running hardware timer (Timer 3, ~16 kHz) for
  // sub-frame timing + profiling. timer_start resets it; timer_read samples the count
  // (wraps ~every 4 ms). Bracket a routine to profile it, or drive rhythm timing.
  timer_start: { params: [], ret: "void", c: "gba_timer_start", gbaOnly: true },
  timer_read:  { params: [], ret: "int",  c: "gba_timer_read",  gbaOnly: true },
  // realframes()/realsecs(): a STEADY real-time clock. t()/time() advance once per
  // game loop (so a slow _draw makes them drift); these tick in a VCOUNT IRQ at a
  // true 60 Hz regardless — use them to pace things by wall-clock (auto-advance,
  // timeouts). realframes = frame count; realsecs = seconds (16.16).
  realframes: { params: [], ret: "int", c: "gba_realframes", gbaOnly: true },
  realsecs:   { params: [], ret: "num", c: "gba_realsecs",   gbaOnly: true },

  // ---- Mode 7: affine background (rotate/scale/scroll a plane in hardware) ----
  // mode7(): show the bundled --mode7 plane on BG2 (call once in _init).
  // mode7_cam(x,y, angle, [zoom]): per frame, place the camera over the plane.
  //   x,y = world point the screen centers on; angle = turns (0..1); zoom scale.
  // mode7_off(): hide the affine layer.
  mode7:     { params: [], ret: "void", c: "gba_mode7", gbaOnly: true },
  mode7_cam: { params: [["num", false], ["num", false], ["num", false], ["num", true]], ret: "void", c: "gba_mode7_cam", gbaOnly: true },
  mode7_off: { params: [], ret: "void", c: "gba_mode7_off", gbaOnly: true },

  // ---- second affine BG (rotate/scale a layer of YOUR OWN tiles, not Mode 7) --
  // abg_setup(tiles, ntiles, map, msize, [pal]): tiles = array8 of 8bpp pixels
  //   (64 bytes/tile), map = array8 of msize*msize tile indices, msize = 16/32/
  //   64/128, pal = array of BGR555 colors (or omit to keep the BG palette).
  // abg_cam(x,y,angle,[zoom]): per-frame camera (same as mode7_cam).
  // abg_off(): hide it. A spinning logo/menu or a second scaled world.
  abg_setup: { params: [["array8", false], ["int", false], ["array8", false], ["int", false], ["array", true]], ret: "void", c: "gba_abg_setup", gbaOnly: true },
  abg_cam:   { params: [["num", false], ["num", false], ["num", false], ["num", true]], ret: "void", c: "gba_abg_cam", gbaOnly: true },
  abg_off:   { params: [], ret: "void", c: "gba_abg_off", gbaOnly: true },

  // ---- DMA bulk moves (DMA3 — fast block copy/fill of gbalua arrays) ---------
  // dma(dst, src, n): copy n 32-bit words src->dst. dma_fill(dst, value, n): fill.
  // For `array` (16.16) n = element count; for array8 pass a word count (bytes/4).
  dma:      { params: [["array", false], ["array", false], ["int", false]], ret: "void", c: "gba_dma", gbaOnly: true },
  dma_fill: { params: [["array", false], ["int", false], ["int", false]], ret: "void", c: "gba_dma_fill", gbaOnly: true },

  // ---- 16-bit direct-color bitmap (Mode 5, true color, double-buffered) -------
  // mode15(): switch to the 16-bit bitmap (160x128). rgb15(r,g,b): build a color
  // (0..255 each). cls15(color)/pset15(x,y,color): clear/plot. flip15(): present.
  // For plasmas / gradients / photo blits beyond the 16-color indexed path.
  mode15:   { params: [], ret: "void", c: "gba_mode15", gbaOnly: true },
  rgb15:    { params: [["int", false], ["int", false], ["int", false]], ret: "int", c: "gba_rgb15", gbaOnly: true },
  cls15:    { params: [["int", false]], ret: "void", c: "gba_cls15", gbaOnly: true },
  pset15:   { params: [["coord", false], ["coord", false], ["int", false]], ret: "void", c: "gba_pset15", gbaOnly: true },
  fillrect15: { params: [["coord", false], ["coord", false], ["coord", false], ["coord", false], ["int", false]], ret: "void", c: "gba_fillrect15", gbaOnly: true },
  flip15:   { params: [], ret: "void", c: "gba_flip15", gbaOnly: true },

  // ---- windows: hardware rectangular clipping regions (free in the PPU) ----
  // window(x0,y0,x1,y1): SPOTLIGHT — show everything inside the box, hide outside
  //   (iris/reveal/peek). The one-call verb; covers most uses.
  // window_inside(x0,y0,x1,y1, layers): show only `layers` inside the box. `layers`
  //   is a bitmask: 1=BG0 2=BG1 4=BG2 8=text 16=sprites; 31 = all. Build with +.
  // window_outside(layers): what shows OUTSIDE the box (default none = hidden).
  //   Pass 31 to keep the full scene outside and use the box only to override a region.
  // window_off(): disable windowing.
  window:         { params: [["coord", false], ["coord", false], ["coord", false], ["coord", false]], ret: "void", c: "gba_window", gbaOnly: true },
  window_inside:  { params: [["coord", false], ["coord", false], ["coord", false], ["coord", false], ["int", false]], ret: "void", c: "gba_window_inside", gbaOnly: true },
  window_outside: { params: [["int", false]], ret: "void", c: "gba_window_outside", gbaOnly: true },
  // window_obj(layers): OBJ window — sprites flagged spr_window() become a shaped
  //   mask; `layers` (same bitmask) shows through the sprite silhouette (torch/keyhole).
  window_obj:     { params: [["int", false]], ret: "void", c: "gba_window_obj", gbaOnly: true },
  window_off:     { params: [], ret: "void", c: "gba_window_off", gbaOnly: true },

  // ---- animation helpers (frame-range cycling, timed off the frame clock) ----
  // anim(slot, first, last, fps): current frame of a LOOPING cycle first..last at
  //   `fps` animation-frames/sec. slot = a small per-actor id (0..31). Feed the
  //   result to spr()/spr8()/sprf(): spr(anim(0,1,4,8), x, y).
  // anim_once(slot, first, last, fps): play once then HOLD on last; anim_done(slot)
  //   goes true at the end. For explosions / one-shots.
  // anim_pingpong(...): bounce first..last..first.
  // anim_reset(slot): restart. anim_done(slot): 1 if a once-anim finished.
  anim:          { params: [["int", false], ["int", false], ["int", false], ["num", false]], ret: "int", c: "gba_anim", gbaOnly: true },
  anim_once:     { params: [["int", false], ["int", false], ["int", false], ["num", false]], ret: "int", c: "gba_anim_once", gbaOnly: true },
  anim_pingpong: { params: [["int", false], ["int", false], ["int", false], ["num", false]], ret: "int", c: "gba_anim_pingpong", gbaOnly: true },
  anim_reset:    { params: [["int", false]], ret: "void", c: "gba_anim_reset", gbaOnly: true },
  anim_done:     { params: [["int", false]], ret: "int", c: "gba_anim_done", gbaOnly: true },
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
  sfx_ex:     { params: [["int", false], ["int", true], ["int", true], ["num", true]], ret: "void", c: "gba_sfx_ex", gbaOnly: true },
  sfx_volume: { params: [["int", false]], ret: "void", c: "gba_sfx_volume", gbaOnly: true },
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
