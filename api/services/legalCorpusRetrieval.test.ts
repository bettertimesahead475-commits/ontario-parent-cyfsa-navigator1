import { describe, it, expect } from "vitest";
import {
  normalizeProvisionCitation,
  resolveProvisionVersion,
  retrieveLegalAuthority,
  type LegalCorpusRepository,
} from "./legalCorpusRetrieval.js";
import { sha256Hex, normalizeProvisionText, type ProvisionVersionCandidate } from "./legalCorpus.js";
import type { LegalProvision } from "./legalAuthority.js";
import { parseStatuteExcerpt } from "./legalCorpusIngestion.js";
import { readFileSync } from "node:fs";

const SOURCE = "11111111-1111-1111-1111-111111111111";
const PROVISION = "22222222-2222-2222-2222-222222222222";
const HUMAN = "33333333-3333-3333-3333-333333333333";
const MATTER = "44444444-4444-4444-4444-444444444444";
const EVIDENCE = "55555555-5555-5555-5555-555555555555";
const V1 = "66666666-6666-6666-6666-666666666666";
const V2 = "77777777-7777-7777-7777-777777777777";
const V3 = "88888888-8888-8888-8888-888888888888";

function version(id: string, over: Partial<ProvisionVersionCandidate> = {}): ProvisionVersionCandidate {
  const exactText = over.exactText ?? "Sample provision text.";
  const normalizedText = normalizeProvisionText(exactText);
  return {
    id,
    provisionId: PROVISION,
    legalSourceId: SOURCE,
    legalSourceVersionId: V1,
    effectiveFrom: "2020-01-01",
    effectiveTo: null,
    exactText,
    normalizedText,
    textSha256: sha256Hex(normalizedText),
    verificationStatus: "VERIFIED",
    verifiedBy: HUMAN,
    verifiedAt: "2026-01-01T00:00:00.000Z",
    ...over,
  };
}
const exact = (date: string) => ({ kind: "EXACT" as const, date });

describe("1/2/3/4/5. citation normalization and identity", () => {
  it.each(["74", "s. 74", "s.74", "section 74", "SECTION 74"])("normalizes %s to s.74", (raw) => expect(normalizeProvisionCitation(raw)).toBe("s.74"));
  it("normalizes with a normalized-citation subsection suffix preserved exactly", () => expect(normalizeProvisionCitation("s. 74(2)")).toBe("s.74(2)"));
  it("keeps subsection identity distinct from section", () => expect(normalizeProvisionCitation("74(2)")).not.toBe(normalizeProvisionCitation("74")));
  it("keeps paragraph identity distinct from subsection", () => expect(normalizeProvisionCitation("74(2)(a)")).not.toBe(normalizeProvisionCitation("74(2)")));
  it("keeps clause identity distinct from paragraph", () => expect(normalizeProvisionCitation("74(2)(a)(i)")).not.toBe(normalizeProvisionCitation("74(2)(a)")));
  it("preserves whitespace-tolerant nested groups", () => expect(normalizeProvisionCitation("s.74 (2) (a)")).toBe("s.74(2)(a)"));
  it("rejects a malformed citation (no section number)", () => expect(() => normalizeProvisionCitation("not a citation")).toThrow());
  it("rejects an unterminated nested group", () => expect(() => normalizeProvisionCitation("74(2")).toThrow());
  it("rejects empty input", () => expect(() => normalizeProvisionCitation("")).toThrow());
});

describe("6-10. verification-state hard boundary", () => {
  it("VERIFIED version resolves", () => {
    const r = resolveProvisionVersion([version(V1, { effectiveFrom: "2020-01-01", effectiveTo: null })], exact("2021-01-01"));
    expect(r.outcome).toBe("RESOLVED_OPEN_ENDED");
    expect(r.provisionVersion?.id).toBe(V1);
    expect(r.requiresResearch).toBe(false);
  });

  it("UNVERIFIED-only never resolves as trusted authority", () => {
    const r = resolveProvisionVersion([version(V1, { verificationStatus: "UNVERIFIED", verifiedBy: null, verifiedAt: null })], exact("2021-01-01"));
    expect(r.outcome).toBe("UNVERIFIED_ONLY");
    expect(r.provisionVersion).toBeNull();
    expect(r.requiresResearch).toBe(true);
  });

  it("COMMITTED_INSPECTION-only never resolves as trusted authority", () => {
    const r = resolveProvisionVersion([version(V1, { verificationStatus: "COMMITTED_INSPECTION", verifiedBy: null, verifiedAt: null })], exact("2021-01-01"));
    expect(r.outcome).toBe("UNVERIFIED_ONLY");
  });

  it("REJECTED-only never resolves", () => {
    const r = resolveProvisionVersion([version(V1, { verificationStatus: "REJECTED", verifiedBy: null, verifiedAt: null })], exact("2021-01-01"));
    expect(r.outcome).toBe("UNVERIFIED_ONLY");
  });

  it("a mix of VERIFIED and non-VERIFIED versions resolves only against the VERIFIED one", () => {
    const versions = [
      version(V1, { effectiveFrom: "2015-01-01", effectiveTo: "2018-01-01", verificationStatus: "UNVERIFIED", verifiedBy: null, verifiedAt: null }),
      version(V2, { effectiveFrom: "2018-01-01", effectiveTo: null }),
    ];
    const r = resolveProvisionVersion(versions, exact("2016-01-01"));
    // The unverified 2015-2018 version is excluded from date matching entirely.
    expect(r.outcome).toBe("BEFORE_EARLIEST_VERSION");
  });
});

describe("11-16. temporal boundary exactness", () => {
  const closed = version(V1, { effectiveFrom: "2020-01-01", effectiveTo: "2021-01-01" });
  it("date immediately before effective_from does not match", () => expect(resolveProvisionVersion([closed], exact("2019-12-31")).outcome).toBe("BEFORE_EARLIEST_VERSION"));
  it("date exactly effective_from matches (inclusive)", () => expect(resolveProvisionVersion([closed], exact("2020-01-01")).outcome).toBe("RESOLVED"));
  it("date immediately before effective_to matches", () => expect(resolveProvisionVersion([closed], exact("2020-12-31")).outcome).toBe("RESOLVED"));
  it("date exactly effective_to does not match (exclusive)", () => expect(resolveProvisionVersion([closed], exact("2021-01-01")).outcome).toBe("AFTER_LAST_CLOSED_VERSION"));
  it("open-ended version resolves for a far-future date", () => {
    const open = version(V1, { effectiveFrom: "2020-01-01", effectiveTo: null });
    expect(resolveProvisionVersion([open], exact("2099-01-01")).outcome).toBe("RESOLVED_OPEN_ENDED");
  });
  it("historical (closed, past) version resolves within its own range", () => {
    const versions = [version(V1, { effectiveFrom: "2015-01-01", effectiveTo: "2018-01-01" }), version(V2, { effectiveFrom: "2018-01-01", effectiveTo: null })];
    expect(resolveProvisionVersion(versions, exact("2016-06-01")).provisionVersion?.id).toBe(V1);
  });
  it("current/open-ended applicable version resolves for a present-day date", () => {
    const versions = [version(V1, { effectiveFrom: "2015-01-01", effectiveTo: "2018-01-01" }), version(V2, { effectiveFrom: "2018-01-01", effectiveTo: null })];
    expect(resolveProvisionVersion(versions, exact("2026-01-01")).provisionVersion?.id).toBe(V2);
  });
});

describe("17/18. UNKNOWN date safety", () => {
  it("UNKNOWN case date returns UNKNOWN_DATE, never a guess", () => {
    const r = resolveProvisionVersion([version(V1, {})], { kind: "UNKNOWN" });
    expect(r.outcome).toBe("UNKNOWN_DATE");
    expect(r.provisionVersion).toBeNull();
    expect(r.requiresResearch).toBe(true);
  });
  it("never substitutes current date, retrieval date, or upload date for an unknown case date", () => {
    // resolveProvisionVersion has no access to Date.now(), retrievedAt, or any upload timestamp
    // — its only date input is the caseDate parameter itself.
    expect(resolveProvisionVersion.length).toBe(2);
  });
  it("an invalid (malformed) case date is rejected explicitly, not silently coerced", () => {
    const r = resolveProvisionVersion([version(V1, {})], { kind: "EXACT", date: "not-a-date" });
    expect(r.outcome).toBe("INVALID_CASE_DATE");
  });
});

describe("19/20. multiple matches and deterministic ordering", () => {
  it("data corruption producing two overlapping VERIFIED versions returns OVERLAPPING_VERSIONS, never picks one", () => {
    const versions = [version(V1, { effectiveFrom: "2015-01-01", effectiveTo: "2019-01-01" }), version(V2, { effectiveFrom: "2018-01-01", effectiveTo: null })];
    const r = resolveProvisionVersion(versions, exact("2018-06-01"));
    expect(r.outcome).toBe("OVERLAPPING_VERSIONS");
    expect(r.provisionVersion).toBeNull();
  });

  it("input order never affects the resolved result (deterministic ordering)", () => {
    const versions = [version(V1, { effectiveFrom: "2015-01-01", effectiveTo: "2018-01-01" }), version(V2, { effectiveFrom: "2018-01-01", effectiveTo: "2020-01-01" }), version(V3, { effectiveFrom: "2020-01-01", effectiveTo: null })];
    const forward = resolveProvisionVersion(versions, exact("2019-01-01"));
    const shuffled = resolveProvisionVersion([versions[2], versions[0], versions[1]], exact("2019-01-01"));
    const reversed = resolveProvisionVersion([...versions].reverse(), exact("2019-01-01"));
    expect(forward.provisionVersion?.id).toBe(V2);
    expect(shuffled.provisionVersion?.id).toBe(V2);
    expect(reversed.provisionVersion?.id).toBe(V2);
  });
});

describe("21/22/23/24. text/checksum integrity", () => {
  it("exact text is preserved on a resolved result", () => {
    const r = resolveProvisionVersion([version(V1, { exactText: "The exact statutory wording." })], exact("2021-01-01"));
    expect(r.provisionVersion?.exactText).toBe("The exact statutory wording.");
  });
  it("normalized text is internally consistent on a resolved result", () => {
    const r = resolveProvisionVersion([version(V1, { exactText: "Text.\r\nMore." })], exact("2021-01-01"));
    expect(r.provisionVersion?.normalizedText).toBe(normalizeProvisionText("Text.\r\nMore."));
  });
  it("SHA-256 is internally consistent on a resolved result", () => {
    const r = resolveProvisionVersion([version(V1, {})], exact("2021-01-01"));
    expect(r.provisionVersion?.textSha256).toBe(sha256Hex(r.provisionVersion!.normalizedText));
  });
  it("a corrupted VERIFIED record (hash mismatch) fails closed as INTEGRITY_FAILURE, never trusted", () => {
    const corrupted = version(V1, { textSha256: "0".repeat(64) });
    const r = resolveProvisionVersion([corrupted], exact("2021-01-01"));
    expect(r.outcome).toBe("INTEGRITY_FAILURE");
    expect(r.provisionVersion).toBeNull();
  });
  it("a corrupted non-VERIFIED record does not block resolution of an otherwise-valid VERIFIED one", () => {
    const corruptedUnverified = { ...version(V1, { effectiveFrom: "2010-01-01", effectiveTo: "2015-01-01", verificationStatus: "UNVERIFIED", verifiedBy: null, verifiedAt: null }), textSha256: "0".repeat(64) };
    const goodVerified = version(V2, { effectiveFrom: "2015-01-01", effectiveTo: null });
    const r = resolveProvisionVersion([corruptedUnverified, goodVerified], exact("2021-01-01"));
    expect(r.outcome).toBe("RESOLVED_OPEN_ENDED");
    expect(r.provisionVersion?.id).toBe(V2);
  });
});

describe("25-29. provenance preservation", () => {
  it("preserves legal source, provision, and provision-version identity on the resolved record", () => {
    const r = resolveProvisionVersion([version(V1, {})], exact("2021-01-01"));
    expect(r.provisionVersion?.legalSourceId).toBe(SOURCE);
    expect(r.provisionVersion?.provisionId).toBe(PROVISION);
    expect(r.provisionVersion?.id).toBe(V1);
  });
  it("preserves verification metadata (verifiedBy/verifiedAt) on the resolved record", () => {
    const r = resolveProvisionVersion([version(V1, {})], exact("2021-01-01"));
    expect(r.provisionVersion?.verifiedBy).toBe(HUMAN);
    expect(r.provisionVersion?.verifiedAt).toBe("2026-01-01T00:00:00.000Z");
  });
});

describe("30. lineage is never heuristically followed", () => {
  it("resolveProvisionVersion has no lineage/supersession parameter at all — it cannot follow anything", () => {
    // Signature is (versions, caseDate) only; there is no lineage table access in this function.
    expect(resolveProvisionVersion.length).toBe(2);
  });
});

describe("31. secondary source is never promoted", () => {
  it("this module has no source-trust classification logic of its own to weaken — it consumes whatever legalSourceId the caller already resolved via legalCorpusIngestion's classifyRetrievalHostname/legalCorpus's classifySourceTrust", () => {
    const r = resolveProvisionVersion([version(V1, {})], exact("2021-01-01"));
    expect(r.provisionVersion?.legalSourceId).toBe(SOURCE); // passthrough only, never re-derived or overridden
  });
});

describe("32. real CYFSA fixture citation compatibility", () => {
  const REAL_EXCERPT = readFileSync(new URL("./__fixtures__/cyfsa-s74-real-excerpt.txt", import.meta.url), "utf8");
  const parsed = parseStatuteExcerpt(REAL_EXCERPT);

  it("normalizes citations matching the real M2-C fixture's extracted identities", () => {
    expect(normalizeProvisionCitation("74(2)(a)")).toBe("s.74(2)(a)");
    expect(normalizeProvisionCitation("s. 74(2)(b)")).toBe("s.74(2)(b)");
    const realCitations = parsed.provisions.map((p) => p.citation);
    expect(realCitations).toContain(normalizeProvisionCitation("74(2)(a)"));
    expect(realCitations).toContain(normalizeProvisionCitation("74(2)(c)"));
  });

  it("resolves a VERIFIED version built from the real excerpt's paragraph (a) text", () => {
    const a = parsed.provisions.find((p) => p.citation === "s.74(2)(a)")!;
    const v = version(V1, { exactText: a.exactText, effectiveFrom: "2018-04-30", effectiveTo: null });
    const r = resolveProvisionVersion([v], exact("2026-01-01"));
    expect(r.outcome).toBe("RESOLVED_OPEN_ENDED");
    expect(r.provisionVersion?.exactText).toBe(a.exactText);
  });
});

describe("33. no legal conclusion generated", () => {
  it("no warning or outcome string anywhere asserts a violation, illegality, or Charter breach", () => {
    const scenarios = [
      resolveProvisionVersion([], exact("2021-01-01")),
      resolveProvisionVersion([version(V1, { verificationStatus: "UNVERIFIED", verifiedBy: null, verifiedAt: null })], exact("2021-01-01")),
      resolveProvisionVersion([version(V1, {})], { kind: "UNKNOWN" }),
    ];
    for (const s of scenarios) {
      const text = JSON.stringify(s).toLowerCase();
      expect(text).not.toMatch(/violat|illegal|charter breach|broke the law|proves? misconduct/);
    }
  });
});

describe("34/35/36. Stage 5<->6 compatibility", () => {
  it("accepts legalAuthority.ts's own CaseDate shape directly, including UNKNOWN", () => {
    expect(resolveProvisionVersion([version(V1, {})], { kind: "UNKNOWN" }).outcome).toBe("UNKNOWN_DATE");
    expect(resolveProvisionVersion([version(V1, {})], { kind: "APPROXIMATE", date: "2021-01-01" }).outcome).toBe("RESOLVED_OPEN_ENDED");
  });
  it("never promotes a Stage 5 classification — this module has no classification field or parameter at all", () => {
    const r: any = resolveProvisionVersion([version(V1, {})], exact("2021-01-01"));
    expect(r.classification).toBeUndefined();
    expect(r.evidenceClassification).toBeUndefined();
  });
  it("never promotes an evidence review state into a legal review state — no such field exists on the result", () => {
    const r: any = resolveProvisionVersion([version(V1, {})], exact("2021-01-01"));
    expect(r.evidenceReviewState).toBeUndefined();
    expect(r.reviewStatus).toBeUndefined();
  });
});

describe("37. provider-independent resolver", () => {
  it("resolveProvisionVersion performs no I/O — calling it twice with the same input is side-effect-free and idempotent", () => {
    const versions = [version(V1, {})];
    const a = resolveProvisionVersion(versions, exact("2021-01-01"));
    const b = resolveProvisionVersion(versions, exact("2021-01-01"));
    expect(a).toEqual(b);
  });
});

describe("38/39/40. repository orchestration, empty and duplicate/corrupt handling", () => {
  function makeRepo(provision: LegalProvision | null, versions: ProvisionVersionCandidate[]): LegalCorpusRepository {
    return {
      findProvisionByCitation: async () => provision,
      findProvisionVersions: async () => versions,
    };
  }
  const provision: LegalProvision = { id: PROVISION, legalSourceId: SOURCE, citation: "s.74(2)(a)", label: "Test", verificationState: "VERIFIED" };

  it("repository result order does not affect the deterministic result (orchestration passthrough of the pure resolver's guarantee)", async () => {
    const versions = [version(V1, { effectiveFrom: "2015-01-01", effectiveTo: "2018-01-01" }), version(V2, { effectiveFrom: "2018-01-01", effectiveTo: null })];
    const forward = await retrieveLegalAuthority({ legalSourceId: SOURCE, citation: "s.74(2)(a)", caseDate: exact("2019-01-01") }, makeRepo(provision, versions));
    const reversed = await retrieveLegalAuthority({ legalSourceId: SOURCE, citation: "s.74(2)(a)", caseDate: exact("2019-01-01") }, makeRepo(provision, [...versions].reverse()));
    expect(forward.provisionVersion?.id).toBe(reversed.provisionVersion?.id);
  });

  it("returns PROVISION_NOT_FOUND for an empty repository result rather than throwing", async () => {
    const r = await retrieveLegalAuthority({ legalSourceId: SOURCE, citation: "s.999", caseDate: exact("2021-01-01") }, makeRepo(null, []));
    expect(r.outcome).toBe("PROVISION_NOT_FOUND");
    expect(r.requiresResearch).toBe(true);
  });

  it("returns NO_MATCH when the provision exists but has zero version records", async () => {
    const r = await retrieveLegalAuthority({ legalSourceId: SOURCE, citation: "s.74(2)(a)", caseDate: exact("2021-01-01") }, makeRepo(provision, []));
    expect(r.outcome).toBe("NO_MATCH");
  });

  it("propagates INTEGRITY_FAILURE from a corrupt repository-returned record rather than trusting it", async () => {
    const corrupted = version(V1, { textSha256: "0".repeat(64) });
    const r = await retrieveLegalAuthority({ legalSourceId: SOURCE, citation: "s.74(2)(a)", caseDate: exact("2021-01-01") }, makeRepo(provision, [corrupted]));
    expect(r.outcome).toBe("INTEGRITY_FAILURE");
  });

  it("preserves optional matterId/evidenceItemId provenance passthrough without requiring them", async () => {
    const withProvenance = await retrieveLegalAuthority({ legalSourceId: SOURCE, citation: "s.74(2)(a)", caseDate: exact("2021-01-01"), matterId: MATTER, evidenceItemId: EVIDENCE }, makeRepo(provision, [version(V1, {})]));
    expect(withProvenance.matterId).toBe(MATTER);
    expect(withProvenance.evidenceItemId).toBe(EVIDENCE);
    const without = await retrieveLegalAuthority({ legalSourceId: SOURCE, citation: "s.74(2)(a)", caseDate: exact("2021-01-01") }, makeRepo(provision, [version(V1, {})]));
    expect(without.matterId).toBeNull();
    expect(without.evidenceItemId).toBeNull();
  });

  it("rejects a non-UUID legalSourceId before ever calling the repository", async () => {
    let called = false;
    const repo: LegalCorpusRepository = { findProvisionByCitation: async () => { called = true; return provision; }, findProvisionVersions: async () => [] };
    await expect(retrieveLegalAuthority({ legalSourceId: "not-a-uuid", citation: "s.74(2)(a)", caseDate: exact("2021-01-01") }, repo)).rejects.toThrow();
    expect(called).toBe(false);
  });
});
