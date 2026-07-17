-- hello: the smallest real GBA game - no assets, just code.
-- The screen is 240x160. cls clears it; print and the shape calls draw on top.
-- Colors are PICO-8-style indices 0-15 (0 black, 1 dark-blue, 10 yellow, 14 pink).

function _draw()
  cls(1)                                -- dark blue background

  print("hello gba", 100, 24, 14)       -- title text, pink, near the top

  -- a smiley face, drawn entirely with shapes (no sprite sheet needed)
  circfill(120, 92, 38, 10)             -- head: a big yellow circle
  rectfill(106, 76, 113, 86, 0)         -- left eye: a black square
  rectfill(127, 76, 134, 86, 0)         -- right eye
  circfill(120, 104, 11, 0)             -- mouth: a black circle
end
