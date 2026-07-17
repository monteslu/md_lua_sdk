-- raster: the Genesis showcase. per-line hscroll waves + live CRAM cycling +
-- a WINDOW-plane HUD + shadow/highlight + FM music. none of this exists on
-- PICO-8 - and all of it is a few lines of mdlua.
local __p8map = hexdata("0101010101010101010101010101010101010101")
local ti = 0
local wave = 2
function _init()
  hud(2)
  music(0)
  map(0, 0, 0, 32, 20, 1)
end
function _update60()
  ti += 1
  if btnp(4) then wave += 1 end
  if btnp(5) then wave -= 1 end
  wave = mid(0, wave, 8)
  for line = 0, 223 do
    hscroll(line, flr(sin(ti / 128 + line / 32) * (wave * 3)))
  end
  if ti % 6 == 0 then
    local b = flr(ti / 6) % 4
    pal(8, 8 + b)
    pal(10, 8 + (b + 1) % 4)
  end
end
function _draw()
  cls(1)
  print("raster waves", 8, 0, 7)
  print(wave, 120, 0, 10)
  spr(0, 152, 104, 2, 2)
end
