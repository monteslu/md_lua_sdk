// mdlua-run.mjs - play a Genesis .bin in a window, zero external emulator install.
//
// Loads the bundled Genesis Plus GX libretro core (romdev-core-gpgx) and drives a
// minimal frame loop: retro_run each tick, blit the framebuffer to a @kmamal/sdl
// window, and map the keyboard to the Genesis pad. This is OUR small host - it
// does only what GameTank needs (one core, one window), using retroemu's
// LibretroHost as the reference pattern rather than depending on it.
//
// Genesis pad (libretro RetroPad bit -> Genesis button):
//   gpgx maps Genesis A/B/C onto libretro Y/B/A. Keyboard: Z=A, X=B, C=C,
//   Enter=START. mdlua btn(): 4=O->B, 5=X->C, 6=A, 7=START.
//
// If @kmamal/sdl isn't installed (headless / unsupported platform), this exits
// with a clear message and the caller falls back to an external emulator.

import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

const RETRO_DEVICE_JOYPAD = 1;
// libretro RetroPad button ids
const ID = { B: 0, Y: 1, SELECT: 2, START: 3, UP: 4, DOWN: 5, LEFT: 6, RIGHT: 7, A: 8, X: 9 };
const RETRO_PIXEL_FORMAT_XRGB8888 = 1;
const RETRO_PIXEL_FORMAT_RGB565 = 2;

// Keyboard -> RetroPad. Arrows move; Z/X/C are the three face buttons; Enter=start.
function keymap(sdl) {
  const K = sdl.keyboard.SCANCODE;
  return [
    [K.UP, ID.UP], [K.DOWN, ID.DOWN], [K.LEFT, ID.LEFT], [K.RIGHT, ID.RIGHT],
    [K.Z, ID.Y], [K.X, ID.B], [K.C, ID.A], [K.RETURN, ID.START], [K.RSHIFT, ID.SELECT],
  ];
}

export async function runRom(romPath, opts = {}) {
  if (!existsSync(romPath)) throw new Error(`no such rom: ${romPath}`);

  let sdl;
  try {
    sdl = (await import("@kmamal/sdl")).default;
  } catch {
    const err = new Error("SDL_UNAVAILABLE");
    err.code = "SDL_UNAVAILABLE";
    throw err;
  }

  // Resolve + instantiate the bundled GameTank core.
  const { core } = await import("romdev-core-gpgx");
  if (!existsSync(core.jsPath)) throw new Error("romdev-core-gpgx wasm missing (run: npm install)");
  const factory = (await import(core.jsPath)).default;
  const wasmBinary = readFileSync(core.wasmPath);
  const mod = await factory({ wasmBinary, locateFile: (p) => (p.endsWith(".wasm") ? core.wasmPath : p) });

  // --- libretro callback wiring -------------------------------------------
  let fbWidth = 320, fbHeight = 224, pixelFormat = RETRO_PIXEL_FORMAT_XRGB8888;
  let latestFrame = null;   // { ptr, width, height, pitch }
  const buttons = new Uint8Array(16);

  // environment: answer pixel-format + a couple of no-op queries, ignore rest.
  const envCb = mod.addFunction((cmd, dataPtr) => {
    // RETRO_ENVIRONMENT_SET_PIXEL_FORMAT = 10
    if (cmd === 10) { pixelFormat = mod.HEAP32[dataPtr >> 2]; return 1; }
    return 0;
  }, "iii");
  mod._retro_set_environment(envCb);

  const videoCb = mod.addFunction((dataPtr, width, height, pitch) => {
    if (dataPtr) latestFrame = { ptr: dataPtr, width, height, pitch };
    fbWidth = width; fbHeight = height;
  }, "viiii");
  mod._retro_set_video_refresh(videoCb);

  // audio: accept batches (we play them below); single-sample cb is a no-op.
  let audioQueue = [];
  const audioBatchCb = mod.addFunction((dataPtr, frames) => {
    const n = frames * 2;                     // interleaved s16 stereo
    const src = new Int16Array(mod.HEAP16.buffer, dataPtr, n);
    audioQueue.push(Int16Array.from(src));
    return frames;
  }, "iii");
  mod._retro_set_audio_sample_batch(audioBatchCb);
  mod._retro_set_audio_sample(mod.addFunction(() => {}, "vii"));

  const inputPollCb = mod.addFunction(() => {}, "v");
  mod._retro_set_input_poll(inputPollCb);
  const inputStateCb = mod.addFunction((port, device, index, id) => {
    if (port !== 0 || device !== RETRO_DEVICE_JOYPAD) return 0;
    return buttons[id] ? 1 : 0;
  }, "iiiii");
  mod._retro_set_input_state(inputStateCb);

  mod._retro_init();

  // load the cart
  const romData = readFileSync(romPath);
  const romPtr = mod._malloc(romData.length);
  mod.HEAPU8.set(romData, romPtr);
  const info = mod._malloc(24);
  mod.HEAPU32[(info >> 2) + 0] = 0;             // path = NULL
  mod.HEAPU32[(info >> 2) + 1] = romPtr;        // data
  mod.HEAPU32[(info >> 2) + 2] = romData.length; // size
  mod.HEAPU32[(info >> 2) + 3] = 0;             // meta = NULL
  if (!mod._retro_load_game(info)) throw new Error("retro_load_game failed");

  // av_info: struct retro_system_av_info { geometry{u32 base_w, base_h, max_w,
  // max_h; float aspect}, timing{double fps; double sample_rate} }. The double
  // timing fields sit at byte offset 24 (after 5 x 4-byte geometry words + pad
  // to 8). This core build doesn't expose HEAPF64, so read via a DataView.
  const av = mod._malloc(64);
  mod._retro_get_system_av_info(av);
  const dv = new DataView(mod.HEAPU8.buffer, av, 64);
  const fps = dv.getFloat64(24, true) || 60;
  const sampleRate = dv.getFloat64(32, true) || 44100;

  // --- window + audio ------------------------------------------------------
  // The Genesis native resolution is 320x224 (H40, NTSC). Present it with
  // SQUARE pixels at an integer scale (default 3x = 960x672) - crisp, no
  // stretching. (A real CRT would stretch H40 to ~4:3, but we keep pixels
  // square + integer for consistency with the docs and screenshots.)
  const scale = opts.scale ?? 3;
  const window = sdl.video.createWindow({
    title: opts.title ?? `mdlua - ${path.basename(romPath)}`,
    width: 320 * scale, height: 224 * scale, resizable: true,
  });
  let audioDev = null;
  try {
    audioDev = sdl.audio.openDevice({ type: "playback" }, { channels: 2, frequency: sampleRate, format: "s16lsb" });
    audioDev.play();
  } catch { /* audio optional */ }

  const km = keymap(sdl);
  const setKeys = (down, scancode) => {
    for (const [sc, id] of km) if (sc === scancode) buttons[id] = down ? 1 : 0;
  };
  window.on("keyDown", (e) => setKeys(true, e.scancode));
  window.on("keyUp", (e) => setKeys(false, e.scancode));

  // present one framebuffer to the SDL window (XRGB8888 or RGB565 -> rgba)
  const present = () => {
    if (!latestFrame) return;
    const { ptr, width, height, pitch } = latestFrame;
    const out = Buffer.alloc(width * height * 4);
    if (pixelFormat === RETRO_PIXEL_FORMAT_RGB565) {
      const src = new Uint16Array(mod.HEAP16.buffer, ptr, (pitch / 2) * height);
      for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
        const p = src[y * (pitch / 2) + x], o = (y * width + x) * 4;
        out[o] = ((p >> 11) & 0x1f) << 3; out[o + 1] = ((p >> 5) & 0x3f) << 2; out[o + 2] = (p & 0x1f) << 3; out[o + 3] = 255;
      }
    } else {
      const src = new Uint8Array(mod.HEAPU8.buffer, ptr, pitch * height);
      for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
        const s = y * pitch + x * 4, o = (y * width + x) * 4;
        out[o] = src[s + 2]; out[o + 1] = src[s + 1]; out[o + 2] = src[s]; out[o + 3] = 255; // BGRA->RGBA
      }
    }
    // Present at the largest whole-number scale that fits (SQUARE pixels, no
    // stretch), centered/letterboxed. Recomputed per frame so resizing stays
    // integer-crisp. nearest-neighbor keeps the pixel art sharp.
    const ww = window.width, wh = window.height;
    const mult = Math.max(1, Math.min(Math.floor(ww / width), Math.floor(wh / height)));
    const dw = width * mult, dh = height * mult;
    const dstRect = { x: Math.floor((ww - dw) / 2), y: Math.floor((wh - dh) / 2), width: dw, height: dh };
    window.render(width, height, width * 4, "rgba32", out, { scaling: "nearest", dstRect });
  };

  // --- frame loop ----------------------------------------------------------
  const frameMs = 1000 / fps;
  let running = true;
  window.on("close", () => { running = false; });
  const tick = () => {
    if (!running || window.destroyed) { cleanup(); return; }
    mod._retro_run();
    present();
    if (audioDev && audioQueue.length) {
      for (const chunk of audioQueue) audioDev.enqueue(Buffer.from(chunk.buffer, chunk.byteOffset, chunk.byteLength));
      audioQueue = [];
    }
    setTimeout(tick, frameMs);
  };
  const cleanup = () => {
    try { mod._retro_unload_game(); mod._retro_deinit(); } catch {}
    try { audioDev && audioDev.close(); } catch {}
    try { !window.destroyed && window.destroy(); } catch {}
  };
  tick();
}
