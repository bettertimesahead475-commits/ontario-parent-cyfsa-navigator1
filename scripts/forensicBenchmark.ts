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

/**
 * One spending ledger for the whole run (every system and case). Before a call, its worst case is reserved; after a
 * call, the reservation is replaced by the provider-reported usage. A call that fails after dispatch (timeout,
 * dropped stream, provider error) may still be billed, and its usage is unknown, so its worst case stays charged.
 * Reservations are taken synchronously, so concurrent calls cannot all pass the check against the same balance.
 */
export class SpendLedger {
  private readonly usages = new Set<Record<string, { input_tokens: number; output_tokens: number }>>();
  reservedUsd = 0;
  /** Worst-case cost of calls that failed after dispatch; their real usage was never reported. */
  unreconciledUsd = 0;
  failedCalls = 0;
  constructor(readonly maxSpendUsd: number | null) {}
  track(usage: Record<string, { input_tokens: number; output_tokens: number }>): this {
    this.usages.add(usage);
    return this;
  }
  /** Reconciled spend plus the worst case of failed calls. Excludes in-flight reservations. */
  spentUsd(): number {
    let total = this.unreconciledUsd;
    for (const u of this.usages) total += calculateTotalCumulativeSpend(u);
    return Number(total.toFixed(5));
  }
  reserve(worstCaseUsd: number, describe: () => string): void {
    if (this.maxSpendUsd === null) {
      this.reservedUsd += worstCaseUsd;
      return;
    }
    const spent = this.spentUsd();
    if (spent >= this.maxSpendUsd) {
      throw new Error(`Spending cap reached: cumulative spend $${spent.toFixed(3)} reached cap of $${this.maxSpendUsd.toFixed(2)}. ${describe()}`);
    }
    const potential = spent + this.reservedUsd + worstCaseUsd;
    if (potential > this.maxSpendUsd) {
      throw new Error(
        `Pre-call spending cap violation prevented: cumulative spend is $${spent.toFixed(3)}, in-flight reservations $${this.reservedUsd.toFixed(3)}, and the next call's worst case is $${worstCaseUsd.toFixed(3)}. Total potential spend $${potential.toFixed(3)} would exceed cap of $${this.maxSpendUsd.toFixed(2)}. ${describe()}`
      );
    }
    this.reservedUsd += worstCaseUsd;
  }
  settle(worstCaseUsd: number): void {
    this.reservedUsd = Math.max(0, this.reservedUsd - worstCaseUsd);
  }
  chargeFailed(worstCaseUsd: number): void {
    this.settle(worstCaseUsd);
    this.unreconciledUsd += worstCaseUsd;
    this.failedCalls++;
  }
}

/**
 * The benchmark client must not retry on its own: the SDK's default retries (408/409/429/5xx, connection errors and
 * timeouts) would send billable attempts the ledger never sees. The engine and the legacy analyzer retry through
 * generate, so every attempt is checked.
 */
export function createBenchmarkClient(): Anthropic {
  return new Anthropic({ maxRetries: 0 });
}

export function makeGenerate(
  client: Anthropic,
  usage: Record<string, { input_tokens: number; output_tokens: number }>,
  stageMetrics: Record<string, { latencyMs: number; inputTokens: number; outputTokens: number; calls: number; failedCalls?: number }>,
  maxSpendUsd: number | null,
  ledger: SpendLedger = new SpendLedger(maxSpendUsd)
): GenerateFn {
  ledger.track(usage);
  return async (params, model) => {
    // Fail closed: the model must be priced, and the worst case (input estimate + max_tokens, which includes
    // thinking) must fit in what is left of the cap, counting calls still in flight.
    const { worstCaseCostUsd, estimatedInputTokens, maxOutputTokens } = estimateWorstCaseRequestCost(model, params);
    ledger.reserve(worstCaseCostUsd, () => `Aborting before call to ${model} (~${estimatedInputTokens} input tokens, max ${maxOutputTokens} output tokens).`);

    const stage = String(params.stage || "unknown");
    const sm = (stageMetrics[stage] ??= { latencyMs: 0, inputTokens: 0, outputTokens: 0, calls: 0 });
    let msg: any;
    const started = Date.now();
    try {
      const stream = client.messages.stream(
        {
          model,
          system: params.system,
          messages: params.messages,
          max_tokens: maxOutputTokens,
          ...(buildThinkingRequestFields(model, true) as any),
        },
        { timeout: params.timeoutMs, maxRetries: 0 }
      );
      msg = await stream.finalMessage();
    } catch (err) {
      ledger.chargeFailed(worstCaseCostUsd);
      sm.failedCalls = (sm.failedCalls ?? 0) + 1;
      throw err;
    }
    if (!msg?.usage || typeof msg.usage.input_tokens !== "number" || typeof msg.usage.output_tokens !== "number") {
      ledger.chargeFailed(worstCaseCostUsd);
      sm.failedCalls = (sm.failedCalls ?? 0) + 1;
      throw new Error(`AI Provider response missing required usage token counts for model ${model}. Cannot verify spending.`);
    }
    const text = msg.content.filter((b: any) => b.type === "text").map((b: any) => b.text).join("");
    const u = { input_tokens: msg.usage.input_tokens, output_tokens: msg.usage.output_tokens };
    const durationMs = Date.now() - started;

    // Reconcile: replace the reservation with the provider-reported usage.
    usage[model] = {
      input_tokens: (usage[model]?.input_tokens ?? 0) + u.input_tokens,
      output_tokens: (usage[model]?.output_tokens ?? 0) + u.output_tokens,
    };
    ledger.settle(worstCaseCostUsd);
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

  const client = createBenchmarkClient();
  // One ledger for every system and case: the cap is for the whole run, not per system.
  const ledger = new SpendLedger(maxSpendUsd);
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
    const generate = makeGenerate(client, usage, stageMetrics, maxSpendUsd, ledger);
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
        spendLedger: {
          estimatedSpendUsd: ledger.spentUsd(),
          unreconciledFailedCallUsd: Number(ledger.unreconciledUsd.toFixed(5)),
          failedCalls: ledger.failedCalls,
          note: "Estimated from token prices. Failed calls are counted at their worst case because their usage is unknown. Not an invoice.",
        },
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

