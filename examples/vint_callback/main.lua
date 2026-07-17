-- SYS_setVIntCallback: install a Lua function as SGDK's vertical-interrupt hook.
--
-- The callback runs inside the VInt handler every vblank (60Hz), independent of
-- _update/_draw. Any SGDK callback param takes a bare top-level function name -
-- its address is handed to SGDK, and flat Genesis ROM makes the call safe.
--
-- As with task.h, a value the callback mutates and the main loop reads must be
-- MEMORY-BACKED (an array) - the interrupt context saves registers, but a
-- scalar the callback bumped may never reach RAM where _draw() reads it.

local vints = array(2)   -- vints[0]: bumped inside the VInt handler
local frames = 0

function on_vblank()
  vints[0] = vints[0] + 1
end

function _init()
  vints[0] = 0
  SYS_setVIntCallback(on_vblank)   -- hand SGDK our Lua function
end

function _update60()
  frames += 1                       -- also 60Hz, so it tracks vints[0]
end

function _draw()
  cls(1)
  print("vint callback", 8, 8, 7)
  print("vints:", 8, 28, 6)
  print(vints[0], 64, 28, 11)
  print("frame:", 8, 40, 6)
  print(frames, 64, 40, 10)
end
