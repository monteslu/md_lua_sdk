-- GEM DASH - a little platformer for the Genesis, in mdlua.
-- Run with the d-pad, jump with O (Genesis B). Collect the gems and reach the
-- flag. Uses: a hardware tile level on plane B (scrolled by camera(), never
-- rewritten per frame - hardware scroll is free), real tile collision via
-- tget(), animated hardware sprites, a window-plane HUD, parallax cloud
-- sprites, and palette fades on win / respawn.
--
-- build: mdlua build examples/platformer/main.lua \
--          --sheet examples/platformer/sprites.png --map examples/platformer/level.png
--
-- Sheet cells are 8x8, row-major (14 across on the 112x16 sheet); every actor
-- is 2x2 cells (16x16): idle=spr(0), runA=spr(2), runB=spr(4), jump=spr(6),
-- gem=spr(8), flag=spr(10), cloud=spr(12).
--
-- The level (plane B) is a 64x32-cell plane. Sky is the transparent tile (0),
-- so a solid cell is simply tget(0,col,row) ~= 0. Solid tiles were painted by
-- generate-art.mjs; this file reads them back for collision, so the art and
-- the physics can never drift apart.

-- ---- tuning (all per-frame; numbers are 16.16 fixed point) ------------------
local RUN_ACC = 0.5       -- horizontal acceleration
local RUN_MAX = 2.5       -- top run speed
local FRICTION = 0.6      -- ground slowdown when no input
local GRAVITY = 0.35      -- downward pull per frame
local JUMP_VEL = -6.2     -- launch velocity (up is negative)
local MAX_FALL = 6.0      -- terminal fall (stay < 8 = one tile, no tunnelling)
local WORLD_W = 512       -- level width in px (64 cells)

-- ---- state (top-level locals must init to constant numbers) -----------------
local px = 24.0           -- player world x (top-left of the 16x16 sprite)
local py = 176.0          -- player world y
local vx = 0.0
local vy = 0.0
local grounded = 0        -- 1 while feet rest on a solid tile
local facing = 0          -- 0 = right, 1 = left
local camx = 0            -- camera world x (clamped 0..WORLD_W-320)

local score = 0
local state = 0           -- 0 = play, 1 = won
local fadet = 30          -- fade-in / respawn fade counter (counts down)

-- gems: world positions + collected flag
local gx = array(6)
local gy = array(6)
local ga = array8(6)

-- the goal flag, standing on the raised final stretch
local flagx = 480
local flagy = 160

-- ---- tile collision --------------------------------------------------------
-- A cell is solid when the map tile there is not the transparent sky tile
-- (tget returns the plane-B tile id; sky was painted as the transparent tile
-- 0 by generate-art.mjs). Off-plane cells count as empty, so a missed jump
-- drops through into a pit. box_hits() returns 0/1: is any solid tile inside
-- the 16x16 box at world (bx,by)?
function box_hits(bx, by)
  local c0 = flr(bx) \ 8
  local c1 = (flr(bx) + 15) \ 8
  local r0 = flr(by) \ 8
  local r1 = (flr(by) + 15) \ 8
  local c = c0
  while c <= c1 do
    local r = r0
    while r <= r1 do
      if c >= 0 and c <= 63 and r >= 0 and r <= 31 then
        if tget(0, c, r) != 0 then return 1 end
      end
      r += 1
    end
    c += 1
  end
  return 0
end

function _init()
  map_show(0)             -- paint the level on plane B (once)
  hud(3)                  -- top 3 rows = a fixed window-plane HUD strip
  music(0)                -- the built-in FM demo tune

  -- place gems: a couple sit at run height on the ground (grab them just by
  -- running), the rest reward a jump onto a platform.
  gx[1] = 72  gy[1] = 180   -- on the ground, in the opening run
  gx[2] = 100 gy[2] = 148   -- above, over the first platform
  gx[3] = 232 gy[3] = 180   -- ground, just past pit 1
  gx[4] = 264 gy[4] = 132   -- on the platform over pit 2
  gx[5] = 320 gy[5] = 108   -- high reward on the tall platform
  gx[6] = 440 gy[6] = 128   -- near the flag stretch
  for i = 1, 6 do ga[i] = 1 end
end

-- horizontal move with tile collision (resolve on the moving axis only)
function move_x()
  px += vx
  if vx > 0 and box_hits(px, py) != 0 then
    px = (flr(px) \ 8) * 8       -- snap against the wall on the right
    vx = 0.0
  end
  if vx < 0 and box_hits(px, py) != 0 then
    px = ((flr(px) \ 8) + 1) * 8
    vx = 0.0
  end
  if px < 0 then px = 0.0 vx = 0.0 end
  if px > WORLD_W - 16 then px = WORLD_W - 16 vx = 0.0 end
end

-- vertical move with tile collision (sets grounded on a downward hit)
function move_y()
  py += vy
  grounded = 0
  if vy > 0 and box_hits(px, py) != 0 then
    py = (flr(py) \ 8) * 8       -- land: park feet on the tile top
    vy = 0.0
    grounded = 1
  end
  if vy < 0 and box_hits(px, py) != 0 then
    py = ((flr(py) \ 8) + 1) * 8 -- bonk head
    vy = 0.0
  end
end

function respawn()
  px = 24.0 py = 176.0 vx = 0.0 vy = 0.0
  camx = 0
  fadet = 30
end

function _update60()
  -- fade timer runs in both states (fade-in at start, fade-out on win)
  if fadet > 0 then fadet -= 1 end

  if state != 0 then
    fade(mid(0, (30 - fadet) / 30, 1) * 0.6, 1)  -- brighten toward white
    if btnp(4) then run() end
    return
  end

  if fadet > 0 then fade(fadet / 30, 0) end       -- fade up from black

  -- ---- horizontal input + acceleration ----
  local moving = 0
  if btn(0) then vx -= RUN_ACC facing = 1 moving = 1 end
  if btn(1) then vx += RUN_ACC facing = 0 moving = 1 end
  if moving == 0 then
    if vx > FRICTION then vx -= FRICTION
    elseif vx < -FRICTION then vx += FRICTION
    else vx = 0.0 end
  end
  if vx > RUN_MAX then vx = RUN_MAX end
  if vx < -RUN_MAX then vx = -RUN_MAX end
  move_x()

  -- ---- jump + gravity ----
  if btnp(4) and grounded == 1 then vy = JUMP_VEL sfx(0) end
  vy += GRAVITY
  if vy > MAX_FALL then vy = MAX_FALL end
  move_y()

  -- fell into a pit (off the bottom of the screen) -> respawn
  if py > 232 then respawn() end

  -- ---- camera follows the player, clamped to the level ----
  camx = flr(px) - 152
  if camx < 0 then camx = 0 end
  if camx > WORLD_W - 320 then camx = WORLD_W - 320 end
  camera(camx, 0)

  -- ---- gem pickups (AABB in world space) ----
  for i = 1, 6 do
    if ga[i] != 0 then
      local dx = gx[i] - px
      local dy = gy[i] - py
      if dx > -14 and dx < 14 and dy > -14 and dy < 14 then
        ga[i] = 0
        score += 10
        sfx(1)
      end
    end
  end

  -- ---- reach the flag -> win ----
  if flagx - px > -14 and flagx - px < 14 and flagy - py > -20 and flagy - py < 20 then
    state = 1
    fadet = 30
    music(-1)
  end
end

function _draw()
  -- no cls(): the tile level is the background. paint the sky via the backdrop.
  backdrop(12)            -- sky blue behind the transparent map cells

  -- HUD (window plane - never scrolls)
  print("gem dash", 8, 0, 7)
  print("score", 8, 8, 7)
  print(score, 56, 8, 10)

  if state != 0 then
    print("you win!", 130, 90, 11)
    print("score", 128, 106, 7)
    print(score, 176, 106, 10)
    print("press o", 132, 122, 12)
  end

  -- parallax clouds: drawn in SCREEN space (add camx back) at 1/2 camera speed
  local cl = (camx \ 2) % 400
  spr(12, 40 - cl + 400 + camx, 40, 2, 2)
  spr(12, 220 - cl + camx, 60, 2, 2)
  spr(12, 380 - cl + camx, 32, 2, 2)

  -- gems (world space; camera() offsets them for free). a slow vertical bob.
  for i = 1, 6 do
    if ga[i] != 0 then
      spr(8, gx[i], gy[i] + flr(sin(t() + i) * 2), 2, 2)
    end
  end

  -- the goal flag (world space)
  spr(10, flagx, flagy, 2, 2)

  -- the player: pick a frame from state + motion, flip to face travel
  local frame = 0
  if grounded == 0 then
    frame = 6                          -- airborne
  elseif abs(vx) > 0.3 then
    frame = anim(0, 0, 1, 8) * 2 + 2   -- run cycle: cells 2 and 4
  end
  spr(frame, px, py, 2, 2, facing)
end
