// gen-sgdk-builtins.mjs — GENERATE the direct-call SGDK builtin table.
//
// mdlua's coverage thesis: expose the ENTIRE SGDK public API as Lua verbs
// under their OWN names (VDP_setTileMapXY, SPR_addSprite, ...) so every SGDK
// tutorial translates 1:1. Most SGDK functions take scalar args (u8/u16/s16/
// u32/bool/enum) and return a scalar or a pointer — both map onto mdlua's
// existing type kinds:
//   - scalar arg  -> "int" kind (fixed args floor via the emitter)
//   - pointer arg/return -> "int" kind too, carrying an OPAQUE HANDLE
//     (m68k int is 32-bit, so a Sprite*/Map* fits): `local s = SPR_addSprite(...)`
//     then `SPR_setPosition(s, x, y)`. No new compiler kind needed.
//   - char* string arg -> "str" (the print path already handles literals)
//
// What this generator does NOT emit (left to the hand-curated PICO-8 verbs and
// the N/A ledger): struct-BY-VALUE params (need a struct value model), the
// heap (MEM_*), coroutines (task.h), the legacy sprite engine, and anything the
// curated builtins already name (those win — merged first in builtins.js).
//
// Output: compiler/builtins-sgdk.js (the SGDK_BUILTINS spread). The C names are
// the raw SGDK symbols; they are NOT gt_-rooted, so the emitter's cName remap
// (gt_*->md_*) leaves them untouched and they link straight to SGDK. The runtime
// declares nothing — SGDK's headers already do.
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildInventory } from "./sgdk-coverage.mjs";
import { CURATED_BUILTINS } from "../compiler/builtins.js";

const REPO = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const OUT = path.join(REPO, "compiler", "builtins-sgdk.js");

// Scalar C types mdlua can pass straight through as the "int" kind (16/32-bit
// integers, bools, and SGDK's scalar enums/typedefs). fix16/fix32 also ride int
// here — the value is a raw SGDK fixed, distinct from mdlua's 16.16; documented.
const SCALAR = new Set([
  "u8", "u16", "u32", "s8", "s16", "s32", "bool", "int", "char",
  "fix16", "fix32", "u64", "s64",
  // SGDK scalar enums / small typedefs used as by-value args:
  "VDPPlane", "TransferMethod", "SoundPCMChannel", "SpriteVisibility",
  "CollisionType", "AnimationLoopMode", "TileSet", "HScrollMode", "VScrollMode",
  "SoundPCMChannelStatus", "PCMSampleRate", "Bool",
  "fastfix16", "fastfix32", "VBlankProcessTime",   // scalar typedefs/enums
  "SoundPcmSampleRate", "SoundPanning", "size_t",  // more scalar enums/ints
]);

// callback pointer typedefs: a *fn ptr param becomes the "fn" builtin kind
// (a bare Lua function name -> &gtl_<name>). SGDK's callback types.
const CALLBACK_TYPES = new Set([
  "VoidCallback", "FrameChangeCallback", "SpriteAnimationCallback",
  "HIntCallback", "VIntCallback", "_voidCallback",
]);

// varargs functions can't be bound (no fixed arity); N/A with a reason.
const VARARGS = new Set(["sprintf", "vsprintf", "kprintf", "SYS_die", "intToStr", "svsprintf"]);

// C types we treat as opaque INT handles when they appear as a POINTER
// (`Sprite*`, `Map*`, `Bitmap*`, ...) — a pointer is a 32-bit value the Lua
// side just holds and passes back.
function stripType(t) {
  return t.replace(/\bconst\b/g, "").replace(/\bvolatile\b/g, "").replace(/\s+/g, " ").trim();
}
function paramType(p) {
  // params are "type name" strings; type is everything before the last token,
  // but pointers can attach to either side ("char* t" / "char *t").
  const s = stripType(typeof p === "string" ? p : `${p.type} ${p.name || ""}`);
  if (s === "void" || s === "") return { base: "void", ptr: 0 };
  const stars = (s.match(/\*/g) || []).length;
  const noStars = s.replace(/\*/g, " ");
  // last word is the param name; the rest is the type
  const toks = noStars.trim().split(/\s+/);
  const type = (toks.length > 1 ? toks.slice(0, -1).join(" ") : toks[0]).trim();
  return { base: type, ptr: stars };
}

// map a param to a mdlua builtin kind, or null if unrepresentable
function kindOf(p) {
  const { base, ptr } = paramType(p);
  if (base === "void" && ptr === 0) return null; // (void) → no params
  if (CALLBACK_TYPES.has(base) && ptr >= 1) return "fn";  // VoidCallback* → callback
  if (ptr >= 1) {
    if (base === "char") return "str";           // char* → string literal
    return "optr";                                // opaque pointer handle (cast to void* at the call)
  }
  // a scalar `bool`/`Bool` param → the "flip" kind, so Lua booleans (true/false)
  // AND ints both pass (SGDK bools are just flags). Plain "int" would reject
  // `false` as "boolean passed where number expected".
  if (base === "bool" || base === "Bool") return "flip";
  if (SCALAR.has(base)) return "int";
  return false;                                   // struct by value → not representable
}

function returnable(ret) {
  const { base, ptr } = paramType(ret);
  if (base === "void" && ptr === 0) return "void";
  if (ptr >= 1) return "int";                     // pointer return → opaque handle
  if (SCALAR.has(base)) return base === "bool" || base === "Bool" ? "bool" : "int";
  return false;                                   // struct return → skip
}

// a valid Lua identifier? (SGDK names are all C identifiers, but guard anyway)
const identOk = (n) => /^[A-Za-z_][A-Za-z0-9_]*$/.test(n);

function generate() {
  const inv = buildInventory();
  const taken = new Set(Object.keys(CURATED_BUILTINS)); // curated verbs win
  const rows = [];
  const skipped = { struct: 0, taken: 0, badname: 0, legacy: 0 };

  for (const [header, data] of Object.entries(inv.headers)) {
    // the legacy sprite engine is a superseded duplicate (N/A in the ledger)
    if (header === "sprite_eng_legacy.h") { skipped.legacy += data.functions.length; continue; }
    for (const fn of data.functions) {
      const name = fn.name;
      if (!identOk(name)) { skipped.badname++; continue; }
      if (taken.has(name)) { skipped.taken++; continue; }
      // heap + task + varargs are N/A (ledger), not direct-called
      if (/^MEM_/.test(name) || VARARGS.has(name)) continue;   // task.h now binds (callbacks)
      // a `...` param in the prototype = varargs; skip (the parser keeps "...")
      if (fn.params.some((p) => (typeof p === "string" ? p : "").includes("..."))) continue;

      const ret = returnable(fn.ret);
      if (ret === false) { skipped.struct++; continue; }
      const params = [];
      let bad = false;
      for (const p of fn.params) {
        const k = kindOf(p);
        if (k === null) continue;                 // (void)
        if (k === false) { bad = true; break; }   // struct-by-value param
        params.push(k);
      }
      if (bad) { skipped.struct++; continue; }

      taken.add(name);
      rows.push({ name, params, ret });
    }
  }

  // emit
  rows.sort((a, b) => a.name.localeCompare(b.name));
  const lines = rows.map((r) => {
    const ps = r.params.map((k) => `["${k}", false]`).join(", ");
    return `  ${r.name}: { params: [${ps}], ret: "${r.ret}", c: "${r.name}", sgdk: true },`;
  });
  const body =
    "// GENERATED by tools/gen-sgdk-builtins.mjs — do not edit by hand.\n" +
    "// The direct-call SGDK surface: every scalar/pointer-handle SGDK function\n" +
    "// exposed under its own name. Curated PICO-8 verbs (builtins.js) win name\n" +
    "// clashes. C names are raw SGDK symbols (no gt_ root -> the emitter's remap\n" +
    "// leaves them alone -> they link straight to the bundled libmd.\n" +
    `// ${rows.length} functions. Regenerate: node tools/gen-sgdk-builtins.mjs\n` +
    "export const SGDK_BUILTINS = {\n" + lines.join("\n") + "\n};\n";
  writeFileSync(OUT, body);
  return { count: rows.length, skipped };
}

const r = generate();
console.log(`generated ${r.count} SGDK direct-call builtins -> compiler/builtins-sgdk.js`);
console.log(`skipped: struct-by-value ${r.skipped.struct}, name-taken ${r.skipped.taken}, legacy ${r.skipped.legacy}`);
