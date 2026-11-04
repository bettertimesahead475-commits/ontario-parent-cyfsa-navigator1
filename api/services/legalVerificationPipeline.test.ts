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
      expect(VERIFIED_STATUTORY_PROVISIONS["FLR_1_8"].id).toBe("FLR:1(8)");
      expect(VERIFIED_STATUTORY_PROVISIONS["CHARTER_7"].id).toBe("CHARTER:7");
      expect(VERIFIED_STATUTORY_PROVISIONS["CHARTER_24_1"].id).toBe("CHARTER:24(1)");
    });
  });

  describe("6. Milestone 1 Legal Accuracy Hotfix Regression Suite", () => {
    describe("Hotfix 1: CYFSA s. 102(1) custody order vs s. 101(1) supervision order attribution", () => {
      it("accepts accurate comparisons between a custody order under s. 102(1) and a supervision order under s. 101(1)", () => {
        const res1 = resolveLegalAuthority("CYFSA s. 102(1)", {
          proposition: "Under CYFSA s. 102(1), the court may grant a custody order instead of a supervision order under s. 101(1), para. 1.",
        });
        expect(res1.status).toBe("VERIFIED");
        expect(res1.propositionSupport).toBe("SUPPORTED");

        const res2 = resolveLegalAuthority("CYFSA s. 102(1) and s. 101(1)", {
          proposition: "Whereas CYFSA s. 101(1), para. 1 governs a supervision order, CYFSA s. 102(1) authorizes a custody order.",
        });
        expect(res2.status).toBe("VERIFIED");
        expect(res2.propositionSupport).toBe("SUPPORTED");
      });

      it("rejects propositions that attribute a supervision order to s. 102(1) even when 'instead of' or 's. 101' appears", () => {
        const mis1 = resolveLegalAuthority("CYFSA s. 102(1)", {
          proposition: "Instead of s. 101(1), CYFSA s. 102(1) authorizes a supervision order.",
        });
        expect(mis1.status).toBe("INAPPLICABLE");
        expect(mis1.propositionSupport).toBe("IRRELEVANT_OR_MISAPPLIED");

        const mis2 = resolveLegalAuthority("CYFSA s. 102(1)", {
          proposition: "Under CYFSA s. 102(1), the court may make a supervision order instead of a custody order.",
        });
        expect(mis2.status).toBe("INAPPLICABLE");
        expect(mis2.propositionSupport).toBe("IRRELEVANT_OR_MISAPPLIED");

        const mis3 = resolveLegalAuthority("CYFSA s. 102(1)", {
          proposition: "Under CYFSA s. 102(1), the court may grant a custody order or a supervision order.",
        });
        expect(mis3.status).toBe("INAPPLICABLE");
        expect(mis3.propositionSupport).toBe("IRRELEVANT_OR_MISAPPLIED");
      });
    });

    describe("Hotfix 2: CYFSA s. 81(1), s. 81(2), and s. 81(7) multi-authority attribution", () => {
      it("accepts multi-authority propositions that accurately distinguish application (s. 81(1)), warrant (s. 81(2)), and warrantless apprehension (s. 81(7))", () => {
        const res = resolveLegalAuthority("CYFSA s. 81(1) and s. 81(7)", {
          proposition:
            "Under CYFSA s. 81(1), a society may apply to the court to determine whether a child is in need of protection, whereas warrantless apprehension is governed by s. 81(7).",
        });
        expect(res.status).toBe("VERIFIED");
        expect(res.propositionSupport).toBe("SUPPORTED");
        expect(res.allSectionsCited).toEqual(["81(1)", "81(7)"]);

        const resWarrant = resolveLegalAuthority("CYFSA s. 81(1), s. 81(2), and s. 81(7)", {
          proposition:
            "Section 81(1) governs applications to court, s. 81(2) governs warrants to apprehend a child, and s. 81(7) governs apprehension without a warrant.",
        });
        expect(resWarrant.status).toBe("VERIFIED");
        expect(resWarrant.propositionSupport).toBe("SUPPORTED");
      });

      it("does not allow a valid s. 81(7) citation to conceal an invalid attribution of warrantless apprehension to s. 81(1) or s. 81(2)", () => {
        const misMulti1 = resolveLegalAuthority("CYFSA s. 81(1) and s. 81(7)", {
          proposition:
            "Both CYFSA s. 81(1) and s. 81(7) authorize warrantless apprehension where the worker believes there is risk.",
        });
        expect(misMulti1.status).toBe("INAPPLICABLE");
        expect(misMulti1.propositionSupport).toBe("IRRELEVANT_OR_MISAPPLIED");

        const misMulti2 = resolveLegalAuthority("CYFSA s. 81(1) and s. 81(7)", {
          proposition:
            "Under CYFSA s. 81(1), the worker conducted a warrantless apprehension, and s. 81(7) also applies.",
        });
        expect(misMulti2.status).toBe("INAPPLICABLE");
        expect(misMulti2.propositionSupport).toBe("IRRELEVANT_OR_MISAPPLIED");

        const misWarrant = resolveLegalAuthority("CYFSA s. 81(2) and s. 81(7)", {
          proposition: "Under CYFSA s. 81(2), a child protection worker may apprehend a child without a warrant.",
        });
        expect(misWarrant.status).toBe("INAPPLICABLE");
        expect(misWarrant.propositionSupport).toBe("IRRELEVANT_OR_MISAPPLIED");

        const mis817 = resolveLegalAuthority("CYFSA s. 81(7)", {
          proposition: "Under CYFSA s. 81(7), a justice of the peace may issue a warrant to apprehend a child.",
        });
        expect(mis817.status).toBe("INAPPLICABLE");
        expect(mis817.propositionSupport).toBe("IRRELEVANT_OR_MISAPPLIED");
      });
    });

    describe("Hotfix 3: CYFSA s. 88 and s. 94(1) combined procedural timelines & false deadline claims", () => {
      it("accepts combined procedural timelines that accurately attribute the 5-day hearing to s. 88 and the 30-day adjournment limit to s. 94(1)", () => {
        const combo1 = resolveLegalAuthority("CYFSA s. 88 and s. 94(1)", {
          proposition:
            "Following apprehension, the matter was brought to court within the 5-day post-apprehension hearing deadline under CYFSA s. 88, and the court subsequently adjourned the hearing for more than 30 days contrary to s. 94(1).",
        });
        expect(combo1.status).toBe("VERIFIED");
        expect(combo1.propositionSupport).toBe("SUPPORTED");

        const combo2 = resolveLegalAuthority("CYFSA s. 94(1)", {
          proposition:
            "After the initial 5-day hearing under s. 88 was completed, the temporary care and custody hearing was adjourned for 42 days without consent contrary to s. 94(1).",
        });
        expect(combo2.status).toBe("VERIFIED");
        expect(combo2.propositionSupport).toBe("SUPPORTED");
      });

      it("rejects swapped timeline attributions and genuinely false statutory deadline claims under s. 88 and s. 94(1)", () => {
        const swapped = resolveLegalAuthority("CYFSA s. 88 and s. 94(1)", {
          proposition:
            "Under CYFSA s. 94(1), the initial post-apprehension hearing must occur within 5 days, whereas s. 88 limits adjournments to 30 days.",
        });
        expect(swapped.status).toBe("INAPPLICABLE");
        expect(swapped.propositionSupport).toBe("IRRELEVANT_OR_MISAPPLIED");

        const false88Deadline = resolveLegalAuthority("CYFSA s. 88", {
          proposition:
            "Under CYFSA s. 88, the Society has a 10-day post-apprehension hearing deadline to bring the matter before the court.",
        });
        expect(false88Deadline.status).toBe("INAPPLICABLE");
        expect(false88Deadline.propositionSupport).toBe("CONTRADICTED_BY_STATUTE");

        const false94Deadline = resolveLegalAuthority("CYFSA s. 94(1)", {
          proposition:
            "Under CYFSA s. 94(1), the court may adjourn a temporary care hearing for up to 60 days without consent.",
        });
        expect(false94Deadline.status).toBe("INAPPLICABLE");
        expect(false94Deadline.propositionSupport).toBe("CONTRADICTED_BY_STATUTE");
      });
    });

    describe("Hotfix 5: Synchronized Family Law Rules r. 1(8) and Charter s. 24(1) verification", () => {
      it("verifies Family Law Rules r. 1(8) and rejects unverified subrules or misapplied propositions", () => {
        const r18 = resolveLegalAuthority("Family Law Rules, O. Reg. 114/99, Rule 1(8)", {
          proposition: "Remedies for failure to obey a court order include costs, striking pleadings, or postponement.",
        });
        expect(r18.status).toBe("VERIFIED");
        expect(r18.authorityCategory).toBe("FAMILY_LAW_RULES");
        expect(r18.authorityId).toBe("FLR:1(8)");
        expect(r18.propositionSupport).toBe("SUPPORTED");

        const bareR18 = resolveLegalAuthority("Rule 1(8)");
        expect(bareR18.status).toBe("VERIFIED");
        expect(bareR18.authorityId).toBe("FLR:1(8)");

        const unverified181 = resolveLegalAuthority("Family Law Rules, Rule 1(8.1)");
        expect(unverified181.status).toBe("UNVERIFIED");

        const misapplied18 = resolveLegalAuthority("Family Law Rules, Rule 1(8)", {
          proposition: "Rule 1(8) authorizes warrantless apprehension of a child.",
        });
        expect(misapplied18.status).toBe("INAPPLICABLE");
        expect(misapplied18.propositionSupport).toBe("IRRELEVANT_OR_MISAPPLIED");
      });

      it("verifies Charter s. 24(1) and rejects unverified s. 24(2) or misapplied propositions", () => {
        const c24 = resolveLegalAuthority("Canadian Charter of Rights and Freedoms, s. 24(1)", {
          proposition: "Application to a court of competent jurisdiction for an appropriate and just remedy for a Charter infringement.",
        });
        expect(c24.status).toBe("VERIFIED");
        expect(c24.authorityCategory).toBe("CHARTER");
        expect(c24.authorityId).toBe("CHARTER:24(1)");
        expect(c24.propositionSupport).toBe("SUPPORTED");

        const c242 = resolveLegalAuthority("Charter s. 24(2)");
        expect(c242.status).toBe("UNVERIFIED");

        const misapplied24 = resolveLegalAuthority("Charter s. 24(1)", {
          proposition: "Charter s. 24(1) sets the 5-day post-apprehension hearing deadline.",
        });
        expect(misapplied24.status).toBe("INAPPLICABLE");
        expect(misapplied24.propositionSupport).toBe("IRRELEVANT_OR_MISAPPLIED");
      });
    });
  });
});
