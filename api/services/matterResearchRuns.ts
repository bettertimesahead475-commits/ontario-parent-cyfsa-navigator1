// Stage 9D-1: Data Model & Persistence Foundation.
//
// SCOPE: persistence only. This file does NOT implement a discovery algorithm, a ranking
// algorithm, a research API route, or any case-brief/work-product generation logic. It exposes
// the minimum server-side write/read surface needed to structurally exercise (and later build
// 9D-2/3/4 on top of) the Stage 9D-1 schema in
// supabase/migrations_pending_approval/create_navigator_stage9d1_research_foundation.sql.
//
// Every function here requires server-verified matter membership (reusing the same
// requireMatterAccess pattern as Stage 9B's matterLegalResearch.ts) before touching a row, and
// every write/read is matter-scoped. Ranking inputs (rankingMethod/rankingScore/rankingFactors)
// are accepted as caller-supplied explainability metadata for this stage only -- no later 9D
// service may treat them as a substitute for authority verification, evidence classification or
// professional review state; those remain re-derived from their own authoritative tables.

import { LifecycleError, requireUuid } from './lifecycleErrors.js';
import { getSupabase } from './access.js';
import { findAccount } from './accounts.js';

const invalid = (message: string) => new LifecycleError(400, 'INVALID_RESEARCH_RUN_INPUT', message);
const notFound = (message: string) => new LifecycleError(404, 'NOT_FOUND', message);

export type TriggerType = 'MANUAL' | 'SCHEDULED' | 'SYSTEM';
export type ResearchRunStatus = 'PENDING' | 'RUNNING' | 'COMPLETED' | 'FAILED';
export type DiscoveryStatus = 'CANDIDATE_DISCOVERED' | 'RANKED' | 'SUPERSEDED';

export interface MatterResearchRun {
  id: string;
  matterId: string;
  triggeredByAccountId: string | null;
  triggerType: TriggerType;
  status: ResearchRunStatus;
  startedAt: string | null;
  completedAt: string | null;
  createdAt: string;
}

export interface MatterResearchRunResult {
  id: string;
  researchRunId: string;
  matterId: string;
  candidateId: string;
  discoveryStatus: DiscoveryStatus;
  rankingMethod: string | null;
  rankingScore: number | null;
  rankingFactors: Record<string, unknown> | null;
  stalenessCheckedAt: string | null;
  discoveredAt: string;
  createdAt: string;
}

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

export interface CreateResearchRunInput {
  matterId: string;
  triggerType: TriggerType;
}

export async function createMatterResearchRun(
  firebaseUid: string,
  input: CreateResearchRunInput
): Promise<MatterResearchRun> {
  if (!input || typeof input !== 'object') throw invalid('Input must be an object.');

  const account = await findAccount(firebaseUid);
  if (!account) throw new LifecycleError(401, 'UNAUTHORIZED', 'Account not found');

  const matterId = requireUuid(input.matterId, 'matterId');
  const db = getSupabase();
  await requireMatterAccess(db, account.id, matterId);

  if (!input.triggerType || !['MANUAL', 'SCHEDULED', 'SYSTEM'].includes(input.triggerType)) {
    throw invalid('triggerType must be one of MANUAL, SCHEDULED, SYSTEM.');
  }

  // Only a MANUAL run may carry a triggering account -- this mirrors the migration's check
  // constraint (trigger_type = 'MANUAL' or triggered_by_account_id is null) at the application
  // layer, so a caller cannot assert a human trigger for a SCHEDULED/SYSTEM run.
  const triggeredByAccountId = input.triggerType === 'MANUAL' ? account.id : null;

  const { data, error } = await db.from('navigator_matter_research_runs').insert({
    matter_id: matterId,
    triggered_by_account_id: triggeredByAccountId,
    trigger_type: input.triggerType,
    status: 'PENDING'
  }).select().single();

  if (error || !data) throw new LifecycleError(500, 'DB_ERROR', 'Failed to create research run.');

  return mapRun(data);
}

export async function listMatterResearchRuns(
  firebaseUid: string,
  matterId: string
): Promise<MatterResearchRun[]> {
  const account = await findAccount(firebaseUid);
  if (!account) throw new LifecycleError(401, 'UNAUTHORIZED', 'Account not found');

  const db = getSupabase();
  const scopedMatterId = requireUuid(matterId, 'matterId');
  await requireMatterAccess(db, account.id, scopedMatterId);

  const { data, error } = await db
    .from('navigator_matter_research_runs')
    .select('*')
    .eq('matter_id', scopedMatterId);

  if (error) throw new LifecycleError(500, 'DB_ERROR', 'Failed to list research runs.');
  return (data || []).map(mapRun);
}

export interface RecordResearchRunResultInput {
  matterId: string;
  researchRunId: string;
  candidateId: string;
  rankingMethod?: string | null;
  rankingScore?: number | null;
  rankingFactors?: Record<string, unknown> | null;
}

/**
 * Persists that a research run discovered a given Stage 9B candidate. This function does not
 * choose, score or rank candidates -- it only records a caller-supplied discovery/ranking result
 * against a run and candidate it has independently verified belong to the same authorized matter.
 * No discovery or ranking algorithm lives here; that is explicitly out of scope for Stage 9D-1.
 */
export async function recordMatterResearchRunResult(
  firebaseUid: string,
  input: RecordResearchRunResultInput
): Promise<MatterResearchRunResult> {
  if (!input || typeof input !== 'object') throw invalid('Input must be an object.');

  const account = await findAccount(firebaseUid);
  if (!account) throw new LifecycleError(401, 'UNAUTHORIZED', 'Account not found');

  const matterId = requireUuid(input.matterId, 'matterId');
  const db = getSupabase();
  await requireMatterAccess(db, account.id, matterId);

  const researchRunId = requireUuid(input.researchRunId, 'researchRunId');
  const candidateId = requireUuid(input.candidateId, 'candidateId');

  // The run must exist and belong to THIS matter -- never trust the caller's matterId alone.
  const { data: run, error: runError } = await db
    .from('navigator_matter_research_runs')
    .select('id, matter_id')
    .eq('id', researchRunId)
    .eq('matter_id', matterId)
    .single();
  if (runError || !run) throw notFound('Research run not found in this matter.');

  // The candidate must exist and belong to THIS matter -- reuses the Stage 9B candidate's own
  // authority identity (legal_source_id/legal_source_version_id/provision_id); nothing about
  // authority identity is re-derived or re-asserted here.
  const { data: candidate, error: candidateError } = await db
    .from('navigator_matter_legal_research_candidates')
    .select('id, matter_id')
    .eq('id', candidateId)
    .eq('matter_id', matterId)
    .single();
  if (candidateError || !candidate) throw notFound('Research candidate not found in this matter.');

  if (input.rankingScore !== undefined && input.rankingScore !== null) {
    if (typeof input.rankingScore !== 'number' || input.rankingScore < 0 || input.rankingScore > 1) {
      throw invalid('rankingScore must be a number between 0 and 1.');
    }
  }
  if ((input.rankingMethod || input.rankingScore !== undefined || input.rankingFactors !== undefined)
      && (!input.rankingMethod || typeof input.rankingMethod !== 'string' || !input.rankingMethod.trim())) {
    throw invalid('rankingMethod is required whenever ranking score/factors are supplied.');
  }

  const discoveryStatus: DiscoveryStatus = input.rankingMethod ? 'RANKED' : 'CANDIDATE_DISCOVERED';

  const { data, error } = await db.from('navigator_matter_research_run_results').insert({
    research_run_id: researchRunId,
    matter_id: matterId,
    candidate_id: candidateId,
    discovery_status: discoveryStatus,
    ranking_method: input.rankingMethod ?? null,
    ranking_score: input.rankingScore ?? null,
    ranking_factors: input.rankingFactors ?? null
  }).select().single();

  if (error || !data) throw new LifecycleError(500, 'DB_ERROR', 'Failed to record research run result.');

  return mapResult(data);
}

export async function listMatterResearchRunResults(
  firebaseUid: string,
  matterId: string,
  researchRunId?: string
): Promise<MatterResearchRunResult[]> {
  const account = await findAccount(firebaseUid);
  if (!account) throw new LifecycleError(401, 'UNAUTHORIZED', 'Account not found');

  const db = getSupabase();
  const scopedMatterId = requireUuid(matterId, 'matterId');
  await requireMatterAccess(db, account.id, scopedMatterId);

  let query = db
    .from('navigator_matter_research_run_results')
    .select('*')
    .eq('matter_id', scopedMatterId);

  if (researchRunId) {
    query = query.eq('research_run_id', requireUuid(researchRunId, 'researchRunId'));
  }

  const { data, error } = await query;
  if (error) throw new LifecycleError(500, 'DB_ERROR', 'Failed to list research run results.');
  return (data || []).map(mapResult);
}

function mapRun(row: any): MatterResearchRun {
  return {
    id: row.id,
    matterId: row.matter_id,
    triggeredByAccountId: row.triggered_by_account_id,
    triggerType: row.trigger_type,
    status: row.status,
    startedAt: row.started_at,
    completedAt: row.completed_at,
    createdAt: row.created_at
  };
}

function mapResult(row: any): MatterResearchRunResult {
  return {
    id: row.id,
    researchRunId: row.research_run_id,
    matterId: row.matter_id,
    candidateId: row.candidate_id,
    discoveryStatus: row.discovery_status,
    rankingMethod: row.ranking_method,
    rankingScore: row.ranking_score,
    rankingFactors: row.ranking_factors,
    stalenessCheckedAt: row.staleness_checked_at,
    discoveredAt: row.discovered_at,
    createdAt: row.created_at
  };
}
