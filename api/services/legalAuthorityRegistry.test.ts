import { describe, expect, it } from "vitest";
import {
  LEGAL_AUTHORITY_REGISTRY,
  entryFingerprint,
  getRegistryEntry,
  referenceFromKey,
  statusFor,
  unverifiedReference,
  matchRegistryByCitation,
  registryPromptList,
  authorityFitsCharterSection,
} from "./legalAuthorityRegistry.js";
import { LEGAL_AUTHORITY_VERIFICATION, type AuthorityVerificationRecord } from "./legalAuthorityVerification.js";
import { pageText, verifyEntry, runVerification, renderVerificationFile, type Fetcher } from "../../scripts/verifyLegalAuthorities.js";

const rec = (key: string, patch: Partial<AuthorityVerificationRecord> = {}): AuthorityVerificationRecord => ({
  checkedAt: "2026-10-13T00:00:00.000Z",
  fingerprint: entryFingerprint(getRegistryEntry(key)!),
  ok: true,
  httpStatus: 200,
  matched: [],
  missing: [],
  ...patch,
});

describe("registry integrity", () => {
  it("ships with NO recorded retrieval checks, so nothing can be shown as verified", () => {
    expect(LEGAL_AUTHORITY_VERIFICATION.generatedAt).toBeNull();
    expect(Object.keys(LEGAL_AUTHORITY_VERIFICATION.entries)).toHaveLength(0);
    for (const e of LEGAL_AUTHORITY_REGISTRY) {
      expect(referenceFromKey(e.key)!.status).not.toBe("VERIFIED");
    }
  });

  it("has unique keys and a verification string for every entry", () => {
    const keys = LEGAL_AUTHORITY_REGISTRY.map((e) => e.key);
    expect(new Set(keys).size).toBe(keys.length);
    for (const e of LEGAL_AUTHORITY_REGISTRY) expect(e.verifyText.length).toBeGreaterThan(0);
  });

  it("only gives official-publisher deep links to statutes and the Charter; cases link to CanLII or nowhere", () => {
    for (const e of LEGAL_AUTHORITY_REGISTRY) {
      if (e.kind === "CASE") {
        if (e.officialUrl) expect(e.officialUrl).toMatch(/^https:\/\/www\.canlii\.org\//);
        expect(e.lookupUrl).toMatch(/^https:\/\//);
      } else {
        expect(e.officialUrl).toMatch(/^https:\/\/(www\.ontario\.ca|laws-lois\.justice\.gc\.ca)\//);
      }
    }
  });

  it("every case carries a limitation or states it is a child-protection decision", () => {
    for (const e of LEGAL_AUTHORITY_REGISTRY.filter((x) => x.kind === "CASE")) {
      expect(e.generallyCitedFor, e.key).toBeTruthy();
    }
  });

  it("never lets the repo's unconfirmed s. 81 pass as a confirmed reference", () => {
    expect(getRegistryEntry("cyfsa-s81")!.confirmedReference).toBeFalsy();
    expect(getRegistryEntry("cyfsa-s81")!.limitation).toMatch(/confirm/i);
    expect(getRegistryEntry("cyfsa-s94-5")!.generallyCitedFor).toMatch(/not a hearing-timeline rule/);
  });
});

describe("status derivation", () => {
  it("is CANDIDATE with an UNCHECKED link when no check is recorded", () => {
    expect(statusFor(getRegistryEntry("case-grant-2009")!, {})).toEqual({ status: "CANDIDATE", urlStatus: "UNCHECKED" });
    expect(statusFor(getRegistryEntry("case-hunter-1984")!, {})).toEqual({ status: "CANDIDATE", urlStatus: "NONE" });
  });

  it("is VERIFIED only with a current, successful recorded check", () => {
    expect(statusFor(getRegistryEntry("charter-s7")!, { "charter-s7": rec("charter-s7") })).toEqual({ status: "VERIFIED", urlStatus: "VERIFIED" });
  });

  it("ignores a recorded check made against a different version of the entry", () => {
    const stale = rec("charter-s7", { fingerprint: "old" });
    expect(statusFor(getRegistryEntry("charter-s7")!, { "charter-s7": stale }).status).toBe("CANDIDATE");
  });

  it("withholds the link after a definite failure, and treats an inconclusive check as nothing learned", () => {
    const broken = referenceFromKey("charter-s8", { "charter-s8": rec("charter-s8", { ok: false, httpStatus: 404 }) })!;
    expect(broken.status).toBe("CANDIDATE");
    expect(broken.urlStatus).toBe("BROKEN");
    expect(broken.url).toBeUndefined();
    expect(broken.limitation).toMatch(/link is withheld/);

    const blocked = referenceFromKey("charter-s8", { "charter-s8": rec("charter-s8", { ok: false, inconclusive: true, httpStatus: 403 }) })!;
    expect(blocked.urlStatus).toBe("UNCHECKED");
    expect(blocked.url).toBe(getRegistryEntry("charter-s8")!.officialUrl);
  });

  it("returns null for a key that is not in the registry", () => {
    expect(referenceFromKey("case-made-up-2031")).toBeNull();
  });
});

describe("model-written citations", () => {
  it("never gives free text a link or a verified status", () => {
    const r = unverifiedReference("Re B.R. (2019), 123 O.R. (3d) 456 (Ont. C.A.)");
    expect(r.status).toBe("UNVERIFIED");
    expect(r.url).toBeUndefined();
    expect(r.urlStatus).toBe("NONE");
    expect(r.limitation).toMatch(/Do not rely on it/);
  });

  it("recognises a registry case written out in free text, but only as a candidate", () => {
    expect(matchRegistryByCitation("see R. v. Grant, 2009 SCC 32 at para 44")!.key).toBe("case-grant-2009");
    expect(matchRegistryByCitation("Hunter v. Southam, [1984] 2 S.C.R. 145")!.key).toBe("case-hunter-1984");
    expect(matchRegistryByCitation("Smith v. Jones, 2011 SCC 99")).toBeUndefined();
  });

  it("lists only registry keys in the prompt", () => {
    const list = registryPromptList();
    for (const e of LEGAL_AUTHORITY_REGISTRY) expect(list).toContain(e.key + ":");
  });
});

describe("matching an authority to a Charter section", () => {
  it("keeps cases on their own section and drops the rest", () => {
    const grant = getRegistryEntry("case-grant-2009")!;
    expect(authorityFitsCharterSection(grant, "9")).toBe(true);
    expect(authorityFitsCharterSection(grant, "12")).toBe(false);
    expect(authorityFitsCharterSection(getRegistryEntry("case-smith-1987")!, "8")).toBe(false);
    expect(authorityFitsCharterSection(getRegistryEntry("case-khelawon-2006")!, "8")).toBe(true); // general evidence authority
    expect(authorityFitsCharterSection(getRegistryEntry("charter-s8")!, "7")).toBe(false);
    expect(authorityFitsCharterSection(getRegistryEntry("cyfsa-s74-2")!, "15")).toBe(true);
  });
});

describe("verification script", () => {
  const html = (body: string) => `<html><head><style>x{}</style><script>var a=1</script></head><body>${body}</body></html>`;
  const long = (s: string) => s + " ".repeat(10) + "filler text ".repeat(300);
  const fetcherOf = (status: number, body = ""): Fetcher => async () => ({ status, url: "https://example.test/final", text: async () => body });

  it("strips markup and entities before matching", () => {
    expect(pageText(html("<p>Charter &amp; <b>Rights</b></p>"))).toContain("charter & rights");
  });

  it("verifies when the page is fetched and every expected string is present", async () => {
    const e = getRegistryEntry("charter-s8")!;
    const r = await verifyEntry(e, fetcherOf(200, html(long("<p>Everyone has the right to be secure against unreasonable search or seizure. Canadian Charter of Rights and Freedoms</p>"))));
    expect(r!.ok).toBe(true);
    expect(r!.fingerprint).toBe(entryFingerprint(e));
  });

  it("records a definite failure for 404 and for a loaded page missing the text", async () => {
    const e = getRegistryEntry("charter-s8")!;
    const notFound = await verifyEntry(e, fetcherOf(404));
    expect(notFound).toMatchObject({ ok: false, httpStatus: 404 });
    expect(notFound!.inconclusive).toBeUndefined();
    const mismatch = await verifyEntry(e, fetcherOf(200, html(long("<p>Canadian Charter of Rights and Freedoms</p>"))));
    expect(mismatch).toMatchObject({ ok: false });
    expect(mismatch!.inconclusive).toBeUndefined();
    expect(mismatch!.missing).toContain("unreasonable search or seizure");
  });

  it("treats a blocked request, a server error, a network failure and an empty shell as inconclusive", async () => {
    const e = getRegistryEntry("case-grant-2009")!;
    for (const f of [fetcherOf(403), fetcherOf(429), fetcherOf(503), fetcherOf(200, html("<div id=app></div>"))]) {
      expect((await verifyEntry(e, f))!).toMatchObject({ ok: false, inconclusive: true });
    }
    const boom: Fetcher = async () => {
      throw new Error("ECONNRESET");
    };
    expect((await verifyEntry(e, boom))!).toMatchObject({ ok: false, inconclusive: true, httpStatus: null });
  });

  it("does not check entries that have no link", async () => {
    expect(await verifyEntry(getRegistryEntry("case-hunter-1984")!, fetcherOf(200, "x"))).toBeNull();
  });

  it("produces a file that statusFor reads back as VERIFIED, and renders valid TypeScript", async () => {
    const entries = LEGAL_AUTHORITY_REGISTRY.filter((e) => e.key === "charter-s7");
    const file = await runVerification(
      fetcherOf(200, html(long("Canadian Charter of Rights and Freedoms: life, liberty and security of the person"))),
      entries,
      () => new Date("2026-10-13T12:00:00Z")
    );
    expect(file.generatedAt).toBe("2026-10-13T12:00:00.000Z");
    expect(statusFor(entries[0], file.entries).status).toBe("VERIFIED");
    const src = renderVerificationFile(file);
    expect(src).toContain("export const LEGAL_AUTHORITY_VERIFICATION");
    expect(src).toContain('"charter-s7"');
  });
});
