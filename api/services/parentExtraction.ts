/**
 * Turns the parentAttribution block returned by the overview call into a verified CaseModel.
 *
 * Every record that makes a claim must carry a quotation that the existing verifier finds in the source
 * document. A record whose quotation is not found is dropped and listed as rejected, so an unverified AI
 * claim never reaches the attribution engine as a fact.
 */
import { isVerbatimQuoteStatus, verifyQuoteAgainstSource } from "./analyzerSections.js";
import {
  type Allegation,
  type AllegationStatus,
  type CaseModel,
  type ProceedingRole,
  type ProposedOrder,
  type SourceLocator,
  buildDraftingContext,
  buildParentReport,
  validateCaseModel,
  type AttributionIssue,
  type ParentReport,
} from "./parentAttribution.js";

const ROLES: ProceedingRole[] = [
  "APPLICANT",
  "RESPONDENT",
  "CHILD",
  "PROPOSED_CAREGIVER",
  "EXTENDED_FAMILY",
  "OTHER_PARTY",
  "UNKNOWN",
];
const STATUSES: AllegationStatus[] = ["ADMITTED", "DISPUTED", "CORROBORATED", "UNSUPPORTED", "UNRESOLVED"];
const CLASSIFICATIONS = [
  "DIRECT",
  "DOCUMENTARY",
  "CORROBORATED",
  "HEARSAY",
  "INFERENCE",
  "OPINION",
  "UNSUPPORTED",
  "UNCLEAR",
] as const;

/** Upper bounds on model output, so a long or hostile response cannot inflate the stored model. */
export const EXTRACTION_LIMITS = {
  parties: 20,
  proceedings: 10,
  roles: 60,
  allegations: 150,
  orders: 40,
  aliases: 5,
  text: 600,
};

export interface RejectedRecord {
  kind: "party" | "proceeding" | "allegation" | "order" | "role";
  id: string;
  reason: "MALFORMED" | "QUOTE_NOT_VERIFIED" | "LIMIT_EXCEEDED";
}

export interface ExtractionResult {
  caseModel: CaseModel;
  rejected: RejectedRecord[];
}

type Raw = Record<string, unknown>;

const isObject = (v: unknown): v is Raw => Boolean(v) && typeof v === "object" && !Array.isArray(v);
const text = (v: unknown, max = EXTRACTION_LIMITS.text): string =>
  typeof v === "string" ? v.trim().slice(0, max) : "";
const idOf = (v: unknown): string => text(v, 64);
const strings = (v: unknown, max: number): string[] =>
  Array.isArray(v) ? v.map(x => idOf(x)).filter(Boolean).slice(0, max) : [];
const pageOf = (v: unknown): number | null =>
  typeof v === "number" && Number.isInteger(v) && v > 0 ? v : null;
const oneOf = <T extends string>(v: unknown, allowed: readonly T[], fallback: T): T =>
  allowed.includes(v as T) ? (v as T) : fallback;

/** Verified locator: the quotation must appear in the source document. Returns null when it does not. */
function verifiedSource(raw: Raw, documentText: string, documentId: string): SourceLocator | null {
  const quote = text(raw.quote);
  if (!quote) return null;
  if (!isVerbatimQuoteStatus(verifyQuoteAgainstSource(documentText, quote))) return null;
  return { documentId, page: pageOf(raw.page), paragraph: text(raw.paragraph, 40) || null, quote };
}

/**
 * Maps the model's parentAttribution block to a CaseModel. Malformed or unverifiable records are dropped
 * and reported. Nothing is inferred to fill a gap.
 */
export function buildCaseModelFromExtraction(
  raw: unknown,
  documentText: string,
  documentId: string,
): ExtractionResult {
  const rejected: RejectedRecord[] = [];
  const model: CaseModel = { parties: [], proceedings: [], roles: [], allegations: [], orders: [] };
  if (!isObject(raw)) return { caseModel: model, rejected };

  const parties = Array.isArray(raw.parties) ? raw.parties : [];
  for (const p of parties.slice(0, EXTRACTION_LIMITS.parties)) {
    if (!isObject(p) || !idOf(p.id) || !text(p.displayName, 120)) {
      rejected.push({ kind: "party", id: isObject(p) ? idOf(p.id) : "", reason: "MALFORMED" });
      continue;
    }
    model.parties.push({
      id: idOf(p.id),
      displayName: text(p.displayName, 120),
      aliases: strings(p.aliases, EXTRACTION_LIMITS.aliases).map(a => a.slice(0, 120)),
    });
  }
  if (parties.length > EXTRACTION_LIMITS.parties) rejected.push({ kind: "party", id: "", reason: "LIMIT_EXCEEDED" });

  const proceedings = Array.isArray(raw.proceedings) ? raw.proceedings : [];
  for (const p of proceedings.slice(0, EXTRACTION_LIMITS.proceedings)) {
    if (!isObject(p) || !idOf(p.id)) {
      rejected.push({ kind: "proceeding", id: isObject(p) ? idOf(p.id) : "", reason: "MALFORMED" });
      continue;
    }
    const date = text(p.applicationDate, 10);
    model.proceedings.push({
      id: idOf(p.id),
      fileNumber: text(p.fileNumber, 64) || null,
      applicationDate: /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : null,
      childNames: strings(p.childNames, 10).map(c => c.slice(0, 120)),
    });
  }

  const roles = Array.isArray(raw.roles) ? raw.roles : [];
  for (const r of roles.slice(0, EXTRACTION_LIMITS.roles)) {
    if (!isObject(r) || !idOf(r.proceedingId) || !idOf(r.partyId)) {
      rejected.push({ kind: "role", id: "", reason: "MALFORMED" });
      continue;
    }
    model.roles.push({
      proceedingId: idOf(r.proceedingId),
      partyId: idOf(r.partyId),
      role: oneOf(r.role, ROLES, "UNKNOWN"),
    });
  }

  const allegations = Array.isArray(raw.allegations) ? raw.allegations : [];
  for (const a of allegations.slice(0, EXTRACTION_LIMITS.allegations)) {
    const id = isObject(a) ? idOf(a.id) : "";
    if (!isObject(a) || !id || !idOf(a.proceedingId) || !text(a.text)) {
      rejected.push({ kind: "allegation", id, reason: "MALFORMED" });
      continue;
    }
    const source = verifiedSource(a, documentText, documentId);
    if (!source) {
      rejected.push({ kind: "allegation", id, reason: "QUOTE_NOT_VERIFIED" });
      continue;
    }
    model.allegations.push({
      id,
      proceedingId: idOf(a.proceedingId),
      kind: a.kind === "FINDING" ? "FINDING" : "ALLEGATION",
      text: text(a.text),
      madeBy: text(a.madeBy, 120) || null,
      subjectPartyIds: strings(a.subjectPartyIds, 10),
      status: oneOf(a.status, STATUSES, "UNRESOLVED"),
      classification: oneOf(a.classification, CLASSIFICATIONS, "UNCLEAR") as Allegation["classification"],
      source,
      sourceRecordId: text(a.paragraph, 40) || null,
      responses: [],
    });
  }
  if (allegations.length > EXTRACTION_LIMITS.allegations) {
    rejected.push({ kind: "allegation", id: "", reason: "LIMIT_EXCEEDED" });
  }

  const orders = Array.isArray(raw.orders) ? raw.orders : [];
  for (const o of orders.slice(0, EXTRACTION_LIMITS.orders)) {
    const id = isObject(o) ? idOf(o.id) : "";
    if (!isObject(o) || !id || !idOf(o.proceedingId) || !text(o.description)) {
      rejected.push({ kind: "order", id, reason: "MALFORMED" });
      continue;
    }
    const source = verifiedSource(o, documentText, documentId);
    if (!source) {
      rejected.push({ kind: "order", id, reason: "QUOTE_NOT_VERIFIED" });
      continue;
    }
    model.orders.push({
      id,
      proceedingId: idOf(o.proceedingId),
      description: text(o.description),
      affectsPartyIds: strings(o.affectsPartyIds, 10),
      proposedCaregiverPartyId: idOf(o.proposedCaregiverPartyId) || null,
      source,
    } as ProposedOrder);
  }

  return { caseModel: model, rejected };
}

/** Parties and proceedings a user can choose between. Empty lists mean the document did not identify them. */
export interface SelectionOptions {
  parties: { partyId: string; partyName: string; roles: ProceedingRole[] }[];
  proceedings: { proceedingId: string; fileNumber: string | null }[];
  /** Parent and proceeding pairs that have a role. Every choice must be one of these. */
  pairs: { partyId: string; proceedingId: string }[];
  /** A selection is needed before an analysis can be shown. Never inferred when more than one choice exists. */
  selectionRequired: boolean;
  issues: AttributionIssue[];
}

export function listSelectionOptions(model: CaseModel): SelectionOptions {
  const pairs = model.roles
    .filter(r => model.parties.some(p => p.id === r.partyId) && model.proceedings.some(p => p.id === r.proceedingId))
    .map(r => ({ partyId: r.partyId, proceedingId: r.proceedingId }));
  const parties = model.parties
    .filter(p => pairs.some(x => x.partyId === p.id))
    .map(p => ({
      partyId: p.id,
      partyName: p.displayName,
      roles: model.roles.filter(r => r.partyId === p.id).map(r => r.role),
    }));
  const proceedings = model.proceedings
    .filter(p => pairs.some(x => x.proceedingId === p.id))
    .map(p => ({ proceedingId: p.id, fileNumber: p.fileNumber }));
  return {
    parties,
    proceedings,
    pairs,
    selectionRequired: pairs.length > 1 || parties.length > 1 || proceedings.length > 1,
    issues: validateCaseModel(model),
  };
}

export type SelectedView =
  | {
      ok: true;
      report: ParentReport;
      /** Drafting is never activated here. This states why it is blocked or that it is not yet available. */
      drafting: { status: "NOT_ACTIVATED"; blockedBy: string[] };
    }
  | { ok: false; code: "NOT_A_VALID_CHOICE" };

/** Builds the view for one confirmed parent and proceeding. Reads the stored model only; never calls a model. */
export function buildSelectedView(model: CaseModel, proceedingId: string, partyId: string): SelectedView {
  const options = listSelectionOptions(model);
  if (!options.pairs.some(p => p.partyId === partyId && p.proceedingId === proceedingId)) {
    return { ok: false, code: "NOT_A_VALID_CHOICE" };
  }
  const report = buildParentReport(model, proceedingId, partyId);
  const drafting = buildDraftingContext(model, proceedingId, partyId, "FORM_33B");
  return {
    ok: true,
    report,
    drafting: { status: "NOT_ACTIVATED", blockedBy: "missing" in drafting ? drafting.missing : [] },
  };
}

/**
 * Replaces the raw parentAttribution block in a finished report with the verified CaseModel. The raw block
 * is removed so only verified structure is stored. Does nothing when the report has no such block.
 */
export function attachParentAttribution(report: Record<string, any>, documentText: string, documentId: string): void {
  if (!("parentAttribution" in report)) return;
  const raw = report.parentAttribution;
  delete report.parentAttribution;
  const { caseModel, rejected } = buildCaseModelFromExtraction(raw, documentText, documentId);
  report.parentAttribution = { version: 1, caseModel, rejected };
}
