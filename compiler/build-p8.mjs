// build-p8.mjs - build a real PICO-8 cart (.p8 / .p8.png, or a .lua using the
// full PICO-8 language) to a Genesis ROM through luacretro's dynamic tier.
//
//   cart --luacretro dynamic tier--> C
//   C + luacretro runtime + md-sdk/lc_md.c --romdev-toolchain-m68k-gcc (SGDK)--> .bin
//
// The Genesis has 64 KB of work RAM, so PICO-8 memory is the 32 KB base map
// (no upper memory) and the Lua heap is small: light carts run, heavy ones
// report "not enough memory". Audio: the PICO-8 sequencer drives the PSG.

import { existsSync, readFileSync } from "node:fs";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { compileCart, RUNTIME_SOURCES, RUNTIME_HEADERS } from "luacretro/dyn";
import { buildGenesisC, finalizeGenesisRom, parseBuildLog } from "romdev-toolchain-m68k-gcc";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SDK_DIR = path.resolve(__dirname, "..", "md-sdk");
const RUNTIME_DIR = path.dirname(fileURLToPath(import.meta.resolve("luacretro/runtime/lc.h")));

const CC1 = ["-O2", "-fomit-frame-pointer", "-DLC_P8_MEMSIZE=0x8000u", "-DLC_CO_REGION=2048",
  "-DLC_CO_VREGION=128", "-DLC_SCHED_STACK=512",
  // the fast synth's sequencer drives the PSG (md-sdk/lc_md.c); the smallest walk
  // tables: SGDK allocates its DMA buffers from the RAM left after .bss
  "-DLC_P8SND_FAST", "-DLC_P8SND_ZTAB=1", "-DLC_P8SND_ZSEG=16"];

/** PICO-8 pixel pairs (left pixel in the low nibble) -> VDP order, per halfword */
function swapTableHeader() {
  const out = ["static const u16 lc_md_swap16[65536] = {"];
  const sw = (b) => ((b & 15) << 4) | (b >> 4);
  for (let v = 0; v < 65536; v += 16) {
    const row = [];
    for (let k = v; k < v + 16; k++) row.push(((sw(k >> 8) << 8) | sw(k & 255)));
    out.push(row.join(",") + ",");
  }
  out.push("};");
  return out.join("\n") + "\n";
}

/**
 * @param {string} cartPath
 * @param {string} outPath
 * @param {{debugLines?: boolean, cflags?: string[], audio?: boolean}} [opts]
 */
export async function buildMdCart(cartPath, outPath, opts = {}) {
  const bytes = new Uint8Array(await readFile(cartPath));
  const r = compileCart(bytes, path.basename(cartPath), { debugLines: opts.debugLines, resolveInclude: (p) => { const f = path.resolve(path.dirname(cartPath), p); return existsSync(f) ? readFileSync(f) : null; } });
  if (!r.ok) return { ok: false, stage: "compile", diagnostics: r.diagnostics };
  const sources = { "cart.c": r.c, "lc_md.c": await readFile(path.join(SDK_DIR, "lc_md.c"), "utf8") };
  for (const s of RUNTIME_SOURCES) {
    const name = s === "lc_p8snd.c" && opts.audio === false ? "lc_p8snd_none.c" : s;
    sources[name] = await readFile(path.join(RUNTIME_DIR, name), "utf8");
  }
  const headers = {
    "lc_md_swap16.h": swapTableHeader(),
    "stdint.h": await readFile(path.join(SDK_DIR, "sysinclude", "stdint.h"), "utf8"),
    "stddef.h": await readFile(path.join(SDK_DIR, "sysinclude", "stddef.h"), "utf8"),
  };
  for (const h of RUNTIME_HEADERS) headers[h] = await readFile(path.join(RUNTIME_DIR, h), "utf8");
  const b = await buildGenesisC({ sources, headers, sgdk: true, cc1Options: [...CC1, ...(opts.audio === false ? ["-DMDLUA_AUDIO=0"] : []), ...(opts.cflags ?? [])] });
  if (!b.ok) return { ok: false, stage: b.stage, log: b.log, issues: parseBuildLog ? parseBuildLog(b.log) : null, c: r.c };
  const rom = finalizeGenesisRom(b.binary);
  if (outPath) {
    const abs = path.resolve(outPath);
    await mkdir(path.dirname(abs), { recursive: true });
    await writeFile(abs, rom);
  }
  return { ok: true, binary: rom, outPath: outPath && path.resolve(outPath), c: r.c, map: b.map ?? b.symbols };
}
