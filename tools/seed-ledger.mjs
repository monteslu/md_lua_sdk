// seed-ledger.mjs - (re)build coverage/ledger.json, the SGDK coverage
// classification ledger. Every public SGDK function gets exactly one status:
//
//   "covered" - reachable from Lua: either a builtins-table entry whose C name
//               IS the SGDK symbol (direct-call), or an md-sdk wrapper that a
//               builtin calls reaches it (transitively, through md-sdk-local
//               helpers). Carries `via` = the Lua verb(s), or "harness" when
//               the reach is through the always-emitted frame loop
//               (md_init/md_vsync/md_endframe - every compiled ROM runs them).
//   "planned" - will be covered, not yet. The default.
//   "na"      - not applicable, with a REQUIRED reason. Only the legitimate
//               categories (PLAN.md §7a bucket d): heap (MEM_alloc family),
//               task.h coroutines, sprite_eng_legacy.h (superseded duplicate).
//               (C-macro-only helpers and _underscore internals never enter
//               the inventory, so they need no ledger rows.)
//
// AUTO-DETECTION: imports compiler/builtins.js and applies the emitter's exact
// prefix remaps (/^gt_p8_/ -> "md_", then /^gt_/ -> "md_") to find each verb's
// C entry point, then walks the md-sdk/*.c call graph to see which SGDK
// functions those entry points reach. Emitter specials that call C functions
// without a `c:` field (print/map/sspr) are listed explicitly below - keep
// that list in sync with compiler/emit.js.
//
// MERGE policy on re-run:
//   - auto-detected "covered" always wins over "planned" (coverage only grows)
//   - an existing hand-written entry ("na" with reason, or a hand-marked
//     "covered" for coverage the detector cannot see, e.g. emitter-inlined
//     operators) is preserved unless auto-detection upgrades it to covered.
//
// Usage: node tools/seed-ledger.mjs

import { readFileSync, mkdirSync, writeFileSync, existsSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildInventory, REPO } from "./sgdk-coverage.mjs";
import { BUILTINS } from "../compiler/builtins.js";

export const LEDGER_PATH = path.join(REPO, "coverage/ledger.json");
const MD_SDK = path.join(REPO, "md-sdk");

// The emitter's remap (compiler/emit.js cName + the final remap pass).
const cName = (c) => c.replace(/^gt_p8_/, "md_").replace(/^gt_/, "md_");

// Emitter specials that lower to C calls without a `c:` field in the table
// (see compiler/emit.js: special "print" -> gt_p8_print*, "map" -> gt_p8_map,
// "sspr" -> gt_p8_sspr; mget/mset lower to direct array reads - no C fn).
const SPECIAL_CFNS = {
  print: ["md_print", "md_print_int", "md_print_num", "md_print_cur_str", "md_print_cur_int", "md_print_cur_num"],
  map: ["md_map"],
  sspr: ["md_sspr"],
};

// The frame loop the emitter ALWAYS generates around _init/_update/_draw
// (compiler/emit.js harness). Reached by every compiled Lua program.
const HARNESS_ROOTS = ["md_init", "md_vsync", "md_endframe"];

// ---- N/A rules (the honest bucket - keep SMALL, see PLAN.md §7a) -------------
const NA_HEADERS = {
  // task.h IS covered now: TSK_* are plain SGDK calls, and TSK_userSet takes a
  // VoidCallback* which the "fn" builtin kind binds to a top-level Lua function
  // (&gtl_<name>). Flat ROM makes the indirect call safe. (This is SGDK's task
  // API from Lua - NOT Lua-level coroutines, which the static model still lacks.)
  "sprite_eng_legacy.h":
    "superseded duplicate: legacy sprite engine kept by SGDK for old projects; sprite_eng.h is the covered surface",
};
const NA_FUNCTIONS = {
  "memory.h": {
    reason: "MEM_alloc heap family: mdlua's memory model is fully static (arrays/pools) - no heap",
    names: [
      "MEM_alloc", "MEM_allocAt", "MEM_free", "MEM_pack",
      "MEM_getFree", "MEM_getAllocated", "MEM_getLargestFreeBlock",
      "MEM_checkIntegrity", "MEM_dump",
    ],
  },
};

// ---- md-sdk C call-graph -----------------------------------------------------

/** strip comments + string/char literals, blank preprocessor DIRECTIVE lines
 *  but keep conditional-branch code (union over-approximation).
 *  @param {string} src */
function cleanC(src) {
  let out = "";
  for (let i = 0; i < src.length; ) {
    const c = src[i];
    if (c === "/" && src[i + 1] === "*") {
      const e = src.indexOf("*/", i + 2);
      const stop = e === -1 ? src.length : e + 2;
      for (; i < stop; i++) out += src[i] === "\n" ? "\n" : " ";
    } else if (c === "/" && src[i + 1] === "/") {
      while (i < src.length && src[i] !== "\n") { out += " "; i++; }
    } else if (c === '"' || c === "'") {
      out += c; i++;
      while (i < src.length && src[i] !== c) {
        if (src[i] === "\\") { out += "  "; i += 2; continue; }
        out += src[i] === "\n" ? "\n" : " ";
        i++;
      }
      if (i < src.length) { out += c; i++; }
    } else { out += c; i++; }
  }
  // blank preprocessor lines (incl. continuations) - keeps #ifdef'd CODE
  const lines = out.split("\n");
  let cont = false;
  for (let i = 0; i < lines.length; i++) {
    const dir = /^\s*#/.test(lines[i]);
    if (cont || dir) { cont = /\\\s*$/.test(lines[i]); lines[i] = ""; }
    else cont = false;
  }
  return lines.join("\n");
}

const C_KEYWORDS = new Set([
  "if", "else", "for", "while", "do", "switch", "return", "sizeof", "case",
  "break", "continue", "goto", "typedef", "struct", "enum", "union",
]);

/**
 * Extract function DEFINITIONS (name -> body text) from cleaned C source.
 * File-scope scan: find `name(params) {` at brace depth 0, brace-match body.
 * @param {string} clean
 * @returns {Map<string, string>}
 */
function extractDefinitions(clean) {
  const defs = new Map();
  let depth = 0;
  let buf = "";
  for (let i = 0; i < clean.length; i++) {
    const ch = clean[i];
    if (depth === 0) {
      if (ch === "{") {
        const head = buf.trim();
        const m = /([A-Za-z_][A-Za-z0-9_]*)\s*\([^()]*(?:\([^()]*\)[^()]*)*\)\s*$/.exec(head);
        buf = "";
        if (m && !C_KEYWORDS.has(m[1])) {
          // capture body by brace matching
          let d = 0;
          let j = i;
          for (; j < clean.length; j++) {
            if (clean[j] === "{") d++;
            else if (clean[j] === "}") { d--; if (d === 0) break; }
          }
          defs.set(m[1], clean.slice(i + 1, j));
          i = j; // continue at the closing brace (depth stays 0)
          continue;
        }
        depth++; // not a function header (array initializer etc.)
      } else if (ch === ";") buf = "";
      else buf += ch;
    } else {
      if (ch === "{") depth++;
      else if (ch === "}") depth--;
    }
  }
  return defs;
}

/** all `identifier(` call sites in a body. @param {string} body */
function callSites(body) {
  const out = new Set();
  const re = /\b([A-Za-z_][A-Za-z0-9_]*)\s*\(/g;
  let m;
  while ((m = re.exec(body))) if (!C_KEYWORDS.has(m[1])) out.add(m[1]);
  return out;
}

/** load every md-sdk .c file into one definitions map */
function loadMdSdkDefs() {
  const defs = new Map();
  for (const f of readdirSync(MD_SDK).filter((f) => f.endsWith(".c")).sort()) {
    const fileDefs = extractDefinitions(cleanC(readFileSync(path.join(MD_SDK, f), "utf8")));
    for (const [k, v] of fileDefs) defs.set(k, (defs.get(k) ?? "") + "\n" + v);
  }
  return defs;
}

/**
 * Transitive closure: every function name reachable from `root` through
 * md-sdk-local definitions. Returns the full set of call-site names reached
 * (locals AND externals like SGDK symbols).
 * @param {string} root
 * @param {Map<string,string>} defs
 */
function reachableCalls(root, defs) {
  const seen = new Set();
  const reached = new Set();
  const queue = [root];
  while (queue.length) {
    const fn = queue.pop();
    if (seen.has(fn)) continue;
    seen.add(fn);
    const body = defs.get(fn);
    if (body === undefined) continue; // external (SGDK/libc) - leaf
    for (const callee of callSites(body)) {
      reached.add(callee);
      if (defs.has(callee) && !seen.has(callee)) queue.push(callee);
    }
  }
  return reached;
}

// ---- seeding ------------------------------------------------------------------

export function seedLedger() {
  const inv = buildInventory();
  const defs = loadMdSdkDefs();

  // SGDK name -> [header,...] (legacy duplicates land in both; na wins there)
  const sgdkOwners = new Map();
  for (const [h, p] of Object.entries(inv.headers))
    for (const f of p.functions) {
      if (!sgdkOwners.has(f.name)) sgdkOwners.set(f.name, []);
      sgdkOwners.get(f.name).push(h);
    }

  // detect: "header/name" -> Set(via)
  const detected = new Map();
  const mark = (name, via) => {
    for (const h of sgdkOwners.get(name) ?? []) {
      const key = `${h}/${name}`;
      if (!detected.has(key)) detected.set(key, new Set());
      detected.get(key).add(via);
    }
  };
  const markClosure = (rootCFn, via) => {
    if (sgdkOwners.has(rootCFn)) mark(rootCFn, via); // direct-call builtin
    for (const callee of reachableCalls(rootCFn, defs))
      if (sgdkOwners.has(callee)) mark(callee, via);
  };

  // 1) every builtin verb through its C entry point(s)
  for (const [verb, b] of Object.entries(BUILTINS).sort(([a], [z]) => a.localeCompare(z))) {
    const roots = [];
    if (b.c) roots.push(cName(b.c));
    if (b.special && SPECIAL_CFNS[b.special]) roots.push(...SPECIAL_CFNS[b.special]);
    for (const r of roots) markClosure(r, verb);
  }
  // 2) the always-emitted frame harness (attributed AFTER verbs so a verb
  //    name wins when both reach the same SGDK function)
  for (const r of HARNESS_ROOTS) markClosure(r, "harness");

  // previous ledger (for merge)
  /** @type {Record<string, Record<string, any>>} */
  let prev = {};
  if (existsSync(LEDGER_PATH)) {
    try { prev = JSON.parse(readFileSync(LEDGER_PATH, "utf8")).headers ?? {}; } catch { prev = {}; }
  }

  const headers = {};
  const stats = { covered: 0, planned: 0, na: 0, total: 0 };
  for (const [h, p] of Object.entries(inv.headers)) {
    if (p.functions.length === 0) continue;
    headers[h] = {};
    for (const f of p.functions) {
      const key = `${h}/${f.name}`;
      let entry;
      if (NA_HEADERS[h]) {
        entry = { status: "na", reason: NA_HEADERS[h] };
      } else if (NA_FUNCTIONS[h] && NA_FUNCTIONS[h].names.includes(f.name)) {
        entry = { status: "na", reason: NA_FUNCTIONS[h].reason };
      } else if (detected.has(key)) {
        const vias = [...detected.get(key)];
        // prefer real verbs over "harness" when both reached it
        const verbs = vias.filter((v) => v !== "harness");
        entry = { status: "covered", via: (verbs.length ? verbs : vias).sort().join(",") };
      } else {
        entry = { status: "planned" };
      }
      // merge: preserve hand-written classifications the detector can't see,
      // but let auto-detection upgrade planned -> covered.
      const old = prev[h]?.[f.name];
      if (old && entry.status === "planned" && old.status !== "planned") entry = old;
      headers[h][f.name] = entry;
      stats[entry.status]++;
      stats.total++;
    }
  }

  const ledger = {
    note:
      "SGDK coverage ledger - seeded by tools/seed-ledger.mjs, safe to hand-edit " +
      "(re-runs merge: hand entries are kept unless auto-detection upgrades to covered). " +
      "status: covered (reachable from Lua; via = verb name(s) or 'harness' for the " +
      "always-emitted frame loop) | planned | na (requires reason).",
    toolchain: inv.toolchain,
    headers,
  };
  mkdirSync(path.dirname(LEDGER_PATH), { recursive: true });
  writeFileSync(LEDGER_PATH, JSON.stringify(ledger, null, 2) + "\n");
  return { ledger, stats };
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const { stats } = seedLedger();
  const denom = stats.total - stats.na;
  const pct = denom ? ((stats.covered / denom) * 100).toFixed(2) : "0.00";
  console.log(`ledger seeded: ${path.relative(REPO, LEDGER_PATH)}`);
  console.log(
    `  total ${stats.total} | covered ${stats.covered} | planned ${stats.planned} | na ${stats.na} | ${pct}% of applicable`
  );
}
