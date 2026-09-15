import { getHumanReviewSupabase } from './humanReviewAccess.js';
import { LifecycleError, requireUuid } from './lifecycleErrors.js';

const invalid = () => new LifecycleError(400, 'INVALID_REVIEW_REQUEST', 'Invalid review request.');
const object = (v: unknown): Record<string, unknown> => { if (!v || typeof v !== 'object' || Array.isArray(v)) throw invalid(); return v as Record<string, unknown>; };
const fields = (v: Record<string, unknown>, allowed: string[]) => { if (Object.keys(v).some(k => !allowed.includes(k))) throw invalid(); };
function timestamp(v: unknown) { const s = typeof v === 'string' ? v : ''; if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,6})?(Z|\+00:00)$/.test(s) || !Number.isFinite(Date.parse(s))) throw invalid(); return s; }

const VALID_OBJECT_TYPES = ['ENTITY', 'MENTION', 'RESOLUTION', 'EVENT', 'PARTICIPANT'] as const;
const VALID_STATES = ['PROPOSED', 'CONFIRMED', 'REJECTED', 'DISPUTED'] as const;

export async function reviewIntelligence(uid: string, matterId: string, input: unknown) {
  const v = object(input);
  fields(v, ['objectType', 'objectId', 'reviewState', 'expectedUpdatedAt']);
  
  if (!VALID_OBJECT_TYPES.includes(v.objectType as any)) throw invalid();
  if (!VALID_STATES.includes(v.reviewState as any)) throw invalid();

  const { data, error } = await getHumanReviewSupabase().rpc('navigator_intelligence_review_update', {
    p_uid: uid,
    p_matter_id: requireUuid(matterId, 'matterId'),
    p_object_type: v.objectType,
    p_object_id: requireUuid(v.objectId as string, 'objectId'),
    p_state: v.reviewState,
    p_expected_updated_at: timestamp(v.expectedUpdatedAt)
  });

  if (error) {
    if (error.code === 'P0002') throw new LifecycleError(404, 'NOT_FOUND', 'Object not found.');
    if (error.code === '40001') throw new LifecycleError(409, 'REVIEW_CONFLICT', 'Object changed. Reload before reviewing.');
    if (error.code === '55P03') throw new LifecycleError(409, 'REVIEW_BUSY', 'Review is busy. Retry shortly.');
    if (error.code === '22023') throw invalid();
    throw new LifecycleError(503, 'REVIEW_UNAVAILABLE', 'Intelligence review is unavailable: ' + error.message);
  }

  if (!data || typeof data !== 'object') throw new LifecycleError(503, 'REVIEW_UNAVAILABLE', 'Intelligence review is unavailable.');
  return data;
}
