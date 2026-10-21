/**
 * Court-preparation logic. Pure functions over the sectioned report contract and parent-entered notes.
 *
 * Rules enforced here:
 *  - Every chronology row carries its source reference and its event type. Dates are never invented.
 *  - A scheduled or stated hearing date is never presented as a hearing that happened.
 *  - Analyzer findings and parent-supplied information are kept in separate lists.
 *  - No deadline is calculated. Dates from documents are listed for checking only.
 */
import type { ReportContract, ReportFinding, SourceReference } from "./reportContract";
import { buildSectionedReport } from "./reportSections";

export type EventType =
  | "ALLEGED_EVENT"
  | "DOCUMENT_EVENT"
  | "COURT_ORDER"
  | "JUDICIAL_FINDING"
  | "STATED_HEARING_DATE"
  | "UNCLASSIFIED_EVENT";

export const EVENT_TYPE_LABEL: Record<EventType, string> = {
  ALLEGED_EVENT: "Alleged event (a party says it happened)",
  DOCUMENT_EVENT: "Event recorded in a document",
  COURT_ORDER: "Court order or endorsement",
  JUDICIAL_FINDING: "Judge's finding",
  STATED_HEARING_DATE: "Hearing date stated in a document (may be scheduled; not confirmed as held)",
  UNCLASSIFIED_EVENT: "Event described in a document (not yet classified)",
};

export interface ChronologyRow {
  id: string;
  /** Date exactly as written in the source, or "Undated". */
  dateAsWritten: string;
  /** Parsed date for sorting only. Null when the text is not an unambiguous calendar date. */
  sortDate: string | null;
  event: string;
  eventType: EventType;
  source: SourceReference[];
  /** Analyzer finding this row comes from. */
  findingId: string;
  /** Findings that show this date is disputed. Empty when none were found. */
  disputedByFindingIds: string[];
  verification: "FROM_ANALYZER_FINDING" | "STATED_IN_DOCUMENT_METADATA";
}

const MONTHS = "January|February|March|April|May|June|July|August|September|October|November|December";
const DATE_RE = new RegExp(`\\b(${MONTHS})\\s+\\d{1,2},\\s+\\d{4}\\b`);

/** Parses only "Month D, YYYY". Any other format is left unsorted rather than guessed. */
export function parseWrittenDate(text: string): string | null {
  const match = text.match(DATE_RE);
  if (!match) return null;
  const t = Date.parse(match[0]);
  return Number.isNaN(t) ? null : new Date(t).toISOString().slice(0, 10);
}

function eventTypeFor(f: ReportFinding): EventType {
  switch (f.kind) {
    case "COURT_ORDER":
    case "JUDICIAL_ENDORSEMENT":
      return "COURT_ORDER";
    case "JUDICIAL_FINDING":
      return "JUDICIAL_FINDING";
    case "PARTY_ALLEGATION":
      return "ALLEGED_EVENT";
    case "EVIDENCE":
      return f.evidenceClassification === "DOCUMENTARY" || f.evidenceClassification === "DIRECT"
        ? "DOCUMENT_EVENT"
        : "UNCLASSIFIED_EVENT";
    default:
      return "UNCLASSIFIED_EVENT";
  }
}

/**
 * Chronology from the report's timeline findings (Section 3) and any hearing date the document states.
 * A stated hearing date becomes its own row, typed as a stated date, never as a completed hearing.
 */
export function buildChronology(contract: ReportContract): ChronologyRow[] {
  const contradictions = contract.findings.filter((f) => f.kind === "CONTRADICTION");
  const rows: ChronologyRow[] = [];

  for (const f of contract.findings.filter((x) => x.sectionId === "S03")) {
    const dateAsWritten = f.title.trim() || "Undated";
    const disputedBy = dateAsWritten !== "Undated"
      ? contradictions.filter((c) => c.whatHappened.includes(dateAsWritten)).map((c) => c.id)
      : [];
    rows.push({
      id: `C-${f.id}`,
      dateAsWritten,
      sortDate: parseWrittenDate(dateAsWritten),
      event: f.whatHappened,
      eventType: eventTypeFor(f),
      source: f.sources,
      findingId: f.id,
      disputedByFindingIds: disputedBy,
      verification: "FROM_ANALYZER_FINDING",
    });
  }

  const hearingFinding = contract.findings.find((f) => f.sectionId === "S02" && /hearing/i.test(f.whatHappened));
  const hearing = hearingFinding?.whatHappened.match(new RegExp(`(${MONTHS})\\s+\\d{1,2},\\s+\\d{4}`));
  if (hearingFinding && hearing) {
    rows.push({
      id: `C-stated-hearing-${hearingFinding.id}`,
      dateAsWritten: hearing[0],
      sortDate: parseWrittenDate(hearing[0]),
      event: "Hearing date stated in the document.",
      eventType: "STATED_HEARING_DATE",
      source: hearingFinding.sources,
      findingId: hearingFinding.id,
      disputedByFindingIds: [],
      verification: "STATED_IN_DOCUMENT_METADATA",
    });
  }

  // Dated rows first in date order; undated and unparsed rows last, in their original order.
  return rows.sort((a, b) => {
    if (a.sortDate && b.sortDate) return a.sortDate.localeCompare(b.sortDate);
    if (a.sortDate) return -1;
    if (b.sortDate) return 1;
    return 0;
  });
}

// ---------------------------------------------------------------------------
// Evidence index
// ---------------------------------------------------------------------------

export interface EvidenceIndexEntry {
  id: string;
  documentId: string;
  locator: string;
  quote: string;
  /** Findings that cite this passage. */
  findingIds: string[];
  origin: "ANALYZER_FINDING";
}

/** One entry per distinct source passage, linked to every finding that cites it. */
export function buildEvidenceIndex(contract: ReportContract): EvidenceIndexEntry[] {
  const map = new Map<string, EvidenceIndexEntry>();
  for (const f of contract.findings) {
    for (const s of f.sources) {
      const key = `${s.documentId}|${s.locator}|${s.quote}`;
      const entry = map.get(key) ?? {
        id: `E-${fnv(key)}`,
        documentId: s.documentId,
        locator: s.locator,
        quote: s.quote,
        findingIds: [],
        origin: "ANALYZER_FINDING" as const,
      };
      if (!entry.findingIds.includes(f.id)) entry.findingIds.push(f.id);
      map.set(key, entry);
    }
  }
  return [...map.values()];
}

function fnv(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i += 1) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
}

// ---------------------------------------------------------------------------
// Allegations and parent responses
// ---------------------------------------------------------------------------

/** Findings that quote a passage of the uploaded text are the allegations to respond to. */
export function allegationsFor(contract: ReportContract): ReportFinding[] {
  return contract.findings.filter((f) => f.kind !== "SUMMARY" && f.sources.some((s) => s.quote.trim().length > 0));
}

export interface FactualResponse {
  allegationFindingId: string;
  /** Written by the parent. Empty until the parent writes it. Never generated. */
  parentAccount: string;
  /** Evidence index entry ids the parent selected as supporting. */
  supportingEntryIds: string[];
  /** Evidence index entry ids the parent selected as contrary. */
  contraryEntryIds: string[];
  /** Points the parent says are not yet supported by any record. */
  unverifiedPoints: string[];
  /** Questions the parent wants to take to counsel. */
  questionsForCounsel: string[];
}

export interface ResponseStatus {
  status: "NOT_YET_WRITTEN" | "WRITTEN_WITH_RECORDS" | "WRITTEN_WITHOUT_RECORDS";
  problems: string[];
}

/** Checks a response without changing it. Unknown evidence ids are reported, not ignored. */
export function checkResponse(response: FactualResponse, index: EvidenceIndexEntry[]): ResponseStatus {
  const known = new Set(index.map((e) => e.id));
  const problems = [...response.supportingEntryIds, ...response.contraryEntryIds]
    .filter((id) => !known.has(id))
    .map((id) => `Evidence reference ${id} is not in the evidence index.`);
  if (!response.parentAccount.trim()) return { status: "NOT_YET_WRITTEN", problems };
  const hasRecords = response.supportingEntryIds.length + response.contraryEntryIds.length > 0;
  return { status: hasRecords ? "WRITTEN_WITH_RECORDS" : "WRITTEN_WITHOUT_RECORDS", problems };
}

// ---------------------------------------------------------------------------
// Deadlines and dates
// ---------------------------------------------------------------------------

/**
 * No deadline is calculated in this version. Each rule must be verified (source, trigger, calendar
 * convention, exceptions) before it can be added here. Until then this list stays empty.
 */
export const VERIFIED_DEADLINE_RULES: never[] = [];

export interface DateCheckItem {
  dateAsWritten: string;
  status: "STATED_IN_DOCUMENT_NEEDS_CONFIRMATION" | "DISPUTED_NEEDS_CONFIRMATION" | "UNDATED_NEEDS_CONFIRMATION";
  note: string;
}

/** Lists dates for checking. Nothing here implies a deadline. */
export function dateChecks(chronology: ChronologyRow[]): DateCheckItem[] {
  return chronology.map((row) => {
    if (row.dateAsWritten === "Undated") {
      return { dateAsWritten: "Undated", status: "UNDATED_NEEDS_CONFIRMATION", note: "The document does not give a date for this item." };
    }
    if (row.disputedByFindingIds.length) {
      return {
        dateAsWritten: row.dateAsWritten,
        status: "DISPUTED_NEEDS_CONFIRMATION",
        note: "Another passage in the uploaded records gives a different date or description. Check the court file and other records.",
      };
    }
    return {
      dateAsWritten: row.dateAsWritten,
      status: "STATED_IN_DOCUMENT_NEEDS_CONFIRMATION",
      note: "This date is written in a document. Confirm it on the court file before relying on it.",
    };
  });
}

// ---------------------------------------------------------------------------
// Workspace
// ---------------------------------------------------------------------------

export function buildCourtPrep(legacy: unknown, documentId = "primary-document") {
  const contract = buildSectionedReport(legacy, documentId);
  const chronology = buildChronology(contract);
  return {
    contract,
    chronology,
    evidenceIndex: buildEvidenceIndex(contract),
    allegations: allegationsFor(contract),
    dateChecks: dateChecks(chronology),
    deadlineRulesVerified: VERIFIED_DEADLINE_RULES.length,
  };
}

export const COURT_PREP_LIMITS = [
  "This is legal information to help you organize your own records. It is not legal advice.",
  "Nothing here is filed, served, sworn, or accepted by a court. Drafts are for your own notes.",
  "No deadline is calculated. Confirm every date and deadline with the court file or a lawyer.",
];
