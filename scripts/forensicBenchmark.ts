/**
 * Forensic benchmark runner. Runs the Forensic Engine and the existing sectioned analyzer on identical documents,
 * scores both with the same criteria (api/services/forensic/evaluation.ts), and writes a results file.
 *
 *   ANTHROPIC_API_KEY=... npx tsx scripts/forensicBenchmark.ts [--cases id1,id2] [--engine-only] [--baseline-only]
 *
 * This makes paid API calls (Claude Opus). Each case costs several Opus calls per system. Without an API key it
 * writes a NOT_RUN result and exits with code 2; it never reports numbers it did not measure.
 */

import Anthropic from "@anthropic-ai/sdk";
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { buildThinkingRequestFields, calculateEstimatedCost, DEFAULT_FORENSIC_MODEL, DEFAULT_QUICK_MODEL } from "../api/services/analyzerModels.js";
import { runSectionedAnalysis, type GenerateFn } from "../api/services/analyzerSections.js";
import { runForensicInvestigation } from "../api/services/forensic/pipeline.js";
import { fromEngineFindings, fromLegacyReport, scoreCase, summarize, type BenchmarkCase, type CaseScore } from "../api/services/forensic/evaluation.js";

const CASES_DIR = join(process.cwd(), "eval/forensic/cases");
const RESULTS_DIR = join(process.cwd(), "eval/forensic/results");
const arg = (name: string) => process.argv.find((a) => a.startsWith(`--${name}`));

function loadCases(): BenchmarkCase[] {
  const only = arg("cases")?.split("=")[1]?.split(",");
  return readdirSync(CASES_DIR)
    .filter((f) => f.endsWith(".json"))
    .map((f) => JSON.parse(readFileSync(join(CASES_DIR, f), "utf8")) as BenchmarkCase)
    .filter((c) => !only || only.includes(c.id));
}

function makeGenerate(client: Anthropic, usage: Record<string, { input_tokens: number; output_tokens: number }>): GenerateFn {
  return async (params, model) => {
    const started = Date.now();
    const stream = client.messages.stream(
      {
        model,
        system: params.system,
        messages: params.messages,
        max_tokens: params.max_tokens ?? 16000,
        ...(buildThinkingRequestFields(model, true) as any),
      },
      { timeout: params.timeoutMs }
    );
    const msg = await stream.finalMessage();
    const text = msg.content.filter((b: any) => b.type === "text").map((b: any) => b.text).join("");
    const u = { input_tokens: msg.usage.input_tokens, output_tokens: msg.usage.output_tokens };
    usage[model] = { input_tokens: (usage[model]?.input_tokens ?? 0) + u.input_tokens, output_tokens: (usage[model]?.output_tokens ?? 0) + u.output_tokens };
    return { text, usage: u, model, durationMs: Date.now() - started, stopReason: msg.stop_reason ?? undefined };
  };
}

async function main() {
  mkdirSync(RESULTS_DIR, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const out = join(RESULTS_DIR, `${stamp}.json`);
  const cases = loadCases();
  if (!process.env.ANTHROPIC_API_KEY) {
    writeFileSync(out, JSON.stringify({ status: "NOT_RUN", reason: "ANTHROPIC_API_KEY is not set.", cases: cases.map((c) => c.id) }, null, 2));
    console.error(`NOT RUN: ANTHROPIC_API_KEY is not set. Wrote ${out}`);
    process.exit(2);
  }
  const client = new Anthropic();
  const systems = arg("baseline-only") ? ["baseline"] : arg("engine-only") ? ["engine"] : ["engine", "baseline"];
  const results: Record<string, { scores: CaseScore[]; usage: Record<string, { input_tokens: number; output_tokens: number }>; latencyMs: number[]; errors: string[]; outputs: any[] }> = {};

  for (const system of systems) {
    const usage: Record<string, { input_tokens: number; output_tokens: number }> = {};
    const generate = makeGenerate(client, usage);
    const r = (results[system] = { scores: [] as CaseScore[], usage, latencyMs: [] as number[], errors: [] as string[], outputs: [] as any[] });
    for (const c of cases) {
      const t0 = Date.now();
      try {
        if (system === "engine") {
          const report = await runForensicInvestigation({
            documents: c.documents,
            generate,
            models: { extractor: DEFAULT_QUICK_MODEL, investigator: DEFAULT_FORENSIC_MODEL, reviewer: DEFAULT_FORENSIC_MODEL },
            deadlineAt: Date.now() + 15 * 60_000,
            requestId: `bench-${c.id}`,
          });
          r.scores.push(scoreCase(c, fromEngineFindings(report.findings), report.injectionWarnings.length));
          r.outputs.push({ caseId: c.id, status: report.status, incompleteness: report.incompleteness, findings: report.findings, appendix: report.appendix });
        } else {
          const text = c.documents.map((d) => `=== ${d.title} ===\n${d.text}`).join("\n\n");
          const run = await runSectionedAnalysis({ mode: "full", documentText: text, primaryModel: DEFAULT_FORENSIC_MODEL, verificationModel: DEFAULT_FORENSIC_MODEL, generate, deadlineAt: Date.now() + 15 * 60_000, requestId: `bench-legacy-${c.id}` });
          r.scores.push(scoreCase(c, fromLegacyReport(run.report, c.documents), null));
          r.outputs.push({ caseId: c.id, redFlags: run.report.redFlags, thresholdAnalysis: run.report.thresholdAnalysis, proceduralTimelineViolations: run.report.proceduralTimelineViolations });
        }
      } catch (err) {
        r.errors.push(`${c.id}: ${err instanceof Error ? err.message : String(err)}`);
      }
      r.latencyMs.push(Date.now() - t0);
      console.error(`[${system}] ${c.id} done in ${Date.now() - t0} ms`);
    }
  }

  const report = Object.fromEntries(
    Object.entries(results).map(([system, r]) => {
      const cost = Object.entries(r.usage).reduce((s, [m, u]) => s + calculateEstimatedCost(m, u).totalCostUsd, 0);
      return [system, { summary: summarize(cases, r.scores), costUsd: cost, latencyMs: r.latencyMs, errors: r.errors, scores: r.scores, usage: r.usage, outputs: r.outputs }];
    })
  );
  writeFileSync(out, JSON.stringify({ status: "RUN", ranAt: new Date().toISOString(), annotation: "Author-annotated synthetic cases; not independently reviewed.", systems: report }, null, 2));
  for (const [system, r] of Object.entries(report)) console.log(system, JSON.stringify((r as any).summary), `cost=$${(r as any).costUsd.toFixed(2)}`);
  console.log(`Wrote ${out}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
