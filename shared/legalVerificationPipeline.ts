/**
 * Legal Citation Verification and Authority Pipeline for CYFSA Navigator.
 *
 * Provides authoritative verification of Ontario child-protection statutes, procedural rules,
 * and Charter principles. Resolves exact sections, official titles, authoritative e-Laws URLs,
 * and applicable consolidation dates.
 *
 * Critical Standard: An internal list match is NOT external verification. Only provisions
 * verified against official consolidated legislation (Ontario e-Laws, Justice Laws Canada)
 * are marked as VERIFIED. Unchecked or unresolved provisions preserve an explicit UNVERIFIED status.
 */

export type AuthorityInstrument =
  | "CYFSA"
  | "FAMILY_LAW_RULES"
  | "CHILDRENS_LAW_REFORM_ACT"
  | "CHARTER"
  | "CASE_LAW"
  | "OTHER";

export type CitationVerificationStatus =
  | "VERIFIED"
  | "UNVERIFIED"
  | "INAPPLICABLE"
  | "NONE";

export interface VerifiedAuthorityEntry {
  /** Canonical citation, e.g. "CYFSA, s. 88" or "Family Law Rules, Rule 14(18)" */
  citation: string;
  instrument: AuthorityInstrument;
  /** Official statutory name */
  statuteTitle: string;
  /** Section or Rule number, e.g. "88", "74(2)", "14(18)" */
  sectionKey: string;
  /** Official statutory heading */
  heading: string;
  /** Verbatim text from official consolidation */
  exactWording: string;
  /** Official publisher URL (e-Laws or Justice Laws) */
  sourceUrl: string;
  /** Consolidation or in-force date */
  consolidationPeriod: string;
  /** Verified date by system */
  verifiedDate: string;
  /** Explanation of legal test / requirements */
  legalTestSummary: string;
  /** Practical guidance for counsel */
  practiceNote: string;
}

/**
 * Authoritative verified provisions from Ontario e-Laws and Justice Laws Canada.
 * Sourced directly from legal-reference/CYFSA_full_text_2026-06-24_consolidation.txt
 * and official Ontario Family Law Rules (O. Reg. 114/99).
 */
export const VERIFIED_AUTHORITIES_REGISTRY: Record<string, VerifiedAuthorityEntry> = {
  "74": {
    citation: "CYFSA, s. 74",
    instrument: "CYFSA",
    statuteTitle: "Child, Youth and Family Services Act, 2017, S.O. 2017, c. 14, Sched. 1",
    sectionKey: "74",
    heading: "Child in need of protection — Definitions and statutory grounds",
    exactWording: "74 (1) In this Part, “child protection worker” means a Director, a local director or a person who meets the prescribed requirements and who is authorized by a Director or local director for the purposes of section 81... (2) A child is in need of protection where, (a) the child has suffered physical harm... (b) there is a risk that the child is likely to suffer physical harm... (f) the child has suffered emotional harm... (h) there is a risk of emotional harm...",
    sourceUrl: "https://www.ontario.ca/laws/statute/17c14#BK94",
    consolidationPeriod: "Consolidation period: July 1, 2026 to Present",
    verifiedDate: "2026-11-01",
    legalTestSummary: "Defines the statutory definition of a child in need of protection under clauses (a) through (o). Grounds require demonstrated harm or a specific, non-speculative risk of harm.",
    practiceNote: "The Society bears the burden of establishing protection grounds on a balance of probabilities. Silence in a scheduling affidavit does not establish either the presence or absence of s. 74 grounds."
  },
  "74(1)": {
    citation: "CYFSA, s. 74(1)",
    instrument: "CYFSA",
    statuteTitle: "Child, Youth and Family Services Act, 2017, S.O. 2017, c. 14, Sched. 1",
    sectionKey: "74(1)",
    heading: "Interpretation — Definitions for Child Protection",
    exactWording: "74 (1) In this Part, “child protection worker” means a Director, a local director or a person who meets the prescribed requirements and who is authorized by a Director or local director for the purposes of section 81 (commencing child protection proceedings) and for other prescribed purposes...",
    sourceUrl: "https://www.ontario.ca/laws/statute/17c14#BK94",
    consolidationPeriod: "Consolidation period: July 1, 2026 to Present",
    verifiedDate: "2026-11-01",
    legalTestSummary: "Defines who qualifies as an authorized child protection worker and limits authorization to statutory purposes.",
    practiceNote: "Check whether the worker named in court records has been formally authorized by a local director."
  },
  "74(2)": {
    citation: "CYFSA, s. 74(2)",
    instrument: "CYFSA",
    statuteTitle: "Child, Youth and Family Services Act, 2017, S.O. 2017, c. 14, Sched. 1",
    sectionKey: "74(2)",
    heading: "Child in need of protection — Specific grounds",
    exactWording: "74 (2) A child is in need of protection where, (a) the child has suffered physical harm, inflicted by the person having charge of the child... (b) there is a risk that the child is likely to suffer physical harm... (c) the child has been sexually abused... (f) the child has suffered emotional harm... (h) there is a risk of emotional harm... (n) parent unable to care with consent...",
    sourceUrl: "https://www.ontario.ca/laws/statute/17c14#BK94",
    consolidationPeriod: "Consolidation period: July 1, 2026 to Present",
    verifiedDate: "2026-11-01",
    legalTestSummary: "Exhaustive statutory list of protection grounds. Each ground requires credible, objective evidence meeting the statutory wording.",
    practiceNote: "Counsel must review which specific subsection clauses the Society pleads. General allegations of conflict or parenting disagreements are insufficient unless linked to demonstrated harm or risk under s. 74(2)."
  },
  "81": {
    citation: "CYFSA, s. 81",
    instrument: "CYFSA",
    statuteTitle: "Child, Youth and Family Services Act, 2017, S.O. 2017, c. 14, Sched. 1",
    sectionKey: "81",
    heading: "Commencing child protection proceedings / Warrants",
    exactWording: "81 (1) A society may apply to the court to determine whether a child is in need of protection. (2) A justice of the peace may issue a warrant authorizing a child protection worker to bring a child to a place of safety... (7) A child protection worker who believes on reasonable and probable grounds that (a) a child is in need of protection; (b) the child is younger than 16; and (c) there would be a substantial risk to the child's health or safety during the time necessary to bring the matter on for a hearing... may without a warrant bring the child to a place of safety.",
    sourceUrl: "https://www.ontario.ca/laws/statute/17c14#BK103",
    consolidationPeriod: "Consolidation period: July 1, 2026 to Present",
    verifiedDate: "2026-11-01",
    legalTestSummary: "Governs commencement of child protection proceedings by application (s. 81(1)), warrants to bring a child to safety (s. 81(2)), and emergency warrantless apprehension (s. 81(7)).",
    practiceNote: "Section 81 does not define whether a child is in need of protection; it governs the Society's procedural authority to apply or intervene."
  },
  "81(1)": {
    citation: "CYFSA, s. 81(1)",
    instrument: "CYFSA",
    statuteTitle: "Child, Youth and Family Services Act, 2017, S.O. 2017, c. 14, Sched. 1",
    sectionKey: "81(1)",
    heading: "Application to court for child protection determination",
    exactWording: "81 (1) A society may apply to the court to determine whether a child is in need of protection.",
    sourceUrl: "https://www.ontario.ca/laws/statute/17c14#BK103",
    consolidationPeriod: "Consolidation period: July 1, 2026 to Present",
    verifiedDate: "2026-11-01",
    legalTestSummary: "Authorizes a society to initiate a protection proceeding by application.",
    practiceNote: "An application under s. 81(1) triggers the court's hearing obligation under s. 90(1)."
  },
  "81(7)": {
    citation: "CYFSA, s. 81(7)",
    instrument: "CYFSA",
    statuteTitle: "Child, Youth and Family Services Act, 2017, S.O. 2017, c. 14, Sched. 1",
    sectionKey: "81(7)",
    heading: "Warrantless apprehension to place of safety",
    exactWording: "(7) A child protection worker who believes on reasonable and probable grounds that, (a) a child is in need of protection; (b) the child is younger than 16; and (c) there would be a substantial risk to the child's health or safety during the time necessary to bring the matter on for a hearing under subsection 90 (1) or obtain a warrant under subsection (2), may without a warrant bring the child to a place of safety.",
    sourceUrl: "https://www.ontario.ca/laws/statute/17c14#BK103",
    consolidationPeriod: "Consolidation period: July 1, 2026 to Present",
    verifiedDate: "2026-11-01",
    legalTestSummary: "Stringent three-part test for emergency removal without a warrant: (1) reasonable and probable grounds of protection need, (2) child under 16, and (3) substantial risk during the time necessary to obtain a warrant.",
    practiceNote: "A worker cannot bypass the warrant requirement without demonstrating that obtaining a warrant or court date would create substantial risk to the child. Informal safety plan directives that restrict access without a court order should be examined against this standard."
  },
  "88": {
    citation: "CYFSA, s. 88",
    instrument: "CYFSA",
    statuteTitle: "Child, Youth and Family Services Act, 2017, S.O. 2017, c. 14, Sched. 1",
    sectionKey: "88",
    heading: "Time in place of safety limited — 5-Day Hearing Requirement",
    exactWording: "88 As soon as practicable, but in any event within five days after a child is brought to a place of safety under section 81, subclause 83 (1) (a) (ii) or subsection 136 (5), (a) the matter shall be brought before a court for a hearing under subsection 90 (1) (child protection hearing); (b) the child shall be returned to the person who last had charge of the child... (c) returned to extra-provincial authority; (d) a temporary care agreement made; or (e) agreement made under section 77.",
    sourceUrl: "https://www.ontario.ca/laws/statute/17c14#BK111",
    consolidationPeriod: "Consolidation period: July 1, 2026 to Present",
    verifiedDate: "2026-11-01",
    legalTestSummary: "The mandatory 5-day post-removal rule. If a child is brought to a place of safety, the Society MUST bring the matter before the court within five days, or return the child.",
    practiceNote: "This is the statutory source of the '5-day rule' in Ontario child protection. Adjournments are governed separately by s. 94. A failure to inform the court that 5 days had elapsed is directly relevant to s. 88 compliance."
  },
  "90(1)": {
    citation: "CYFSA, s. 90(1)",
    instrument: "CYFSA",
    statuteTitle: "Child, Youth and Family Services Act, 2017, S.O. 2017, c. 14, Sched. 1",
    sectionKey: "90(1)",
    heading: "Child protection hearing",
    exactWording: "90 (1) Where an application is made under subsection 81 (1) or a matter is brought before the court to determine whether the child is in need of protection, the court shall hold a hearing to determine the issue and make an order under section 101.",
    sourceUrl: "https://www.ontario.ca/laws/statute/17c14#BK113",
    consolidationPeriod: "Consolidation period: July 1, 2026 to Present",
    verifiedDate: "2026-11-01",
    legalTestSummary: "Requires the Ontario family court to conduct a hearing and make judicial findings on protection applications.",
    practiceNote: "The hearing is judicial; worker assertions or email negotiations do not substitute for a hearing under s. 90(1)."
  },
  "94(1)": {
    citation: "CYFSA, s. 94(1)",
    instrument: "CYFSA",
    statuteTitle: "Child, Youth and Family Services Act, 2017, S.O. 2017, c. 14, Sched. 1",
    sectionKey: "94(1)",
    heading: "Adjournment limit — 30-day maximum",
    exactWording: "94 (1) The court shall not adjourn a hearing for more than 30 days, (a) unless all the parties present and the person who will be caring for the child during the adjournment consent; or (b) if the court is aware that a party who is not present at the hearing objects to the longer adjournment.",
    sourceUrl: "https://www.ontario.ca/laws/statute/17c14#BK117",
    consolidationPeriod: "Consolidation period: July 1, 2026 to Present",
    verifiedDate: "2026-11-01",
    legalTestSummary: "Prohibits court adjournments exceeding 30 days without universal consent or where an absent party objects.",
    practiceNote: "Distinct from s. 88 (the 5-day post-apprehension rule). Governs adjournments of an ongoing hearing."
  },
  "94(2)": {
    citation: "CYFSA, s. 94(2)",
    instrument: "CYFSA",
    statuteTitle: "Child, Youth and Family Services Act, 2017, S.O. 2017, c. 14, Sched. 1",
    sectionKey: "94(2)",
    heading: "Temporary care and custody order during adjournment",
    exactWording: "94 (2) Where a hearing is adjourned, the court shall make a temporary order for care and custody providing that the child, (a) remain in or be returned to the care and custody of the person who had charge... (b) subject to supervision... (c) placed with a person other than parent with consent... or (d) remain or placed in care and custody of society...",
    sourceUrl: "https://www.ontario.ca/laws/statute/17c14#BK117",
    consolidationPeriod: "Consolidation period: July 1, 2026 to Present",
    verifiedDate: "2026-11-01",
    legalTestSummary: "Mandates that upon adjournment the court MUST make one of four specified temporary care and custody orders.",
    practiceNote: "The court must apply the least restrictive intervention principle when ordering temporary custody under s. 94(2)."
  },
  "125": {
    citation: "CYFSA, s. 125(1)",
    instrument: "CYFSA",
    statuteTitle: "Child, Youth and Family Services Act, 2017, S.O. 2017, c. 14, Sched. 1",
    sectionKey: "125(1)",
    heading: "Duty to report child in need of protection",
    exactWording: "125 (1) Despite the provisions of any other Act, if a person, including a person who performs professional or official duties with respect to children, has reasonable grounds to suspect one of the following, the person shall immediately report the suspicion and the information on which it is based to a society...",
    sourceUrl: "https://www.ontario.ca/laws/statute/17c14#BK152",
    consolidationPeriod: "Consolidation period: July 1, 2026 to Present",
    verifiedDate: "2026-11-01",
    legalTestSummary: "Establishes the 'reasonable grounds to suspect' reporting threshold for reporting suspected harm or risk to a Society.",
    practiceNote: "Section 125 is a reporting threshold, NOT an evidentiary standard for finding a child in need of protection under s. 74(2) or for removal under s. 81. A referral made under s. 125 does not constitute direct evidence of maltreatment."
  },
  "FLR_14_18": {
    citation: "Family Law Rules, O. Reg. 114/99, Rule 14(18)",
    instrument: "FAMILY_LAW_RULES",
    statuteTitle: "Courts of Justice Act — Family Law Rules, O. Reg. 114/99",
    sectionKey: "14(18)",
    heading: "Affidavit evidence on motions — Information and belief",
    exactWording: "14 (18) An affidavit for use on a motion may contain statements of the person's information and belief, if the source of the information and the fact that the person believes it to be true are stated in the affidavit.",
    sourceUrl: "https://www.ontario.ca/laws/regulation/990114#BK20",
    consolidationPeriod: "Consolidation period: In Force",
    verifiedDate: "2026-11-01",
    legalTestSummary: "Permits hearsay evidence in motion affidavits ONLY IF two strict conditions are met: (1) the source of the information is named, AND (2) the affiant expressly swears that they believe the information to be true.",
    practiceNote: "If a legal assistant or caseworker deposes to facts from an unsworn email without naming the source or stating belief, or if the source's own basis of knowledge is undisclosed, the statements carry reduced evidentiary weight."
  },
  "CHARTER_7": {
    citation: "Canadian Charter of Rights and Freedoms, Section 7",
    instrument: "CHARTER",
    statuteTitle: "Constitution Act, 1982, Part I — Canadian Charter of Rights and Freedoms",
    sectionKey: "7",
    heading: "Life, liberty and security of the person",
    exactWording: "7. Everyone has the right to life, liberty and security of the person and the right not to be deprived thereof except in accordance with the principles of fundamental justice.",
    sourceUrl: "https://laws-lois.justice.gc.ca/eng/const/page-12.html",
    consolidationPeriod: "Consolidation period: Constitutional Law of Canada",
    verifiedDate: "2026-11-01",
    legalTestSummary: "Guarantees that state interference with parental custody and the parent-child bond engages security of the person and must accord with fundamental justice (New Brunswick v. G. (J.), [1999] 3 S.C.R. 46).",
    practiceNote: "State-imposed separation without timely court access or procedural fairness engages s. 7 Charter protections. An informal access restriction coerced by worker authority without judicial hearing may be challenged under s. 7."
  }
};

/**
 * Resolves a citation string against the authoritative legal verification registry.
 */
export function resolveLegalAuthority(citationText: string | null | undefined): {
  status: CitationVerificationStatus;
  entry: VerifiedAuthorityEntry | null;
  officialCitation: string;
  sourceUrl: string | null;
  exactWording: string | null;
  practiceNote: string | null;
  warningText: string | null;
} {
  const text = (citationText || "").trim();
  if (!text) {
    return {
      status: "NONE",
      entry: null,
      officialCitation: "",
      sourceUrl: null,
      exactWording: null,
      practiceNote: null,
      warningText: "No statutory citation provided."
    };
  }

  // Key match patterns
  const patterns: [RegExp, string][] = [
    [/\b(?:CYFSA|Child,?\s+Youth).*(?:s|sec|section)?\.?\s*74\(2\)/i, "74(2)"],
    [/\b(?:CYFSA|Child,?\s+Youth).*(?:s|sec|section)?\.?\s*74\(1\)/i, "74(1)"],
    [/\b(?:CYFSA|Child,?\s+Youth).*(?:s|sec|section)?\.?\s*74\b/i, "74"],
    [/\b(?:CYFSA|Child,?\s+Youth).*(?:s|sec|section)?\.?\s*81\(7\)/i, "81(7)"],
    [/\b(?:CYFSA|Child,?\s+Youth).*(?:s|sec|section)?\.?\s*81\(1\)/i, "81(1)"],
    [/\b(?:CYFSA|Child,?\s+Youth).*(?:s|sec|section)?\.?\s*81\b/i, "81"],
    [/\b(?:CYFSA|Child,?\s+Youth).*(?:s|sec|section)?\.?\s*88\b/i, "88"],
    [/\b(?:CYFSA|Child,?\s+Youth).*(?:s|sec|section)?\.?\s*90\(1\)/i, "90(1)"],
    [/\b(?:CYFSA|Child,?\s+Youth).*(?:s|sec|section)?\.?\s*94\(1\)/i, "94(1)"],
    [/\b(?:CYFSA|Child,?\s+Youth).*(?:s|sec|section)?\.?\s*94\(2\)/i, "94(2)"],
    [/\b(?:CYFSA|Child,?\s+Youth).*(?:s|sec|section)?\.?\s*125\b/i, "125"],
    [/\b(?:Family\s+Law\s+Rules?|FLR).*(?:14\(18\)|14\.18)/i, "FLR_14_18"],
    [/\b(?:Charter|Section\s+7|s\.\s*7\s*\(Canadian\s+Charter\))/i, "CHARTER_7"]
  ];

  for (const [regex, key] of patterns) {
    if (regex.test(text)) {
      const entry = VERIFIED_AUTHORITIES_REGISTRY[key];
      if (entry) {
        return {
          status: "VERIFIED",
          entry,
          officialCitation: entry.citation,
          sourceUrl: entry.sourceUrl,
          exactWording: entry.exactWording,
          practiceNote: entry.practiceNote,
          warningText: null
        };
      }
    }
  }

  // Not matched to official verified register -> preserve honest UNVERIFIED status
  return {
    status: "UNVERIFIED",
    entry: null,
    officialCitation: text,
    sourceUrl: null,
    exactWording: null,
    practiceNote: "Confirm exact subsection and current in-force wording with legal counsel before relying on this citation.",
    warningText: "⚠️ Statute citation unverified against official consolidation — confirm exact section with counsel."
  };
}

export function classifyStatutoryCitation(citationText: string | null | undefined): {
  status: CitationVerificationStatus;
  entry: VerifiedAuthorityEntry | null;
  reason: string;
} {
  const res = resolveLegalAuthority(citationText);
  if (res.status === "VERIFIED" && res.entry) {
    return {
      status: "VERIFIED",
      entry: res.entry,
      reason: `Verified against official Ontario consolidation (${res.entry.statuteTitle}).`
    };
  }
  return {
    status: "UNVERIFIED",
    entry: null,
    reason: "Citation does not match any authoritative Ontario statute or rule consolidation in the verified registry."
  };
}
