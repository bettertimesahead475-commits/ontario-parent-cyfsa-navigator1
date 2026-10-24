/**
 * Statute text the analyzer screen may show. Each quotation is copied verbatim from the bundled CYFSA
 * text in legal-reference/CYFSA_full_text_2026-06-24_consolidation.txt. The notes describe only what
 * that text says. A citation with no entry here has no text in the app, and the screen says so.
 * The bundled file dates its consolidation 2026-06-24, but its README gives July 1, 2026 as the
 * start of the consolidation period. That conflict is not resolved here.
 */
export interface BundledStatuteEntry {
  citation: string;
  heading: string;
  text: string;
  note: string;
}

export const STATUTE_ROOT_URL = "https://www.ontario.ca/laws/statute/17c14";

export const BUNDLED_STATUTE_ENTRIES: Record<string, BundledStatuteEntry> = {
  "74(2)": {
    citation: "CYFSA s. 74(2)",
    heading: "Child in need of protection",
    text: "(2)  A child is in need of protection where,\n  (a)  the child has suffered physical harm, inflicted by the person having charge of the child or caused by or resulting from that person’s,\n  (i)  failure to adequately care for, provide for, supervise or protect the child, or\n  (ii)  pattern of neglect in caring for, providing for, supervising or protecting the child;\n  (b)  there is a risk that the child is likely to suffer physical harm inflicted by the person having charge of the child or caused by or resulting from that person’s,\n  (i)  failure to adequately care for, provide for, supervise or protect the child, or\n  (ii)  pattern of neglect in caring for, providing for, supervising or protecting the child;\n  (c)  the child has been sexually abused or sexually exploited, by the person having charge of the child or by another person where the person having charge of the child knows or should know of the possibility of sexual abuse or sexual exploitation and fails to protect the child;\n  (d)  there is a risk that the child is likely to be sexually abused or sexually exploited as described in clause (c);\n  (d.1)  the child has been sexually exploited as a result of being subjected to child sex trafficking;\n  (d.2)  there is a risk that the child is likely to be sexually exploited as a result of being subjected to child sex trafficking;\n  (e)  the child requires treatment to cure, prevent or alleviate physical harm or suffering and the child’s parent or the person having charge of the child does not provide the treatment or access to the treatment, or, where the child is incapable of consenting to the treatment under the *Health Care Consent Act, 1996 *and the parent is a substitute decision-maker for the child, the parent refuses or is unavailable or unable to consent to the treatment on the child’s behalf;\n  (f)  the child has suffered emotional harm, demonstrated by serious,\n  (i)  anxiety,\n  (ii)  depression,\n  (iii)  withdrawal,\n  (iv)  self-destructive or aggressive behaviour, or\n  (v)  delayed development,\n    and there are reasonable grounds to believe that the emotional harm suffered by the child results from the actions, failure to act or pattern of neglect on the part of the child’s parent or the person having charge of the child;\n  (g)  the child has suffered emotional harm of the kind described in subclause (f) (i), (ii), (iii), (iv) or (v) and the child’s parent or the person having charge of the child does not provide services or treatment or access to services or treatment, or, where the child is incapable of consenting to treatment under the Health Care Consent Act, 1996, refuses or is unavailable or unable to consent to the treatment to remedy or alleviate the harm;\n  (h)  there is a risk that the child is likely to suffer emotional harm of the kind described in subclause (f) (i), (ii), (iii), (iv) or (v) resulting from the actions, failure to act or pattern of neglect on the part of the child’s parent or the person having charge of the child;\n  (i)  there is a risk that the child is likely to suffer emotional harm of the kind described in subclause (f) (i), (ii), (iii), (iv) or (v) and that the child’s parent or the person having charge of the child does not provide services or treatment or access to services or treatment, or, where the child is incapable of consenting to treatment under the Health Care Consent Act, 1996, refuses or is unavailable or unable to consent to treatment to prevent the harm;\n  (j)  the child suffers from a mental, emotional or developmental condition that, if not remedied, could seriously impair the child’s development and the child’s parent or the person having charge of the child does not provide treatment or access to treatment, or where the child is incapable of consenting to treatment under the Health Care Consent Act, 1996, refuses or is unavailable or unable to consent to the treatment to remedy or alleviate the condition;\n  (k)  the child’s parent has died or is unavailable to exercise the rights of custody over the child and has not made adequate provision for the child’s care and custody, or the child is in a residential placement and the parent refuses or is unable or unwilling to resume the child’s care and custody;\n  (l)  the child is younger than 12 and has killed or seriously injured another person or caused serious damage to another person’s property, services or treatment are necessary to prevent a recurrence and the child’s parent or the person having charge of the child does not provide services or treatment or access to services or treatment, or, where the child is incapable of consenting to treatment under the Health Care Consent Act, 1996, refuses or is unavailable or unable to consent to treatment;\n  (m)  the child is younger than 12 and has on more than one occasion injured another person or caused loss or damage to another person’s property, with the encouragement of the person having charge of the child or because of that person’s failure or inability to supervise the child adequately;\n  (n)  the child’s parent is unable to care for the child and the child is brought before the court with the parent’s consent and, where the child is 12 or older, with the child’s consent, for the matter to be dealt with under this Part; or\n  (o)  the child is 16 or 17 and a prescribed circumstance or condition exists. 2017, c. 14, Sched. 1, s. 74 (2); 2020, c. 25, Sched. 1, s. 26 (1); 2021, c. 21, Sched. 3, s. 1 (2).",
    note: "Lists the grounds in clauses (a) to (o). The clauses are shown in full.",
  },
  "81(7)": {
    citation: "CYFSA s. 81(7)",
    heading: "Warrantless apprehension",
    text: "(7)  A child protection worker who believes on reasonable and probable grounds that,\n  (a)  a child is in need of protection;\n  (b)  the child is younger than 16; and\n  (c)  there would be a substantial risk to the child’s health or safety during the time necessary to bring the matter on for a hearing under subsection 90 (1) or obtain a warrant under subsection (2),\nmay without a warrant bring the child to a place of safety.",
    note: "Applies only to a child younger than 16, and only where a substantial risk would arise before a hearing or warrant could be obtained.",
  },
  "88": {
    citation: "CYFSA s. 88",
    heading: "Time in place of safety limited",
    text: "As soon as practicable, but in any event within five days after a child is brought to a place of safety under section 81, subclause 83 (1) (a) (ii) or subsection 136 (5),\n  (a)  the matter shall be brought before a court for a hearing under subsection 90 (1) (child protection hearing);\n  (b)  the child shall be returned to the person who last had charge of the child or, where there is an order for the child’s custody that is enforceable in Ontario, to the person entitled to custody under the order;\n  (c)  if the child is the subject of an extra-provincial child protection order, the child shall be returned to the child welfare authority or other person named in the order;\n  (d)  a temporary care agreement shall be made under subsection 75 (1); or\n  (e)  an agreement shall be made under section 77 (agreements with 16 and 17 year olds).",
    note: "The five-day rule. It is a different section from s. 94, which deals with adjournments.",
  },
  "94(1)": {
    citation: "CYFSA s. 94(1)",
    heading: "Adjournment limit",
    text: "(1)  The court shall not adjourn a hearing for more than 30 days,\n  (a)  unless all the parties present and the person who will be caring for the child during the adjournment consent; or\n  (b)  if the court is aware that a party who is not present at the hearing objects to the longer adjournment.",
    note: "Limits how long a hearing may be adjourned. This is not the five-day rule, which is s. 88.",
  },
  "94(2)": {
    citation: "CYFSA s. 94(2)",
    heading: "Temporary care and custody during an adjournment",
    text: "(2)  Where a hearing is adjourned, the court shall make a temporary order for care and custody providing that the child,\n  (a)  remain in or be returned to the care and custody of the person who had charge of the child immediately before intervention under this Part;\n  (b)  remain in or be returned to the care and custody of the person referred to in clause (a), subject to the society’s supervision and on such reasonable terms and conditions as the court considers appropriate;\n  (c)  be placed in the care and custody of a person other than the person referred to in clause (a), with the consent of that other person, subject to the society’s supervision and on such reasonable terms and conditions as the court considers appropriate; or\n  (d)  remain or be placed in the care and custody of the society, but not be placed in a place of temporary detention, of open or of secure custody.",
    note: "The court must make one of the temporary orders in clauses (a) to (d). Clauses (c) and (d) are limited by subsection (4).",
  },
};

/**
 * Maps a citation to a bundled entry by its section and subsection. Only an exact match counts.
 * "94" alone, "94(5)", "81" alone and "2" each have no entry, so they return null.
 */
export function findBundledStatute(citation: string): BundledStatuteEntry | null {
  const match = /(?:^|\bs\.?\s*|\bsection\s+)(\d+)(?:\s*\(\s*(\d+)\s*\))?/i.exec(citation.trim());
  if (!match) return null;
  const key = match[2] ? `${match[1]}(${match[2]})` : match[1];
  return BUNDLED_STATUTE_ENTRIES[key] ?? null;
}

export interface StatuteDetails {
  title: string;
  subtitle: string;
  /** Verbatim bundled text, or null when the app holds none for this citation. */
  exactText: string | null;
  explanation: string;
}

export function statuteDetailsFor(citation: string): StatuteDetails {
  const entry = findBundledStatute(citation);
  if (entry) {
    return { title: entry.citation, subtitle: entry.heading, exactText: entry.text, explanation: entry.note };
  }
  return {
    title: citation,
    subtitle: "No bundled text",
    exactText: null,
    explanation: "The app holds no text for this citation, so it has not been checked against the statute. Confirm it with counsel.",
  };
}
