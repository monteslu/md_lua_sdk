-- direct SGDK access alongside PICO-8 verbs: the 100%-coverage promise.
-- Every SGDK function is a Lua verb under its own name.
local ti = 0
function _init()
  VDP_setTextPalette(0)
end
function _update60()
  ti += 1
  PAL_setColor(15, VDP_getReg(0))
  if ti % 60 == 0 then VDP_setBackgroundColor(flr(ti / 60) % 8) end
end
function _draw()
  cls(1)
  VDP_drawText("SGDK direct", 12, 4)
  print("+ pico-8 verbs", 8, 48, 10)
  print(ti, 8, 56, 7)
end
