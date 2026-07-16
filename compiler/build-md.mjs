// build-md.mjs — mdlua's build orchestrator (spike slice).
//
// Lua -> compile() (the shared PICO-8-dialect front-end + md emitter) -> C
// -> buildGenesisC() (romdev-toolchain-m68k-gcc, the published pipeline)
// -> finalizeGenesisRom() (pad + $18E checksum; REQUIRED for strict loaders)
// -> .bin
//
// Unlike gbalua there is NO romdevtools resolution dance: the driver ships in
// the pinned toolchain package (0.3.0) — the day-one dependency graph is the
// final one.
import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildGenesisC, finalizeGenesisRom, parseBuildLog } from "romdev-toolchain-m68k-gcc";
import { compile, formatDiagnostics } from "./index.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SDK_DIR = path.resolve(__dirname, "..", "md-sdk");

/**
 * Build a mdlua game to a Genesis .bin.
 * @param {string} entryLua  path to main.lua
 * @param {string} outPath   path for the finished ROM
 * @param {object} [opts]
 * @returns {Promise<{ok:boolean, outPath:string, log:string}>}
 */
export async function buildMd(entryLua, outPath, opts = {}) {
  const src = await readFile(entryLua, "utf8");
  const res = compile(src, path.basename(entryLua), { target: "md" });
  const warnings = res.diagnostics.filter((d) => d.severity === "warning");
  if (warnings.length) process.stderr.write(formatDiagnostics(warnings) + "\n");
  if (!res.ok) {
    const errs = res.diagnostics.filter((d) => d.severity === "error");
    throw new Error("mdlua: compile failed\n" + formatDiagnostics(errs));
  }

  const rd = (f) => readFile(path.join(SDK_DIR, f), "utf8");
  const sources = {
    "main.c": res.c,
    "md_api.c": await rd("md_api.c"),
    "md_math.c": await rd("md_math.c"),
  };
  const headers = {
    "md_api.h": await rd("md_api.h"),
    "md_math.h": await rd("md_math.h"),
    "md_sintab.h": await rd("md_sintab.h"),
  };

  const r = await buildGenesisC({ sources, headers, sgdk: true });
  if (!r.ok) {
    const parsed = parseBuildLog ? parseBuildLog(r.log) : null;
    const detail = parsed?.errors?.map((e) => `${e.file}:${e.line}: ${e.message}`).join("\n") || r.log.slice(-2000);
    throw new Error(`mdlua: ${r.stage} failed\n${detail}`);
  }
  const rom = finalizeGenesisRom(r.binary);
  await mkdir(path.dirname(path.resolve(outPath)), { recursive: true });
  await writeFile(outPath, rom);
  return { ok: true, outPath, log: r.log };
}
