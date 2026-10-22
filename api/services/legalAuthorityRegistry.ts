/**
 * Curated legal authority registry for the Document Analyzer.
 *
 * Why this exists: a language model must never be the source of a citation, a holding, or a link.
 * The analyzer therefore asks the model to point at authorities BY KEY from this closed list; the
 * server turns a key into the citation, wording and link recorded here. Anything the model writes
 * that is not a registry key is shown as an UNVERIFIED legal reference.
 *
 * Status rules (see shared/legalFindings.ts):
 *   - An entry is CANDIDATE until a retrieval check is recorded for it in
 *     legalAuthorityVerification.ts (produced by `npm run verify:authorities`, which fetches the
 *     published source and confirms the page matches). Only then is it VERIFIED.
 *   - Editing any citation, link or wording below changes the entry's fingerprint, which
 *     invalidates its recorded check until the script is run again.
 *
 * Content rules:
 *   - `generallyCitedFor` and `testOutline` are short orientation notes written by CYFSA Navigator,
 *     not quotations and not legal advice. Keep them conservative and general.
 *   - `officialUrl` is set only where the link pattern is well established. Case entries without a
 *     deep link carry a `lookupUrl` (a real landing page) instead of a guessed address.
 *   - Statutory wording (`text`) is included only where it is recorded verbatim; the verification
 *     script also checks that the published page contains it.
 */

import type { AuthorityKind, CharterSection, LegalReference, LinkStatus, AuthorityStatus } from "../../shared/legalFindings.js";
import { LEGAL_AUTHORITY_VERIFICATION, type AuthorityVerificationRecord } from "./legalAuthorityVerification.js";

export const REGISTRY_VERSION = "2026-10-13";

export interface RegistryEntry {
  key: string;
  kind: AuthorityKind;
  citation: string;
  title: string;
  pinpoint?: string;
  court?: string;
  year?: number;
  /** Where the entry is published: governs how the verification script reads the page. */
  publisher: "JUSTICE_LAWS" | "ONTARIO_E_LAWS" | "CANLII";
  officialUrl?: string;
  lookupUrl?: string;
  lookupLabel?: string;
  /** Charter sections this authority is cited for; cases are only attached to matching findings. */
  charterSections?: CharterSection[];
  /** True for authorities of general application (evidence, standard of proof) in any section. */
  general?: boolean;
  topics: string[];
  text?: string;
  generallyCitedFor?: string;
  testOutline?: string;
  /** Strings the fetched page must contain for the entry to count as verified. */
  verifyText: string[];
  /** Listed in CYFSA Navigator's earlier owner-confirmed statute reference (not a retrieval check). */
  confirmedReference?: boolean;
  limitation?: string;
}

const CHARTER_URL = "https://laws-lois.justice.gc.ca/eng/const/page-12.html";
const CYFSA_URL = "https://www.ontario.ca/laws/statute/17c14";
const FLR_URL = "https://www.ontario.ca/laws/regulation/990114";
const CANLII_SCC_HOME = "https://www.canlii.org/en/ca/scc/";

const charter = (
  n: CharterSection,
  pinpoint: string,
  title: string,
  extra: Partial<RegistryEntry>
): RegistryEntry => ({
  key: `charter-s${n}`,
  kind: "CHARTER",
  citation: "Canadian Charter of Rights and Freedoms, Part I of the Constitution Act, 1982",
  title,
  pinpoint,
  publisher: "JUSTICE_LAWS",
  officialUrl: CHARTER_URL,
  charterSections: [n],
  topics: ["charter"],
  verifyText: ["Canadian Charter of Rights and Freedoms"],
  ...extra,
});

const scc = (
  key: string,
  citation: string,
  title: string,
  year: number,
  extra: Partial<RegistryEntry>
): RegistryEntry => ({
  key,
  kind: "CASE",
  citation,
  title,
  court: "Supreme Court of Canada",
  year,
  publisher: "CANLII",
  lookupUrl: CANLII_SCC_HOME,
  lookupLabel: "Look up on CanLII (supplementary source)",
  topics: [],
  verifyText: [citation.match(/\d{4} SCC \d+/)?.[0] ?? title],
  limitation:
    "Not a child-protection decision: the legal test is general, and whether and how it applies in a child-protection proceeding is a question for counsel.",
  ...extra,
});

export const LEGAL_AUTHORITY_REGISTRY: RegistryEntry[] = [
  // ----- Charter provisions -------------------------------------------------------------------
  charter("1", "s. 1", "Reasonable limits", {
    text: "The Canadian Charter of Rights and Freedoms guarantees the rights and freedoms set out in it subject only to such reasonable limits prescribed by law as can be demonstrably justified in a free and democratic society.",
    generallyCitedFor: "Even where a Charter right is infringed, the infringement can be upheld if it is a reasonable limit that is demonstrably justified.",
    verifyText: ["reasonable limits prescribed by law"],
  }),
  charter("7", "s. 7", "Life, liberty and security of the person", {
    text: "Everyone has the right to life, liberty and security of the person and the right not to be deprived thereof except in accordance with the principles of fundamental justice.",
    testOutline:
      "(1) Does the state action interfere with life, liberty or security of the person? (2) If so, is the deprivation inconsistent with the principles of fundamental justice (for example, unfair procedure, arbitrariness, overbreadth or gross disproportionality)?",
    verifyText: ["life, liberty and security of the person"],
  }),
  charter("8", "s. 8", "Search or seizure", {
    text: "Everyone has the right to be secure against unreasonable search or seizure.",
    testOutline:
      "(1) Did the state conduct a search or seizure, which turns on whether there was a reasonable expectation of privacy in the subject matter? (2) If so, was it reasonable: authorized by law, under a reasonable law, and carried out in a reasonable manner?",
    verifyText: ["unreasonable search or seizure"],
  }),
  charter("9", "s. 9", "Arbitrary detention or imprisonment", {
    text: "Everyone has the right not to be arbitrarily detained or imprisoned.",
    testOutline: "(1) Was the person detained (a physical or psychological restraint, or a legal obligation to comply)? (2) If so, was the detention arbitrary, meaning not authorized by law or not carried out in accordance with a reasonable law?",
    verifyText: ["arbitrarily detained or imprisoned"],
  }),
  charter("10", "s. 10", "Rights on arrest or detention", {
    text: "Everyone has the right on arrest or detention (a) to be informed promptly of the reasons therefor; (b) to retain and instruct counsel without delay and to be informed of that right; and (c) to have the validity of the detention determined by way of habeas corpus and to be released if the detention is not lawful.",
    testOutline: "Section 10 rights are triggered only on arrest or detention. The first question is whether the person was detained when the events occurred.",
    verifyText: ["retain and instruct counsel without delay"],
  }),
  charter("12", "s. 12", "Cruel and unusual treatment or punishment", {
    text: "Everyone has the right not to be subjected to any cruel and unusual treatment or punishment.",
    testOutline: "(1) Is there state treatment or punishment? (2) If so, is it grossly disproportionate: so excessive as to outrage standards of decency?",
    limitation: "Section 12 is rarely engaged outside criminal sentencing. Treat any s. 12 point in a child-protection file as needing a strong factual foundation.",
    verifyText: ["cruel and unusual treatment or punishment"],
  }),
  charter("15", "s. 15(1)", "Equality rights", {
    text: "Every individual is equal before and under the law and has the right to the equal protection and equal benefit of the law without discrimination and, in particular, without discrimination based on race, national or ethnic origin, colour, religion, sex, age or mental or physical disability.",
    testOutline:
      "(1) Does the law or state action, on its face or in its effect, create a distinction based on an enumerated or analogous ground? (2) Does it impose a burden or deny a benefit in a manner that has the effect of reinforcing, perpetuating or exacerbating disadvantage?",
    verifyText: ["equal protection and equal benefit of the law"],
  }),
  charter("24", "s. 24(1)", "Enforcement: remedies", {
    generallyCitedFor: "Section 24(1) lets a court grant an appropriate and just remedy where a Charter right has been infringed. Which remedies are available in a child-protection proceeding is for counsel to assess.",
    verifyText: ["appropriate and just"],
  }),

  // ----- Ontario statute and rules ------------------------------------------------------------
  {
    key: "cyfsa-s74-2",
    kind: "STATUTE",
    citation: "Child, Youth and Family Services Act, 2017, S.O. 2017, c. 14, Sched. 1",
    title: "Child in need of protection",
    pinpoint: "s. 74(2)",
    publisher: "ONTARIO_E_LAWS",
    officialUrl: CYFSA_URL,
    topics: ["cyfsa", "protection-grounds"],
    generallyCitedFor: "Section 74(2) defines when a child is in need of protection.",
    confirmedReference: true,
    verifyText: ["Child, Youth and Family Services Act, 2017"],
  },
  {
    key: "cyfsa-s81",
    kind: "STATUTE",
    citation: "Child, Youth and Family Services Act, 2017, S.O. 2017, c. 14, Sched. 1",
    title: "Warrants and apprehension procedure",
    pinpoint: "s. 81",
    publisher: "ONTARIO_E_LAWS",
    officialUrl: CYFSA_URL,
    topics: ["cyfsa", "apprehension"],
    generallyCitedFor: "Section 81 is generally referred to for apprehension and warrant procedure.",
    limitation: "The exact subsection for a given point is not in CYFSA Navigator's confirmed statute reference; confirm it with counsel before relying on it.",
    verifyText: ["Child, Youth and Family Services Act, 2017"],
  },
  {
    key: "cyfsa-s94-1",
    kind: "STATUTE",
    citation: "Child, Youth and Family Services Act, 2017, S.O. 2017, c. 14, Sched. 1",
    title: "Adjournments: 30-day limit",
    pinpoint: "s. 94(1)",
    publisher: "ONTARIO_E_LAWS",
    officialUrl: CYFSA_URL,
    topics: ["cyfsa", "adjournment", "timelines"],
    text: "The court shall not adjourn a hearing for more than 30 days, (a) unless all the parties present and the person who will be caring for the child during the adjournment consent; or (b) if the court is aware that a party who is not present at the hearing objects to the longer adjournment.",
    generallyCitedFor: "Limits how long a child-protection hearing can be adjourned, with the exceptions stated in the section.",
    confirmedReference: true,
    verifyText: ["Child, Youth and Family Services Act, 2017", "adjourn a hearing for more than 30 days"],
  },
  {
    key: "cyfsa-s94-5",
    kind: "STATUTE",
    citation: "Child, Youth and Family Services Act, 2017, S.O. 2017, c. 14, Sched. 1",
    title: "Temporary care and custody: placement with a relative",
    pinpoint: "s. 94(5)",
    publisher: "ONTARIO_E_LAWS",
    officialUrl: CYFSA_URL,
    topics: ["cyfsa", "kinship", "placement"],
    generallyCitedFor: "Before a temporary order for care and custody, the court considers whether placing the child with a relative or member of the extended family or community is in the child's best interests. It is not a hearing-timeline rule.",
    confirmedReference: true,
    verifyText: ["Child, Youth and Family Services Act, 2017"],
  },
  {
    key: "cyfsa-s125-1",
    kind: "STATUTE",
    citation: "Child, Youth and Family Services Act, 2017, S.O. 2017, c. 14, Sched. 1",
    title: "Duty to report a child in need of protection",
    pinpoint: "s. 125(1)",
    publisher: "ONTARIO_E_LAWS",
    officialUrl: CYFSA_URL,
    topics: ["cyfsa", "duty-to-report"],
    generallyCitedFor: "The duty to report is triggered by reasonable grounds to suspect; it is a reporting standard, not proof that maltreatment occurred.",
    confirmedReference: true,
    verifyText: ["Child, Youth and Family Services Act, 2017"],
  },
  {
    key: "flr-r14-18",
    kind: "COURT_RULE",
    citation: "Family Law Rules, O. Reg. 114/99",
    title: "Affidavits: knowledge and belief",
    pinpoint: "r. 14(18)",
    publisher: "ONTARIO_E_LAWS",
    officialUrl: FLR_URL,
    topics: ["evidence", "affidavits", "hearsay"],
    general: true,
    generallyCitedFor: "Affidavits on a motion should, as far as possible, be based on the person's own firsthand knowledge.",
    confirmedReference: true,
    verifyText: ["Family Law Rules"],
  },
  {
    key: "flr-r14-19",
    kind: "COURT_RULE",
    citation: "Family Law Rules, O. Reg. 114/99",
    title: "Affidavits: information from another named source",
    pinpoint: "r. 14(19)",
    publisher: "ONTARIO_E_LAWS",
    officialUrl: FLR_URL,
    topics: ["evidence", "affidavits", "hearsay"],
    general: true,
    generallyCitedFor: "Information from another named source may be included in a motion affidavit if the person states a belief that it is true; secondhand material is not automatically inadmissible.",
    confirmedReference: true,
    verifyText: ["Family Law Rules"],
  },

  // ----- Supreme Court of Canada ---------------------------------------------------------------
  scc("case-klw-2000", "Winnipeg Child and Family Services v. K.L.W., 2000 SCC 48, [2000] 2 S.C.R. 519", "Winnipeg Child and Family Services v. K.L.W.", 2000, {
    officialUrl: "https://www.canlii.org/en/ca/scc/doc/2000/2000scc48/2000scc48.html",
    charterSections: ["7"],
    topics: ["child-protection", "apprehension", "section-7"],
    generallyCitedFor: "A child-protection apprehension that interferes with the parent-child relationship can engage the parent's security of the person under s. 7; the case then considers whether the procedure met fundamental justice.",
    limitation: undefined,
  }),
  scc("case-gj-1999", "New Brunswick (Minister of Health and Community Services) v. G. (J.), [1999] 3 S.C.R. 46", "New Brunswick (Minister of Health and Community Services) v. G. (J.)", 1999, {
    charterSections: ["7"],
    topics: ["child-protection", "legal-representation", "section-7"],
    generallyCitedFor: "Section 7 may require state-funded counsel for a parent in some child-protection custody proceedings, assessed case by case on the seriousness of the interests, the complexity of the case and the parent's capacity.",
    verifyText: ["New Brunswick (Minister of Health and Community Services) v. G. (J.)"],
    limitation: undefined,
  }),
  scc("case-cfcyl-2004", "Canadian Foundation for Children, Youth and the Law v. Canada (Attorney General), 2004 SCC 4, [2004] 1 S.C.R. 76", "Canadian Foundation for Children, Youth and the Law v. Canada (Attorney General)", 2004, {
    officialUrl: "https://www.canlii.org/en/ca/scc/doc/2004/2004scc4/2004scc4.html",
    charterSections: ["7"],
    topics: ["children", "best-interests", "section-7"],
    generallyCitedFor: "Discusses the best interests of the child as a legal principle in the s. 7 analysis.",
  }),
  scc("case-khelawon-2006", "R. v. Khelawon, 2006 SCC 57, [2006] 2 S.C.R. 787", "R. v. Khelawon", 2006, {
    officialUrl: "https://www.canlii.org/en/ca/scc/doc/2006/2006scc57/2006scc57.html",
    general: true,
    topics: ["hearsay", "evidence"],
    generallyCitedFor: "Principled approach to hearsay: whether the evidence is necessary and sufficiently reliable.",
  }),
  scc("case-fh-mcdougall-2008", "F.H. v. McDougall, 2008 SCC 53, [2008] 3 S.C.R. 41", "F.H. v. McDougall", 2008, {
    officialUrl: "https://www.canlii.org/en/ca/scc/doc/2008/2008scc53/2008scc53.html",
    general: true,
    topics: ["standard-of-proof", "evidence"],
    generallyCitedFor: "In civil cases there is one standard of proof, the balance of probabilities; the evidence must be sufficiently clear, convincing and cogent, but there is no higher standard for serious allegations.",
    limitation: "A civil-evidence decision, not a child-protection decision; counsel will say how it applies to the standard in a protection hearing.",
  }),
  scc("case-hunter-1984", "Hunter et al. v. Southam Inc., [1984] 2 S.C.R. 145", "Hunter et al. v. Southam Inc.", 1984, {
    charterSections: ["8"],
    topics: ["search-seizure", "privacy", "section-8"],
    generallyCitedFor: "Section 8 protects a reasonable expectation of privacy and generally calls for prior authorization of a search.",
    verifyText: ["Southam"],
  }),
  scc("case-collins-1987", "R. v. Collins, [1987] 1 S.C.R. 265", "R. v. Collins", 1987, {
    charterSections: ["8"],
    topics: ["search-seizure", "section-8"],
    generallyCitedFor: "A search is reasonable if it is authorized by law, the law is reasonable, and the search is carried out in a reasonable manner.",
    verifyText: ["R. v. Collins"],
  }),
  scc("case-tessling-2004", "R. v. Tessling, 2004 SCC 67, [2004] 3 S.C.R. 432", "R. v. Tessling", 2004, {
    officialUrl: "https://www.canlii.org/en/ca/scc/doc/2004/2004scc67/2004scc67.html",
    charterSections: ["8"],
    topics: ["privacy", "section-8"],
    generallyCitedFor: "Sets out the factors for deciding whether a person had a reasonable expectation of privacy.",
  }),
  scc("case-grant-2009", "R. v. Grant, 2009 SCC 32, [2009] 2 S.C.R. 353", "R. v. Grant", 2009, {
    officialUrl: "https://www.canlii.org/en/ca/scc/doc/2009/2009scc32/2009scc32.html",
    charterSections: ["9", "10", "24"],
    topics: ["detention", "section-9", "section-10", "section-24"],
    generallyCitedFor: "Explains when a person is detained (including psychological detention) and the framework for excluding evidence under s. 24(2).",
  }),
  scc("case-suberu-2009", "R. v. Suberu, 2009 SCC 33, [2009] 2 S.C.R. 460", "R. v. Suberu", 2009, {
    officialUrl: "https://www.canlii.org/en/ca/scc/doc/2009/2009scc33/2009scc33.html",
    charterSections: ["10"],
    topics: ["right-to-counsel", "section-10"],
    generallyCitedFor: "The s. 10(b) duties to inform a person of the right to counsel and to give an opportunity to use it are triggered on detention.",
  }),
  scc("case-smith-1987", "R. v. Smith (Edward Dewey), [1987] 1 S.C.R. 1045", "R. v. Smith (Edward Dewey)", 1987, {
    charterSections: ["12"],
    topics: ["cruel-unusual", "section-12"],
    generallyCitedFor: "Section 12 is infringed only where treatment or punishment is grossly disproportionate.",
    verifyText: ["Edward Dewey"],
  }),
  scc("case-nur-2015", "R. v. Nur, 2015 SCC 15, [2015] 1 S.C.R. 773", "R. v. Nur", 2015, {
    officialUrl: "https://www.canlii.org/en/ca/scc/doc/2015/2015scc15/2015scc15.html",
    charterSections: ["12"],
    topics: ["cruel-unusual", "section-12"],
    generallyCitedFor: "Applies the gross-disproportionality standard, including to reasonably foreseeable cases.",
  }),
  scc("case-andrews-1989", "Andrews v. Law Society of British Columbia, [1989] 1 S.C.R. 143", "Andrews v. Law Society of British Columbia", 1989, {
    charterSections: ["15"],
    topics: ["equality", "section-15"],
    generallyCitedFor: "Foundational decision on substantive equality and analogous grounds under s. 15.",
    verifyText: ["Law Society of British Columbia"],
  }),
  scc("case-fraser-2020", "Fraser v. Canada (Attorney General), 2020 SCC 28, [2020] 3 S.C.R. 113", "Fraser v. Canada (Attorney General)", 2020, {
    officialUrl: "https://www.canlii.org/en/ca/scc/doc/2020/2020scc28/2020scc28.html",
    charterSections: ["15"],
    topics: ["equality", "adverse-effects", "section-15"],
    generallyCitedFor: "Restates the two-step s. 15 test and the treatment of adverse-effects discrimination.",
  }),
  scc("case-ref-fnim-2024", "Reference re An Act respecting First Nations, Inuit and Métis children, youth and families, 2024 SCC 5", "Reference re An Act respecting First Nations, Inuit and Métis children, youth and families", 2024, {
    officialUrl: "https://www.canlii.org/en/ca/scc/doc/2024/2024scc5/2024scc5.html",
    topics: ["indigenous", "child-welfare"],
    generallyCitedFor: "Upheld federal legislation affirming Indigenous jurisdiction over child and family services. Relevant context where Indigenous heritage is in issue; it is a division-of-powers reference, not a Charter test.",
    limitation: "Context only: it does not set a Charter test. Ask counsel how the Indigenous child-welfare framework applies to this file.",
  }),
];

const BY_KEY = new Map(LEGAL_AUTHORITY_REGISTRY.map((e) => [e.key, e]));

export function getRegistryEntry(key: string): RegistryEntry | undefined {
  return BY_KEY.get(key);
}

/** Identity of what a recorded retrieval check covered. Editing the entry invalidates its check. */
export function entryFingerprint(e: RegistryEntry): string {
  return [e.citation, e.pinpoint ?? "", e.officialUrl ?? "", e.lookupUrl ?? "", e.text ?? "", e.verifyText.join("␟")].join("␞");
}

export function statusFor(
  e: RegistryEntry,
  records: Record<string, AuthorityVerificationRecord> = LEGAL_AUTHORITY_VERIFICATION.entries
): { status: AuthorityStatus; urlStatus: LinkStatus } {
  const url = e.officialUrl;
  const rec = records[e.key];
  const current = rec && rec.fingerprint === entryFingerprint(e);
  if (!current) return { status: "CANDIDATE", urlStatus: url ? "UNCHECKED" : "NONE" };
  if (rec.ok) return { status: "VERIFIED", urlStatus: url ? "VERIFIED" : "NONE" };
  // The publisher could not be read (blocked, rate-limited, offline): nothing is learned about the link.
  if (rec.inconclusive) return { status: "CANDIDATE", urlStatus: url ? "UNCHECKED" : "NONE" };
  // A definite failure (not found, or the page does not match) never leaves the link clickable
  // and never counts as verified.
  return { status: "CANDIDATE", urlStatus: url ? "BROKEN" : "NONE" };
}

/** Turns a registry key into the reference attached to a finding. Returns null for unknown keys. */
export function referenceFromKey(
  key: string,
  records?: Record<string, AuthorityVerificationRecord>
): LegalReference | null {
  const e = getRegistryEntry(key);
  if (!e) return null;
  const { status, urlStatus } = statusFor(e, records);
  const brokenNote = urlStatus === "BROKEN" ? "The last link check for this authority failed, so the link is withheld. Look it up from the citation." : undefined;
  const limitation = [e.limitation, brokenNote].filter(Boolean).join(" ") || undefined;
  return {
    key: e.key,
    kind: e.kind,
    citation: e.citation,
    title: e.title,
    pinpoint: e.pinpoint,
    status,
    url: urlStatus === "BROKEN" ? undefined : e.officialUrl,
    urlStatus,
    lookupUrl: e.lookupUrl,
    lookupLabel: e.lookupLabel,
    statuteText: e.text,
    generallyCitedFor: e.generallyCitedFor,
    testOutline: e.testOutline,
    limitation,
    confirmedReference: e.confirmedReference || undefined,
  };
}

/** A reference for text the model wrote that is not in the registry. Never carries a link. */
export function unverifiedReference(text: string): LegalReference {
  const citation = String(text || "").replace(/\s+/g, " ").trim().slice(0, 300);
  return {
    kind: "OTHER",
    citation,
    title: "Legal reference not in CYFSA Navigator's authority registry",
    status: "UNVERIFIED",
    urlStatus: "NONE",
    limitation: "This reference was written by the analysis model and could not be matched to an authority CYFSA Navigator has curated. Do not rely on it until counsel or an official source confirms it.",
  };
}

const norm = (s: string) => s.toLowerCase().replace(/[‘’]/g, "'").replace(/\s+/g, " ").replace(/[.,]/g, "").trim();

/** Finds a registry entry that a free-text citation refers to (by neutral or reporter citation). */
export function matchRegistryByCitation(text: string): RegistryEntry | undefined {
  const t = norm(text);
  if (!t) return undefined;
  for (const e of LEGAL_AUTHORITY_REGISTRY) {
    if (e.kind !== "CASE") continue;
    // The primary citation, e.g. "2009 SCC 32" or "[1987] 1 S.C.R. 265", must appear.
    const parts = e.citation.split(/,\s*(?=\[|\d{4} SCC)/);
    const primary = norm(parts.find((p) => /\bSCC\b|S\.C\.R\./.test(p)) ?? e.citation);
    if (primary && t.includes(primary)) return e;
  }
  return undefined;
}

/** Compact registry listing for the prompt: the only authorities the model may point to. */
export function registryPromptList(): string {
  return LEGAL_AUTHORITY_REGISTRY.map((e) => {
    const where = e.kind === "CASE" ? `${e.title} (${e.citation.match(/(\d{4} SCC \d+|\[\d{4}\][^,]*)/)?.[0] ?? e.year})` : `${e.title}${e.pinpoint ? ` - ${e.pinpoint}` : ""}`;
    const scope = e.charterSections?.length ? ` [Charter s. ${e.charterSections.join(", ")}]` : e.general ? " [general]" : "";
    return `${e.key}: ${where}${scope}`;
  }).join("\n");
}

/** Is this registry entry allowed to be attached to a finding about the given Charter section? */
export function authorityFitsCharterSection(e: RegistryEntry, section: CharterSection): boolean {
  if (e.kind === "CHARTER") return e.charterSections?.includes(section) === true || (e.key === "charter-s1") || (e.key === "charter-s24");
  if (e.kind === "CASE") return e.general === true || e.charterSections?.includes(section) === true || e.topics.includes("indigenous");
  // Statutes and rules (CYFSA, Family Law Rules) apply as context to any section.
  return true;
}
