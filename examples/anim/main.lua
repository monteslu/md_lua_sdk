-- ANIM - the animation helpers. A frame range + a speed becomes "which frame
-- now", timed automatically. Three critters run the SAME 4-frame sheet at
-- different speeds and modes so the helpers are easy to compare:
--   left   : anim()          - looping cycle, fast
--   middle : anim_pingpong() - bounces 0->3->0
--   right  : anim_once()     - plays once on O, holds on the last frame
--
-- build: mdlua build examples/anim/main.lua \
--          --sheet examples/anim/critter.png --map examples/anim/bg.png

function _init()
  map_show(0)   -- a tile background (so we're in tile mode: clean sprite-HUD text)
end

function _update()
  -- re-arm the one-shot critter when O is pressed
  if btnp(4) then anim_reset(2) end
end

function _draw()
  -- (no cls - the tile background is drawn by hardware)
  print("animation helpers", 96, 20, 7)
  print("loop", 72, 80, 6)
  print("pong", 152, 80, 6)
  print("once", 232, 80, 6)
  print("press O to replay", 100, 180, 5)

  -- slot 0: a fast looping cycle over cells 0..3 at 10 fps
  spr(anim(0, 0, 3, 10), 72, 104, 2, 2)

  -- slot 1: ping-pong 0..3..0 at 8 fps
  spr(anim_pingpong(1, 0, 3, 8), 152, 104, 2, 2)

  -- slot 2: play once at 6 fps, hold on the last frame; show DONE when finished
  spr(anim_once(2, 0, 3, 6), 232, 104, 2, 2)
  if anim_done(2) != 0 then print("done", 232, 136, 11) end
end
