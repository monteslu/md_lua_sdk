-- hello: the smallest real Genesis game - no assets, just code.
-- The screen is 320x224. cls clears it; print and the shape calls draw on top.
-- Colors are PICO-8-style indices 0-15 (0 black, 1 dark-blue, 10 yellow, 14 pink).

function _draw()
  cls(1)                                -- dark blue background

  print("hello genesis", 116, 32, 14)   -- title text, pink, near the top

  -- a smiley face, drawn entirely with shapes (no sprite sheet needed).
  -- NOTE: the bitmap engine draws into a 256x160 region centered on screen,
  -- so these coords are relative to that box (128,80 is its center).
  circfill(128, 80, 44, 10)             -- head: a big yellow circle
  rectfill(112, 60, 120, 74, 0)         -- left eye: a black square
  rectfill(136, 60, 144, 74, 0)         -- right eye
  circfill(128, 98, 13, 0)              -- mouth: a black circle
end
