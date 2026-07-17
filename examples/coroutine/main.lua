-- SGDK user-tasks (coroutines) from PICO-8-flavored Lua.
--
-- SGDK's task.h runs a "user task" alongside the main loop. The supervisor (the
-- main loop) hands it a time-slice with TSK_userYield(); the task runs until the
-- next VBlank pre-empts it. We register a plain top-level Lua function as the
-- task - the "fn" builtin kind passes its address (&gtl_bg_task) to TSK_userSet.
--
-- NOTE: a value the task mutates and the supervisor reads must be MEMORY-BACKED
-- (an array), not a scalar local - a tight-loop scalar can live in a register
-- that the VBlank context switch saves but _draw() never sees flushed to RAM.

local shared = array(2)   -- shared[0]: incremented by the background task
local frames = 0

function bg_task()
  -- the user task: runs each slice, pre-empted by VBlank. Loop forever so it
  -- keeps getting scheduled every time the supervisor yields.
  while true do
    shared[0] = shared[0] + 1
  end
end

function _init()
  shared[0] = 0
  TSK_init()             -- reset the task subsystem
  TSK_userSet(bg_task)   -- register our Lua function as the user task
end

function _update60()
  frames += 1
  TSK_userYield()        -- hand the user task this frame's slice
end

function _draw()
  cls(1)
  print("sgdk coroutine", 8, 8, 7)
  print("task:", 8, 28, 6)
  print(shared[0], 64, 28, 11)
  print("frame:", 8, 40, 6)
  print(frames, 64, 40, 10)
end
