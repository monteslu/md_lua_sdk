-- mdlua platformer: gravity, jump, ground collision. Tile/sprite mode (the
-- game path) - no bitmap verbs, so plane A stays free for text + sprites.
local __p8map = hexdata("0101010101010101010101010101010101010101010101010101010101010101")
local px = 40.0
local py = 80.0
local vy = 0.0
local grounded = 0
local ground_y = 168

function _init()
  -- lay a ground row on plane B at tile row 22
  map(0, 0, 0, 176, 40, 1)
end

function _update60()
  if btn(0) then px -= 2 end
  if btn(1) then px += 2 end
  if btnp(4) and grounded == 1 then vy = -7.0 grounded = 0 end
  vy += 0.4
  py += vy
  if py >= ground_y then py = ground_y vy = 0.0 grounded = 1 end
end

function _draw()
  cls(12)
  print("platformer - O jumps", 8, 8, 7)
  print(flr(py), 8, 16, 10)
  spr(0, px, py, 2, 2)
end
