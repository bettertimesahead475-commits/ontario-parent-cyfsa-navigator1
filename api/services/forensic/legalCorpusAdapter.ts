/**
 * Connects the Forensic Engine to the Stage 6 legal corpus retrieval contract (api/services/legalCorpusRetrieval.ts).
 *
 * Two repositories implement the contract's LegalCorpusRepository:
 * - BundledCyfsaRepository: the CYFSA provisions whose text is bundled with the app (src/utils/statuteReference.ts),
 *   from the SHA-256-pinned consolidation (shared/bundledLegalSources.ts). Each version is COMMITTED_INSPECTION:
 *   its text is checked word-for-word against the official file by an automated test, but no person has signed it
 *   off. Stage 6 therefore never treats it as VERIFIED authority, and every lookup through it reports
 *   requiresResearch.
 * - SupabaseLegalCorpusRepository: the navigator_legal_provisions / navigator_legal_provision_versions tables
 *   (supabase/migrations_pending_approval). They are not applied in production; when the tables are missing the
 *   repository answers "not found" and the bundled repository is used. Human-VERIFIED versions there resolve normally.
 *
 * Lookups are by classified section number and case date only, never by model judgement.
 */

import { BUNDLED_STATUTE_ENTRIES } from "../../../src/utils/statuteReference.js";
import { BUNDLED_LEGAL_SOURCES } from "../../../shared/bundledLegalSources.js";
import { classifyCitation } from "../../../shared/citationVerification.js";
import { normalizeProvisionText, sha256Hex, type ProvisionVersionCandidate } from "../legalCorpus.js";
import { normalizeProvisionCitation, retrieveLegalAuthority, type LegalCorpusRepository, type RetrievalOutcome } from "../legalCorpusRetrieval.js";
import type { CaseDate, LegalProvision } from "../legalAuthority.js";

/** Fixed identifiers for the bundled CYFSA source, so lookups and tests are deterministic. */
export const BUNDLED_CYFSA_SOURCE_ID = "6f1c2a3b-4d5e-4f60-8a7b-9c0d1e2f3a40";
const BUNDLED_CYFSA_SOURCE_VERSION_ID = "6f1c2a3b-4d5e-4f60-8a7b-9c0d1e2f3a41";
const bundledManifest = BUNDLED_LEGAL_SOURCES.find((s) => s.id === "on-cyfsa-2017")!;

// Deterministic UUID-shaped id per bundled provision key.
const provisionId = (key: string, suffix: "p" | "v") => {
  const hex = sha256Hex(`bundled-cyfsa:${suffix}:${key}`);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-8${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
};

export class BundledCyfsaRepository implements LegalCorpusRepository {
  async findProvisionByCitation(legalSourceId: string, normalizedCitation: string): Promise<LegalProvision | null> {
    if (legalSourceId !== BUNDLED_CYFSA_SOURCE_ID) return null;
    const key = Object.keys(BUNDLED_STATUTE_ENTRIES).find((k) => normalizeProvisionCitation(k) === normalizedCitation);
    if (!key) return null;
    return { id: provisionId(key, "p"), legalSourceId, citation: normalizedCitation, label: BUNDLED_STATUTE_ENTRIES[key].heading, verificationState: "UNVERIFIED" as LegalProvision["verificationState"] };
  }

  async findProvisionVersions(id: string): Promise<ProvisionVersionCandidate[]> {
    const key = Object.keys(BUNDLED_STATUTE_ENTRIES).find((k) => provisionId(k, "p") === id);
    if (!key) return [];
    const exactText = BUNDLED_STATUTE_ENTRIES[key].text;
    const normalizedText = normalizeProvisionText(exactText);
    return [
      {
        id: provisionId(key, "v"),
        provisionId: id,
        legalSourceId: BUNDLED_CYFSA_SOURCE_ID,
        legalSourceVersionId: BUNDLED_CYFSA_SOURCE_VERSION_ID,
        effectiveFrom: bundledManifest.consolidationPeriodFrom,
        effectiveTo: null,
        exactText,
        normalizedText,
        textSha256: sha256Hex(normalizedText),
        verificationStatus: "COMMITTED_INSPECTION",
        verifiedBy: null,
        verifiedAt: null,
      },
    ];
  }
}

const isMissingTable = (error: any) => ["42P01", "PGRST205", "PGRST202"].includes(String(error?.code ?? ""));

export class SupabaseLegalCorpusRepository implements LegalCorpusRepository {
  constructor(private readonly db: any) {}

  async findProvisionByCitation(legalSourceId: string, normalizedCitation: string): Promise<LegalProvision | null> {
    const { data, error } = await this.db
      .from("navigator_legal_provisions")
      .select("id, legal_source_id, citation, label, verification_state")
      .eq("legal_source_id", legalSourceId)
      .eq("citation", normalizedCitation)
      .maybeSingle();
    if (error) {
      if (isMissingTable(error)) return null;
      throw new Error(`Legal corpus unavailable: ${error.message}`);
    }
    return data ? { id: data.id, legalSourceId: data.legal_source_id, citation: data.citation, label: data.label, verificationState: data.verification_state } : null;
  }

  async findProvisionVersions(id: string): Promise<ProvisionVersionCandidate[]> {
    const { data, error } = await this.db
      .from("navigator_legal_provision_versions")
      .select("id, provision_id, legal_source_id, legal_source_version_id, effective_from, effective_to, exact_text, normalized_text, text_sha256, verification_status, verified_by, verified_at")
      .eq("provision_id", id);
    if (error) {
      if (isMissingTable(error)) return [];
      throw new Error(`Legal corpus unavailable: ${error.message}`);
    }
    return (data ?? []).map((r: any) => ({
      id: r.id,
      provisionId: r.provision_id,
      legalSourceId: r.legal_source_id,
      legalSourceVersionId: r.legal_source_version_id,
      effectiveFrom: r.effective_from,
      effectiveTo: r.effective_to,
      exactText: r.exact_text,
      normalizedText: r.normalized_text,
      textSha256: r.text_sha256,
      verificationStatus: r.verification_status,
      verifiedBy: r.verified_by,
      verifiedAt: r.verified_at,
    }));
  }
}

export interface CorpusSource {
  repository: LegalCorpusRepository;
  legalSourceId: string;
  label: string;
}

/** The corpus sources to consult, in order. The database source is used only when its CYFSA source id is configured. */
export function corpusSources(db?: any, env: Record<string, string | undefined> = process.env): CorpusSource[] {
  const out: CorpusSource[] = [];
  const configured = env.FORENSIC_CORPUS_CYFSA_SOURCE_ID;
  if (db && configured) out.push({ repository: new SupabaseLegalCorpusRepository(db), legalSourceId: configured, label: "CYFSA Navigator legal corpus" });
  out.push({ repository: new BundledCyfsaRepository(), legalSourceId: BUNDLED_CYFSA_SOURCE_ID, label: "Bundled CYFSA consolidation" });
  return out;
}

export interface CorpusLookup {
  outcome: RetrievalOutcome;
  requiresResearch: boolean;
  source: string;
  /** The version's effective-from date, when one was found. */
  effectiveFrom: string | null;
  verificationStatus: string | null;
  note: string;
}

const NOTE: Partial<Record<RetrievalOutcome, string>> = {
  RESOLVED: "A person-verified version in force on the case date was found.",
  RESOLVED_OPEN_ENDED: "A person-verified version in force on the case date was found.",
  UNVERIFIED_ONLY: "The provision's text is held but has not been signed off by a person; confirm with counsel.",
  BEFORE_EARLIEST_VERSION: "The case date is before the earliest version held; the version in force then was not checked.",
  UNKNOWN_DATE: "No case date was identified, so the version in force could not be checked.",
  PROVISION_NOT_FOUND: "The provision is not in the legal corpus.",
};

/**
 * Looks one CYFSA citation up in the corpus for a case date. Non-CYFSA, mixed or multi-section citations are not
 * looked up (a lookup would have to guess which provision was meant).
 */
export async function lookupCitation(citation: string, caseDate: CaseDate, sources: CorpusSource[]): Promise<CorpusLookup | null> {
  const c = classifyCitation(citation);
  if (c.identifiedAct !== "CYFSA" || c.sections.length !== 1) return null;
  let last: CorpusLookup | null = null;
  for (const s of sources) {
    const r = await retrieveLegalAuthority({ legalSourceId: s.legalSourceId, citation: c.sections[0], caseDate }, s.repository);
    const version = r.provisionVersion ?? r.candidates[0] ?? null;
    let outcome = r.outcome;
    let effectiveFrom = version?.effectiveFrom ?? null;
    if (outcome === "UNVERIFIED_ONLY") {
      // Stage 6 stops at "not verified" before comparing dates; the date check still matters to the reader.
      const versions = await s.repository.findProvisionVersions((await s.repository.findProvisionByCitation(s.legalSourceId, normalizeProvisionCitation(c.sections[0])))!.id);
      effectiveFrom = versions[0]?.effectiveFrom ?? null;
      if (caseDate.kind !== "UNKNOWN" && effectiveFrom && caseDate.date < effectiveFrom) outcome = "BEFORE_EARLIEST_VERSION";
    }
    last = {
      outcome,
      requiresResearch: outcome !== "RESOLVED" && outcome !== "RESOLVED_OPEN_ENDED",
      source: s.label,
      effectiveFrom,
      verificationStatus: version?.verificationStatus ?? (outcome === "BEFORE_EARLIEST_VERSION" || outcome === "UNVERIFIED_ONLY" ? "COMMITTED_INSPECTION" : null),
      note: NOTE[outcome] ?? "The corpus could not resolve this provision for the case date; confirm with counsel.",
    };
    if (outcome !== "PROVISION_NOT_FOUND") return last;
  }
  return last;
}
