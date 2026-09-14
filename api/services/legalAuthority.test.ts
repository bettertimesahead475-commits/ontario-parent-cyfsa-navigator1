import { describe, it, expect } from "vitest";
import {
  validateLegalSource,
  validateLegalSourceVersion,
  validateLegalProvision,
  resolveApplicableVersion,
  assertSafeLegalLanguage,
  buildLegalMapping,
  applyHumanReview,
  type LegalSource,
  type LegalSourceVersion,
  type LegalProvision,
  type CaseDate,
} from "./legalAuthority.js";

const SRC = "11111111-1111-1111-1111-111111111111";
const SRC_2 = "22222222-2222-2222-2222-222222222222";
const PROV = "33333333-3333-3333-3333-333333333333";
const MATTER = "44444444-4444-4444-4444-444444444444";
const EVIDENCE = "55555555-5555-5555-5555-555555555555";
const EVENT = "66666666-6666-6666-6666-666666666666";
const V1 = "77777777-7777-7777-7777-777777777777";
const V2 = "88888888-8888-8888-8888-888888888888";
const V3 = "99999999-9999-9999-9999-999999999999";

const source: LegalSource = {
  id: SRC,
  jurisdiction: "ON",
  title: "Child, Youth and Family Services Act, 2017",
  sourceType: "STATUTE",
  citation: "S.O. 2017, c. 14, Sched. 1",
  officialPublisher: "e-Laws (Government of Ontario)",
  sourceUrl: "https://www.ontario.ca/laws/statute/17c14",
  verificationState: "VERIFIED",
  retrievedAt: "2026-08-29T00:00:00.000Z",
};

const provision: LegalProvision = {
  id: PROV,
  legalSourceId: SRC,
  citation: "s. 74(2)",
  label: "Protection grounds",
  verificationState: "VERIFIED",
};

const v = (id: string, over: Partial<LegalSourceVersion>): LegalSourceVersion => ({
  id,
  legalSourceId: SRC,
  versionLabel: id,
  effectiveFrom: "2020-01-01",
  effectiveTo: null,
  status: "IN_FORCE",
  verificationState: "VERIFIED",
  retrievedAt: "2026-01-01T00:00:00.000Z",
  supersedesVersionId: null,
  ...over,
});

const exact = (date: string): CaseDate => ({ kind: "EXACT", date });

describe("legal source/version/provision validation", () => {
  it("accepts a well-formed source", () => expect(() => validateLegalSource(source)).not.toThrow());
  it("rejects a non-https source URL", () => expect(() => validateLegalSource({ ...source, sourceUrl: "http://x" })).toThrow());
  it("rejects an unknown jurisdiction", () => expect(() => validateLegalSource({ ...source, jurisdiction: "US" })).toThrow());
  it("rejects an unknown source type", () => expect(() => validateLegalSource({ ...source, sourceType: "TWEET" })).toThrow());
  it("rejects a non-UUID source id", () => expect(() => validateLegalSource({ ...source, id: "src-1" })).toThrow());
  it("accepts a well-formed version", () => expect(() => validateLegalSourceVersion(v(V1, {}))).not.toThrow());
  it("rejects a malformed effectiveFrom", () => expect(() => validateLegalSourceVersion(v(V1, { effectiveFrom: "not-a-date" }))).toThrow());
  it("rejects effectiveTo before effectiveFrom", () =>
    expect(() => validateLegalSourceVersion(v(V1, { effectiveFrom: "2020-06-01", effectiveTo: "2020-01-01" }))).toThrow());
  it("rejects an equal effectiveFrom/effectiveTo range", () =>
    expect(() => validateLegalSourceVersion(v(V1, { effectiveFrom: "2020-01-01", effectiveTo: "2020-01-01" }))).toThrow());
  it("rejects a non-UUID supersedesVersionId", () =>
    expect(() => validateLegalSourceVersion(v(V1, { supersedesVersionId: "not-a-uuid" }))).toThrow());
  it("accepts a well-formed provision", () => expect(() => validateLegalProvision(provision)).not.toThrow());
  it("rejects a provision without a citation", () => expect(() => validateLegalProvision({ ...provision, citation: "" })).toThrow());
  it("rejects a non-UUID provision legalSourceId", () =>
    expect(() => validateLegalProvision({ ...provision, legalSourceId: "src-1" })).toThrow());
});

describe("deterministic temporal version resolution", () => {
  it("resolves an exact effective date to the matching closed version", () => {
    const versions = [v(V1, { effectiveFrom: "2020-01-01", effectiveTo: "2021-01-01" })];
    const r = resolveApplicableVersion(versions, exact("2020-01-01"));
    expect(r.outcome).toBe("RESOLVED");
    expect(r.version?.id).toBe(V1);
  });

  it("resolves a date inside a closed range", () => {
    const versions = [v(V1, { effectiveFrom: "2020-01-01", effectiveTo: "2021-01-01" })];
    expect(resolveApplicableVersion(versions, exact("2020-06-15")).version?.id).toBe(V1);
  });

  it("reports BEFORE_EARLIEST_VERSION for a date before the first version", () => {
    const versions = [v(V1, { effectiveFrom: "2020-01-01", effectiveTo: null })];
    const r = resolveApplicableVersion(versions, exact("2019-01-01"));
    expect(r.outcome).toBe("BEFORE_EARLIEST_VERSION");
    expect(r.version).toBeNull();
  });

  it("reports AFTER_LAST_CLOSED_VERSION when the only version is closed and the date is after it", () => {
    const versions = [v(V1, { effectiveFrom: "2020-01-01", effectiveTo: "2021-01-01" })];
    const r = resolveApplicableVersion(versions, exact("2022-01-01"));
    expect(r.outcome).toBe("AFTER_LAST_CLOSED_VERSION");
  });

  it("resolves to the open-ended current version", () => {
    const versions = [v(V1, { effectiveFrom: "2020-01-01", effectiveTo: null })];
    const r = resolveApplicableVersion(versions, exact("2030-01-01"));
    expect(r.outcome).toBe("RESOLVED_OPEN_ENDED");
    expect(r.version?.id).toBe(V1);
  });

  it("treats a historical closed version as resolvable within its own range", () => {
    const versions = [
      v(V1, { effectiveFrom: "2015-01-01", effectiveTo: "2017-01-01" }),
      v(V2, { effectiveFrom: "2017-01-01", effectiveTo: null }),
    ];
    expect(resolveApplicableVersion(versions, exact("2016-06-01")).version?.id).toBe(V1);
  });

  it("resolves adjacent versions with the boundary date belonging to the later version", () => {
    const versions = [
      v(V1, { effectiveFrom: "2015-01-01", effectiveTo: "2017-01-01" }),
      v(V2, { effectiveFrom: "2017-01-01", effectiveTo: null }),
    ];
    const r = resolveApplicableVersion(versions, exact("2017-01-01"));
    expect(r.outcome).toBe("RESOLVED_OPEN_ENDED");
    expect(r.version?.id).toBe(V2);
  });

  it("resolves the same-day boundary on the earlier side to the closing version, one day before", () => {
    const versions = [
      v(V1, { effectiveFrom: "2015-01-01", effectiveTo: "2017-01-01" }),
      v(V2, { effectiveFrom: "2017-01-01", effectiveTo: null }),
    ];
    const r = resolveApplicableVersion(versions, exact("2016-12-31"));
    expect(r.outcome).toBe("RESOLVED");
    expect(r.version?.id).toBe(V1);
  });

  it("detects overlapping versions and refuses to resolve", () => {
    const versions = [
      v(V1, { effectiveFrom: "2015-01-01", effectiveTo: "2018-01-01" }),
      v(V2, { effectiveFrom: "2017-01-01", effectiveTo: null }),
    ];
    const r = resolveApplicableVersion(versions, exact("2017-06-01"));
    expect(r.outcome).toBe("OVERLAPPING_VERSIONS");
    expect(r.version).toBeNull();
  });

  it("detects an open-ended version followed by another version as an invalid overlap", () => {
    const versions = [
      v(V1, { effectiveFrom: "2015-01-01", effectiveTo: null }),
      v(V2, { effectiveFrom: "2017-01-01", effectiveTo: null }),
    ];
    expect(resolveApplicableVersion(versions, exact("2016-01-01")).outcome).toBe("OVERLAPPING_VERSIONS");
  });

  it("detects overlap regardless of input order (non-adjacent overlap caught via sorted adjacency)", () => {
    const versions = [
      v(V1, { effectiveFrom: "2015-01-01", effectiveTo: "2025-01-01" }),
      v(V2, { effectiveFrom: "2016-01-01", effectiveTo: "2017-01-01" }),
      v(V3, { effectiveFrom: "2019-01-01", effectiveTo: "2020-01-01" }),
    ];
    expect(resolveApplicableVersion([...versions].reverse(), exact("2018-01-01")).outcome).toBe("OVERLAPPING_VERSIONS");
  });

  it("reports UNKNOWN_DATE and never guesses", () => {
    const versions = [v(V1, { effectiveFrom: "2020-01-01", effectiveTo: null })];
    const r = resolveApplicableVersion(versions, { kind: "UNKNOWN" });
    expect(r.outcome).toBe("UNKNOWN_DATE");
    expect(r.version).toBeNull();
  });

  it("reports INVALID_VERSION_DATA for a malformed case date instead of silently comparing garbage", () => {
    const versions = [v(V1, { effectiveFrom: "2020-01-01", effectiveTo: null })];
    const r = resolveApplicableVersion(versions, exact("not-a-date"));
    expect(r.outcome).toBe("INVALID_VERSION_DATA");
    expect(r.version).toBeNull();
  });

  it("reports INVALID_VERSION_DATA for a malformed approximate case date", () => {
    const versions = [v(V1, { effectiveFrom: "2020-01-01", effectiveTo: null })];
    expect(resolveApplicableVersion(versions, { kind: "APPROXIMATE", date: "2020/01/01" }).outcome).toBe("INVALID_VERSION_DATA");
  });

  it("resolves an approximate date but flags it with a warning instead of asserting certainty", () => {
    const versions = [v(V1, { effectiveFrom: "2020-01-01", effectiveTo: null })];
    const r = resolveApplicableVersion(versions, { kind: "APPROXIMATE", date: "2021-01-01" });
    expect(r.outcome).toBe("RESOLVED_APPROXIMATE");
    expect(r.version?.id).toBe(V1);
    expect(r.warnings.length).toBeGreaterThan(0);
  });

  it("resolves an approximate date crossing near an amendment boundary with an explicit warning, not silence", () => {
    const versions = [
      v(V1, { effectiveFrom: "2015-01-01", effectiveTo: "2017-01-01" }),
      v(V2, { effectiveFrom: "2017-01-01", effectiveTo: null }),
    ];
    const r = resolveApplicableVersion(versions, { kind: "APPROXIMATE", date: "2017-01-02" });
    expect(r.outcome).toBe("RESOLVED_APPROXIMATE");
    expect(r.version?.id).toBe(V2);
    expect(r.warnings.some((w) => /adjacent version/i.test(w))).toBe(true);
  });

  it("reports NO_VERIFIED_VERSION when only unverified versions exist", () => {
    const versions = [v(V1, { verificationState: "UNVERIFIED" })];
    expect(resolveApplicableVersion(versions, exact("2020-06-01")).outcome).toBe("NO_VERIFIED_VERSION");
  });

  it("reports GAP_IN_COVERAGE for a date that falls between two non-overlapping, non-adjacent versions", () => {
    const versions = [
      v(V1, { effectiveFrom: "2015-01-01", effectiveTo: "2016-01-01" }),
      v(V2, { effectiveFrom: "2018-01-01", effectiveTo: null }),
    ];
    expect(resolveApplicableVersion(versions, exact("2017-01-01")).outcome).toBe("GAP_IN_COVERAGE");
  });

  it("rejects malformed source version data before attempting resolution", () => {
    expect(() => resolveApplicableVersion([v(V1, { effectiveFrom: "not-a-date" }) as any], exact("2020-01-01"))).toThrow();
  });

  it("rejects a mix of versions from different legal sources", () => {
    const versions = [v(V1, {}), v(V2, { legalSourceId: SRC_2 })];
    expect(() => resolveApplicableVersion(versions, exact("2020-06-01"))).toThrow();
  });

  it("handles an empty version list as no verified version", () => {
    expect(resolveApplicableVersion([], exact("2020-01-01")).outcome).toBe("NO_VERIFIED_VERSION");
  });

  it("keeps one stable provision identity resolvable across two different source versions", () => {
    // s. 74(2) as a citation is stable across amendments; only the version changes.
    const versions = [
      v(V1, { effectiveFrom: "2015-01-01", effectiveTo: "2020-01-01" }),
      v(V2, { effectiveFrom: "2020-01-01", effectiveTo: null }),
    ];
    const before = resolveApplicableVersion(versions, exact("2018-01-01"));
    const after = resolveApplicableVersion(versions, exact("2022-01-01"));
    expect(before.version?.id).toBe(V1);
    expect(after.version?.id).toBe(V2);
    // The same provision object would be cited against either resolved version — the
    // resolver does not need to know about provisions to keep this stable, but confirms
    // no version-specific coupling breaks a single provision identity across the change.
    expect(provision.legalSourceId).toBe(versions[0].legalSourceId);
    expect(provision.legalSourceId).toBe(versions[1].legalSourceId);
  });
});

describe("legal authority vs. legal conclusion", () => {
  it.each([
    "This evidence may engage s. 74(2) protection grounds.",
    "Potentially relevant provision identified for further factual/legal review required.",
    "Authority identified for legal review; potential legal issue requiring review.",
  ])("accepts safe framing: %s", (text) => expect(() => assertSafeLegalLanguage(text)).not.toThrow());

  it.each([
    "The worker violated section 74.",
    "CAS broke the law.",
    "This proves misconduct.",
    "The court erred in its finding.",
    "The society was negligent.",
    "The agency acted contrary to the Act.",
    "The worker failed to comply with the statute.",
    "The society was in breach of its statutory duty.",
  ])("rejects conclusion language: %s", (text) => expect(() => assertSafeLegalLanguage(text)).toThrow());

  it("rejects empty reasoning text", () => expect(() => assertSafeLegalLanguage("")).toThrow());

  it("never applies conclusion-language screening to authoritative source text — only to generated reasoning", () => {
    // A statute or judgment may legitimately use these words; assertSafeLegalLanguage is only
    // ever invoked (by buildLegalMapping) against reasonForRelevance, never legalSource.title,
    // provision citations, or quoted authority text. Confirms validateLegalSource accepts a
    // title containing conclusion-language words untouched.
    const quotedTitleSource: LegalSource = {
      ...source,
      title: "An Act respecting a finding that a person violated a duty of care (illustrative historical title)",
    };
    expect(() => validateLegalSource(quotedTitleSource)).not.toThrow();
  });

  it("does not flag every neutral use of a near-trigger word as a conclusion (no false positive on 'breach' alone)", () => {
    expect(() => assertSafeLegalLanguage("The record describes an alleged breach of confidentiality by a third party.")).not.toThrow();
  });
});

const versions = [v(V1, { effectiveFrom: "2020-01-01", effectiveTo: null })];

const mappingInput = {
  matterId: MATTER,
  evidenceItemId: EVIDENCE,
  evidenceClassification: "ALLEGATION",
  evidenceReviewState: "REVIEWED" as const,
  legalSource: source,
  provision,
  caseDate: exact("2021-01-01"),
  potentialIssue: "Possible protection-grounds engagement",
  reasonForRelevance: "This evidence may engage the cited protection grounds provision.",
};

describe("provider-independent legal mapping contract", () => {
  it("builds a mapping with resolved version and UNREVIEWED status", () => {
    const m = buildLegalMapping(mappingInput, versions);
    expect(m.legalSourceVersionId).toBe(V1);
    expect(m.reviewStatus).toBe("UNREVIEWED");
    expect(m.citation).toBe("S.O. 2017, c. 14, Sched. 1 s. 74(2)");
    expect(m.warnings).toEqual([]);
  });

  it("passes through an associated event/person id instead of silently dropping it", () => {
    const m = buildLegalMapping({ ...mappingInput, associatedEventOrPersonId: EVENT }, versions);
    expect(m.associatedEventOrPersonId).toBe(EVENT);
  });

  it("defaults associatedEventOrPersonId to null when not supplied", () => {
    expect(buildLegalMapping(mappingInput, versions).associatedEventOrPersonId).toBeNull();
  });

  it("rejects a non-UUID associatedEventOrPersonId", () => {
    expect(() => buildLegalMapping({ ...mappingInput, associatedEventOrPersonId: "not-a-uuid" }, versions)).toThrow();
  });

  it("warns when the underlying evidence has not itself been human-reviewed, without changing reviewStatus", () => {
    const m = buildLegalMapping({ ...mappingInput, evidenceReviewState: "UNREVIEWED" }, versions);
    expect(m.reviewStatus).toBe("UNREVIEWED"); // mapping review state, unaffected
    expect(m.warnings.some((w) => /evidence has not itself been human-reviewed/i.test(w))).toBe(true);
  });

  it("does not warn about evidence review when the evidence is already CONFIRMED", () => {
    const m = buildLegalMapping({ ...mappingInput, evidenceReviewState: "CONFIRMED" }, versions);
    expect(m.warnings.some((w) => /evidence has not itself been human-reviewed/i.test(w))).toBe(false);
  });

  it("rejects an unknown evidenceReviewState", () => {
    expect(() => buildLegalMapping({ ...mappingInput, evidenceReviewState: "MADE_UP" as any }, versions)).toThrow();
  });

  it("marks a mapping REQUIRES_RESEARCH when temporal resolution is ambiguous", () => {
    const m = buildLegalMapping({ ...mappingInput, caseDate: { kind: "UNKNOWN" } }, versions);
    expect(m.reviewStatus).toBe("REQUIRES_RESEARCH");
    expect(m.legalSourceVersionId).toBeNull();
    expect(m.warnings.length).toBeGreaterThan(0);
  });

  it("marks a mapping REQUIRES_RESEARCH when the source is unverified, never confirming relevance", () => {
    const m = buildLegalMapping({ ...mappingInput, legalSource: { ...source, verificationState: "UNVERIFIED" } }, versions);
    expect(m.reviewStatus).toBe("REQUIRES_RESEARCH");
  });

  it("rejects a mapping whose provision belongs to a different source", () => {
    expect(() => buildLegalMapping({ ...mappingInput, provision: { ...provision, legalSourceId: SRC_2 } }, versions)).toThrow();
  });

  it("rejects a mapping with conclusion language in its reasoning", () => {
    expect(() => buildLegalMapping({ ...mappingInput, reasonForRelevance: "The worker broke the law." }, versions)).toThrow();
  });

  it("rejects a mapping missing an evidence item id", () => {
    expect(() => buildLegalMapping({ ...mappingInput, evidenceItemId: "" }, versions)).toThrow();
  });

  it("rejects a mapping with a non-UUID evidence item id", () => {
    expect(() => buildLegalMapping({ ...mappingInput, evidenceItemId: "evidence-1" }, versions)).toThrow();
  });

  it("rejects a mapping with a non-UUID matter id (cross-matter contamination must fail structurally, not just at the DB)", () => {
    expect(() => buildLegalMapping({ ...mappingInput, matterId: "matter-1" }, versions)).toThrow();
  });

  it("rejects a mapping missing a potential issue", () => {
    expect(() => buildLegalMapping({ ...mappingInput, potentialIssue: "  " }, versions)).toThrow();
  });

  it("never sets confidence itself — Stage 6 M1 assembles structure only", () => {
    expect(buildLegalMapping(mappingInput, versions).confidence).toBeNull();
  });
});

describe("human review state machine", () => {
  it("allows UNREVIEWED -> POSSIBLY_RELEVANT", () => expect(applyHumanReview("UNREVIEWED", "POSSIBLY_RELEVANT")).toBe("POSSIBLY_RELEVANT"));
  it("allows POSSIBLY_RELEVANT -> CONFIRMED_RELEVANT", () => expect(applyHumanReview("POSSIBLY_RELEVANT", "CONFIRMED_RELEVANT")).toBe("CONFIRMED_RELEVANT"));
  it("allows REQUIRES_RESEARCH -> CONFIRMED_RELEVANT once research resolves it", () =>
    expect(applyHumanReview("REQUIRES_RESEARCH", "CONFIRMED_RELEVANT")).toBe("CONFIRMED_RELEVANT"));
  it("rejects NOT_RELEVANT -> CONFIRMED_RELEVANT without an intermediate re-review", () =>
    expect(() => applyHumanReview("NOT_RELEVANT", "CONFIRMED_RELEVANT")).toThrow());
  it("rejects an AI mapping self-promoting straight to CONFIRMED_RELEVANT from SUPERSEDED", () =>
    expect(() => applyHumanReview("SUPERSEDED", "CONFIRMED_RELEVANT")).toThrow());
  it("rejects an unknown target state", () => expect(() => applyHumanReview("UNREVIEWED", "MADE_UP" as any)).toThrow());
  it("allows any state to move to NOT_RELEVANT", () => expect(applyHumanReview("CONFIRMED_RELEVANT", "NOT_RELEVANT")).toBe("NOT_RELEVANT"));
});
