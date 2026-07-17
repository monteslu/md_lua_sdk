-- SPR_setFrameChangeCallback: a Lua function invoked by SGDK's sprite engine.
--
-- mdlua's PICO-8 sprite verbs drive VDP hardware sprites directly. This example
-- uses the SGDK sprite ENGINE (SPR_*) instead - it needs a SpriteDefinition,
-- which demo_sprite() supplies (a minimal 2-frame animated sprite). We install a
-- Lua function as the sprite's frame-change callback; the engine calls it during
-- its vblank processing (SYS_doVBlankProcess, run for you by the runtime each
-- frame), passing control to our code from inside SGDK.
--
-- The callback bumps a MEMORY-BACKED array (as any engine/interrupt callback
-- must - a scalar could sit in a saved register and never reach the RAM _draw
-- reads). `hits` therefore counts real callback invocations, live from Lua.

local hits = array(2)
local frames = 0
local spr = 0

function on_frame_change()
  hits[0] = hits[0] + 1
end

function _init()
  hits[0] = 0
  SPR_init()
  spr = SPR_addSprite(demo_sprite(), 120, 100, 0)   -- SGDK engine sprite
  SPR_setFrameChangeCallback(spr, on_frame_change)   -- our Lua fn is the hook
  SPR_setAnim(spr, 0)
  SPR_setAutoAnimation(spr, true)                    -- let the engine animate it
end

function _update60()
  frames += 1
end

function _draw()
  print("sprite callback", 8, 8, 7)
  print("hits:", 8, 28, 6)
  print(hits[0], 56, 28, 11)     -- climbs as the engine calls our Lua fn
  print("frame:", 8, 40, 6)
  print(frames, 56, 40, 10)
end
