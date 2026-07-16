#!/usr/bin/env node
// mdlua — PICO-8-flavored Lua -> Sega Mega Drive / Genesis ROM.
//   mdlua build <main.lua> [-o game.bin]
//   mdlua c <main.lua>          print the generated C (debugging)
import path from "node:path";
import { readFile } from "node:fs/promises";
import { buildMd } from "../compiler/build-md.mjs";
import { compile, formatDiagnostics } from "../compiler/index.js";

const [cmd, ...rest] = process.argv.slice(2);
const fail = (m) => { console.error(m); process.exit(1); };

if (cmd === "build") {
  const entry = rest.find((a) => !a.startsWith("-"));
  if (!entry) fail("usage: mdlua build <main.lua> [-o game.bin]");
  const oi = rest.indexOf("-o");
  const out = oi >= 0 ? rest[oi + 1] : path.join(path.dirname(entry), "game.bin");
  try {
    const r = await buildMd(entry, out);
    const { statSync } = await import("node:fs");
    console.log(`${r.outPath} (${statSync(r.outPath).size} bytes)`);
  } catch (e) { fail(String(e.message ?? e)); }
} else if (cmd === "c") {
  if (!rest[0]) fail("usage: mdlua c <main.lua>");
  const src = await readFile(rest[0], "utf8");
  const res = compile(src, path.basename(rest[0]), { target: "md" });
  if (!res.ok) fail(formatDiagnostics(res.diagnostics.filter((d) => d.severity === "error")));
  process.stdout.write(res.c + "\n");
} else {
  fail("usage: mdlua build <main.lua> [-o game.bin]\n       mdlua c <main.lua>");
}
