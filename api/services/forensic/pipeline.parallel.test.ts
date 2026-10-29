import { describe, expect, it } from "vitest";
import type { GenerateFn } from "../analyzerSections";
import type { CaseDocument } from "./caseModel";
import { CheckpointStore, InMemoryObjectStore, type EngineJobMeta } from "./checkpointStore";
import { createEngineState, MAX_PARALLEL_STEPS, nextStep, parallelSteps, runEngineStep, runForensicInvestigation } from "./pipeline";
import { advanceEngine } from "./resumableRunner";

const MODELS = { extractor: "claude-sonnet-5", investigator: "claude-opus-5", reviewer: "claude-opus-5" };
const NAMES = ["Avery", "Blake", "Casey", "Drew", "Emery", "Finley"];
const DOCS: CaseDocument[] = Array.from({ length: 6 }, (_, i) => ({
  id: `d${i}`,
  title: `Document ${i}`,
  kind: "CAS_RECORD" as const,
  extractionMethod: "TEXT_LAYER" as const,
  text: `[Page 1]\nOn March ${i + 1}, 2026 ${NAMES[i]} spoke with the teacher.\nThe teacher told ${NAMES[i]} the child was absent.`,
}));
const docOf = (p: any) => /id="(d\d)"/.exec(String(p.messages[0].content))?.[1] ?? "d0";

/** A provider whose answers depend only on the request, with a delay and an in-flight counter. */
function provider(opts: { delayMs?: number; fail?: (stage: string, doc: string, n: number) => boolean } = {}) {
  let inFlight = 0;
  const peak: Record<string, number> = {};
  const calls: string[] = [];
  const counts: Record<string, number> = {};
  const generate: GenerateFn = async (params, model) => {
    const stage = String(params.stage);
    const doc = docOf(params);
    const key = `${stage}:${doc}`;
    counts[key] = (counts[key] ?? 0) + 1;
    calls.push(key);
    inFlight++;
    peak[stage] = Math.max(peak[stage] ?? 0, inFlight);
    try {
      if (opts.delayMs) await new Promise((r) => setTimeout(r, opts.delayMs));
      if (opts.fail?.(stage, doc, counts[key])) throw Object.assign(new Error("overloaded"), { status: 529 });
      const n = Number(doc.slice(1));
      const text =
        stage === "forensic_extraction"
          ? JSON.stringify({
              people: [{ name: NAMES[n], roles: ["worker"], quote: `${NAMES[n]} spoke with the teacher` }],
              events: [{ description: "Spoke with teacher", isoDate: `2026-03-0${n + 1}`, dateSource: "DOCUMENT_BODY", quote: `On March ${n + 1}, 2026 ${NAMES[n]} spoke with the teacher.` }],
              claims: [{ assertedBy: NAMES[n], statement: "Absent", basis: "NAMED_SOURCE", quote: `The teacher told ${NAMES[n]} the child was absent.` }],
            })
          : stage === "forensic_investigation"
            ? JSON.stringify({ findings: [{ id: "F1", title: `Hearsay in ${NAMES[n]}'s note`, statement: `${NAMES[n]} relays the teacher's account second-hand.`, evidenceClass: "A", supporting: [{ documentId: doc, quote: `The teacher told ${NAMES[n]} the child was absent.` }] }] })
            : stage === "forensic_synthesis"
              ? JSON.stringify({ findings: [] })
              : JSON.stringify({ reviews: [] });
      return { text, model, durationMs: 7, usage: { input_tokens: 100, output_tokens: 10 } };
    } finally {
      inFlight--;
    }
  };
  return { generate, calls, peak, counts };
}

const clock = () => {
  let t = 1_000;
  return () => (t += 1);
};
const MULTI_PASS = { singlePassMaxChars: 10 };

/** The same run with no parallelism: one step at a time. */
async function sequential(generate: GenerateFn, limits = MULTI_PASS) {
  const now = clock();
  let { state, media } = createEngineState({ documents: DOCS, models: MODELS, limits, requestId: "r", now: now() });
  for (let s = nextStep(state); s; s = nextStep(state)) ({ state } = await runEngineStep(state, s, { generate, deadlineAt: Date.now() + 600_000, media, now }));
  return state.report!;
}
/** The report without wall-clock fields, which differ between any two runs. */
const comparable = (r: any) => JSON.parse(JSON.stringify({ ...r, totals: { ...r.totals, durationMs: 0 } }));

describe("independent per-document steps run in parallel", () => {
  it("produces exactly the report a one-step-at-a-time run produces", async () => {
    const parallel = await runForensicInvestigation({ documents: DOCS, generate: provider().generate, models: MODELS, limits: MULTI_PASS, deadlineAt: Date.now() + 600_000, requestId: "r", now: clock() });
    const serial = await sequential(provider().generate);
    expect(comparable(parallel)).toEqual(comparable(serial));
    // Near-identical findings from different documents are merged (rule 9), keeping every document's evidence.
    expect(new Set(parallel.findings.flatMap((f) => f.supporting.map((r) => r.documentId)))).toEqual(new Set(DOCS.map((d) => d.id)));
    expect(parallel.caseModel.people.map((p) => p.id)).toEqual(serial.caseModel.people.map((p) => p.id));
  });

  it("keeps at most MAX_PARALLEL_STEPS calls in flight, and runs extraction and per-document investigation in rounds", async () => {
    const p = provider({ delayMs: 20 });
    await runForensicInvestigation({ documents: DOCS, generate: p.generate, models: MODELS, limits: MULTI_PASS, deadlineAt: Date.now() + 600_000, requestId: "r" });
    expect(p.peak.forensic_extraction).toBe(MAX_PARALLEL_STEPS);
    expect(p.peak.forensic_investigation).toBe(MAX_PARALLEL_STEPS);
    expect(p.peak.forensic_synthesis).toBe(1);
    expect(p.peak.forensic_adversarial_review).toBe(1);
    // Each model call is made once: parallelism adds no calls.
    expect(Object.values(p.counts).every((n) => n === 1)).toBe(true);
    expect(p.calls.length).toBe(DOCS.length * 2 + 2);
  });

  it("never batches more steps than the call budget allows", () => {
    const { state } = createEngineState({ documents: DOCS, models: MODELS, limits: { maxCalls: 2 }, requestId: "r" });
    expect(parallelSteps(state)).toEqual(["extract:d0", "extract:d1"]);
    const { state: single } = createEngineState({ documents: DOCS.slice(0, 1), models: MODELS, requestId: "r" });
    expect(parallelSteps(single)).toEqual(["extract:d0"]);
  });

  it("does not batch steps that depend on earlier ones", () => {
    const { state } = createEngineState({ documents: DOCS, models: MODELS, limits: MULTI_PASS, requestId: "r" });
    state.done = state.plan.filter((s) => s.startsWith("extract:") || s.startsWith("investigate:") || s === "build");
    expect(parallelSteps(state)).toEqual(["synthesize"]);
  });
});

describe("parallel batches in resumable runs", () => {
  const META: EngineJobMeta = { jobId: "job", uid: "u", billing: "paid", sessionId: "s", tier: "Pro", reservationId: "r", billingCycle: null, userEmail: null, documentName: null, mode: "full", createdAt: 0 };
  async function start() {
    const objects = new InMemoryObjectStore();
    const store = new CheckpointStore(objects);
    const { state, media } = createEngineState({ documents: DOCS, models: MODELS, limits: MULTI_PASS, requestId: "job", now: 0 });
    await store.start("job", META, state, media);
    return { store, objects };
  }
  const advance = (store: CheckpointStore, generate: GenerateFn, extra = {}) =>
    advanceEngine({ store, jobId: "job", owner: `w-${Math.random()}`, deps: { generate, deadlineAt: Date.now() + 600_000 }, minModelStepMs: 1_000, leaseTtlMs: 60_000, ...extra });

  it("saves one checkpoint per batch and completes with each call made once", async () => {
    const { store, objects } = await start();
    const p = provider();
    expect((await advance(store, p.generate)).status).toBe("COMPLETE");
    expect(Object.values(p.counts).every((n) => n === 1)).toBe(true);
    const checkpoints = [...objects.objects.keys()].filter((k) => k.includes("/state/")).length - 1;
    // 6 extractions in 2 batches, build, 6 investigations in 2 batches, synthesize, review, visual, ground.
    expect(checkpoints).toBe(2 + 1 + 2 + 4);
  });

  it("retries only the document whose call failed; the rest of its batch is saved", async () => {
    const { store } = await start();
    const p = provider({ fail: (stage, doc, n) => stage === "forensic_extraction" && doc === "d2" && n === 1 });
    expect((await advance(store, p.generate)).status).toBe("COMPLETE");
    expect(p.counts["forensic_extraction:d2"]).toBe(2);
    for (const d of ["d0", "d1", "d3", "d4", "d5"]) expect(p.counts[`forensic_extraction:${d}`]).toBe(1);
    const final = (await store.latest("job"))!.state;
    expect(final.attempts["extract:d2"]).toBe(1);
    expect(final.extraction.people.map((x) => x.name).sort()).toEqual([...NAMES].sort());
  });

  it("runs only the steps whose lease it holds when another worker holds one of them", async () => {
    const { store } = await start();
    await store.acquire("job", "extract:d1", "other-worker", 60_000, Date.now());
    const p = provider();
    const first = await advance(store, p.generate, { maxSteps: 1 });
    expect(first.status).toBe("PENDING");
    // d0 ran; the batch stopped at d1, whose lease another worker holds.
    expect(Object.keys(p.counts)).toEqual(["forensic_extraction:d0"]);
    expect((await advance(store, p.generate, { maxSteps: 1 })).status).toBe("BUSY");
  });
});

describe("what the adversarial review reads", () => {
  it("reads the whole record when it fits, and says nothing", async () => {
    const { reviewDocuments } = await import("./pipeline");
    expect(reviewDocuments(DOCS, [], 1_000_000, 300_000)).toEqual({ docs: DOCS, note: null, notFull: [] });
  });

  it("keeps a large record within its budget, keeps the quoted passages, and says what it did not read", async () => {
    const { reviewDocuments } = await import("./pipeline");
    const { resolveEvidenceRef } = await import("./caseModel");
    const filler = "Unrelated background paragraph. ".repeat(5_000);
    const big = (id: string, quote: string): CaseDocument => ({ id, title: id, kind: "AFFIDAVIT", extractionMethod: "TEXT_LAYER", text: `${filler}${quote}${filler}` });
    const docs = [big("a", "The parent called on September 11."), big("b", "The hearing was set for September 25."), big("c", "Nothing cited here.")];
    const ref = (doc: string, quote: string) => resolveEvidenceRef(docs, doc, quote);
    const findings: any[] = [
      { supporting: [ref("a", "The parent called on September 11.")], contradicting: [ref("b", "The hearing was set for September 25.")] },
    ];
    const budget = 60_000;
    const r = reviewDocuments(docs, findings, budget, 300_000);
    expect(r.docs.map((d) => d.id)).toEqual(["a", "b"]);
    expect(r.docs.reduce((n, d) => n + d.text.length, 0)).toBeLessThanOrEqual(budget);
    expect(r.docs[0].text).toContain("The parent called on September 11.");
    expect(r.docs[1].text).toContain("The hearing was set for September 25.");
    expect(r.note).toMatch(/1 document\(s\) that no finding cites were not re-read/);
    expect(r.note).toMatch(/2 long document\(s\) were reduced to the passages around the quoted text/);
    expect(r.notFull).toEqual(["a", "b", "c"]);
  });

  it("puts the reduction in the report's incompleteness list", async () => {
    const filler = "Background. ".repeat(20_000);
    const docs: CaseDocument[] = [
      { id: "a", title: "A", kind: "AFFIDAVIT", extractionMethod: "TEXT_LAYER", text: `${filler}The worker did not attend.${filler}` },
      { id: "b", title: "B", kind: "CAS_RECORD", extractionMethod: "TEXT_LAYER", text: filler },
    ];
    let reviewChars = 0;
    const generate: GenerateFn = async (params, model) => {
      const stage = String(params.stage);
      if (stage === "forensic_adversarial_review") reviewChars = String(params.messages[0].content).length;
      const text = stage.startsWith("forensic_investigation")
        ? JSON.stringify({ findings: [{ id: "F1", title: "Did not attend", statement: "The worker did not attend.", evidenceClass: "A", supporting: [{ documentId: "a", quote: "The worker did not attend." }] }] })
        : stage === "forensic_adversarial_review" ? JSON.stringify({ reviews: [{ findingId: "a:F1", verdict: "UPHELD" }] }) : "{}";
      return { text, model, durationMs: 1, usage: { input_tokens: 1, output_tokens: 1 } };
    };
    const report = await runForensicInvestigation({ documents: docs, generate, models: MODELS, limits: { singlePassMaxChars: 10, reviewMaxChars: 50_000 }, deadlineAt: Date.now() + 60_000, requestId: "r" });
    expect(reviewChars).toBeLessThan(60_000);
    expect(report.incompleteness.join(" ")).toMatch(/larger than the adversarial review reads in one pass/);
    // Not silently treated as fully reviewed: the record is partial, and the finding says what the review did not read.
    expect(report.status).toBe("PARTIAL");
    const f = report.findings[0];
    expect(f.review.verdict).toBe("UPHELD");
    expect(f.review.partialRecord).toEqual(["A", "B"]);
    expect(f.grounding.notes.join(" ")).toMatch(/review read only part of the record; it did not read in full: A; B/);
    expect(f.uncertainty).not.toBe("LOW");
  });
});
