// coverage.test.js - the SGDK-coverage CI gate (PLAN.md §7a: coverage is
// MEASURED, not aspired).
//
//   (a) the ledger must have a row for EVERY function the header parser finds
//       (and no stale rows) - keeps coverage/ledger.json in sync when the SGDK
//       toolchain or the builtins/runtime change; fix by running
//       `node tools/seed-ledger.mjs` and classifying anything new.
//   (b) every "na" entry must carry a nonempty reason - the honest bucket
//       stays honest.
//   (c) the coverage percentage NEVER DECREASES: coverage/baseline.json is the
//       floor. When coverage grows, raise the baseline to the new number from
//       `npm run coverage` in the same commit.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { computeSummary, BASELINE_PATH } from "../tools/coverage-report.mjs";

const summary = computeSummary();

test("ledger has an entry for every SGDK function the parser finds", () => {
  assert.deepEqual(
    summary.unlistedNames,
    [],
    "functions parsed from the SGDK headers but MISSING from coverage/ledger.json " +
      "(run `node tools/seed-ledger.mjs`, then classify the new rows):\n  " +
      summary.unlistedNames.join("\n  ")
  );
  assert.deepEqual(
    summary.staleNames,
    [],
    "ledger rows for functions that no longer exist in the SGDK headers " +
      "(run `node tools/seed-ledger.mjs` to drop them):\n  " +
      summary.staleNames.join("\n  ")
  );
});

test("every na entry has a nonempty reason", () => {
  assert.deepEqual(
    summary.naMissingReason,
    [],
    "na entries without a reason string (na REQUIRES a documented reason):\n  " +
      summary.naMissingReason.join("\n  ")
  );
});

test("nothing the parser saw was dropped silently (unparsed constructs)", () => {
  // Not a hard failure on principle - but today the parser handles 100% of the
  // bundled headers, so any regression here means a toolchain update introduced
  // a construct the parser skips. Triage it (fix the parser or acknowledge the
  // construct) rather than letting the denominator quietly shrink.
  assert.equal(
    summary.total.unparsed,
    0,
    "the header parser hit constructs it could not classify - check the " +
      "`unparsed` lists in coverage/sgdk-inventory.json (node tools/sgdk-coverage.mjs)"
  );
});

test("coverage percentage never decreases (baseline gate)", () => {
  const baseline = JSON.parse(readFileSync(BASELINE_PATH, "utf8"));
  assert.ok(
    summary.percent >= baseline.percent,
    `SGDK coverage DECREASED: ${summary.percent}% (${summary.total.covered}/${summary.denominator}) ` +
      `is below the baseline floor ${baseline.percent}% (${baseline.covered}/${baseline.denominator}). ` +
      "Coverage only goes up - restore the lost coverage (or, if a function was " +
      "legitimately reclassified na with a reason, re-baseline deliberately in the same commit)."
  );
});
