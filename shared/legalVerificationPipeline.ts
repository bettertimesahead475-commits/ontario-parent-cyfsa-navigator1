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
    exactWording: "14 (19) The affidavit may also contain information that the person learned from someone else, bytes/statements of information and belief, only if the source of the information is identified by name and the affidavit states that the person signing it believes the information is true.",
    sourceUrl: "https://www.ontario.ca/laws/regulation/990114#BK20",
    consolidationPeriod: "Consolidation period: In Force (O. Reg. 114/99; full text not bundled in local corpus)",
    effectiveFrom: "1999-09-15",
    effectiveTo: null,
    verificationSourceType: "REGULATION_REFERENCE_SUMMARY",
    verifiedDate: "2026-11-03",
    legalTestSummary: "Permits secondhand information in a motion affidavit only if the source is identified and the affiant states a belief that the information is true.",
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
];

/**
 * Authoritative verified provisions registry.
 * Keyed by canonical category-prefixed authorityId (e.g. "CYFSA:88", "FLR:14(18)", "CHARTER:7")
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
VERIFIED_AUTHORITIES_REGISTRY["FLR_14_18"] = VERIFIED_AUTHORITIES_REGISTRY["FLR:14(18)"];
VERIFIED_AUTHORITIES_REGISTRY["FLR_14_19"] = VERIFIED_AUTHORITIES_REGISTRY["FLR:14(19)"];
VERIFIED_AUTHORITIES_REGISTRY["CHARTER_7"] = VERIFIED_AUTHORITIES_REGISTRY["CHARTER:7"];
VERIFIED_AUTHORITIES_REGISTRY["CHARTER_15"] = VERIFIED_AUTHORITIES_REGISTRY["CHARTER:15"];
VERIFIED_AUTHORITIES_REGISTRY["BILL_C92:10"] = VERIFIED_AUTHORITIES_REGISTRY["BILL_C92:10(1)"];
VERIFIED_AUTHORITIES_REGISTRY["BILL_C92:12"] = VERIFIED_AUTHORITIES_REGISTRY["BILL_C92:12(1)"];
VERIFIED_AUTHORITIES_REGISTRY["BILL_C92:14"] = VERIFIED_AUTHORITIES_REGISTRY["BILL_C92:14(1)"];
VERIFIED_AUTHORITIES_REGISTRY["BILL_C92:16"] = VERIFIED_AUTHORITIES_REGISTRY["BILL_C92:16(1)"];

export const VERIFIED_STATUTORY_PROVISIONS = VERIFIED_AUTHORITIES_REGISTRY;

/**
 * Known CYFSA sections that exist in the statute (sourceExists = true) but are frequently
 * misapplied to the wrong legal proposition in child protection filings or AI summaries.
 */
const KNOWN_MISAPPLIED_CYFSA_PROVISIONS: Record<
  string,
  { actualHeading: string; misappliedPattern: RegExp; reason: string }
> = {
  "94(5)": {
    actualHeading: "CYFSA s. 94(5) (Relative-placement consideration on adjournment)",
    misappliedPattern: /5-day|five-day|five day|post-apprehension hearing|within 5 days/i,
    reason:
      "CYFSA s. 94(5) requires the court to consider placement with a relative or extended-family/community member before ordering temporary society custody on adjournment. It is NOT the 5-day post-apprehension hearing deadline, which is governed by CYFSA s. 88.",
  },
  "94(1)": {
    actualHeading: "CYFSA s. 94(1) (30-day adjournment limit)",
    misappliedPattern: /5-day|five-day|five day|within 5 days after apprehension/i,
    reason:
      "CYFSA s. 94(1) limits adjournments to 30 days absent consent. It is NOT the 5-day post-apprehension hearing deadline, which is governed by CYFSA s. 88.",
  },
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
  "81(1)": {
    actualHeading: "CYFSA s. 81(1) (Application to court)",
    misappliedPattern: /\b(?:imminent danger|warrantless apprehension|remove without a warrant|substantial risk during the time necessary)\b/i,
    reason:
      "CYFSA s. 81(1) merely authorizes a society to apply to the court to determine whether a child is in need of protection. Warrantless apprehension requires meeting the three-part test in CYFSA s. 81(7).",
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
  "102": {
    actualHeading: "CYFSA s. 102 (Custody order)",
    misappliedPattern: /\bsupervision order\b/i,
    reason:
      "CYFSA s. 102 governs custody orders. Supervision orders are governed by CYFSA s. 101(1), para. 1 (and s. 116(1)(a) on status review).",
  },
  "102(1)": {
    actualHeading: "CYFSA s. 102(1) (Custody order)",
    misappliedPattern: /\bsupervision order\b/i,
    reason:
      "CYFSA s. 102(1) governs custody orders. Supervision orders are governed by CYFSA s. 101(1), para. 1.",
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

  const normalizedKey = sectionOrAuthorityKey.replace(/^CYFSA:/i, "");
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

  // Helper to apply temporal & proposition checks once an entry is resolved
  const finalizeResolution = (
    entry: VerifiedAuthorityEntry,
    specificSectionCited?: string
  ): AuthorityResolutionResult => {
    // 1. Check clause-level effective dates (e.g., 74(2)(d.1) and 74(2)(d.2) effective 2021-10-01)
    let effectiveFrom = entry.effectiveFrom;
    if (specificSectionCited && /^74\(2\)\(d\.[12]\)$/i.test(specificSectionCited)) {
      effectiveFrom = "2021-10-01";
    }

    // 2. Temporal check if caseDate is provided
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
      if (rawDate < effectiveFrom) {
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
          warningText: `Temporal version mismatch: ${ specificSectionCited ? `CYFSA s. ${specificSectionCited}` : entry.citation } came into force on ${effectiveFrom} and was not in force on the case date (${rawDate}).`,
          sourceExists: true,
          temporalStatus: "BEFORE_EARLIEST_VERSION",
          propositionSupport: "NOT_EVALUATED",
          propositionReason: null,
        };
      }
      if (entry.effectiveTo !== null && rawDate >= entry.effectiveTo) {
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
          warningText: `Temporal version mismatch: ${entry.citation} was repealed or superseded on ${entry.effectiveTo} prior to the case date (${rawDate}).`,
          sourceExists: true,
          temporalStatus: "AFTER_REPEAL",
          propositionSupport: "NOT_EVALUATED",
          propositionReason: null,
        };
      }
      temporalStatus = "IN_FORCE";
    }

    // 3. Proposition support check
    const propCheck = evaluatePropositionSupport(
      specificSectionCited || entry.sectionKey,
      options?.proposition !== undefined ? options.proposition : text
    );
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
      };
    }

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
      propositionSupport: options?.proposition ? "SUPPORTED" : propCheck.support,
      propositionReason: null,
    };
  };

  // ---------------------------------------------------------------------------
  // Category 1: CYFSA
  // ---------------------------------------------------------------------------
  if (category === "CYFSA") {
    const sections = citedSections(text);
    if (sections.length > 0) {
      // Check if any cited section is a known misapplied CYFSA provision (even if not in BUNDLED_STATUTE_ENTRIES, e.g., 94(5), 41, 51, 292)
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
          return finalizeResolution(directEntry, firstSec);
        }
      }

      const allVerified = sections.every((s) => isVerifiedCyfsaSection(s));
      if (allVerified) {
        const primaryKey = resolveBundledCyfsaKey(firstSec);
        const entry =
          VERIFIED_AUTHORITIES_REGISTRY[`CYFSA:${firstSec}`] ||
          (primaryKey ? VERIFIED_AUTHORITIES_REGISTRY[`CYFSA:${primaryKey}`] : null);
        if (entry) {
          return finalizeResolution(entry, firstSec);
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
        return finalizeResolution(entry, sec);
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Category 3: FAMILY_LAW_RULES (O. Reg. 114/99)
  // ---------------------------------------------------------------------------
  if (category === "FAMILY_LAW_RULES") {
    const ruleMatch =
      text.match(/\b(?:Rule|r\.?|s\.?)\s*(14\(18\)|14\.18|14\(19\)|14\.19|33)(?!\w)/i) ||
      text.match(/\b(14\(18\)|14\.18|14\(19\)|14\.19)(?!\w)/i);
    if (ruleMatch) {
      const normalizedRule = ruleMatch[1].replace(".", "(") + (ruleMatch[1].includes(".") ? ")" : "");
      // Reject if a fabricated subrule is appended, e.g. "Rule 14(18)(z)" or "Rule 33(99)"
      const hasInvalidSuffix = /\b(?:14\(18\)|14\(19\)|33)\(\d{2,}|\b(?:14\(18\)|14\(19\))\([a-z]\)/i.test(text);
      if (!hasInvalidSuffix) {
        const entry = VERIFIED_AUTHORITIES_REGISTRY[`FLR:${normalizedRule}`];
        if (entry) {
          return finalizeResolution(entry, normalizedRule);
        }
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Category 4: CHARTER (Canadian Charter of Rights and Freedoms)
  // ---------------------------------------------------------------------------
  if (category === "CHARTER") {
    const charterSecMatch = text.match(/\b(?:Section|sec\.?|s\.?)\s*(7|15)(?:\(1\))?(?!\w)/i);
    if (charterSecMatch) {
      const secNum = charterSecMatch[1];
      const entry = VERIFIED_AUTHORITIES_REGISTRY[`CHARTER:${secNum}`];
      if (entry) {
        return finalizeResolution(entry, secNum);
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
