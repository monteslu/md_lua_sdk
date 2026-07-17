-- XGM2 music bank + PCM sfx. Build with your own songs and sounds:
--
--   mdlua build examples/music/main.lua \
--     --music intro.vgm,level.vgm \    <- bank order = music(n) index
--     --sfx blip.wav -o music.bin
--
-- .vgm comes from any Mega Drive tracker (DefleMask, Furnace: export VGM).
-- .vgz (gzipped) and precompiled .xgc are accepted too. With NO --music,
-- music(n) plays the SDK's built-in demo tune so sound works out of the box.
--
--   music(n)         play song n, looped (music(-1) stops)
--   music(n, false)  play song n once
--   sfx(n, [ch])     fire PCM sample n from the --sfx bank (PSG blip if none)

local song = 0
local playing = 1

function _init()
  music(song)                      -- start the bank's first song at boot
end

function _update60()
  if btnp(4) then                  -- O: next song in the bank
    song += 1
    if song > 1 then song = 0 end  -- two songs when built as documented
    music(song)
    playing = 1
  end
  if btnp(5) then                  -- X: stop / restart
    if playing == 1 then
      playing = 0
      music(-1)
    else
      playing = 1
      music(song)
    end
  end
  if btnp(7) then sfx(0) end       -- START: sfx over the music
end

function _draw()
  cls(1)
  print("music bank", 8, 8, 7)
  print("song:", 8, 28, 6)
  print(song, 48, 28, 11)
  if playing == 1 then
    print("playing", 8, 40, 11)
  else
    print("stopped", 8, 40, 8)
  end
  print("O next  X stop  START sfx", 8, 60, 5)
end
