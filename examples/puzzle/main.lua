-- GEM WELL - a complete falling-gem match puzzle for the Genesis, in mdlua.
-- A vertical trio of gems drops into a 6x12 well. Move with the d-pad, cycle
-- the trio's colors with O (Genesis B), hard-drop with X (Genesis C). Any
-- straight run of 3+ same-colored gems (across, down, or diagonal) clears;
-- survivors fall and cascades chain for multiplied score. Clearing gems
-- speeds up the fall; the run ends when the well fills to the rim. START
-- restarts.
--
-- RENDERING: locked gems live on the TILE PLANE (plane B), painted with
-- tset(); the falling trio is drawn as hardware sprites over it. This is the
-- load-bearing idiom for a puzzle board: a 16x16 sprite costs 4 of the 80
-- hardware sprites, so a full 6x12 well of gem sprites would blow the budget
-- many times over. Tiles cost NOTHING against that budget, so the board is
-- tiles and only the 3 moving gems are sprites.
--
-- build: mdlua build examples/puzzle/main.lua \
--          --sheet examples/puzzle/gems.png --map examples/puzzle/gems_map.png \
--          -o out.bin
--
-- gems.png (sheet, PAL1) - the trio sprites: gem color k = spr((k-1)*2,...,2,2),
--   so ruby=spr(0) emerald=spr(2) sapphire=spr(4) topaz=spr(6) amethyst=spr(8).
-- gems_map.png (map, PAL2) - the board tiles, 8x8: 0=empty 1=well 2=frame,
--   and gem color k quarter q at tile 3 + (k-1)*4 + q (q: 0=TL 1=TR 2=BL 3=BR).

-- ---- board geometry (in 8x8 TILE cells) ------------------------------------
-- 6 gems wide x 12 tall; each gem is 2x2 tiles. Interior = 12x24 tiles, wrapped
-- in a 1-tile steel frame, centered on the 40x28-tile screen with a HUD strip
-- across the top rows.
local GW = 6           -- well columns (gems)
local GH = 12          -- well rows (gems)
local ITX = 14         -- interior left TILE column (12 tiles wide -> 14..25)
local ITY = 3          -- interior top TILE row (24 tiles tall -> 3..26)

-- map tile ids (must match generate-art.mjs strip order)
local T_EMPTY = 0
local T_WELL = 1
local T_FRAME = 2
local T_GEM0 = 3       -- gem color 1 quarter 0; color k quarter q = T_GEM0 + (k-1)*4 + q

-- ---- state -----------------------------------------------------------------
-- the well: GW*GH = 72 bytes, row-major, 1-indexed. 0 = empty, 1..5 = color.
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
local dirty = 1        -- repaint the board tiles this frame (set on any change)
local seed = 137       -- our own PRNG so runs vary

-- "can the trio fit?" query: set qcol/qrow, then call canplace() (a no-arg
-- function that reads these globals). Returns 1 if the trio can occupy column
-- qcol at rows qrow..qrow+2, else 0. Cells above the rim are allowed (the trio
-- enters from above); off the floor or on a gem is not.
local qcol = 0
local qrow = 0

-- ---- tiny helpers ----------------------------------------------------------
-- Grid access is inlined as grid[row * GW + col + 1] at every call site (cells
-- are 0-based col,row into a 1-indexed flat byte array). A no-param helper for
-- placement keeps the SDK's cheap calling path; passing int params to a helper
-- takes a slower route on this target, so the query args ride qcol/qrow.

-- a cheap deterministic PRNG returning a gem color 1..5. A small LCG whose
-- intermediate product stays well inside the 16.16 integer range (< 3300) and
-- whose period spreads the five colors evenly (no long single-color runs).
function nextcolor()
  seed = (seed * 13 + 7) % 251
  return (seed % 5) + 1
end

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
    if ry >= 0 then grid[ry * GW + px + 1] = col end
  end
  sfx(20)                            -- landing thunk
  dirty = 1
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
  dirty = 1
  spawn()
end

-- clear plane B ONCE. map_show() stamps the whole --map (our 23-tile strip)
-- into plane B's top-left corner; wipe the visible plane to the empty tile so
-- only the well + frame we paint below are shown.
function clearplane()
  for r = 0, 27 do
    for c = 0, 39 do
      tset(0, c, r, T_EMPTY)
    end
  end
end

-- paint the steel frame around the well ONCE (it never changes). The interior
-- gets repainted from the grid each time the board is dirty.
function paintframe()
  -- top + bottom rails (one tile beyond each interior edge)
  local x0 = ITX - 1
  local x1 = ITX + GW * 2
  for c = x0, x1 do
    tset(0, c, ITY - 1, T_FRAME)
    tset(0, c, ITY + GH * 2, T_FRAME)
  end
  -- left + right rails
  for r = ITY, ITY + GH * 2 - 1 do
    tset(0, ITX - 1, r, T_FRAME)
    tset(0, ITX + GW * 2, r, T_FRAME)
  end
end

function _init()
  map_show(0)                        -- board tiles live on plane B
  music(0)                           -- start the FM tune
  clearplane()
  paintframe()
  newgame()
end

-- ---- update ----------------------------------------------------------------
-- _update60 runs once per 60 Hz frame (the native rate). (_update would run at
-- PICO-8's 30 Hz, halving the fall/input cadence.)
function _update60()
  if state ~= 0 then
    -- game over: wait for START to restart.
    if btnp(7) then
      music(0)
      newgame()
    end
    return
  end

  if flasht > 0 then flasht -= 1 end

  -- horizontal move (edge-triggered: one cell per press). qcol/qrow feed the
  -- no-arg canplace() query (see its definition for why it's parameterless).
  qrow = py
  if btnp(0) then
    qcol = px - 1
    if canplace() ~= 0 then px -= 1 end
  end
  if btnp(1) then
    qcol = px + 1
    if canplace() ~= 0 then px += 1 end
  end

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
    qcol = px
    qrow = py + 1
    while canplace() ~= 0 do
      py += 1
      qrow = py + 1
    end
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
    qcol = px
    qrow = py + 1
    if canplace() ~= 0 then
      py += 1
    else
      lockpiece()
    end
  end
end

-- ---- draw ------------------------------------------------------------------
-- repaint the interior tiles from the grid. Each gem cell is a 2x2 block of
-- quarter tiles; an empty cell is the plain well tile. On a clear-flash the
-- matched cells blink to the empty look so the match reads before it vanishes.
function paintboard()
  local blink = 0
  if flasht > 0 and flasht % 2 == 0 then blink = 1 end
  for row = 0, GH - 1 do
    for col = 0, GW - 1 do
      local v = grid[row * GW + col + 1]
      if v ~= 0 and blink ~= 0 and mask[row * GW + col + 1] ~= 0 then v = 0 end
      local tx = ITX + col * 2
      local ty = ITY + row * 2
      if v == 0 then
        tset(0, tx, ty, T_WELL)
        tset(0, tx + 1, ty, T_WELL)
        tset(0, tx, ty + 1, T_WELL)
        tset(0, tx + 1, ty + 1, T_WELL)
      else
        local base = T_GEM0 + (v - 1) * 4
        tset(0, tx, ty, base)         -- TL
        tset(0, tx + 1, ty, base + 1) -- TR
        tset(0, tx, ty + 1, base + 2) -- BL
        tset(0, tx + 1, ty + 1, base + 3) -- BR
      end
    end
  end
end

function _draw()
  -- HUD text (rides plane A over the tile board).
  print("gem well", 8, 8, 11)
  print("score", 8, 40, 7)
  print(score, 8, 52, 10)
  print("level", 8, 80, 7)
  print(level, 8, 92, 9)
  print("O cycle", 8, 176, 6)
  print("X drop", 8, 188, 6)

  if state ~= 0 then
    print("GAME OVER", 232, 96, 8)
    print("press", 240, 120, 7)
    print("START", 240, 132, 12)
  else
    -- print text stays on plane A until overwritten, so wipe the game-over
    -- panel with blanks once we're playing again (else it lingers on restart).
    print("         ", 232, 96, 7)
    print("     ", 240, 120, 7)
    print("     ", 240, 132, 7)
  end

  -- repaint the board tiles whenever it changed, plus every frame the clear
  -- flash is active (so the blink animates).
  if dirty ~= 0 or flasht > 0 then
    paintboard()
    dirty = 0
  end

  -- the falling trio as sprites over the board (only rows at/below the rim).
  if state == 0 then
    for i = 0, 2 do
      local ry = py + i
      if ry >= 0 then
        local col
        if i == 0 then col = c1 end
        if i == 1 then col = c2 end
        if i == 2 then col = c3 end
        local sx = (ITX + px * 2) * 8
        local sy = (ITY + ry * 2) * 8
        spr((col - 1) * 2, sx, sy, 2, 2)
      end
    end
  end
end
