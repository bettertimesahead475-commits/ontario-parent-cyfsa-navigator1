import { describe, it, expect } from "vitest";
import {
  resolveLegalAuthority,
  classifyStatutoryCitation,
  VERIFIED_STATUTORY_PROVISIONS,
} from "../../shared/legalVerificationPipeline";

describe("Authoritative Legal Citation Verification Pipeline", () => {
  describe("1. Valid CYFSA sections, subsections, clauses, decimal sections, and paragraphs", () => {
    it("resolves Section 74(2) child in need of protection grounds and specific clauses", () => {
      const res = resolveLegalAuthority("CYFSA s. 74(2)");
      expect(res.status).toBe("VERIFIED");
      expect(res.category).toBe("CYFSA");
      expect(res.entry?.id).toBe("CYFSA:74(2)");
      expect(res.entry?.citation).toBe("CYFSA, s. 74(2)");
      expect(res.entry?.heading).toBe("Child in need of protection — Specific grounds");
      expect(res.entry?.sourceUrl).toContain("ontario.ca/laws/statute/17c14");
      expect(res.entry?.exactWording).toContain("A child is in need of protection");
      expect(res.entry?.verificationSourceType).toBe("BUNDLED_CONSOLIDATION_VERBATIM");

      const clauseRes = resolveLegalAuthority("CYFSA s. 74(2)(d.1)");
      expect(clauseRes.status).toBe("VERIFIED");
      expect(clauseRes.entry?.id).toBe("CYFSA:74(2)");
    });

    it("resolves Section 88 time in place of safety limited (5-day apprehension rule)", () => {
      const res = resolveLegalAuthority("CYFSA s. 88 (5-day hearing deadline)");
      expect(res.status).toBe("VERIFIED");
      expect(res.entry?.id).toBe("CYFSA:88");
      expect(res.entry?.citation).toBe("CYFSA, s. 88");
      expect(res.entry?.heading).toBe("Time in place of safety limited — 5-Day Hearing Requirement");
      expect(res.entry?.exactWording).toContain("within five days");
    });

    it("resolves Section 81(1), 81(7), 90(1), 94(1), 125(1), 9.1, 121(2.1), and 312(1)", () => {
      expect(resolveLegalAuthority("CYFSA s. 81(1)").entry?.id).toBe("CYFSA:81(1)");
      expect(resolveLegalAuthority("CYFSA s. 81(7)").entry?.id).toBe("CYFSA:81(7)");
      expect(resolveLegalAuthority("CYFSA Section 90(1)").entry?.id).toBe("CYFSA:90(1)");
      expect(resolveLegalAuthority("CYFSA s. 94(1)").entry?.id).toBe("CYFSA:94(1)");
      expect(resolveLegalAuthority("CYFSA s. 125").entry?.id).toBe("CYFSA:125(1)");
      expect(resolveLegalAuthority("CYFSA s. 9.1").entry?.id).toBe("CYFSA:9.1");
      expect(resolveLegalAuthority("CYFSA s. 121(2.1)").entry?.id).toBe("CYFSA:121(2.1)");
      expect(resolveLegalAuthority("CYFSA s. 312(1)").entry?.id).toBe("CYFSA:312(1)");
    });

    it("resolves numbered paragraphs and non-funding supervision condition subsections", () => {
      expect(resolveLegalAuthority("CYFSA s. 1(2), para. 2").entry?.id).toBe("CYFSA:1(2), para. 2");
      expect(resolveLegalAuthority("CYFSA s. 101(1), para. 1").entry?.id).toBe("CYFSA:101(1), para. 1");
      expect(resolveLegalAuthority("CYFSA s. 94(6)(c)").entry?.id).toBe("CYFSA:94(6)");
      expect(resolveLegalAuthority("CYFSA s. 101(7)(c)").entry?.id).toBe("CYFSA:101(7)");
    });
  });

  describe("2. Category separation: Family Law Rules, Charter, and Bill C-92", () => {
    it("resolves Family Law Rules Rule 14(18), 14(19), and 33 under FAMILY_LAW_RULES category", () => {
      const res = resolveLegalAuthority("FLR Rule 14(18)");
      expect(res.status).toBe("VERIFIED");
      expect(res.category).toBe("FAMILY_LAW_RULES");
      expect(res.entry?.id).toBe("FLR:14(18)");
      expect(res.entry?.citation).toBe("Family Law Rules, O. Reg. 114/99, Rule 14(18)");
      expect(res.entry?.heading).toBe("Affidavit evidence on motions — Information and belief");
      expect(res.entry?.exactWording).toContain("information and belief");
      expect(res.entry?.verificationSourceType).toBe("REGULATION_REFERENCE_SUMMARY");

      const r19 = resolveLegalAuthority("Family Law Rules, r. 14(19)");
      expect(r19.status).toBe("VERIFIED");
      expect(r19.category).toBe("FAMILY_LAW_RULES");
      expect(r19.entry?.id).toBe("FLR:14(19)");

      const r33 = resolveLegalAuthority("Family Law Rules Rule 33");
      expect(r33.status).toBe("VERIFIED");
      expect(r33.category).toBe("FAMILY_LAW_RULES");
      expect(r33.entry?.id).toBe("FLR:33");
    });

    it("resolves Charter Section 7 and Section 15 under CHARTER category", () => {
      const res = resolveLegalAuthority("Canadian Charter of Rights and Freedoms s. 7");
      expect(res.status).toBe("VERIFIED");
      expect(res.category).toBe("CHARTER");
      expect(res.entry?.id).toBe("CHARTER:7");
      expect(res.entry?.citation).toBe("Canadian Charter of Rights and Freedoms, Section 7");
      expect(res.entry?.heading).toBe("Life, liberty and security of the person");
      expect(res.entry?.verificationSourceType).toBe("CONSTITUTIONAL_TEXT");

      const s15 = resolveLegalAuthority("Canadian Charter of Rights and Freedoms s. 15");
      expect(s15.status).toBe("VERIFIED");
      expect(s15.category).toBe("CHARTER");
      expect(s15.entry?.id).toBe("CHARTER:15");
    });

    it("resolves federal Bill C-92 (S.C. 2019, c. 24) sections 10, 12, 14, 15, 15.1, and 16 under BILL_C92 category", () => {
      const s14 = resolveLegalAuthority("Bill C-92, s. 14");
      expect(s14.status).toBe("VERIFIED");
      expect(s14.category).toBe("BILL_C92");
      expect(s14.entry?.id).toBe("BILL_C92:14(1)");
      expect(s14.entry?.exactWording).toContain("preventive care");

      const s15 = resolveLegalAuthority("Bill C-92, s. 15");
      expect(s15.status).toBe("VERIFIED");
      expect(s15.entry?.id).toBe("BILL_C92:15");
      expect(s15.entry?.exactWording).toContain("socio-economic conditions");

      const s16 = resolveLegalAuthority("Bill C-92, s. 16");
      expect(s16.status).toBe("VERIFIED");
      expect(s16.entry?.id).toBe("BILL_C92:16(1)");
      expect(s16.entry?.exactWording).toContain("order of priority");
    });
  });

  describe("3. Invalid and fabricated citations", () => {
    it("classifies unknown, fabricated, or repealed citations as UNVERIFIED with explanatory reason", () => {
      const res = classifyStatutoryCitation("CYFSA s. 999(4)");
      expect(res.status).toBe("UNVERIFIED");
      expect(res.reason).toContain("does not match any authoritative Ontario statute or rule consolidation");

      expect(resolveLegalAuthority("CYFSA s. 88(2)").status).toBe("UNVERIFIED");
      expect(resolveLegalAuthority("CYFSA s. 102(9)").status).toBe("UNVERIFIED");
      expect(resolveLegalAuthority("CYFSA s. 74(2)(z)").status).toBe("UNVERIFIED");
      expect(resolveLegalAuthority("CYFSA s. 3, para. 6").status).toBe("UNVERIFIED");
    });
  });

  describe("4. Historical legal versions and temporal matching", () => {
    it("flags CYFSA provisions as INAPPLICABLE before April 30, 2018 (when CFSA R.S.O. 1990 applied)", () => {
      const res = resolveLegalAuthority("CYFSA s. 74(2)", { caseDate: "2017-06-15" });
      expect(res.status).toBe("INAPPLICABLE");
      expect(res.sourceExists).toBe(true);
      expect(res.temporalStatus).toBe("BEFORE_EARLIEST_VERSION");
      expect(res.warningText).toContain("2018-04-30");
    });

    it("flags Part X s. 312(1) and Bill C-92 as INAPPLICABLE before January 1, 2020", () => {
      const partX = resolveLegalAuthority("CYFSA s. 312(1)", { caseDate: "2019-05-01" });
      expect(partX.status).toBe("INAPPLICABLE");
      expect(partX.temporalStatus).toBe("BEFORE_EARLIEST_VERSION");

      const c92 = resolveLegalAuthority("Bill C-92, s. 16", { caseDate: "2019-08-01" });
      expect(c92.status).toBe("INAPPLICABLE");
      expect(c92.temporalStatus).toBe("BEFORE_EARLIEST_VERSION");
    });

    it("flags s. 121(2.1), s. 74(2)(d.1), and s. 9.1 when cited before their respective enactment dates", () => {
      expect(resolveLegalAuthority("CYFSA s. 121(2.1)", { caseDate: "2020-06-01" }).temporalStatus).toBe("BEFORE_EARLIEST_VERSION");
      expect(resolveLegalAuthority("CYFSA s. 74(2)(d.1)", { caseDate: "2021-05-01" }).temporalStatus).toBe("BEFORE_EARLIEST_VERSION");
      expect(resolveLegalAuthority("CYFSA s. 9.1", { caseDate: "2023-11-01" }).temporalStatus).toBe("BEFORE_EARLIEST_VERSION");
      expect(resolveLegalAuthority("CYFSA s. 9.1", { caseDate: "2025-02-01" }).status).toBe("VERIFIED");
    });
  });

  describe("5. Correctly cited but legally irrelevant or misapplied provisions & unsupported propositions", () => {
    it("flags s. 94(1) or s. 94(5) when misapplied to the 5-day post-apprehension hearing deadline", () => {
      const res = resolveLegalAuthority("CYFSA s. 94(1)", {
        proposition: "The Society failed to bring the matter to court within the 5-day post-apprehension hearing deadline.",
      });
      expect(res.status).toBe("INAPPLICABLE");
      expect(res.sourceExists).toBe(true);
      expect(res.propositionSupport).toBe("IRRELEVANT_OR_MISAPPLIED");
      expect(res.warningText).toContain("CYFSA s. 88");
    });

    it("flags s. 125(1) when misapplied as proof that a child is in need of protection", () => {
      const res = resolveLegalAuthority("CYFSA s. 125(1)", {
        proposition: "Section 125(1) proves the child is in need of protection.",
      });
      expect(res.status).toBe("INAPPLICABLE");
      expect(res.sourceExists).toBe(true);
      expect(res.propositionSupport).toBe("IRRELEVANT_OR_MISAPPLIED");
    });

    it("flags s. 81(1) when misapplied as warrantless apprehension authority, and s. 81(12) when misapplied as Crown liability or midnight curfew power", () => {
      const r81 = resolveLegalAuthority("CYFSA s. 81(1)", {
        proposition: "The worker exercised warrantless apprehension authority under s. 81(1).",
      });
      expect(r81.status).toBe("INAPPLICABLE");
      expect(r81.propositionSupport).toBe("IRRELEVANT_OR_MISAPPLIED");

      const r8112 = resolveLegalAuthority("CYFSA s. 81(12)", {
        proposition: "Crown liability and personal liability immunity under s. 81(12).",
      });
      expect(r8112.status).toBe("INAPPLICABLE");
      expect(r8112.propositionSupport).toBe("IRRELEVANT_OR_MISAPPLIED");
    });

    it("flags s. 102(1) when misapplied as a supervision order", () => {
      const r102 = resolveLegalAuthority("CYFSA s. 102(1)", {
        proposition: "The court made a supervision order under s. 102(1).",
      });
      expect(r102.status).toBe("INAPPLICABLE");
      expect(r102.propositionSupport).toBe("IRRELEVANT_OR_MISAPPLIED");
    });

    it("flags universal CAS service-funding claims as CONTRADICTED_BY_STATUTE under s. 94(6)(c) and s. 101(7)(c)", () => {
      const r94 = resolveLegalAuthority("CYFSA s. 94(6)(c)", {
        proposition: "CAS has a universal duty to fund and pay for all private therapy and services.",
      });
      expect(r94.status).toBe("INAPPLICABLE");
      expect(r94.sourceExists).toBe(true);
      expect(r94.propositionSupport).toBe("CONTRADICTED_BY_STATUTE");
      expect(r94.warningText).toContain("shall not require the society to provide financial assistance");

      const r101 = resolveLegalAuthority("CYFSA s. 101(7)(c)", {
        proposition: "The court must order the society to purchase private goods and services for the family.",
      });
      expect(r101.status).toBe("INAPPLICABLE");
      expect(r101.propositionSupport).toBe("CONTRADICTED_BY_STATUTE");
    });

    it("retains backwards-compatible aliases in VERIFIED_STATUTORY_PROVISIONS", () => {
      expect(VERIFIED_STATUTORY_PROVISIONS["74(2)"].id).toBe("CYFSA:74(2)");
      expect(VERIFIED_STATUTORY_PROVISIONS["88"].id).toBe("CYFSA:88");
      expect(VERIFIED_STATUTORY_PROVISIONS["FLR_14_18"].id).toBe("FLR:14(18)");
      expect(VERIFIED_STATUTORY_PROVISIONS["CHARTER_7"].id).toBe("CHARTER:7");
    });
  });
});
