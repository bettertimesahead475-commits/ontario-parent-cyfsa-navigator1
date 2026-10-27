#!/usr/bin/env node
// Checks a vitest JSON report of api/services/officialFormFixtureRequirement.test.ts against the manifests.
// It fails unless the run executed exactly the checks the mode requires, with none failing, and every skip is labelled
// with its reason. It proves the gate actually ran. A skipped gate is never reported as a passing gate.
//
// Usage: node scripts/official-forms/assertFixtureGate.mjs <1|retrievable> <vitest-report.json>
// Exit: 0 = the gate ran and passed. 1 = anything else (including a missing or unreadable report).
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
export const GATE_FILE = "officialFormFixtureRequirement.test.ts";

/** The number of checks each mode must execute and the number it must report as skipped. The "1" count covers all pins. */
export function expectedGate(mode, pins, currentPins) {
  if (mode !== "1" && mode !== "retrievable") throw new Error(`unknown mode ${JSON.stringify(mode)}`);
  const total = 1 + pins.length + currentPins.length; // one folder check, then every pin
  const checked = mode === "1"
    ? total
    : 1 + pins.filter(p => p.retrievable === true).length + currentPins.filter(p => p.retrievable !== false).length;
  return { passed: checked, skipped: total - checked, total };
}

/** Returns { ok, problems, counts }. Pure: takes the parsed report and the manifests. */
export function checkGateReport(report, mode, pins, currentPins) {
  const problems = [];
  const expected = expectedGate(mode, pins, currentPins);
  const file = (report?.testResults ?? []).find(r => r.name.endsWith(GATE_FILE));
  if (!file) return { ok: false, problems: [`no results for ${GATE_FILE}; the gate did not run`], counts: null, expected };
  const rows = file.assertionResults ?? [];
  const count = s => rows.filter(a => a.status === s).length;
  const counts = { passed: count("passed"), failed: count("failed"), skipped: count("skipped"), other: rows.length - count("passed") - count("failed") - count("skipped"), total: rows.length };
  if (counts.failed > 0) problems.push(`${counts.failed} gate check(s) failed`);
  if (counts.other > 0) problems.push(`${counts.other} gate check(s) had an unexpected status`);
  if (counts.passed !== expected.passed) problems.push(`expected ${expected.passed} checks to pass in ${mode} mode, got ${counts.passed}`);
  if (counts.skipped !== expected.skipped) problems.push(`expected ${expected.skipped} labelled skips in ${mode} mode, got ${counts.skipped}`);
  for (const a of rows.filter(a => a.status === "skipped")) {
    if (!/\[skipped: [^\]]+\]$/.test(a.title)) problems.push(`skip without a reason: ${a.title}`);
  }
  if (file.status && file.status !== "passed") problems.push(`the gate file reported status ${file.status}`);
  return { ok: problems.length === 0, problems, counts, expected };
}

function main(argv) {
  const [mode, reportPath] = argv;
  if (!mode || !reportPath) {
    console.error("usage: assertFixtureGate.mjs <1|retrievable> <vitest-report.json>");
    return 1;
  }
  let report;
  try {
    report = JSON.parse(readFileSync(resolve(reportPath), "utf8"));
  } catch (e) {
    console.error(`cannot read the gate report: ${e.code ?? e.name}`);
    return 1;
  }
  const pins = JSON.parse(readFileSync(join(here, "manifest.json"), "utf8")).files;
  const currentPins = JSON.parse(readFileSync(join(here, "current-manifest.json"), "utf8")).files;
  const r = checkGateReport(report, mode, pins, currentPins);
  console.log(`fixture gate (${mode}): ${JSON.stringify(r.counts)}; expected ${JSON.stringify(r.expected)}`);
  if (!r.ok) {
    for (const p of r.problems) console.error(`  FAIL: ${p}`);
    return 1;
  }
  console.log("fixture gate PASSED: every required check executed and passed.");
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  process.exitCode = main(process.argv.slice(2));
}
