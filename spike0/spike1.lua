-- mdlua spike 1: the Genesis flavor. raster waves + live CRAM + FM music.
local t = 0
local started = 0
function _init()
end
function _update60()
  t += 1
  if started == 0 then
    music(0)
    started = 1
  end
  -- wavy per-scanline scroll: classic Genesis heat-haze
  for line = 0, 223 do
    hscroll(line, flr(sin(t / 128 + line / 32) * 12))
  end
  -- palette cycle: rotate P8 colors 8..11 through CRAM every 8 frames
  if t % 8 == 0 then
    local base = flr(t / 8) % 4
    pal(8, 8 + (base + 0) % 4)
    pal(10, 8 + (base + 1) % 4)
    pal(11, 8 + (base + 2) % 4)
    pal(12, 8 + (base + 3) % 4)
  end
end
function _draw()
  cls(1)
  print("mdlua spike 1", 8, 8, 7)
  spr(0, 152, 100)
end
