# mdlua — fork journal (SEED)

The third PICO-8-flavored-Lua → native-C console SDK (Sega Mega Drive /
Genesis, 68000 + SGDK). Built FROM SCRATCH per the plan of record
(`~/code/cliemu/internal-genesislua/PLAN.md`), copying curated files — NOT a
fork/branch of gtlua or gbalua. After all three SDKs ship, the shared
components get re-evaluated for a `lua-c` module.

## Origin map (what was copied, from where, and what changed)

| file | from | changes |
|---|---|---|
| compiler/lexer.js | gba_lua_sdk (identical to gtlua's) | none |
| compiler/parser.js | gba_lua_sdk | none |
| compiler/check.js | gba_lua_sdk | none (target plumbing rides builtins) |
| compiler/index.js | gba_lua_sdk | none |
| compiler/emit.js | gba_lua_sdk | retarget: single target "md"; cName gt_*→md_*; SGDK harness `int main(bool hard)` + md_init/md_vsync/md_endframe; emitted includes → md_api.h/md_math.h; FINAL REMAP PASS (all raw gt_* template names → md_* — fixes the class of bug where gbalua emits gt_p8_rnd_int that nothing defines) |
| compiler/builtins.js | gba_lua_sdk | (spike: as-is; Phase 1 rewrites contents for the Genesis surface) |
| md-sdk/md_math.c/.h | gba_lua_sdk gba_math | renamed; + helpers the emitter references raw (md_rnd_int, absi/sgn/mid, ifdiv/ifmod/ffmod) |
| md-sdk/md_sintab.h, md_atantab.h | gba_lua_sdk | renamed symbols |
| compiler/build-md.mjs | new (gbalua build-gba.mjs SHAPE) | drives the PUBLISHED `romdev-toolchain-m68k-gcc@0.3.0` (buildGenesisC + finalizeGenesisRom) — no romdevtools anywhere |
| md-sdk/md_api.c/.h | new | thin SGDK wrappers |
| NOT copied | peephole.js (cc65-only), FLASH2M/zp-fastcall machinery (still !isMd-guarded in emit — Phase-1 strip once tests exist) |

## Deps (final shape from day one)
romdev-toolchain-m68k-gcc@0.3.0 (compiler+Z80 tools+SGDK+driver),
romdev-core-gpgx, romdev-xgm2, romdev-audio-resampler. Zero romdevtools.

## Spike log

### Spike 0 — DONE 2026-07-16
- 0a: hand-written SGDK C → buildGenesisC → finalizeGenesisRom → 512K .bin →
  gpgx renders text + checker plane + pad-moved glyph. Published pipeline
  works end to end.
- 0b: Lua (btn/cls/print/spr) → compile(target md) → generated C → ROM.
  4 hardware sprites moved by pad input in gpgx (screenshot-verified, input
  diff confirmed). PICO-8 palette live in CRAM PAL0. FIRST LUA→GENESIS ROM.
- Found upstream: gbalua bug — emits gt_p8_rnd_int/gt_absi etc. that its
  runtime never defines (flr(rnd(n)) fails to link). mdlua's final remap pass
  + md_math helpers close that class. TODO: file to the gbalua agent.

## Frame model
Immediate-mode PICO-8 shape on hardware sprites: md_spr() claims sequential
SAT slots per frame; md_endframe() hides stale slots, VDP_linkSprites (link
byte is load-bearing — 0 = end of list), VDP_updateSprites(DMA_QUEUE),
md_time_tick, SYS_doVBlankProcess. Input latched in md_vsync (btn/btnp edge).
P8 buttons: 0-3 = dpad, 4 O→BUTTON_B, 5 X→BUTTON_C.

### Spike 1 — DONE 2026-07-16 (the Genesis flavor, all three proofs)
- `hscroll(line,x)`: per-scanline H-scroll from Lua — 224-entry table, ONE
  queued DMA per frame, HSCROLL_LINE mode flipped lazily on first use.
  Screenshot: checker plane warped into zigzag raster waves. THE signature.
- `pal(c0,c1)` / `pal()`: live CRAM writes (PAL_setColor) — palette cycling
  visible. The verb PICO-8 carts blocked on (gtlua: hardware mismatch) is
  NATIVE here.
- `music(0)`: XGM2 FM through the Z80 driver from Lua. GOTCHA (cost a cycle):
  **XGM2 blobs must be 256-byte aligned** (the driver pages in 256B units;
  rescomp does ALIGN 256) — a plain C array byte-aligns and plays NOTHING.
  `__attribute__((aligned(256)))` fixes it. Also: audioDebug op:'inspect'
  CANNOT see XGM2 (Z80 writes the chip directly; 68k-side sampling misses it)
  — use op:'record' (spike1: silent=false, rms 807 = the reference template's
  exact profile).
- Spike verbs added: pal/hscroll (mdOnly builtins), md_music/md_sfx stub,
  temporary checker plane in md_init (Phase 1 removes).
