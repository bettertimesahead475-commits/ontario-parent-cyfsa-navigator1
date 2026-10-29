import { describe, expect, it } from "vitest";
import { BUNDLED_CYFSA_SOURCE_ID, BundledCyfsaRepository, SupabaseLegalCorpusRepository, corpusSources, lookupCitation } from "./legalCorpusAdapter";
import { normalizeProvisionText, sha256Hex } from "../legalCorpus";
import { caseDateFor, runForensicInvestigation } from "./pipeline";
import type { CaseDocument } from "./caseModel";

const bundled = corpusSources();
const on = (date: string) => ({ kind: "EXACT" as const, date });

describe("legal corpus lookup for engine citations", () => {
  it("finds bundled CYFSA text for the case date, and never treats it as person-verified", async () => {
    const r = await lookupCitation("CYFSA s. 94(1)", on("2026-09-18"), bundled);
    expect(r).toMatchObject({ outcome: "UNVERIFIED_ONLY", requiresResearch: true, effectiveFrom: "2026-07-01", verificationStatus: "COMMITTED_INSPECTION" });
  });

  it("flags a case date before the consolidation that is held", async () => {
    const r = await lookupCitation("CYFSA s. 94(1)", on("2025-03-01"), bundled);
    expect(r).toMatchObject({ outcome: "BEFORE_EARLIEST_VERSION", requiresResearch: true });
  });

  it("reports an unknown case date, an unheld provision, and skips other Acts", async () => {
    expect((await lookupCitation("CYFSA s. 94(1)", { kind: "UNKNOWN" }, bundled))?.outcome).toBe("UNKNOWN_DATE");
    expect((await lookupCitation("CYFSA s. 999(9)", on("2026-09-18"), bundled))?.outcome).toBe("PROVISION_NOT_FOUND");
    expect(await lookupCitation("Family Law Act, s. 24", on("2026-09-18"), bundled)).toBeNull();
    expect(await lookupCitation("CYFSA ss. 94(1) and 94(2)", on("2026-09-18"), bundled)).toBeNull();
  });

  it("bundled provisions carry the exact bundled text with a consistent checksum", async () => {
    const repo = new BundledCyfsaRepository();
    const p = await repo.findProvisionByCitation(BUNDLED_CYFSA_SOURCE_ID, "s.94(1)");
    const [v] = await repo.findProvisionVersions(p!.id);
    expect(v.exactText).toContain("shall not adjourn a hearing for more than 30 days");
    expect(v.textSha256).toBe(sha256Hex(normalizeProvisionText(v.exactText)));
  });

  it("uses a person-verified database version when the corpus is configured, and falls back when its tables are missing", async () => {
    const text = "(1)  The court shall not adjourn a hearing for more than 30 days.";
    const normalized = normalizeProvisionText(text);
    const verifiedDb = {
      from: (table: string) => {
        const chain: any = {
          select: () => chain,
          eq: () => chain,
          maybeSingle: async () => ({ data: { id: "11111111-1111-4111-8111-111111111111", legal_source_id: "22222222-2222-4222-8222-222222222222", citation: "s.94(1)", label: "Adjournments", verification_state: "VERIFIED" }, error: null }),
          then: (resolve: any) =>
            resolve(
              table === "navigator_legal_provision_versions"
                ? { data: [{ id: "33333333-3333-4333-8333-333333333333", provision_id: "11111111-1111-4111-8111-111111111111", legal_source_id: "22222222-2222-4222-8222-222222222222", legal_source_version_id: "44444444-4444-4444-8444-444444444444", effective_from: "2018-04-30", effective_to: null, exact_text: text, normalized_text: normalized, text_sha256: sha256Hex(normalized), verification_status: "VERIFIED", verified_by: "55555555-5555-4555-8555-555555555555", verified_at: "2026-10-01T00:00:00Z" }], error: null }
                : { data: null, error: null }
            ),
        };
        return chain;
      },
    };
    const sources = corpusSources(verifiedDb, { FORENSIC_CORPUS_CYFSA_SOURCE_ID: "22222222-2222-4222-8222-222222222222" });
    const r = await lookupCitation("CYFSA s. 94(1)", on("2026-09-18"), sources);
    expect(r).toMatchObject({ outcome: "RESOLVED_OPEN_ENDED", requiresResearch: false, source: "CYFSA Navigator legal corpus" });

    const missing = { from: () => { const c: any = { select: () => c, eq: () => c, maybeSingle: async () => ({ data: null, error: { code: "PGRST205", message: "table not found" } }) }; return c; } };
    const fallback = await lookupCitation("CYFSA s. 94(1)", on("2026-09-18"), corpusSources(missing, { FORENSIC_CORPUS_CYFSA_SOURCE_ID: "22222222-2222-4222-8222-222222222222" }));
    expect(fallback?.source).toBe("Bundled CYFSA consolidation");
    expect(new SupabaseLegalCorpusRepository(missing)).toBeTruthy();
  });
});

describe("engine findings carry the corpus result", () => {
  it("dates the lookup by the document's own date and notes a date before the consolidation", async () => {
    const docs: CaseDocument[] = [{ id: "e", title: "Endorsement", kind: "ENDORSEMENT", extractionMethod: "TEXT_LAYER", text: "[Page 1]\nEndorsement — March 4, 2025\nMatter adjourned to May 20, 2025." }];
    const generate = async (p: any, model: string) => ({
      model, durationMs: 1, usage: null,
      text:
        p.stage === "forensic_extraction" ? JSON.stringify({ documentDate: { kind: "ENDORSED", isoDate: "2025-03-04", dateText: "March 4, 2025", quote: "Endorsement — March 4, 2025" } })
        : p.stage === "forensic_investigation" ? JSON.stringify({ findings: [{ id: "F1", title: "Adjournment length", statement: "s", evidenceClass: "D", supporting: [{ documentId: "e", quote: "Matter adjourned to May 20, 2025." }], legalIssues: [{ citation: "CYFSA s. 94(1)", nature: "QUESTION_FOR_COUNSEL" }] }] })
        : JSON.stringify({ reviews: [{ findingId: "F1", verdict: "UPHELD" }] }),
    });
    const report = await runForensicInvestigation({ documents: docs, generate, models: { extractor: "s", investigator: "o", reviewer: "o" }, deadlineAt: Date.now() + 60_000, requestId: "r" });
    expect(caseDateFor(report.caseModel)).toEqual({ kind: "EXACT", date: "2025-03-04" });
    const issue = report.findings[0].legalIssues[0];
    expect(issue.corpus).toMatchObject({ outcome: "BEFORE_EARLIEST_VERSION", caseDate: "2025-03-04", effectiveFrom: "2026-07-01" });
    expect(report.findings[0].grounding.notes.join(" ")).toMatch(/before the consolidation held/);
  });
});
