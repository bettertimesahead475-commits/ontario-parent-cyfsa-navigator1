/**
 * Legal Citation Verification and Authority Pipeline for CYFSA Navigator.
 *
 * Provides deterministic, category-separated verification of Ontario child-protection statutes,
 * federal Indigenous child welfare legislation (Bill C-92), procedural rules, Charter provisions,
 * regulations, and judicial decisions.
 *
 * Architectural Principles:
 * 1. Authority Category Separation: CYFSA, Bill C-92, Family Law Rules, Charter provisions,
 *    regulations, and judicial decisions have distinct authority identifiers (e.g. "CYFSA:88",
 *    "FLR:14(18)", "CHARTER:7", "BILL_C92:16(1)") and category-specific verification rules.
 * 2. Deterministic Subsection & Clause Verification: Rejects fabricated or nonexistent sections,
 *    subsections, and clauses (e.g. "CYFSA s. 999", "CYFSA s. 88(2)", "CYFSA s. 74(2)(z)").
 * 3. Temporal / Version Matching: Matches citations to the applicable in-force consolidation period
 *    and rejects provisions cited for events prior to their effective date.
 * 4. Source Existence vs Proposition Support: Distinguishes whether a statutory provision exists
 *    from whether it actually supports (or contradicts) the asserted legal proposition.
 */

import {
  citedSections,
  identifyAuthorityCategory,
  isVerifiedCyfsaSection,
  resolveBundledCyfsaKey,
  type AuthorityCategory,
} from "./citationVerification";

export type AuthorityInstrument =
  | "CYFSA"
  | "BILL_C92"
  | "FAMILY_LAW_RULES"
  | "CHILDRENS_LAW_REFORM_ACT"
  | "CHARTER"
  | "REGULATION"
  | "CAS_STANDARD"
  | "PROFESSIONAL_STANDARD"
  | "OVERSIGHT_PATHWAY"
  | "CASE_LAW"
  | "OTHER";

export type CitationVerificationStatus =
  | "VERIFIED"
  | "UNVERIFIED"
  | "INAPPLICABLE"
  | "NONE";

export type VerificationSourceType =
  | "BUNDLED_CONSOLIDATION_VERBATIM"
  | "CONSTITUTIONAL_TEXT"
  | "REGULATION_REFERENCE_SUMMARY"
  | "MINISTRY_STANDARD_SUMMARY"
  | "PROFESSIONAL_REGULATORY_STANDARD"
  | "JUDICIAL_DECISION_SUMMARY";

export type TemporalVerificationStatus =
  | "IN_FORCE"
  | "BEFORE_EARLIEST_VERSION"
  | "AFTER_REPEAL"
  | "INVALID_CASE_DATE"
  | "NOT_CHECKED";

export type PropositionSupportStatus =
  | "SUPPORTED"
  | "IRRELEVANT_OR_MISAPPLIED"
  | "CONTRADICTED_BY_STATUTE"
  | "NOT_EVALUATED";

export interface VerifiedAuthorityEntry {
  /** Category-prefixed canonical authority ID, e.g. "CYFSA:88", "FLR:14(18)", "CHARTER:7" */
  authorityId: string;
  /** Alias for authorityId for convenience */
  id?: string;
  /** Alias for instrument/category */
  category?: AuthorityInstrument;
  /** Canonical citation, e.g. "CYFSA, s. 88" or "Family Law Rules, O. Reg. 114/99, Rule 14(18)" */
  citation: string;
  instrument: AuthorityInstrument;
  /** Official statutory or rule name */
  statuteTitle: string;
  /** Section or Rule number, e.g. "88", "74(2)", "14(18)" */
  sectionKey: string;
  /** Official statutory heading */
  heading: string;
  /** Verbatim text from bundled consolidation or authoritative text */
  exactWording: string;
  /** Official publisher URL (e-Laws, Justice Laws, or CanLII) */
  sourceUrl: string;
  /** Consolidation or in-force period description */
  consolidationPeriod: string;
  /** ISO date (YYYY-MM-DD) when this provision/version took effect */
  effectiveFrom: string;
  /** ISO date (YYYY-MM-DD) when repealed/superseded, or null if currently in force */
  effectiveTo: string | null;
  /** How the wording in this registry is verified */
  verificationSourceType: VerificationSourceType;
  /** Verified date by system */
  verifiedDate: string;
  /** Explanation of legal test / requirements */
  legalTestSummary: string;
  /** Practical guidance for counsel */
  practiceNote: string;
}

export interface ResolveLegalAuthorityOptions {
  /** Optional ISO date (YYYY-MM-DD) of the relevant event or proceeding step for temporal version matching */
  caseDate?: string | null;
  /** Optional legal proposition or claim for which the authority is cited */
  proposition?: string | null;
}

export interface AuthorityResolutionResult {
  status: CitationVerificationStatus;
  authorityId: string | null;
  authorityCategory: AuthorityCategory;
  category?: AuthorityCategory;
  entry: VerifiedAuthorityEntry | null;
  officialCitation: string;
  sourceUrl: string | null;
  exactWording: string | null;
  practiceNote: string | null;
  warningText: string | null;
  /** True when the cited provision exists in the statute, even if temporally inapplicable or misapplied to the proposition */
  sourceExists: boolean;
  temporalStatus: TemporalVerificationStatus;
  propositionSupport: PropositionSupportStatus;
  propositionReason: string | null;
  allSectionsCited?: string[];
}

const CYFSA_TITLE = "Child, Youth and Family Services Act, 2017, S.O. 2017, c. 14, Sched. 1";
const CYFSA_PERIOD = "Consolidation period: July 1, 2026 to Present (in force April 30, 2018)";
const BILL_C92_TITLE = "An Act respecting First Nations, Inuit and Métis children, youth and families, S.C. 2019, c. 24";
const FLR_TITLE = "Courts of Justice Act — Family Law Rules, O. Reg. 114/99";
const CHARTER_TITLE = "Constitution Act, 1982, Part I — Canadian Charter of Rights and Freedoms";

const CORE_AUTHORITIES: VerifiedAuthorityEntry[] = [
  {
    authorityId: "CYFSA:1(1)",
    citation: "CYFSA, s. 1(1)",
    instrument: "CYFSA",
    statuteTitle: CYFSA_TITLE,
    sectionKey: "1(1)",
    heading: "Paramount purpose",
    exactWording: "(1) The paramount purpose of this Act is to promote the best interests, protection and well-being of children.",
    sourceUrl: "https://www.ontario.ca/laws/statute/17c14#BK2",
    consolidationPeriod: CYFSA_PERIOD,
    effectiveFrom: "2018-04-30",
    effectiveTo: null,
    verificationSourceType: "BUNDLED_CONSOLIDATION_VERBATIM",
    verifiedDate: "2026-11-03",
    legalTestSummary: "Establishes that promoting the best interests, protection, and well-being of children is the paramount purpose of the CYFSA.",
    practiceNote: "All other statutory purposes under s. 1(2) operate subject to consistency with s. 1(1)."
  },
  {
    authorityId: "CYFSA:1(2)",
    citation: "CYFSA, s. 1(2)",
    instrument: "CYFSA",
    statuteTitle: CYFSA_TITLE,
    sectionKey: "1(2)",
    heading: "Other purposes",
    exactWording: "(2) The additional purposes of this Act, so long as they are consistent with the best interests, protection and well-being of children, are to recognize the following: 1. While parents may need help in caring for their children, that help should give support to the autonomy and integrity of the family unit and, wherever possible, be provided on the basis of mutual consent. 2. The least disruptive course of action that is available and is appropriate in a particular case to help a child, including the provision of prevention services, early intervention services and community support services, should be considered.",
    sourceUrl: "https://www.ontario.ca/laws/statute/17c14#BK2",
    consolidationPeriod: CYFSA_PERIOD,
    effectiveFrom: "2018-04-30",
    effectiveTo: null,
    verificationSourceType: "BUNDLED_CONSOLIDATION_VERBATIM",
    verifiedDate: "2026-11-03",
    legalTestSummary: "Sets out seven additional statutory purposes, including family autonomy, mutual consent, least disruptive course of action, continuity of care, and Indigenous service principles.",
    practiceNote: "Note that s. 1(2) uses numbered paragraphs (e.g. s. 1(2), para. 1 and para. 2), not lettered clauses."
  },
  {
    authorityId: "CYFSA:1(2), para. 1",
    citation: "CYFSA, s. 1(2), para. 1",
    instrument: "CYFSA",
    statuteTitle: CYFSA_TITLE,
    sectionKey: "1(2), para. 1",
    heading: "Other purposes — Support to family autonomy and mutual consent",
    exactWording: "1. While parents may need help in caring for their children, that help should give support to the autonomy and integrity of the family unit and, wherever possible, be provided on the basis of mutual consent.",
    sourceUrl: "https://www.ontario.ca/laws/statute/17c14#BK2",
    consolidationPeriod: CYFSA_PERIOD,
    effectiveFrom: "2018-04-30",
    effectiveTo: null,
    verificationSourceType: "BUNDLED_CONSOLIDATION_VERBATIM",
    verifiedDate: "2026-11-03",
    legalTestSummary: "Recognizes that assistance to parents should support the autonomy and integrity of the family unit and, wherever possible, be provided on the basis of mutual consent.",
    practiceNote: "Relevant when examining whether the Society offered collaborative support before seeking coercive orders."
  },
  {
    authorityId: "CYFSA:1(2), para. 2",
    citation: "CYFSA, s. 1(2), para. 2",
    instrument: "CYFSA",
    statuteTitle: CYFSA_TITLE,
    sectionKey: "1(2), para. 2",
    heading: "Other purposes — Least disruptive course of action",
    exactWording: "2. The least disruptive course of action that is available and is appropriate in a particular case to help a child, including the provision of prevention services, early intervention services and community support services, should be considered.",
    sourceUrl: "https://www.ontario.ca/laws/statute/17c14#BK2",
    consolidationPeriod: CYFSA_PERIOD,
    effectiveFrom: "2018-04-30",
    effectiveTo: null,
    verificationSourceType: "BUNDLED_CONSOLIDATION_VERBATIM",
    verifiedDate: "2026-11-03",
    legalTestSummary: "Recognizes that the least disruptive course of action available and appropriate, including prevention, early intervention, and community support services, should be considered.",
    practiceNote: "Read together with s. 101(2) and s. 101(3) on disposition, while noting the financial order limits in s. 94(6)(c) and s. 101(7)(c)."
  },
  {
    authorityId: "CYFSA:2(1)",
    citation: "CYFSA, s. 2(1)",
    instrument: "CYFSA",
    statuteTitle: CYFSA_TITLE,
    sectionKey: "2(1)",
    heading: "Interpretation — Definitions",
    exactWording: "(1) In this Act, “agency” means a corporation; (“agence”) “band” has the same meaning as in the Indian Act (Canada); (“bande”) “Board” means the Child and Family Services Review Board continued under section 333; (“Commission”) “child” means a person younger than 18; (“enfant”)",
    sourceUrl: "https://www.ontario.ca/laws/statute/17c14#BK3",
    consolidationPeriod: CYFSA_PERIOD,
    effectiveFrom: "2018-04-30",
    effectiveTo: null,
    verificationSourceType: "BUNDLED_CONSOLIDATION_VERBATIM",
    verifiedDate: "2026-11-03",
    legalTestSummary: "Defines core statutory terms including child, child in care, customary care, extended family, relative, residential care, service, service provider, and society.",
    practiceNote: "Also see s. 2(3) for members of a child's community and s. 2(4) for a child's bands and First Nations, Inuit or Métis communities."
  },
  {
    authorityId: "CYFSA:3",
    citation: "CYFSA, s. 3",
    instrument: "CYFSA",
    statuteTitle: CYFSA_TITLE,
    sectionKey: "3",
    heading: "Rights of children, young persons receiving services",
    exactWording: "Every child and young person receiving services under this Act has the following rights: 1. To express their own views freely and safely about matters that affect them. 2. To be engaged through an honest and respectful dialogue about how and why decisions affecting them are made and to have their views given due weight, in accordance with their age and maturity. 3. To be consulted on the nature of the services provided or to be provided to them, to participate in decisions about the services provided or to be provided to them and to be advised of the decisions made in respect of those services. 4. To raise concerns or recommend changes with respect to the services provided or to be provided to them without interference or fear of coercion, discrimination or reprisal and to receive a response to their concerns or recommended changes. 5. To be informed, in language suitable to their understanding, of their rights under this Part.",
    sourceUrl: "https://www.ontario.ca/laws/statute/17c14#BK5",
    consolidationPeriod: CYFSA_PERIOD,
    effectiveFrom: "2018-04-30",
    effectiveTo: null,
    verificationSourceType: "BUNDLED_CONSOLIDATION_VERBATIM",
    verifiedDate: "2026-11-03",
    legalTestSummary: "Guarantees every child and young person receiving services under the Act the right to express views freely and safely, be consulted, raise concerns without fear of reprisal, and be informed of their Part II rights.",
    practiceNote: "Paragraph 6 of s. 3 was repealed on May 1, 2019 (2018, c. 17, Sched. 34, s. 6(1)); Ombudsman notice rights for children in care were enacted in s. 9.1 effective July 1, 2024."
  },
  {
    authorityId: "CYFSA:9.1",
    citation: "CYFSA, s. 9.1",
    instrument: "CYFSA",
    statuteTitle: CYFSA_TITLE,
    sectionKey: "9.1",
    heading: "Right to be informed — Ombudsman",
    exactWording: "A child in care has a right to be informed in language suitable to their understanding, of the information described in subsection 14.0.1 (1) of the Ombudsman Act. 2024, c. 17, s. 2.",
    sourceUrl: "https://www.ontario.ca/laws/statute/17c14#BK12",
    consolidationPeriod: "In force July 1, 2024 to Present (S.O. 2024, c. 17, s. 2)",
    effectiveFrom: "2024-07-01",
    effectiveTo: null,
    verificationSourceType: "BUNDLED_CONSOLIDATION_VERBATIM",
    verifiedDate: "2026-11-03",
    legalTestSummary: "Requires that a child in care be informed in language suitable to their understanding of information regarding the Ontario Ombudsman under s. 14.0.1(1) of the Ombudsman Act.",
    practiceNote: "Enacted by Bill 188, Supporting Children's Futures Act, 2024 (S.O. 2024, c. 17, s. 2), effective July 1, 2024. Do not apply retroactively to events prior to July 1, 2024."
  },
  {
    authorityId: "CYFSA:13(1)",
    citation: "CYFSA, s. 13(1)",
    instrument: "CYFSA",
    statuteTitle: CYFSA_TITLE,
    sectionKey: "13(1)",
    heading: "Right to plan of care",
    exactWording: "(1) A child in care has a right to a plan of care designed to meet their particular needs, which shall be prepared within 30 days of the child’s or young person’s admission to the residential placement.",
    sourceUrl: "https://www.ontario.ca/laws/statute/17c14#BK16",
    consolidationPeriod: CYFSA_PERIOD,
    effectiveFrom: "2018-04-30",
    effectiveTo: null,
    verificationSourceType: "BUNDLED_CONSOLIDATION_VERBATIM",
    verifiedDate: "2026-11-03",
    legalTestSummary: "Gives a child in care a statutory right to an individualized plan of care prepared within 30 days of admission to a residential placement.",
    practiceNote: "Distinct from the Society's court-filed Plan of Care under s. 100."
  },
  {
    authorityId: "CYFSA:35(1)",
    citation: "CYFSA, s. 35(1)",
    instrument: "CYFSA",
    statuteTitle: CYFSA_TITLE,
    sectionKey: "35(1)",
    heading: "Functions of society",
    exactWording: "(1) The functions of a children’s aid society are to, (a) investigate allegations or evidence that children may be in need of protection; (b) protect children where necessary; (c) provide guidance, counselling and other services to families for protecting children or for the prevention of circumstances requiring the protection of children; (d) provide care for children assigned or committed to its care under this Act; (e) supervise children assigned to its supervision under this Act; (f) place children for adoption under Part VIII (Adoption and Adoption Licensing); and (g) perform any other duties given to it by this Act or the regulations or any other Act.",
    sourceUrl: "https://www.ontario.ca/laws/statute/17c14#BK44",
    consolidationPeriod: CYFSA_PERIOD,
    effectiveFrom: "2018-04-30",
    effectiveTo: null,
    verificationSourceType: "BUNDLED_CONSOLIDATION_VERBATIM",
    verifiedDate: "2026-11-03",
    legalTestSummary: "Enumerates the statutory functions of a children's aid society, including investigation, child protection, and providing guidance, counselling, and other services to families for child protection and prevention.",
    practiceNote: "While s. 35(1)(c) makes family guidance, counselling, and prevention services a core statutory function of a Society, note that under s. 94(6)(c) and s. 101(7)(c) a court supervision order cannot require the society to provide financial assistance or purchase goods or services."
  },
  {
    authorityId: "CYFSA:72",
    citation: "CYFSA, s. 72",
    instrument: "CYFSA",
    statuteTitle: CYFSA_TITLE,
    sectionKey: "72",
    heading: "Duty to consult bands and First Nations, Inuit or Métis communities",
    exactWording: "A society, person or entity that provides services or exercises powers under this Act with respect to First Nations, Inuit or Métis children or young persons shall regularly consult with their bands and First Nations, Inuit or Métis communities about the provision of the services or the exercise of the powers and about matters affecting the children or young persons, including, (a) bringing children to a place of safety and the placement of children in residential care; (b) the provision of family support services; (c) the preparation of plans for the care of children; (d) status reviews under Part V (Child Protection); (e) temporary care agreements under Part V (Child Protection); (f) society agreements with 16 and 17 year olds under Part V (Child Protection); (g) adoption placements; (h) the establishment of emergency houses; and (i) any other matter that is prescribed.",
    sourceUrl: "https://www.ontario.ca/laws/statute/17c14#BK90",
    consolidationPeriod: CYFSA_PERIOD,
    effectiveFrom: "2018-04-30",
    effectiveTo: null,
    verificationSourceType: "BUNDLED_CONSOLIDATION_VERBATIM",
    verifiedDate: "2026-11-03",
    legalTestSummary: "Mandates regular consultation with bands and First Nations, Inuit, or Métis communities regarding apprehensions, residential placements, family support services, plans of care, and status reviews.",
    practiceNote: "Applies alongside s. 73 and federal notice requirements under Bill C-92, s. 12(1)."
  },
  {
    authorityId: "CYFSA:74",
    citation: "CYFSA, s. 74",
    instrument: "CYFSA",
    statuteTitle: CYFSA_TITLE,
    sectionKey: "74",
    heading: "Child in need of protection — Definitions, grounds, and best interests",
    exactWording: "74 (1) In this Part, “child protection worker” means a Director, a local director or a person who meets the prescribed requirements and who is authorized by a Director or local director for the purposes of section 81... (2) A child is in need of protection where, (a) the child has suffered physical harm... (b) there is a risk that the child is likely to suffer physical harm... (f) the child has suffered emotional harm... (h) there is a risk that the child is likely to suffer emotional harm...",
    sourceUrl: "https://www.ontario.ca/laws/statute/17c14#BK94",
    consolidationPeriod: CYFSA_PERIOD,
    effectiveFrom: "2018-04-30",
    effectiveTo: null,
    verificationSourceType: "BUNDLED_CONSOLIDATION_VERBATIM",
    verifiedDate: "2026-11-03",
    legalTestSummary: "Sets out Part V definitions (s. 74(1)), the exhaustive statutory grounds for finding a child in need of protection (s. 74(2)(a)-(o)), and the best-interests test (s. 74(3)).",
    practiceNote: "Prefer citing the specific subsection (s. 74(1), s. 74(2), or s. 74(3)) rather than bare s. 74."
  },
  {
    authorityId: "CYFSA:74(1)",
    citation: "CYFSA, s. 74(1)",
    instrument: "CYFSA",
    statuteTitle: CYFSA_TITLE,
    sectionKey: "74(1)",
    heading: "Interpretation — Definitions for Child Protection",
    exactWording: "74 (1) In this Part, “child protection worker” means a Director, a local director or a person who meets the prescribed requirements and who is authorized by a Director or local director for the purposes of section 81 (commencing child protection proceedings) and for other prescribed purposes...",
    sourceUrl: "https://www.ontario.ca/laws/statute/17c14#BK94",
    consolidationPeriod: CYFSA_PERIOD,
    effectiveFrom: "2018-04-30",
    effectiveTo: null,
    verificationSourceType: "BUNDLED_CONSOLIDATION_VERBATIM",
    verifiedDate: "2026-11-03",
    legalTestSummary: "Defines child protection worker, parent (paragraphs 1 to 8), and place of safety for Part V.",
    practiceNote: "Check whether the worker named in court records is an authorized child protection worker and whether all statutory parents under s. 74(1) received notice."
  },
  {
    authorityId: "CYFSA:74(2)",
    citation: "CYFSA, s. 74(2)",
    instrument: "CYFSA",
    statuteTitle: CYFSA_TITLE,
    sectionKey: "74(2)",
    heading: "Child in need of protection — Specific grounds",
    exactWording: "74 (2) A child is in need of protection where, (a) the child has suffered physical harm, inflicted by the person having charge of the child or caused by or resulting from that person’s, (i) failure to adequately care for, provide for, supervise or protect the child, or (ii) pattern of neglect in caring for, providing for, supervising or protecting the child; (b) there is a risk that the child is likely to suffer physical harm... (c) the child has been sexually abused or sexually exploited... (d) risk of sexual abuse or exploitation... (d.1) child sex trafficking... (d.2) risk of child sex trafficking... (e) medical treatment required... (f) emotional harm demonstrated by serious anxiety, depression, withdrawal, self-destructive or aggressive behaviour, or delayed development... (g)-(i) emotional harm treatment/risk... (j) mental, emotional or developmental condition... (k) parent died or unavailable... (l)-(m) child younger than 12... (n) parent unable to care with consent... (o) child 16 or 17 prescribed circumstance.",
    sourceUrl: "https://www.ontario.ca/laws/statute/17c14#BK94",
    consolidationPeriod: CYFSA_PERIOD,
    effectiveFrom: "2018-04-30",
    effectiveTo: null,
    verificationSourceType: "BUNDLED_CONSOLIDATION_VERBATIM",
    verifiedDate: "2026-11-03",
    legalTestSummary: "Exhaustive statutory list of protection grounds in clauses (a) to (o). Each ground requires credible, objective evidence meeting the statutory wording on a balance of probabilities.",
    practiceNote: "Note that clauses (d.1) and (d.2) (child sex trafficking) came into force on October 1, 2021 (S.O. 2021, c. 21, Sched. 3, s. 1(2))."
  },
  {
    authorityId: "CYFSA:74(3)",
    citation: "CYFSA, s. 74(3)",
    instrument: "CYFSA",
    statuteTitle: CYFSA_TITLE,
    sectionKey: "74(3)",
    heading: "Best interests of child",
    exactWording: "(3) Where a person is directed in this Part to make an order or determination in the best interests of a child, the person shall, (a) consider the child’s views and wishes, given due weight in accordance with the child’s age and maturity, unless they cannot be ascertained; (b) in the case of a First Nations, Inuk or Métis child, consider the importance, in recognition of the uniqueness of First Nations, Inuit and Métis cultures, heritages and traditions, of preserving the child’s cultural identity and connection to community, in addition to the considerations under clauses (a) and (c); and (c) consider any other circumstance of the case that the person considers relevant, including subclauses (i) to (xi).",
    sourceUrl: "https://www.ontario.ca/laws/statute/17c14#BK94",
    consolidationPeriod: CYFSA_PERIOD,
    effectiveFrom: "2018-04-30",
    effectiveTo: null,
    verificationSourceType: "BUNDLED_CONSOLIDATION_VERBATIM",
    verifiedDate: "2026-11-03",
    legalTestSummary: "Mandates consideration of the child's views and wishes, Indigenous cultural identity and community connection, and eleven enumerated best-interests factors including continuity of care and the merits of competing care plans.",
    practiceNote: "Under subclause (c)(x), the court must weigh the risk of harm from removing or keeping the child away from a parent against the risk of remaining with or returning to the parent."
  },
  {
    authorityId: "CYFSA:78",
    citation: "CYFSA, s. 78",
    instrument: "CYFSA",
    statuteTitle: CYFSA_TITLE,
    sectionKey: "78",
    heading: "Legal representation of child",
    exactWording: "78 (1) A child may have legal representation at any stage in a proceeding under this Part.",
    sourceUrl: "https://www.ontario.ca/laws/statute/17c14#BK99",
    consolidationPeriod: CYFSA_PERIOD,
    effectiveFrom: "2018-04-30",
    effectiveTo: null,
    verificationSourceType: "BUNDLED_CONSOLIDATION_VERBATIM",
    verifiedDate: "2026-11-03",
    legalTestSummary: "Governs legal representation of a child at any stage of a Part V child protection proceeding.",
    practiceNote: "Section 78 (not s. 41) governs legal representation of a child in Part V proceedings."
  },
  {
    authorityId: "CYFSA:78(1)",
    citation: "CYFSA, s. 78(1)",
    instrument: "CYFSA",
    statuteTitle: CYFSA_TITLE,
    sectionKey: "78(1)",
    heading: "Legal representation of child",
    exactWording: "(1) A child may have legal representation at any stage in a proceeding under this Part.",
    sourceUrl: "https://www.ontario.ca/laws/statute/17c14#BK99",
    consolidationPeriod: CYFSA_PERIOD,
    effectiveFrom: "2018-04-30",
    effectiveTo: null,
    verificationSourceType: "BUNDLED_CONSOLIDATION_VERBATIM",
    verifiedDate: "2026-11-03",
    legalTestSummary: "Provides that a child may have legal representation at any stage in a Part V proceeding.",
    practiceNote: "The court must consider as soon as practicable after commencement whether legal representation is desirable to protect the child's interests (s. 78(2))."
  },
  {
    authorityId: "CYFSA:78(4)",
    citation: "CYFSA, s. 78(4)",
    instrument: "CYFSA",
    statuteTitle: CYFSA_TITLE,
    sectionKey: "78(4)",
    heading: "Legal representation of child — Criteria",
    exactWording: "(4) Where, (a) the court is of the opinion that there is a difference of views between the child and a parent or a society, and the society proposes that the child be removed from a person’s care or be placed in interim or extended society care under paragraph 2 or 3 of subsection 101 (1); (b) the child is in the society’s care and, (i) no parent appears before the court, or (ii) it is alleged that the child is in need of protection within the meaning of clause 74 (2) (a), (c), (f), (g) or (j); or (c) the child is not permitted to be present at the hearing, legal representation is deemed to be desirable to protect the child’s interests, unless the court is satisfied, taking into account the child’s views and wishes, given due weight in accordance with the child’s age and maturity, that the child’s interests are otherwise adequately protected.",
    sourceUrl: "https://www.ontario.ca/laws/statute/17c14#BK99",
    consolidationPeriod: CYFSA_PERIOD,
    effectiveFrom: "2018-04-30",
    effectiveTo: null,
    verificationSourceType: "BUNDLED_CONSOLIDATION_VERBATIM",
    verifiedDate: "2026-11-03",
    legalTestSummary: "Creates a statutory presumption that legal representation is desirable for the child in specified circumstances, subject to the court's satisfaction that the child's interests are otherwise adequately protected.",
    practiceNote: "Always include the statutory qualifier regarding the child's views and wishes and whether the child's interests are otherwise adequately protected."
  },
  {
    authorityId: "CYFSA:81",
    citation: "CYFSA, s. 81",
    instrument: "CYFSA",
    statuteTitle: CYFSA_TITLE,
    sectionKey: "81",
    heading: "Commencing child protection proceedings / Warrants",
    exactWording: "81 (1) A society may apply to the court to determine whether a child is in need of protection. (2) A justice of the peace may issue a warrant authorizing a child protection worker to bring a child to a place of safety... (7) A child protection worker who believes on reasonable and probable grounds that (a) a child is in need of protection; (b) the child is younger than 16; and (c) there would be a substantial risk to the child's health or safety during the time necessary to bring the matter on for a hearing under subsection 90 (1) or obtain a warrant under subsection (2), may without a warrant bring the child to a place of safety.",
    sourceUrl: "https://www.ontario.ca/laws/statute/17c14#BK103",
    consolidationPeriod: CYFSA_PERIOD,
    effectiveFrom: "2018-04-30",
    effectiveTo: null,
    verificationSourceType: "BUNDLED_CONSOLIDATION_VERBATIM",
    verifiedDate: "2026-11-03",
    legalTestSummary: "Governs commencement of child protection proceedings by application (s. 81(1)), warrants to bring a child to a place of safety (s. 81(2)), and emergency warrantless apprehension (s. 81(7)).",
    practiceNote: "Distinguish s. 81(1) (application authority) from s. 81(2) (warrant) and s. 81(7) (warrantless apprehension)."
  },
  {
    authorityId: "CYFSA:81(1)",
    citation: "CYFSA, s. 81(1)",
    instrument: "CYFSA",
    statuteTitle: CYFSA_TITLE,
    sectionKey: "81(1)",
    heading: "Application to court for child protection determination",
    exactWording: "81 (1) A society may apply to the court to determine whether a child is in need of protection.",
    sourceUrl: "https://www.ontario.ca/laws/statute/17c14#BK103",
    consolidationPeriod: CYFSA_PERIOD,
    effectiveFrom: "2018-04-30",
    effectiveTo: null,
    verificationSourceType: "BUNDLED_CONSOLIDATION_VERBATIM",
    verifiedDate: "2026-11-03",
    legalTestSummary: "Authorizes a society to initiate a protection proceeding by application to the court.",
    practiceNote: "Section 81(1) is procedural application authority, NOT an imminent-danger or warrantless removal provision (which is s. 81(7))."
  },
  {
    authorityId: "CYFSA:81(2)",
    citation: "CYFSA, s. 81(2)",
    instrument: "CYFSA",
    statuteTitle: CYFSA_TITLE,
    sectionKey: "81(2)",
    heading: "Warrant to bring child to place of safety",
    exactWording: "(2) A justice of the peace may issue a warrant authorizing a child protection worker to bring a child to a place of safety if the justice of the peace is satisfied on the basis of a child protection worker’s sworn information that there are reasonable and probable grounds to believe that, (a) the child is younger than 16; (b) the child is in need of protection; and (c) a less restrictive course of action is not available or will not protect the child adequately.",
    sourceUrl: "https://www.ontario.ca/laws/statute/17c14#BK103",
    consolidationPeriod: CYFSA_PERIOD,
    effectiveFrom: "2018-04-30",
    effectiveTo: null,
    verificationSourceType: "BUNDLED_CONSOLIDATION_VERBATIM",
    verifiedDate: "2026-11-03",
    legalTestSummary: "Requires sworn information establishing reasonable and probable grounds that the child is under 16, in need of protection, and that a less restrictive course of action will not protect the child adequately.",
    practiceNote: "Request disclosure of the sworn Information to Obtain (ITO) whenever a child is removed under a s. 81(2) warrant."
  },
  {
    authorityId: "CYFSA:81(7)",
    citation: "CYFSA, s. 81(7)",
    instrument: "CYFSA",
    statuteTitle: CYFSA_TITLE,
    sectionKey: "81(7)",
    heading: "Warrantless apprehension to place of safety",
    exactWording: "(7) A child protection worker who believes on reasonable and probable grounds that, (a) a child is in need of protection; (b) the child is younger than 16; and (c) there would be a substantial risk to the child’s health or safety during the time necessary to bring the matter on for a hearing under subsection 90 (1) or obtain a warrant under subsection (2), may without a warrant bring the child to a place of safety.",
    sourceUrl: "https://www.ontario.ca/laws/statute/17c14#BK103",
    consolidationPeriod: CYFSA_PERIOD,
    effectiveFrom: "2018-04-30",
    effectiveTo: null,
    verificationSourceType: "BUNDLED_CONSOLIDATION_VERBATIM",
    verifiedDate: "2026-11-03",
    legalTestSummary: "Stringent three-part test for emergency removal without a warrant: (1) reasonable and probable grounds of protection need, (2) child younger than 16, and (3) substantial risk during the time necessary for a s. 90(1) hearing or s. 81(2) warrant.",
    practiceNote: "A child protection worker cannot bypass the warrant requirement without objective grounds showing substantial risk during the time needed to seek a warrant or hearing."
  },
  {
    authorityId: "CYFSA:81(12)",
    citation: "CYFSA, s. 81(12)",
    instrument: "CYFSA",
    statuteTitle: CYFSA_TITLE,
    sectionKey: "81(12)",
    heading: "Peace officer has powers of child protection worker",
    exactWording: "(12) Subsections (2), (6), (7), (10) and (11) apply to a peace officer as if the peace officer were a child protection worker.",
    sourceUrl: "https://www.ontario.ca/laws/statute/17c14#BK103",
    consolidationPeriod: CYFSA_PERIOD,
    effectiveFrom: "2018-04-30",
    effectiveTo: null,
    verificationSourceType: "BUNDLED_CONSOLIDATION_VERBATIM",
    verifiedDate: "2026-11-03",
    legalTestSummary: "Applies subsections 81(2), (6), (7), (10), and (11) to a peace officer as if the peace officer were a child protection worker.",
    practiceNote: "Do not confuse s. 81(12) with s. 81(13) (protection from personal liability) or s. 136(5) (unaccompanied child under 16 in a public place between midnight and 6 a.m.)."
  },
  {
    authorityId: "CYFSA:81(13)",
    citation: "CYFSA, s. 81(13)",
    instrument: "CYFSA",
    statuteTitle: CYFSA_TITLE,
    sectionKey: "81(13)",
    heading: "Protection from personal liability",
    exactWording: "(13) No action shall be instituted against a peace officer or child protection worker for any act done in good faith in the execution or intended execution of that person’s duty under this section or for an alleged neglect or default in the execution in good faith of that duty.",
    sourceUrl: "https://www.ontario.ca/laws/statute/17c14#BK103",
    consolidationPeriod: CYFSA_PERIOD,
    effectiveFrom: "2018-04-30",
    effectiveTo: null,
    verificationSourceType: "BUNDLED_CONSOLIDATION_VERBATIM",
    verifiedDate: "2026-11-03",
    legalTestSummary: "Protects peace officers and child protection workers from personal liability for acts or alleged neglect or default in the execution in good faith of duties under s. 81.",
    practiceNote: "Applies only to acts or alleged neglect/default in good faith."
  },
  {
    authorityId: "CYFSA:88",
    citation: "CYFSA, s. 88",
    instrument: "CYFSA",
    statuteTitle: CYFSA_TITLE,
    sectionKey: "88",
    heading: "Time in place of safety limited — 5-Day Hearing Requirement",
    exactWording: "88 As soon as practicable, but in any event within five days after a child is brought to a place of safety under section 81, subclause 83 (1) (a) (ii) or subsection 136 (5), (a) the matter shall be brought before a court for a hearing under subsection 90 (1) (child protection hearing); (b) the child shall be returned to the person who last had charge of the child or, where there is an order for the child’s custody that is enforceable in Ontario, to the person entitled to custody under the order; (c) if the child is the subject of an extra-provincial child protection order, the child shall be returned to the child welfare authority or other person named in the order; (d) a temporary care agreement shall be made under subsection 75 (1); or (e) an agreement shall be made under section 77 (agreements with 16 and 17 year olds).",
    sourceUrl: "https://www.ontario.ca/laws/statute/17c14#BK111",
    consolidationPeriod: CYFSA_PERIOD,
    effectiveFrom: "2018-04-30",
    effectiveTo: null,
    verificationSourceType: "BUNDLED_CONSOLIDATION_VERBATIM",
    verifiedDate: "2026-11-03",
    legalTestSummary: "The mandatory 5-day post-apprehension rule. Within five days after a child is brought to a place of safety, the matter must be brought before a court for a s. 90(1) hearing, the child returned, or a valid agreement made.",
    practiceNote: "Section 88 has no numbered subsections (only clauses (a) to (e)). It is the sole statutory source of the 5-day post-apprehension hearing rule; s. 94 governs adjournments."
  },
  {
    authorityId: "CYFSA:90(1)",
    citation: "CYFSA, s. 90(1)",
    instrument: "CYFSA",
    statuteTitle: CYFSA_TITLE,
    sectionKey: "90(1)",
    heading: "Child protection hearing",
    exactWording: "90 (1) Where an application is made under subsection 81 (1) or a matter is brought before the court to determine whether the child is in need of protection, the court shall hold a hearing to determine the issue and make an order under section 101.",
    sourceUrl: "https://www.ontario.ca/laws/statute/17c14#BK113",
    consolidationPeriod: CYFSA_PERIOD,
    effectiveFrom: "2018-04-30",
    effectiveTo: null,
    verificationSourceType: "BUNDLED_CONSOLIDATION_VERBATIM",
    verifiedDate: "2026-11-03",
    legalTestSummary: "Requires the court to hold a hearing to determine whether the child is in need of protection and make an order under s. 101.",
    practiceNote: "Before determining whether the child is in need of protection, the court must also make the mandatory determinations in s. 90(2), including whether the child is a First Nations, Inuk, or Métis child."
  },
  {
    authorityId: "CYFSA:94(1)",
    citation: "CYFSA, s. 94(1)",
    instrument: "CYFSA",
    statuteTitle: CYFSA_TITLE,
    sectionKey: "94(1)",
    heading: "Adjournment limit — 30-day maximum",
    exactWording: "94 (1) The court shall not adjourn a hearing for more than 30 days, (a) unless all the parties present and the person who will be caring for the child during the adjournment consent; or (b) if the court is aware that a party who is not present at the hearing objects to the longer adjournment.",
    sourceUrl: "https://www.ontario.ca/laws/statute/17c14#BK117",
    consolidationPeriod: CYFSA_PERIOD,
    effectiveFrom: "2018-04-30",
    effectiveTo: null,
    verificationSourceType: "BUNDLED_CONSOLIDATION_VERBATIM",
    verifiedDate: "2026-11-03",
    legalTestSummary: "Prohibits court adjournments exceeding 30 days unless all parties present and the caregiver during the adjournment consent, and no absent party is known to object.",
    practiceNote: "Distinct from s. 88 (the 5-day post-apprehension hearing rule)."
  },
  {
    authorityId: "CYFSA:94(2)",
    citation: "CYFSA, s. 94(2)",
    instrument: "CYFSA",
    statuteTitle: CYFSA_TITLE,
    sectionKey: "94(2)",
    heading: "Temporary care and custody order during adjournment",
    exactWording: "94 (2) Where a hearing is adjourned, the court shall make a temporary order for care and custody providing that the child, (a) remain in or be returned to the care and custody of the person who had charge of the child immediately before intervention under this Part; (b) remain in or be returned to the care and custody of the person referred to in clause (a), subject to the society’s supervision and on such reasonable terms and conditions as the court considers appropriate; (c) be placed in the care and custody of a person other than the person referred to in clause (a), with the consent of that other person, subject to the society’s supervision and on such reasonable terms and conditions as the court considers appropriate; or (d) remain or be placed in the care and custody of the society, but not be placed in a place of temporary detention, of open or of secure custody.",
    sourceUrl: "https://www.ontario.ca/laws/statute/17c14#BK117",
    consolidationPeriod: CYFSA_PERIOD,
    effectiveFrom: "2018-04-30",
    effectiveTo: null,
    verificationSourceType: "BUNDLED_CONSOLIDATION_VERBATIM",
    verifiedDate: "2026-11-03",
    legalTestSummary: "Mandates that upon adjournment the court make one of four progressive temporary care and custody orders, subject to the strict threshold in s. 94(4).",
    practiceNote: "Under s. 94(4), the court cannot make a temporary removal order under clause (c) or (d) unless satisfied that the child cannot be protected adequately under clause (a) or (b)."
  },
  {
    authorityId: "CYFSA:94(4)",
    citation: "CYFSA, s. 94(4)",
    instrument: "CYFSA",
    statuteTitle: CYFSA_TITLE,
    sectionKey: "94(4)",
    heading: "Criteria for temporary removal during adjournment",
    exactWording: "(4) The court shall not make an order under clause (2) (c) or (d) unless the court is satisfied that there are reasonable grounds to believe that there is a risk that the child is likely to suffer harm and that the child cannot be protected adequately by an order under clause (2) (a) or (b).",
    sourceUrl: "https://www.ontario.ca/laws/statute/17c14#BK117",
    consolidationPeriod: CYFSA_PERIOD,
    effectiveFrom: "2018-04-30",
    effectiveTo: null,
    verificationSourceType: "BUNDLED_CONSOLIDATION_VERBATIM",
    verifiedDate: "2026-11-03",
    legalTestSummary: "Establishes the two-part statutory test for temporary removal at a temporary care and custody hearing: (1) reasonable grounds to believe there is a risk the child is likely to suffer harm, AND (2) the child cannot be protected adequately with the parent under clause (2)(a) or (b).",
    practiceNote: "The burden rests on the Society to prove both branches on credible and trustworthy evidence (s. 94(10))."
  },
  {
    authorityId: "CYFSA:94(6)",
    citation: "CYFSA, s. 94(6)",
    instrument: "CYFSA",
    statuteTitle: CYFSA_TITLE,
    sectionKey: "94(6)",
    heading: "Terms and conditions in temporary supervision order",
    exactWording: "(6) A temporary order for care and custody of a child under clause (2) (b) or (c) may impose, (a) reasonable terms and conditions relating to the child’s care and supervision; (b) reasonable terms and conditions on the child’s parent, the person who will have care and custody of the child under the order, the child and any other person, other than a foster parent, who is putting forward a plan or who would participate in a plan for care and custody of or access to the child; and (c) reasonable terms and conditions on the society that will supervise the placement, but shall not require the society to provide financial assistance or to purchase any goods or services.",
    sourceUrl: "https://www.ontario.ca/laws/statute/17c14#BK117",
    consolidationPeriod: CYFSA_PERIOD,
    effectiveFrom: "2018-04-30",
    effectiveTo: null,
    verificationSourceType: "BUNDLED_CONSOLIDATION_VERBATIM",
    verifiedDate: "2026-11-03",
    legalTestSummary: "Permits reasonable terms and conditions on temporary supervision orders, while expressly prohibiting terms that require the society to provide financial assistance or purchase goods or services (s. 94(6)(c)).",
    practiceNote: "Do not assert that a court can compel CAS under s. 94(6) to fund or purchase goods or services."
  },
  {
    authorityId: "CYFSA:100",
    citation: "CYFSA, s. 100",
    instrument: "CYFSA",
    statuteTitle: CYFSA_TITLE,
    sectionKey: "100",
    heading: "Society's plan for child",
    exactWording: "100 The court shall, before making an order under section 101, 102, 114 or 116, obtain and consider a plan for the child’s care prepared in writing by the society and including, (a) a description of the services to be provided to remedy the condition or situation on the basis of which the child was found to be in need of protection; (b) a statement of the criteria by which the society will determine when its care or supervision is no longer required; (c) an estimate of the time required to achieve the purpose of the society’s intervention; (d) where the society proposes to remove or has removed the child from a person’s care, (i) an explanation of why the child cannot be adequately protected while in the person’s care, and a description of any past efforts to do so, and (ii) a statement of what efforts, if any, are planned to maintain the child’s contact with the person; (e) where the society proposes to remove or has removed the child from a person’s care permanently, a description of the arrangements made or being made for the child’s long-term stable placement; and (f) a description of the arrangements made or being made to recognize the importance of the child’s culture and to preserve the child’s heritage, traditions and cultural identity.",
    sourceUrl: "https://www.ontario.ca/laws/statute/17c14#BK123",
    consolidationPeriod: CYFSA_PERIOD,
    effectiveFrom: "2018-04-30",
    effectiveTo: null,
    verificationSourceType: "BUNDLED_CONSOLIDATION_VERBATIM",
    verifiedDate: "2026-11-03",
    legalTestSummary: "Mandates that before making a disposition or status review order, the court must obtain and consider a written Society Plan of Care addressing all elements in clauses (a) to (f), including remedial services, exit criteria, and past efforts to protect the child in the parent's care.",
    practiceNote: "Section 100 (not s. 51) governs the Society's Plan of Care in child protection proceedings."
  },
  {
    authorityId: "CYFSA:101(1)",
    citation: "CYFSA, s. 101(1)",
    instrument: "CYFSA",
    statuteTitle: CYFSA_TITLE,
    sectionKey: "101(1)",
    heading: "Order where child in need of protection",
    exactWording: "(1) Where the court finds that a child is in need of protection and is satisfied that intervention through a court order is necessary to protect the child in the future, the court shall make one of the following orders or an order under section 102, in the child’s best interests:",
    sourceUrl: "https://www.ontario.ca/laws/statute/17c14#BK124",
    consolidationPeriod: CYFSA_PERIOD,
    effectiveFrom: "2018-04-30",
    effectiveTo: null,
    verificationSourceType: "BUNDLED_CONSOLIDATION_VERBATIM",
    verifiedDate: "2026-11-03",
    legalTestSummary: "Requires both a finding that the child is in need of protection AND satisfaction that a court order is necessary to protect the child in the future before making a disposition order under paragraphs 1 to 4.",
    practiceNote: "If the court finds protection need but is not satisfied a court order is necessary to protect the child in the future, s. 101(8) requires returning the child."
  },
  {
    authorityId: "CYFSA:101(1), para. 1",
    citation: "CYFSA, s. 101(1), para. 1",
    instrument: "CYFSA",
    statuteTitle: CYFSA_TITLE,
    sectionKey: "101(1), para. 1",
    heading: "Supervision order",
    exactWording: "1. That the child be placed in the care and custody of a parent or another person, subject to the supervision of the society, for a specified period of at least three months and not more than 12 months.",
    sourceUrl: "https://www.ontario.ca/laws/statute/17c14#BK124",
    consolidationPeriod: CYFSA_PERIOD,
    effectiveFrom: "2018-04-30",
    effectiveTo: null,
    verificationSourceType: "BUNDLED_CONSOLIDATION_VERBATIM",
    verifiedDate: "2026-11-03",
    legalTestSummary: "Provides for a supervision order placing the child in the care and custody of a parent or another person subject to society supervision for 3 to 12 months.",
    practiceNote: "Supervision orders are made under s. 101(1), para. 1 (not s. 102, which governs custody orders)."
  },
  {
    authorityId: "CYFSA:101(2)",
    citation: "CYFSA, s. 101(2)",
    instrument: "CYFSA",
    statuteTitle: CYFSA_TITLE,
    sectionKey: "101(2)",
    heading: "Court to inquire into pre-intervention assistance efforts",
    exactWording: "(2) In determining which order to make under subsection (1) or section 102, the court shall ask the parties what efforts the society or another person or entity has made to assist the child before intervention under this Part.",
    sourceUrl: "https://www.ontario.ca/laws/statute/17c14#BK124",
    consolidationPeriod: CYFSA_PERIOD,
    effectiveFrom: "2018-04-30",
    effectiveTo: null,
    verificationSourceType: "BUNDLED_CONSOLIDATION_VERBATIM",
    verifiedDate: "2026-11-03",
    legalTestSummary: "Imposes a mandatory judicial duty to ask the parties what efforts the society or another person or entity made to assist the child before Part V intervention.",
    practiceNote: "Directly supports questioning whether the Society made pre-intervention assistance referrals or offered community services before seeking removal."
  },
  {
    authorityId: "CYFSA:101(3)",
    citation: "CYFSA, s. 101(3)",
    instrument: "CYFSA",
    statuteTitle: CYFSA_TITLE,
    sectionKey: "101(3)",
    heading: "Less disruptive alternatives preferred",
    exactWording: "(3) The court shall not make an order removing the child from the care of the person who had charge of the child immediately before intervention under this Part unless the court is satisfied that alternatives that are less disruptive to the child, including non-residential care and the assistance referred to in subsection (2), would be inadequate to protect the child.",
    sourceUrl: "https://www.ontario.ca/laws/statute/17c14#BK124",
    consolidationPeriod: CYFSA_PERIOD,
    effectiveFrom: "2018-04-30",
    effectiveTo: null,
    verificationSourceType: "BUNDLED_CONSOLIDATION_VERBATIM",
    verifiedDate: "2026-11-03",
    legalTestSummary: "Prohibits a court order removing a child unless the court is satisfied that less disruptive alternatives, including non-residential care and the assistance referred to in s. 101(2), would be inadequate to protect the child.",
    practiceNote: "Note the exact statutory standard: 'would be inadequate to protect the child' (not that every alternative must first have been tried and failed)."
  },
  {
    authorityId: "CYFSA:101(4)",
    citation: "CYFSA, s. 101(4)",
    instrument: "CYFSA",
    statuteTitle: CYFSA_TITLE,
    sectionKey: "101(4)",
    heading: "Community placement to be considered",
    exactWording: "(4) Where the court decides that it is necessary to remove the child from the care of the person who had charge of the child immediately before intervention under this Part, the court shall, before making an order under paragraph 2 or 3 of subsection (1), consider whether it is possible to place the child with a relative, neighbour or other member of the child’s community or extended family under paragraph 1 of subsection (1) with the consent of the relative or other person.",
    sourceUrl: "https://www.ontario.ca/laws/statute/17c14#BK124",
    consolidationPeriod: CYFSA_PERIOD,
    effectiveFrom: "2018-04-30",
    effectiveTo: null,
    verificationSourceType: "BUNDLED_CONSOLIDATION_VERBATIM",
    verifiedDate: "2026-11-03",
    legalTestSummary: "Requires the court to consider placement with a consenting relative, neighbour, or member of the child's community or extended family under a supervision order before ordering interim or extended society care.",
    practiceNote: "Applies to all children on disposition; s. 101(5) adds specific mandatory placement priorities for First Nations, Inuk, or Métis children."
  },
  {
    authorityId: "CYFSA:101(5)",
    citation: "CYFSA, s. 101(5)",
    instrument: "CYFSA",
    statuteTitle: CYFSA_TITLE,
    sectionKey: "101(5)",
    heading: "First Nations, Inuk or Métis child placement priority",
    exactWording: "(5) Where the child referred to in subsection (4) is a First Nations, Inuk or Métis child, unless there is a substantial reason for placing the child elsewhere, the court shall place the child with a member of the child’s extended family if it is possible or, if it is not possible, (a) in the case of a First Nations child, another First Nations family; (b) in the case of an Inuk child, another Inuit family; or (c) in the case of a Métis child, another Métis family.",
    sourceUrl: "https://www.ontario.ca/laws/statute/17c14#BK124",
    consolidationPeriod: CYFSA_PERIOD,
    effectiveFrom: "2018-04-30",
    effectiveTo: null,
    verificationSourceType: "BUNDLED_CONSOLIDATION_VERBATIM",
    verifiedDate: "2026-11-03",
    legalTestSummary: "Mandates placing a First Nations, Inuk, or Métis child with extended family or an Indigenous family unless there is a substantial reason for placing the child elsewhere.",
    practiceNote: "Read together with Bill C-92, s. 16(1) placement priority hierarchy."
  },
  {
    authorityId: "CYFSA:101(7)",
    citation: "CYFSA, s. 101(7)",
    instrument: "CYFSA",
    statuteTitle: CYFSA_TITLE,
    sectionKey: "101(7)",
    heading: "Terms and conditions of supervision order",
    exactWording: "(7) If the court makes a supervision order under paragraph 1 of subsection (1), the court may impose, (a) reasonable terms and conditions relating to the child’s care and supervision; (b) reasonable terms and conditions on, (i) the child’s parent, (ii) the person who will have care and custody of the child under the order, (iii) the child, and (iv) any other person, other than a foster parent, who is putting forward or would participate in a plan for the care and custody of or access to the child; and (c) reasonable terms and conditions on the society that will supervise the placement, but shall not require the society to provide financial assistance or purchase any goods or services.",
    sourceUrl: "https://www.ontario.ca/laws/statute/17c14#BK124",
    consolidationPeriod: CYFSA_PERIOD,
    effectiveFrom: "2018-04-30",
    effectiveTo: null,
    verificationSourceType: "BUNDLED_CONSOLIDATION_VERBATIM",
    verifiedDate: "2026-11-03",
    legalTestSummary: "Permits reasonable supervision terms on the parent, caregiver, child, and society, while clause (c) expressly prohibits requiring the society to provide financial assistance or purchase any goods or services.",
    practiceNote: "Critical statutory boundary: while the court can impose reasonable supervision terms on the Society, it cannot order the Society to fund or purchase goods or services under s. 101(7)(c)."
  },
  {
    authorityId: "CYFSA:102(1)",
    citation: "CYFSA, s. 102(1)",
    instrument: "CYFSA",
    statuteTitle: CYFSA_TITLE,
    sectionKey: "102(1)",
    heading: "Custody order",
    exactWording: "(1) Subject to subsection (6), if a court finds that an order under this section instead of an order under subsection 101 (1) would be in a child’s best interests, the court may make an order granting custody of the child to one or more persons, other than a foster parent of the child, with the consent of the person or persons. 2017, c. 14, Sched. 1, s. 102 (1).",
    sourceUrl: "https://www.ontario.ca/laws/statute/17c14#BK125",
    consolidationPeriod: CYFSA_PERIOD,
    effectiveFrom: "2018-04-30",
    effectiveTo: null,
    verificationSourceType: "BUNDLED_CONSOLIDATION_VERBATIM",
    verifiedDate: "2026-11-03",
    legalTestSummary: "Authorizes a custody order in favour of one or more consenting persons (other than a foster parent) instead of an order under s. 101(1), deemed to be a parenting/contact order under CLRA s. 28.",
    practiceNote: "Section 102 has only subsections (1) through (7); it is a custody order, not a supervision order."
  },
  {
    authorityId: "CYFSA:104(1)",
    citation: "CYFSA, s. 104(1)",
    instrument: "CYFSA",
    statuteTitle: CYFSA_TITLE,
    sectionKey: "104(1)",
    heading: "Access order",
    exactWording: "(1) The court may, in the child’s best interests, (a) when making an order under this Part; or (b) upon an application under subsection (2), make, vary or terminate an order respecting a person’s access to the child or the child’s access to a person, and may impose such terms and conditions on the order as the court considers appropriate.",
    sourceUrl: "https://www.ontario.ca/laws/statute/17c14#BK127",
    consolidationPeriod: CYFSA_PERIOD,
    effectiveFrom: "2018-04-30",
    effectiveTo: null,
    verificationSourceType: "BUNDLED_CONSOLIDATION_VERBATIM",
    verifiedDate: "2026-11-03",
    legalTestSummary: "Authorizes the court to make, vary, or terminate access orders in the child's best interests, subject to the mandatory access rules in s. 105.",
    practiceNote: "Under s. 105(1), when a child is removed under s. 101(1), para. 1 or 2, the court shall make an order for access by the person who had charge unless satisfied continued contact would not be in the child's best interests."
  },
  {
    authorityId: "CYFSA:109(2)",
    citation: "CYFSA, s. 109(2)",
    instrument: "CYFSA",
    statuteTitle: CYFSA_TITLE,
    sectionKey: "109(2)",
    heading: "Residential placement obligations",
    exactWording: "(2) The society having care of a child shall choose a residential placement for the child that, (a) represents the least restrictive alternative for the child; (b) where possible, respects the child’s race, ancestry, place of origin, colour, ethnic origin, citizenship, family diversity, creed, sex, sexual orientation, gender identity and gender expression; (c) where possible, respects the child’s cultural and linguistic heritage; (d) in the case of a First Nations, Inuk or Métis child, is with, if possible, a member of the child’s extended family or, if that is not possible, (i) in the case of a First Nations child, another First Nations family, (ii) in the case of an Inuk child, another Inuit family, or (iii) in the case of a Métis child, another Métis family; and (e) takes into account the child’s views and wishes, given due weight in accordance with the child’s age and maturity, and the views and wishes of any parent who is entitled to access to the child.",
    sourceUrl: "https://www.ontario.ca/laws/statute/17c14#BK133",
    consolidationPeriod: CYFSA_PERIOD,
    effectiveFrom: "2018-04-30",
    effectiveTo: null,
    verificationSourceType: "BUNDLED_CONSOLIDATION_VERBATIM",
    verifiedDate: "2026-11-03",
    legalTestSummary: "Requires a society choosing a residential placement for a child in interim or extended care to choose the least restrictive alternative and take into account the views and wishes of the child and any parent entitled to access.",
    practiceNote: "Also see s. 109(5)(b), requiring the wishes of any parent entitled to access to be taken into account in the society's major decisions concerning the child."
  },
  {
    authorityId: "CYFSA:109(2)(d)",
    citation: "CYFSA, s. 109(2)(d)",
    instrument: "CYFSA",
    statuteTitle: CYFSA_TITLE,
    sectionKey: "109(2)(d)",
    heading: "Residential placement — First Nations, Inuk or Métis child",
    exactWording: "(d) in the case of a First Nations, Inuk or Métis child, is with, if possible, a member of the child’s extended family or, if that is not possible, (i) in the case of a First Nations child, another First Nations family, (ii) in the case of an Inuk child, another Inuit family, or (iii) in the case of a Métis child, another Métis family; and",
    sourceUrl: "https://www.ontario.ca/laws/statute/17c14#BK133",
    consolidationPeriod: CYFSA_PERIOD,
    effectiveFrom: "2018-04-30",
    effectiveTo: null,
    verificationSourceType: "BUNDLED_CONSOLIDATION_VERBATIM",
    verifiedDate: "2026-11-03",
    legalTestSummary: "Requires a society choosing a residential placement for a First Nations, Inuk, or Métis child to place the child with a member of the child's extended family if possible, or otherwise with an Indigenous family.",
    practiceNote: "Operates alongside s. 101(5) and Bill C-92, s. 16(1)."
  },
  {
    authorityId: "CYFSA:115(2)",
    citation: "CYFSA, s. 115(2)",
    instrument: "CYFSA",
    statuteTitle: CYFSA_TITLE,
    sectionKey: "115(2)",
    heading: "Society to seek status review",
    exactWording: "(2) The society that has or had care, custody or supervision of the child, (a) may apply to the court at any time, subject to subsection (9), for a review of the child’s status; (b) shall apply to the court for a review of the child’s status before the order expires if the order is for society supervision, unless the expiry is by reason of section 123; and (c) shall apply to the court for a review of the child’s status within five days after removing the child, if the society has removed the child, (i) from the care of a person with whom the child was placed under an order for society supervision described in clause 116 (1) (a), or (ii) from the custody of a person who had custody of the child under a custody order described in clause 116 (1) (b).",
    sourceUrl: "https://www.ontario.ca/laws/statute/17c14#BK141",
    consolidationPeriod: CYFSA_PERIOD,
    effectiveFrom: "2018-04-30",
    effectiveTo: null,
    verificationSourceType: "BUNDLED_CONSOLIDATION_VERBATIM",
    verifiedDate: "2026-11-03",
    legalTestSummary: "Mandates status review applications before expiry of supervision orders and within five days after removing a child from a person's care under a s. 116(1)(a) supervision or s. 116(1)(b) custody order (parallel to s. 113(2) for s. 101(1) orders).",
    practiceNote: "Check both s. 113(2) (status review of s. 101(1) orders) and s. 115(2) (status review of s. 116(1) orders)."
  },
  {
    authorityId: "CYFSA:121(1)",
    citation: "CYFSA, s. 121(1)",
    instrument: "CYFSA",
    statuteTitle: CYFSA_TITLE,
    sectionKey: "121(1)",
    heading: "Appeal from Part V order",
    exactWording: "(1) An appeal from a court’s order under this Part may be made by, (a) the child, if the child is entitled to participate in the proceeding under subsection 79 (6) (child’s participation); (b) any parent of the child; (c) the person who had charge of the child immediately before intervention under this Part; (d) a Director or local director; or (e) in the case of a First Nations, Inuk or Métis child, a person described in clause (a), (b), (c) or (d) or a representative chosen by each of the child’s bands and First Nations, Inuit or Métis communities. 2017, c. 14, Sched. 1, s. 121 (1); 2020, c. 25, Sched. 2, s. 5 (1).",
    sourceUrl: "https://www.ontario.ca/laws/statute/17c14#BK147",
    consolidationPeriod: CYFSA_PERIOD,
    effectiveFrom: "2018-04-30",
    effectiveTo: null,
    verificationSourceType: "BUNDLED_CONSOLIDATION_VERBATIM",
    verifiedDate: "2026-11-03",
    legalTestSummary: "Establishes the statutory right to appeal a Part V order (other than a s. 98 assessment order).",
    practiceNote: "See s. 121(2.1) for the appellate court forum and s. 121(3) for the automatic 10-day stay."
  },
  {
    authorityId: "CYFSA:121(2.1)",
    citation: "CYFSA, s. 121(2.1)",
    instrument: "CYFSA",
    statuteTitle: CYFSA_TITLE,
    sectionKey: "121(2.1)",
    heading: "Appeal court forum",
    exactWording: "(2.1) The appeal shall be made to, (a) the Superior Court of Justice, if the order was made at the Ontario Court of Justice; or (b) the Divisional Court, if the order was made at the Family Court of the Superior Court of Justice. 2020, c. 25, Sched. 2, s. 5 (2).",
    sourceUrl: "https://www.ontario.ca/laws/statute/17c14#BK147",
    consolidationPeriod: "In force March 1, 2021 to Present (S.O. 2020, c. 25, Sched. 2, s. 5(2))",
    effectiveFrom: "2021-03-01",
    effectiveTo: null,
    verificationSourceType: "BUNDLED_CONSOLIDATION_VERBATIM",
    verifiedDate: "2026-11-03",
    legalTestSummary: "Specifies whether an appeal under s. 121 lies to the Superior Court of Justice or the Divisional Court.",
    practiceNote: "Added by the Moving Ontario Family Law Forward Act, 2020, effective March 1, 2021 (see transition rule in s. 121(9))."
  },
  {
    authorityId: "CYFSA:121(3)",
    citation: "CYFSA, s. 121(3)",
    instrument: "CYFSA",
    statuteTitle: CYFSA_TITLE,
    sectionKey: "121(3)",
    heading: "Care and custody pending appeal — 10-day stay",
    exactWording: "(3) Where a decision regarding the care and custody of a child is appealed under subsection (1), execution of the decision shall be stayed for the 10 days immediately following service of the notice of appeal on the court that made the decision, and where the child is in the society’s care and custody at the time the decision is made, the child shall remain in the care and custody of the society until, (a) the 10-day period of the stay has expired; or (b) an order is made under subsection (4), whichever is earlier. 2017, c. 14, Sched. 1, s. 121 (3).",
    sourceUrl: "https://www.ontario.ca/laws/statute/17c14#BK147",
    consolidationPeriod: CYFSA_PERIOD,
    effectiveFrom: "2018-04-30",
    effectiveTo: null,
    verificationSourceType: "BUNDLED_CONSOLIDATION_VERBATIM",
    verifiedDate: "2026-11-03",
    legalTestSummary: "Provides an automatic 10-day stay of execution of a care and custody decision upon service of the notice of appeal on the court that made the decision.",
    practiceNote: "Within the 10-day stay, a party may move under s. 121(4) for a temporary care and custody order pending final disposition of the appeal."
  },
  {
    authorityId: "CYFSA:123",
    citation: "CYFSA, s. 123",
    instrument: "CYFSA",
    statuteTitle: CYFSA_TITLE,
    sectionKey: "123",
    heading: "Expiry of orders",
    exactWording: "123 An order under this Part expires when the child who is the subject of the order, (a) turns 18; or (b) marries, whichever comes first.",
    sourceUrl: "https://www.ontario.ca/laws/statute/17c14#BK150",
    consolidationPeriod: CYFSA_PERIOD,
    effectiveFrom: "2018-04-30",
    effectiveTo: null,
    verificationSourceType: "BUNDLED_CONSOLIDATION_VERBATIM",
    verifiedDate: "2026-11-03",
    legalTestSummary: "Provides that any Part V order expires when the child turns 18 or marries, whichever comes first.",
    practiceNote: "After expiry at age 18, continued care and support agreements are governed by s. 124."
  },
  {
    authorityId: "CYFSA:125(1)",
    citation: "CYFSA, s. 125(1)",
    instrument: "CYFSA",
    statuteTitle: CYFSA_TITLE,
    sectionKey: "125(1)",
    heading: "Duty to report child in need of protection",
    exactWording: "125 (1) Despite the provisions of any other Act, if a person, including a person who performs professional or official duties with respect to children, has reasonable grounds to suspect one of the following, the person shall immediately report the suspicion and the information on which it is based to a society...",
    sourceUrl: "https://www.ontario.ca/laws/statute/17c14#BK152",
    consolidationPeriod: CYFSA_PERIOD,
    effectiveFrom: "2018-04-30",
    effectiveTo: null,
    verificationSourceType: "BUNDLED_CONSOLIDATION_VERBATIM",
    verifiedDate: "2026-11-03",
    legalTestSummary: "Establishes the 'reasonable grounds to suspect' reporting threshold for reporting suspected harm or risk to a Society.",
    practiceNote: "Section 125(1) is a reporting threshold, NOT an evidentiary standard for finding a child in need of protection under s. 74(2) or for warrantless removal under s. 81(7)."
  },
  {
    authorityId: "CYFSA:136(5)",
    citation: "CYFSA, s. 136(5)",
    instrument: "CYFSA",
    statuteTitle: CYFSA_TITLE,
    sectionKey: "136(5)",
    heading: "Police may bring child home or to place of safety",
    exactWording: "(5) Where a child who is actually or apparently younger than 16 is in a place to which the public has access between the hours of midnight and 6 a.m. and is not accompanied by a person described in clause (4) (b), a peace officer may bring the child to a place of safety without a warrant and proceed as if the child had been brought to a place of safety under subsection 84 (1).",
    sourceUrl: "https://www.ontario.ca/laws/statute/17c14#BK165",
    consolidationPeriod: CYFSA_PERIOD,
    effectiveFrom: "2018-04-30",
    effectiveTo: null,
    verificationSourceType: "BUNDLED_CONSOLIDATION_VERBATIM",
    verifiedDate: "2026-11-03",
    legalTestSummary: "Authorizes a peace officer to bring an unaccompanied child younger than 16 in a public place between midnight and 6 a.m. to a place of safety without a warrant.",
    practiceNote: "Triggers the s. 88 five-day limit if the child is kept in a place of safety."
  },
  {
    authorityId: "CYFSA:312(1)",
    citation: "CYFSA, s. 312(1)",
    instrument: "CYFSA",
    statuteTitle: CYFSA_TITLE,
    sectionKey: "312(1)",
    heading: "Right of access to record of personal information",
    exactWording: "(1) An individual has a right of access to a record of personal information about the individual that is in a service provider’s custody or control and that relates to the provision of a service to the individual unless, (a) the record or the information in the record is subject to a legal privilege that restricts its disclosure to the individual; (b) another Act, an Act of Canada or a court order prohibits its disclosure to the individual; (c) the information in the record was collected or created primarily in anticipation of or for use in a proceeding, and the proceeding, together with all appeals or processes resulting from it, has not been concluded; or (d) granting the access could reasonably be expected to, (i) result in a risk of serious harm to the individual or another individual, (ii) lead to the identification of an individual who was required by law to provide information in the record to the service provider, or (iii) lead to the identification of an individual who provided information in the record to the service provider explicitly or implicitly in confidence if the service provider considers it appropriate in the circumstances that the identity of the individual be kept confidential.",
    sourceUrl: "https://www.ontario.ca/laws/statute/17c14#BK361",
    consolidationPeriod: "In force January 1, 2020 to Present (Part X)",
    effectiveFrom: "2020-01-01",
    effectiveTo: null,
    verificationSourceType: "BUNDLED_CONSOLIDATION_VERBATIM",
    verifiedDate: "2026-11-03",
    legalTestSummary: "Establishes an individual's Part X right of access to a record of personal information in a service provider's custody or control, subject to enumerated exceptions and severability under s. 312(2).",
    practiceNote: "Section 312(1) (not s. 292, which governs disclosure without consent) is the statutory right of access to personal information records under Part X."
  },
  {
    authorityId: "CYFSA:14",
    citation: "CYFSA, s. 14",
    instrument: "CYFSA",
    statuteTitle: CYFSA_TITLE,
    sectionKey: "14",
    heading: "Parental consent, etc. — Rights retained by parent of child in care",
    exactWording: "14 Subject to subsection 94 (7) and sections 110 and 111 (custody during adjournment, interim and extended society care), the parent of a child in care retains any right that the parent may have, (a) to direct the child’s or young person’s education and upbringing, in accordance with the child’s or young person’s creed, community identity and cultural identity; and (b) to consent to treatment on behalf of an incapable child or young person, if the parent is the child’s or young person’s substitute decision-maker in accordance with section 20 of the Health Care Consent Act, 1996.",
    sourceUrl: "https://www.ontario.ca/laws/statute/17c14#BK19",
    consolidationPeriod: CYFSA_PERIOD,
    effectiveFrom: "2018-04-30",
    effectiveTo: null,
    verificationSourceType: "BUNDLED_CONSOLIDATION_VERBATIM",
    verifiedDate: "2026-11-03",
    legalTestSummary: "Preserves a parent's rights to direct the child's education and upbringing (in accordance with creed, community identity, and cultural identity) and to consent to treatment under the HCCA 1996 when a child is in care, subject to s. 94(7) and ss. 110–111.",
    practiceNote: "Applies particularly when a child is in care under a voluntary Temporary Care Agreement (s. 75) unless treatment consent authority was transferred under s. 75(9)."
  },
  {
    authorityId: "CYFSA:15(2)",
    citation: "CYFSA, s. 15(2)",
    instrument: "CYFSA",
    statuteTitle: CYFSA_TITLE,
    sectionKey: "15(2)",
    heading: "Children, young persons and parents to be heard and represented",
    exactWording: "(2) Service providers shall ensure that children and young persons and their parents have an opportunity to be heard and represented when decisions affecting their interests are made and to be heard when they have concerns about the services they are receiving.",
    sourceUrl: "https://www.ontario.ca/laws/statute/17c14#BK21",
    consolidationPeriod: CYFSA_PERIOD,
    effectiveFrom: "2018-04-30",
    effectiveTo: null,
    verificationSourceType: "BUNDLED_CONSOLIDATION_VERBATIM",
    verifiedDate: "2026-11-03",
    legalTestSummary: "Mandates that service providers ensure children, young persons, and their parents have an opportunity to be heard and represented when decisions affecting their interests are made, and to be heard regarding concerns about services received (subject to the s. 15(3) good-cause exception).",
    practiceNote: "Failure by a society to comply with s. 15(2) is an enumerated ground for direct review by the Child and Family Services Review Board (CFSRB) under CYFSA s. 120(4), para. 4 (unless the matter is before or decided by the court per s. 120(8))."
  },
  {
    authorityId: "CYFSA:15(4)",
    citation: "CYFSA, s. 15(4)",
    instrument: "CYFSA",
    statuteTitle: CYFSA_TITLE,
    sectionKey: "15(4)",
    heading: "Criteria and safeguards re decisions",
    exactWording: "(4) Service providers shall ensure that decisions affecting the interests and rights of children and young persons and their parents are made according to clear, consistent criteria and are subject to appropriate procedural safeguards.",
    sourceUrl: "https://www.ontario.ca/laws/statute/17c14#BK21",
    consolidationPeriod: CYFSA_PERIOD,
    effectiveFrom: "2018-04-30",
    effectiveTo: null,
    verificationSourceType: "BUNDLED_CONSOLIDATION_VERBATIM",
    verifiedDate: "2026-11-03",
    legalTestSummary: "Requires service providers to ensure decisions affecting the interests and rights of children, young persons, and their parents are made according to clear, consistent criteria and procedural safeguards.",
    practiceNote: "Supports scrutiny of arbitrary or undocumented service and access decisions."
  },
  {
    authorityId: "CYFSA:35(2)",
    citation: "CYFSA, s. 35(2)",
    instrument: "CYFSA",
    statuteTitle: CYFSA_TITLE,
    sectionKey: "35(2)",
    heading: "Society duty to provide prescribed standard of services",
    exactWording: "(2) A society shall, (a) provide the prescribed standard of services in its performance of its functions; and (b) follow the prescribed procedures and practices.",
    sourceUrl: "https://www.ontario.ca/laws/statute/17c14#BK46",
    consolidationPeriod: CYFSA_PERIOD,
    effectiveFrom: "2018-04-30",
    effectiveTo: null,
    verificationSourceType: "BUNDLED_CONSOLIDATION_VERBATIM",
    verifiedDate: "2026-11-03",
    legalTestSummary: "Statutorily obligates every children's aid society to provide the prescribed standard of services and follow prescribed procedures and practices.",
    practiceNote: "Links statutory CAS functions under s. 35(1) to the prescribed standards and practices under O. Reg. 156/18 and the Ontario Child Protection Standards (2016)."
  },
  {
    authorityId: "CYFSA:73",
    citation: "CYFSA, s. 73",
    instrument: "CYFSA",
    statuteTitle: CYFSA_TITLE,
    sectionKey: "73",
    heading: "Consultation in specified cases — First Nations, Inuk or Métis child",
    exactWording: "73 A society, person or entity that proposes to provide a prescribed service to a First Nations, Inuk or Métis child or young person, or to exercise a prescribed power under this Act in relation to such a child or young person, shall consult with a representative chosen by each of the child’s or young person’s bands and First Nations, Inuit or Métis communities in accordance with the regulations.",
    sourceUrl: "https://www.ontario.ca/laws/statute/17c14#BK90",
    consolidationPeriod: CYFSA_PERIOD,
    effectiveFrom: "2018-04-30",
    effectiveTo: null,
    verificationSourceType: "BUNDLED_CONSOLIDATION_VERBATIM",
    verifiedDate: "2026-11-03",
    legalTestSummary: "Mandates consultation with a representative chosen by each of a First Nations, Inuk, or Métis child's bands and communities when proposing to provide a prescribed service or exercise a prescribed power.",
    practiceNote: "Operates alongside CYFSA s. 72 and federal Bill C-92, s. 12(1)."
  },
  {
    authorityId: "CYFSA:75(1)",
    citation: "CYFSA, s. 75(1)",
    instrument: "CYFSA",
    statuteTitle: CYFSA_TITLE,
    sectionKey: "75(1)",
    heading: "Temporary care agreement",
    exactWording: "75 (1) A person who is temporarily unable to care adequately for a child in the person’s custody, and the society having jurisdiction where the person resides, may make a written agreement for the society’s care and custody of the child.",
    sourceUrl: "https://www.ontario.ca/laws/statute/17c14#BK93",
    consolidationPeriod: CYFSA_PERIOD,
    effectiveFrom: "2018-04-30",
    effectiveTo: null,
    verificationSourceType: "BUNDLED_CONSOLIDATION_VERBATIM",
    verifiedDate: "2026-11-03",
    legalTestSummary: "Authorizes a voluntary written Temporary Care Agreement between a custodial parent temporarily unable to care adequately for a child and the society.",
    practiceNote: "Must comply with the validity requirements for consent/agreements in CYFSA s. 21(2) (capacity, reasonably informed of nature, consequences, and alternatives, voluntary without coercion, and reasonable opportunity for independent advice)."
  },
  {
    authorityId: "CYFSA:75(4)",
    citation: "CYFSA, s. 75(4)",
    instrument: "CYFSA",
    statuteTitle: CYFSA_TITLE,
    sectionKey: "75(4)",
    heading: "Duty of society before making temporary care agreement",
    exactWording: "(4) A society shall not make a temporary care agreement unless the society, (a) has determined that an appropriate residential placement that is likely to benefit the child is available; and (b) is satisfied that no course of action less disruptive to the child, such as care in the child’s own home, is able to adequately protect the child.",
    sourceUrl: "https://www.ontario.ca/laws/statute/17c14#BK93",
    consolidationPeriod: CYFSA_PERIOD,
    effectiveFrom: "2018-04-30",
    effectiveTo: null,
    verificationSourceType: "BUNDLED_CONSOLIDATION_VERBATIM",
    verifiedDate: "2026-11-03",
    legalTestSummary: "Prohibits a society from making a Temporary Care Agreement unless it has determined an appropriate beneficial placement is available and is satisfied that no less disruptive course of action (such as in-home care) can adequately protect the child.",
    practiceNote: "Under s. 75(10), para. 3, the agreement must also contain a statement that the parent has discussed alternatives to residential placement with the society."
  },
  {
    authorityId: "CYFSA:75(5)",
    citation: "CYFSA, s. 75(5)",
    instrument: "CYFSA",
    statuteTitle: CYFSA_TITLE,
    sectionKey: "75(5)",
    heading: "Term of temporary care agreement limited",
    exactWording: "(5) No temporary care agreement shall be made for a term exceeding six months, but the parties to a temporary care agreement may, with a Director’s written approval, agree to extend it for a further period or periods if the total term of the agreement, as extended, does not exceed 12 months.",
    sourceUrl: "https://www.ontario.ca/laws/statute/17c14#BK93",
    consolidationPeriod: CYFSA_PERIOD,
    effectiveFrom: "2018-04-30",
    effectiveTo: null,
    verificationSourceType: "BUNDLED_CONSOLIDATION_VERBATIM",
    verifiedDate: "2026-11-03",
    legalTestSummary: "Caps an initial Temporary Care Agreement at 6 months and any extension (which requires a Director's written approval) at a total term of 12 months.",
    practiceNote: "Check whether any extension beyond 6 months has a documented written approval from a Director."
  },
  {
    authorityId: "CYFSA:75(6)",
    citation: "CYFSA, s. 75(6)",
    instrument: "CYFSA",
    statuteTitle: CYFSA_TITLE,
    sectionKey: "75(6)",
    heading: "Cumulative time limit — Temporary care agreement",
    exactWording: "(6) No temporary care agreement shall be made or extended so as to result in a child being in a society’s care and custody, for a period exceeding, (a) 12 months, if the child is younger than 6 on the day the agreement is entered into or extended; or (b) 24 months, if the child is 6 or older on the day the agreement is entered into or extended.",
    sourceUrl: "https://www.ontario.ca/laws/statute/17c14#BK93",
    consolidationPeriod: CYFSA_PERIOD,
    effectiveFrom: "2018-04-30",
    effectiveTo: null,
    verificationSourceType: "BUNDLED_CONSOLIDATION_VERBATIM",
    verifiedDate: "2026-11-03",
    legalTestSummary: "Prohibits making or extending a Temporary Care Agreement if it would result in cumulative society care exceeding 12 months (child under 6) or 24 months (child 6 or older).",
    practiceNote: "Time under a Temporary Care Agreement also counts toward the cumulative interim care limit in CYFSA s. 122(1)–(2)."
  },
  {
    authorityId: "CYFSA:76(3)",
    citation: "CYFSA, s. 76(3)",
    instrument: "CYFSA",
    statuteTitle: CYFSA_TITLE,
    sectionKey: "76(3)",
    heading: "Society response to notice of termination of temporary care agreement",
    exactWording: "(3) Where notice of a wish to terminate a temporary care agreement is given by or to a society under subsection (1), the society shall as soon as possible, and in any event before the agreement terminates under subsection (2), (a) cause the child to be returned to the person who made the agreement, or to a person who has obtained an order for the child’s custody since the agreement was made; (b) where the society is of the opinion that the child would be in need of protection if returned to the person referred to in clause (a), bring the child before the court under this Part to determine whether the child would be in need of protection in that case; or (c) where the child is 16 or 17 and the criteria set out in clauses 77 (1) (a), (b), (c) and (d) are met, make a written agreement with the child under subsection 77 (1).",
    sourceUrl: "https://www.ontario.ca/laws/statute/17c14#BK94",
    consolidationPeriod: CYFSA_PERIOD,
    effectiveFrom: "2018-04-30",
    effectiveTo: null,
    verificationSourceType: "BUNDLED_CONSOLIDATION_VERBATIM",
    verifiedDate: "2026-11-03",
    legalTestSummary: "Requires a society receiving written notice of termination of a Temporary Care Agreement to either return the child or bring the matter before the court before the agreement terminates (5 days after receipt, or up to 21 days if specified in the agreement per s. 76(2)).",
    practiceNote: "A society cannot retain a child after a s. 76(1) termination notice expires without bringing the matter before the court."
  },
  {
    authorityId: "CYFSA:79(1)",
    citation: "CYFSA, s. 79(1)",
    instrument: "CYFSA",
    statuteTitle: CYFSA_TITLE,
    sectionKey: "79(1)",
    heading: "Statutory parties to a child protection proceeding",
    exactWording: "79 (1) The following are parties to a proceeding under this Part: 1. The applicant. 2. The society having jurisdiction in the matter. 3. The child’s parent. 4. In the case of a First Nations, Inuk or Métis child, the persons described in paragraphs 1, 2 and 3 and a representative chosen by each of the child’s bands and First Nations, Inuit or Métis communities.",
    sourceUrl: "https://www.ontario.ca/laws/statute/17c14#BK100",
    consolidationPeriod: CYFSA_PERIOD,
    effectiveFrom: "2018-04-30",
    effectiveTo: null,
    verificationSourceType: "BUNDLED_CONSOLIDATION_VERBATIM",
    verifiedDate: "2026-11-03",
    legalTestSummary: "Designates the applicant, the society, the child's parent, and (for a First Nations, Inuk, or Métis child) a representative chosen by each of the child's bands and communities as statutory parties to a Part V proceeding.",
    practiceNote: "Check that all statutory parties under s. 79(1) (and any person who cared for the child continuously during the 6 months before the hearing under s. 79(3), or a child 12+ under s. 79(4)) received proper notice."
  },
  {
    authorityId: "CYFSA:80",
    citation: "CYFSA, s. 80",
    instrument: "CYFSA",
    statuteTitle: CYFSA_TITLE,
    sectionKey: "80",
    heading: "Duty to pursue customary care",
    exactWording: "80 A society shall make all reasonable efforts to pursue a plan for customary care for a First Nations, Inuk or Métis child if the child, (a) is in need of protection; (b) cannot remain in or be returned to the care and custody of the person who had charge of the child immediately before intervention under this Part or, where there is an order for the child’s custody that is enforceable in Ontario, of the person entitled to custody under the order; and (c) is a member of or identifies with a band, or is a member of or identifies with a First Nations, Inuit or Métis community.",
    sourceUrl: "https://www.ontario.ca/laws/statute/17c14#BK101",
    consolidationPeriod: CYFSA_PERIOD,
    effectiveFrom: "2018-04-30",
    effectiveTo: null,
    verificationSourceType: "BUNDLED_CONSOLIDATION_VERBATIM",
    verifiedDate: "2026-11-03",
    legalTestSummary: "Requires a society to make all reasonable efforts to pursue a plan for customary care for a First Nations, Inuk, or Métis child in need of protection who cannot remain with or return to the person who had charge.",
    practiceNote: "Examine whether the Society documented concrete efforts to consult the child's band or community regarding a customary care plan under s. 80 and subsidy availability under s. 71."
  },
  {
    authorityId: "CYFSA:93(1)",
    citation: "CYFSA, s. 93(1)",
    instrument: "CYFSA",
    statuteTitle: CYFSA_TITLE,
    sectionKey: "93(1)",
    heading: "Evidence — Past conduct and prior proceedings",
    exactWording: "93 (1) Despite anything in the Evidence Act, at a hearing under this Part, the court may admit as evidence, (a) evidence of past conduct of a person towards any child, if that conduct is relevant to that person’s ability to care for a child; or (b) any oral or written statement or report that the court considers relevant to the proceeding, including a transcript, exhibit or finding in an earlier civil or criminal proceeding.",
    sourceUrl: "https://www.ontario.ca/laws/statute/17c14#BK116",
    consolidationPeriod: CYFSA_PERIOD,
    effectiveFrom: "2018-04-30",
    effectiveTo: null,
    verificationSourceType: "BUNDLED_CONSOLIDATION_VERBATIM",
    verifiedDate: "2026-11-03",
    legalTestSummary: "Permits admission of past parenting conduct if relevant to the person's ability to care for a child, as well as relevant statements, reports, transcripts, or findings from earlier proceedings.",
    practiceNote: "Past history that has no nexus to current parenting ability or current protection risk should be challenged as irrelevant under s. 93(1)(a)."
  },
  {
    authorityId: "CYFSA:94(10)",
    citation: "CYFSA, s. 94(10)",
    instrument: "CYFSA",
    statuteTitle: CYFSA_TITLE,
    sectionKey: "94(10)",
    heading: "Evidence on temporary care and custody hearing — Credible and trustworthy",
    exactWording: "(10) For the purpose of this section, the court may admit and act on evidence that the court considers credible and trustworthy in the circumstances.",
    sourceUrl: "https://www.ontario.ca/laws/statute/17c14#BK117",
    consolidationPeriod: CYFSA_PERIOD,
    effectiveFrom: "2018-04-30",
    effectiveTo: null,
    verificationSourceType: "BUNDLED_CONSOLIDATION_VERBATIM",
    verifiedDate: "2026-11-03",
    legalTestSummary: "Establishes that at a temporary care and custody hearing under s. 94, the court may admit and act on evidence it considers 'credible and trustworthy in the circumstances'.",
    practiceNote: "Anonymous, unattributed, or multi-level hearsay on contested material issues can be challenged as failing the 'credible and trustworthy' threshold under s. 94(10) and Family Law Rules r. 14(18)–(19)."
  },
  {
    authorityId: "CYFSA:98(1)",
    citation: "CYFSA, s. 98(1)",
    instrument: "CYFSA",
    statuteTitle: CYFSA_TITLE,
    sectionKey: "98(1)",
    heading: "Order for assessment",
    exactWording: "98 (1) In the course of a proceeding under this Part, the court may order that one or more of the following persons undergo an assessment within a specified time by a person appointed in accordance with subsections (2) and (3): 1. The child. 2. A parent of the child. 3. Any other person, other than a foster parent, who is putting forward or would participate in a plan for the care and custody of or access to the child.",
    sourceUrl: "https://www.ontario.ca/laws/statute/17c14#BK121",
    consolidationPeriod: CYFSA_PERIOD,
    effectiveFrom: "2018-04-30",
    effectiveTo: null,
    verificationSourceType: "BUNDLED_CONSOLIDATION_VERBATIM",
    verifiedDate: "2026-11-03",
    legalTestSummary: "Authorizes the court to order a clinical/parenting assessment of the child, a parent, or a proposed caregiver by a qualified assessor.",
    practiceNote: "A society cannot unilaterally compel a parent to undergo a s. 98 clinical assessment without a court order or informed consent."
  },
  {
    authorityId: "CYFSA:105(1)",
    citation: "CYFSA, s. 105(1)",
    instrument: "CYFSA",
    statuteTitle: CYFSA_TITLE,
    sectionKey: "105(1)",
    heading: "Access: where child removed from person in charge",
    exactWording: "105 (1) Where an order is made under paragraph 1 or 2 of subsection 101 (1) removing a child from the person who had charge of the child immediately before intervention under this Part, the court shall make an order for access by the person unless the court is satisfied that continued contact with the person would not be in the child’s best interests.",
    sourceUrl: "https://www.ontario.ca/laws/statute/17c14#BK128",
    consolidationPeriod: CYFSA_PERIOD,
    effectiveFrom: "2018-04-30",
    effectiveTo: null,
    verificationSourceType: "BUNDLED_CONSOLIDATION_VERBATIM",
    verifiedDate: "2026-11-03",
    legalTestSummary: "Creates a mandatory presumption in favour of an access order for the person from whom the child was removed under a supervision or interim society care order, unless the court is satisfied continued contact would not be in the child's best interests.",
    practiceNote: "Contrast s. 105(1) (presumption FOR access in interim/supervision care) with s. 105(5) (presumption AGAINST access in extended society care unless beneficial/meaningful and non-impairing)."
  },
  {
    authorityId: "CYFSA:105(5)",
    citation: "CYFSA, s. 105(5)",
    instrument: "CYFSA",
    statuteTitle: CYFSA_TITLE,
    sectionKey: "105(5)",
    heading: "Access to child in extended society care — Two-part test",
    exactWording: "(5) A court shall not make or vary an access order under section 104 with respect to a child who is in extended society care under an order made under paragraph 3 of subsection 101 (1) or clause 116 (1) (c) unless the court is satisfied that, (a) the relationship between the person and the child is beneficial and meaningful to the child; and (b) the ordered access will not impair the child’s future opportunities for adoption.",
    sourceUrl: "https://www.ontario.ca/laws/statute/17c14#BK128",
    consolidationPeriod: CYFSA_PERIOD,
    effectiveFrom: "2018-04-30",
    effectiveTo: null,
    verificationSourceType: "BUNDLED_CONSOLIDATION_VERBATIM",
    verifiedDate: "2026-11-03",
    legalTestSummary: "Prohibits making or varying an access order for a child in extended society care unless satisfied that (a) the relationship is beneficial and meaningful to the child, and (b) ordered access will not impair future adoption opportunities.",
    practiceNote: "Ensure evidence of positive, consistent visits and emotional bond is documented in the record to satisfy s. 105(5)(a)."
  },
  {
    authorityId: "CYFSA:113(1)",
    citation: "CYFSA, s. 113(1)",
    instrument: "CYFSA",
    statuteTitle: CYFSA_TITLE,
    sectionKey: "113(1)",
    heading: "Status review application by parent, child, or caregiver",
    exactWording: "113 (1) Where a child is the subject of an order for society supervision or interim society care under subsection 101 (1) or an order for custody under subsection 102 (1), any of the following may apply to the court for a review of the child’s status: 1. A parent of the child. 2. The child, if the child is 12 or older. 3. A person with whom the child has been placed under an order for society supervision. 4. A person to whom custody of the child has been granted under an order for custody. 5. In the case of a First Nations, Inuk or Métis child, a person described in paragraph 1, 2, 3 or 4 or a representative chosen by each of the child’s bands and First Nations, Inuit or Métis communities.",
    sourceUrl: "https://www.ontario.ca/laws/statute/17c14#BK139",
    consolidationPeriod: CYFSA_PERIOD,
    effectiveFrom: "2018-04-30",
    effectiveTo: null,
    verificationSourceType: "BUNDLED_CONSOLIDATION_VERBATIM",
    verifiedDate: "2026-11-03",
    legalTestSummary: "Allows a parent, child 12+, caregiver, or FNIM representative to apply for a status review of a s. 101(1) supervision/interim care order or s. 102(1) custody order (subject to the 6-month limit in s. 113(3) absent leave).",
    practiceNote: "If a parent has completed key service-plan goals and reduced risk, a status review under s. 113(1) is the statutory mechanism to seek return of the child or less restrictive terms."
  },
  {
    authorityId: "CYFSA:113(2)",
    citation: "CYFSA, s. 113(2)",
    instrument: "CYFSA",
    statuteTitle: CYFSA_TITLE,
    sectionKey: "113(2)",
    heading: "Society mandatory status review application",
    exactWording: "(2) The society having care, custody or supervision of a child, (a) may apply to the court at any time for a review of the child’s status; (b) shall apply to the court for a review of the child’s status before the order expires, unless the expiry is by reason of section 123 (expiry at 18 or marriage); and (c) shall apply to the court for a review of the child’s status within five days after removing the child, if the society has removed the child from the care of a person with whom the child was placed under an order for society supervision or from the custody of a person who had custody of the child under an order for custody.",
    sourceUrl: "https://www.ontario.ca/laws/statute/17c14#BK139",
    consolidationPeriod: CYFSA_PERIOD,
    effectiveFrom: "2018-04-30",
    effectiveTo: null,
    verificationSourceType: "BUNDLED_CONSOLIDATION_VERBATIM",
    verifiedDate: "2026-11-03",
    legalTestSummary: "Requires the society to apply for a status review before a supervision or interim care order expires (s. 113(2)(b)) and within 5 days after removing a child from a person's care under a s. 101(1) supervision or s. 102(1) custody order (s. 113(2)(c)).",
    practiceNote: "Verify whether the society brought its status review application before order expiry or within 5 days of removing a child under a supervision order."
  },
  {
    authorityId: "CYFSA:114",
    citation: "CYFSA, s. 114",
    instrument: "CYFSA",
    statuteTitle: CYFSA_TITLE,
    sectionKey: "114",
    heading: "Court powers on status review under s. 113",
    exactWording: "114 Where an application for review of a child’s status is made under section 113, the court may, in the child’s best interests, (a) vary or terminate the original order made under subsection 101 (1) or 102 (1), including a term or condition or a provision for access that is part of the order; (b) order that the original order terminate on a specified future date; (c) make a further order or orders under section 101; or (d) make an order under section 102.",
    sourceUrl: "https://www.ontario.ca/laws/statute/17c14#BK140",
    consolidationPeriod: CYFSA_PERIOD,
    effectiveFrom: "2018-04-30",
    effectiveTo: null,
    verificationSourceType: "BUNDLED_CONSOLIDATION_VERBATIM",
    verifiedDate: "2026-11-03",
    legalTestSummary: "Empowers the court on a s. 113 status review to vary or terminate the original order, set a termination date, or make a further order under s. 101 or s. 102 in the child's best interests.",
    practiceNote: "Under s. 100, the court must obtain and consider an updated written Plan of Care before making an order under s. 114."
  },
  {
    authorityId: "CYFSA:116(1)",
    citation: "CYFSA, s. 116(1)",
    instrument: "CYFSA",
    statuteTitle: CYFSA_TITLE,
    sectionKey: "116(1)",
    heading: "Court order on status review under s. 115",
    exactWording: "116 (1) When an application is made under section 115, the court may, in the child’s best interests, (a) make an order for society supervision of the child for a specified period of at least three and not more than 12 months; (b) make an order granting custody of the child to one or more persons, other than a foster parent of the child, with the consent of the person or persons; or (c) make an order that the child be placed in extended society care until the order expires under section 123 (expiry at 18 or marriage).",
    sourceUrl: "https://www.ontario.ca/laws/statute/17c14#BK142",
    consolidationPeriod: CYFSA_PERIOD,
    effectiveFrom: "2018-04-30",
    effectiveTo: null,
    verificationSourceType: "BUNDLED_CONSOLIDATION_VERBATIM",
    verifiedDate: "2026-11-03",
    legalTestSummary: "Sets out the court's dispositive powers on a s. 115 status review: supervision order (3–12 months), custody order, or extended society care.",
    practiceNote: "Read together with s. 116(4) regarding supervision terms and conditions."
  },
  {
    authorityId: "CYFSA:116(4)",
    citation: "CYFSA, s. 116(4)",
    instrument: "CYFSA",
    statuteTitle: CYFSA_TITLE,
    sectionKey: "116(4)",
    heading: "Terms and conditions of status review supervision order — Non-funding rule",
    exactWording: "(4) If the court makes an order for society supervision under clause (1) (a), the court may impose, (a) reasonable terms and conditions relating to the child’s care and supervision; (b) reasonable terms and conditions on, (i) the child’s parent, (ii) the person who will have care and custody of the child under the order, (iii) the child, and (iv) any other person, other than a foster parent, who is putting forward or would participate in a plan for the care and custody of or access to the child; and (c) reasonable terms and conditions on the society that will supervise the placement, but shall not require the society to provide financial assistance or to purchase any goods or services.",
    sourceUrl: "https://www.ontario.ca/laws/statute/17c14#BK142",
    consolidationPeriod: CYFSA_PERIOD,
    effectiveFrom: "2018-04-30",
    effectiveTo: null,
    verificationSourceType: "BUNDLED_CONSOLIDATION_VERBATIM",
    verifiedDate: "2026-11-03",
    legalTestSummary: "Permits reasonable supervision terms on a s. 116(1)(a) supervision order, while clause (c) expressly prohibits requiring the society to provide financial assistance or purchase any goods or services.",
    practiceNote: "Together with s. 94(6)(c) and s. 101(7)(c), establishes that a court cannot compel a society via supervision terms to fund or purchase goods or services."
  },
  {
    authorityId: "CYFSA:119(1)",
    citation: "CYFSA, s. 119(1)",
    instrument: "CYFSA",
    statuteTitle: CYFSA_TITLE,
    sectionKey: "119(1)",
    heading: "Complaint to society",
    exactWording: "119 (1) A person may make a complaint to a society relating to a service sought or received by that person from the society in accordance with the regulations.",
    sourceUrl: "https://www.ontario.ca/laws/statute/17c14#BK145",
    consolidationPeriod: CYFSA_PERIOD,
    effectiveFrom: "2018-04-30",
    effectiveTo: null,
    verificationSourceType: "BUNDLED_CONSOLIDATION_VERBATIM",
    verifiedDate: "2026-11-03",
    legalTestSummary: "Provides the statutory right for a person who sought or received a service from a society to make a formal internal complaint in accordance with the regulations (O. Reg. 155/18).",
    practiceNote: "Subject to the mandatory court-issue exclusion in s. 119(11)."
  },
  {
    authorityId: "CYFSA:119(2)",
    citation: "CYFSA, s. 119(2)",
    instrument: "CYFSA",
    statuteTitle: CYFSA_TITLE,
    sectionKey: "119(2)",
    heading: "Society duty to follow complaint review procedure",
    exactWording: "(2) Where a society receives a complaint under subsection (1), it shall deal with the complaint in accordance with the complaint review procedure established by regulation, subject to subsection 120 (2).",
    sourceUrl: "https://www.ontario.ca/laws/statute/17c14#BK145",
    consolidationPeriod: CYFSA_PERIOD,
    effectiveFrom: "2018-04-30",
    effectiveTo: null,
    verificationSourceType: "BUNDLED_CONSOLIDATION_VERBATIM",
    verifiedDate: "2026-11-03",
    legalTestSummary: "Requires a society receiving a s. 119(1) complaint to process it in accordance with the regulatory complaint review procedure (Internal Complaint Review Panel under O. Reg. 155/18).",
    practiceNote: "If the society refuses to proceed or misses the regulatory timeframe, the complainant may apply to the CFSRB under s. 120(4), paras. 1–3."
  },
  {
    authorityId: "CYFSA:119(11)",
    citation: "CYFSA, s. 119(11)",
    instrument: "CYFSA",
    statuteTitle: CYFSA_TITLE,
    sectionKey: "119(11)",
    heading: "No society complaint review if matter within purview of court",
    exactWording: "(11) A society shall not conduct a review of a complaint under this section if the subject of the complaint, (a) is an issue that has been decided by the court or is before the court; or (b) is subject to another decision-making process under this Act or the Labour Relations Act, 1995.",
    sourceUrl: "https://www.ontario.ca/laws/statute/17c14#BK145",
    consolidationPeriod: CYFSA_PERIOD,
    effectiveFrom: "2018-04-30",
    effectiveTo: null,
    verificationSourceType: "BUNDLED_CONSOLIDATION_VERBATIM",
    verifiedDate: "2026-11-03",
    legalTestSummary: "Prohibits a society from reviewing a complaint under s. 119 if the subject of the complaint has been decided by the court or is before the court.",
    practiceNote: "Critical jurisdictional boundary: internal CAS complaints cannot review or overturn matters before the court or decided by a court order."
  },
  {
    authorityId: "CYFSA:120(1)",
    citation: "CYFSA, s. 120(1)",
    instrument: "CYFSA",
    statuteTitle: CYFSA_TITLE,
    sectionKey: "120(1)",
    heading: "Complaint to Child and Family Services Review Board (CFSRB)",
    exactWording: "120 (1) If a complaint in respect of a service sought or received from a society relates to a matter described in subsection (4), the person who sought or received the service may, (a) decide not to make the complaint to the society under section 119 and make the complaint directly to the Board under this section; or (b) where the person first makes the complaint to the society under section 119, submit the complaint to the Board before the society’s complaint review procedure is completed.",
    sourceUrl: "https://www.ontario.ca/laws/statute/17c14#BK146",
    consolidationPeriod: CYFSA_PERIOD,
    effectiveFrom: "2018-04-30",
    effectiveTo: null,
    verificationSourceType: "BUNDLED_CONSOLIDATION_VERBATIM",
    verifiedDate: "2026-11-03",
    legalTestSummary: "Permits a person who sought or received a society service to file a complaint regarding a s. 120(4) matter directly with the CFSRB without exhausting the society's internal review.",
    practiceNote: "Applies only to the procedural and right-to-be-heard grounds enumerated in s. 120(4), and is barred if the issue is before or decided by the court (s. 120(8))."
  },
  {
    authorityId: "CYFSA:120(4)",
    citation: "CYFSA, s. 120(4)",
    instrument: "CYFSA",
    statuteTitle: CYFSA_TITLE,
    sectionKey: "120(4)",
    heading: "Matters for CFSRB review",
    exactWording: "(4) The following matters may be reviewed by the Board under this section: 1. Allegations that the society has refused to proceed with a complaint made by the complainant under subsection 119 (1) as required under subsection 119 (2). 2. Allegations that the society has failed to respond to the complainant’s complaint within the timeframe required by regulation. 3. Allegations that the society has failed to comply with the complaint review procedure or with any other procedural requirements under this Act relating to the review of complaints. 4. Allegations that the society has failed to comply with subsection 15 (2). 5. Allegations that the society has failed to provide the complainant with reasons for a decision that affects the complainant’s interests. 6. Such other matters as may be prescribed.",
    sourceUrl: "https://www.ontario.ca/laws/statute/17c14#BK146",
    consolidationPeriod: CYFSA_PERIOD,
    effectiveFrom: "2018-04-30",
    effectiveTo: null,
    verificationSourceType: "BUNDLED_CONSOLIDATION_VERBATIM",
    verifiedDate: "2026-11-03",
    legalTestSummary: "Defines the specific jurisdiction of the CFSRB on service complaints: refusal to proceed, missed regulatory complaint deadlines, procedural non-compliance, failure to provide an opportunity to be heard under s. 15(2), and failure to provide reasons for a decision affecting the complainant's interests.",
    practiceNote: "Under s. 120(7), the CFSRB can order the society to proceed with a complaint, respond within a specified period, comply with s. 15(2), or provide written reasons, but cannot overturn a court order."
  },
  {
    authorityId: "CYFSA:120(8)",
    citation: "CYFSA, s. 120(8)",
    instrument: "CYFSA",
    statuteTitle: CYFSA_TITLE,
    sectionKey: "120(8)",
    heading: "No CFSRB review if matter within purview of court",
    exactWording: "(8) The Board shall not conduct a review of a complaint under this section if the subject of the complaint, (a) is an issue that has been decided by the court or is before the court; or (b) is subject to another decision-making process under this Act or the Labour Relations Act, 1995.",
    sourceUrl: "https://www.ontario.ca/laws/statute/17c14#BK146",
    consolidationPeriod: CYFSA_PERIOD,
    effectiveFrom: "2018-04-30",
    effectiveTo: null,
    verificationSourceType: "BUNDLED_CONSOLIDATION_VERBATIM",
    verifiedDate: "2026-11-03",
    legalTestSummary: "Expressly prohibits the CFSRB from reviewing any complaint whose subject is an issue that has been decided by the court or is before the court.",
    practiceNote: "Never suggest that the CFSRB can review or overturn a court order or adjudicate protection issues pending before the court."
  },
  {
    authorityId: "CYFSA:122(1)",
    citation: "CYFSA, s. 122(1)",
    instrument: "CYFSA",
    statuteTitle: CYFSA_TITLE,
    sectionKey: "122(1)",
    heading: "Cumulative time limit for interim society care (12 / 24 months)",
    exactWording: "122 (1) Subject to subsections (4) and (5), the court shall not make an order for interim society care under paragraph 2 of subsection 101 (1) that results in a child being in the care and custody of a society for a period exceeding, (a) 12 months, if the child is younger than 6 on the day the court makes the order; or (b) 24 months, if the child is 6 or older on the day the court makes the order.",
    sourceUrl: "https://www.ontario.ca/laws/statute/17c14#BK149",
    consolidationPeriod: CYFSA_PERIOD,
    effectiveFrom: "2018-04-30",
    effectiveTo: null,
    verificationSourceType: "BUNDLED_CONSOLIDATION_VERBATIM",
    verifiedDate: "2026-11-03",
    legalTestSummary: "Establishes the mandatory cumulative time-in-care ceiling for interim society care: 12 months for children under 6, and 24 months for children 6 or older (counting time in temporary care agreements under s. 75(1) and temporary care orders under s. 94(2)(d), per s. 122(2)), subject to a discretionary 6-month extension under s. 122(5).",
    practiceNote: "Critical reunification clock: delays in offering parent assistance or completing service plans directly erode the parent's finite 12/24-month window under s. 122(1)."
  },
  {
    authorityId: "CYFSA:122(5)",
    citation: "CYFSA, s. 122(5)",
    instrument: "CYFSA",
    statuteTitle: CYFSA_TITLE,
    sectionKey: "122(5)",
    heading: "Six-month extension of cumulative time-in-care limit",
    exactWording: "(5) Subject to paragraphs 2 and 4 of subsection 101 (1), the court may by order extend the period permitted under subsection (1) by a period not to exceed six months if it is in the child’s best interests to do so.",
    sourceUrl: "https://www.ontario.ca/laws/statute/17c14#BK149",
    consolidationPeriod: CYFSA_PERIOD,
    effectiveFrom: "2018-04-30",
    effectiveTo: null,
    verificationSourceType: "BUNDLED_CONSOLIDATION_VERBATIM",
    verifiedDate: "2026-11-03",
    legalTestSummary: "Authorizes the court to extend the cumulative 12-month or 24-month interim care limit in s. 122(1) by up to 6 months where it is in the child's best interests.",
    practiceNote: "Relevant where a parent is making demonstrable progress on service-plan goals or where agency delay impeded timely service access."
  },
  {
    authorityId: "CYFSA:126(1)",
    citation: "CYFSA, s. 126(1)",
    instrument: "CYFSA",
    statuteTitle: CYFSA_TITLE,
    sectionKey: "126(1)",
    heading: "Society duty to assess and verify child protection report",
    exactWording: "126 (1) A society that receives a report under section 125 that a child, including a child in the society’s care or supervision, is or may be in need of protection shall as soon as possible carry out an assessment as prescribed and verify the reported information, or ensure that the information is assessed and verified by another society.",
    sourceUrl: "https://www.ontario.ca/laws/statute/17c14#BK153",
    consolidationPeriod: CYFSA_PERIOD,
    effectiveFrom: "2018-04-30",
    effectiveTo: null,
    verificationSourceType: "BUNDLED_CONSOLIDATION_VERBATIM",
    verifiedDate: "2026-11-03",
    legalTestSummary: "Mandates that a society receiving a s. 125 report carry out a prescribed assessment as soon as possible and verify the reported information.",
    practiceNote: "Connects statutory investigation duty to Ontario Child Protection Standards (2016) Standards 1–6."
  },
  {
    authorityId: "CYFSA:306(1)",
    citation: "CYFSA, s. 306(1)",
    instrument: "CYFSA",
    statuteTitle: CYFSA_TITLE,
    sectionKey: "306(1)",
    heading: "Part X duty to ensure accuracy of personal information",
    exactWording: "306 (1) A service provider that uses personal information for the purpose of providing a service shall take reasonable steps to ensure that the information is as accurate, complete and up-to-date as is necessary for the purposes for which it uses the information.",
    sourceUrl: "https://www.ontario.ca/laws/statute/17c14#BK355",
    consolidationPeriod: "In force January 1, 2020 to Present (Part X)",
    effectiveFrom: "2020-01-01",
    effectiveTo: null,
    verificationSourceType: "BUNDLED_CONSOLIDATION_VERBATIM",
    verifiedDate: "2026-11-03",
    legalTestSummary: "Requires a service provider using personal information to provide a service to take reasonable steps to ensure the information is accurate, complete, and up-to-date.",
    practiceNote: "Supports record-accuracy challenges and Part X correction requests under s. 315(2)."
  },
  {
    authorityId: "CYFSA:314(3)",
    citation: "CYFSA, s. 314(3)",
    instrument: "CYFSA",
    statuteTitle: CYFSA_TITLE,
    sectionKey: "314(3)",
    heading: "Part X 30-day response limit for personal information access requests",
    exactWording: "(3) As soon as possible, but no later than 30 days after receiving the request, the service provider shall, by written notice to the individual, give the response required by subsection (1) or extend the deadline for responding by not more than 90 days if, (a) responding to the request within 30 days would unreasonably interfere with the operations of the service provider because the information consists of numerous pieces of information or locating the information would necessitate a lengthy search; or (b) the time required to undertake an assessment under subsection 312 (1) necessary to respond to the request within 30 days after receiving it would make it not reasonably practical to respond within that time.",
    sourceUrl: "https://www.ontario.ca/laws/statute/17c14#BK363",
    consolidationPeriod: "In force January 1, 2020 to Present (Part X)",
    effectiveFrom: "2020-01-01",
    effectiveTo: null,
    verificationSourceType: "BUNDLED_CONSOLIDATION_VERBATIM",
    verifiedDate: "2026-11-03",
    legalTestSummary: "Requires a service provider to respond in writing to a s. 313 personal information access request within 30 days (or give written notice of an extension of up to 90 days).",
    practiceNote: "Failure to respond within the required time is a deemed refusal under s. 314(7), entitling the requester to complain to the IPC under s. 316."
  },
  {
    authorityId: "CYFSA:315(2)",
    citation: "CYFSA, s. 315(2)",
    instrument: "CYFSA",
    statuteTitle: CYFSA_TITLE,
    sectionKey: "315(2)",
    heading: "Part X right to request correction of personal information record",
    exactWording: "(2) If a service provider has granted an individual access to a record of personal information and if the individual believes that the record is inaccurate or incomplete, the individual may request in writing that the service provider correct the record. 2017, c. 14, Sched. 1, s. 315 (2).",
    sourceUrl: "https://www.ontario.ca/laws/statute/17c14#BK364",
    consolidationPeriod: "In force January 1, 2020 to Present (Part X)",
    effectiveFrom: "2020-01-01",
    effectiveTo: null,
    verificationSourceType: "BUNDLED_CONSOLIDATION_VERBATIM",
    verifiedDate: "2026-11-03",
    legalTestSummary: "Entitles an individual who has been granted access to their personal information record under Part X to request in writing that inaccurate or incomplete information be corrected.",
    practiceNote: "Under s. 315(10)(b), a service provider is not required to correct a good-faith professional opinion or observation, but under s. 315(12) the individual has the statutory right to require a Statement of Disagreement to be attached to the record."
  },
  {
    authorityId: "CYFSA:316(1)",
    citation: "CYFSA, s. 316(1)",
    instrument: "CYFSA",
    statuteTitle: CYFSA_TITLE,
    sectionKey: "316(1)",
    heading: "Part X complaint to Information and Privacy Commissioner (IPC)",
    exactWording: "316 (1) A person who has reasonable grounds to believe that another person has contravened or is about to contravene a provision of this Part or the regulations made for the purposes of this Part may make a complaint to the Commissioner.",
    sourceUrl: "https://www.ontario.ca/laws/statute/17c14#BK365",
    consolidationPeriod: "In force January 1, 2020 to Present (Part X)",
    effectiveFrom: "2020-01-01",
    effectiveTo: null,
    verificationSourceType: "BUNDLED_CONSOLIDATION_VERBATIM",
    verifiedDate: "2026-11-03",
    legalTestSummary: "Authorizes complaints to the Information and Privacy Commissioner of Ontario (IPC) regarding contraventions of Part X (within 1 year under s. 316(2), or within 6 months of an access or correction refusal under s. 316(3)).",
    practiceNote: "The IPC can order access or correction of personal information records under s. 321(1), but cannot adjudicate child protection custody or access orders."
  },
  {
    authorityId: "CYFSA:333(1)",
    citation: "CYFSA, s. 333(1)",
    instrument: "CYFSA",
    statuteTitle: CYFSA_TITLE,
    sectionKey: "333(1)",
    heading: "Child and Family Services Review Board (CFSRB)",
    exactWording: "333 (1) The Child and Family Services Review Board is continued under the name Child and Family Services Review Board in English and Commission de révision des services à l’enfance et à la famille in French.",
    sourceUrl: "https://www.ontario.ca/laws/statute/17c14#BK383",
    consolidationPeriod: CYFSA_PERIOD,
    effectiveFrom: "2018-04-30",
    effectiveTo: null,
    verificationSourceType: "BUNDLED_CONSOLIDATION_VERBATIM",
    verifiedDate: "2026-11-03",
    legalTestSummary: "Continues the Child and Family Services Review Board (CFSRB) with statutory review jurisdiction under sections 66, 119, 120, 192, and 265.",
    practiceNote: "The CFSRB is an administrative tribunal with strictly defined statutory jurisdiction; it cannot overturn Family Court orders."
  },

  // ---------------------------------------------------------------------------
  // FEDERAL STATUTE: Bill C-92 (S.C. 2019, c. 24) — Verbatim in legal-reference/Bill_C92_full_text.txt
  // ---------------------------------------------------------------------------
  {
    authorityId: "BILL_C92:10(1)",
    citation: "An Act respecting First Nations, Inuit and Métis children, youth and families, S.C. 2019, c. 24, s. 10(1)",
    instrument: "BILL_C92",
    statuteTitle: BILL_C92_TITLE,
    sectionKey: "10(1)",
    heading: "Best interests of Indigenous child",
    exactWording: "10(1) The best interests of the child must be a primary consideration in the making of decisions or the taking of actions in the context of the provision of child and family services in relation to an Indigenous child and, in the case of decisions or actions related to child apprehension, the best interests of the child must be the paramount consideration.",
    sourceUrl: "https://laws-lois.justice.gc.ca/eng/acts/F-11.73/",
    consolidationPeriod: "In force January 1, 2020 to Present (SI/2019-96)",
    effectiveFrom: "2020-01-01",
    effectiveTo: null,
    verificationSourceType: "BUNDLED_CONSOLIDATION_VERBATIM",
    verifiedDate: "2026-11-03",
    legalTestSummary: "Makes the best interests of an Indigenous child a primary consideration in child and family service decisions and the paramount consideration in apprehension decisions.",
    practiceNote: "Applies as binding federal minimum national standards across Ontario child protection proceedings involving First Nations, Inuit, and Métis children."
  },
  {
    authorityId: "BILL_C92:12(1)",
    citation: "An Act respecting First Nations, Inuit and Métis children, youth and families, S.C. 2019, c. 24, s. 12(1)",
    instrument: "BILL_C92",
    statuteTitle: BILL_C92_TITLE,
    sectionKey: "12(1)",
    heading: "Notice to parent, care provider, and Indigenous governing body before significant measures",
    exactWording: "12(1) In the context of providing child and family services in relation to an Indigenous child, to the extent that doing so is consistent with the best interests of the child, before taking any significant measure in relation to the child, the service provider must provide notice of the measure to the child's parent and the care provider, as well as to the Indigenous governing body that acts on behalf of the Indigenous group, community or people to which the child belongs and that has informed the service provider that they are acting on behalf of that Indigenous group, community or people.",
    sourceUrl: "https://laws-lois.justice.gc.ca/eng/acts/F-11.73/",
    consolidationPeriod: "In force January 1, 2020 to Present (SI/2019-96)",
    effectiveFrom: "2020-01-01",
    effectiveTo: null,
    verificationSourceType: "BUNDLED_CONSOLIDATION_VERBATIM",
    verifiedDate: "2026-11-03",
    legalTestSummary: "Requires advance notice to the parent, care provider, and applicable Indigenous governing body before taking any significant measure in relation to an Indigenous child.",
    practiceNote: "Verify in the court record when and how notice under s. 12(1) was delivered before any significant measure was taken."
  },
  {
    authorityId: "BILL_C92:14(1)",
    citation: "An Act respecting First Nations, Inuit and Métis children, youth and families, S.C. 2019, c. 24, s. 14(1)",
    instrument: "BILL_C92",
    statuteTitle: BILL_C92_TITLE,
    sectionKey: "14(1)",
    heading: "Priority to preventive care",
    exactWording: "14(1) In the context of providing child and family services in relation to an Indigenous child, to the extent that providing a service that promotes preventive care to support the child's family is consistent with the best interests of the child, the provision of that service is to be given priority over other services.",
    sourceUrl: "https://laws-lois.justice.gc.ca/eng/acts/F-11.73/",
    consolidationPeriod: "In force January 1, 2020 to Present (SI/2019-96)",
    effectiveFrom: "2020-01-01",
    effectiveTo: null,
    verificationSourceType: "BUNDLED_CONSOLIDATION_VERBATIM",
    verifiedDate: "2026-11-03",
    legalTestSummary: "Mandates that preventive care services to support an Indigenous child's family be given priority over other services where consistent with the child's best interests.",
    practiceNote: "Operates alongside s. 15 (no apprehension solely on socio-economic conditions) and s. 15.1 (reasonable efforts required before apprehension)."
  },
  {
    authorityId: "BILL_C92:15",
    citation: "An Act respecting First Nations, Inuit and Métis children, youth and families, S.C. 2019, c. 24, s. 15",
    instrument: "BILL_C92",
    statuteTitle: BILL_C92_TITLE,
    sectionKey: "15",
    heading: "No apprehension based solely on socio-economic conditions",
    exactWording: "15 In the context of providing child and family services in relation to an Indigenous child, to the extent that it is consistent with the best interests of the child, the child must not be apprehended solely on the basis of his or her socio-economic conditions, including poverty, lack of adequate housing or infrastructure or the state of health of his or her parent or the care provider.",
    sourceUrl: "https://laws-lois.justice.gc.ca/eng/acts/F-11.73/",
    consolidationPeriod: "In force January 1, 2020 to Present (SI/2019-96)",
    effectiveFrom: "2020-01-01",
    effectiveTo: null,
    verificationSourceType: "BUNDLED_CONSOLIDATION_VERBATIM",
    verifiedDate: "2026-11-03",
    legalTestSummary: "Prohibits apprehending an Indigenous child solely on the basis of socio-economic conditions, including poverty, lack of adequate housing or infrastructure, or parental state of health.",
    practiceNote: "Applies directly where an affidavit relies on housing inadequacy, poverty, or parental health status without independent protection grounds."
  },
  {
    authorityId: "BILL_C92:15.1",
    citation: "An Act respecting First Nations, Inuit and Métis children, youth and families, S.C. 2019, c. 24, s. 15.1",
    instrument: "BILL_C92",
    statuteTitle: BILL_C92_TITLE,
    sectionKey: "15.1",
    heading: "Reasonable efforts required before apprehension",
    exactWording: "15.1 In the context of providing child and family services in relation to an Indigenous child, unless immediate apprehension is consistent with the best interests of the child, before apprehending a child who resides with one of the child's parents or another adult member of the child's family, the service provider must demonstrate that he or she made reasonable efforts to have the child continue to reside with that person.",
    sourceUrl: "https://laws-lois.justice.gc.ca/eng/acts/F-11.73/",
    consolidationPeriod: "In force January 1, 2020 to Present (SI/2019-96)",
    effectiveFrom: "2020-01-01",
    effectiveTo: null,
    verificationSourceType: "BUNDLED_CONSOLIDATION_VERBATIM",
    verifiedDate: "2026-11-03",
    legalTestSummary: "Requires the service provider to demonstrate that reasonable efforts were made to have an Indigenous child continue to reside with their parent or adult family member before apprehension, unless immediate apprehension is consistent with the child's best interests.",
    practiceNote: "Places an affirmative evidentiary burden on the service provider to document reasonable pre-apprehension efforts."
  },
  {
    authorityId: "BILL_C92:16(1)",
    citation: "An Act respecting First Nations, Inuit and Métis children, youth and families, S.C. 2019, c. 24, s. 16(1)",
    instrument: "BILL_C92",
    statuteTitle: BILL_C92_TITLE,
    sectionKey: "16(1)",
    heading: "Placement of Indigenous child — Priority order",
    exactWording: "16(1) The placement of an Indigenous child in the context of providing child and family services in relation to the child, to the extent that it is consistent with the best interests of the child, is to occur in the following order of priority: (a) with one of the child's parents; (b) with another adult member of the child's family; (c) with an adult who belongs to the same Indigenous group, community or people as the child; (d) with an adult who belongs to an Indigenous group, community or people other than the one to which the child belongs; or (e) with any other adult.",
    sourceUrl: "https://laws-lois.justice.gc.ca/eng/acts/F-11.73/",
    consolidationPeriod: "In force January 1, 2020 to Present (SI/2019-96)",
    effectiveFrom: "2020-01-01",
    effectiveTo: null,
    verificationSourceType: "BUNDLED_CONSOLIDATION_VERBATIM",
    verifiedDate: "2026-11-03",
    legalTestSummary: "Establishes a five-tier federal placement priority order for an Indigenous child, starting with (a) a parent and (b) another adult member of the child's family.",
    practiceNote: "Requires the Society to document why higher-priority placements in s. 16(1)(a)-(d) were not used before placing a child under (e)."
  },

  // ---------------------------------------------------------------------------
  // FAMILY LAW RULES (O. Reg. 114/99) — Distinct category, never in CYFSA allowlist
  // ---------------------------------------------------------------------------
  {
    authorityId: "FLR:1(8)",
    citation: "Family Law Rules, O. Reg. 114/99, Rule 1(8)",
    instrument: "FAMILY_LAW_RULES",
    statuteTitle: FLR_TITLE,
    sectionKey: "1(8)",
    heading: "Failure to obey order",
    exactWording: "1 (8) If a person fails to obey an order in a case or a related case, the court may deal with the failure by making any order that it considers necessary for a just determination of the matter, including, (a) an order for costs; (b) an order dismissing a claim; (c) an order striking out any application, answer, notice of motion, motion to change, response to motion to change, financial statement, affidavit, or any other document filed by a party; (d) an order that all or part of a document that was required to be provided but was not, may not be used in the case; (e) an order that a party is not entitled to any further order from the court unless the court orders otherwise; (f) an order postponing the trial or any other step in the case; and (g) on motion, a contempt order.",
    sourceUrl: "https://www.ontario.ca/laws/regulation/990114#BK1",
    consolidationPeriod: "Consolidation period: In Force (O. Reg. 114/99, r. 1(8), as amended by O. Reg. 322/13, s. 1 and O. Reg. 298/18, s. 2)",
    effectiveFrom: "1999-09-15",
    effectiveTo: null,
    verificationSourceType: "REGULATION_REFERENCE_SUMMARY",
    verifiedDate: "2026-11-03",
    legalTestSummary: "Empowers the court to deal with a failure to obey an order in a case or a related case by making any order necessary for a just determination, including costs, dismissing a claim, striking documents, prohibiting use of undisclosed documents, postponing steps, or (on motion) a contempt order.",
    practiceNote: "Distinguish Rule 1(8) (failure to obey a court order) from Rule 1(8.1) (failure to follow the Family Law Rules, which excludes contempt under clause (g)). In child protection proceedings, courts exercise extreme caution before striking a parent's participation given the child's best interests."
  },
  {
    authorityId: "FLR:14(18)",
    citation: "Family Law Rules, O. Reg. 114/99, Rule 14(18)",
    instrument: "FAMILY_LAW_RULES",
    statuteTitle: FLR_TITLE,
    sectionKey: "14(18)",
    heading: "Affidavit evidence on motions — Information and belief",
    exactWording: "14 (18) An affidavit for use on a motion shall, as much as possible, contain only information within the personal knowledge of the person signing the affidavit, except as subrule (19) provides regarding information and belief.",
    sourceUrl: "https://www.ontario.ca/laws/regulation/990114#BK20",
    consolidationPeriod: "Consolidation period: In Force (O. Reg. 114/99; full text not bundled in local corpus)",
    effectiveFrom: "1999-09-15",
    effectiveTo: null,
    verificationSourceType: "REGULATION_REFERENCE_SUMMARY",
    verifiedDate: "2026-11-03",
    legalTestSummary: "Requires motion affidavits to contain personal firsthand knowledge as much as possible; under subrule 14(19), information and belief is permitted only if the source of the information and the fact that the affiant believes it to be true are stated.",
    practiceNote: "When an affidavit relies on secondhand information without identifying the source and stating belief in its truth, or relies on anonymous/double hearsay on contested issues, challenge its weight under Rule 14(18)-(19)."
  },
  {
    authorityId: "FLR:14(19)",
    citation: "Family Law Rules, O. Reg. 114/99, Rule 14(19)",
    instrument: "FAMILY_LAW_RULES",
    statuteTitle: FLR_TITLE,
    sectionKey: "14(19)",
    heading: "Affidavit evidence on motions — Information from other person",
    exactWording: "14 (19) The affidavit may also contain information that the person learned from someone else, but only if, (a) the source of the information is identified by name and the affidavit states that the person signing it believes the information is true; and (b) in addition, if the motion is a contempt motion under rule 31, the information is not likely to be disputed.",
    sourceUrl: "https://www.ontario.ca/laws/regulation/990114#BK20",
    consolidationPeriod: "Consolidation period: In Force (O. Reg. 114/99; full text not bundled in local corpus)",
    effectiveFrom: "1999-09-15",
    effectiveTo: null,
    verificationSourceType: "REGULATION_REFERENCE_SUMMARY",
    verifiedDate: "2026-11-03",
    legalTestSummary: "Permits secondhand information (information and belief) in a motion affidavit only if the source is identified by name and the affiant states a belief that the information is true.",
    practiceNote: "Even where formally admissible under Rule 14(19), uncorroborated hearsay on disputed central facts carries reduced evidentiary weight."
  },
  {
    authorityId: "FLR:33",
    citation: "Family Law Rules, O. Reg. 114/99, Rule 33",
    instrument: "FAMILY_LAW_RULES",
    statuteTitle: FLR_TITLE,
    sectionKey: "33",
    heading: "Child protection timetable and procedures",
    exactWording: "Rule 33 governs child protection proceedings and prescribed procedural timetables under the Family Law Rules, O. Reg. 114/99 (reference summary; full regulation text not bundled in local corpus).",
    sourceUrl: "https://www.ontario.ca/laws/regulation/990114",
    consolidationPeriod: "Consolidation period: In Force (O. Reg. 114/99; full text not bundled in local corpus)",
    effectiveFrom: "1999-09-15",
    effectiveTo: null,
    verificationSourceType: "REGULATION_REFERENCE_SUMMARY",
    verifiedDate: "2026-11-03",
    legalTestSummary: "Establishes the procedural timetable and filing rules for child protection cases in Ontario family court.",
    practiceNote: "Confirm current local practice directions and Rule 33 deadlines with counsel or the court office."
  },

  // ---------------------------------------------------------------------------
  // CHARTER PROVISIONS — Distinct category, never in CYFSA allowlist
  // ---------------------------------------------------------------------------
  {
    authorityId: "CHARTER:7",
    citation: "Canadian Charter of Rights and Freedoms, Section 7",
    instrument: "CHARTER",
    statuteTitle: CHARTER_TITLE,
    sectionKey: "7",
    heading: "Life, liberty and security of the person",
    exactWording: "7. Everyone has the right to life, liberty and security of the person and the right not to be deprived thereof except in accordance with the principles of fundamental justice.",
    sourceUrl: "https://laws-lois.justice.gc.ca/eng/const/page-12.html",
    consolidationPeriod: "Constitutional Law of Canada (in force April 17, 1982)",
    effectiveFrom: "1982-04-17",
    effectiveTo: null,
    verificationSourceType: "CONSTITUTIONAL_TEXT",
    verifiedDate: "2026-11-03",
    legalTestSummary: "Guarantees that state interference with parental custody and the parent-child bond engages security of the person and must accord with the principles of fundamental justice (New Brunswick (Minister of Health and Community Services) v. G. (J.), [1999] 3 S.C.R. 46).",
    practiceNote: "State-imposed child removal or access restriction requires a fair process and adherence to statutory safeguards."
  },
  {
    authorityId: "CHARTER:15",
    citation: "Canadian Charter of Rights and Freedoms, Section 15(1)",
    instrument: "CHARTER",
    statuteTitle: CHARTER_TITLE,
    sectionKey: "15",
    heading: "Equality before and under law and equal protection and benefit of law",
    exactWording: "15. (1) Every individual is equal before and under the law and has the right to the equal protection and equal benefit of the law without discrimination and, in particular, without discrimination based on race, national or ethnic origin, colour, religion, sex, age or mental or physical disability.",
    sourceUrl: "https://laws-lois.justice.gc.ca/eng/const/page-12.html",
    consolidationPeriod: "Constitutional Law of Canada (in force April 17, 1985)",
    effectiveFrom: "1985-04-17",
    effectiveTo: null,
    verificationSourceType: "CONSTITUTIONAL_TEXT",
    verifiedDate: "2026-11-03",
    legalTestSummary: "Protects equality before and under the law without discrimination based on enumerated or analogous grounds, including disability, race, and ethnic origin.",
    practiceNote: "Relevant where parenting assessments or service delivery fail to accommodate parental disability or cultural background."
  },
  {
    authorityId: "CHARTER:24(1)",
    citation: "Canadian Charter of Rights and Freedoms, Section 24(1)",
    instrument: "CHARTER",
    statuteTitle: CHARTER_TITLE,
    sectionKey: "24(1)",
    heading: "Enforcement of guaranteed rights and freedoms",
    exactWording: "24. (1) Anyone whose rights or freedoms, as guaranteed by this Charter, have been infringed or denied may apply to a court of competent jurisdiction to obtain such remedy as the court considers appropriate and just in the circumstances.",
    sourceUrl: "https://laws-lois.justice.gc.ca/eng/const/page-12.html",
    consolidationPeriod: "Constitutional Law of Canada (in force April 17, 1982)",
    effectiveFrom: "1982-04-17",
    effectiveTo: null,
    verificationSourceType: "CONSTITUTIONAL_TEXT",
    verifiedDate: "2026-11-03",
    legalTestSummary: "Authorizes an individual whose Charter rights or freedoms (such as s. 7 security of the person or s. 15 equality) have been infringed or denied by state action to apply to a court of competent jurisdiction for an appropriate and just remedy.",
    practiceNote: "Section 24(1) is a remedial provision, not an independent substantive right; it requires proving an infringement of a substantive Charter guarantee (such as s. 7 or s. 15) before a court with statutory jurisdiction over the parties, subject matter, and remedy sought."
  },

  // ---------------------------------------------------------------------------
  // ONTARIO CHILD PROTECTION STANDARDS (2016) — Ministry operational standards
  // Distinct category (CAS_STANDARD), never placed in INTERNAL_CYFSA_SECTION_KEYS.
  // Explicitly distinguishes mandatory Standard text from Practice Notes.
  // ---------------------------------------------------------------------------
  {
    authorityId: "OCPS:ALL_PHASES",
    citation: "Ontario Child Protection Standards (2016), Standards for All Phases of Child Protection Service Delivery",
    instrument: "CAS_STANDARD",
    statuteTitle: "Ontario Child Protection Standards (2016) (Ministry of Children, Community and Social Services)",
    sectionKey: "ALL_PHASES",
    heading: "Standards for All Phases — Family-Centred Service, Cultural & Religious Considerations, Contemporaneous Case Notes, and Supervision",
    exactWording: "Standards for All Phases of Child Protection Service Delivery (effective February 1, 2016; originally issued under the former Child and Family Services Act, R.S.O. 1990, c. C.11 and continued as operative ministry standards under CYFSA s. 35(2) and O. Reg. 156/18): (A) Child and Family Engagement and Participation; (B) Service to First Nations, Inuit and Métis Children and Families; (C) Anti-Oppressive Practice, Diversity and Inclusion; (D) French Language Services; (E) Alternative Dispute Resolution; (F) Differential Response; (G) Documentation and Contemporaneous Case Notes (requiring objective, factual, contemporaneous recording of date/time, method of contact, participants, significant discussions, observations, worker identity, date of note creation, supervisory consultations, and non-obliterating addenda); (H) Supervisory Consultation and Approval.",
    sourceUrl: "https://www.ontario.ca/page/ontario-child-protection-standards-2016",
    consolidationPeriod: "Effective February 1, 2016 to Present (issued under former CFSA; operative under CYFSA s. 35(2) / O. Reg. 156/18)",
    effectiveFrom: "2016-02-01",
    effectiveTo: null,
    verificationSourceType: "MINISTRY_STANDARD_SUMMARY",
    verifiedDate: "2026-11-03",
    legalTestSummary: "Establishes mandatory operational standards across all phases of child protection service delivery, including family engagement, contemporaneous case-note documentation, and supervisory consultation.",
    practiceNote: "Always distinguish text labeled 'Standard' (mandatory agency operational requirement) from 'Practice Notes' (professional guidance without the same mandatory force). Note that the 2016 Standards contain historical references to the former CFSA; current statutory authority derives from CYFSA s. 35(2) and O. Reg. 156/18."
  },
  {
    authorityId: "OCPS:STD_1",
    citation: "Ontario Child Protection Standards (2016), Standard 1 (Receipt of Report or Referral)",
    instrument: "CAS_STANDARD",
    statuteTitle: "Ontario Child Protection Standards (2016) (Ministry of Children, Community and Social Services)",
    sectionKey: "STD_1",
    heading: "Standard 1 — Receipt of Report or Referral and Eligibility Spectrum Screening",
    exactWording: "Standard 1 (Receipt of Report or Referral): The society shall receive and screen all reports and referrals concerning children who may be in need of protection using the Ontario Child Welfare Eligibility Spectrum, check prior agency/provincial child welfare history within 24 hours, determine response time (12 hours for immediate/extremely severe or 7 days for moderately severe), and obtain supervisory approval for the screening disposition.",
    sourceUrl: "https://www.ontario.ca/page/ontario-child-protection-standards-2016",
    consolidationPeriod: "Effective February 1, 2016 to Present",
    effectiveFrom: "2016-02-01",
    effectiveTo: null,
    verificationSourceType: "MINISTRY_STANDARD_SUMMARY",
    verifiedDate: "2026-11-03",
    legalTestSummary: "Requires Eligibility Spectrum screening, 24-hour child welfare history check, assignment of response priority (12 hours or 7 days), and supervisory approval of screening disposition.",
    practiceNote: "Separate the mandatory Standard requirements from Practice Notes on intake interviewing."
  },
  {
    authorityId: "OCPS:STD_2",
    citation: "Ontario Child Protection Standards (2016), Standard 2 (Planning and Conducting a Child Protection Investigation)",
    instrument: "CAS_STANDARD",
    statuteTitle: "Ontario Child Protection Standards (2016) (Ministry of Children, Community and Social Services)",
    sectionKey: "STD_2",
    heading: "Standard 2 — Planning and Conducting a Child Protection Investigation",
    exactWording: "Standard 2 (Planning and Conducting a Child Protection Investigation): The child protection worker shall develop an investigation plan in consultation with a supervisor (including whether a customized or traditional investigative response applies, Joint Police-CAS Protocol considerations, and FNIM band/community notice/consultation), conduct face-to-face interviews with the victim child, siblings, parents/caregivers, and collaterals, observe the home environment where relevant, and document supervisory approval for any departure from required response times.",
    sourceUrl: "https://www.ontario.ca/page/ontario-child-protection-standards-2016",
    consolidationPeriod: "Effective February 1, 2016 to Present",
    effectiveFrom: "2016-02-01",
    effectiveTo: null,
    verificationSourceType: "MINISTRY_STANDARD_SUMMARY",
    verifiedDate: "2026-11-03",
    legalTestSummary: "Mandates pre-investigation planning, face-to-face child and caregiver interviews, collateral verification, and supervisory consultation/approval for departures from response timeframes.",
    practiceNote: "Check whether the investigative record documents interviews with both parents and relevant neutral collaterals, or whether a one-sided account was accepted without verification."
  },
  {
    authorityId: "OCPS:STD_3",
    citation: "Ontario Child Protection Standards (2016), Standard 3 (Assessing Safety)",
    instrument: "CAS_STANDARD",
    statuteTitle: "Ontario Child Protection Standards (2016) (Ministry of Children, Community and Social Services)",
    sectionKey: "STD_3",
    heading: "Standard 3 — Assessing Immediate Child Safety and Safety Plans",
    exactWording: "Standard 3 (Assessing Safety): The worker shall conduct an initial Safety Assessment at the first face-to-face contact with the child and family. Where immediate safety threats are identified, the worker shall develop a least-intrusive Safety Plan in collaboration with the family and extended network where safe to do so, assess the feasibility and reliability of safety-plan participants, and obtain immediate supervisory approval of the Safety Assessment and Safety Plan.",
    sourceUrl: "https://www.ontario.ca/page/ontario-child-protection-standards-2016",
    consolidationPeriod: "Effective February 1, 2016 to Present",
    effectiveFrom: "2016-02-01",
    effectiveTo: null,
    verificationSourceType: "MINISTRY_STANDARD_SUMMARY",
    verifiedDate: "2026-11-03",
    legalTestSummary: "Requires a formal Safety Assessment at first face-to-face contact, collaborative consideration of in-home or kinship safety-plan interventions before removal where safe, and immediate supervisory approval.",
    practiceNote: "Examine whether an in-home or family-network safety plan was evaluated and documented under Standard 3 before removal."
  },
  {
    authorityId: "OCPS:STD_4",
    citation: "Ontario Child Protection Standards (2016), Standard 4 (Assessing Risk of Future Harm)",
    instrument: "CAS_STANDARD",
    statuteTitle: "Ontario Child Protection Standards (2016) (Ministry of Children, Community and Social Services)",
    sectionKey: "STD_4",
    heading: "Standard 4 — Actuarial Risk Assessment prior to Investigation Conclusion",
    exactWording: "Standard 4 (Assessing Risk): Prior to concluding a child protection investigation or transferring a case to ongoing services, the worker shall complete the prescribed Risk Assessment tool evaluating future risk of maltreatment, clinical factors, and family strengths/protective capacities, and obtain supervisory review and approval.",
    sourceUrl: "https://www.ontario.ca/page/ontario-child-protection-standards-2016",
    consolidationPeriod: "Effective February 1, 2016 to Present",
    effectiveFrom: "2016-02-01",
    effectiveTo: null,
    verificationSourceType: "MINISTRY_STANDARD_SUMMARY",
    verifiedDate: "2026-11-03",
    legalTestSummary: "Requires completion and supervisory approval of the standardized Risk Assessment tool before concluding an investigation or transferring to ongoing service.",
    practiceNote: "Distinguish immediate safety threats (Standard 3) from actuarial/clinical risk of future harm (Standard 4)."
  },
  {
    authorityId: "OCPS:STD_5",
    citation: "Ontario Child Protection Standards (2016), Standard 5 (Concluding a Child Protection Investigation)",
    instrument: "CAS_STANDARD",
    statuteTitle: "Ontario Child Protection Standards (2016) (Ministry of Children, Community and Social Services)",
    sectionKey: "STD_5",
    heading: "Standard 5 — Verification Decision and Concluding Investigation (45-Day Standard)",
    exactWording: "Standard 5 (Concluding a Child Protection Investigation): The worker shall reach a verification decision (verified, not verified, or inconclusive) based on a balance of probabilities (credible and probable evidence), determine the investigation disposition, complete investigation documentation within 45 days of referral (unless a supervisor approves a documented extension), obtain supervisory approval, and notify the parents and age-appropriate child of the outcome and reasons.",
    sourceUrl: "https://www.ontario.ca/page/ontario-child-protection-standards-2016",
    consolidationPeriod: "Effective February 1, 2016 to Present",
    effectiveFrom: "2016-02-01",
    effectiveTo: null,
    verificationSourceType: "MINISTRY_STANDARD_SUMMARY",
    verifiedDate: "2026-11-03",
    legalTestSummary: "Requires an evidence-based verification decision, completion within 45 days (absent supervisor-approved extension), supervisory sign-off, and notice of outcome and reasons to the family.",
    practiceNote: "A verification decision by CAS is an internal administrative determination under Standard 5, NOT a judicial finding under CYFSA s. 74(2)."
  },
  {
    authorityId: "OCPS:STD_6",
    citation: "Ontario Child Protection Standards (2016), Standard 6 (Transferring a Case)",
    instrument: "CAS_STANDARD",
    statuteTitle: "Ontario Child Protection Standards (2016) (Ministry of Children, Community and Social Services)",
    sectionKey: "STD_6",
    heading: "Standard 6 — Case Transfer to Ongoing Services or Another Society",
    exactWording: "Standard 6 (Transferring a Case): When a case is transferred from investigation to ongoing services (or between workers/societies), a transfer conference/meeting involving the transferring worker, receiving worker, supervisor(s), and the family (where appropriate) shall occur, and transfer documentation shall be completed and approved by the supervisor.",
    sourceUrl: "https://www.ontario.ca/page/ontario-child-protection-standards-2016",
    consolidationPeriod: "Effective February 1, 2016 to Present",
    effectiveFrom: "2016-02-01",
    effectiveTo: null,
    verificationSourceType: "MINISTRY_STANDARD_SUMMARY",
    verifiedDate: "2026-11-03",
    legalTestSummary: "Governs structured handoff, family involvement in transfer conferencing, and supervisory approval when transferring a file into ongoing child protection services.",
    practiceNote: "The date of investigation completion or case transfer under Standards 5–6 triggers the 30-day deadline for the initial Ongoing Service Plan under Standard 7."
  },
  {
    authorityId: "OCPS:STD_7",
    citation: "Ontario Child Protection Standards (2016), Standard 7 (Ongoing Service Case Management)",
    instrument: "CAS_STANDARD",
    statuteTitle: "Ontario Child Protection Standards (2016) (Ministry of Children, Community and Social Services)",
    sectionKey: "STD_7",
    heading: "Standard 7 — Ongoing Service Case Management, 30-Day Service Plan, Monitoring, and Reunification Review",
    exactWording: "Standard 7 (Ongoing Service Case Management): Within 30 days of completion of the investigation or case transfer to ongoing services, the worker shall complete a Family and Child Strengths and Needs Assessment and develop an initial written Service Plan in collaboration with the parents, child (as age-appropriate), extended family/community, and FNIM representatives where applicable. The Service Plan must specify clear protection outcomes, specific activities, responsible persons (parent, worker, community provider), completion timeframes, and concrete service referrals. The worker shall conduct at least monthly face-to-face contact with the child and parents (including home visits), coordinate and monitor service accessibility and progress, conduct formal reassessments and Service Plan reviews at least every 6 months (or upon a significant change in circumstances), evaluate reunification readiness and concurrent planning where the child is out of home, and obtain supervisory review and approval.",
    sourceUrl: "https://www.ontario.ca/page/ontario-child-protection-standards-2016",
    consolidationPeriod: "Effective February 1, 2016 to Present",
    effectiveFrom: "2016-02-01",
    effectiveTo: null,
    verificationSourceType: "MINISTRY_STANDARD_SUMMARY",
    verifiedDate: "2026-11-03",
    legalTestSummary: "Mandates an initial written Service Plan and Strengths-and-Needs Assessment within 30 days of investigation completion or case transfer (NOT measured from removal date alone), parent participation, clear goals/responsibilities/timeframes, active referral coordination, monthly home/face-to-face contact, 6-month formal case reviews, reunification assessment, and supervisory sign-off.",
    practiceNote: "If the investigation completion date or case transfer date is not documented in the uploaded record, the 30-day Standard 7 service-plan deadline is DEADLINE_NOT_DETERMINABLE and must never be fabricated from the apprehension date alone."
  },
  {
    authorityId: "OCPS:STD_8",
    citation: "Ontario Child Protection Standards (2016), Standard 8 (Ending Child Protection Services)",
    instrument: "CAS_STANDARD",
    statuteTitle: "Ontario Child Protection Standards (2016) (Ministry of Children, Community and Social Services)",
    sectionKey: "STD_8",
    heading: "Standard 8 — Ending Child Protection Services and Case Closure",
    exactWording: "Standard 8 (Ending Child Protection Services): Before closing an ongoing child protection case, the worker shall conduct a final safety and risk evaluation, review service-plan outcomes with the family, link the family to ongoing community supports where desired, notify the family in writing of case closure, and obtain supervisory approval.",
    sourceUrl: "https://www.ontario.ca/page/ontario-child-protection-standards-2016",
    consolidationPeriod: "Effective February 1, 2016 to Present",
    effectiveFrom: "2016-02-01",
    effectiveTo: null,
    verificationSourceType: "MINISTRY_STANDARD_SUMMARY",
    verifiedDate: "2026-11-03",
    legalTestSummary: "Requires a final safety/risk review, transition to community supports, family notification, and supervisory approval prior to ending ongoing child protection services.",
    practiceNote: "Compare documented exit criteria in the Society's Plan of Care (CYFSA s. 100(b)) against the Standard 8 closure criteria."
  },

  // ---------------------------------------------------------------------------
  // OCSWSSW PROFESSIONAL STANDARDS — Social Work and Social Service Work Act, 1998
  // Distinct category (PROFESSIONAL_STANDARD), applicable ONLY where registration is verified.
  // ---------------------------------------------------------------------------
  {
    authorityId: "OCSWSSW:REGISTRATION",
    citation: "Social Work and Social Service Work Act, 1998, S.O. 1998, c. 31, ss. 46–47 & OCSWSSW Code of Ethics",
    instrument: "PROFESSIONAL_STANDARD",
    statuteTitle: "Social Work and Social Service Work Act, 1998, S.O. 1998, c. 31",
    sectionKey: "REGISTRATION",
    heading: "OCSWSSW Registration Scope and Restricted Titles (RSW / RSSW)",
    exactWording: "Under the Social Work and Social Service Work Act, 1998, S.O. 1998, c. 31, ss. 46–47, only individuals registered with the Ontario College of Social Workers and Social Service Workers (OCSWSSW) may use the title 'social worker', 'registered social worker' (RSW), 'social service worker', or 'registered social service worker' (RSSW) or hold themselves out as such. OCSWSSW professional discipline and standards apply to registered members of the College.",
    sourceUrl: "https://www.ontario.ca/laws/statute/98s31",
    consolidationPeriod: "In Force (S.O. 1998, c. 31)",
    effectiveFrom: "2000-08-15",
    effectiveTo: null,
    verificationSourceType: "PROFESSIONAL_REGULATORY_STANDARD",
    verifiedDate: "2026-11-03",
    legalTestSummary: "Establishes that OCSWSSW regulatory jurisdiction, Code of Ethics, and Standards of Practice apply to registered members (RSW / RSSW) or individuals unlawfully holding themselves out as registered social workers / social service workers.",
    practiceNote: "Do NOT assume every CAS child protection worker is a registered social worker (RSW) or registered social service worker (RSSW); always verify registration on the public OCSWSSW Online Register first."
  },
  {
    authorityId: "OCSWSSW:PRIN_IV_RECORDS",
    citation: "OCSWSSW Code of Ethics and Standards of Practice, Principle IV (The Social Work and Social Service Work Record)",
    instrument: "PROFESSIONAL_STANDARD",
    statuteTitle: "OCSWSSW Code of Ethics and Standards of Practice (Second Edition)",
    sectionKey: "PRIN_IV_RECORDS",
    heading: "Principle IV — Professional Record-Keeping, Contemporaneous Recording, and Late Entries",
    exactWording: "OCSWSSW Standards of Practice, Principle IV (The Social Work and Social Service Work Record): College members must maintain clear, accurate, objective, and contemporaneous records of professional interventions, distinguish direct observations from third-party reports or professional opinions, identify the author and date of each entry, and never obliterate or backdate existing entries (any subsequent correction or addendum must be dated and signed as a late addition while preserving the original entry).",
    sourceUrl: "https://www.ocswssw.org/professional-practice/code-of-ethics-and-standards-of-practice/",
    consolidationPeriod: "In Force (OCSWSSW Standards of Practice)",
    effectiveFrom: "2008-09-01",
    effectiveTo: null,
    verificationSourceType: "PROFESSIONAL_REGULATORY_STANDARD",
    verifiedDate: "2026-11-03",
    legalTestSummary: "Requires OCSWSSW registrants (RSW/RSSW) to keep objective, contemporaneous records, separate fact from opinion, record entry dates, and make corrections only via dated addenda without altering original records.",
    practiceNote: "Applies where the worker or supervisor is a registered member of the OCSWSSW; operates alongside Ontario Child Protection Standards (2016) Standard G (Contemporaneous Case Notes)."
  },

  // ---------------------------------------------------------------------------
  // OVERSIGHT & REGULATIONS — Ombudsman Act & O. Reg. 155/18 / O. Reg. 156/18
  // ---------------------------------------------------------------------------
  {
    authorityId: "OVERSIGHT:OMBUDSMAN",
    citation: "Ombudsman Act, R.S.O. 1990, c. O.6, ss. 14(1.1), 14.0.1 (Children and Youth Unit)",
    instrument: "OVERSIGHT_PATHWAY",
    statuteTitle: "Ombudsman Act, R.S.O. 1990, c. O.6",
    sectionKey: "OMBUDSMAN",
    heading: "Ontario Ombudsman Oversight of Children's Aid Societies",
    exactWording: "Under the Ombudsman Act, R.S.O. 1990, c. O.6, ss. 14(1.1) and 14.0.1 (effective May 1, 2019, transferring investigative functions of the former Provincial Advocate for Children and Youth, and reinforced by CYFSA ss. 9.1 and 15.1), the Ontario Ombudsman has jurisdiction to investigate administrative conduct of children's aid societies and residential licensees regarding services sought or provided to children, young persons, and families.",
    sourceUrl: "https://www.ontario.ca/laws/statute/90o06",
    consolidationPeriod: "CAS oversight in force May 1, 2019 to Present (S.O. 2018, c. 17, Sched. 28)",
    effectiveFrom: "2019-05-01",
    effectiveTo: null,
    verificationSourceType: "REGULATION_REFERENCE_SUMMARY",
    verifiedDate: "2026-11-03",
    legalTestSummary: "Authorizes the Ontario Ombudsman to investigate administrative fairness, procedural failures, and systemic conduct of children's aid societies and residential licensees.",
    practiceNote: "The Ombudsman investigates administrative conduct and makes recommendations; the Ombudsman cannot act as legal counsel, adjudicate child protection proceedings, or overturn a court order."
  },
  {
    authorityId: "O_REG_155_18:COMPLAINTS",
    citation: "O. Reg. 155/18 (General Matters under the Authority of the LGIC), Complaints and Reviews",
    instrument: "REGULATION",
    statuteTitle: "O. Reg. 155/18 under the Child, Youth and Family Services Act, 2017",
    sectionKey: "155/18",
    heading: "Regulatory Timelines for CAS Internal Complaint Review Panel (ICRP) and CFSRB Reviews",
    exactWording: "Under O. Reg. 155/18 (made under the CYFSA, effective April 30, 2018), when a society receives a written complaint under CYFSA s. 119(1), it must determine eligibility and notify the complainant in writing within 7 days, convene an Internal Complaint Review Panel (ICRP) meeting within 14 days of confirming eligibility where sent to the panel, and issue a written summary of results within 14 days after the meeting.",
    sourceUrl: "https://www.ontario.ca/laws/regulation/180155",
    consolidationPeriod: "In force April 30, 2018 to Present (O. Reg. 155/18)",
    effectiveFrom: "2018-04-30",
    effectiveTo: null,
    verificationSourceType: "REGULATION_REFERENCE_SUMMARY",
    verifiedDate: "2026-11-03",
    legalTestSummary: "Prescribes the mandatory 7-day eligibility notice, 14-day ICRP hearing window, and 14-day post-meeting written decision timeline for internal CAS complaints under CYFSA s. 119.",
    practiceNote: "If the society misses these regulatory timeframes, the complainant may apply directly to the CFSRB under CYFSA s. 120(4), para. 2."
  },
  {
    authorityId: "O_REG_156_18:STANDARDS",
    citation: "O. Reg. 156/18 (General Matters under the Authority of the Minister), Child Protection Standards",
    instrument: "REGULATION",
    statuteTitle: "O. Reg. 156/18 under the Child, Youth and Family Services Act, 2017",
    sectionKey: "156/18",
    heading: "Prescribed Child Protection Standards and Eligibility Spectrum",
    exactWording: "Under O. Reg. 156/18 (made under the CYFSA, effective April 30, 2018), every children's aid society is required to use the Ontario Child Welfare Eligibility Spectrum and comply with the Ontario Child Protection Standards (2016) in performing its functions under CYFSA s. 35.",
    sourceUrl: "https://www.ontario.ca/laws/regulation/180156",
    consolidationPeriod: "In force April 30, 2018 to Present (O. Reg. 156/18)",
    effectiveFrom: "2018-04-30",
    effectiveTo: null,
    verificationSourceType: "REGULATION_REFERENCE_SUMMARY",
    verifiedDate: "2026-11-03",
    legalTestSummary: "Prescribes the Ontario Child Protection Standards (2016) and the Ontario Child Welfare Eligibility Spectrum as mandatory regulatory standards for children's aid societies under CYFSA s. 35(2).",
    practiceNote: "Provides the regulatory bridge making the 2016 Standards legally binding on societies under CYFSA s. 35(2)."
  },
];

/**
 * Authoritative verified provisions registry.
 * Keyed by canonical category-prefixed authorityId (e.g. "CYFSA:88", "FLR:1(8)", "FLR:14(18)", "CHARTER:7", "CHARTER:24(1)")
 * as well as backwards-compatible section aliases for CYFSA and core rules.
 */
export const VERIFIED_AUTHORITIES_REGISTRY: Record<string, VerifiedAuthorityEntry> = {};

for (const entry of CORE_AUTHORITIES) {
  entry.id = entry.authorityId;
  entry.category = entry.instrument;
  VERIFIED_AUTHORITIES_REGISTRY[entry.authorityId] = entry;
  if (entry.instrument === "CYFSA") {
    VERIFIED_AUTHORITIES_REGISTRY[entry.sectionKey] = entry;
  }
}
// Backwards-compatible aliases used by existing callers/tests
VERIFIED_AUTHORITIES_REGISTRY["125"] = VERIFIED_AUTHORITIES_REGISTRY["CYFSA:125(1)"];
VERIFIED_AUTHORITIES_REGISTRY["FLR_1_8"] = VERIFIED_AUTHORITIES_REGISTRY["FLR:1(8)"];
VERIFIED_AUTHORITIES_REGISTRY["FLR_14_18"] = VERIFIED_AUTHORITIES_REGISTRY["FLR:14(18)"];
VERIFIED_AUTHORITIES_REGISTRY["FLR_14_19"] = VERIFIED_AUTHORITIES_REGISTRY["FLR:14(19)"];
VERIFIED_AUTHORITIES_REGISTRY["CHARTER_7"] = VERIFIED_AUTHORITIES_REGISTRY["CHARTER:7"];
VERIFIED_AUTHORITIES_REGISTRY["CHARTER_15"] = VERIFIED_AUTHORITIES_REGISTRY["CHARTER:15"];
VERIFIED_AUTHORITIES_REGISTRY["CHARTER_24_1"] = VERIFIED_AUTHORITIES_REGISTRY["CHARTER:24(1)"];
VERIFIED_AUTHORITIES_REGISTRY["CHARTER:24"] = VERIFIED_AUTHORITIES_REGISTRY["CHARTER:24(1)"];
VERIFIED_AUTHORITIES_REGISTRY["BILL_C92:10"] = VERIFIED_AUTHORITIES_REGISTRY["BILL_C92:10(1)"];
VERIFIED_AUTHORITIES_REGISTRY["BILL_C92:12"] = VERIFIED_AUTHORITIES_REGISTRY["BILL_C92:12(1)"];
VERIFIED_AUTHORITIES_REGISTRY["BILL_C92:14"] = VERIFIED_AUTHORITIES_REGISTRY["BILL_C92:14(1)"];
VERIFIED_AUTHORITIES_REGISTRY["BILL_C92:16"] = VERIFIED_AUTHORITIES_REGISTRY["BILL_C92:16(1)"];

export const VERIFIED_STATUTORY_PROVISIONS = VERIFIED_AUTHORITIES_REGISTRY;

/**
 * Normalizes periods inside statutory abbreviations ("s.", "ss.", "sec.", "sub.", "para.", "r.", "c.", "O.", "S.", "Reg.", "Sched.")
 * so clause-level regexes that stop at sentence boundaries (`.` or `;`) do not prematurely stop at `s. 81(7)`.
 */
function normalizeClauseAbbreviations(input: string): string {
  return input.replace(/\b(s|ss|sec|sub|subs|para|r|c|O|S|R|Reg|Sched)\./gi, "$1 ");
}

/**
 * Authority-specific proposition evaluator for CYFSA s. 102 / s. 102(1).
 * Distinguishes accurate comparisons between a custody order under s. 102(1) and a supervision order
 * under s. 101(1), para. 1 from false propositions that attribute a supervision order to s. 102.
 */
function evaluateSection102Proposition(prop: string): { misapplied: boolean; reason: string } {
  const reason =
    "CYFSA s. 102(1) governs custody orders (deemed parenting/contact orders under CLRA s. 28) granted instead of an order under s. 101(1). Supervision orders are governed by CYFSA s. 101(1), para. 1 (and s. 94(2)(b)-(c) on adjournment or s. 116(1)(a) on status review).";
  const norm = normalizeClauseAbbreviations(prop);

  // 1. Direct nominal attachment of a supervision order to s. 102 / s. 102(1)
  if (
    /\b102(?:\(\d+\))?\s+(?:society\s+|temporary\s+|final\s+)?supervision\s+order\b|\bsupervision\s+order(?:s)?\s*\(\s*(?:CYFSA\s*,?\s*)?(?:s(?:ec(?:tion)?)?\s*|subsection\s+)?102(?:\(\d+\))?\s*\)|\bsupervision\s+order(?:s)?\s+(?:under|pursuant\s+to|in|per|by\s+virtue\s+of|governed\s+by)\s+(?:the\s+)?(?:CYFSA\s*,?\s*)?(?:s(?:ec(?:tion)?)?\s*|subsection\s+)?102(?:\(\d+\))?(?!\w)/i.test(
      norm
    )
  ) {
    return { misapplied: true, reason };
  }

  // 2. Clause-level predicate where s. 102 is the subject or governing prepositional phrase of authorizing/making/governing a supervision order
  // (Catches "Instead of s. 101(1), CYFSA s. 102(1) authorizes a supervision order" and "Under s. 102(1), the court may make a supervision order instead of a custody order")
  if (
    /(?:(?:under|pursuant\s+to|in|per)\s+)?(?:CYFSA\s*,?\s*)?(?:s(?:ec(?:tion)?)?\s*|subsection\s+)102(?:\(\d+\))?(?:(?!\b(?:instead\s+of|rather\s+than|as\s+opposed\s+to|unlike|whereas|while|distinguished\s+from|distinct\s+from)\b)[^.;])*?\b(?:governs?|authorizes?|provides?\s+for|permits?|is\s+(?:a\s+)?|makes?\s+(?:a\s+)?|made\s+(?:a\s+)?|grants?\s+(?:a\s+)?|granted\s+(?:a\s+)?|imposes?\s+(?:a\s+)?|orders?\s+(?:a\s+)?|places?\s+[^.;]{1,35}\bunder\s+(?:a\s+)?)(?:an?\s+|temporary\s+|final\s+|society\s+|\d+-month\s+)?supervision\s+order\b/i.test(
      norm
    )
  ) {
    return { misapplied: true, reason };
  }

  // 3. Conjoined attribution claiming s. 102 grants/authorizes both custody and supervision orders without attributing supervision to s. 101/94/116
  if (
    /\b102(?:\(\d+\))?(?:(?!\b(?:instead\s+of|rather\s+than|as\s+opposed\s+to|unlike|whereas|while)\b)[^.;])*?\b(?:custody\s+(?:order\s+)?(?:or|and)\s+(?:a\s+|society\s+)?supervision\s+order|supervision\s+(?:order\s+)?(?:or|and)\s+(?:a\s+)?custody\s+order)\b/i.test(
      norm
    )
  ) {
    return { misapplied: true, reason };
  }

  // 4. Proposition discusses a supervision order without mentioning custody at all
  if (/\bsupervision\s+order\b/i.test(norm) && !/\bcustody\b/i.test(norm)) {
    return { misapplied: true, reason };
  }

  return { misapplied: false, reason };
}

/**
 * Authority-specific proposition evaluator for CYFSA s. 81(1), s. 81(2), and s. 81(7).
 * Distinguishes:
 * - s. 81(1): Society application to the court to determine whether a child is in need of protection;
 * - s. 81(2): Warrant to apprehend a child issued by a justice of the peace;
 * - s. 81(7): Warrantless apprehension by a child protection worker where there is substantial risk during the time needed for a s. 90(1) hearing or s. 81(2) warrant.
 */
function evaluateSection81Proposition(
  secKey: "81(1)" | "81(2)" | "81(7)",
  prop: string
): { misapplied: boolean; reason: string } {
  const norm = normalizeClauseAbbreviations(prop);

  if (secKey === "81(1)") {
    const reason =
      "CYFSA s. 81(1) merely authorizes a society to apply to the court to determine whether a child is in need of protection. A warrant to apprehend is governed by CYFSA s. 81(2), and warrantless apprehension requires meeting the three-part test in CYFSA s. 81(7).";

    // 1. Direct or conjoined attribution of warrantless apprehension or warrant issuance to s. 81(1)
    if (
      /\b(?:warrantless\s+apprehension|apprehend(?:ed|ing|s)?\s+(?:a\s+child\s+|the\s+child\s+)?without\s+a\s+warrant|remov(?:e|ed|ing|al)\s+(?:of\s+a\s+child\s+|the\s+child\s+)?without\s+a\s+warrant|emergency\s+warrantless\s+removal|warrant\s+to\s+apprehend|issu(?:e|ed|ing)\s+a\s+warrant)\s+(?:under|pursuant\s+to|in|per|by\s+virtue\s+of|governed\s+by|authorized\s+by)\s+(?:the\s+)?(?:CYFSA\s*,?\s*)?(?:s(?:ec(?:tion)?)?\s*|subsection\s+)?81\(1\)/i.test(
        norm
      ) ||
      /(?:(?:under|pursuant\s+to|in|per)\s+)?(?:CYFSA\s*,?\s*)?(?:s(?:ec(?:tion)?)?\s*|subsection\s+)81\(1\)(?:(?!\b(?:whereas|while|unlike|as\s+opposed\s+to|distinct\s+from|distinguish(?:ed|ing)?\s+from|rather\s+than|following|after|prior\s+to|and\s+not)\b|,\s*(?:and\s+|or\s+)?(?:under\s+|pursuant\s+to\s+)?(?:CYFSA\s*,?\s*)?(?:s(?:ec(?:tion)?)?\s*|subsection\s+)\d+)[^.;])*?\b(?:(?:authorizes?|governs?|permits?|empowers?|allows?|sets?\s+the\s+(?:test|threshold|standard)\s+for|conduct(?:ed|s|ing)?|made|effect(?:ed|s|ing)?|exercis(?:ed|es|ing)?|may\s+apprehend|apprehend(?:ed|s|ing)?)\s+(?:(?!\b(?:whereas|while|unlike|as\s+opposed\s+to|distinct\s+from|rather\s+than)\b|,\s*(?:and\s+|or\s+)?(?:under\s+|pursuant\s+to\s+)?(?:CYFSA\s*,?\s*)?(?:s(?:ec(?:tion)?)?\s*|subsection\s+)\d+)[^.;]){0,65}?\b(?:warrantless\s+apprehension|(?:apprehend|remove)(?:ing)?\s+(?:a\s+child\s+|the\s+child\s+)?without\s+a\s+warrant|without\s+a\s+warrant|issu(?:e|ing)\s+a\s+warrant\s+to\s+apprehend|substantial\s+risk\s+during\s+the\s+time\s+necessary|imminent\s+danger)|warrantless\s+apprehension\s+authority)/i.test(
        norm
      ) ||
      /\b81\(1\)\s+(?:warrantless\s+apprehension|apprehension\s+warrant|imminent\s+danger\s+test)\b/i.test(norm)
    ) {
      return { misapplied: true, reason };
    }

    // 2. Proposition discusses warrantless apprehension / imminent danger without identifying s. 81(7) as the warrantless apprehension authority
    const mentionsWarrantless =
      /\b(?:warrantless\s+apprehension|apprehend(?:ed|ing|s)?\s+(?:a\s+child\s+|the\s+child\s+)?without\s+a\s+warrant|remov(?:e|ed|ing)\s+(?:a\s+child\s+|the\s+child\s+)?without\s+a\s+warrant|substantial\s+risk\s+(?:to\s+the\s+child['’]?s\s+health\s+or\s+safety\s+)?during\s+the\s+time\s+necessary|imminent\s+danger)\b/i.test(
        norm
      );
    if (mentionsWarrantless) {
      const identifies81_7 = /\b81\(7\)|subsection\s*\(7\)/i.test(norm);
      const negates81_1Apprehension =
        /\b81\(1\)\b[^.;]*?\b(?:does\s+not|not)\s+(?:authorize|govern|permit)\s+(?:warrantless\s+)?apprehension/i.test(norm);
      if (!identifies81_7 && !negates81_1Apprehension) {
        return { misapplied: true, reason };
      }
    }

    // 3. Proposition discusses a warrant to apprehend issued by a justice of the peace without identifying s. 81(2)
    const mentionsWarrantIssuance =
      /\b(?:justice\s+of\s+the\s+peace\s+(?:may\s+)?issue(?:d|s)?\s+a\s+warrant|warrant\s+to\s+apprehend\s+(?:a\s+child|the\s+child))\b/i.test(
        norm
      );
    if (mentionsWarrantIssuance && !/\b81\(2\)|subsection\s*\(2\)/i.test(norm)) {
      return { misapplied: true, reason };
    }

    return { misapplied: false, reason };
  }

  if (secKey === "81(2)") {
    const reason =
      "CYFSA s. 81(2) governs warrants to apprehend a child issued by a justice of the peace where a less restrictive course of action is unavailable or inadequate. Warrantless apprehension by a worker is governed by CYFSA s. 81(7).";

    if (
      /\b(?:warrantless\s+apprehension|apprehend(?:ed|ing|s)?\s+(?:a\s+child\s+|the\s+child\s+)?without\s+a\s+warrant|remov(?:e|ed|ing)\s+(?:a\s+child\s+|the\s+child\s+)?without\s+a\s+warrant)\s+(?:under|pursuant\s+to|in|per|by\s+virtue\s+of|governed\s+by|authorized\s+by)\s+(?:the\s+)?(?:CYFSA\s*,?\s*)?(?:s(?:ec(?:tion)?)?\s*|subsection\s+)?81\(2\)/i.test(
        norm
      ) ||
      /(?:(?:under|pursuant\s+to|in|per)\s+)?(?:CYFSA\s*,?\s*)?(?:s(?:ec(?:tion)?)?\s*|subsection\s+)81\(2\)(?:(?!\b(?:whereas|while|unlike|as\s+opposed\s+to|distinct\s+from|distinguish(?:ed|ing)?\s+from|rather\s+than|instead\s+of|time\s+necessary\s+to)\b|,\s*(?:and\s+|or\s+)?(?:under\s+|pursuant\s+to\s+)?(?:CYFSA\s*,?\s*)?(?:s(?:ec(?:tion)?)?\s*|subsection\s+)\d+)[^.;])*?\b(?:authorizes?|governs?|permits?|empowers?|allows?|sets?\s+the\s+(?:test|threshold|standard)\s+for|conduct(?:ed|s|ing)?|made|may\s+apprehend|apprehend(?:ed|s|ing)?)\s+(?:(?!\b(?:whereas|while|unlike|as\s+opposed\s+to|distinct\s+from|rather\s+than)\b|,\s*(?:and\s+|or\s+)?(?:under\s+|pursuant\s+to\s+)?(?:CYFSA\s*,?\s*)?(?:s(?:ec(?:tion)?)?\s*|subsection\s+)\d+)[^.;]){0,65}?\b(?:warrantless\s+apprehension|(?:apprehend|remove)(?:ing)?\s+(?:a\s+child\s+|the\s+child\s+)?without\s+a\s+warrant|without\s+a\s+warrant)\b/i.test(
        norm
      )
    ) {
      return { misapplied: true, reason };
    }

    const mentionsWarrantless =
      /\b(?:warrantless\s+apprehension|apprehend(?:ed|ing|s)?\s+(?:a\s+child\s+|the\s+child\s+)?without\s+a\s+warrant|remov(?:e|ed|ing)\s+(?:a\s+child\s+|the\s+child\s+)?without\s+a\s+warrant)\b/i.test(
        norm
      );
    if (mentionsWarrantless && !/\b81\(7\)|subsection\s*\(7\)/i.test(norm)) {
      return { misapplied: true, reason };
    }

    return { misapplied: false, reason };
  }

  // secKey === "81(7)"
  const reason =
    "CYFSA s. 81(7) governs warrantless apprehension where there would be a substantial risk to the child's health or safety during the time necessary for a s. 90(1) hearing or to obtain a warrant under s. 81(2). Warrants to apprehend issued by a justice of the peace are governed by s. 81(2), and court applications are governed by s. 81(1).";

  if (
    /\b(?:warrant\s+to\s+apprehend|apprehension\s+warrant|justice\s+of\s+the\s+peace\s+(?:may\s+)?issue(?:d|s)?\s+a\s+warrant|issu(?:e|ed|ing)\s+a\s+warrant\s+to\s+apprehend)\s+(?:under|pursuant\s+to|in|per|by\s+virtue\s+of|governed\s+by|authorized\s+by)\s+(?:the\s+)?(?:CYFSA\s*,?\s*)?(?:s(?:ec(?:tion)?)?\s*|subsection\s+)?81\(7\)/i.test(
      norm
    ) ||
    /(?:(?:under|pursuant\s+to|in|per)\s+)?(?:CYFSA\s*,?\s*)?(?:s(?:ec(?:tion)?)?\s*|subsection\s+)81\(7\)(?:(?!\b(?:whereas|while|unlike|as\s+opposed\s+to|distinct\s+from|rather\s+than|instead\s+of|time\s+necessary\s+to|without\s+a\s+warrant)\b|,\s*(?:and\s+|or\s+)?(?:under\s+|pursuant\s+to\s+)?(?:CYFSA\s*,?\s*)?(?:s(?:ec(?:tion)?)?\s*|subsection\s+)\d+)[^.;])*?\b(?:(?:authorizes?|governs?|permits?|empowers?)\s+(?:a\s+)?(?:justice\s+of\s+the\s+peace\s+to\s+issue\s+a\s+warrant|issu(?:e|ing)\s+a\s+warrant\s+to\s+apprehend)|justice\s+of\s+the\s+peace\s+(?:may|can|shall)\s+issue\s+a\s+warrant\s+to\s+apprehend)\b/i.test(
      norm
    )
  ) {
    return { misapplied: true, reason };
  }

  if (
    /\b(?:apprehended\s+(?:pursuant\s+to|with)\s+a\s+warrant|justice\s+of\s+the\s+peace\s+(?:may\s+)?issue(?:d|s)?\s+a\s+warrant\s+to\s+apprehend)\b/i.test(
      norm
    ) &&
    !/\b81\(2\)|subsection\s*\(2\)|without\s+a\s+warrant|warrantless\b/i.test(norm)
  ) {
    return { misapplied: true, reason };
  }

  return { misapplied: false, reason };
}

/**
 * Authority-specific proposition evaluator for CYFSA s. 88, s. 94(1), and s. 94(5).
 * Distinguishes:
 * - s. 88: Mandatory 5-day deadline ("as soon as practicable, but in any event within five days") after a child is brought to a place of safety under s. 81, s. 83(1)(a)(ii), or s. 136(5) to bring the matter before a court for a s. 90(1) hearing, return the child, or make a s. 75(1)/s. 77 agreement;
 * - s. 94(1): Prohibition against adjourning a hearing for more than 30 days unless all parties present and the caregiver during the adjournment consent and no absent party is known to object;
 * - s. 94(5): Requirement to consider placement with a relative or extended-family/community member under s. 94(2)(c) before ordering temporary society custody under s. 94(2)(d).
 */
function evaluateSection88And94Proposition(
  secKey: "88" | "94(1)" | "94(5)",
  prop: string
): { misapplied: boolean; support?: PropositionSupportStatus; reason: string } {
  const norm = normalizeClauseAbbreviations(prop);

  if (secKey === "88") {
    const reason =
      "CYFSA s. 88 requires that as soon as practicable, and in any event within five days after a child is brought to a place of safety under s. 81, s. 83(1)(a)(ii), or s. 136(5), the matter be brought before a court for a s. 90(1) hearing, the child be returned, or a s. 75(1)/s. 77 agreement be made. Adjournments (30-day limit absent consent) are governed by CYFSA s. 94(1).";

    // 1. Direct attribution of the 30-day adjournment limit to s. 88
    if (
      /\b(?:30-day|thirty-day|30\s+days?)\s+adjournment\s+(?:limit|maximum|rule|period|cap)?\s*(?:under|pursuant\s+to|in|per|governed\s+by)\s+(?:the\s+)?(?:CYFSA\s*,?\s*)?(?:s(?:ec(?:tion)?)?\s*)?88\b/i.test(
        norm
      ) ||
      /(?:(?:under|pursuant\s+to|in|per)\s+)?(?:CYFSA\s*,?\s*)?(?:s(?:ec(?:tion)?)?\s*)88(?:(?!\b(?:whereas|while|unlike|as\s+opposed\s+to|distinct\s+from|after|following|and\s+then|subsequently)\b)[^.;])*?\b(?:shall\s+not\s+adjourn|adjourn(?:ed|ment|s)?\s+(?:a\s+hearing\s+)?(?:for\s+(?:more\s+than|up\s+to)|to)\s+30\s+days|limits?\s+adjournments?\s+to\s+30\s+days|governs?\s+(?:the\s+)?30-day\s+adjournment|sets?\s+(?:a\s+|the\s+)?30-day\s+adjournment)/i.test(
        norm
      )
    ) {
      return { misapplied: true, support: "IRRELEVANT_OR_MISAPPLIED", reason };
    }

    // 2. False statutory deadline claim attributed to s. 88 (e.g., claiming s. 88 allows 7, 10, 14, 15, 30, or 45 days to bring the matter to court)
    if (
      /\b(?:7|seven|10|ten|14|fourteen|15|fifteen|30|thirty|45|forty-five)-day\s+(?:post-apprehension|place\s+of\s+safety|initial|statutory)\s+hearing\s+(?:deadline|rule|requirement|limit)\s*(?:under|pursuant\s+to|in|per|governed\s+by)?\s*(?:the\s+)?(?:CYFSA\s*,?\s*)?(?:s(?:ec(?:tion)?)?\s*)?88\b/i.test(
        norm
      ) ||
      /(?:(?:under|pursuant\s+to|in|per)\s+)?(?:CYFSA\s*,?\s*)?(?:s(?:ec(?:tion)?)?\s*)88(?:(?!\b(?:whereas|while|unlike|breach|violat|exceed|contrary|late|overdue|instead\s+of\s+the\s+(?:mandatory\s+)?(?:5|five))\b)[^.;])*?\b(?:(?:requires?|mandates?|permits?|allows?|provides?\s+that|sets?\s+a\s+deadline\s+of|has\s+a)\s+[^.;]{0,65}?\b(?:within\s+(?:7|seven|10|ten|14|fourteen|15|fifteen|30|thirty|45|forty-five)\s+days|(?:7|seven|10|ten|14|fourteen|15|fifteen|30|thirty|45|forty-five)-day\s+(?:post-apprehension|place\s+of\s+safety|initial|statutory)?\s*hearing\s+deadline)|(?:matter|child)\s+(?:shall|must|may)\s+be\s+brought\s+before\s+a\s+court\s+within\s+(?:7|seven|10|ten|14|fourteen|15|fifteen|30|thirty|45|forty-five)\s+days)\b/i.test(
        norm
      )
    ) {
      return { misapplied: true, support: "CONTRADICTED_BY_STATUTE", reason };
    }

    // 3. Proposition is solely about the 30-day adjournment limit without mentioning the 5-day hearing or place of safety
    if (
      /\b(?:30-day|thirty-day)\s+adjournment\b|\badjourn(?:ed|ment)?\s+(?:a\s+hearing\s+)?for\s+more\s+than\s+30\s+days\b/i.test(
        norm
      ) &&
      !/\b(?:5-day|five-day|(?:5|five)\s+days|place\s+of\s+safety|post-apprehension|initial\s+hearing)\b/i.test(norm)
    ) {
      return { misapplied: true, support: "IRRELEVANT_OR_MISAPPLIED", reason };
    }

    return { misapplied: false, reason };
  }

  if (secKey === "94(1)") {
    const reason =
      "CYFSA s. 94(1) prohibits adjourning a hearing for more than 30 days unless all parties present and the caregiver during the adjournment consent and no absent party is known to object. It is NOT the 5-day post-apprehension hearing deadline, which is governed by CYFSA s. 88.";

    // 1. Direct attribution of the 5-day post-apprehension hearing deadline to s. 94(1)
    if (
      /\b(?:5-day|five-day|five\s+days?|5\s+days?)\s+(?:post-apprehension|place\s+of\s+safety|initial)?\s*hearing\s+(?:deadline|rule|requirement|limit|timeline)?\s*(?:under|pursuant\s+to|in|per|governed\s+by)\s+(?:the\s+)?(?:CYFSA\s*,?\s*)?(?:s(?:ec(?:tion)?)?\s*|subsection\s+)?94\(1\)/i.test(
        norm
      ) ||
      /(?:(?:under|pursuant\s+to|in|per)\s+)?(?:CYFSA\s*,?\s*)?(?:s(?:ec(?:tion)?)?\s*|subsection\s+)94\(1\)(?:(?!\b(?:whereas|while|unlike|as\s+opposed\s+to|distinct\s+from|after|following)\b)[^.;])*?\b(?:within\s+(?:5|five)\s+days\s+after\s+(?:a\s+child\s+is\s+)?(?:brought\s+to\s+a\s+place\s+of\s+safety|apprehen(?:ded|sion)|remov(?:ed|al))|governs?\s+the\s+(?:5-day|five-day)\s+(?:post-apprehension\s+)?hearing|(?:initial\s+|post-apprehension\s+)?hearing\s+(?:shall|must)\s+(?:occur|take\s+place|be\s+held)\s+within\s+(?:5|five)\s+days|(?:matter|child)\s+(?:shall|must)\s+be\s+brought\s+before\s+a\s+court\s+within\s+(?:5|five)\s+days)\b/i.test(
        norm
      )
    ) {
      return { misapplied: true, support: "IRRELEVANT_OR_MISAPPLIED", reason };
    }

    // 2. False statutory adjournment deadline or false consent rule attributed to s. 94(1)
    if (
      /\b(?:5|7|10|14|45|60|90)-day\s+(?:statutory\s+|maximum\s+)?adjournment\s+(?:limit|maximum|cap|rule)\s*(?:under|pursuant\s+to|in|per|governed\s+by)?\s*(?:the\s+)?(?:CYFSA\s*,?\s*)?(?:s(?:ec(?:tion)?)?\s*|subsection\s+)?94\(1\)/i.test(
        norm
      ) ||
      /(?:(?:under|pursuant\s+to|in|per)\s+)?(?:CYFSA\s*,?\s*)?(?:s(?:ec(?:tion)?)?\s*|subsection\s+)94\(1\)(?:(?!\b(?:breach|violat|exceed|contrary|unlawful|impermissibl|beyond\s+the\s+30-day)\b)[^.;])*?\b(?:(?:may|can|permits?\s+the\s+court\s+to)\s+adjourn\s+(?:a\s+(?:temporary\s+care\s+)?hearing\s+)?for\s+(?:up\s+to|more\s+than)\s+(?:45|60|90)\s+days\s+without\s+(?:all\s+parties['’]?\s+)?consent|shall\s+not\s+adjourn\s+(?:a\s+hearing\s+)?for\s+more\s+than\s+(?:5|7|10|14|45|60|90)\s+days|only\s+the\s+society['’]?s\s+consent\s+is\s+required\s+to\s+adjourn|even\s+if\s+an\s+absent\s+party\s+objects)\b/i.test(
        norm
      )
    ) {
      return { misapplied: true, support: "CONTRADICTED_BY_STATUTE", reason };
    }

    // 3. Proposition discusses the 5-day post-apprehension hearing without mentioning adjournment or the 30-day limit
    if (
      /\b(?:5-day|five-day|five\s+day|within\s+(?:5|five)\s+days|post-apprehension\s+hearing)\b/i.test(norm) &&
      !/\b(?:adjourn(?:ed|ment|s|ing)?|30-day|thirty-day|30\s+days)\b/i.test(norm)
    ) {
      return { misapplied: true, support: "IRRELEVANT_OR_MISAPPLIED", reason };
    }

    return { misapplied: false, reason };
  }

  // secKey === "94(5)"
  const reason =
    "CYFSA s. 94(5) requires the court to consider placement with a relative or extended-family/community member before ordering temporary society custody on adjournment. It is NOT the 5-day post-apprehension hearing deadline (governed by CYFSA s. 88) or the 30-day adjournment limit (governed by CYFSA s. 94(1)).";

  if (
    /\b(?:5-day|five-day|five\s+days?|5\s+days?|30-day|thirty-day|30\s+days?)\s+(?:post-apprehension\s+|initial\s+)?(?:hearing|adjournment)\s*(?:deadline|rule|requirement|limit|timeline)?\s*(?:under|pursuant\s+to|in|per|governed\s+by)?\s*(?:the\s+)?(?:CYFSA\s*,?\s*)?(?:s(?:ec(?:tion)?)?\s*|subsection\s+)?94\(5\)/i.test(
      norm
    ) ||
    (/\b(?:5-day|five-day|five\s+day|post-apprehension\s+hearing|within\s+(?:5|five)\s+days)\b/i.test(norm) &&
      !/\b(?:relative|extended\s+family|community)\b/i.test(norm))
  ) {
    return { misapplied: true, support: "IRRELEVANT_OR_MISAPPLIED", reason };
  }

  return { misapplied: false, reason };
}

/**
 * Known CYFSA sections that exist in the statute (sourceExists = true) but are frequently
 * misapplied to the wrong legal proposition in child protection filings or AI summaries.
 */
const KNOWN_MISAPPLIED_CYFSA_PROVISIONS: Record<
  string,
  { actualHeading: string; misappliedPattern: RegExp; reason: string }
> = {
  "125": {
    actualHeading: "CYFSA s. 125(1) (Duty to report suspicion)",
    misappliedPattern: /\b(?:proves?|establishes?|satisfies)\b.*\b(?:in need of protection|74\(2\)|removal|apprehension threshold)\b|\b(?:warrantless apprehension authority|proof of maltreatment)\b/i,
    reason:
      "CYFSA s. 125(1) sets the 'reasonable grounds to suspect' threshold for reporting to a society. It does NOT establish proof that a child is in need of protection under s. 74(2) or authorize removal under s. 81(7).",
  },
  "125(1)": {
    actualHeading: "CYFSA s. 125(1) (Duty to report suspicion)",
    misappliedPattern: /\b(?:proves?|establishes?|satisfies)\b.*\b(?:in need of protection|74\(2\)|removal|apprehension threshold)\b|\b(?:warrantless apprehension authority|proof of maltreatment)\b/i,
    reason:
      "CYFSA s. 125(1) sets the 'reasonable grounds to suspect' threshold for reporting to a society. It does NOT establish proof that a child is in need of protection under s. 74(2) or authorize removal under s. 81(7).",
  },
  "41": {
    actualHeading: "CYFSA s. 41 (Society-Minister accountability agreement)",
    misappliedPattern: /\b(?:right to counsel|legal representation|lawyer|duty counsel|OCL|Children's Lawyer)\b/i,
    reason:
      "CYFSA s. 41 governs financial accountability agreements between a society and the Minister. A child's legal representation in Part V proceedings is governed by CYFSA s. 78.",
  },
  "41(1)": {
    actualHeading: "CYFSA s. 41(1) (Society-Minister accountability agreement)",
    misappliedPattern: /\b(?:right to counsel|legal representation|lawyer|duty counsel|OCL|Children's Lawyer)\b/i,
    reason:
      "CYFSA s. 41(1) governs financial accountability agreements between a society and the Minister. A child's legal representation in Part V proceedings is governed by CYFSA s. 78.",
  },
  "51": {
    actualHeading: "CYFSA s. 51 (Transfer of charitable property)",
    misappliedPattern: /\b(?:plan of care|society's plan|care plan|remedial services)\b/i,
    reason:
      "CYFSA s. 51 governs gifts and trusts upon transfer of charitable property. The Society's written Plan of Care is governed by CYFSA s. 100 (and s. 13(1) for a child in care).",
  },
  "51(1)": {
    actualHeading: "CYFSA s. 51(1) (Transfer of charitable property)",
    misappliedPattern: /\b(?:plan of care|society's plan|care plan|remedial services)\b/i,
    reason:
      "CYFSA s. 51(1) governs gifts and trusts upon transfer of charitable property. The Society's written Plan of Care is governed by CYFSA s. 100 (and s. 13(1) for a child in care).",
  },
  "81(12)": {
    actualHeading: "CYFSA s. 81(12) (Peace officer powers under s. 81)",
    misappliedPattern: /\b(?:Crown liability|personal liability|immunity|midnight and 6 a\.m\.|loiter)\b/i,
    reason:
      "CYFSA s. 81(12) applies s. 81(2), (6), (7), (10), and (11) to a peace officer. Good-faith protection from personal liability is s. 81(13), and the warrantless power regarding an unaccompanied child under 16 in a public place between midnight and 6 a.m. is s. 136(5).",
  },
  "292": {
    actualHeading: "CYFSA s. 292 (Disclosure without consent)",
    misappliedPattern: /\b(?:parent(?:'s)? right of access|individual(?:'s)? right of access|right to access own records|request access to personal information)\b/i,
    reason:
      "CYFSA s. 292(1) governs when a service provider may disclose personal information WITHOUT consent (e.g. to law enforcement). An individual's right of access to records of personal information in a service provider's custody or control is governed by CYFSA s. 312(1).",
  },
  "292(1)": {
    actualHeading: "CYFSA s. 292(1) (Disclosure without consent)",
    misappliedPattern: /\b(?:parent(?:'s)? right of access|individual(?:'s)? right of access|right to access own records|request access to personal information)\b/i,
    reason:
      "CYFSA s. 292(1) governs when a service provider may disclose personal information WITHOUT consent. An individual's right of access to records of personal information is governed by CYFSA s. 312(1).",
  },
};

/**
 * Pattern detecting unsupported or statutorily contradicted propositions claiming that CAS has a
 * universal statutory duty to fund all services or that a court supervision order can require CAS
 * to provide financial assistance or purchase goods or services.
 */
const UNIVERSAL_FUNDING_CONTRADICTION_PATTERN =
  /\b(?:universal\s+(?:statutory\s+)?duty\s+to\s+(?:fund|pay\s+for|purchase)|must\s+(?:fund|pay\s+for|purchase)\s+all\s+(?:family\s+support\s+)?(?:goods\s+(?:or|and)\s+)?services|(?:court|supervision\s+order)\s+(?:can|may|shall|must)\s+(?:require|order|compel)\s+(?:the\s+)?(?:society|CAS)\s+to\s+(?:provide\s+financial\s+assistance|purchase\s+(?:any\s+|private\s+)?goods\s+(?:or|and)\s+services|fund\s+private\s+services))\b/i;

const isIsoDateString = (v: unknown): v is string =>
  typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v.trim()) && !Number.isNaN(Date.parse(v.trim()));

/**
 * Evaluates whether a cited authority supports, is misapplied to, or is contradicted by statute
 * with respect to a given legal proposition.
 */
export function evaluatePropositionSupport(
  sectionOrAuthorityKey: string,
  propositionText: string | null | undefined
): {
  support: PropositionSupportStatus;
  reason: string | null;
} {
  const prop = (propositionText || "").trim();
  if (!prop) {
    return { support: "NOT_EVALUATED", reason: null };
  }

  if (UNIVERSAL_FUNDING_CONTRADICTION_PATTERN.test(prop)) {
    return {
      support: "CONTRADICTED_BY_STATUTE",
      reason:
        "Contradicted by statute: While CYFSA s. 35(1)(c) and s. 101(2)-(3) address guidance, counselling, and pre-intervention assistance, CYFSA s. 94(6)(c) and s. 101(7)(c) (and s. 116(4)(c)) expressly state that court terms and conditions on a supervising society 'shall not require the society to provide financial assistance or to purchase any goods or services.'",
    };
  }

  // Milestone 2 adversarial proposition guards:
  // 1. CFSRB, Internal CAS Complaints (s. 119 / s. 120), or Ombudsman cannot overturn a court order or review issues decided by or before the court
  if (
    /\b(?:CFSRB|Child\s+and\s+Family\s+Services\s+Review\s+Board|Internal\s+Complaint\s+Review\s+Panel|ICRP|Ombudsman|(?:s|section)\.?\s*(?:119|120))\b[^.;]*?\b(?:can|may|shall|has\s+(?:the\s+)?(?:authority|jurisdiction|power)\s+to)\s+(?:overturn|vacate|set\s+aside|reverse|override|vary)\s+(?:a\s+|the\s+)?(?:court\s+order|judge['’]?s\s+order|custody\s+order|supervision\s+order|temporary\s+care\s+order)/i.test(
      prop
    ) ||
    /\b(?:CFSRB|Child\s+and\s+Family\s+Services\s+Review\s+Board|society\s+complaint\s+review)\b[^.;]*?\b(?:can|may|shall)\s+review\s+(?:an\s+issue|matters?)\s+(?:that\s+has\s+been\s+)?(?:decided\s+by\s+the\s+court|currently\s+before\s+the\s+court)/i.test(
      prop
    )
  ) {
    return {
      support: "CONTRADICTED_BY_STATUTE",
      reason:
        "Contradicted by statute: CYFSA s. 119(11)(a) and s. 120(8)(a) expressly prohibit a society or the Child and Family Services Review Board (CFSRB) from reviewing a complaint if the subject is an issue that has been decided by the court or is before the court. Neither the CFSRB nor the Ontario Ombudsman can overturn a court order.",
    };
  }

  // 2. Broad statutory purposes in s. 1(2) misrepresented as creating an unconditional entitlement to every requested service or prohibiting emergency apprehension whenever an untried service exists
  if (/^(?:CYFSA:)?1\(2\)/i.test(sectionOrAuthorityKey)) {
    if (
      /\b(?:unconditional\s+(?:statutory\s+)?entitlement\s+to\s+every\s+requested\s+service|prohibits?\s+(?:emergency\s+)?apprehension\s+whenever\s+(?:any|an)\s+untried\s+(?:support\s+)?service\s+exists|guarantees?\s+every\s+service\s+requested\s+by\s+a\s+parent)\b/i.test(
        prop
      )
    ) {
      return {
        support: "IRRELEVANT_OR_MISAPPLIED",
        reason:
          "CYFSA s. 1(2) sets out additional statutory purposes that apply 'so long as they are consistent with the best interests, protection and well-being of children' (s. 1(1)). It does not create an unconditional entitlement to every requested service or bar emergency intervention where a child cannot be adequately protected.",
      };
    }
  }

  // 3. OCPS Practice Notes misrepresented as binding statutory law, or Standard 7 30-day service plan deadline miscalculated from removal date alone
  if (/^OCPS:/i.test(sectionOrAuthorityKey)) {
    if (
      /\b(?:practice\s+notes?\s+(?:have|carry|possess)\s+the\s+same\s+(?:binding\s+)?legal\s+force\s+as\s+(?:a\s+mandatory\s+standard|statute|statutory\s+law)|every\s+practice\s+note\s+is\s+a\s+mandatory\s+statutory\s+requirement)\b/i.test(
        prop
      )
    ) {
      return {
        support: "IRRELEVANT_OR_MISAPPLIED",
        reason:
          "Under the Ontario Child Protection Standards (2016), mandatory agency obligations are set out in the text labeled 'Standard', whereas 'Practice Notes' provide explanatory clinical guidance and do not carry the same mandatory legal force.",
      };
    }
    if (
      sectionOrAuthorityKey === "OCPS:STD_7" &&
      /\b(?:30-day|thirty-day)\s+(?:initial\s+)?service[- ]plan\s+deadline\s+(?:runs|starts|is\s+calculated|is\s+measured)\s+(?:solely\s+)?from\s+(?:the\s+)?(?:date\s+of\s+)?(?:removal|apprehension)\s+alone\b/i.test(
        prop
      )
    ) {
      return {
        support: "IRRELEVANT_OR_MISAPPLIED",
        reason:
          "Under Ontario Child Protection Standards (2016) Standard 7, the 30-day initial service-plan deadline runs from completion of the investigation or case transfer to ongoing services, NOT from the child's removal/apprehension date alone (whereas CYFSA s. 13(1) governs the residential placement Plan of Care within 30 days of admission).",
      };
    }
  }

  // 4. OCSWSSW registration assumptions or fabricated universal CAS worker oath / automatic perjury claims
  if (/^OCSWSSW:/i.test(sectionOrAuthorityKey)) {
    if (
      /\b(?:every\s+CAS\s+(?:worker|employee)\s+is\s+(?:automatically\s+)?a\s+registered\s+social\s+worker|all\s+child\s+protection\s+workers\s+are\s+automatically\s+members\s+of\s+OCSWSSW|universal\s+statutory\s+CAS\s+worker\s+oath\s+of\s+office)\b/i.test(
        prop
      )
    ) {
      return {
        support: "IRRELEVANT_OR_MISAPPLIED",
        reason:
          "OCSWSSW regulatory jurisdiction under the Social Work and Social Service Work Act, 1998 applies only to registered members (RSW / RSSW) or persons unlawfully holding themselves out as such. Not every CAS employee is a registered social worker, and there is no universal statutory CAS worker oath of office.",
      };
    }
  }

  // Non-CYFSA authority proposition checks (FLR & Charter)
  if (/^(?:FLR:)?1\(8\)$/i.test(sectionOrAuthorityKey)) {
    if (
      /\b(?:contempt\s+order\s+for\s+failing\s+to\s+follow\s+(?:the\s+)?rules\s+without\s+(?:a\s+)?court\s+order|child\s+in\s+need\s+of\s+protection\s+threshold\s+under\s+Rule\s+1\(8\)|warrantless\s+apprehension|apprehend\s+a\s+child\s+without\s+a\s+warrant|(?:5-day|five-day)\s+post-apprehension\s+hearing|30-day\s+adjournment\s+limit)\b/i.test(
        prop
      )
    ) {
      return {
        support: "IRRELEVANT_OR_MISAPPLIED",
        reason:
          "Family Law Rules r. 1(8) governs remedies for failing to obey a court order (whereas r. 1(8.1) governs failing to follow the Rules and excludes contempt under clause (g), and child protection apprehension/hearing rules are governed by the CYFSA).",
      };
    }
    return { support: "SUPPORTED", reason: null };
  }

  if (/^(?:FLR:)?14\((?:18|19)\)$/i.test(sectionOrAuthorityKey)) {
    if (
      /\b(?:anonymous\s+hearsay\s+is\s+admissible\s+without\s+identifying\s+the\s+source|unattributed\s+hearsay\s+without\s+naming\s+the\s+source\s+satisfies\s+Rule\s+14\((?:18|19)\))\b/i.test(
        prop
      )
    ) {
      return {
        support: "CONTRADICTED_BY_STATUTE",
        reason:
          "Family Law Rules r. 14(18)-(19) permit information and belief in a motion affidavit ONLY if the source of the information is identified by name and the affiant states a belief that the information is true.",
      };
    }
    return { support: "SUPPORTED", reason: null };
  }

  if (/^(?:CHARTER:)?24(?:\(1\))?$/i.test(sectionOrAuthorityKey)) {
    if (
      /\b(?:standalone\s+substantive\s+right\s+without\s+any\s+Charter\s+infringement|automatic\s+exclusion\s+of\s+evidence\s+under\s+s\.?\s*24\(1\)\s+without\s+a\s+Charter\s+breach|(?:5-day|five-day)\s+post-apprehension\s+hearing|30-day\s+adjournment\s+limit|warrantless\s+apprehension\s+authority)\b/i.test(
        prop
      )
    ) {
      return {
        support: "IRRELEVANT_OR_MISAPPLIED",
        reason:
          "Charter s. 24(1) is a remedial enforcement provision requiring an infringement or denial of a guaranteed Charter right or freedom before a court of competent jurisdiction.",
      };
    }
    return { support: "SUPPORTED", reason: null };
  }

  const normalizedKey = sectionOrAuthorityKey.replace(/^CYFSA:/i, "");

  if (normalizedKey === "102" || normalizedKey === "102(1)") {
    const check102 = evaluateSection102Proposition(prop);
    if (check102.misapplied) {
      return { support: "IRRELEVANT_OR_MISAPPLIED", reason: check102.reason };
    }
    return { support: "SUPPORTED", reason: null };
  }

  if (normalizedKey === "81(1)" || normalizedKey === "81(2)" || normalizedKey === "81(7)") {
    const check81 = evaluateSection81Proposition(normalizedKey, prop);
    if (check81.misapplied) {
      return { support: "IRRELEVANT_OR_MISAPPLIED", reason: check81.reason };
    }
    return { support: "SUPPORTED", reason: null };
  }

  if (normalizedKey === "88" || normalizedKey === "94(1)" || normalizedKey === "94(5)") {
    const check88_94 = evaluateSection88And94Proposition(normalizedKey, prop);
    if (check88_94.misapplied) {
      return {
        support: check88_94.support || "IRRELEVANT_OR_MISAPPLIED",
        reason: check88_94.reason,
      };
    }
    return { support: "SUPPORTED", reason: null };
  }

  const misapplied = KNOWN_MISAPPLIED_CYFSA_PROVISIONS[normalizedKey];
  if (misapplied && misapplied.misappliedPattern.test(prop)) {
    return {
      support: "IRRELEVANT_OR_MISAPPLIED",
      reason: misapplied.reason,
    };
  }

  return { support: "SUPPORTED", reason: null };
}

/**
 * Resolves a citation string against the authoritative legal verification registry,
 * enforcing category separation, exact subsection/clause verification, temporal version matching,
 * and proposition-support checking.
 */
export function resolveLegalAuthority(
  citationText: string | null | undefined,
  options?: ResolveLegalAuthorityOptions
): AuthorityResolutionResult {
  const text = (citationText || "").trim();
  if (!text) {
    return {
      status: "NONE",
      authorityId: null,
      authorityCategory: "NONE",
      category: "NONE",
      entry: null,
      officialCitation: "",
      sourceUrl: null,
      exactWording: null,
      practiceNote: null,
      warningText: "No statutory citation provided.",
      sourceExists: false,
      temporalStatus: "NOT_CHECKED",
      propositionSupport: "NOT_EVALUATED",
      propositionReason: null,
    };
  }

  const category = identifyAuthorityCategory(text);
  const combinedProposition = [options?.proposition || "", text].filter(Boolean).join(" ");

  // Helper to apply temporal & proposition checks once an entry (and optional list of all cited sections) is resolved
  const finalizeResolution = (
    entry: VerifiedAuthorityEntry,
    specificSectionCited?: string,
    allSectionsCited?: string[]
  ): AuthorityResolutionResult => {
    const sectionsToCheck =
      allSectionsCited && allSectionsCited.length > 0
        ? allSectionsCited
        : [specificSectionCited || entry.sectionKey];

    // 1. Temporal check if caseDate is provided (checks every cited section in multi-section citations)
    let temporalStatus: TemporalVerificationStatus = "NOT_CHECKED";
    if (options?.caseDate != null && String(options.caseDate).trim() !== "") {
      const rawDate = String(options.caseDate).trim();
      if (!isIsoDateString(rawDate)) {
        return {
          status: "INAPPLICABLE",
          authorityId: entry.authorityId,
          authorityCategory: category,
          category,
          entry,
          officialCitation: entry.citation,
          sourceUrl: entry.sourceUrl,
          exactWording: entry.exactWording,
          practiceNote: entry.practiceNote,
          warningText: `Invalid case date "${rawDate}": temporal verification requires an ISO date (YYYY-MM-DD).`,
          sourceExists: true,
          temporalStatus: "INVALID_CASE_DATE",
          propositionSupport: "NOT_EVALUATED",
          propositionReason: null,
        };
      }

      for (const sec of sectionsToCheck) {
        const secResolvedKey = category === "CYFSA" ? resolveBundledCyfsaKey(sec) : null;
        const secEntry =
          (category === "CYFSA"
            ? VERIFIED_AUTHORITIES_REGISTRY[`CYFSA:${sec}`] ||
              (secResolvedKey ? VERIFIED_AUTHORITIES_REGISTRY[`CYFSA:${secResolvedKey}`] : null)
            : null) || entry;

        let effectiveFrom = secEntry.effectiveFrom;
        if (/^74\(2\)\(d\.[12]\)$/i.test(sec)) {
          effectiveFrom = "2021-10-01";
        }

        if (rawDate < effectiveFrom) {
          return {
            status: "INAPPLICABLE",
            authorityId: secEntry.authorityId,
            authorityCategory: category,
            category,
            entry: secEntry,
            officialCitation: secEntry.citation,
            sourceUrl: secEntry.sourceUrl,
            exactWording: secEntry.exactWording,
            practiceNote: secEntry.practiceNote,
            warningText: `Temporal version mismatch: ${category === "CYFSA" ? `CYFSA s. ${sec}` : secEntry.citation} came into force on ${effectiveFrom} and was not in force on the case date (${rawDate}).`,
            sourceExists: true,
            temporalStatus: "BEFORE_EARLIEST_VERSION",
            propositionSupport: "NOT_EVALUATED",
            propositionReason: null,
          };
        }
        if (secEntry.effectiveTo !== null && rawDate >= secEntry.effectiveTo) {
          return {
            status: "INAPPLICABLE",
            authorityId: secEntry.authorityId,
            authorityCategory: category,
            category,
            entry: secEntry,
            officialCitation: secEntry.citation,
            sourceUrl: secEntry.sourceUrl,
            exactWording: secEntry.exactWording,
            practiceNote: secEntry.practiceNote,
            warningText: `Temporal version mismatch: ${secEntry.citation} was repealed or superseded on ${secEntry.effectiveTo} prior to the case date (${rawDate}).`,
            sourceExists: true,
            temporalStatus: "AFTER_REPEAL",
            propositionSupport: "NOT_EVALUATED",
            propositionReason: null,
          };
        }
      }
      temporalStatus = "IN_FORCE";
    }

    // 2. Proposition support check across all cited sections
    const propTargetText = options?.proposition !== undefined ? options.proposition : text;
    for (const sec of sectionsToCheck) {
      const propCheck = evaluatePropositionSupport(sec, propTargetText);
      if (
        propCheck.support === "IRRELEVANT_OR_MISAPPLIED" ||
        propCheck.support === "CONTRADICTED_BY_STATUTE"
      ) {
        return {
          status: "INAPPLICABLE",
          authorityId: entry.authorityId,
          authorityCategory: category,
          category,
          entry,
          officialCitation: entry.citation,
          sourceUrl: entry.sourceUrl,
          exactWording: entry.exactWording,
          practiceNote: entry.practiceNote,
          warningText: propCheck.reason,
          sourceExists: true,
          temporalStatus,
          propositionSupport: propCheck.support,
          propositionReason: propCheck.reason,
          allSectionsCited: sectionsToCheck,
        };
      }
    }

    const firstPropCheck = evaluatePropositionSupport(sectionsToCheck[0], propTargetText);
    return {
      status: "VERIFIED",
      authorityId: entry.authorityId,
      authorityCategory: category,
      category,
      entry,
      officialCitation: entry.citation,
      sourceUrl: entry.sourceUrl,
      exactWording: entry.exactWording,
      practiceNote: entry.practiceNote,
      warningText: null,
      sourceExists: true,
      temporalStatus,
      propositionSupport: options?.proposition ? "SUPPORTED" : firstPropCheck.support,
      propositionReason: null,
      allSectionsCited: sectionsToCheck,
    };
  };

  // ---------------------------------------------------------------------------
  // Category 1: CYFSA
  // ---------------------------------------------------------------------------
  if (category === "CYFSA") {
    const sections = citedSections(text);
    if (sections.length > 0) {
      // Check if any cited section is misapplied to an unsupported proposition (even if not in BUNDLED_STATUTE_ENTRIES, e.g., 94(5), 41, 51, 292)
      for (const sec of sections) {
        const propEval = evaluatePropositionSupport(sec, combinedProposition);
        if (
          propEval.support === "IRRELEVANT_OR_MISAPPLIED" ||
          propEval.support === "CONTRADICTED_BY_STATUTE"
        ) {
          const resolvedKey = resolveBundledCyfsaKey(sec);
          const fallbackEntry =
            VERIFIED_AUTHORITIES_REGISTRY[`CYFSA:${sec}`] ||
            (resolvedKey ? VERIFIED_AUTHORITIES_REGISTRY[`CYFSA:${resolvedKey}`] : null) ||
            null;
          return {
            status: "INAPPLICABLE",
            authorityId: fallbackEntry ? fallbackEntry.authorityId : `CYFSA:${sec}`,
            authorityCategory: "CYFSA",
            category: "CYFSA",
            entry: fallbackEntry,
            officialCitation: `CYFSA, s. ${sec}`,
            sourceUrl: "https://www.ontario.ca/laws/statute/17c14",
            exactWording: fallbackEntry?.exactWording || null,
            practiceNote: propEval.reason,
            warningText: propEval.reason,
            sourceExists: true,
            temporalStatus: "NOT_CHECKED",
            propositionSupport: propEval.support,
            propositionReason: propEval.reason,
          };
        }
      }

      // Deterministic check: every cited section/subsection/clause must be verified
      // Special case: bare "125" without a fabricated subsection maps to "125(1)", and bare "74" or "81" maps to its whole-section entry ONLY when no invalid subsection is present
      const firstSec = sections[0];
      if (sections.length === 1 && (firstSec === "74" || firstSec === "81" || firstSec === "125")) {
        const directEntry = VERIFIED_AUTHORITIES_REGISTRY[firstSec];
        if (directEntry) {
          return finalizeResolution(directEntry, firstSec, sections);
        }
      }

      const allVerified = sections.every((s) => isVerifiedCyfsaSection(s));
      if (allVerified) {
        const primaryKey = resolveBundledCyfsaKey(firstSec);
        const entry =
          VERIFIED_AUTHORITIES_REGISTRY[`CYFSA:${firstSec}`] ||
          (primaryKey ? VERIFIED_AUTHORITIES_REGISTRY[`CYFSA:${primaryKey}`] : null);
        if (entry) {
          return finalizeResolution(entry, firstSec, sections);
        }
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Category 2: BILL_C92 (Federal Act, S.C. 2019, c. 24)
  // ---------------------------------------------------------------------------
  if (category === "BILL_C92") {
    const sections = citedSections(text);
    if (sections.length === 1) {
      const sec = sections[0];
      const entry = VERIFIED_AUTHORITIES_REGISTRY[`BILL_C92:${sec}`];
      if (entry) {
        return finalizeResolution(entry, sec, sections);
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Category 3: FAMILY_LAW_RULES (O. Reg. 114/99)
  // ---------------------------------------------------------------------------
  if (category === "FAMILY_LAW_RULES") {
    const ruleMatch =
      text.match(/\b(?:Rule|Subrule|r\.?|s\.?)\s*(1\(8\)|1\.8|14\(18\)|14\.18|14\(19\)|14\.19|33)(?!\w)/i) ||
      text.match(/\b(1\(8\)|1\.8|14\(18\)|14\.18|14\(19\)|14\.19)(?!\w)/i);
    if (ruleMatch) {
      const normalizedRule = ruleMatch[1].replace(".", "(") + (ruleMatch[1].includes(".") ? ")" : "");
      // Reject if a fabricated subrule or unverified clause is appended, e.g. "Rule 1(8.1)", "Rule 1(8)(z)", "Rule 14(18)(z)", or "Rule 33(99)"
      const hasInvalidSuffix =
        /\b1\(8\.1\)|\b(?:1\(8\)|14\(18\)|14\(19\)|33)\(\d+|\b(?:1\(8\)|14\(18\)|14\(19\))\([h-z]\)/i.test(text);
      if (!hasInvalidSuffix) {
        const entry = VERIFIED_AUTHORITIES_REGISTRY[`FLR:${normalizedRule}`];
        if (entry) {
          return finalizeResolution(entry, `FLR:${normalizedRule}`);
        }
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Category 4: CHARTER (Canadian Charter of Rights and Freedoms)
  // ---------------------------------------------------------------------------
  if (category === "CHARTER") {
    const charterSecMatch = text.match(/\b(?:Section|sec\.?|s\.?)\s*(7|15(?:\(1\))?|24\(1\)|24)(?!\w)/i);
    if (charterSecMatch) {
      const rawSec = charterSecMatch[1];
      // Reject unbundled or nonexistent Charter subsections such as s. 24(2), s. 24(9), s. 7(2), s. 15(9)
      const hasInvalidCharterSub = /\b(?:7|15|24)\((?!1\))\d+\)/i.test(text);
      if (!hasInvalidCharterSub) {
        const registryKey = rawSec.startsWith("24")
          ? "CHARTER:24(1)"
          : rawSec.startsWith("15")
            ? "CHARTER:15"
            : "CHARTER:7";
        const entry = VERIFIED_AUTHORITIES_REGISTRY[registryKey];
        if (entry) {
          return finalizeResolution(entry, registryKey);
        }
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Category 5: CAS_STANDARD (Ontario Child Protection Standards 2016)
  // ---------------------------------------------------------------------------
  if (category === "CAS_STANDARD") {
    // Reject fabricated standard numbers such as Standard 9, Standard 15, Standard 99
    if (/\bStandard\s+(?:[9]|\d{2,})\b/i.test(text)) {
      // Fall through to UNVERIFIED
    } else {
      const stdMatch = text.match(/\b(?:Standard|STD_?)\s*([1-8])\b/i);
      if (stdMatch) {
        const key = `OCPS:STD_${stdMatch[1]}`;
        const entry = VERIFIED_AUTHORITIES_REGISTRY[key];
        if (entry) {
          return finalizeResolution(entry, key);
        }
      }
      if (
        /\b(?:All\s+Phases|Contemporaneous\s+Case\s+Notes|Standard\s+[A-H]|Supervisory\s+Consultation)\b/i.test(
          text
        )
      ) {
        const entry = VERIFIED_AUTHORITIES_REGISTRY["OCPS:ALL_PHASES"];
        if (entry) {
          return finalizeResolution(entry, "OCPS:ALL_PHASES");
        }
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Category 6: PROFESSIONAL_STANDARD (OCSWSSW / Social Work and Social Service Work Act, 1998)
  // ---------------------------------------------------------------------------
  if (category === "PROFESSIONAL_STANDARD") {
    if (/\b(?:Principle\s+IV|Record[- ]?Keeping|Social\s+Work\s+Record)\b/i.test(text)) {
      const entry = VERIFIED_AUTHORITIES_REGISTRY["OCSWSSW:PRIN_IV_RECORDS"];
      if (entry) {
        return finalizeResolution(entry, "OCSWSSW:PRIN_IV_RECORDS");
      }
    }
    const entry = VERIFIED_AUTHORITIES_REGISTRY["OCSWSSW:REGISTRATION"];
    if (entry) {
      return finalizeResolution(entry, "OCSWSSW:REGISTRATION");
    }
  }

  // ---------------------------------------------------------------------------
  // Category 7: OVERSIGHT_PATHWAY (Ombudsman Act)
  // ---------------------------------------------------------------------------
  if (category === "OVERSIGHT_PATHWAY") {
    if (/\bOmbudsman\b/i.test(text)) {
      const entry = VERIFIED_AUTHORITIES_REGISTRY["OVERSIGHT:OMBUDSMAN"];
      if (entry) {
        return finalizeResolution(entry, "OVERSIGHT:OMBUDSMAN");
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Category 8: REGULATION (O. Reg. 155/18 and O. Reg. 156/18)
  // ---------------------------------------------------------------------------
  if (category === "REGULATION") {
    if (/\b155\/18\b/.test(text) && !/\bs\.\s*\d+/i.test(text)) {
      const entry = VERIFIED_AUTHORITIES_REGISTRY["O_REG_155_18:COMPLAINTS"];
      if (entry) {
        return finalizeResolution(entry, "O_REG_155_18:COMPLAINTS");
      }
    }
    if (/\b156\/18\b/.test(text) && !/\bs\.\s*\d+/i.test(text)) {
      const entry = VERIFIED_AUTHORITIES_REGISTRY["O_REG_156_18:STANDARDS"];
      if (entry) {
        return finalizeResolution(entry, "O_REG_156_18:STANDARDS");
      }
    }
  }

  // Not matched to official verified registry -> preserve honest UNVERIFIED status
  return {
    status: "UNVERIFIED",
    authorityId: null,
    authorityCategory: category,
    category,
    entry: null,
    officialCitation: text,
    sourceUrl: null,
    exactWording: null,
    practiceNote: "Confirm exact subsection and current in-force wording with legal counsel before relying on this citation.",
    warningText: "⚠️ Statute citation unverified against official consolidation — confirm exact section with counsel.",
    sourceExists: false,
    temporalStatus: "NOT_CHECKED",
    propositionSupport: "NOT_EVALUATED",
    propositionReason: null,
  };
}

export function classifyStatutoryCitation(
  citationText: string | null | undefined,
  options?: ResolveLegalAuthorityOptions
): {
  status: CitationVerificationStatus;
  authorityId: string | null;
  authorityCategory: AuthorityCategory;
  entry: VerifiedAuthorityEntry | null;
  reason: string;
  sourceExists: boolean;
  temporalStatus: TemporalVerificationStatus;
  propositionSupport: PropositionSupportStatus;
} {
  const res = resolveLegalAuthority(citationText, options);
  if (res.status === "VERIFIED" && res.entry) {
    return {
      status: "VERIFIED",
      authorityId: res.authorityId,
      authorityCategory: res.authorityCategory,
      entry: res.entry,
      reason: `Verified against ${res.entry.verificationSourceType === "BUNDLED_CONSOLIDATION_VERBATIM" ? "official bundled consolidation" : "authoritative reference"} (${res.entry.statuteTitle}).`,
      sourceExists: res.sourceExists,
      temporalStatus: res.temporalStatus,
      propositionSupport: res.propositionSupport,
    };
  }
  if (res.status === "INAPPLICABLE") {
    return {
      status: "INAPPLICABLE",
      authorityId: res.authorityId,
      authorityCategory: res.authorityCategory,
      entry: res.entry,
      reason: res.warningText || "Citation is temporally inapplicable or does not support the asserted legal proposition.",
      sourceExists: res.sourceExists,
      temporalStatus: res.temporalStatus,
      propositionSupport: res.propositionSupport,
    };
  }
  return {
    status: "UNVERIFIED",
    authorityId: null,
    authorityCategory: res.authorityCategory,
    entry: null,
    reason: "Citation does not match any authoritative Ontario statute or rule consolidation in the verified registry.",
    sourceExists: false,
    temporalStatus: res.temporalStatus,
    propositionSupport: res.propositionSupport,
  };
}
