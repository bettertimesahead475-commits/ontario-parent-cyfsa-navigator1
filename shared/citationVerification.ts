/**
 * Citation classification for analyzer reports. Pure, so the server and the UI apply the same rules.
 *
 * What this module does: it decides whether a citation can be matched to CYFSA Navigator's INTERNAL reference text.
 * It identifies which Act or legal instrument a citation names, then checks the section, subsection, clause, and
 * paragraph numbers against the verified internal CYFSA reference list.
 *
 * Authority category separation:
 * - INTERNAL_CYFSA_SECTION_KEYS contains ONLY CYFSA statutory provisions whose verbatim text is present in the
 *   bundled CYFSA consolidation (src/utils/statuteReference.ts).
 * - Family Law Rules, Charter provisions, Federal statutes (Bill C-92), regulations, and judicial decisions have
 *   distinct authority categories and are NEVER placed inside INTERNAL_CYFSA_SECTION_KEYS.
 */

/** Section keys present in the internal reference text (src/utils/statuteReference.ts). Keep the two in step; a test checks it. */
export const INTERNAL_CYFSA_SECTION_KEYS = [
  "1(1)",
  "1(2)",
  "1(2), para. 1",
  "1(2), para. 2",
  "2(1)",
  "3",
  "9.1",
  "13(1)",
  "14",
  "15(2)",
  "15(4)",
  "35(1)",
  "35(2)",
  "72",
  "73",
  "74(1)",
  "74(2)",
  "74(3)",
  "75(1)",
  "75(4)",
  "75(5)",
  "75(6)",
  "76(3)",
  "78",
  "78(1)",
  "78(4)",
  "79(1)",
  "80",
  "81(1)",
  "81(2)",
  "81(7)",
  "81(12)",
  "81(13)",
  "88",
  "90(1)",
  "93(1)",
  "94(1)",
  "94(2)",
  "94(4)",
  "94(6)",
  "94(10)",
  "98(1)",
  "100",
  "101(1)",
  "101(1), para. 1",
  "101(2)",
  "101(3)",
  "101(4)",
  "101(5)",
  "101(7)",
  "102(1)",
  "104(1)",
  "105(1)",
  "105(5)",
  "109(2)",
  "109(2)(d)",
  "113(1)",
  "113(2)",
  "114",
  "115(2)",
  "116(1)",
  "116(4)",
  "119(1)",
  "119(2)",
  "119(11)",
  "120(1)",
  "120(4)",
  "120(8)",
  "121(1)",
  "121(2.1)",
  "121(3)",
  "122(1)",
  "122(5)",
  "123",
  "125(1)",
  "126(1)",
  "136(5)",
  "306(1)",
  "312(1)",
  "314(3)",
  "315(2)",
  "316(1)",
  "333(1)",
] as const;

/**
 * Valid clauses and numbered paragraphs within bundled CYFSA subsections.
 * Allows deterministic verification of clause pinpoints (e.g. "74(2)(a)", "74(2)(d.1)", "94(6)(c)", "101(7)(c)")
 * while rejecting nonexistent or repealed clauses/paragraphs (e.g. "74(2)(z)", "88(2)", "3, para. 6").
 */
export const VERIFIED_CYFSA_CLAUSES: Record<string, readonly string[]> = {
  "1(2)": ["para. 1", "para. 2", "para. 3", "para. 4", "para. 5", "para. 6", "para. 7"],
  "3": ["para. 1", "para. 2", "para. 3", "para. 4", "para. 5"], // para. 6 repealed by 2018, c. 17, Sched. 34, s. 6(1)
  "14": ["a", "b"],
  "35(1)": ["a", "b", "c", "d", "e", "f", "g"],
  "35(2)": ["a", "b"],
  "72": ["a", "b", "c", "d", "e", "f", "g", "h", "i"],
  "74(2)": ["a", "b", "c", "d", "d.1", "d.2", "e", "f", "g", "h", "i", "j", "k", "l", "m", "n", "o"],
  "74(3)": ["a", "b", "c"],
  "75(4)": ["a", "b"],
  "75(6)": ["a", "b"],
  "76(3)": ["a", "b", "c"],
  "78(4)": ["a", "b", "c"],
  "79(1)": ["para. 1", "para. 2", "para. 3", "para. 4"],
  "80": ["a", "b", "c"],
  "81(2)": ["a", "b", "c"],
  "81(7)": ["a", "b", "c"],
  "88": ["a", "b", "c", "d", "e"],
  "93(1)": ["a", "b"],
  "94(1)": ["a", "b"],
  "94(2)": ["a", "b", "c", "d"],
  "94(6)": ["a", "b", "c"],
  "98(1)": ["para. 1", "para. 2", "para. 3"],
  "100": ["a", "b", "c", "d", "e", "f"],
  "101(1)": ["para. 1", "para. 2", "para. 3", "para. 4"],
  "101(5)": ["a", "b", "c"],
  "101(7)": ["a", "b", "c"],
  "104(1)": ["a", "b"],
  "105(5)": ["a", "b"],
  "109(2)": ["a", "b", "c", "d", "e"],
  "113(1)": ["para. 1", "para. 2", "para. 3", "para. 4", "para. 5"],
  "113(2)": ["a", "b", "c"],
  "114": ["a", "b", "c", "d"],
  "115(2)": ["a", "b", "c"],
  "116(1)": ["a", "b", "c"],
  "116(4)": ["a", "b", "c"],
  "119(11)": ["a", "b"],
  "120(1)": ["a", "b"],
  "120(4)": ["para. 1", "para. 2", "para. 3", "para. 4", "para. 5", "para. 6"],
  "120(8)": ["a", "b"],
  "121(1)": ["a", "b", "c", "d", "e"],
  "121(2.1)": ["a", "b"],
  "121(3)": ["a", "b"],
  "122(1)": ["a", "b"],
  "123": ["a", "b"],
  "312(1)": ["a", "b", "c", "d"],
  "314(3)": ["a", "b"],
};

export const CITATION_UNVERIFIED_NOTE =
  "⚠️ Statute citation unverified — confirm exact section with counsel before relying on this.";

export type CitationStatus = "INTERNAL_REFERENCE_MATCH" | "UNVERIFIED" | "NONE";
export type IdentifiedAct = "CYFSA" | "OTHER" | "MULTIPLE" | "NONE";

export type AuthorityCategory =
  | "CYFSA"
  | "BILL_C92"
  | "FAMILY_LAW_RULES"
  | "CHARTER"
  | "CHILDRENS_LAW_REFORM_ACT"
  | "REGULATION"
  | "CAS_STANDARD"
  | "PROFESSIONAL_STANDARD"
  | "OVERSIGHT_PATHWAY"
  | "CASE_LAW"
  | "OTHER"
  | "MULTIPLE"
  | "NONE";

export interface CitationClassification {
  status: CitationStatus;
  identifiedAct: IdentifiedAct;
  authorityCategory?: AuthorityCategory;
  /** Section keys the citation names, such as "74(2)", "9.1", "74(2)(d.1)", or "101(1), para. 1". */
  sections: string[];
  /** Always NOT_CHECKED: no live external e-Laws query was performed at runtime. */
  officialVerification: "NOT_CHECKED";
  /** Plain-language reason, shown to the user with the status. */
  reason: string;
}

// Stripped before the other-instrument scan, so the CYFSA's own name does not count as "another Act".
const cyfsaNamePattern = () =>
  /\bCYFSA\b|Child,?\s+Youth\s+and\s+Family\s+Services\s+Act(?:\s*,\s*2017)?|S\.\s*O\.\s*2017,?\s*c\.\s*14(?:\s*,\s*Sched(?:ule|\.)?\s*1)?/gi;

// Any other statute, regulation, rules set, charter or code. Including a bare "Act" is deliberate: an unnamed
// "the Act" is ambiguous, so it is not treated as the CYFSA.
const otherInstrumentPattern = () =>
  /\b(?:Acts?|Codes?|Charter|Regulations?|Regs?|Rules?|CLRA|FLR|OCPS|OCSWSSW|R\.R\.O\.|R\.S\.O\.|S\.\s*O\.|S\.\s*C\.|O\.\s*Reg\.?|Bills?|Statutes?|Ontario\s+Child\s+Protection\s+Standards)\b/gi;

/**
 * Resolves a section or clause pinpoint to its corresponding key in INTERNAL_CYFSA_SECTION_KEYS
 * (and BUNDLED_STATUTE_ENTRIES), or returns null if the section/subsection/clause is not verified.
 */
export function resolveBundledCyfsaKey(sectionKey: string): string | null {
  const internalSet = new Set<string>(INTERNAL_CYFSA_SECTION_KEYS);
  if (internalSet.has(sectionKey)) {
    return sectionKey;
  }

  // Check if sectionKey is a clause pinpoint on a verified base section, e.g. "74(2)(a)", "74(2)(d.1)", "88(a)", "94(6)(c)"
  const clauseMatch = sectionKey.match(/^(\d{1,3}(?:\.\d+)?(?:\(\d+(?:\.\d+)?\))*)\(([a-z](?:\.\d+)?)\)$/i);
  if (clauseMatch) {
    const base = clauseMatch[1];
    const clause = clauseMatch[2].toLowerCase();
    const validClauses = VERIFIED_CYFSA_CLAUSES[base];
    if (internalSet.has(base) && validClauses && validClauses.includes(clause)) {
      return base;
    }
    return null;
  }

  // Check if sectionKey is a paragraph pinpoint on a verified base section, e.g. "3, para. 1" or "1(2), para. 1"
  const paraMatch = sectionKey.match(/^(\d{1,3}(?:\.\d+)?(?:\(\d+(?:\.\d+)?\))*),\s*para\.\s*(\d+(?:\.\d+)?)$/i);
  if (paraMatch) {
    const base = paraMatch[1];
    const para = `para. ${paraMatch[2]}`;
    const validClauses = VERIFIED_CYFSA_CLAUSES[base];
    if (internalSet.has(base) && validClauses && validClauses.includes(para)) {
      return base;
    }
    return null;
  }

  return null;
}

/**
 * True when the section/subsection/clause pinpoint is verified in the bundled CYFSA reference corpus.
 */
export function isVerifiedCyfsaSection(sectionKey: string): boolean {
  return resolveBundledCyfsaKey(sectionKey) !== null;
}

/**
 * Every section number a citation names, including:
 * - lists such as "ss. 74(2) and 125(1)" or "s. 74(2), 94(5)"
 * - bare subsection continuations such as "ss. 94(1) and (2)"
 * - decimal sections and subsections such as "s. 9.1", "s. 77.1(1)", "s. 121(2.1)"
 * - clause pinpoints such as "s. 74(2)(a)", "s. 74(2)(d.1)", "s. 109(2)(d)", "s. 94(6)(c)"
 * - paragraph pinpoints such as "s. 101(1), para. 1", "s. 1(2), para. 2"
 * - subsection ranges such as "s. 74(2)-(4)" (expanded to "74(2)", "74(3)", "74(4)")
 * Only numbers introduced by a section/subsection/clause keyword count, so "S.O. 2017, c. 14" adds nothing.
 */
export function citedSections(text: string): string[] {
  const out: string[] = [];
  const listPattern =
    /\b(?:s|ss|sec|secs|section|sections|subs?|subsections?|clause|clauses)\.?\s*((?:(?:\d{1,3}(?:\.\d+)?(?:\(\d+(?:\.\d+)?\))*(?:\([a-z](?:\.\d+)?\))*(?:\s*,\s*(?:para|paragraph)s?\.?\s*\d+(?:\.\d+)?)?|\(\d+(?:\.\d+)?\)(?:\([a-z](?:\.\d+)?\))*)(?:\s*(?:,|;|and|or|&|to|-|–)\s*)?)+)/gi;

  for (const m of text.matchAll(listPattern)) {
    const rawSegment = m[1];

    // Expand explicit subsection ranges like "74(2)-(4)" or "74(2)–(4)"
    const expandedSegment = rawSegment.replace(
      /(\d{1,3}(?:\.\d+)?)\((\d+)\)\s*(?:-|–|to)\s*\((\d+)\)/gi,
      (_match, sec, startSub, endSub) => {
        const sNum = Number(startSub);
        const eNum = Number(endSub);
        if (Number.isInteger(sNum) && Number.isInteger(eNum) && eNum >= sNum && eNum - sNum <= 20) {
          const parts: string[] = [];
          for (let k = sNum; k <= eNum; k++) {
            parts.push(`${sec}(${k})`);
          }
          return parts.join(", ");
        }
        return _match;
      }
    );

    let base = "";
    const itemRegex =
      /(\d{1,3}(?:\.\d+)?)((?:\(\d+(?:\.\d+)?\))*)((?:\([a-z](?:\.\d+)?\))*)(?:\s*,\s*(?:para|paragraph)s?\.?\s*(\d+(?:\.\d+)?))?|\((\d+(?:\.\d+)?)\)((?:\([a-z](?:\.\d+)?\))*)/gi;

    for (const item of expandedSegment.matchAll(itemRegex)) {
      if (item[1]) {
        base = item[1];
        const subs = item[2] || "";
        const clauses = item[3] || "";
        const para = item[4] ? `, para. ${item[4]}` : "";
        out.push(`${base}${subs}${clauses}${para}`);
      } else if (item[5] && base) {
        const clauses = item[6] || "";
        out.push(`${base}(${item[5]})${clauses}`);
      }
    }
  }
  return out;
}

/** Which Acts a citation names. Pure string checks; no lookup. */
export function identifyInstruments(text: string): { cyfsa: boolean; others: string[] } {
  const cyfsa = cyfsaNamePattern().test(text);
  const rest = text.replace(cyfsaNamePattern(), " ");
  const others = [...rest.matchAll(otherInstrumentPattern())].map((m) => m[0]);
  return { cyfsa, others };
}

/**
 * Identifies the distinct authority category of a citation string.
 * Separates CYFSA, Bill C-92 (Federal), Family Law Rules, Charter, CLRA, Regulations, and Case Law.
 */
export function identifyAuthorityCategory(text: string | null | undefined): AuthorityCategory {
  const t = (text || "").trim();
  if (!t) return "NONE";

  const { cyfsa, others } = identifyInstruments(t);
  if (cyfsa && others.length > 0) return "MULTIPLE";
  if (cyfsa) return "CYFSA";

  const hasBillC92 =
    /\bBill\s+C-92\b|\bS\.\s*C\.\s*2019,?\s*c\.\s*24\b|Act\s+respecting\s+First\s+Nations,?\s+Inuit\s+and\s+M[ée]tis\s+children/i.test(t);
  const hasFlr =
    /\b(?:Family\s+Law\s+Rules?|FLR|O\.\s*Reg\.?\s*114\/99)\b/i.test(t) ||
    (!cyfsa && /\b(?:Rule|Subrule|r\.)\s*(?:1\(8\)|1\.8|14\(18\)|14\.18|14\(19\)|14\.19|33)(?!\w)/i.test(t));
  const hasCharter = /\b(?:Canadian\s+)?Charter(?:\s+of\s+Rights\s+and\s+Freedoms)?\b/i.test(t);
  const hasClra = /\b(?:CLRA|Children['’]s\s+Law\s+Reform\s+Act)\b/i.test(t);
  const hasCasStandard =
    /\b(?:Ontario\s+Child\s+Protection\s+Standards|OCPS|Child\s+Protection\s+Standards\s*\(?2016\)?)\b/i.test(t);
  const hasProfessionalStandard =
    /\b(?:OCSWSSW|Ontario\s+College\s+of\s+Social\s+Workers(?:\s+and\s+Social\s+Service\s+Workers)?|Social\s+Work\s+and\s+Social\s+Service\s+Work\s+Act)\b/i.test(t);
  const hasOversightPathway =
    !cyfsa &&
    /\b(?:Ombudsman\s+Act|Ontario\s+Ombudsman|Information\s+and\s+Privacy\s+Commissioner)\b/i.test(t);
  const hasReg = !hasFlr && /\b(?:O\.\s*Reg\.?|R\.R\.O\.|Regulations?)\b/i.test(t);
  const hasCaseLaw = /\bv\.\s+[A-Z]|\b\d{4}\s+(?:SCC|ONCA|ONSC|ONCJ)\s+\d+|\[\d{4}\]\s*\d+\s*S\.C\.R\./i.test(t);

  const matchedCategories: AuthorityCategory[] = [];
  if (hasBillC92) matchedCategories.push("BILL_C92");
  if (hasFlr) matchedCategories.push("FAMILY_LAW_RULES");
  if (hasCharter) matchedCategories.push("CHARTER");
  if (hasClra) matchedCategories.push("CHILDRENS_LAW_REFORM_ACT");
  if (hasCasStandard) matchedCategories.push("CAS_STANDARD");
  if (hasProfessionalStandard) matchedCategories.push("PROFESSIONAL_STANDARD");
  if (hasOversightPathway) matchedCategories.push("OVERSIGHT_PATHWAY");
  if (hasReg) matchedCategories.push("REGULATION");
  if (hasCaseLaw) matchedCategories.push("CASE_LAW");

  if (matchedCategories.length > 1) return "MULTIPLE";
  if (matchedCategories.length === 1) return matchedCategories[0];
  if (others.length > 0) return "OTHER";
  return "NONE";
}

/**
 * Classifies one citation against the internal CYFSA reference text.
 *
 * Rules, in order (the first that applies decides):
 * 1. Empty text: NONE.
 * 2. Text already marked unverified: UNVERIFIED.
 * 3. Names a CYFSA and another instrument: UNVERIFIED (MULTIPLE). Mixed citations are never confirmed.
 * 4. Names another instrument only (Family Law Act, Criminal Code, CLRA, Family Law Rules, Charter, regulations):
 *    UNVERIFIED (OTHER). A section number under such a name is never read as a CYFSA provision.
 * 5. Section numbers with no Act identified: UNVERIFIED (NONE). "s. 81(7)" alone could be any Act.
 * 6. CYFSA named with no section: UNVERIFIED. An Act name alone does not identify a provision.
 * 7. CYFSA with a section/subsection/clause that is not on the verified internal list: UNVERIFIED.
 * 8. CYFSA with only verified internal-list sections/clauses: INTERNAL_REFERENCE_MATCH.
 */
export function classifyCitation(text: string | null | undefined): CitationClassification {
  const t = (text || "").trim();
  const authorityCategory = identifyAuthorityCategory(t);
  const none = (reason: string): CitationClassification => ({
    status: "NONE",
    identifiedAct: "NONE",
    authorityCategory: "NONE",
    sections: [],
    officialVerification: "NOT_CHECKED",
    reason,
  });
  if (!t) return none("No statute is cited for this point.");
  if (/unverified/i.test(t)) {
    return {
      status: "UNVERIFIED",
      identifiedAct: identifyInstruments(t).cyfsa ? "CYFSA" : "NONE",
      authorityCategory,
      sections: citedSections(t),
      officialVerification: "NOT_CHECKED",
      reason: "The citation is already marked unverified.",
    };
  }

  const { cyfsa, others } = identifyInstruments(t);
  const sections = citedSections(t);
  const unverified = (identifiedAct: IdentifiedAct, reason: string): CitationClassification => ({
    status: "UNVERIFIED",
    identifiedAct,
    authorityCategory,
    sections,
    officialVerification: "NOT_CHECKED",
    reason,
  });

  if (cyfsa && others.length > 0) {
    return unverified("MULTIPLE", "This citation names more than one statute or instrument, so it cannot be matched to one provision.");
  }
  if (!cyfsa && others.length > 0) {
    return unverified(
      "OTHER",
      "This citation names a statute, regulation or other instrument other than the CYFSA. The CYFSA reference text does not cover it, so it is not checked."
    );
  }
  if (!cyfsa) {
    if (sections.length > 0) {
      return unverified("NONE", "No Act is identified for this section number, so it cannot be matched to a provision.");
    }
    return none("No statute section is identified in this citation.");
  }
  if (sections.length === 0) {
    return unverified("CYFSA", "The CYFSA is named, but no section is identified.");
  }
  const notInternal = sections.filter((s) => !isVerifiedCyfsaSection(s));
  if (notInternal.length > 0) {
    return unverified(
      "CYFSA",
      `CYFSA section ${notInternal.join(", ")} is not in CYFSA Navigator's internal reference text. That does not show whether the section exists or applies.`
    );
  }
  return {
    status: "INTERNAL_REFERENCE_MATCH",
    identifiedAct: "CYFSA",
    authorityCategory: "CYFSA",
    sections,
    officialVerification: "NOT_CHECKED",
    reason:
      "Matches CYFSA Navigator's internal reference text. Not checked against official e-Laws, and not a finding that the section applies to these facts.",
  };
}

/**
 * The status to display for a stored flag. Recomputed from the citation text, so a stored label cannot make a
 * citation look confirmed. A stored value must also agree before a match is shown: a flag with no recorded status is
 * unverified, never a match.
 */
export function effectiveCitationStatus(flag: { legalReference?: unknown; citationStatus?: unknown } | null | undefined): CitationStatus {
  const text = typeof flag?.legalReference === "string" ? flag.legalReference.trim() : "";
  if (!text) return "NONE";
  const stored = flag?.citationStatus;
  const storedMatch = stored === "INTERNAL_REFERENCE_MATCH" || stored === "CONFIRMED_REFERENCE";
  return storedMatch && classifyCitation(text).status === "INTERNAL_REFERENCE_MATCH" ? "INTERNAL_REFERENCE_MATCH" : "UNVERIFIED";
}
