# Mega Drive Lua Cheat Sheet

**Write games in Lua for the Sega Mega Drive / Genesis.** You write a
PICO-8-flavored Lua; the SDK compiles it to C, builds it with a bundled 68000
toolchain against an SGDK runtime, and produces a `.bin` ROM that runs in any
Genesis emulator or on a flashcart. No interpreter runs on the console - your
Lua *is* the machine code.

The screen is **320×224**. You fill in three functions, and the Genesis VDP
does the heavy lifting (80 hardware sprites, two scrolling planes, a window
plane, live palette writes, per-scanline raster effects, FM sound).

```
mdlua build main.lua --sheet gfx.png -o game.bin
```

---

## Program structure - the 3 functions

```lua
function _init()     end   -- runs ONCE at startup
function _update60() end   -- your game logic, once per 60 Hz frame
function _draw()     end   -- your drawing, once per frame
```

The console calls `_update60()` then `_draw()` over and over. To move
something, add a little to its position each update - there are no clocks,
just "how much per frame." (`_update()` is accepted for PICO-8 compatibility
and currently also runs once per frame.)

```lua
local x = 0
function _update60()
  x += 2
  if x > 319 then x = 0 end
end
function _draw()
  cls(1)                       -- clear to dark blue
  spr(0, x, 104, 2, 2)         -- a 16x16 sprite sliding across
end
```

---

## The screen: two ways to draw

- **Sprites + tile planes** - the real game path, full 320×224. `spr()` is a
  hardware sprite; `map_show()`/`camera()` scroll a hardware tile plane for
  free. Text rides plane A.
- **Bitmap verbs** - immediate `pset`/`rect`/`circ`/`line` to a software
  framebuffer (the SGDK BMP engine). Simple, great for a first cart - but it
  is **256×160**, costs **~41 KB of the 64 KB work RAM**, claims plane A, and
  is lazy: the first shape/pixel call switches it on for good.

Sprites and sound compose over both. If you're making a real game, draw with
sprites and tiles; keep the bitmap verbs for prototypes and effects carts.

---

## Colors and the four palette lines

Colors in draw calls are PICO-8-style indices `0-15`: `0` black, `1`
dark-blue, `2` dark-purple, `3` dark-green, `4` brown, `5` dark-grey, `6`
light-grey, `7` white, `8` red, `9` orange, `10` yellow, `11` green, `12`
blue, `13` indigo, `14` pink, `15` peach.

The VDP has 64 palette entries (CRAM) in four lines of 16, from a 512-color
master palette - and CRAM is **writable live**, which is what makes `pal()`
real here:

| line | owner |
|---|---|
| PAL0 | the 16 PICO-8 colors - `pal()` remaps these at runtime |
| PAL1 | the `--sheet` palette; sprites default to this line |
| PAL2 | the `--map` palette (`map_show`) |
| PAL3 idx 15 | the `print` color cache (one non-white text color per frame) |

All palette writes go through a shadow that flushes as one DMA at end of
frame (mid-frame CRAM writes race the VDP - the runtime handles it).

---

## Bitmap drawing

| Call | What |
|---|---|
| `cls([c])` | clear the screen to color `c` (also resets the print cursor) |
| `pset(x,y,[c])` | set one pixel |
| `pget(x,y)` | read a pixel back (0 if the bitmap engine is off) |
| `rect(x0,y0,x1,y1,[c])` / `rectfill(...)` | outline / filled rectangle (inclusive corners) |
| `circ(x,y,r,[c])` / `circfill(...)` | outline / filled circle |
| `line(x0,y0,x1,y1,[c])` | a line |
| `color(c)` | set the default draw color |
| `clip(x,y,w,h)` | bound bitmap draws to a rectangle; `clip()` (no args) resets |

All of these live in the 256×160 bitmap (see above). `camera()` does **not**
offset them - it drives the hardware sprite/plane scroll instead.

---

## Text

| Call | What |
|---|---|
| `print(v,x,y,[c])` | draw a string or number at (x,y) |
| `print(v,[c])` | cursor form: print at the cursor, advance one row |

- Text renders on the **8px tile grid** (40×28 cells) - `x,y` snap to
  multiples of 8.
- **Two simultaneous colors**: white (7) is always available, plus **one**
  cached color per frame - the last non-white color you print with wins for
  all non-white text that frame.
- With `hud(rows)` active, text whose row falls inside the strip lands on the
  window plane automatically (a rock-solid unscrolled status bar).
- In bitmap mode, `print` uses the BMP font and ignores the color argument.
- There is **no runtime string concatenation** - print a label and a value as
  two calls: `print("score",8,8,7) print(n,56,8,10)`.

---

## Sprites (hardware)

The VDP composites up to **80 hardware sprites** per frame - each `spr()` is
queued into a per-frame display list, not CPU-blitted.

| Call | What |
|---|---|
| `spr(n,x,y,[w,h],[fx,fy])` | draw sheet cell `n`; `w,h` in 8px cells (1-4); flips are free |
| `spr8(t,x,y,[flip])` | an 8×8 sprite from a raw tile index (bullets, pickups) |
| `spr_pal(line)` | palette line (0-3) for subsequent sprites; default 1 (the sheet line) |
| `spr_prio(p)` | 1 = in front of high-priority plane tiles (default), 0 = behind |
| `sspr(sx,sy,sw,sh,dx,dy,[dw,dh],[fx,fy])` | sheet-rectangle blit - **unscaled** (see below) |

- `n` counts 8×8 cells across the sheet PNG, row-major. A multi-cell `spr()`
  composes `w*h` 1×1 hardware sprites (each costs part of the 80 budget).
- Hardware limit: **20 sprites per scanline** - stack more on one line and
  the VDP drops the extras.
- The Genesis has **no sprite scaling/rotation hardware**. `sspr` draws the
  source rectangle (rounded to whole cells) at 1:1; `dw`/`dh` are accepted
  but ignored today. The plan of record is pre-scaled frames at import time.
- `camera(x,y)` offsets all sprites (and scrolls the map plane) - hardware
  scrolling, no per-object math.

---

## Tile plane (plane B) - the scrolling background

The tilemap data comes from the build (`--map level.png`); the Lua game just
shows and scrolls it.

| Call | What |
|---|---|
| `map_show([layer])` | display the bundled `--map` tilemap on plane B (call once in `_init`) |
| `camera(x,y)` | scroll the plane + all sprites together |
| `tget(layer,col,row)` | read a map cell (the shown 64×32 plane area) |
| `tset(layer,col,row,tile)` | change a tile at runtime (breakable blocks, doors) |
| `layer_scroll(layer,x,y)` | scroll one plane directly: `1` = plane A (text); plane B (`0`) is owned by `camera()`/`hscroll()` |
| `layer_show(l,on)` / `layer_pri(l,p)` | accepted for cross-SDK parity; no-ops today |

`layer` is accepted for cross-SDK parity - there is one asset map today, on
plane B. `tget`/`tset` track the plane area (up to 64×32 cells).

**PICO-8-style in-source maps** also work: declare the map as a hex blob and
`map()`/`mget()` use it (128 cells wide, like the PICO-8 map):

```lua
local __p8map = hexdata("0102030401020304")
function _draw()
  map(0, 0, 0, 32, 8, 1)   -- stamp cells onto plane B (0 clears a cell)
  print(mget(2, 0), 8, 8, 7)
end
```

`map(cx,cy,sx,sy,cw,ch)` defaults to the full map; `sx,sy` snap to the tile
grid. Non-zero cells draw the matching **sheet** tile.

---

## The Genesis power verbs

### Live palette - `pal()` is real

| Call | What |
|---|---|
| `pal(c0,c1)` | remap PICO-8 color `c0` to `c1`'s RGB **in CRAM** - everything on screen in `c0` changes this frame |
| `pal()` | reset all 16 |
| `fade(amount,[to_white])` | scale **all 64 CRAM entries** toward black (or white); `0..1`; `fade(0)` restores exactly |
| `backdrop(c)` | the border/backdrop CRAM entry (0-63; 0-15 = the PICO-8 line) |
| `screen_off()` / `screen_on()` | blank / unblank the display instantly (hide a mid-frame rebuild) |

This is a **screen** palette remap (one shared line) - it recolors what is
already drawn as well as what you draw next. Palette cycling is a per-frame
`pal()` loop; day/night is one call.

### Raster - per-scanline scroll

| Call | What |
|---|---|
| `hscroll(line,x)` | set plane B's horizontal scroll **for one scanline** (0-223) |

The Genesis signature effect: wavy water, heat shimmer, split-screen
parallax, logo warps. Write any lines you like each frame; the whole
224-entry table uploads as one DMA. First use switches the VDP to per-line
scroll mode (from then on the table, not `camera()` x, drives plane B).

```lua
local ti = 0
function _update60()
  ti += 1
  for line = 0, 223 do
    hscroll(line, flr(sin(ti / 128 + line / 32) * 6))
  end
end
```

### HUD - the window plane

| Call | What |
|---|---|
| `hud(rows)` | claim the top `rows` tile rows (0-27) as a fixed, unscrolled HUD strip; `hud(0)` releases |

The VDP's third plane. The strip never scrolls no matter what the camera and
raster do, and `print` lands in it automatically when the text row is inside.
The classic Genesis status bar.

### Shadow / highlight

| Call | What |
|---|---|
| `shade_mode(on)` | the VDP's shadow/highlight mode - the honest Genesis "blend" (3 brightness levels) |

Low-priority plane pixels render shadowed; sprite palette PAL3 colors 14/15
act as highlight/shadow operators over what's beneath.

---

## Animation helpers

Turn a first..last frame range + an fps into "which frame now." `slot` is a
per-actor id (0-31); feed the result to `spr()`/`spr8()`.

| Call | What |
|---|---|
| `anim(slot,first,last,fps)` | looping cycle |
| `anim_once(slot,first,last,fps)` | play once, hold last; `anim_done(slot)` goes true |
| `anim_pingpong(slot,first,last,fps)` | bounce first..last..first |
| `anim_reset(slot)` | restart a slot (re-arm a once-anim) |

`spr(anim(0, 0, 3, 10), x, y, 2, 2)` - a 4-frame walk at 10 fps, timed off
the frame clock (frame-rate independent of your update structure).

---

## Input

```
        [2]↑            4 = B  (PICO-8 O)      6 = A          8-11 = X Y Z MODE
    [←]0    1[→]        5 = C  (PICO-8 X)      7 = START      (6-button pad)
        [3]↓
```

| Call | What |
|---|---|
| `btn(i,[pl])` | is button `i` held? |
| `btnp(i,[pl])` | just-pressed this frame |

**Two players are real**: `pl` 0 (default) or 1 reads the second pad -
`btn(4, 1)` is player 2's B button.

---

## Math

| Call | What |
|---|---|
| `flr ceil abs sgn(x)` | rounding / sign (`flr` toward −∞, `sgn(0)==1`) |
| `min max(x,y)` · `mid(x,y,z)` | min / max / median |
| `sqrt(x)` | square root |
| `sin(x) cos(x)` | turns-based (0..1), PICO-8 screen-inverted sin |
| `atan2(dx,dy)` | angle in turns |
| `rnd([x])` · `srand(x)` | random; `flr(rnd(n))` is exact; `rnd({a,b,c})` picks from a constant list |
| `t()` / `time()` | elapsed seconds (16.16), advanced once per frame |
| `band bor bxor bnot shl shr lshr` | bit ops (also `& \| ^^ ~ << >> >>>`) |

Numbers are **16.16 fixed point**: range ±32767, overflow wraps, `/0`
saturates. The compiler keeps values that stay integral in fast 32-bit ints -
an optimization, never a semantic change.

---

## Data

| Call | What |
|---|---|
| `array(n,[v])` | fixed array of `n` 16.16 numbers, **1-indexed** (`a[1]` is first) |
| `array8(n,[v])` | fixed array of `n` bytes (0-255) - half the RAM, faster |
| `pool(n)` | a capacity-bounded pool of structs, for entities |
| `add(pool,{...})` / `del(pool,e)` | add / remove (delete-while-iterating ok) |
| `hexdata("A1B2...")` | a compile-time byte blob; name it `__p8map` to feed `map()`/`mget()` |

```lua
local shots = pool(8)
function _update60()
  if btnp(4) then add(shots, {x=160, y=200}) end
  for s in all(shots) do
    s.y -= 4
    if s.y < 0 then del(shots, s) end
  end
end
```

Tables are **structs** - fixed named fields (`{x=1,y=2}`). No `{1,2,3}` array
tables, no `{[k]=v}` maps, no nil, no closures/metatables/coroutines; each is
one clear compile error with the fix.

---

## Save (battery SRAM)

| Call | What |
|---|---|
| `save(slot,array8,n)` | write `n` bytes (max 254) of an array8 to a 256-byte SRAM slot |
| `load(slot,array8,n)` | read them back; returns the count read, or `0` if the slot was never saved |

load() returns `0` for a never-written slot (it stamps a magic byte + length on
save, so you don't have to), which makes first-run defaults easy:

```lua
local hi = 0
local st = array8(8)
function _init()
  load(0, st, 8)
  if st[1] == 42 then hi = st[2] + st[3]*256 end
end
function save_hi()
  st[1] = 42
  st[2] = hi % 256
  st[3] = (hi \ 256) % 256
  save(0, st, 8)
end
```

---

## Time & misc

| Call | What |
|---|---|
| `t()` / `time()` | seconds since boot (16.16), advanced each frame |
| `realframes()` | frames since boot - drive effects off it |
| `realsecs()` | seconds since boot as `realframes()/60` (16.16) |
| `run()` / `reset()` | restart the cart from power-on (full hardware reset) |

---

## Sound

| Call | What |
|---|---|
| `music(n,[loop])` | play song `n` from the `--music` bank (YM2612 FM + PSG, driven by the Z80 XGM2 driver). `music(-1)` stops. `loop` defaults ON; `music(n,false)` plays once |
| `sfx(n,[ch])` | play PCM sample `n` from the `--sfx` bank; `ch` picks XGM2 PCM channel 2-4 (default 3) |

- `--music a.vgm,b.vgm` builds the song bank - bank order is the `music(n)`
  index. `.vgm` comes from any Mega Drive tracker (DefleMask, Furnace:
  export VGM); gzipped `.vgz` and precompiled `.xgc` are accepted too. The
  VGM -> XGM2 conversion is byte-identical to SGDK's own xgm2tool.
- With no `--music` bank, `music(n)` plays the SDK's built-in demo tune, so
  sound works before assets exist.
- `--sfx a.wav,b.wav` builds the sample bank: converted to 8-bit signed
  13.3 kHz, 256-byte aligned (the XGM2 contract). Music and SFX share the
  driver and play TOGETHER (PCM channel 1 is left for music; sfx defaults
  to channel 3).
- With no `--sfx` bank, `sfx(n)` falls back to a PSG blip pitched by `n`.

```lua
function _init() music(0) end          -- looped
function _update60()
  if btnp(4) then sfx(0) end            -- over the music
  if btnp(5) then music(1, false) end   -- next song, play once
  if btnp(7) then music(-1) end         -- stop
end
```

### Raw PCM - SGDK's `SND_PCM` driver

Distinct from the XGM2 path above. `SND_PCM` is SGDK's standalone single-channel
PCM player. It and XGM2 both own the Z80, so **pick one per cart** - use these
verbs *instead of* `sfx`/`music`, not alongside.

| Call | What |
|---|---|
| `pcm_play(n,[rate],[loop])` | load the driver (once) + play `--sfx` blob `n`. `rate` is a `SoundPcmSampleRate` (3 = 13.4 kHz, matches the bank); `loop` is a flag |
| `pcm_driver()` | load the Z80 PCM driver once (call before raw `SND_PCM_*`) |
| `pcm_sample(n)` / `pcm_len(n)` | ROM pointer + byte length of `--sfx` blob `n` |

```lua
function _init()
  pcm_driver()
  pcm_play(0, 3, false)   -- convenience: blob 0, 13.4 kHz, no loop
end
function _update60()
  if btnp(4) then
    -- or drive SGDK's function directly (sample, len, rate, pan, loop):
    SND_PCM_startPlay(pcm_sample(0), pcm_len(0), 3, 128, false)
  end
end
```

## Coroutines - SGDK user tasks (`task.h`)

SGDK runs one **user task** alongside the main loop. The supervisor (your main
loop) hands it a time-slice with `TSK_userYield()`; the task runs until the next
VBlank pre-empts it. Register a plain top-level Lua function as the task - any
SGDK callback param takes a bare function name (its address is passed).

```lua
local shared = array(2)     -- MUST be memory-backed (see the trap below)

function bg_task()
  while true do             -- runs each slice, pre-empted by VBlank
    shared[0] = shared[0] + 1
  end
end

function _init()
  TSK_init()
  TSK_userSet(bg_task)      -- hand SGDK your Lua function
end
function _update60()
  TSK_userYield()           -- supervisor gives the task this frame's slice
end
```

- **The user task must NOT call `TSK_userYield()`** - that is a supervisor-only
  call (doing it from the task is a privilege violation). The task just runs and
  gets pre-empted; the supervisor yields to it.
- **A value the task mutates and the main loop reads must be memory-backed** (an
  `array`), not a scalar local - a tight-loop scalar can sit in a register the
  context switch saves but `_draw()` never sees flushed to RAM.
- The same bare-function-name form works for every SGDK callback:
  `SYS_setVIntCallback(on_vblank)`, sprite frame hooks, etc.

---

## Assets & building

```sh
mdlua build main.lua \
  --sheet sprites.png   \  # sprite art (PNG -> VDP tiles + palette line 1)
  --map level.png       \  # a tilemap (deduped tiles + palette line 2)
  --sfx laser.wav,boom.wav \  # PCM sample bank (sfx(n) = list order)
  --music intro.vgm,level.vgm \  # XGM2 song bank (music(n) = list order)
  -o game.bin              # output ROM (padded + checksummed)
```

- PNGs can be indexed, RGB, RGBA, or grayscale - dimensions in multiples of
  8, up to 15 opaque colors (pixels with alpha < 128 read as color 0,
  transparent).
- `mdlua run main.lua` (or `game.bin`) builds and opens an emulator window
  (Genesis Plus GX, 3× scale; needs the optional `@kmamal/sdl`). Keys: arrows
  = d-pad, `Z`/`X`/`C` = A/B/C, Enter = START. `run` takes `--sheet`/`--map`.
- `mdlua c main.lua` prints the generated C for debugging.
- The `.bin` gets the header checksum strict loaders demand - it runs in any
  Genesis emulator and on flashcarts.

---

## The machine at a glance

| | |
|---|---|
| CPU | Motorola 68000 @ 7.67 MHz (+ a Z80 @ 3.58 MHz running the sound driver) |
| RAM | 64 KB work RAM (+ 64 KB VRAM, 8 KB Z80 RAM) |
| Video | VDP: 320×224, two scrolling planes + a window plane |
| Sprites | 80 per frame, 20 per scanline, cells 8×8 (spr composes up to 4×4) |
| Colors | 64 CRAM entries (4 lines × 16) from 512, live-writable |
| Sound | YM2612 6-ch FM + SN76489 4-ch PSG, XGM2 driver on the Z80 |
| Cartridge | flat ROM up to 4 MB, battery SRAM saves |
| Numbers | 16.16 fixed point |

---

## Not-Lua walls (loud, never silent)

Conditions must be boolean (`if x ~= 0 then`, not `if x then`). No nil,
closures, metatables, coroutines, string concatenation, `{1,2,3}`/`{[k]=v}`
tables, or `goto`. Every unsupported feature is a compile-time error that
names what to write instead.
