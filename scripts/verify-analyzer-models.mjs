#!/usr/bin/env node
// Read-only check that the analyzer's configured model identifiers are offered by each provider.
//
// It calls the providers' model-listing endpoints only. Those calls are not inference and do not spend model credits.
// It never prints a key, and it skips a provider whose key is not set in the environment.
//
// Usage (keys are read from the environment, never from arguments):
//   ANTHROPIC_API_KEY=... GEMINI_API_KEY=... node scripts/verify-analyzer-models.mjs
//
// Exit code 0: every configured identifier was checked and is listed.
// Exit code 2: nothing was checked, because no provider key was set. This is not a pass.
// Exit code 1: a configured identifier is missing from the provider's list, or a listing request failed.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const modelsSource = readFileSync(join(here, "..", "api", "services", "analyzerModels.ts"), "utf8");

// The identifiers the analyzer is configured to use. Quick and Forensic defaults come from analyzerModels.ts.
const claudeDefaults = {
  quick: modelsSource.match(/DEFAULT_QUICK_MODEL = "([^"]+)"/)?.[1],
  forensic: modelsSource.match(/DEFAULT_FORENSIC_MODEL = "([^"]+)"/)?.[1],
};
const claudeOverrides = {
  quick: process.env.ANTHROPIC_QUICK_MODEL || null,
  forensic: process.env.ANTHROPIC_FORENSIC_MODEL || null,
};
const claudeConfigured = {
  quick: claudeOverrides.quick || claudeDefaults.quick,
  forensic: claudeOverrides.forensic || claudeDefaults.forensic,
};

// Gemini identifiers as they appear in api/_server.ts (OCR and transcription fallback order).
const geminiConfigured = ["gemini-3.1-pro-preview", "gemini-3.6-flash"];

let failed = false;
let checked = 0;

async function listAnthropicModels() {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return { skipped: "ANTHROPIC_API_KEY is not set" };
  const ids = [];
  let url = "https://api.anthropic.com/v1/models?limit=100";
  while (url) {
    const res = await fetch(url, { headers: { "x-api-key": key, "anthropic-version": "2023-06-01" } });
    if (!res.ok) return { error: `Anthropic model list returned HTTP ${res.status}` };
    const body = await res.json();
    for (const m of body.data ?? []) ids.push(m.id);
    url = body.has_more && body.last_id ? `https://api.anthropic.com/v1/models?limit=100&after_id=${encodeURIComponent(body.last_id)}` : null;
  }
  return { ids };
}

async function listGeminiModels() {
  const key = process.env.GEMINI_API_KEY;
  if (!key) return { skipped: "GEMINI_API_KEY is not set" };
  const ids = [];
  let pageToken = "";
  do {
    const url = `https://generativelanguage.googleapis.com/v1beta/models?pageSize=1000${pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : ""}`;
    const res = await fetch(url, { headers: { "x-goog-api-key": key } });
    if (!res.ok) return { error: `Gemini model list returned HTTP ${res.status}` };
    const body = await res.json();
    for (const m of body.models ?? []) ids.push(String(m.name ?? "").replace(/^models\//, ""));
    pageToken = body.nextPageToken ?? "";
  } while (pageToken);
  return { ids };
}

function report(provider, configured, result) {
  if (result.skipped) {
    console.log(`[${provider}] skipped: ${result.skipped}`);
    return;
  }
  if (result.error) {
    failed = true;
    console.log(`[${provider}] ERROR: ${result.error}`);
    return;
  }
  for (const [role, id] of Object.entries(configured)) {
    const listed = result.ids.includes(id);
    checked++;
    if (!listed) failed = true;
    console.log(`[${provider}] ${role} "${id}": ${listed ? "listed by provider" : "NOT listed by provider"}`);
  }
}

report("anthropic", claudeConfigured, await listAnthropicModels());
report(
  "gemini",
  Object.fromEntries(geminiConfigured.map((id, i) => [`ocr fallback ${i + 1}`, id])),
  await listGeminiModels()
);

if (checked === 0 && !failed) {
  console.log("Nothing was verified: no provider key is set. This is not a pass.");
  process.exit(2);
}
process.exit(failed ? 1 : 0);
