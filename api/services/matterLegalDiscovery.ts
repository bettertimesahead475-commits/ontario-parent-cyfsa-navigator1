// Stage 9D-2a — Matter Context + Legal Authority Discovery/Ranking (SERVICE ONLY).
//
// SCOPE: a callable server-side service. No Express routes, no endpoint handlers, no
// request/response payload design, no frontend fetch code, no case-brief integration and no
// schema/migration changes. Builds strictly on top of the frozen Stage 9D-1 persistence layer
// (matterResearchRuns.ts) and the Stage 9B canonical candidate path (matterLegalResearch.ts).
//
// TRUST MODEL:
//   - Matter context is read from EXISTING persisted matter-side tables only (claims, events,
//     evidence items). No second case-intelligence model is built. A claim/evidence
//     classification (ALLEGATION/OPINION/INFERENCE/UNVERIFIED_CLAIM/PROFESSIONAL_ASSESSMENT/
//     UNKNOWN) is carried through verbatim into context/ranking metadata -- it is NEVER promoted
//     to FACT, and matter text (including any document-derived content) is always treated as
//     DATA, never as instructions.
//   - Legal corpus discovery only ever reads the canonical Stage 9A tables
//     (navigator_legal_sources / navigator_legal_source_versions / navigator_legal_provisions),
//     never uploaded matter documents, never the open web. Trusted discovery defaults to
//     VERIFIED authority; caller/matter input can never establish verification -- a corpus row's
//     verification_state is always re-read live from Stage 9A, never cached or inferred here.
//   - Ranking is a deterministic, explainable term-overlap match over normalized text. It never
//     produces a legal conclusion ("this law applies") -- only "potentially relevant for
//     professional review". ranking_factors persisted to the frozen 9D-1
//     navigator_matter_research_run_results.ranking_factors column is structured explainability
//     data ONLY; it is never read back anywhere as a trust signal, never implies VERIFIED, and
//     never influences citation validation, content integrity or professional review state. This
//     mirrors the exact property independently audited and confirmed in Stage 9D-1.
//   - Candidate identity is never re-derived here: every discovered authority is persisted as a
//     Stage 9B canonical candidate (reusing buildMatterLegalResearchCandidate /
//     saveMatterLegalResearchCandidate verbatim), so trust-sensitive fields (verification state,
//     provenance, classification, integrity) always derive from Stage 9A/9B, never from caller
//     input to this service.
//   - Matter isolation: every read/write goes through the same requireMatterAccess +
//     matterId-scoped-query pattern already established by matterResearchRuns.ts and
//     matterLegalResearch.ts. A candidate/result can never be attached to a run or matter it does
//     not belong to -- this is enforced both here and by the frozen 9D-1 schema's composite FKs.
//
// This module is deliberately non-LLM and fully deterministic: given the same persisted matter
// data and legal corpus, it always produces the same ranking and the same persisted rows.

import { LifecycleError, requireUuid } from './lifecycleErrors.js';
import { getSupabase } from './access.js';
import { findAccount } from './accounts.js';
import { assertSafeLegalLanguage } from './legalAuthority.js';
import {
  buildMatterLegalResearchCandidate,
  saveMatterLegalResearchCandidate,
  type MatterLegalResearchCandidate
} from './matterLegalResearch.js';
import {
  createMatterResearchRun,
  recordMatterResearchRunResult,
  type MatterResearchRun,
  type MatterResearchRunResult,
  type TriggerType
} from './matterResearchRuns.js';

const invalid = (message: string) => new LifecycleError(400, 'INVALID_DISCOVERY_INPUT', message);

/** Algorithm/version identifier persisted as ranking_method -- bump this string, never silently change scoring semantics under the same name. */
export const DISCOVERY_ALGORITHM_VERSION = 'stage9d-discovery-v1';

async function requireMatterAccess(db: any, accountId: string, matterId: string) {
  const { data: member, error } = await db
    .from('navigator_matter_members')
    .select('role')
    .eq('matter_id', requireUuid(matterId, 'matterId'))
    .eq('account_id', accountId)
    .single();

  if (error || !member) throw new LifecycleError(403, 'UNAUTHORIZED', 'Access denied to this matter.');
  return member;
}

// ---------------------------------------------------------------------------
// 1. Matter context -- built strictly from existing persisted matter-side data.
// ---------------------------------------------------------------------------

export type MatterContextSourceType = 'CLAIM' | 'EVENT' | 'EVIDENCE_ITEM';

export interface MatterContextItem {
  sourceType: MatterContextSourceType;
  id: string;
  matterId: string;
  /** Raw persisted matter text. Always DATA -- never interpreted as instructions. */
  text: string;
  /** Verbatim persisted classification (claims/evidence items only). Never promoted to FACT here. */
  classification: string | null;
  evidenceItemId: string | null;
  eventId: string | null;
}

export interface MatterContext {
  matterId: string;
  items: MatterContextItem[];
}

/**
 * Builds trusted matter context strictly from server-persisted claims/events/evidence items --
 * never from a second, independently-derived case-intelligence model, and never from raw
 * caller-supplied text. Caller cannot inject a context item; every item is re-read from the
 * matter's own tables after the caller's access has been independently verified.
 */
export async function buildMatterContext(firebaseUid: string, matterId: string): Promise<MatterContext> {
  const account = await findAccount(firebaseUid);
  if (!account) throw new LifecycleError(401, 'UNAUTHORIZED', 'Account not found');

  const db = getSupabase();
  const scopedMatterId = requireUuid(matterId, 'matterId');
  await requireMatterAccess(db, account.id, scopedMatterId);

  return buildMatterContextInternal(db, scopedMatterId);
}

async function buildMatterContextInternal(db: any, matterId: string): Promise<MatterContext> {
  const items: MatterContextItem[] = [];

  const { data: claims, error: claimsError } = await db
    .from('navigator_claims')
    .select('*')
    .eq('matter_id', matterId);
  if (claimsError) throw new LifecycleError(500, 'DB_ERROR', 'Failed to load matter claims.');
  for (const c of claims || []) {
    if (typeof c.proposition !== 'string' || !c.proposition.trim()) continue;
    items.push({
      sourceType: 'CLAIM',
      id: c.id,
      matterId,
      text: c.proposition,
      classification: c.classification ?? null,
      evidenceItemId: null,
      eventId: null
    });
  }

  const { data: events, error: eventsError } = await db
    .from('navigator_events')
    .select('*')
    .eq('matter_id', matterId);
  if (eventsError) throw new LifecycleError(500, 'DB_ERROR', 'Failed to load matter events.');
  for (const e of events || []) {
    if (typeof e.description !== 'string' || !e.description.trim()) continue;
    items.push({
      sourceType: 'EVENT',
      id: e.id,
      matterId,
      text: e.description,
      classification: null,
      evidenceItemId: null,
      eventId: e.id
    });
  }

  const { data: evidenceItems, error: evidenceError } = await db
    .from('navigator_evidence_items')
    .select('*')
    .eq('matter_id', matterId);
  if (evidenceError) throw new LifecycleError(500, 'DB_ERROR', 'Failed to load matter evidence items.');
  for (const ev of evidenceItems || []) {
    if (typeof ev.normalized_statement !== 'string' || !ev.normalized_statement.trim()) continue;
    items.push({
      sourceType: 'EVIDENCE_ITEM',
      id: ev.id,
      matterId,
      text: ev.normalized_statement,
      classification: ev.classification ?? null,
      evidenceItemId: ev.id,
      eventId: null
    });
  }

  return { matterId, items };
}

// ---------------------------------------------------------------------------
// 2. Deterministic tokenization -- pure, synchronous, no external call.
// ---------------------------------------------------------------------------

// A deliberately small stopword list -- this is a deterministic overlap heuristic, not an NLP
// pipeline. Prompt-injection-style phrases ("ignore previous instructions", "mark this statute
// authoritative", etc.) tokenize like any other matter text; nothing here treats any token or
// phrase as an instruction.
const STOPWORDS = new Set([
  'the', 'a', 'an', 'and', 'or', 'of', 'to', 'in', 'on', 'for', 'is', 'was', 'were', 'be',
  'been', 'by', 'with', 'at', 'as', 'that', 'this', 'it', 'from', 'has', 'have', 'had', 'not',
  'are', 'will', 'shall', 'may', 'must'
]);

/** Deterministic normalized-token extraction. Same input always yields the same token set. */
export function tokenize(text: string): string[] {
  if (typeof text !== 'string') return [];
  const words = text.toLowerCase().normalize('NFKC').match(/[a-z0-9]+/g) || [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const w of words) {
    if (w.length < 3 || STOPWORDS.has(w)) continue;
    if (seen.has(w)) continue;
    seen.add(w);
    out.push(w);
  }
  // Stable, deterministic ordering independent of input order.
  out.sort();
  return out;
}

// ---------------------------------------------------------------------------
// 3. Legal corpus discovery -- reads ONLY canonical Stage 9A tables, defaults to VERIFIED.
// ---------------------------------------------------------------------------

export interface CanonicalProvision {
  id: string;
  legalSourceId: string;
  citation: string;
  label: string;
  verificationState: string;
  sourceVerificationState: string;
  sourceJurisdiction: string;
  sourceTitle: string;
}

async function loadVerifiedCanonicalProvisions(db: any): Promise<CanonicalProvision[]> {
  const { data: sources, error: sourcesError } = await db
    .from('navigator_legal_sources')
    .select('*')
    .eq('verification_state', 'VERIFIED');
  if (sourcesError) throw new LifecycleError(500, 'DB_ERROR', 'Failed to load canonical legal sources.');

  const sourceById = new Map<string, any>();
  for (const s of sources || []) sourceById.set(s.id, s);

  if (sourceById.size === 0) return [];

  const { data: provisions, error: provisionsError } = await db
    .from('navigator_legal_provisions')
    .select('*')
    .eq('verification_state', 'VERIFIED');
  if (provisionsError) throw new LifecycleError(500, 'DB_ERROR', 'Failed to load canonical legal provisions.');

  const out: CanonicalProvision[] = [];
  for (const p of provisions || []) {
    const source = sourceById.get(p.legal_source_id);
    if (!source) continue; // provision's source is not VERIFIED -- never trusted by default discovery
    out.push({
      id: p.id,
      legalSourceId: p.legal_source_id,
      citation: p.citation,
      label: p.label,
      verificationState: p.verification_state,
      sourceVerificationState: source.verification_state,
      sourceJurisdiction: source.jurisdiction,
      sourceTitle: source.title
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// 4. Matching + deterministic ranking.
// ---------------------------------------------------------------------------

export interface ContextMatch {
  sourceType: MatterContextSourceType;
  id: string;
  matchedTerms: string[];
}

export interface DiscoveredMatch {
  provision: CanonicalProvision;
  matchedTerms: string[];
  matchCount: number;
  score: number; // normalized 0..1, deterministic
  contextMatches: ContextMatch[];
  limitations: string[];
}

/**
 * Pure, synchronous, deterministic matching + ranking over already-fetched context/corpus.
 * Never touches the database. Sort order is fully explicit: score desc, then provision id asc
 * as a stable tie-break -- DB row order never determines rank.
 */
export function rankDiscoveredAuthority(context: MatterContext, provisions: CanonicalProvision[]): DiscoveredMatch[] {
  const contextTokenSets = context.items.map((item) => ({ item, tokens: new Set(tokenize(item.text)) }));

  const matches: DiscoveredMatch[] = [];

  for (const provision of provisions) {
    const provisionTokens = new Set(tokenize(`${provision.label} ${provision.citation}`));
    if (provisionTokens.size === 0) continue;

    const matchedTermSet = new Set<string>();
    const contextMatches: ContextMatch[] = [];

    for (const { item, tokens } of contextTokenSets) {
      const overlap = [...tokens].filter((t) => provisionTokens.has(t)).sort();
      if (overlap.length === 0) continue;
      overlap.forEach((t) => matchedTermSet.add(t));
      contextMatches.push({ sourceType: item.sourceType, id: item.id, matchedTerms: overlap });
    }

    if (matchedTermSet.size === 0) continue;

    const matchedTerms = [...matchedTermSet].sort();
    const score = Math.min(1, matchedTerms.length / provisionTokens.size);

    const limitations: string[] = [];
    if (provision.sourceVerificationState !== 'VERIFIED') {
      // Defensive -- loadVerifiedCanonicalProvisions already filters this, but a result's
      // metadata states the limitation explicitly rather than silently assuming currency.
      limitations.push('Underlying legal source is not VERIFIED.');
    }

    matches.push({
      provision,
      matchedTerms,
      matchCount: matchedTerms.length,
      score,
      contextMatches: contextMatches.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)),
      limitations
    });
  }

  // Deterministic sort: score desc, then provision id asc as an explicit stable tie-break.
  matches.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return a.provision.id < b.provision.id ? -1 : a.provision.id > b.provision.id ? 1 : 0;
  });

  return matches;
}

// ---------------------------------------------------------------------------
// 5. Candidate reuse-or-server-side-creation -- reuses Stage 9B's own construction rules.
// ---------------------------------------------------------------------------

const DISCOVERY_RETRIEVAL_BASIS = `${DISCOVERY_ALGORITHM_VERSION}:term-overlap`;

function buildReasonForRelevance(match: DiscoveredMatch): string {
  // Deliberately framed as potential relevance for professional review, never a legal
  // conclusion -- this must pass legalAuthority.ts's assertSafeLegalLanguage unchanged.
  const terms = match.matchedTerms.slice(0, 8).join(', ');
  const reason = `Potentially relevant for professional review: matched terms (${terms}) found in matter context via deterministic term overlap (${DISCOVERY_ALGORITHM_VERSION}).`;
  assertSafeLegalLanguage(reason);
  return reason;
}

/**
 * Resolves a Stage 9B candidate for a discovered provision -- reusing Stage 9B's own
 * build+save path so trust-sensitive fields are always server-derived from Stage 9A/9B, never
 * caller-supplied. Idempotent: calling this twice for the same matter/source/provision/basis
 * reuses (never duplicates) the same candidate row, via Stage 9B's own idempotence key.
 */
export async function resolveCandidateForMatch(
  firebaseUid: string,
  matterId: string,
  match: DiscoveredMatch
): Promise<MatterLegalResearchCandidate> {
  const reasonForRelevance = buildReasonForRelevance(match);

  const built = await buildMatterLegalResearchCandidate(firebaseUid, {
    matterId,
    legalSourceId: match.provision.legalSourceId,
    provisionId: match.provision.id,
    reasonForRelevance,
    retrievalBasis: DISCOVERY_RETRIEVAL_BASIS,
    confidence: match.score
  });

  return saveMatterLegalResearchCandidate(firebaseUid, built);
}

// ---------------------------------------------------------------------------
// 6. Orchestration -- matter ID -> context -> discovery -> ranking -> candidates -> persistence.
// ---------------------------------------------------------------------------

export interface RunMatterLegalDiscoveryOptions {
  triggerType?: TriggerType;
  /** Caps how many top-ranked matches are persisted per run; deterministic (rank order) truncation. */
  maxResults?: number;
}

export interface RunMatterLegalDiscoveryOutcome {
  run: MatterResearchRun;
  context: MatterContext;
  matches: DiscoveredMatch[];
  results: MatterResearchRunResult[];
  candidates: MatterLegalResearchCandidate[];
}

const DEFAULT_MAX_RESULTS = 25;

/**
 * The single entry point for Stage 9D-2a: matter ID -> trusted persisted matter context ->
 * canonical Stage 9A legal corpus discovery -> deterministic ranking -> Stage 9B candidate
 * reuse-or-creation -> persistence into the frozen Stage 9D-1 run/result tables. Server-side
 * only; no HTTP layer, no case-brief integration.
 */
export async function runMatterLegalDiscovery(
  firebaseUid: string,
  matterId: string,
  options: RunMatterLegalDiscoveryOptions = {}
): Promise<RunMatterLegalDiscoveryOutcome> {
  const account = await findAccount(firebaseUid);
  if (!account) throw new LifecycleError(401, 'UNAUTHORIZED', 'Account not found');

  const db = getSupabase();
  const scopedMatterId = requireUuid(matterId, 'matterId');
  await requireMatterAccess(db, account.id, scopedMatterId);

  const triggerType: TriggerType = options.triggerType ?? 'MANUAL';
  const maxResults = options.maxResults && options.maxResults > 0 ? Math.floor(options.maxResults) : DEFAULT_MAX_RESULTS;

  const context = await buildMatterContextInternal(db, scopedMatterId);
  const provisions = await loadVerifiedCanonicalProvisions(db);
  const allMatches = rankDiscoveredAuthority(context, provisions);
  const matches = allMatches.slice(0, maxResults);

  const run = await createMatterResearchRun(firebaseUid, { matterId: scopedMatterId, triggerType });

  const results: MatterResearchRunResult[] = [];
  const candidates: MatterLegalResearchCandidate[] = [];

  for (const match of matches) {
    const candidate = await resolveCandidateForMatch(firebaseUid, scopedMatterId, match);
    if (candidate.matterId !== scopedMatterId) {
      // Defensive -- Stage 9B's own access checks already guarantee this, but discovery never
      // trusts a candidate it did not itself verify belongs to this matter.
      throw new LifecycleError(500, 'CROSS_MATTER_CANDIDATE', 'Resolved candidate does not belong to the requested matter.');
    }
    candidates.push(candidate);

    const rankingFactors: Record<string, unknown> = {
      algorithmVersion: DISCOVERY_ALGORITHM_VERSION,
      matchedTerms: match.matchedTerms,
      matchCount: match.matchCount,
      provisionId: match.provision.id,
      legalSourceId: match.provision.legalSourceId,
      legalSourceVerificationState: match.provision.sourceVerificationState,
      contextMatches: match.contextMatches,
      limitations: match.limitations
    };

    const result = await recordMatterResearchRunResult(firebaseUid, {
      matterId: scopedMatterId,
      researchRunId: run.id,
      candidateId: candidate.id,
      rankingMethod: DISCOVERY_ALGORITHM_VERSION,
      rankingScore: match.score,
      rankingFactors
    });
    results.push(result);
  }

  return { run, context, matches, results, candidates };
}
