-- mdlua spike 0b: Lua -> native 68000. sprite + input + text.
local x = 156
local y = 100
local frames = 0
function _init()
end
function _update60()
  frames += 1
  if btn(0) then x -= 2 end
  if btn(1) then x += 2 end
  if btn(2) then y -= 2 end
  if btn(3) then y += 2 end
end
function _draw()
  cls(1)
  print("mdlua spike 0b", 96, 16, 7)
  spr(0, x, y)
  spr(1, x + 12, y)
  spr(2, x, y + 12)
  spr(3, x + 12, y + 12)
  print(frames, 8, 8, 7)
end
