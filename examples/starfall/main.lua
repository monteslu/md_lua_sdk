-- STARFALL — a complete little shmup for the GBA, in gbalua.
-- Move with the d-pad, fire with A. Clear all the invaders to win; don't let one
-- reach the bottom or touch you. Uses: hardware tile starfield (scrolling),
-- hardware sprites (ship/enemies/explosions), 8x8 bullet sprites, maxmod music +
-- sfx, score/lives text, and win/lose states.
--
-- build: gbalua build --target gba examples/starfall/main.lua \
--          --sheet examples/starfall/shmup_sheet.png --map examples/starfall/space_bg.png

-- ---- state -----------------------------------------------------------------
local px = 108        -- player x (screen 240 wide, ship 16 wide)
local py = 130
local pcool = 0       -- fire cooldown

-- bullets (8 max): x, y, active
local bx = array(8)
local by = array(8)
local ba = array8(8)

-- enemies (a 6x2 grid = 12): x, y, alive; the whole formation drifts
local enx = array(12)
local eny = array(12)
local eal = array8(12)
local edir = 1        -- formation drift direction
local edx = 0         -- accumulated formation x offset
local alive = 12

local score = 0
local lives = 3
local state = 0       -- 0 = playing, 1 = win, 2 = lose
local scrolly = 0
local fadet = 0       -- fade-in counter (0..30): screen fades up from black at start
local endt = 0        -- fade-out counter on win/lose

function _init()
  map_show(0)         -- the scrolling star background on BG layer 0
  music(0)            -- start the chiptune
  -- lay out the enemy formation (6 columns x 2 rows)
  for i=1,12 do
    local col = (i-1) % 6
    local row = (i-1) \ 6
    enx[i] = 24 + col*32
    eny[i] = 20 + row*24
    eal[i] = 1
  end
  for i=1,8 do ba[i] = 0 end
end

function fire()
  -- find a free bullet slot
  for i=1,8 do
    if ba[i] == 0 then
      bx[i] = px + 4
      by[i] = py
      ba[i] = 1
      sfx(0)
      return
    end
  end
end

function _update()
  if state != 0 then
    -- win/lose: dim the scene toward black over ~30 frames (cap at 0.7 so the
    -- GAME OVER / YOU WIN text stays readable), then wait for A to restart.
    if endt < 30 then endt += 1 end
    fade((endt / 30) * 0.7)
    if btnp(4) then run() end
    return
  end

  -- fade IN from black over the first 30 frames (a clean hardware transition).
  if fadet < 30 then
    fadet += 1
    fade(1 - fadet / 30)   -- 1.0 (black) -> 0.0 (clear)
  end

  -- scroll the starfield slowly for a sense of motion
  scrolly += 1
  camera(0, -scrolly \ 2)

  -- player movement
  if btn(0) then px -= 3 end
  if btn(1) then px += 3 end
  if px < 4 then px = 4 end
  if px > 220 then px = 220 end

  -- fire
  if pcool > 0 then pcool -= 1 end
  if btn(4) and pcool == 0 then
    fire()
    pcool = 8
  end

  -- move bullets up
  for i=1,8 do
    if ba[i] != 0 then
      by[i] -= 6
      if by[i] < -8 then ba[i] = 0 end
    end
  end

  -- drift the enemy formation side to side, descend at the edges
  edx += edir
  if edx > 24 then edir = -1 end
  if edx < -24 then edir = 1 end

  -- bullet vs enemy collision + enemy update
  for e=1,12 do
    if eal[e] != 0 then
      local ex = enx[e] + edx
      local ey = eny[e] + (scrolly \ 8)   -- slow descent
      -- lose if an enemy reaches the player's row
      if ey > 120 then
        state = 2
        music(-1)
        return
      end
      -- check each bullet
      for i=1,8 do
        if ba[i] != 0 then
          local dx = bx[i] - ex
          local dy = by[i] - ey
          if dx > -12 and dx < 12 and dy > -12 and dy < 12 then
            eal[e] = 0
            ba[i] = 0
            score += 10
            alive -= 1
            sfx(0)
          end
        end
      end
    end
  end

  if alive <= 0 then
    state = 1
    music(-1)
  end
end

function _draw()
  -- (no cls — the tile starfield IS the background, drawn by hardware)

  if state == 1 then
    print("YOU WIN!", 88, 60, 11)
    print("score", 100, 80, 7)
    print(score, 130, 80, 10)
    print("press A", 96, 100, 12)
    return
  end
  if state == 2 then
    print("GAME OVER", 84, 60, 8)
    print("score", 100, 80, 7)
    print(score, 130, 80, 10)
    print("press A", 96, 100, 12)
    return
  end

  -- HUD
  print("score", 4, 4, 7)
  print(score, 44, 4, 10)
  print("lives", 170, 4, 7)
  print(lives, 210, 4, 8)

  -- the player ship
  spr(0, px, py, 2, 2)

  -- bullets (small 8x8 sprites — tile 8 = a sub-tile; use spr8 for a bullet look)
  for i=1,8 do
    if ba[i] != 0 then spr8(2, bx[i], by[i]) end
  end

  -- enemies
  for e=1,12 do
    if eal[e] != 0 then
      spr(1, enx[e] + edx, eny[e] + (scrolly \ 8), 2, 2)
    end
  end
end
