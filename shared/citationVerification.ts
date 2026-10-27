/**
 * Citation classification for analyzer reports. Pure, so the server and the UI apply the same rules.
 *
 * What this module does: it decides whether a citation can be matched to CYFSA Navigator's INTERNAL reference text.
 * It identifies which Act a citation names, then checks the section numbers against the internal list.
 *
 * What this module does NOT do: it does not verify anything against official legislation. The internal list has
 * not been checked against e-Laws. A match here does not show that a section exists in its current form, and it does
 * not show that the section applies to the facts of any case. Official verification is a separate step that has not
 * been performed.
 */

/** Section keys present in the internal reference text (src/utils/statuteReference.ts). Keep the two in step; a test checks it. */
export const INTERNAL_CYFSA_SECTION_KEYS = ["74(2)", "81(7)", "88", "94(1)", "94(2)"] as const;

export const CITATION_UNVERIFIED_NOTE =
  "⚠️ Statute citation unverified — confirm exact section with counsel before relying on this.";

export type CitationStatus = "INTERNAL_REFERENCE_MATCH" | "UNVERIFIED" | "NONE";
export type IdentifiedAct = "CYFSA" | "OTHER" | "MULTIPLE" | "NONE";

export interface CitationClassification {
  status: CitationStatus;
  identifiedAct: IdentifiedAct;
  /** Section keys the citation names, such as "74(2)" or "88". */
  sections: string[];
  /** Always NOT_CHECKED: no official legislation was consulted. */
  officialVerification: "NOT_CHECKED";
  /** Plain-language reason, shown to the user with the status. */
  reason: string;
}

// Stripped before the other-instrument scan, so the CYFSA's own name does not count as "another Act".
const cyfsaNamePattern = () =>
  /\bCYFSA\b|Child,?\s+Youth\s+and\s+Family\s+Services\s+Act|S\.\s*O\.\s*2017,?\s*c\.\s*14/gi;

// Any other statute, regulation, rules set, charter or code. Including a bare "Act" is deliberate: an unnamed
// "the Act" is ambiguous, so it is not treated as the CYFSA.
const otherInstrumentPattern = () =>
  /\b(?:Acts?|Codes?|Charter|Regulations?|Regs?|Rules?|CLRA|R\.R\.O\.|R\.S\.O\.|S\.\s*O\.|O\.\s*Reg\.?|Bills?|Statutes?)\b/gi;

/**
 * Every section number a citation names, including lists such as "ss. 74(2) and 125(1)" or "s. 74(2), 94(5)".
 * Only numbers introduced by a section keyword count, so "S.O. 2017, c. 14" adds nothing.
 */
export function citedSections(text: string): string[] {
  const out: string[] = [];
  // Keyword, then a list of items: "74(2)" or a bare subsection "(5)" continuing the previous section.
  const list =
    /\b(?:s|ss|sec|secs|section|sections|subs?|subsections?)\.?\s*((?:(?:\d{1,3}(?:\(\d+\))*|\(\d+\))(?:\([a-z]\))*(?:\s*(?:,|and|or|&|to|-|–)\s*)?)+)/gi;
  for (const m of text.matchAll(list)) {
    let base = "";
    for (const item of m[1].matchAll(/(\d{1,3})((?:\(\d+\))*)|\((\d+)\)/g)) {
      if (item[1]) {
        base = item[1];
        out.push(item[1] + item[2]);
      } else if (base) {
        out.push(`${base}(${item[3]})`);
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
 * Classifies one citation against the internal reference text.
 *
 * Rules, in order (the first that applies decides):
 * 1. Empty text: NONE.
 * 2. Text already marked unverified: UNVERIFIED.
 * 3. Names a CYFSA and another instrument: UNVERIFIED (MULTIPLE). Mixed citations are never confirmed.
 * 4. Names another instrument only (Family Law Act, Criminal Code, CLRA, regulations): UNVERIFIED (OTHER).
 *    A section number under such a name is never read as a CYFSA provision.
 * 5. Section numbers with no Act identified: UNVERIFIED (NONE). "s. 81(7)" alone could be any Act.
 * 6. CYFSA named with no section: UNVERIFIED. An Act name alone does not identify a provision.
 * 7. CYFSA with a section that is not on the internal list: UNVERIFIED. That is a gap in the internal list, not
 *    a finding about the law.
 * 8. CYFSA with only internal-list sections: INTERNAL_REFERENCE_MATCH. Still not verified against e-Laws, and not
 *    a statement that the section applies.
 */
export function classifyCitation(text: string | null | undefined): CitationClassification {
  const t = (text || "").trim();
  const none = (reason: string): CitationClassification => ({
    status: "NONE",
    identifiedAct: "NONE",
    sections: [],
    officialVerification: "NOT_CHECKED",
    reason,
  });
  if (!t) return none("No statute is cited for this point.");
  if (/unverified/i.test(t)) {
    return {
      status: "UNVERIFIED",
      identifiedAct: identifyInstruments(t).cyfsa ? "CYFSA" : "NONE",
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
  const internal = new Set<string>(INTERNAL_CYFSA_SECTION_KEYS);
  const notInternal = sections.filter((s) => !internal.has(s));
  if (notInternal.length > 0) {
    return unverified(
      "CYFSA",
      `CYFSA section ${notInternal.join(", ")} is not in CYFSA Navigator's internal reference text. That does not show whether the section exists or applies.`
    );
  }
  return {
    status: "INTERNAL_REFERENCE_MATCH",
    identifiedAct: "CYFSA",
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
