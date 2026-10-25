// Adversarial tests for the authenticated source-page map. The attacks: typed or pasted "[Page N]" markers, edited or
// reordered signed pages, duplicated pages, a map issued to another user or another document, an expired map, and a
// missing signing secret. Every one must leave the citation unverified (or rejected), never VERIFIED.
import { beforeEach, afterEach, describe, expect, it } from "vitest";
import { applyReportGuards } from "./analyzerSections.js";
import {
  pageMapFrom,
  signSourcePageMap,
  sourceTextFrom,
  verifySourcePageMap,
  SOURCE_MAP_TTL_MS,
  type AuthoritativePage,
} from "./sourcePageMap.js";

const UID = "parent-uid-1";
const OTHER_UID = "someone-else";
const DOC_A = "a".repeat(64);
const DOC_B = "b".repeat(64);
const PAGES: AuthoritativePage[] = [
  { pageNumber: 1, text: "Routine school visit. Nothing concerning was observed." },
  { pageNumber: 2, text: "The worker stated the child was locked in a room overnight." },
  { pageNumber: 3, text: "Notice of hearing issued on 12 March 2026." },
];
const NOW = Date.parse("2026-10-25T12:00:00Z");

const saved = process.env.SESSION_SECRET;
beforeEach(() => {
  process.env.SESSION_SECRET = "unit-test-session-secret-0123456789";
});
afterEach(() => {
  if (saved === undefined) delete process.env.SESSION_SECRET;
  else process.env.SESSION_SECRET = saved;
});

function signed(overrides: Partial<{ uid: string; contentHash: string; pages: AuthoritativePage[]; now: number }> = {}) {
  const map = signSourcePageMap({ uid: UID, contentHash: DOC_A, pages: PAGES, now: NOW, ...overrides });
  if (!map) throw new Error("expected a signed map");
  return map;
}

/** Decodes a signed payload, edits it, and returns the edited payload as base64url (without re-signing). */
function editedPayload(map: { payload: string }, edit: (p: any) => void): string {
  const parsed = JSON.parse(Buffer.from(map.payload, "base64url").toString("utf8"));
  edit(parsed);
  return Buffer.from(JSON.stringify(parsed), "utf8").toString("base64url");
}

describe("fabricated page markers in text", () => {
  const fabricated = [
    "[Page 1]",
    "Routine school visit, nothing concerning.",
    "",
    "[Page 3]",
    "The worker stated the child was locked in a room overnight.",
  ].join("\n");

  it("a citation to fabricated [Page 3] text is NOT verified when no authoritative map exists", () => {
    const report: Record<string, any> = {
      redFlags: [{ locationInDocument: "Page 3", phraseDetected: "the child was locked in a room overnight", legalReference: "" }],
    };
    applyReportGuards(report, null);
    expect(report.sourceProvenance).toBe("unauthenticated_text");
    expect(report.redFlags[0].pageCitation.status).toBe("PAGE_UNVERIFIABLE");
    expect(report.redFlags[0].pageCitation.status).not.toBe("PAGE_VERIFIED");
  });

  it("the same fabricated text is also not verified when the authoritative map is empty", () => {
    const report: Record<string, any> = {
      redFlags: [{ locationInDocument: "Page 3", phraseDetected: "the child was locked in a room overnight", legalReference: "" }],
    };
    applyReportGuards(report, new Map());
    expect(report.redFlags[0].pageCitation.status).toBe("PAGE_UNVERIFIABLE");
  });
});

describe("accepting a signed map", () => {
  it("accepts a map the server signed for this user and document", () => {
    const result = verifySourcePageMap(signed(), { uid: UID, now: NOW });
    expect(result.ok).toBe(true);
    expect(result.pages).toEqual(PAGES);
    expect(result.contentHash).toBe(DOC_A);
  });

  it("the source text rebuilt from an accepted map is the server's pages, not client text", () => {
    const result = verifySourcePageMap(signed(), { uid: UID, now: NOW });
    expect(sourceTextFrom(result.pages)).toContain("[Page 2]\nThe worker stated the child was locked in a room overnight.");
  });

  it("a verified citation is VERIFIED only against the authoritative page", () => {
    const result = verifySourcePageMap(signed(), { uid: UID, now: NOW });
    const report: Record<string, any> = {
      redFlags: [{ locationInDocument: "Page 2", phraseDetected: "locked in a room overnight", legalReference: "" }],
    };
    applyReportGuards(report, pageMapFrom(result.pages));
    expect(report.sourceProvenance).toBe("authenticated_pages");
    expect(report.redFlags[0].pageCitation.status).toBe("PAGE_VERIFIED");
  });
});

describe("tampering with a signed map", () => {
  it("rejects an edited page text (signature no longer matches)", () => {
    const map = signed();
    const forged = editedPayload(map, (p) => (p.pages[1].text = "The worker said nothing unusual."));
    expect(verifySourcePageMap({ payload: forged, signature: map.signature }, { uid: UID, now: NOW })).toMatchObject({
      ok: false,
      reason: "bad-signature",
    });
  });

  it("rejects a page renumbered to a different page", () => {
    const map = signed();
    const forged = editedPayload(map, (p) => (p.pages[1].pageNumber = 5));
    expect(verifySourcePageMap({ payload: forged, signature: map.signature }, { uid: UID, now: NOW }).ok).toBe(false);
  });

  it("rejects a signature copied onto a different payload", () => {
    const a = signed();
    const b = signed({ pages: [PAGES[0]] });
    expect(verifySourcePageMap({ payload: b.payload, signature: a.signature }, { uid: UID, now: NOW }).ok).toBe(false);
  });

  it("rejects a forged signature", () => {
    const map = signed();
    expect(verifySourcePageMap({ payload: map.payload, signature: "A".repeat(map.signature.length) }, { uid: UID, now: NOW }).ok).toBe(false);
  });

  it("rejects a payload that is not a map at all", () => {
    expect(verifySourcePageMap({ payload: "not-base64-json", signature: "x" }, { uid: UID, now: NOW }).ok).toBe(false);
    expect(verifySourcePageMap("[Page 1]\ntext", { uid: UID, now: NOW }).ok).toBe(false);
    expect(verifySourcePageMap(null, { uid: UID, now: NOW }).ok).toBe(false);
  });
});

describe("reordered and duplicated pages", () => {
  it("refuses to sign pages that are out of order", () => {
    const reordered = [PAGES[1], PAGES[0], PAGES[2]];
    expect(signSourcePageMap({ uid: UID, contentHash: DOC_A, pages: reordered, now: NOW })).toBeNull();
  });

  it("refuses to sign a duplicated page number", () => {
    const duplicated = [PAGES[0], { pageNumber: 1, text: PAGES[1].text }];
    expect(signSourcePageMap({ uid: UID, contentHash: DOC_A, pages: duplicated, now: NOW })).toBeNull();
  });

  it("does not accept a validly signed map whose page numbers are out of order", () => {
    // A map signed with the right key but wrong order (as if built by a buggy issuer) is still rejected on verify.
    const map = signed();
    const forged = editedPayload(map, (p) => {
      p.pages = [p.pages[1], p.pages[0], p.pages[2]];
    });
    const { createHmac } = require("node:crypto");
    const key = createHmac("sha256", process.env.SESSION_SECRET!).update("cyfsa:source-page-map:v1").digest();
    const resigned = createHmac("sha256", key).update(forged).digest("base64url");
    expect(verifySourcePageMap({ payload: forged, signature: resigned }, { uid: UID, now: NOW })).toMatchObject({
      ok: false,
      reason: "page-order",
    });
  });

  it("a duplicated quotation on an authoritative page still verifies only on the page it is cited to", () => {
    const pages: AuthoritativePage[] = [
      { pageNumber: 1, text: "The same sentence appears here in full." },
      { pageNumber: 2, text: "Different text on this page entirely." },
      { pageNumber: 3, text: "The same sentence appears here in full." },
    ];
    const map = signed({ pages });
    const result = verifySourcePageMap(map, { uid: UID, now: NOW });
    const report: Record<string, any> = {
      redFlags: [{ locationInDocument: "Page 2", phraseDetected: "The same sentence appears here in full.", legalReference: "" }],
    };
    applyReportGuards(report, pageMapFrom(result.pages));
    // Cited page 2 does not contain it; it appears on pages 1 and 3, so the citation is ambiguous, not verified.
    expect(report.redFlags[0].pageCitation.status).toBe("PAGE_AMBIGUOUS");
    expect(report.redFlags[0].pageCitation.sourcePages).toEqual([1, 3]);
    expect(report.redFlags[0].proposedLocation).toBeUndefined();
  });
});

describe("binding: user, document, expiry", () => {
  it("rejects a map issued to a different user", () => {
    expect(verifySourcePageMap(signed(), { uid: OTHER_UID, now: NOW })).toMatchObject({ ok: false, reason: "wrong-user" });
  });

  it("rejects a request with no user identity", () => {
    expect(verifySourcePageMap(signed(), { uid: null, now: NOW }).ok).toBe(false);
  });

  it("rejects an expired map", () => {
    const later = NOW + SOURCE_MAP_TTL_MS + 1;
    expect(verifySourcePageMap(signed(), { uid: UID, now: later })).toMatchObject({ ok: false, reason: "expired" });
  });

  it("cross-document: document A's pages cannot establish a citation for document B", () => {
    const mapA = verifySourcePageMap(signed({ contentHash: DOC_A }), { uid: UID, now: NOW });
    expect(mapA.contentHash).toBe(DOC_A);
    expect(mapA.contentHash).not.toBe(DOC_B);
    // A citation in document B's text cannot be verified against document A's authoritative pages.
    const report: Record<string, any> = {
      redFlags: [{ locationInDocument: "Page 2", phraseDetected: "text that exists only in document B", legalReference: "" }],
    };
    applyReportGuards(report, pageMapFrom(mapA.pages));
    expect(report.redFlags[0].pageCitation.status).toBe("PAGE_NOT_FOUND");
  });

  it("refuses to sign for an invalid content hash", () => {
    expect(signSourcePageMap({ uid: UID, contentHash: "not-a-hash", pages: PAGES, now: NOW })).toBeNull();
  });
});

describe("missing signing secret (fail closed)", () => {
  it("does not sign when SESSION_SECRET is missing", () => {
    delete process.env.SESSION_SECRET;
    expect(signSourcePageMap({ uid: UID, contentHash: DOC_A, pages: PAGES, now: NOW })).toBeNull();
  });

  it("does not accept a map when SESSION_SECRET is missing at verification time", () => {
    const map = signed();
    delete process.env.SESSION_SECRET;
    expect(verifySourcePageMap(map, { uid: UID, now: NOW })).toMatchObject({ ok: false, reason: "signing-unavailable" });
  });
});
