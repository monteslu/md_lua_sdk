-- 4-way parity reference: this exact cart runs on PICO-8 (fake08), gtlua
-- (GameTank), gbalua (GBA), and mdlua (Genesis) - same Lua, four machines.
-- Core PICO-8 verbs only (no platform-native extras) so it's a fair diff.
-- Screenshot each via romdev MCP and compare (the parity method).
local x = 60
local y = 60
local dx = 1
local dy = 1
function _init()
end
function _update60()
  x += dx
  y += dy
  if x < 4 or x > 300 then dx = -dx end
  if y < 20 or y > 200 then dy = -dy end
end
function _draw()
  cls(1)
  print("parity", 8, 8, 7)
  spr(0, x, y, 2, 2)
end
