/**
 * Deterministic case-level analysis over the extracted case model. Produces LEADS for the investigator, never
 * findings: a lead says where two records may disagree or where a date may be out of order, and the investigator
 * (Claude Opus) decides, from the documents, whether it matters. Nothing here concludes anything about a person.
 */

import type { CaseClaim, CaseEvent, EvidenceRef } from "./caseModel.js";

export interface DocumentDate {
  documentId: string;
  /** What the date is: when an affidavit was sworn, an order issued, an endorsement made, or a letter written. */
  kind: "SWORN" | "ISSUED" | "ENDORSED" | "WRITTEN" | "UNKNOWN";
  date: string | null;
  dateText: string;
  source: EvidenceRef;
}

export interface ChronologyEntry {
  eventId: string;
  date: string | null;
  dateText: string;
  description: string;
  documentId: string;
  page: number | null;
}

export interface ChronologyAnomaly {
  kind: "EVENT_AFTER_DOCUMENT_DATE";
  eventId: string;
  documentId: string;
  explanation: string;
}

export interface ConflictLead {
  kind: "SAME_DATE_DIFFERENT_DOCUMENTS" | "SAME_ASSERTER_DIFFERENT_DOCUMENTS";
  ids: string[];
  explanation: string;
}

const KIND_WORD: Record<DocumentDate["kind"], string> = {
  SWORN: "sworn",
  ISSUED: "issued",
  ENDORSED: "endorsed",
  WRITTEN: "written",
  UNKNOWN: "dated",
};

/** Events in date order (undated last), each with its source document and page. */
export function buildChronology(events: CaseEvent[]): ChronologyEntry[] {
  return [...events]
    .sort((a, b) => (a.date ?? "9999-99-99").localeCompare(b.date ?? "9999-99-99"))
    .map((e) => ({
      eventId: e.id,
      date: e.date,
      dateText: e.dateText,
      description: e.description,
      documentId: e.sources[0]?.documentId ?? "",
      page: e.sources[0]?.page ?? null,
    }));
}

/**
 * An event a document describes as having happened after the document's own date (an affidavit describing a
 * conversation after it was sworn). Filename and metadata dates never count; they are not dates the record states.
 */
export function findChronologyAnomalies(events: CaseEvent[], documentDates: DocumentDate[]): ChronologyAnomaly[] {
  const out: ChronologyAnomaly[] = [];
  for (const e of events) {
    if (!e.date || (e.dateSource !== "COURT_RECORD" && e.dateSource !== "DOCUMENT_BODY")) continue;
    const docId = e.sources[0]?.documentId;
    for (const d of documentDates) {
      if (d.documentId !== docId || !d.date || d.kind === "UNKNOWN") continue;
      if (e.date > d.date) {
        out.push({
          kind: "EVENT_AFTER_DOCUMENT_DATE",
          eventId: e.id,
          documentId: d.documentId,
          explanation: `Event dated ${e.date} ("${e.description}") appears in a document ${KIND_WORD[d.kind]} ${d.date}.`,
        });
      }
    }
  }
  return out;
}

const personKey = (s: string) => s.toLowerCase().replace(/[^a-z]/g, "");

/**
 * Places where records may disagree: two documents describing the same date, and one person making claims in more
 * than one document. Capped so the lead list stays a short index; the investigator still reads every document.
 */
export function findConflictLeads(events: CaseEvent[], claims: CaseClaim[], cap = 40): ConflictLead[] {
  const out: ConflictLead[] = [];
  const byDate = new Map<string, CaseEvent[]>();
  for (const e of events) if (e.date) byDate.set(e.date, [...(byDate.get(e.date) ?? []), e]);
  for (const [date, group] of byDate) {
    const docs = new Set(group.map((e) => e.sources[0]?.documentId));
    if (docs.size > 1) {
      out.push({
        kind: "SAME_DATE_DIFFERENT_DOCUMENTS",
        ids: group.map((e) => e.id),
        explanation: `${docs.size} documents describe ${date}. Compare their accounts.`,
      });
    }
  }
  const byAsserter = new Map<string, CaseClaim[]>();
  for (const c of claims) {
    const k = personKey(c.assertedBy);
    if (k) byAsserter.set(k, [...(byAsserter.get(k) ?? []), c]);
  }
  for (const group of byAsserter.values()) {
    const docs = new Set(group.map((c) => c.sources[0]?.documentId));
    if (docs.size > 1) {
      out.push({
        kind: "SAME_ASSERTER_DIFFERENT_DOCUMENTS",
        ids: group.map((c) => c.id),
        explanation: `${group[0].assertedBy} makes claims in ${docs.size} documents. Check them for consistency.`,
      });
    }
  }
  return out.slice(0, cap);
}
