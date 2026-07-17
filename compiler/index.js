// mdlua compiler entry - binds mdlua's identity + builtins (the curated PICO-8
// verbs + the generated SGDK direct-call table) to the shared luacretro
// front-end.

import { compile as core, formatDiagnostics } from "luacretro";
import { BUILTINS, CALLBACKS } from "./builtins.js";

export function compile(source, file = "main.lua", opts = {}) {
  return core(source, file, {
    target: "md",
    sdkName: "mdlua",
    builtins: BUILTINS,
    callbacks: CALLBACKS,
    ...opts,
  });
}

export { formatDiagnostics };
