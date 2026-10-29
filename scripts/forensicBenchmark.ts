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
import { evaluateTenDimensions, fromEngineFindings, fromLegacyReport, scoreCase, summarize, type BenchmarkCase, type CaseScore, type ForensicDimensionEvaluation } from "../api/services/forensic/evaluation.js";

const CASES_DIR = join(process.cwd(), "eval/forensic/cases");
const RESULTS_DIR = join(process.cwd(), "eval/forensic/results");
const arg = (name: string) => process.argv.find((a) => a.startsWith(`--${name}`));

function loadCases(): BenchmarkCase[] {
  const single = arg("case")?.split("=")[1];
  const multiple = arg("cases")?.split("=")[1]?.split(",");
  const filterList = single ? [single] : multiple;
  return readdirSync(CASES_DIR)
    .filter((f) => f.endsWith(".json"))
    .map((f) => JSON.parse(readFileSync(join(CASES_DIR, f), "utf8")) as BenchmarkCase)
    .filter((c) => !filterList || filterList.includes(c.id));
}

function parseSpendCap(): number | null {
  const raw = arg("max-spend-usd")?.split("=")[1];
  if (!raw) return null;
  const parsed = parseFloat(raw);
  return isNaN(parsed) || parsed < 0 ? 0 : parsed;
}

function makeGenerate(
  client: Anthropic,
  usage: Record<string, { input_tokens: number; output_tokens: number }>,
  stageMetrics: Record<string, { latencyMs: number; inputTokens: number; outputTokens: number; calls: number }>,
  maxSpendUsd: number | null
): GenerateFn {
  return async (params, model) => {
    // Fail-closed spending cap enforcement
    let currentEstimatedSpend = 0;
    for (const [m, u] of Object.entries(usage)) {
      currentEstimatedSpend += calculateEstimatedCost(m, u).totalCostUsd;
    }
    if (maxSpendUsd !== null && currentEstimatedSpend >= maxSpendUsd) {
      throw new Error(`Spending cap exceeded: estimated spend $${currentEstimatedSpend.toFixed(3)} reached cap of $${maxSpendUsd.toFixed(2)}. Aborting run.`);
    }

    const started = Date.now();
    const stage = String(params.stage || "unknown");
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
    const durationMs = Date.now() - started;

    usage[model] = { input_tokens: (usage[model]?.input_tokens ?? 0) + u.input_tokens, output_tokens: (usage[model]?.output_tokens ?? 0) + u.output_tokens };
    const sm = (stageMetrics[stage] ??= { latencyMs: 0, inputTokens: 0, outputTokens: 0, calls: 0 });
    sm.latencyMs += durationMs;
    sm.inputTokens += u.input_tokens;
    sm.outputTokens += u.output_tokens;
    sm.calls++;

    return { text, usage: u, model, durationMs, stopReason: msg.stop_reason ?? undefined };
  };
}

async function main() {
  mkdirSync(RESULTS_DIR, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const out = join(RESULTS_DIR, `${stamp}.json`);
  const cases = loadCases();
  const maxSpendUsd = parseSpendCap();

  if (cases.length === 0) {
    console.error("No matching cases found.");
    process.exit(1);
  }

  if (!process.env.ANTHROPIC_API_KEY) {
    writeFileSync(out, JSON.stringify({ status: "NOT_RUN", reason: "ANTHROPIC_API_KEY is not set.", cases: cases.map((c) => c.id) }, null, 2));
    console.error(`NOT RUN: ANTHROPIC_API_KEY is not set. Wrote ${out}`);
    process.exit(2);
  }

  // Safety gate: Require explicit spending cap for any live run
  if (maxSpendUsd === null) {
    console.error("SECURITY & BUDGET BLOCK: Running a live benchmark requires an explicit spending cap via --max-spend-usd=<amount> (e.g. --max-spend-usd=2.50).");
    process.exit(2);
  }

  const client = new Anthropic();
  const systems = arg("baseline-only") ? ["baseline"] : arg("engine-only") ? ["engine"] : ["engine", "baseline"];
  const results: Record<
    string,
    {
      scores: CaseScore[];
      dimensionalEvaluations: ForensicDimensionEvaluation[];
      usage: Record<string, { input_tokens: number; output_tokens: number }>;
      stageMetrics: Record<string, { latencyMs: number; inputTokens: number; outputTokens: number; calls: number }>;
      latencyMs: number[];
      errors: string[];
      outputs: any[];
    }
  > = {};

  for (const system of systems) {
    const usage: Record<string, { input_tokens: number; output_tokens: number }> = {};
    const stageMetrics: Record<string, { latencyMs: number; inputTokens: number; outputTokens: number; calls: number }> = {};
    const generate = makeGenerate(client, usage, stageMetrics, maxSpendUsd);
    const r = (results[system] = {
      scores: [] as CaseScore[],
      dimensionalEvaluations: [] as ForensicDimensionEvaluation[],
      usage,
      stageMetrics,
      latencyMs: [] as number[],
      errors: [] as string[],
      outputs: [] as any[],
    });

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
          const scored = fromEngineFindings(report.findings);
          r.scores.push(scoreCase(c, scored, report.injectionWarnings.length));
          const caseDurationMs = Date.now() - t0;
          let caseCost = 0;
          for (const s of report.stages) {
            caseCost += calculateEstimatedCost(s.model, { input_tokens: s.inputTokens, output_tokens: s.outputTokens }).totalCostUsd;
          }
          r.dimensionalEvaluations.push(
            evaluateTenDimensions({
              benchmarkCase: c,
              scoredFindings: scored,
              rawReport: report,
              appendixFindings: report.appendix,
              costUsd: caseCost,
              latencyMs: caseDurationMs,
              tokenUsage: { input_tokens: report.totals.inputTokens, output_tokens: report.totals.outputTokens },
            })
          );
          r.outputs.push({ caseId: c.id, status: report.status, incompleteness: report.incompleteness, findings: report.findings, appendix: report.appendix });
        } else {
          const text = c.documents.map((d) => `=== ${d.title} ===\n${d.text}`).join("\n\n");
          const run = await runSectionedAnalysis({
            mode: "full",
            documentText: text,
            primaryModel: DEFAULT_FORENSIC_MODEL,
            verificationModel: DEFAULT_FORENSIC_MODEL,
            generate,
            deadlineAt: Date.now() + 15 * 60_000,
            requestId: `bench-legacy-${c.id}`,
          });
          const scored = fromLegacyReport(run.report, c.documents);
          r.scores.push(scoreCase(c, scored, null));
          const caseDurationMs = Date.now() - t0;
          let caseCost = 0;
          for (const [m, u] of Object.entries(run.usageByModel)) {
            caseCost += calculateEstimatedCost(m, u).totalCostUsd;
          }
          r.dimensionalEvaluations.push(
            evaluateTenDimensions({
              benchmarkCase: c,
              scoredFindings: scored,
              rawReport: run.report,
              costUsd: caseCost,
              latencyMs: caseDurationMs,
            })
          );
          r.outputs.push({ caseId: c.id, redFlags: run.report.redFlags, thresholdAnalysis: run.report.thresholdAnalysis, proceduralTimelineViolations: run.report.proceduralTimelineViolations });
        }
      } catch (err) {
        r.errors.push(`${c.id}: ${err instanceof Error ? err.message : String(err)}`);
      }
      r.latencyMs.push(Date.now() - t0);
      console.error(`[${system}] ${c.id} completed in ${Date.now() - t0} ms`);
    }
  }

  const report = Object.fromEntries(
    Object.entries(results).map(([system, r]) => {
      const estimatedCostUsd = Object.entries(r.usage).reduce((s, [m, u]) => s + calculateEstimatedCost(m, u).totalCostUsd, 0);
      return [
        system,
        {
          summary: summarize(cases, r.scores),
          dimensionalEvaluations: r.dimensionalEvaluations,
          costAccounting: {
            estimatedCostUsd: Number(estimatedCostUsd.toFixed(4)),
            isEstimated: true,
            note: "Calculated via token pricing rates; not invoiced Anthropic billing.",
          },
          stageMetrics: r.stageMetrics,
          latencyMs: r.latencyMs,
          errors: r.errors,
          scores: r.scores,
          usage: r.usage,
          outputs: r.outputs,
        },
      ];
    })
  );

  writeFileSync(
    out,
    JSON.stringify(
      {
        status: "RUN",
        ranAt: new Date().toISOString(),
        spendCapUsd: maxSpendUsd,
        annotation: "Author-annotated synthetic cases; not independently reviewed by counsel.",
        systems: report,
      },
      null,
      2
    )
  );

  for (const [system, r] of Object.entries(report)) {
    console.log(system, JSON.stringify((r as any).summary), `estimated_cost=$${(r as any).costAccounting.estimatedCostUsd.toFixed(2)}`);
  }
  console.log(`Results saved to ${out}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
