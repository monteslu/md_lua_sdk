# Mega Drive Lua Cheat Sheet - for PICO-8 users

**PICO-8-flavored Lua that compiles to native 68000** for the Sega Mega Drive
/ Genesis. No interpreter, no VM - your Lua becomes machine code. Familiar
verbs (`spr`/`btn`/`_init`/`_update`/`_draw`, 16.16 numbers, the dialect), on
hardware with a lot more room: **80 hardware sprites, two scrolling planes +
a window plane, LIVE `pal()` (real palette RAM), per-scanline raster scroll,
YM2612 FM music, battery saves, and a real second controller.** Measured
against PICO-8 v0.2.7.

Build: `mdlua build main.lua --sheet gfx.png -o game.bin`

> **New to PICO-8?** This page maps the SDK *against* PICO-8. If you don't
> already know PICO-8, read [`CHEATSHEET.md`](CHEATSHEET.md) - the full
> reference with no PICO-8 assumed.

**Status legend**

| Badge | Meaning |
|---|---|
| ✅ **exact** | works, PICO-8 semantics |
| 🟡 **partial** | works with documented limits |
| 🔷 **differs** | works but different by hardware |
| ❌ **n/a** | no VM to emulate / intentionally cut |
| ➕ **MD extra** | beyond PICO-8, uses Genesis hardware |

Names are **global and unprefixed**, exactly like PICO-8. There is no `md.*`
escape-hatch namespace - the extras are first-class verbs.

---

## Three things that differ from PICO-8 up front

1. **The screen is 320×224**, not 128×128. Coordinates and layouts do **not**
   transfer 1:1 - you have ~4.4× the pixels. Center is `(160, 112)`.
2. **Two draw paths.** `spr()`/`map_show()`/`print` ride the VDP (sprites +
   tile planes, full 320×224 - the real game path). The shape/pixel verbs
   (`pset`/`rect`/`circ`/`line`) draw into a **256×160 software bitmap** that
   costs ~41 KB of the 64 KB work RAM and switches on at first use. Fine for
   prototypes; not the scrolling-game path.
3. **`pal()` is REAL.** The Genesis has writable palette RAM (CRAM), so
   `pal(c0,c1)` recolors the live screen this frame - cycling, flashes,
   day/night all work the way carts always wished they did.

---

## Colors

Colors are PICO-8-style indices `0-15` in draw calls, loaded into palette
line 0 of the VDP's 64-entry CRAM (four lines of 16, from a 512-color master
palette). `pal(c0,c1)` remaps `c0`'s CRAM slot to `c1`'s RGB at runtime;
`pal()` resets all 16. Your `--sheet` art brings its own 16-color line
(line 1), the `--map` art line 2.

---

## Controller → `btn()` index

```
        [2]↑            4 = B  (PICO-8 O)      6 = A          8-11 = X Y Z MODE
    [←]0    1[→]        5 = C  (PICO-8 X)      7 = START      (6-button pad)
        [3]↓
```

`btn(i,[pl])` held · `btnp(i,[pl])` just-pressed. The d-pad indices match
PICO-8 (0=LEFT 1=RIGHT 2=UP 3=DOWN); the PICO-8 O/X buttons land on the
Genesis B/C. **The `pl` argument is real here**: `btn(4, 1)` reads player 2's
pad - the Genesis is a two-controller machine.

---

## Program structure

| Call | | Notes |
|---|:--:|---|
| `_init()` | ✅ | runs once at startup |
| `_update60()` | ✅ | logic @ 60 fps - the native rate |
| `_update()` | 🟡 | accepted; currently also runs once per 60 Hz frame |
| `_draw()` | ✅ | 1× per frame |

Same fixed-timestep model as PICO-8 (no `dt`; move by a constant per frame).
The 68000 holds 60 fps on the sprite/tile path - **`_update60()` is the
default here.**

## Dialect & syntax

| Feature | | Notes |
|---|:--:|---|
| `a \ b` | ✅ | floored integer divide |
| `//` | ✅ | a line comment |
| `a != b` | ✅ | alias of `~=` |
| `if (c) stmt else stmt` | ✅ | one-line if / while, parens required |
| `+= -= *= \= %=` | ✅ | LHS evaluated once |
| `x,y = 64,32` | ✅ | multiple assignment (swap-safe) |
| `for i=1,10,2` | ✅ | fractional & negative steps ok |
| `[[ long string ]]` | ✅ | multi-line string |

## Number model

Full **16.16 fixed point**, PICO-8 edge cases and all.

| | | Notes |
|---|:--:|---|
| range | ✅ | −32768.0 … 32767.99998 |
| overflow | ✅ | wraps (two's complement) |
| `a / 0` | ✅ | saturates |
| `sin(.25) == -1` | ✅ | turns-based, screen-inverted |
| `sgn(0) == 1` · `flr` toward −∞ | ✅ | |
| `>>` / `>>>` | ✅ | arithmetic / logical shift |

The compiler keeps values that stay integral in fast 32-bit ints - an
optimization, never a semantic change.

## Graphics & draw (the bitmap verbs)

| Call | | Notes |
|---|:--:|---|
| `cls([c])` | ✅ | clears; also sets the backdrop color |
| `rectfill / rect(x0,y0,x1,y1,c)` | 🟡 | inclusive corners (P8 gotcha kept); 256×160 bitmap |
| `circfill / circ(x,y,r,c)` | 🟡 | 256×160 bitmap |
| `line(x0,y0,x1,y1,c)` | 🟡 | 256×160 bitmap |
| `pset(x,y,[c])` / `pget(x,y)` | 🟡 | 256×160 bitmap |
| `clip(x,y,w,h)` | 🟡 | bitmap verbs only; `clip()` resets |
| `color(c)` | ✅ | |
| `camera([x,y])` | 🔷 | **hardware scroll**: moves sprites + the map plane, not bitmap shapes |
| `pal(c0,c1)` / `pal()` | 🟡🔷 | **live CRAM remap** - recolors the screen, not a draw-palette; no `palt` |
| `sspr(...)` | 🟡 | unscaled cell-rounded blit; `dw`/`dh` ignored (no scaling hardware; pre-scaled import is the plan) |
| `sset sget fillp tline palt` | ❌ | not implemented |

The shape verbs share one honest limit: they live in the SGDK BMP engine's
**256×160** framebuffer (lazy-initialized, ~41 KB RAM, claims plane A). The
sprite/tile path below is the full-screen, full-speed path.

## Sprites

| Call | | Notes |
|---|:--:|---|
| `spr(n,x,y,[w,h],[fx,fy])` | ✅🔷 | a **hardware sprite** (80/frame budget, 20/scanline); flips free |
| `spr8(t,x,y,[flip])` | ➕ | 8×8 sprite from a raw tile index |
| `spr_pal(line)` · `spr_prio(p)` | ➕ | palette line (0-3) / priority vs plane tiles |

`n` counts 8×8 cells across your sheet PNG, row-major. Multi-cell sprites
compose from 1×1 hardware sprites, so any `w,h` 1-4 works and flips mirror
the whole grid. No rotation/scaling - the Genesis has no sprite affine
hardware (that's the GBA sibling's trick).

## Input

| Call | | Notes |
|---|:--:|---|
| `btn(i,[pl])` | ✅➕ | held; adds A/START at 6-7, X/Y/Z/MODE at 8-11 |
| `btnp(i,[pl])` | 🟡 | just-pressed this frame (no PICO-8 hold auto-repeat) |
| 2 players | ➕ | `pl` = 0 or 1 - a real second pad |

## Math

| Call | | Notes |
|---|:--:|---|
| `flr ceil abs sgn sqrt(x)` | ✅ | |
| `min max(x,y)` · `mid(x,y,z)` | ✅ | |
| `sin cos(x)` · `atan2(dx,dy)` | ✅ | turns-based |
| `rnd(x)` · `srand(x)` | ✅ | `flr(rnd(n))` exact; `rnd({a,b,c})` picks from a constant list |
| `t()` · `time()` | ✅ | fixed seconds |
| bitwise `& \| ^^ << >>` | ✅ | as operators or `band`/`bor`/... |

## Tables & entities

| Call | | Notes |
|---|:--:|---|
| `ps = pool(16)` | 🟡 | capacity-bounded (no unbounded growth / GC) |
| `add(ps,{x=1,y=2})` · `del(ps,e)` | ✅ | |
| `for e in all(ps) do` | ✅ | insertion order |
| `array(n)` / `array8(n)` | 🟡➕ | fixed 16.16 / byte arrays - **1-indexed** (`a[1]` first) |
| `{x=1, y=2}` (struct) | ✅ | tables are structs: fixed named fields |
| `{1,2,3}` / `{[k]=v}` | ❌ | array / map tables - one clear error, no cascade |

**Tables are structs, not arrays or maps** - a fixed set of named fields. Use
`array(n)`/`array8(n)` for indexed numeric data and a `pool` of structs for
entities. **Cut:** nil / `x or default`, closures, metatables, coroutines.
Named functions + a `kind` field + `if/elseif` state machines instead; the
compiler errors loudly with the fix.

## Audio

| Call | | Notes |
|---|:--:|---|
| `music(n,[loop])` | 🟡🔷 | **YM2612 FM** via the XGM2 driver on the Z80 - real FM, not P8 SFX bytes; one bundled track today (`n`/`loop` reserved) |
| `sfx(n,[ch])` | 🟡 | PCM sample from the `--sfx` bank (8-bit 13.3 kHz, XGM2 channels 2-4); PSG blip fallback with no bank |

Build the sample bank with `--sfx laser.wav,boom.wav`. Music and SFX share
the Z80 driver, like every commercial Genesis game did.

## Strings & print

| Call | | Notes |
|---|:--:|---|
| `print(str,x,y,[c])` | 🟡 | positioned text - snaps to the 8px tile grid (40×28) |
| `print(val,x,y,[c])` | ✅ | numbers print directly |
| `print(v,[c])` | ✅ | cursor form: prints and advances a row |
| `s = "hello"` | ✅ | string literals (short and `[[ long ]]`) |
| `s .. s2` | ❌ | **no runtime string concat** - print label and value separately |
| `sub tostr tonum chr ord split` | ❌ | no runtime string building |

**Text colors**: white is always available plus **one** cached color per
frame (the last non-white color wins for all non-white text that frame). Text
color rides a shared CRAM slot - a Genesis hardware trade, documented, not a
bug you'll chase.

## Map / tiles

| Call | | Notes |
|---|:--:|---|
| `map(cx,cy,sx,sy,cw,ch)` | 🔷 | stamps cells onto **plane B** (hardware tiles, not blits) from an in-source `hexdata` map |
| `mget(x,y)` | ✅ | read the in-source map (128 cells wide, like P8) |
| `mset` | ❌ | use `tset` on the asset map |
| `map_show(layer)` | ➕ | show the bundled `--map` tilemap on plane B (hardware scroll) |
| `tget(l,col,row)` / `tset(l,col,row,t)` | ➕ | read / rewrite live plane cells (64×32 area) |
| `layer_scroll(1,x,y)` | ➕ | scroll plane A directly; plane B belongs to `camera()`/`hscroll()` |

Declare a PICO-8-style map right in the source: `local __p8map =
hexdata("0102...")`. The real scrolling path is `map_show(0)` + `camera()` -
the plane scrolls in hardware, for free.

## Cartridge data / save

| Call | | Notes |
|---|:--:|---|
| `save(slot, array8, n)` | ➕ | write up to 256 bytes to **battery SRAM** (256-byte slots) |
| `load(slot, array8, n)` | ➕ | read back; returns count read, or 0 for a never-saved slot (magic byte handled for you) |
| `cartdata dset dget` | ❌ | `save`/`load` are the replacement |

## Memory / low-level - n/a by design

| Call | | Notes |
|---|:--:|---|
| `peek / poke(addr,[v])` | ❌ | PICO-8's flat-memory pokes |
| `memcpy memset cstore` · `stat(x)` · `menuitem` | ❌ | no VM to poke |
| `flip()` `_update_buttons()` `extcmd` | ❌ | the harness owns the frame |

---

## What the Genesis adds beyond PICO-8

| Verb(s) | Notes |
|---|---|
| `pal(c0,c1)` / `pal()` | **live palette RAM** - the verb PICO-8 carts fake with dithering; here it recolors the screen mid-game, one call |
| `hscroll(line,x)` | **per-scanline horizontal scroll** of the map plane - wavy water, heat shimmer, split parallax; THE Genesis raster signature |
| `hud(rows)` | the VDP **window plane** as an unscrollable top HUD strip; `print` routes into it automatically |
| `shade_mode(on)` | VDP shadow/highlight - the honest 3-level Genesis "blend" |
| `fade(amount,[to_white])` | whole-screen CRAM fade; `fade(0)` restores exactly |
| `backdrop(c)` · `screen_off()`/`screen_on()` | border/backdrop color · instant force-blank |
| `spr8` · `spr_pal` · `spr_prio` | raw-tile sprites, palette line, plane priority |
| `map_show` · `tget`/`tset` · `layer_scroll` | a hardware tile plane: shown once, scrolled free, rewritable per cell |
| `anim(slot,first,last,fps)` / `anim_once` / `anim_pingpong` / `anim_reset` / `anim_done` | frame-range animation off the frame clock |
| `save(slot,arr8,n)` / `load(...)` | battery SRAM persistence |
| `realframes()` / `realsecs()` | frames / seconds since boot |
| `btn(i, 1)` | **player 2 is real** |
| `hexdata("...")` | compile-time byte blobs (maps, tables) |
| `run()` / `reset()` | full power-on restart |

These exist because native 68000 code has no cycle governor and the VDP does
compositing, scrolling, and palette work in hardware. The constraint moves
from PICO-8's 8192-token cap to **ROM size** (4 MB is a lot of Lua) and the
80-sprite / 20-per-scanline hardware budgets.

---

## The things to unlearn

1. **The screen is 320×224**, not 128×128 - coordinates don't transfer.
2. `spr()` is a **hardware sprite** (80/frame, 20/scanline), not a per-blit
   CPU cost - and there's no rotation/scaling hardware, so no `sspr` stretch.
3. The shape verbs (`pset`/`rect`/`circ`/`line`) live in a **256×160 bitmap**
   that costs ~41 KB RAM - sprites + tiles are the real path.
4. `camera()` moves sprites and the map plane (hardware scroll), **not** the
   bitmap shapes.
5. Text snaps to the **8px tile grid**, and you get white + **one** other
   color per frame.
6. **No runtime string concat** - `"score "..n` doesn't compile; print
   separately.
7. Conditions must be boolean - `if (n)` on a number is an error (PICO-8
   calls 0 truthy, we won't guess).
8. No nil, so `x = x or default` is gone; tables are capacity-bounded
   structs; no closures / metatables / coroutines.
9. `music()` is **FM synthesis** (YM2612 through the Z80), not PICO-8 SFX
   bytes - and `sfx()` plays PCM samples from your `--sfx` bank.

---

## Hello, Genesis

```lua
local angle = 0
local radius = 60

function _update60()
  angle += 0.008
  if (btn(0)) radius -= 1
  if (btn(1)) radius += 1
  radius = mid(10, radius, 70)
end

function _draw()
  cls(1)
  circfill(128, 80, 12, 9)         -- center of the 256x160 bitmap
  circfill(128 + flr(cos(angle) * radius),
           80 + flr(sin(angle) * radius), 6, 8)
end
```

`mdlua build main.lua -o game.bin` → runs in any Genesis emulator
(`mdlua run main.lua` opens one) and on real hardware via flashcart.

---

*Status reflects the shipped implementation, cross-checked against the
compiler builtins and the SDK runtime. PICO-8 is by Lexaloffle Games; the
Sega Mega Drive / Genesis is Sega hardware. This SDK is an independent
homebrew toolchain.*
