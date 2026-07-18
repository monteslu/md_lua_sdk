// mdlua compiler entry - binds mdlua's identity + builtins (the curated PICO-8
// verbs + the generated SGDK direct-call table) to the shared luacretro
// front-end.

import { compile as core, formatDiagnostics } from "luacretro";
import { BUILTINS, CALLBACKS } from "./builtins.js";

// The Sega Genesis target descriptor (m68k-gcc / SGDK). Hardware divide, no
// zero page; _update runs at 30fps via an inline odd-frame counter. Its own
// SDK owns this - luacretro knows none of these symbol names.
const TARGET = {
  caps: {
    zpFastcall: false, zpUserFn: false, fixedZp: false,
    banked: false, nativeDiv: true, colorBake: false, framebuffer: true,
    prefix: "md", finalRename: true,
  },
  harness: {
    signature: "int main(bool hard)", voidArg: "(void)hard;",
    init: ["md_init"],
    onAudio: null, onMusic: null, onFps30: null,
    loopTop: ["md_vsync"], frameEnd: "md_endframe",
    fps30Style: "oddCounter", oddVar: "_md_odd", oddDeclFirst: false,
    returns: true, includes: ["md_api.h", "md_math.h"],
  },
};

export function compile(source, file = "main.lua", opts = {}) {
  return core(source, file, {
    sdkName: "mdlua",
    builtins: BUILTINS,
    callbacks: CALLBACKS,
    ...opts,
    target: TARGET,   // the SDK OWNS its target - not overridable by callers
  });
}

export { formatDiagnostics };
