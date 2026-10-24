// Fails the staging workflow unless every expected scenario ran and passed.
// Vitest skips the whole staging suite when credentials are absent, so a green exit code alone proves nothing.
//
//   node scripts/check-staging-results.mjs staging-results.json

import { readFileSync } from "node:fs";

const file = process.argv[2];
const expected = Number(process.env.EXPECTED_SCENARIO_COUNT ?? "6");

function fail(message) {
  console.error(`::error::${message}`);
  process.exit(1);
}

if (!file) fail("usage: check-staging-results.mjs <vitest-json-report>");

let report;
try {
  report = JSON.parse(readFileSync(file, "utf8"));
} catch (err) {
  fail(`could not read the vitest JSON report at ${file}: ${err.message}`);
}

const total = report.numTotalTests ?? 0;
const passed = report.numPassedTests ?? 0;
const failed = report.numFailedTests ?? 0;
const pending = (report.numPendingTests ?? 0) + (report.numTodoTests ?? 0);

const executed = (report.testResults ?? []).flatMap((file) => file.assertionResults ?? []);
const names = executed.map((t) => `${t.status}: ${t.title}`);
console.log(names.join("\n"));

if (failed > 0) fail(`${failed} staging scenario(s) failed.`);
if (pending > 0) fail(`${pending} staging scenario(s) were skipped or pending. Credentials may be missing.`);
if (total !== expected || passed !== expected) {
  fail(`expected ${expected} scenarios to pass, but the report has ${passed} passed of ${total}.`);
}

console.log(`All ${passed} staging scenarios executed and passed.`);
