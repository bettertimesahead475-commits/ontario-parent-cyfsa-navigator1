// Fails the staging workflow unless every expected scenario ran and passed.
// Vitest skips the whole staging suite when credentials are absent, so a green exit code alone proves nothing.
//
//   node scripts/check-staging-results.mjs staging-results.json

import { readFileSync } from "node:fs";
import path from "node:path";

const file = process.argv[2];

// Values read from the report are written to the CI log. A line break or "::" in a test title could otherwise
// start a GitHub Actions workflow command; neutralise both and bound the length.
function safe(value) {
  const oneLine = String(value).split(String.fromCharCode(13)).join(" ").split(String.fromCharCode(10)).join(" ");
  return oneLine.split("::").join(": :").slice(0, 300);
}

// The report must be a JSON file inside the working directory.
function reportPath(candidate) {
  const resolved = path.resolve(candidate);
  const root = path.resolve(".") + path.sep;
  if (!resolved.startsWith(root) || path.extname(resolved) !== ".json") fail("the report must be a .json file inside the working directory");
  return resolved;
}
const expected = Number(process.env.EXPECTED_SCENARIO_COUNT ?? "6");

function fail(message) {
  console.error(`::error::${message}`);
  process.exit(1);
}

if (!file) fail("usage: check-staging-results.mjs <vitest-json-report>");

let report;
try {
  report = JSON.parse(readFileSync(reportPath(file), "utf8"));
} catch (err) {
  fail(`could not read the vitest JSON report at ${safe(file)}: ${safe(err.message)}`);
}

const count = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
const total = count(report.numTotalTests);
const passed = count(report.numPassedTests);
const failed = count(report.numFailedTests);
const pending = count(report.numPendingTests) + count(report.numTodoTests);

const executed = (report.testResults ?? []).flatMap((file) => file.assertionResults ?? []);
const names = executed.map((t) => `${safe(t.status)}: ${safe(t.title)}`);
console.log(names.join("\n"));

if (failed > 0) fail(`${failed} staging scenario(s) failed.`);
if (pending > 0) fail(`${pending} staging scenario(s) were skipped or pending. Credentials may be missing.`);
if (total !== expected || passed !== expected) {
  fail(`expected ${expected} scenarios to pass, but the report has ${passed} passed of ${total}.`);
}

console.log(`All ${passed} staging scenarios executed and passed.`);
