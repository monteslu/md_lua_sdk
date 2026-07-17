-- GEM WELL — a complete falling-gem match puzzle for the Genesis, in mdlua.
-- A vertical trio of gems drops into a 6x12 well. Move with the d-pad, cycle
-- the trio's colors with O (Genesis B), hard-drop with X (Genesis C). Any
-- straight run of 3+ same-colored gems (across, down, or diagonal) clears;
-- survivors fall and cascades chain for multiplied score. Clearing gems
-- speeds up the fall; the run ends when the well fills to the rim. START
-- restarts. Uses: hardware sprites for gems + the falling trio, a framed
-- well drawn from wall/floor sprites, a text score HUD, FM music, PSG sfx,
-- and a clear-flash + cascade resolve.
--
-- build: mdlua build examples/puzzle/main.lua \
--          --sheet examples/puzzle/gems.png -o out.bin
--
-- sheet cells are 8x8, row-major (16 per row on this 128x32 sheet). Every
-- gem is a 2x2 (16x16) sprite: gem color k draws from cell (k-1)*2, so
-- ruby=spr(0), emerald=spr(2), sapphire=spr(4), topaz=spr(6), amethyst=spr(8).
-- Frame art is on the second sprite row: wall=spr(32), floor=spr(34).

-- ---- board geometry --------------------------------------------------------
-- 6 wide x 12 tall well of 16x16 cells. Interior sits inside a one-cell steel
-- frame. Screen is 320x224; the framed board is 8 cells wide x 14 tall = 128
-- x 224 px, centered horizontally with a HUD gutter on the left.
local GW = 6           -- well columns
local GH = 12          -- well rows
local CELL = 16        -- pixel size of one cell
local ORGX = 112       -- pixel x of the well interior's left edge
local ORGY = 32        -- pixel y of the well interior's top edge

-- ---- state -----------------------------------------------------------------
-- the well: GW*GH = 72 bytes, row-major, 1-indexed. 0 = empty, 1..5 = color.
-- (array8 needs a constant capacity, so this is the literal 6*12.)
local grid = array8(72)
-- a scratch mask the size of the board: 1 where a gem is part of a match.
local mask = array8(72)

-- the falling trio: column, top row (may be negative, above the rim), colors.
local px = 3           -- trio column (0..GW-1)
local py = 0           -- row of the trio's TOP gem (<0 = still above the rim)
local c1 = 1           -- top gem color
local c2 = 2           -- middle gem color
local c3 = 3           -- bottom gem color

local score = 0
local level = 1        -- 1..9, speeds the fall
local cleared = 0      -- total gems cleared, drives the level
local fallt = 0        -- frames until the next gravity step
local state = 0        -- 0 = playing, 1 = game over
local flasht = 0       -- clear-flash timer (frames the matched cells blink)
local seed = 137       -- our own PRNG so runs vary without needing t() early

-- ---- tiny helpers ----------------------------------------------------------
-- Grid access is inlined as grid[row * GW + col + 1] at every call site: the
-- cells are 0-based (col,row) into a 1-indexed flat byte array. Keeping it
-- inline (rather than a helper taking int params) is deliberate on this
-- target so the accessors never leave a hot inner loop.

-- a cheap deterministic PRNG returning a gem color 1..5. The intermediate
-- product stays tiny (< 1300) so it never leaves the 16.16 integer range.
function nextcolor()
  seed = (seed * 5 + 3) % 251
  return (seed % 5) + 1
end

-- "can the trio fit?" query: set qcol/qrow, then call canplace() (a no-arg
-- function that reads these globals). Returns 1 if the trio can occupy column
-- qcol at rows qrow..qrow+2, else 0. Cells above the rim are allowed (the
-- trio enters from above); off the floor or on a gem is not.
local qcol = 0
local qrow = 0

function canplace()
  if qcol < 0 then return 0 end
  if qcol >= GW then return 0 end
  for i = 0, 2 do
    local ry = qrow + i
    if ry >= GH then return 0 end
    if ry >= 0 then
      if grid[ry * GW + qcol + 1] ~= 0 then return 0 end
    end
  end
  return 1
end

-- ---- piece spawning + placement --------------------------------------------
function spawn()
  px = 3
  py = -2
  c1 = nextcolor()
  c2 = nextcolor()
  c3 = nextcolor()
  -- if the entry column is already blocked at the rim, the well is full.
  qcol = px
  qrow = 0
  if canplace() == 0 then
    state = 1
    music(-1)
  end
end

-- ---- match scan ------------------------------------------------------------
-- mark every straight run of 3+ same-colored gems (across, down, and both
-- diagonals) into `mask`, and return how many cells were marked. A cell can
-- belong to several runs; the mask de-dupes so each clears once.
function scanmatches()
  for i = 1, GW * GH do mask[i] = 0 end
  local count = 0
  -- 4 directions: right (1,0), down (0,1), down-right (1,1), down-left (-1,1).
  -- We only START a run at a cell whose predecessor in that direction differs
  -- (or is off-board), so each run is counted once.
  for row = 0, GH - 1 do
    for col = 0, GW - 1 do
      local v = grid[row * GW + col + 1]
      if v ~= 0 then
        for d = 0, 3 do
          local dc = 0
          local dr = 0
          if d == 0 then dc = 1 dr = 0 end
          if d == 1 then dc = 0 dr = 1 end
          if d == 2 then dc = 1 dr = 1 end
          if d == 3 then dc = -1 dr = 1 end
          -- is this the start of the run? (predecessor differs / off-board)
          -- isstart is a 0/1 flag, not a boolean (mdlua has no boolean vars).
          local pc = col - dc
          local pr = row - dr
          local isstart = 1
          if pc >= 0 and pc < GW and pr >= 0 and pr < GH then
            if grid[pr * GW + pc + 1] == v then isstart = 0 end
          end
          if isstart ~= 0 then
            -- measure the run length forward
            local len = 1
            local nc = col + dc
            local nr = row + dr
            while nc >= 0 and nc < GW and nr >= 0 and nr < GH and grid[nr * GW + nc + 1] == v do
              len += 1
              nc += dc
              nr += dr
            end
            if len >= 3 then
              -- mark every cell of the run
              local mc = col
              local mr = row
              for k = 1, len do
                local idx = mr * GW + mc + 1
                if mask[idx] == 0 then
                  mask[idx] = 1
                  count += 1
                end
                mc += dc
                mr += dr
              end
            end
          end
        end
      end
    end
  end
  return count
end

-- collapse each column so survivors rest on the floor.
function applygravity()
  for col = 0, GW - 1 do
    local w = GH - 1                 -- write cursor, bottom-up
    for row = GH - 1, 0, -1 do
      local v = grid[row * GW + col + 1]
      if v ~= 0 then
        grid[w * GW + col + 1] = v
        w -= 1
      end
    end
    while w >= 0 do
      grid[w * GW + col + 1] = 0
      w -= 1
    end
  end
end

-- clear all marked cells, drop survivors, and chain cascades. Scores each
-- pass; deeper cascades pay a rising multiplier. Returns the chain depth.
function resolve()
  local chain = 0
  local n = scanmatches()
  while n > 0 do
    chain += 1
    for i = 1, GW * GH do
      if mask[i] ~= 0 then grid[i] = 0 end
    end
    local amt = n * 10
    if chain > 1 then amt = amt * chain end
    score += amt
    cleared += n
    -- speed up: every 12 gems cleared bumps the level, up to 9.
    local want = (cleared \ 12) + 1
    if want > 9 then want = 9 end
    level = want
    sfx(40 + chain * 4)              -- clear chime, higher per cascade
    applygravity()
    n = scanmatches()
  end
  return chain
end

-- ---- landing the trio ------------------------------------------------------
-- stamp the trio into the grid, resolve matches, and spawn the next piece.
function lockpiece()
  for i = 0, 2 do
    local ry = py + i
    local col
    if i == 0 then col = c1 end
    if i == 1 then col = c2 end
    if i == 2 then col = c3 end
    if ry >= 0 then setcell(px, ry, col) end
  end
  sfx(20)                            -- landing thunk
  -- locked with a gem left above the rim? the well has topped out.
  if py < 0 then
    state = 1
    music(-1)
    return
  end
  local chain = resolve()
  if chain > 0 then flasht = 8 end   -- brief flash after a clear
  if state == 0 then spawn() end
end

-- ---- setup / restart -------------------------------------------------------
function newgame()
  for i = 1, GW * GH do grid[i] = 0 end
  score = 0
  level = 1
  cleared = 0
  fallt = 0
  flasht = 0
  state = 0
  spawn()
end

function _init()
  music(0)                           -- start the FM tune
  newgame()
end

-- ---- update ----------------------------------------------------------------
function _update()
  if state ~= 0 then
    -- game over: wait for START to restart.
    if btnp(7) then
      music(0)
      newgame()
    end
    return
  end

  if flasht > 0 then flasht -= 1 end

  -- horizontal move (edge-triggered: one cell per press).
  if btnp(0) and canplace(px - 1, py) ~= 0 then px -= 1 end
  if btnp(1) and canplace(px + 1, py) ~= 0 then px += 1 end

  -- O cycles the trio's three colors (the classic trio "rotate").
  if btnp(4) then
    local t = c3
    c3 = c2
    c2 = c1
    c1 = t
    sfx(30)
  end

  -- X hard-drops: fall until it can't, then lock.
  if btnp(5) then
    while canplace(px, py + 1) ~= 0 do py += 1 end
    lockpiece()
    return
  end

  -- gravity: DOWN soft-drops (adds to the fall accumulator).
  if btn(3) then fallt += 4 end
  fallt += 1
  -- fall delay shrinks with the level: ~30 frames at lv1 down to ~6 at lv9.
  local delay = 33 - level * 3
  if fallt >= delay then
    fallt = 0
    if canplace(px, py + 1) ~= 0 then
      py += 1
    else
      lockpiece()
    end
  end
end

-- ---- draw ------------------------------------------------------------------
-- draw the steel frame around the well from wall sprites (one cell thick).
function drawframe()
  local top = ORGY - CELL
  local bot = ORGY + GH * CELL
  local lft = ORGX - CELL
  local rgt = ORGX + GW * CELL
  -- top + bottom rails
  for col = -1, GW do
    spr(32, ORGX + col * CELL, top, 2, 2)
    spr(34, ORGX + col * CELL, bot, 2, 2)
  end
  -- side rails
  for row = 0, GH - 1 do
    spr(32, lft, ORGY + row * CELL, 2, 2)
    spr(32, rgt, ORGY + row * CELL, 2, 2)
  end
end

function _draw()
  cls(0)

  if state ~= 0 then
    print("GAME OVER", 124, 96, 8)
    print("score", 120, 116, 7)
    print(score, 168, 116, 10)
    print("press START", 116, 140, 12)
    return
  end

  -- HUD (left gutter): score and level.
  print("gem well", 8, 8, 11)
  print("score", 8, 32, 7)
  print(score, 8, 44, 10)
  print("level", 8, 64, 7)
  print(level, 8, 76, 9)
  print("O cycle", 8, 176, 6)
  print("X drop", 8, 188, 6)

  drawframe()

  -- locked gems in the well. On a clear-flash, matched cells blink off every
  -- other frame so the match reads before it vanishes. `blink` is a 0/1 flag.
  local blink = 0
  if flasht > 0 and flasht % 2 == 0 then blink = 1 end
  for row = 0, GH - 1 do
    for col = 0, GW - 1 do
      local v = cellat(col, row)
      if v ~= 0 then
        local hide = 0
        if blink ~= 0 and mask[row * GW + col + 1] ~= 0 then hide = 1 end
        if hide == 0 then
          spr((v - 1) * 2, ORGX + col * CELL, ORGY + row * CELL, 2, 2)
        end
      end
    end
  end

  -- the falling trio (only cells that are at or below the rim are drawn).
  for i = 0, 2 do
    local ry = py + i
    if ry >= 0 then
      local col
      if i == 0 then col = c1 end
      if i == 1 then col = c2 end
      if i == 2 then col = c3 end
      spr((col - 1) * 2, ORGX + px * CELL, ORGY + ry * CELL, 2, 2)
    end
  end
end
