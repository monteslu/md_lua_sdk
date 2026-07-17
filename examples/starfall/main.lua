-- STARFALL — a complete little shmup for the Genesis, in mdlua.
-- Move with the d-pad, fire with O (Genesis B). Clear all the invaders to
-- win; don't let one reach the bottom. Uses: hardware tile starfield
-- (scrolling plane), hardware sprites (ship/enemies/shots/explosions),
-- XGM2 music + PCM sfx, score/lives text, win/lose states, palette fades.
--
-- build: mdlua build examples/starfall/main.lua \
--          --sheet examples/starfall/shmup_sheet.png --map examples/starfall/space_bg.png
--
-- sheet cells are 8x8, row-major (8 per row on this 64x16 sheet); every
-- actor is 2x2 cells (16x16): ship=spr(0), invader=spr(2), burst=spr(4),
-- shot=spr(6).

-- ---- state -----------------------------------------------------------------
local px = 152        -- player x (screen 320 wide, ship 16 wide)
local py = 194
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

-- one explosion burst (the last kill): position + frames left
local lex = 0
local ley = 0
local let = 0

local score = 0
local lives = 3
local state = 0       -- 0 = playing, 1 = win, 2 = lose
local scrolly = 0
local fadet = 0       -- fade-in counter (0..30): screen fades up from black at start
local endt = 0        -- fade-out counter on win/lose

function _init()
  map_show(0)         -- the scrolling star background on the tile plane
  music(0)            -- start the FM tune
  -- lay out the enemy formation (6 columns x 2 rows)
  for i=1,12 do
    local col = (i-1) % 6
    local row = (i-1) \ 6
    enx[i] = 40 + col*40
    eny[i] = 28 + row*28
    eal[i] = 1
  end
  for i=1,8 do ba[i] = 0 end
end

function fire()
  -- find a free bullet slot
  for i=1,8 do
    if ba[i] == 0 then
      bx[i] = px
      by[i] = py - 12
      ba[i] = 1
      sfx(0)
      return
    end
  end
end

function _update()
  if state != 0 then
    -- win/lose: dim the scene toward black over ~30 frames (cap at 0.7 so the
    -- GAME OVER / YOU WIN text stays readable), then wait for O to restart.
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

  -- scroll the starfield slowly for a sense of motion. NOT camera(): in
  -- mdlua camera() is PICO-8-correct (it offsets sprites too); scroll just
  -- the tile plane with the SGDK verb (plane 1 = BG_B, where the map lives).
  scrolly += 1
  VDP_setVerticalScroll(1, -(scrolly \ 2))

  -- player movement
  if btn(0) then px -= 3 end
  if btn(1) then px += 3 end
  if px < 4 then px = 4 end
  if px > 300 then px = 300 end

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
      if by[i] < -16 then ba[i] = 0 end
    end
  end

  -- drift the enemy formation side to side
  edx += edir
  if edx > 24 then edir = -1 end
  if edx < -24 then edir = 1 end

  -- explosion burst timer
  if let > 0 then let -= 1 end

  -- bullet vs enemy collision + enemy update
  for e=1,12 do
    if eal[e] != 0 then
      local ex = enx[e] + edx
      local ey = eny[e] + (scrolly \ 8)   -- slow descent
      -- lose if an enemy reaches the player's row
      if ey > 180 then
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
            lex = ex
            ley = ey
            let = 12          -- show the burst here for 12 frames
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
    print("YOU WIN!", 128, 90, 11)
    print("score", 128, 110, 7)
    print(score, 176, 110, 10)
    print("press O", 132, 130, 12)
    return
  end
  if state == 2 then
    print("GAME OVER", 124, 90, 8)
    print("score", 128, 110, 7)
    print(score, 176, 110, 10)
    print("press O", 132, 130, 12)
    return
  end

  -- HUD
  print("score", 4, 4, 7)
  print(score, 44, 4, 10)
  print("lives", 250, 4, 7)
  print(lives, 290, 4, 8)

  -- the player ship
  spr(0, px, py, 2, 2)

  -- shots: the green diamond (cells 6-7 / 14-15)
  for i=1,8 do
    if ba[i] != 0 then spr(6, bx[i], by[i], 2, 2) end
  end

  -- enemies: the red invader (cells 2-3 / 10-11)
  for e=1,12 do
    if eal[e] != 0 then
      spr(2, enx[e] + edx, eny[e] + (scrolly \ 8), 2, 2)
    end
  end

  -- the kill burst (cells 4-5 / 12-13)
  if let > 0 then spr(4, lex, ley, 2, 2) end
end
