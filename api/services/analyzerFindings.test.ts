import { describe, expect, it, vi } from "vitest";
import {
  tempered,
  resolveEvidence,
  resolveAuthorities,
  validateCharter,
  validateVerification,
  validateMissing,
  validateQuestions,
  linkToRedFlags,
  summarizeAuthorities,
  generateInteractiveFindings,
} from "./analyzerFindings.js";
import { runSectionedAnalysis } from "./analyzerSections.js";
import type { GenerateFn } from "./analyzerSections.js";
import { COMPLETE_ANALYSIS } from "../analyzerTestFixtures.js";

const DOC =
  "The worker attended the home on March 3 without a warrant and removed the child from the kitchen. " +
  "The child was placed with a family friend the same evening. No written notice of the right to counsel was given to the mother.";
const ctx = { documentText: DOC, sourceDocument: "Affidavit.pdf", mode: "fast" as const };
const Q1 = "attended the home on March 3 without a warrant";

describe("evidence", () => {
  it("marks a real quote verified and an invented quote unverified", () => {
    const [ok, bad] = resolveEvidence([{ quote: Q1, locationInDocument: "p.1" }, { quote: "The agency admitted it was wrong", locationInDocument: "p.9" }], DOC, "Affidavit.pdf");
    expect(ok.quoteVerified).toBe(true);
    expect(bad.quoteVerified).toBe(false);
    expect(bad.quoteCheck).not.toBe("EXACT");
  });
  it("keeps a location-only reference without inventing a quote", () => {
    const [e] = resolveEvidence([{ locationInDocument: "para 4" }], DOC);
    expect(e.quote).toBeUndefined();
    expect(e.quoteCheck).toBe("NOT_PROVIDED");
  });
  it("ignores junk", () => {
    expect(resolveEvidence("x", DOC)).toEqual([]);
    expect(resolveEvidence([null, 4, {}], DOC)).toEqual([]);
  });
});

describe("authorities", () => {
  it("turns an unknown key into an UNVERIFIED reference with no link", () => {
    const { refs } = resolveAuthorities([{ key: "case-made-up-2031", howItApplies: "x" }], [], {});
    expect(refs[0].status).toBe("UNVERIFIED");
    expect(refs[0].url).toBeUndefined();
  });
  it("never reports VERIFIED without a recorded retrieval check", () => {
    const { refs } = resolveAuthorities([{ key: "charter-s8" }, { key: "case-hunter-1984" }], ["R. v. Grant, 2009 SCC 32"], {});
    expect(refs.length).toBeGreaterThanOrEqual(3);
    expect(refs.every((r) => r.status !== "VERIFIED")).toBe(true);
  });
  it("drops a case that belongs to a different Charter section", () => {
    const { refs, droppedKeys } = resolveAuthorities([{ key: "case-grant-2009" }], [], { section: "12" });
    expect(refs.find((r) => r.key === "case-grant-2009")).toBeUndefined();
    expect(droppedKeys).toContain("case-grant-2009");
  });
  it("tempers conclusive wording", () => {
    expect(tempered("This was a violation of s. 8.")).toMatch(/^Possible, not established:/);
    expect(tempered("This may raise a concern.")).toBe("This may raise a concern.");
  });
});

describe("validateCharter", () => {
  const raw = (over: any = {}) => ({
    charter: [{ section: "8", assessment: "POTENTIAL_CONCERN", plainLanguage: "A home entry without a warrant may raise s. 8.", evidence: [{ quote: Q1, locationInDocument: "p.1" }], authorities: [{ key: "case-hunter-1984" }], ...over }],
  });
  it("keeps a potential concern when the quote is real, and auto-attaches the Charter section", () => {
    const out = validateCharter(raw(), ctx)!;
    expect(out.items[0].assessment).toBe("POTENTIAL_CONCERN");
    expect(out.items[0].authorities.some((a) => a.key === "charter-s8")).toBe(true);
  });
  it("downgrades a concern whose quote is not in the document", () => {
    const out = validateCharter(raw({ evidence: [{ quote: "invented words nobody wrote", locationInDocument: "p.2" }] }), ctx)!;
    expect(out.items[0].assessment).toBe("INSUFFICIENT_INFORMATION");
    expect(out.items[0].missingInformation.join(" ")).toMatch(/word-for-word/);
  });
  it("never produces a violation assessment and drops unsupported sections", () => {
    const out = validateCharter({ charter: [{ section: "8", assessment: "VIOLATION", plainLanguage: "x" }, { section: "11", plainLanguage: "y" }, { section: "2", plainLanguage: "z" }] }, ctx)!;
    expect(out.items).toHaveLength(1);
    expect(out.items[0].assessment).toBe("INSUFFICIENT_INFORMATION");
    expect(out.dropped).toBe(2);
  });
  it("returns null when the list is absent and [] for an empty list", () => {
    expect(validateCharter({}, ctx)).toBeNull();
    expect(validateCharter({ charter: [] }, ctx)!.items).toEqual([]);
  });
});

describe("validateVerification", () => {
  it("downgrades VERIFIED without a real supporting quote and CONTRADICTED without a real contradicting quote", () => {
    const out = validateVerification(
      {
        verification: [
          { claim: "Warrant existed", result: "VERIFIED", supportingPassage: { quote: "a warrant was shown", locationInDocument: "p.1" } },
          { claim: "Child placed same day", result: "CONTRADICTED", contradictoryPassage: { quote: "placed three days later" } },
          { claim: "Child placed with friend", result: "VERIFIED", supportingPassage: { quote: "placed with a family friend the same evening" } },
          { claim: "x", result: "NOT_APPLICABLE" },
          { claim: "y", result: "BOGUS" },
        ],
      },
      ctx
    )!;
    expect(out.items.map((i) => i.result)).toEqual(["INCONCLUSIVE", "INCONCLUSIVE", "VERIFIED", "NOT_APPLICABLE", "UNVERIFIED"]);
    expect(out.items[0].resultNote).toMatch(/Changed from VERIFIED/);
  });
  it("fills the source document from the upload when the model omits it", () => {
    const out = validateVerification({ verification: [{ claim: "c", result: "UNVERIFIED" }] }, ctx)!;
    expect(out.items[0].sourceDocument).toBe("Affidavit.pdf");
  });
});

describe("validateMissing", () => {
  it("never accepts 'confirmed nonexistent' without document support, and never implies misconduct", () => {
    const out = validateMissing({ missing: [{ item: "Warrant", absenceStatus: "CONFIRMED_NONEXISTENT", evidence: [{ quote: "invented" }] }, { item: "Notice", absenceStatus: "CONFIRMED_NONEXISTENT", evidence: [{ quote: "No written notice of the right to counsel was given" }] }, { item: "Other" }] }, ctx)!;
    expect(out.items[0].absenceStatus).toBe("NOT_IN_UPLOADED_MATERIALS");
    expect(out.items[1].absenceStatus).toBe("CONFIRMED_NONEXISTENT");
    expect(out.items[2].absenceBasis).toMatch(/does not show/);
  });
});

describe("validateQuestions", () => {
  it("keeps links only to findings that exist", () => {
    const out = validateQuestions(
      { lawyerQuestions: [{ question: "Was the entry lawful without a warrant?", linkedFindingId: "ch-1", linkedType: "charter" }, { question: "What else should I ask about?", linkedFindingId: "ch-99", linkedType: "charter" }, { question: "short" }] },
      ctx,
      new Set(["ch-1"]),
      new Set()
    )!;
    expect(out.items).toHaveLength(2);
    expect(out.items[0]).toMatchObject({ linkedFindingId: "ch-1", linkedType: "charter", relatedIds: ["ch-1"] });
    expect(out.items[1]).toMatchObject({ linkedType: "general", relatedIds: [] });
    expect(out.items[1].linkedFindingId).toBeUndefined();
  });
});

describe("linking and summary", () => {
  it("links a finding to the red flag that quotes the same passage", () => {
    const [f] = validateCharter({ charter: [{ section: "8", plainLanguage: "p", evidence: [{ quote: Q1 }] }] }, ctx)!.items;
    linkToRedFlags([f], [{ id: "rf-1", phraseDetected: "attended the home on March 3 without a warrant" }, { id: "rf-2", phraseDetected: "something else entirely here" }]);
    expect(f.relatedIds).toEqual(["rf-1"]);
  });
  it("states that no retrieval check is recorded", () => {
    const { refs } = resolveAuthorities([{ key: "charter-s8" }], [], {});
    const s = summarizeAuthorities([{ authorities: refs } as any]);
    expect(s.verifiedCount).toBe(0);
    expect(s.lastRetrievalCheckAt).toBeNull();
    expect(s.limitation).toMatch(/No retrieval check/);
  });
});

const ok = (obj: unknown) => ({ text: JSON.stringify(obj), stopReason: "end_turn", usage: { input_tokens: 10, output_tokens: 5 } });

describe("generateInteractiveFindings", () => {
  const answer = (params: any) => {
    const stage = params.stage as string;
    if (stage === "findings:charter") return ok({ charter: [{ section: "8", assessment: "POTENTIAL_CONCERN", plainLanguage: "Entry without warrant.", evidence: [{ quote: Q1 }] }] });
    if (stage === "findings:verification") return ok({ verification: [{ claim: "Warrant", result: "UNVERIFIED" }] });
    if (stage === "findings:missing") return ok({ missing: [{ item: "Warrant copy" }] });
    if (stage === "findings:lawyerQuestions") return ok({ lawyerQuestions: [{ question: "Was the entry lawful without a warrant?", linkedFindingId: "ch-1", linkedType: "charter" }] });
    throw new Error("unexpected stage " + stage);
  };
  const opts = (generate: GenerateFn) => ({ mode: "fast" as const, documentText: DOC, sourceDocument: "Affidavit.pdf", model: "claude-sonnet-5", generate, deadlineAt: Date.now() + 200_000, requestId: "r1" });

  it("runs both waves and links questions to generated findings", async () => {
    const generate = vi.fn(async (p: any) => answer(p) as any);
    const { findings, usageByModel } = await generateInteractiveFindings(opts(generate));
    expect(generate).toHaveBeenCalledTimes(4);
    expect(findings.sectionStatus).toEqual({ charter: { state: "GENERATED" }, verification: { state: "GENERATED" }, missing: { state: "GENERATED" }, lawyerQuestions: { state: "GENERATED" } });
    expect(findings.lawyerQuestions[0].linkedFindingId).toBe("ch-1");
    expect(usageByModel["claude-sonnet-5"].input_tokens).toBe(40);
  });

  it("soft-fails one section as UNAVAILABLE without losing the others", async () => {
    const generate = vi.fn(async (p: any) => {
      if (p.stage === "findings:missing") return { text: "not json", stopReason: "end_turn" } as any;
      return answer(p) as any;
    });
    const { findings } = await generateInteractiveFindings(opts(generate));
    expect(findings.sectionStatus.missing.state).toBe("UNAVAILABLE");
    expect(findings.sectionStatus.missing.reason).toBeTruthy();
    expect(findings.missing).toEqual([]);
    expect(findings.charter).toHaveLength(1);
  });

  it("reports UNAVAILABLE rather than throwing when the provider fails", async () => {
    const generate = vi.fn(async () => {
      throw new Error("boom");
    });
    const { findings } = await generateInteractiveFindings(opts(generate as any));
    expect(Object.values(findings.sectionStatus).every((s) => s.state === "UNAVAILABLE")).toBe(true);
  });
});

describe("runSectionedAnalysis with findings", () => {
  const base = (generate: GenerateFn) => ({ mode: "fast" as const, documentText: DOC, primaryModel: "claude-sonnet-5", generate, deadlineAt: Date.now() + 200_000, requestId: "r2" });
  const stageOf = (p: any) => String(p.stage || "");

  it("attaches interactiveFindings and leaves the legacy report intact", async () => {
    const generate = vi.fn(async (p: any) => {
      const st = stageOf(p);
      if (st === "findings:charter") return ok({ charter: [] }) as any;
      if (st === "findings:verification") return ok({ verification: [{ claim: "c", result: "UNVERIFIED" }] }) as any;
      if (st === "findings:missing") return ok({ missing: [{ item: "m" }] }) as any;
      if (st === "findings:lawyerQuestions") return ok({ lawyerQuestions: [{ question: "What does this mean for me?" }] }) as any;
      return ok(COMPLETE_ANALYSIS) as any;
    });
    const { report, usageByModel } = await runSectionedAnalysis(base(generate));
    expect(report.interactiveFindings.schemaVersion).toBe(1);
    expect(report.interactiveFindings.verification).toHaveLength(1);
    expect(Array.isArray(report.redFlags)).toBe(true);
    expect(usageByModel["claude-sonnet-5"].input_tokens).toBeGreaterThan(0);
  });

  it("never fails the report when every findings request fails", async () => {
    const generate = vi.fn(async (p: any) => {
      if (stageOf(p).startsWith("findings:")) throw new Error("findings down");
      return ok(COMPLETE_ANALYSIS) as any;
    });
    const { report } = await runSectionedAnalysis(base(generate));
    expect(Array.isArray(report.redFlags)).toBe(true);
    expect(Object.values(report.interactiveFindings.sectionStatus).every((s: any) => s.state === "UNAVAILABLE")).toBe(true);
  });

  it("can be switched off", async () => {
    const generate = vi.fn(async () => ok(COMPLETE_ANALYSIS) as any);
    const { report } = await runSectionedAnalysis({ ...base(generate), interactiveFindings: false });
    expect(report.interactiveFindings).toBeUndefined();
  });
});
