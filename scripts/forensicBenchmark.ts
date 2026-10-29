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
import { buildThinkingRequestFields, calculateEstimatedCost, DEFAULT_FORENSIC_MODEL, DEFAULT_QUICK_MODEL, MODEL_PRICING } from "../api/services/analyzerModels.js";
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

export function estimateInputTokens(params: { system?: string; messages: any[] }): number {
  let charCount = 0;
  if (params.system) {
    charCount += typeof params.system === "string" ? params.system.length : JSON.stringify(params.system).length;
  }
  if (Array.isArray(params.messages)) {
    for (const msg of params.messages) {
      if (typeof msg.content === "string") {
        charCount += msg.content.length;
      } else if (Array.isArray(msg.content)) {
        for (const part of msg.content) {
          if (part && typeof part === "object") {
            if (part.type === "text" && typeof part.text === "string") {
              charCount += part.text.length;
            } else {
              charCount += JSON.stringify(part).length;
            }
          }
        }
      } else if (msg.content) {
        charCount += JSON.stringify(msg.content).length;
      }
    }
  }
  // Conservatively estimate ~3.5 chars per token + 20% safety margin for framing/metadata
  const rawTokens = Math.ceil(charCount / 3.5);
  return Math.ceil(rawTokens * 1.2) + 100;
}

export function estimateWorstCaseRequestCost(
  model: string,
  params: { system?: string; messages: any[]; max_tokens?: number }
): { worstCaseCostUsd: number; estimatedInputTokens: number; maxOutputTokens: number; rates: { inputCostPerMillionUsd: number; outputCostPerMillionUsd: number } } {
  const pricing = MODEL_PRICING[model as keyof typeof MODEL_PRICING];
  if (!pricing) {
    throw new Error(`CRITICAL SPENDING GATE: Model "${model}" has no pricing registered in MODEL_PRICING. Failing closed to prevent unbudgeted API spend.`);
  }

  const estimatedInputTokens = estimateInputTokens(params);
  const maxOutputTokens = params.max_tokens ?? 16000;

  const worstCaseCostUsd =
    (estimatedInputTokens / 1_000_000) * pricing.inputCostPerMillionUsd +
    (maxOutputTokens / 1_000_000) * pricing.outputCostPerMillionUsd;

  return {
    worstCaseCostUsd: Number(worstCaseCostUsd.toFixed(5)),
    estimatedInputTokens,
    maxOutputTokens,
    rates: pricing,
  };
}

export function calculateTotalCumulativeSpend(
  usage: Record<string, { input_tokens: number; output_tokens: number }>
): number {
  let total = 0;
  for (const [m, u] of Object.entries(usage)) {
    if (!MODEL_PRICING[m as keyof typeof MODEL_PRICING]) {
      throw new Error(`CRITICAL SPENDING GATE: Model "${m}" in usage record has no pricing registered in MODEL_PRICING.`);
    }
    total += calculateEstimatedCost(m, u).totalCostUsd;
  }
  return Number(total.toFixed(5));
}

export function makeGenerate(
  client: Anthropic,
  usage: Record<string, { input_tokens: number; output_tokens: number }>,
  stageMetrics: Record<string, { latencyMs: number; inputTokens: number; outputTokens: number; calls: number }>,
  maxSpendUsd: number | null
): GenerateFn {
  return async (params, model) => {
    // 1. Fail-closed: Verify pricing is known and calculate current cumulative spend
    const currentEstimatedSpend = calculateTotalCumulativeSpend(usage);

    // 2. Worst-case pre-call estimation (input tokens + max_tokens cap)
    const { worstCaseCostUsd, estimatedInputTokens, maxOutputTokens } = estimateWorstCaseRequestCost(model, params);

    // 3. Strict Pre-call Budget Check
    if (maxSpendUsd !== null) {
      if (currentEstimatedSpend >= maxSpendUsd) {
        throw new Error(
          `Spending cap reached: cumulative spend $${currentEstimatedSpend.toFixed(3)} reached cap of $${maxSpendUsd.toFixed(2)}. Aborting before call to ${model}.`
        );
      }

      if (currentEstimatedSpend + worstCaseCostUsd > maxSpendUsd) {
        throw new Error(
          `Pre-call spending cap violation prevented: cumulative spend is $${currentEstimatedSpend.toFixed(3)}, and next call worst-case cost is $${worstCaseCostUsd.toFixed(3)} (~${estimatedInputTokens} input tokens, max ${maxOutputTokens} output tokens on ${model}). Total potential spend $${(currentEstimatedSpend + worstCaseCostUsd).toFixed(3)} would exceed cap of $${maxSpendUsd.toFixed(2)}. Aborting call.`
        );
      }
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
    
    if (!msg.usage || typeof msg.usage.input_tokens !== "number" || typeof msg.usage.output_tokens !== "number") {
      throw new Error(`AI Provider response missing required usage token counts for model ${model}. Cannot verify spending.`);
    }

    const u = { input_tokens: msg.usage.input_tokens, output_tokens: msg.usage.output_tokens };
    const durationMs = Date.now() - started;

    // 4. Reconcile provider-reported usage
    usage[model] = {
      input_tokens: (usage[model]?.input_tokens ?? 0) + u.input_tokens,
      output_tokens: (usage[model]?.output_tokens ?? 0) + u.output_tokens,
    };
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

import { fileURLToPath } from "node:url";

const isMainModule = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];

if (isMainModule) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}

