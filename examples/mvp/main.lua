-- mdlua phase-1 mvp check: real sheet art + sprites + text colors + rectfill
local x = 120
local y = 80
function _init()
end
function _update60()
  if btn(0) then x -= 2 end
  if btn(1) then x += 2 end
  if btn(2) then y -= 2 end
  if btn(3) then y += 2 end
end
function _draw()
  cls(1)
  print("mdlua mvp", 8, 8, 7)
  print("arrows move", 8, 16, 10)
  print(t(), 8, 24, 11)
  spr(anim(0, 0, 3, 8), x, y, 2, 2)
  spr(0, 40, 120, 2, 2, 1)
end
