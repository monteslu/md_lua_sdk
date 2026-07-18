-- hello mdlua: a hardware sprite you move with the d-pad, plus a greeting.
--
-- This is how you actually make a Genesis game. The screen is 320x224. cls
-- paints a hardware background plane that stays put; the sprite is a real
-- hardware sprite (spr uses the built-in default sheet, so no asset file is
-- needed). _update60 moves it on the d-pad every frame, _draw redraws it every
-- frame - sprites are cheap, you don't repaint the whole screen to move one.

local x, y = 152, 104

function _update60()               -- 60fps input + movement
  if (btn(1)) then x += 2 end      -- right
  if (btn(0)) then x -= 2 end      -- left
  if (btn(3)) then y += 2 end      -- down
  if (btn(2)) then y -= 2 end      -- up
end

function _draw()
  cls(1)                              -- dark-blue background plane
  print("hello genesis", 116, 32, 14) -- greeting near the top, pink
  spr(0, x, y, 2, 2)                  -- the hardware sprite, redrawn every frame
end
