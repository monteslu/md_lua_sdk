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

### Phase 1 progress — 2026-07-16
- **Asset pipeline ported**: png-tiles.mjs GBA→VDP (left pixel = HIGH nibble;
  CRAM 9-bit BBB0GGG0RRR0 words; sheet tiles ROW-MAJOR linear — multi-cell
  spr() composes 1x1 hardware sprites, sidestepping MD's column-major
  multi-tile order). asset-headers.mjs emits sheet_/map_ C arrays; build-md
  generates md_assets.h per build (stubs when no --sheet/--map).
- **Full Phase-1 runtime** (~430 lines md_api.c): sprites w/h 1-4 cells +
  flip grid, camera→plane scroll, bitmap verbs on SGDK BMP engine (lazy init,
  256x160, Bresenham line/circ ports), P8-array map() + asset map_show() +
  mget/mset shadow, layer_scroll, print with a 2-slot color cache (PAL2/3
  idx15), PSG sfx blips, slot-based anim engine (gbalua's contract, ported).
- **HARDWARE TRUTH (cost a debug cycle): mid-frame direct PAL_setColor races
  the vblank DMA queue** — the control/data write pair gets split by the IRQ
  and the value lands at the wrong CRAM address (measured: a print-color
  write FLOODED the backdrop with the written value; whole screen one color).
  FIX: all palette changes go through a 64-entry CRAM shadow flushed as ONE
  PAL_setColors(..., DMA_QUEUE) in md_endframe. pal()/text-cache/fades all
  ride it. Debug method: A/B/C/D/E bisect variants through gpgx + verify.
- anim contract ADOPTED from gbalua verbatim (slot,first,last,fps) — cross-SDK
  parity beats my simpler 3-arg draft; ported gba_anim.c wholesale.
- MVP example (real critter.png sheet): text colors + animated sprite +
  flipped sprite + input, 8 colors on screen, screenshot-verified.

### Phase 1 — CORE COMPLETE 2026-07-16
- Tests: 20/20 (compile-level; incl. the md_rnd_int remap regression gbalua
  carries, no-GameTank-residue sweep, pal/hscroll/music emission, slot anim,
  map special routing, pool SoA intact).
- `mdlua run` ported from gtlua-run.mjs over romdev-core-gpgx (320x224 3x,
  keyboard Z/X/C = Genesis A/B/C via gpgx's Y/B/A libretro mapping).
- fade(amount[,to_white]) added: CRAM brightness scale from a TRUE-palette
  snapshot, rides the queued flush; fade(0) restores exact. The MD-native
  answer to the GBA's hardware fade.
- **starfall ported VERBATIM** (the gbalua example's main.lua, unchanged) —
  builds with --sheet shmup_sheet.png --map space_bg.png and PLAYS: formation,
  shots, score/lives HUD, input. Cross-SDK parity is real.
- Palette lines settled: PAL0=P8 16, PAL1=sheet, PAL2=asset map, PAL3.15=
  text-color cache (white on PAL0.15 + 1 cached color; documented limit).
- map_show(layer) arity aligned to the cross-SDK contract.

### Phase-1 remaining (tracked): more examples, num8 decision, docs
### Phase 2 next: window plane, shadow/highlight, 6-button, SRAM, DMA verbs,
### PCM SFX, cheatsheets. Phase 3: coverage harness -> 100% SGDK grind.

### Phase 2 — verbs landed 2026-07-16
- save/load (slot, array8, n): battery SRAM, gbalua's exact contract.
- hud(rows): the VDP WINDOW plane as an unscrolled top HUD strip; print()
  auto-routes into it when the row falls inside. The classic status bar.
- shade_mode(on): VDP shadow/highlight bit (the honest 3-level "blend").
- fade(amount[,to_white]): CRAM scale from a true-palette snapshot.
- PCM SFX: --sfx a.wav,b.wav -> 8-bit signed 13.3kHz 256-aligned bank
  (minimal WAV reader + linear resample in build-md); md_sfx plays XGM2 PCM
  channels 2-4, PSG blip fallback when no bank. Music+SFX share the driver.
- 6-button pad: btn(8..11) = X/Y/Z/MODE.
- RUN-VERIFIED in gpgx: SRAM round-trip ("sram ok: 1" cart), hud strip, fade
  sequence, pcm-fallback sfx path. Phase-2 verbs all exercised on the core.

### Examples set (2026-07-16)
- mvp (sheet art + anim + input), starfall (VERBATIM gbalua port; the parity
  proof), anim + hello (verbatim ports), raster (the Genesis showcase: window
  HUD + per-line waves + CRAM cycling + FM). All build + render in gpgx.
- KNOWN POLISH ITEM: window-plane text shows a duplicate glyph artifact at
  far right (window plane is 64 tiles wide vs 40 shown; needs width clamp or
  plane-size set). Track in Phase-3 polish.

### IN FLIGHT (if resuming after compaction, check these agents' outputs)
- coverage harness agent: tools/sgdk-coverage.mjs + coverage/ledger.json +
  report + never-decrease test (Phase 3's measuring stick).
- docs agent: docs/CHEATSHEET.md + CHEATSHEET_FOR_PICO8_USERS.md + README.md.
### NEXT AFTER AGENTS LAND: review+commit their output, then the Phase-3
### coverage grind (builtins direct-call rows for scalar SGDK fns; opaque
### handles for Sprite*/Map*; static-named callbacks - flat ROM makes them
### safe; N/A ledger honest). Genre examples: port the 10 romdev C templates
### to Lua. Then version 0.1.0, tag, HOLD for monteslu's npm publish.

### num8 decision (2026-07-16): DEFERRED, honestly
emit's 8.8 path works (strength-reduction verified) but md_math is 16.16-only
(sin table, time, print_num) - wiring --num8 now = silently wrong math. Wire
it when md_math grows -DMD_NUM8 tables; measure on the 16-bit-native 68000 in
the Phase-3 perf pass. (Same state gbalua shipped in, but DOCUMENTED here.)

### Phase 3 — 100% SGDK COVERAGE 2026-07-16
- snd/ added to the survey (XGM2/PSG/PCM are API we target); 791 total protos.
- **tools/gen-sgdk-builtins.mjs**: auto-generates direct-call builtins for the
  ENTIRE SGDK public surface. 724 functions exposed under their OWN names
  (VDP_setTileMapXY, SPR_addSprite, PAL_setColor, XGM2_play...). scalar args ->
  int kind; POINTERS -> opaque int handles (m68k int is 32-bit; Sprite*/Map*
  fit); char* -> string literal. C names are raw SGDK symbols (no gt_ root ->
  emitter's remap leaves them -> link straight to bundled libmd). Curated
  PICO-8 verbs win name clashes (merged first).
- **COVERAGE: 100.00%** (725/725 applicable). 66 N/A each with a reason:
  sprite_eng_legacy (superseded) 45, MEM heap 9, task/coroutines 6, varargs
  (sprintf/kprintf/SYS_die) + memcmp(void*) + struct-by-value config 6.
- baseline.json locked at 100% (never-decrease CI gate).
- 799 total Lua verbs (75 curated + 724 SGDK). "Know SGDK -> know mdlua."
- PROVEN: VDP_setReg/getReg/PAL_setColor/VDP_drawText compile, LINK against
  libmd, and run in gpgx. Front-end fix: string literals now allowed in any
  str-kind builtin arg (was print()-only) - needed for VDP_drawText et al.
- example sgdk_direct: raw SGDK calls next to PICO-8 verbs in one cart.

### v0.1.0 — DONE 2026-07-16 (all phases complete, HELD for npm publish)
Every plan phase is done:
- Spike 0/1: pipeline + Genesis flavor proven.
- Phase 1: full core PICO-8 API + asset pipeline (PNG->VDP) + runtime + run
  window + tests + examples.
- Phase 2: SRAM, WINDOW hud, shadow/highlight, fade, PCM sfx, 6-button, docs.
- Phase 3: 100% SGDK coverage (724 auto-generated direct-call verbs + 75
  curated = 799 total), coverage CI gate, genre examples, 4-way parity cart.

STATUS: 31 tests pass, 8 examples build+run in gpgx (all screenshot-verified),
100.00% SGDK coverage (baseline-locked). Deps: published packages only
(romdev-toolchain-m68k-gcc@0.3.0 + romdev-core-gpgx + xgm2/resampler), zero
romdevtools. NOT pushed to a remote (monteslu creates it); NOT npm-published
(monteslu's manual step) - version bumped to 0.1.0 and HELD, same flow as gtlua.

KNOWN POLISH (non-blocking, tracked for later):
- window-plane text: far-right duplicate glyph (plane width vs shown clamp).
- VDP_drawText (raw SGDK) text-palette selection interacts with mdlua print()'s
  cache (both fight PAL selection); direct SGDK text + mdlua print in ONE frame
  needs a shared text-palette convention.
- bitmap verbs (BMP engine) vs tile/sprite mode don't compose in one frame
  (BMP claims plane A). Documented; games pick a mode.
- num8 wiring (deferred - md_math is 16.16-only; needs -DMD_NUM8 tables).
- ase/tmx import exists in compiler/ but build-md doesn't wire it (PNG only).

For the shared-core `lua-c` extraction (now 3 impls exist): see
internal-gtlua/CORE_EXTRACTION.md + gtlua-core-extraction-retro memory. The
mdlua fork copied curated files (SEED origin map) and added: the FINAL REMAP
PASS (fixes gbalua's unlinkable gt_p8_rnd_int class), the CRAM-shadow palette
flush (mid-frame PAL_setColor races the DMA queue), and the generated-SGDK
direct-call table (the 100%-coverage engine) - candidates for the shared core.

### Post-v0.1.0 fix: the generated table shipped EMPTY (caught on re-verify)
The v0.1.0 commit captured builtins-sgdk.js as the EMPTY stub (0 SGDK verbs),
not the generated 724 - so real coverage was 0%, while the ledger (a seed-time
snapshot) still claimed 100%. sgdk_direct stopped compiling. Root cause: nothing
tied the generated FILE to the generator; a regen-then-commit-wrong-moment
desynced them. FIX: regenerated + added coverage-test gate (d) - builtins-sgdk
must be non-stale (>500 entries) and every generated verb must resolve in the
merged BUILTINS. Negative-tested (fires on the empty stub). Lesson for the
lua-c extraction: generated artifacts need a sync gate, not just a ledger.

### Post-v0.1.0: SGDK coroutines (task.h) + raw PCM, made usable with tests
"why can't you do coroutines? it's just syntax + SGDK calls." Correct - nothing
fundamental blocked it. Bound SGDK's task.h AND SND_PCM_startPlay, both proven
IN gpgx.

The `fn` (callback) builtin kind - the unlock for the whole SGDK callback API
(task.h, SYS_setVIntCallback, sprite hooks):
- check.js: a `fn` param must be a bare top-level function NAME. Annotates
  `a.callbackRef` + marks `functions.get(name).addressTaken = true`.
- emit.js: renders `(void*)&gtl_<name>`; dead-code roots include addressTaken
  functions (so the referenced Lua fn survives). Flat Genesis ROM makes the
  indirect call safe (no bank to unmap) and the static ref keeps the call graph
  complete.
- BUG fixed: `call.argKinds = call.args.map(typeOf)` ran typeOf() over EVERY
  builtin arg AFTER checkArgs, re-tripping "functions are not values" on the
  callback name. Skip typeOf for fn/pool/array/optr args in that map.

SGDK task contract (task.h), learned the hard way (first cart = PRIVILEGE
VIOLATION): the USER TASK must NOT call TSK_userYield() (that's supervisor-only)
- the SUPERVISOR (main loop) calls TSK_userYield() to hand the task a slice; the
  task runs until VBlank pre-empts it. And a value the task mutates + the
  supervisor reads must be MEMORY-BACKED (an array) - a tight-loop scalar lives
  in a register the context-switch saves but _draw() never sees flushed to RAM.
  examples/coroutine proves task:N == frame:N in lockstep.

Raw PCM (SND_PCM_* driver, DISTINCT from the XGM2 path sfx/music use - they
share the Z80, pick one per cart). Curated: pcm_sample(n)/pcm_len(n) hand a
--sfx blob to SND_PCM_startPlay; pcm_driver() loads the Z80 driver once;
pcm_play(n,rate,loop) is the whole recipe. examples/pcm - audioDebug op:record
shows peak 3262 / meanabs 648 (audible), not silence.

Two GENERATOR fixes (both a class, not one-offs):
1. `bool`/`Bool` scalar params -> the "flip" builtin kind, so Lua `true`/`false`
   pass (plain "int" rejected `false` as "boolean where number expected"). 71
   SGDK functions gain working bool args.
2. pointer-HANDLE params -> a new "optr" kind that casts the int handle to
   `(void*)` at the call site. Without it, `SND_PCM_startPlay(int, ...)` and the
   whole Sprite*/Map* API failed under -Werror (-Wint-conversion). Pointer
   RETURNS stay int (Lua holds the handle); only pointer PARAMS get optr.

STRUCTURAL BUG fixed (same family as the empty-table ship): the generator
imported the MERGED `BUILTINS` (which already spreads its own prior output), so
on every rerun all 732 SGDK names looked "already taken" -> generated 0 ->
wiped the file. FIX: split `CURATED_BUILTINS` as its own export; the generator
excludes only THOSE. builtins.js now: `BUILTINS = {...CURATED_BUILTINS,
...SGDK_BUILTINS}`. The drift gate catches the symptom; this kills the cause.

task.h flipped from na->covered (removed the hardcoded NA_HEADERS["task.h"] in
seed-ledger.mjs). Coverage 725->733 (na 66->58: only legacy sprite engine 45,
MEM heap 9, 4 varargs remain). 41 tests (was 32), 10 examples (added
coroutine + pcm, both gpgx-verified). baseline.json bumped to 733.

### SYS_setVIntCallback: Lua fn as the vblank hook (example + test)
Already bound (fn kind) - added examples/vint_callback + a test to prove it in
practice. A top-level Lua function installed via SYS_setVIntCallback runs inside
the VInt handler every vblank (60Hz), independent of _update/_draw. Same two
rules as task.h: pass the bare function NAME (address handed to SGDK), and use a
MEMORY-BACKED array for anything the handler mutates + the loop reads (interrupt
context saves regs, but a scalar bump may never reach RAM). gpgx: vints:N ==
frame:N lockstep. 43 tests, 11 examples.

### SPR_setFrameChangeCallback: sprite-engine callback + the retptr fix
Bound (optr sprite handle + fn callback). Two things surfaced:
- mdlua's PICO-8 sprite verbs drive VDP hardware sprites directly; the SGDK
  sprite ENGINE (SPR_*) needs a SpriteDefinition the asset path never builds.
  Added a runtime helper demo_sprite() (curated builtin) = a minimal 2-frame
  animated SpriteDefinition (one 8x8 tile, TileSet, Animation) so SPR_addSprite
  + callbacks work. examples/sprite_callback: hits climbs live as the engine
  calls our Lua fn. HONEST framing: the callback fires from the engine's vblank
  processing (SYS_doVBlankProcess, which the runtime runs each frame calls
  SPR_update internally) - with a minimal def that re-uploads tiles each frame
  it fires ~every frame, NOT strictly per animation-frame-advance. Don't claim
  "once per advance"; it's "the engine invokes your Lua fn during frame
  processing." Enough to prove the binding end to end.
- retptr fix (a CLASS, like optr/flip): SPR_addSprite and every pointer-
  RETURNING SGDK fn hands back a Sprite*/Map*/... Assigning that to an int
  handle global was -Wint-conversion under -Werror. Generator now emits the
  return as int + a `retptr: true` marker; emit wraps the call in `(int)`.
  (optr = pointer PARAMS -> (void*); retptr = pointer RETURNS -> (int).)
46 tests (+3), 12 examples (+sprite_callback).

### The REAL music bank (the demo-blob spike retired)
"the audio needs to be perfect before we start on the IDE." It is now:
- `--music a.vgm,b.vgm[,c.xgc]` -> compiler/audio-assets.mjs songToXgm2 ->
  256-aligned bank in md_songs.c; md_music(n, loop) honors BOTH args at last
  (was `(void)n; (void)loop;` playing the demo blob regardless). music(-1)
  stops; loop default ON, XGM2_setLoopNumber(-1|0) before XGM2_play.
- romdev-xgm2's vgmToXgm2 verified BYTE-IDENTICAL to SGDK's xgm2tool
  (demo.vgm -> our output === shipped demo.xgc). .vgz inflates caller-side
  (node: zlib; browser: DecompressionStream); .xgc passes through.
- compiler/audio-assets.mjs is the BROWSER-SAFE module (DataView, no Buffer/
  fs/zlib) both the CLI and the web IDE import - the byte-identity chokepoint.
  wavToXgm2Pcm moved there off Buffer; sfx/songs bank C generators too.
- gpgx-verified with Goertzel analysis (the crude mean-abs metric MISSED sfx
  under music; per-frequency detection nailed it): music(0) vs music(1) are
  different audible songs; music(-1) -> dead silence; music(n,false) ends
  after one pass (fixture VGM needs a LOOP POINT or xgm2tool emits no loop
  command and both modes play once); default loop alive at 3x song length;
  sfx(0) at 1kHz PRESENT (g1000 179) while the 880Hz melody note ALSO
  present (g880 337) - music+sfx genuinely mix.
- test/vgm-fixture.mjs: synthetic-but-valid VGM 1.60 generator (PSG melody,
  loop point) - the "tracker-generated VGM" proof for the future IDE tracker.
- examples/music (bank switch/stop/once/sfx-over, starts at boot - caught
  silent-boot in verification); 56 tests (+10 audio-assets). CLI run also
  passes --sfx/--music now (run used to silently drop --sfx).
- Dialect note hit while writing the example: top-level locals must init to
  CONSTANT NUMBERS (booleans cascade-fail into "conditions must be boolean");
  int flags + explicit == are the idiom.

### Publish readiness + the BMP nibble bug (caught by the README screenshot)
Taking the README screenshots the sibling SDKs have exposed a REAL renderer
bug: every bitmap verb (pset/line/rect/circfill) drew STRIPES - only every
other pixel. SGDK BMP contract (bmp.h doc): the col param must be "8 bits
filled" (0x00, 0x11 - the color in BOTH nibbles); the 4bpp buffer packs 2
px/byte and BMP_setPixel masks YOUR byte to the target nibble, so a plain
0-15 colors half the pixels. Fix: (col << 4) | col in plot_clip (+ mask
BMP_getPixel's return to 0-15). Verified solid-color repro in gpgx. Lesson:
"screenshot-verified" earlier missed it because the verified examples lean
on sprites/tiles/text, not the BMP verbs - the READ ME example is the one
place plain shapes carry the whole frame. Screenshot gates catch what
render-health heuristics don't.

Publish kit added: LICENSE (MIT), package.json description/keywords/repo/
files (tarball 141.7kB/55 files - the files field keeps 11MB of build_out
out)/exports map (deep paths incl. audio-assets.mjs, md-sdk/*, docs/*,
examples/*, coverage/ledger.json - what the web IDE stages), README
screenshots (docs/img/hello.png + starfall.png, gpgx captures), examples
table refreshed (13), test/build.test.js (5 end-to-end WASM-toolchain
gates: ROM shape ($100 SEGA + $18E checksum + 128KB padding), DETERMINISM
(byte-identical rebuild), assets, music bank bytes present in ROM,
callbacks through the real linker), .github/workflows/ci.yml (fresh-
checkout tests + all 13 examples + gen-sgdk-builtins regen-sync gate).
61 tests. Remaining for publish: monteslu creates the remote + npm publish.

### The starfall port was WRONG two ways + the aspect-ratio audit
"that space game looks like shit" - correct, and the root causes matter for
every future cross-SDK port:
1. **Sprite-cell conventions DIFFER across the family**: gbalua spr(n)
   indexes 16x16 cells; mdlua spr(n) indexes 8x8 cells (the P8 contract).
   The "verbatim" port kept gbalua's indices, so spr(1,...,2,2) drew the
   right half of the SHIP + left half of the INVADER as every enemy. Fixed:
   ship=spr(0), invader=spr(2), burst=spr(4) (now actually used on kills),
   shot=spr(6) (the green diamond; bullets had been drawing a corner of the
   invader). LESSON for ports + the lua-c retro: sprite indices MUST be
   remapped per-SDK; "verbatim" only holds for code, not asset indices.
2. **GBA geometry on a Genesis screen**: 240x160 coordinates (px<=220, lose
   row y=120) huddled everything top-left of 320x224. Retargeted the whole
   cart to full-screen Genesis geometry.
3. **camera() semantics diverge**: gbalua's camera scrolls the background
   only; mdlua's is P8-correct (offsets sprites AND the plane), so the
   port's camera(0,-scrolly/2) slowly pushed every sprite offscreen.
   mdlua-native idiom: VDP_setVerticalScroll(1, n) to scroll just BG_B.
4. **Genesis displays 4:3, not 10:7** (H40 pixels are narrower than square).
   Fixed the default EVERYWHERE: mdlua run presents a 4:3 rect (nearest,
   height-integer multiple; --square for 1:1 pixel inspection), README
   screenshots render at 640x480, web-IDE plan default flipped to 4:3.

### Aspect-ratio: REVERSED to native 320x224 square pixels (consistency)
The "Genesis displays 4:3" change above was overreach - chasing the CRT's
4:3 stretch meant NON-INTEGER scaling (320->426px), which distorts the pixel
art and is inconsistent with "native resolution". CORRECTED everywhere to the
single honest model: NATIVE 320x224 (H40/NTSC - md_init sets
VDP_setScreenWidth320, height 224), SQUARE pixels, INTEGER scaling for the
window + screenshots. `mdlua run` = 320x224 x3 (960x672), nearest-neighbor,
largest-whole-multiple-that-fits; --square flag removed (redundant). README
shots are native 320x224 x3. The web IDE canvas is aspect-ratio 320/224
square-pixel. VERIFIED numbers: BMP engine is 256x160 (BMP_WIDTH=1<<(5+3)=256,
BMP_HEIGHT=20*8=160), centered in the 320x224 screen; sprites+tiles get the
full 320x224.
