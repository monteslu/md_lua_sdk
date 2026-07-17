// coverage-report.mjs - per-header + total SGDK coverage from the live headers
// and coverage/ledger.json. Percentage = covered / (total - na).
//
//   node tools/coverage-report.mjs           # human table
//   node tools/coverage-report.mjs --json    # machine-readable
//
// Always exits 0 (reporting only - enforcement lives in test/coverage.test.js).

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildInventory, REPO } from "./sgdk-coverage.mjs";

export const LEDGER_PATH = path.join(REPO, "coverage/ledger.json");
export const BASELINE_PATH = path.join(REPO, "coverage/baseline.json");

/** round to 2 decimals (shared with the baseline test - keep in one place) */
export function pct(covered, denom) {
  return denom > 0 ? Math.round((covered / denom) * 10000) / 100 : 0;
}

/**
 * Compute the full coverage summary from the live SGDK headers + the ledger.
 * Functions the parser finds but the ledger lacks are counted as `unlisted`
 * (and included in the planned-side denominator - drift never inflates the
 * percentage); ledger rows for functions that no longer exist are `stale`.
 */
export function computeSummary() {
  const inv = buildInventory();
  const ledger = JSON.parse(readFileSync(LEDGER_PATH, "utf8"));
  const lh = ledger.headers ?? {};

  const headers = {};
  const total = { total: 0, covered: 0, planned: 0, na: 0, unparsed: 0, unlisted: 0, stale: 0 };
  const unlistedNames = [];
  const staleNames = [];
  const naMissingReason = [];

  for (const [h, p] of Object.entries(inv.headers)) {
    if (p.functions.length === 0 && !lh[h]) continue;
    const row = { total: 0, covered: 0, planned: 0, na: 0, unparsed: p.unparsed.length, unlisted: 0, stale: 0 };
    const entries = lh[h] ?? {};
    const seen = new Set();
    for (const f of p.functions) {
      row.total++;
      seen.add(f.name);
      const e = entries[f.name];
      if (!e) {
        row.unlisted++;
        unlistedNames.push(`${h}/${f.name}`);
      } else if (e.status === "covered") row.covered++;
      else if (e.status === "na") {
        row.na++;
        if (typeof e.reason !== "string" || e.reason.trim() === "")
          naMissingReason.push(`${h}/${f.name}`);
      } else row.planned++;
    }
    for (const name of Object.keys(entries))
      if (!seen.has(name)) {
        row.stale++;
        staleNames.push(`${h}/${name}`);
      }
    headers[h] = row;
    for (const k of ["total", "covered", "planned", "na", "unparsed", "unlisted", "stale"]) total[k] += row[k];
  }

  const denominator = total.total - total.na;
  return {
    toolchain: inv.toolchain,
    headers,
    total,
    denominator,
    percent: pct(total.covered, denominator),
    notSurveyed: inv.notSurveyed,
    unlistedNames,
    staleNames,
    naMissingReason,
  };
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const s = computeSummary();

  if (process.argv.includes("--json")) {
    console.log(JSON.stringify(s, null, 2));
    process.exit(0);
  }

  const names = Object.keys(s.headers);
  const w = Math.max(...names.map((n) => n.length), 5) + 2;
  const col = (v) => String(v).padStart(9);
  console.log(`SGDK coverage (${s.toolchain})\n`);
  console.log(`  ${"header".padEnd(w)}${col("total")}${col("covered")}${col("planned")}${col("na")}      %`);
  for (const [h, r] of Object.entries(s.headers)) {
    const denom = r.total - r.na;
    const p = denom > 0 ? pct(r.covered, denom).toFixed(1).padStart(6) + "%" : "      -";
    const flags = [];
    if (r.unlisted) flags.push(`${r.unlisted} UNLISTED`);
    if (r.stale) flags.push(`${r.stale} STALE`);
    if (r.unparsed) flags.push(`${r.unparsed} unparsed`);
    console.log(
      `  ${h.padEnd(w)}${col(r.total)}${col(r.covered)}${col(r.planned)}${col(r.na)}${p}` +
        (flags.length ? `   [${flags.join(", ")}]` : "")
    );
  }
  console.log(
    `\n  ${"TOTAL".padEnd(w)}${col(s.total.total)}${col(s.total.covered)}${col(s.total.planned)}${col(s.total.na)}` +
      `${s.percent.toFixed(1).padStart(6)}%`
  );
  console.log(`\n  coverage = covered / (total - na) = ${s.total.covered}/${s.denominator} = ${s.percent.toFixed(2)}%`);
  console.log(
    `  not yet surveyed: ${s.notSurveyed.dirs.join("/, ")}/ - ${s.notSurveyed.headerCount} headers, ` +
      `~${s.notSurveyed.functionCount} prototypes (excluded from the denominator)`
  );
  if (s.unlistedNames.length)
    console.log(`\n  WARNING - parsed but missing from the ledger (run tools/seed-ledger.mjs):\n    ${s.unlistedNames.join("\n    ")}`);
  if (s.staleNames.length)
    console.log(`\n  WARNING - in the ledger but no longer in the headers:\n    ${s.staleNames.join("\n    ")}`);
  if (s.naMissingReason.length)
    console.log(`\n  WARNING - na entries missing a reason:\n    ${s.naMissingReason.join("\n    ")}`);
  process.exit(0);
}
