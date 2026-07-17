// sgdk-coverage.mjs - parse the bundled SGDK public headers into a function
// inventory. This is the DENOMINATOR of the 100%-SGDK-coverage grind
// (internal-genesislua/PLAN.md §7a): every public prototype in
// node_modules/romdev-toolchain-m68k-gcc/share/genesis/lib/sgdk/include/*.h.
//
// What counts as a function: a public PROTOTYPE (return type + name + params)
// declared at file scope. Skipped on purpose: macros (all preprocessor lines),
// typedefs (including function-pointer typedefs), struct/enum bodies,
// inline-only definitions (recorded in `inlineOnly`, not counted), and any
// name starting with an underscore (compiler/SGDK-internal).
//
// Honesty rule: any construct with a '(' that the classifier cannot
// confidently parse lands in `unparsed` (with its line + text) instead of
// being dropped silently.
//
// The ext/ and snd/ subdirectories are NOT yet part of the coverage
// denominator - they are counted into a separate `notSurveyed` bucket so the
// report can show how much surface is still un-triaged.
//
// Usage:
//   node tools/sgdk-coverage.mjs          # writes coverage/sgdk-inventory.json + prints counts
//   import { buildInventory } from ...    # library use (report + tests)

import { readFileSync, readdirSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const REPO = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
export const SGDK_INCLUDE = path.join(
  REPO,
  "node_modules/romdev-toolchain-m68k-gcc/share/genesis/lib/sgdk/include"
);
export const INVENTORY_PATH = path.join(REPO, "coverage/sgdk-inventory.json");

// Subdirs excluded from the denominator for now (counted separately).
const NOT_SURVEYED_DIRS = ["ext"];   // snd/ (XGM2/PSG) IS surveyed - we use it

// ---- source cleaning (offset/line-preserving) --------------------------------
// Every stripper replaces removed characters with spaces (newlines kept) so
// line numbers stay exact for the inventory.

/** @param {string} src */
function stripComments(src) {
  let out = "";
  let i = 0;
  while (i < src.length) {
    if (src[i] === "/" && src[i + 1] === "*") {
      const end = src.indexOf("*/", i + 2);
      const stop = end === -1 ? src.length : end + 2;
      for (; i < stop; i++) out += src[i] === "\n" ? "\n" : " ";
    } else if (src[i] === "/" && src[i + 1] === "/") {
      while (i < src.length && src[i] !== "\n") { out += " "; i++; }
    } else {
      out += src[i];
      i++;
    }
  }
  return out;
}

/** Blank string and char literals so quotes/parens inside them can't confuse
 *  the scanner. Run AFTER stripComments (comments may hold stray quotes).
 *  @param {string} src */
function blankLiterals(src) {
  let out = "";
  let i = 0;
  while (i < src.length) {
    const q = src[i];
    if (q === '"' || q === "'") {
      out += q;
      i++;
      while (i < src.length && src[i] !== q) {
        if (src[i] === "\\" && i + 1 < src.length) { out += "  "; i += 2; continue; }
        out += src[i] === "\n" ? "\n" : " ";
        i++;
      }
      if (i < src.length) { out += q; i++; }
    } else {
      out += src[i];
      i++;
    }
  }
  return out;
}

/** Blank all preprocessor lines (macros, includes, conditionals), honoring
 *  backslash line continuations. Code BETWEEN #if/#endif is kept - we take
 *  the union of all branches (an over-approximation, which for an inventory
 *  is the honest direction: nothing silently vanishes).
 *  @param {string} src */
function stripPreprocessor(src) {
  const lines = src.split("\n");
  let cont = false;
  for (let i = 0; i < lines.length; i++) {
    const isDirective = /^\s*#/.test(lines[i]);
    if (cont || isDirective) {
      cont = /\\\s*$/.test(lines[i]);
      lines[i] = " ".repeat(lines[i].length);
    } else {
      cont = false;
    }
  }
  return lines.join("\n");
}

// ---- prototype classification --------------------------------------------------

// Storage/qualifier keywords stripped before parsing (SGDK's FORCE_INLINE /
// NO_INLINE / RAM_SECT are #defines and already blanked with the preprocessor
// pass when used in macro form, but appear literally in some sources).
const STRIP_WORDS = /\b(?:extern|static|inline|register|FORCE_INLINE|NO_INLINE|RAM_SECT)\b/g;

/** Remove __attribute__((...)) with balanced parens. @param {string} s */
function stripAttributes(s) {
  let idx;
  while ((idx = s.indexOf("__attribute__")) !== -1) {
    let j = s.indexOf("(", idx);
    if (j === -1) { s = s.slice(0, idx) + s.slice(idx + 13); continue; }
    let depth = 0;
    for (; j < s.length; j++) {
      if (s[j] === "(") depth++;
      else if (s[j] === ")") { depth--; if (depth === 0) { j++; break; } }
    }
    s = s.slice(0, idx) + " " + s.slice(j);
  }
  return s;
}

/** @param {string} s */
function squish(s) {
  return s.replace(/\s+/g, " ").trim();
}

/** Split a parameter list on top-level commas. @param {string} s */
function splitParams(s) {
  const parts = [];
  let depth = 0;
  let cur = "";
  for (const ch of s) {
    if (ch === "(" || ch === "[") depth++;
    else if (ch === ")" || ch === "]") depth--;
    if (ch === "," && depth === 0) { parts.push(cur); cur = ""; }
    else cur += ch;
  }
  parts.push(cur);
  const out = parts.map(squish).filter((p) => p !== "");
  if (out.length === 1 && out[0] === "void") return [];
  return out;
}

/**
 * Classify one file-scope statement. Returns nothing (pushes into out).
 * @param {string} stmt
 * @param {number} line 1-based line of the statement's first token
 * @param {{functions: any[], unparsed: any[]}} out
 */
function classifyStatement(stmt, line, out) {
  let s = squish(stmt);
  if (s === "") return;
  if (!s.includes("(")) return; // variable/array decl - not a function
  if (/^(typedef|struct|enum|union)\b/.test(s)) return; // types (incl. fn-ptr typedefs)
  // array declaration whose SIZE expression holds the only parens, e.g.
  // `extern const fix32 trigtab_f32[(90*4)+1];` - a variable, not a function
  const firstBracket = s.indexOf("[");
  if (firstBracket !== -1 && firstBracket < s.indexOf("(")) return;
  s = squish(stripAttributes(s).replace(STRIP_WORDS, " "));
  // HINTERRUPT_CALLBACK expands to `__attribute__((interrupt)) void`
  s = s.replace(/^HINTERRUPT_CALLBACK\b/, "void");

  const open = s.indexOf("(");
  const head = s.slice(0, open).trim();
  // head = returnType + name; name is the trailing identifier, the rest (which
  // may end in '*'s) is the return type. A head with no return type at all is
  // a macro invocation or something we don't understand -> unparsed.
  const hm = /^(.+?[\s*])([A-Za-z_][A-Za-z0-9_]*)$/.exec(head);
  if (!hm) {
    out.unparsed.push({ line, text: s });
    return;
  }
  const ret = squish(hm[1].replace(/\s*\*\s*/g, "* ")).replace(/\* $/, "*");
  const name = hm[2];
  if (!/^[A-Za-z_][\w\s]*[\w*]$/.test(ret) && !/\*$/.test(ret)) {
    out.unparsed.push({ line, text: s });
    return;
  }
  // find the ')' matching the first '('
  let depth = 0;
  let close = -1;
  for (let i = open; i < s.length; i++) {
    if (s[i] === "(") depth++;
    else if (s[i] === ")") { depth--; if (depth === 0) { close = i; break; } }
  }
  if (close === -1 || s.slice(close + 1).trim() !== "") {
    out.unparsed.push({ line, text: s });
    return;
  }
  if (name.startsWith("_")) return; // compiler/SGDK-internal - skipped by design
  out.functions.push({ name, ret, params: splitParams(s.slice(open + 1, close)), line });
}

/**
 * Parse one header's text into { functions, unparsed, inlineOnly }.
 * @param {string} text
 */
export function parseHeaderText(text) {
  const clean = stripPreprocessor(blankLiterals(stripComments(text)));
  const out = { functions: [], unparsed: [], inlineOnly: [] };

  let buf = "";
  let bufLine = 0; // line of first non-space char in buf
  let line = 1;
  let i = 0;
  const flush = () => { classifyStatement(buf, bufLine, out); buf = ""; bufLine = 0; };
  const skipBraces = () => {
    // i sits ON a '{'; advance past its matching '}' (updating line count)
    let depth = 0;
    for (; i < clean.length; i++) {
      if (clean[i] === "\n") line++;
      else if (clean[i] === "{") depth++;
      else if (clean[i] === "}") { depth--; if (depth === 0) { i++; return; } }
    }
  };

  while (i < clean.length) {
    const ch = clean[i];
    if (ch === "\n") { line++; buf += ch; i++; continue; }
    if (ch === ";") { flush(); i++; continue; }
    if (ch === "{") {
      const t = buf.trim();
      if (/\)\s*$/.test(t) && !/^(typedef|struct|enum|union)\b/.test(t)) {
        // function DEFINITION in a header = inline-only: record, skip body.
        const nm = /([A-Za-z_][A-Za-z0-9_]*)\s*\([^()]*(?:\([^()]*\)[^()]*)*\)\s*$/.exec(t);
        out.inlineOnly.push({ name: nm ? nm[1] : "(unknown)", line: bufLine || line });
        buf = "";
        bufLine = 0;
        skipBraces();
        // swallow a trailing ';' if present (defensive; not required in C)
        while (i < clean.length && /\s/.test(clean[i])) { if (clean[i] === "\n") line++; i++; }
        if (clean[i] === ";") i++;
        continue;
      }
      // struct/enum/union/typedef body: replace with a placeholder so the
      // statement (e.g. `typedef struct {...} Foo;`) still terminates at ';'.
      skipBraces();
      buf += " {} ";
      continue;
    }
    if (bufLine === 0 && !/\s/.test(ch)) bufLine = line;
    buf += ch;
    i++;
  }
  flush(); // trailing statement without ';' (defensive)
  return out;
}

/** Parse one header file. @param {string} absPath */
export function parseHeaderFile(absPath) {
  return parseHeaderText(readFileSync(absPath, "utf8"));
}

/** @returns {string[]} top-level public header names (sorted) */
export function listPublicHeaders() {
  return readdirSync(SGDK_INCLUDE, { withFileTypes: true })
    .filter((e) => e.isFile() && e.name.endsWith(".h"))
    .map((e) => e.name)
    .sort();
}

/** recursively list .h files under dir, as include-relative paths */
function listHeadersUnder(rel) {
  const abs = path.join(SGDK_INCLUDE, rel);
  const out = [];
  let entries;
  try {
    entries = readdirSync(abs, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    const relPath = path.join(rel, e.name);
    if (e.isDirectory()) out.push(...listHeadersUnder(relPath));
    else if (e.name.endsWith(".h")) out.push(relPath);
  }
  return out;
}

function toolchainVersion() {
  try {
    const pkg = JSON.parse(
      readFileSync(path.join(REPO, "node_modules/romdev-toolchain-m68k-gcc/package.json"), "utf8")
    );
    return pkg.version;
  } catch {
    return "unknown";
  }
}

/**
 * Build the full inventory:
 * {
 *   toolchain, include,
 *   headers: { "vdp.h": { functions:[{name,ret,params,line}], unparsed:[], inlineOnly:[] } },
 *   notSurveyed: { dirs, headerCount, functionCount, files: { "ext/x.h": n } }
 * }
 */
export function buildInventory() {
  const headers = {};
  for (const h of listPublicHeaders()) {
    headers[h] = parseHeaderFile(path.join(SGDK_INCLUDE, h));
  }
  // snd/ IS surveyed (XGM2/PSG/PCM are real API we target). Key by "snd/xxx.h".
  for (const rel of listHeadersUnder("snd")) {
    const key = rel.split(path.sep).join("/");
    headers[key] = parseHeaderFile(path.join(SGDK_INCLUDE, rel));
  }

  const notSurveyed = {
    dirs: NOT_SURVEYED_DIRS,
    headerCount: 0,
    functionCount: 0,
    files: {},
  };
  for (const dir of NOT_SURVEYED_DIRS) {
    for (const rel of listHeadersUnder(dir)) {
      const parsed = parseHeaderFile(path.join(SGDK_INCLUDE, rel));
      // inline-only definitions count toward the un-triaged surface too: the
      // survey pass will decide what they are (stb_sprintf is header-only).
      const n = parsed.functions.length + parsed.inlineOnly.length;
      notSurveyed.files[rel.split(path.sep).join("/")] = n;
      notSurveyed.headerCount++;
      notSurveyed.functionCount += n;
    }
  }

  return {
    toolchain: `romdev-toolchain-m68k-gcc@${toolchainVersion()}`,
    include: "node_modules/romdev-toolchain-m68k-gcc/share/genesis/lib/sgdk/include",
    headers,
    notSurveyed,
  };
}

// ---- CLI -------------------------------------------------------------------
const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const inv = buildInventory();
  mkdirSync(path.dirname(INVENTORY_PATH), { recursive: true });
  writeFileSync(INVENTORY_PATH, JSON.stringify(inv, null, 2) + "\n");

  let total = 0;
  let unparsed = 0;
  const w = Math.max(...Object.keys(inv.headers).map((h) => h.length)) + 2;
  console.log(`SGDK header inventory (${inv.toolchain})\n`);
  for (const [h, p] of Object.entries(inv.headers)) {
    total += p.functions.length;
    unparsed += p.unparsed.length;
    const extra = [];
    if (p.unparsed.length) extra.push(`${p.unparsed.length} unparsed`);
    if (p.inlineOnly.length) extra.push(`${p.inlineOnly.length} inline-only (skipped)`);
    console.log(
      `  ${h.padEnd(w)} ${String(p.functions.length).padStart(4)}${extra.length ? "   (" + extra.join(", ") + ")" : ""}`
    );
  }
  console.log(`\n  TOTAL public prototypes: ${total}   (unparsed constructs: ${unparsed})`);
  console.log(
    `  not yet surveyed: ${inv.notSurveyed.dirs.join("/, ")}/ - ` +
      `${inv.notSurveyed.headerCount} headers, ~${inv.notSurveyed.functionCount} prototypes (excluded from the denominator)`
  );
  console.log(`\n  wrote ${path.relative(REPO, INVENTORY_PATH)}`);
}
