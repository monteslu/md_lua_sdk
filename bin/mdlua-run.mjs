// mdlua-run.mjs - play a Genesis .bin in a window via the shared romdev SDL host.
//
// Thin shim over romdev-core-runner (the one SDL host in the ecosystem). It
// loads the bundled Genesis Plus GX core and maps the keyboard to the Genesis
// pad. gpgx maps Genesis A/B/C onto libretro Y/B/A, so:
//   arrows = d-pad, Z = A (RETRO_Y), X = B (RETRO_B), C = C (RETRO_A),
//   Enter = START, RShift = SELECT.
// If @kmamal/sdl isn't installed the runner throws { code:"SDL_UNAVAILABLE" };
// we re-throw so the CLI can fall back to an external emulator.

import { runRom as runRomInWindow } from "romdev-core-runner";
import * as core from "romdev-core-gpgx";

// Keyboard -> libretro RetroPad bit (see romdev-core-runner bitToName).
const keyMap = { up: 4, down: 5, left: 6, right: 7, z: 1, x: 0, c: 8, return: 3, rshift: 2 };
// Gamepad: bottom = Genesis A, right = B, top = C, matching the keys.
const buttonMap = { dpadUp: 4, dpadDown: 5, dpadLeft: 6, dpadRight: 7, a: 1, b: 0, y: 8, x: 8, back: 2, guide: 2, start: 3 };

export async function runRom(romPath, opts = {}) {
  const session = await runRomInWindow(romPath, { core, keyMap, buttonMap, scale: 3, ...opts });
  await session.closed;
}
