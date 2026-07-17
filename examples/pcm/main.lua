-- Raw PCM playback through SGDK's standalone single-channel driver (SND_PCM_*),
-- distinct from the XGM2 path that sfx()/music() use. Build with a WAV bank:
--
--   mdlua build examples/pcm/main.lua --sfx boom.wav -o pcm.bin
--
-- The --sfx pipeline emits 8-bit signed 13.3 kHz PCM blobs (256-byte aligned).
-- pcm_sample(n)/pcm_len(n) expose blob n to SND_PCM_startPlay; pcm_driver loads
-- the Z80 PCM driver once. (XGM2 and SND_PCM share the Z80 - pick ONE per cart.)

local plays = 0

function _init()
  pcm_driver()             -- SND_PCM_loadDriver(TRUE), once
  pcm_play(0, 3, false)    -- convenience: sample 0, SOUND_PCM_RATE_13400, no loop
  plays = 1
end

function _update60()
  if btnp(4) then
    -- the raw SGDK form - proves SND_PCM_startPlay binds directly from Lua:
    --   sample ptr, length, rate (3=13.4kHz), pan (128=center), loop
    SND_PCM_startPlay(pcm_sample(0), pcm_len(0), 3, 128, false)
    plays += 1
  end
end

function _draw()
  cls(1)
  print("raw pcm (snd_pcm)", 8, 8, 7)
  print("plays:", 8, 28, 6)
  print(plays, 64, 28, 11)
  print("press O to fire", 8, 44, 5)
end
