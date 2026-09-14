import { describe, it, expect } from "vitest";
import {
  normalizeProvisionText,
  sha256Hex,
  validateProvisionVersionCandidate,
  validateVerificationTransition,
  validateSourceSnapshotCandidate,
  validateLineageCandidate,
  isDuplicateLineageEdge,
  classifySourceTrust,
  VERIFICATION_STATES,
  LINEAGE_TYPES,
} from "./legalCorpus.js";
import { hash } from "./pageSources.js";
import { resolveApplicableVersion, type LegalSourceVersion, type CaseDate } from "./legalAuthority.js";

const ID = "11111111-1111-1111-1111-111111111111";
const PROVISION = "22222222-2222-2222-2222-222222222222";
const SOURCE = "33333333-3333-3333-3333-333333333333";
const VERSION = "44444444-4444-4444-4444-444444444444";
const VERSION2 = "55555555-5555-5555-5555-555555555555";
const HUMAN = "66666666-6666-6666-6666-666666666666";

describe("deterministic normalization", () => {
  it("preserves exact text content, only normalizing line endings and outer whitespace", () => {
    expect(normalizeProvisionText("  A section.\r\nSubsection (a).\r  ")).toBe("A section.\nSubsection (a).");
  });
  it("preserves internal whitespace runs and punctuation exactly", () => {
    expect(normalizeProvisionText("s. 74(2)  states —  the following:")).toBe("s. 74(2)  states —  the following:");
  });
  it("applies Unicode NFC composition", () => {
    const decomposed = "café"; // e + combining acute
    expect(normalizeProvisionText(decomposed)).toBe("café");
  });
  it("rejects empty text", () => expect(() => normalizeProvisionText("")).toThrow());
  it("rejects whitespace-only text", () => expect(() => normalizeProvisionText("   \n\r\n  ")).toThrow());
});

describe("deterministic checksum", () => {
  it("is deterministic for identical input", () => {
    expect(sha256Hex("s. 74(2) text")).toBe(sha256Hex("s. 74(2) text"));
  });
  it("matches Stage 4's own hash function — one hashing convention, not two", () => {
    expect(sha256Hex("same text")).toBe(hash("same text"));
  });
  it("differs for different input", () => {
    expect(sha256Hex("text a")).not.toBe(sha256Hex("text b"));
  });
});

const exactText = "The child was found to be in need of protection under s. 74(2).";
const normalizedText = normalizeProvisionText(exactText);
const textSha256 = sha256Hex(normalizedText);

const provisionVersion = (over: Record<string, unknown> = {}) => ({
  id: ID,
  provisionId: PROVISION,
  legalSourceId: SOURCE,
  legalSourceVersionId: VERSION,
  effectiveFrom: "2020-01-01",
  effectiveTo: null,
  exactText,
  normalizedText,
  textSha256,
  verificationStatus: "UNVERIFIED",
  verifiedBy: null,
  verifiedAt: null,
  ...over,
});

describe("provision-version candidate validation", () => {
  it("accepts a well-formed UNVERIFIED candidate", () => expect(() => validateProvisionVersionCandidate(provisionVersion())).not.toThrow());

  it("accepts COMMITTED_INSPECTION without verification metadata", () =>
    expect(() => validateProvisionVersionCandidate(provisionVersion({ verificationStatus: "COMMITTED_INSPECTION" }))).not.toThrow());

  it("requires verifiedBy/verifiedAt when VERIFIED", () => {
    expect(() => validateProvisionVersionCandidate(provisionVersion({ verificationStatus: "VERIFIED" }))).toThrow();
    expect(() =>
      validateProvisionVersionCandidate(
        provisionVersion({ verificationStatus: "VERIFIED", verifiedBy: HUMAN, verifiedAt: "2026-01-01T00:00:00.000Z" }),
      ),
    ).not.toThrow();
  });

  it("rejects verifiedBy present on a non-VERIFIED candidate", () =>
    expect(() => validateProvisionVersionCandidate(provisionVersion({ verifiedBy: HUMAN }))).toThrow());

  it("accepts REJECTED", () => expect(() => validateProvisionVersionCandidate(provisionVersion({ verificationStatus: "REJECTED" }))).not.toThrow());

  it("rejects a normalizedText that does not match the deterministic normalization of exactText", () =>
    expect(() => validateProvisionVersionCandidate(provisionVersion({ normalizedText: "something else entirely" }))).toThrow());

  it("rejects a textSha256 that does not match the deterministic checksum", () =>
    expect(() => validateProvisionVersionCandidate(provisionVersion({ textSha256: "0".repeat(64) }))).toThrow());

  it("rejects a malformed textSha256 format", () =>
    expect(() => validateProvisionVersionCandidate(provisionVersion({ textSha256: "not-hex" }))).toThrow());

  describe("temporal validity", () => {
    it("accepts a valid half-open range", () =>
      expect(() => validateProvisionVersionCandidate(provisionVersion({ effectiveFrom: "2020-01-01", effectiveTo: "2021-01-01" }))).not.toThrow());
    it("rejects a reversed range", () =>
      expect(() => validateProvisionVersionCandidate(provisionVersion({ effectiveFrom: "2021-01-01", effectiveTo: "2020-01-01" }))).toThrow());
    it("rejects an equal from/to range", () =>
      expect(() => validateProvisionVersionCandidate(provisionVersion({ effectiveFrom: "2020-01-01", effectiveTo: "2020-01-01" }))).toThrow());
    it("accepts an open-ended version", () =>
      expect(() => validateProvisionVersionCandidate(provisionVersion({ effectiveFrom: "2020-01-01", effectiveTo: null }))).not.toThrow());
    it("rejects a malformed effectiveFrom", () =>
      expect(() => validateProvisionVersionCandidate(provisionVersion({ effectiveFrom: "not-a-date" }))).toThrow());
  });

  it("rejects a non-UUID id field", () => expect(() => validateProvisionVersionCandidate(provisionVersion({ provisionId: "not-a-uuid" }))).toThrow());
  it("rejects an unknown verification status", () =>
    expect(() => validateProvisionVersionCandidate(provisionVersion({ verificationStatus: "MADE_UP" }))).toThrow());
  it("rejects a malformed candidate object", () => expect(() => validateProvisionVersionCandidate(null)).toThrow());
});

describe("verification transition — AI cannot self-verify", () => {
  it.each(VERIFICATION_STATES)("allows UNVERIFIED -> %s only with proper metadata", (next) => {
    if (next === "VERIFIED") expect(() => validateVerificationTransition("UNVERIFIED", next, HUMAN)).not.toThrow();
    else expect(() => validateVerificationTransition("UNVERIFIED", next, null)).not.toThrow();
  });

  it("rejects promoting to VERIFIED without a human verifiedBy id", () =>
    expect(() => validateVerificationTransition("COMMITTED_INSPECTION", "VERIFIED", null)).toThrow());

  it("rejects a non-UUID verifiedBy", () =>
    expect(() => validateVerificationTransition("COMMITTED_INSPECTION", "VERIFIED", "not-a-uuid")).toThrow());

  it("rejects any transition once current is VERIFIED — immutability enforced in the service layer too", () => {
    expect(() => validateVerificationTransition("VERIFIED", "REJECTED", null)).toThrow();
    expect(() => validateVerificationTransition("VERIFIED", "VERIFIED", HUMAN)).toThrow();
  });

  it("rejects verifiedBy supplied for a non-VERIFIED target", () =>
    expect(() => validateVerificationTransition("UNVERIFIED", "COMMITTED_INSPECTION", HUMAN)).toThrow());

  it("rejects an unknown target status", () => expect(() => validateVerificationTransition("UNVERIFIED", "MADE_UP" as any, null)).toThrow());
});

const snapshot = (over: Record<string, unknown> = {}) => {
  const rawContent = "Full retrieved statute text.";
  return {
    id: ID,
    legalSourceId: SOURCE,
    sourceUrl: "https://www.ontario.ca/laws/statute/17c14",
    retrievedAt: "2026-08-29T00:00:00.000Z",
    rawContent,
    contentSha256: sha256Hex(rawContent),
    ingestionStatus: "RETRIEVED",
    ...over,
  };
};

describe("source snapshot candidate validation", () => {
  it("accepts a well-formed snapshot", () => expect(() => validateSourceSnapshotCandidate(snapshot())).not.toThrow());
  it("computes checksum over the raw payload deterministically", () => {
    const s = snapshot();
    expect(s.contentSha256).toBe(sha256Hex(s.rawContent as string));
  });
  it("rejects a checksum that does not match the raw payload", () =>
    expect(() => validateSourceSnapshotCandidate(snapshot({ contentSha256: "0".repeat(64) }))).toThrow());
  it("rejects a non-https source URL", () => expect(() => validateSourceSnapshotCandidate(snapshot({ sourceUrl: "http://x" }))).toThrow());
  it("preserves source URL and legalSourceId provenance", () => {
    const s = validateSourceSnapshotCandidate(snapshot());
    expect(s.sourceUrl).toBe("https://www.ontario.ca/laws/statute/17c14");
    expect(s.legalSourceId).toBe(SOURCE);
  });
  it("rejects an invalid ingestion status", () => expect(() => validateSourceSnapshotCandidate(snapshot({ ingestionStatus: "MADE_UP" }))).toThrow());
  it.each(["RETRIEVED", "PARSED", "VALIDATED", "REJECTED"])("accepts ingestion status %s", (ingestionStatus) =>
    expect(() => validateSourceSnapshotCandidate(snapshot({ ingestionStatus }))).not.toThrow(),
  );
});

describe("lineage candidate validation", () => {
  it.each(LINEAGE_TYPES)("accepts lineage type %s", (lineageType) =>
    expect(() => validateLineageCandidate({ predecessorVersionId: VERSION, successorVersionId: VERSION2, lineageType })).not.toThrow(),
  );
  it("rejects a self-link", () =>
    expect(() => validateLineageCandidate({ predecessorVersionId: VERSION, successorVersionId: VERSION, lineageType: "AMENDMENT" })).toThrow());
  it("rejects an unknown lineage type", () =>
    expect(() => validateLineageCandidate({ predecessorVersionId: VERSION, successorVersionId: VERSION2, lineageType: "MADE_UP" })).toThrow());
  it("rejects malformed version references", () =>
    expect(() => validateLineageCandidate({ predecessorVersionId: "not-a-uuid", successorVersionId: VERSION2, lineageType: "AMENDMENT" })).toThrow());

  it("detects a duplicate lineage edge", () => {
    const edge = { predecessorVersionId: VERSION, successorVersionId: VERSION2, lineageType: "AMENDMENT" as const };
    expect(isDuplicateLineageEdge([edge], edge)).toBe(true);
    expect(isDuplicateLineageEdge([edge], { ...edge, lineageType: "RENUMBERING" })).toBe(false);
  });

  it("supports 1->N (SPLIT) and N->1 (MERGE) shapes without any cardinality constraint rejecting them", () => {
    const splitA = { predecessorVersionId: VERSION, successorVersionId: VERSION2, lineageType: "SPLIT" as const };
    const splitB = { predecessorVersionId: VERSION, successorVersionId: ID, lineageType: "SPLIT" as const };
    expect(() => validateLineageCandidate(splitA)).not.toThrow();
    expect(() => validateLineageCandidate(splitB)).not.toThrow();
    expect(isDuplicateLineageEdge([splitA], splitB)).toBe(false);
  });
});

describe("source trust classification", () => {
  it("classifies the official Ontario e-Laws publisher as authoritative", () =>
    expect(classifySourceTrust("ON", "e-Laws (Government of Ontario)")).toBe("AUTHORITATIVE"));
  it("classifies the official federal Justice Laws Canada publisher as authoritative", () =>
    expect(classifySourceTrust("CA", "Justice Laws Canada")).toBe("AUTHORITATIVE"));
  it("never classifies CanLII as authoritative", () => expect(classifySourceTrust("ON", "CanLII")).toBe("SECONDARY"));
  it("classifies an unrecognized publisher as secondary by default (fail closed)", () =>
    expect(classifySourceTrust("ON", "Some Random Blog")).toBe("SECONDARY"));
});

describe("Stage 6 temporal-safety regression (unchanged by M2-A)", () => {
  const v = (over: Partial<LegalSourceVersion>): LegalSourceVersion => ({
    id: VERSION,
    legalSourceId: SOURCE,
    versionLabel: "v1",
    effectiveFrom: "2020-01-01",
    effectiveTo: null,
    status: "IN_FORCE",
    verificationState: "VERIFIED",
    retrievedAt: "2026-01-01T00:00:00.000Z",
    supersedesVersionId: null,
    ...over,
  });
  it("UNKNOWN case date still resolves to UNKNOWN_DATE, never a guess", () => {
    const r = resolveApplicableVersion([v({})], { kind: "UNKNOWN" } as CaseDate);
    expect(r.outcome).toBe("UNKNOWN_DATE");
    expect(r.version).toBeNull();
  });
  it("never falls back to current law for a missing date", () => {
    const r = resolveApplicableVersion([v({})], { kind: "UNKNOWN" } as CaseDate);
    expect(r.version).toBeNull();
  });
  it("historical version selection remains deterministic", () => {
    const versions = [
      v({ id: VERSION, effectiveFrom: "2015-01-01", effectiveTo: "2018-01-01" }),
      v({ id: VERSION2, effectiveFrom: "2018-01-01", effectiveTo: null }),
    ];
    expect(resolveApplicableVersion(versions, { kind: "EXACT", date: "2016-01-01" }).version?.id).toBe(VERSION);
    expect(resolveApplicableVersion(versions, { kind: "EXACT", date: "2019-01-01" }).version?.id).toBe(VERSION2);
  });
});
