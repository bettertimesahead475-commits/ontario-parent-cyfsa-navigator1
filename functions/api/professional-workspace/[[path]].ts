import { verifyFirebaseRequest } from '../_auth-check';

interface Env { FIREBASE_PROJECT_ID?: string; STAGING_SUPABASE_URL?: string; STAGING_SUPABASE_SERVICE_ROLE_KEY?: string }
interface Dependencies { fetcher?: typeof fetch; authenticate?: typeof verifyFirebaseRequest }
class WorkspaceError extends Error { constructor(readonly status: number, readonly code: string) { super(code); } }
const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' } });
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const categories: Record<string, string> = { EVIDENCE: 'navigator_evidence_items', CHRONOLOGY: 'navigator_events', CLAIMS: 'navigator_claims', RELATIONSHIPS: 'navigator_claim_relationships', GAPS: 'navigator_evidence_gap_findings', LEGAL: 'navigator_case_intelligence_snapshots', DOCUMENTS: 'navigator_documents', CASE_ACTIONS: 'navigator_case_requirements', CASE_REQUIREMENTS: 'navigator_case_requirements' };
/** Native Cloudflare reads; preserve the existing account + REVIEWER boundary. */
export async function handleProfessionalWorkspace(request: Request, env: Env, deps: Dependencies = {}): Promise<Response> {
  try {
    const identity = await (deps.authenticate || verifyFirebaseRequest)(request, env);
    if (identity.status !== 'verified') throw new WorkspaceError(identity.status === 'denied' ? 401 : 503, 'SIGN_IN_REQUIRED');
    if (request.method !== 'GET') throw new WorkspaceError(405, 'METHOD_NOT_ALLOWED');
    if (!env.STAGING_SUPABASE_URL || !env.STAGING_SUPABASE_SERVICE_ROLE_KEY) throw new WorkspaceError(503, 'REVIEW_DATABASE_UNAVAILABLE');
    const fetcher = deps.fetcher || fetch;
    const headers = { apikey: env.STAGING_SUPABASE_SERVICE_ROLE_KEY, Authorization: 'Bearer ' + env.STAGING_SUPABASE_SERVICE_ROLE_KEY };
    async function query(table: string, filters: Record<string, string>, count = false) {
      const url = new URL('/rest/v1/' + table, env.STAGING_SUPABASE_URL);
      for (const [key, value] of Object.entries(filters)) url.searchParams.set(key, value);
      const res = await fetcher(url.toString(), { method: count ? 'HEAD' : 'GET', headers: { ...headers, ...(count ? { Prefer: 'count=exact' } : {}) }, redirect: 'error', signal: AbortSignal.timeout(8000) });
      if (!res.ok) throw new WorkspaceError(503, 'REVIEW_DATABASE_UNAVAILABLE');
      if (count) {
        const total = Number(res.headers.get('Content-Range')?.split('/')[1]);
        if (!Number.isSafeInteger(total) || total < 0) throw new WorkspaceError(503, 'REVIEW_COUNT_UNAVAILABLE');
        return total;
      }
      const body = await res.json(); if (!Array.isArray(body)) throw new WorkspaceError(503, 'REVIEW_DATABASE_UNAVAILABLE');
      return body;
    }
    const accounts = await query('accounts', { select: 'id,status', firebase_uid: 'eq.' + identity.uid, limit: '2' }) as any[];
    if (accounts.length !== 1 || accounts[0].status !== 'active') throw new WorkspaceError(403, 'ACCOUNT_UNAVAILABLE');
    const accountId = accounts[0].id;
    const path = new URL(request.url).pathname.replace(/^\/api\/professional-workspace\/?/, '').split('/').filter(Boolean);
    if (path.length === 1 && path[0] === 'matters') {
      const members = await query('navigator_matter_members', { select: 'matter_id,role,navigator_matters(id,title,created_at,updated_at)', account_id: 'eq.' + accountId, role: 'eq.REVIEWER', limit: '1000' }) as any[];
      return json(members.map(m => ({ id: m.matter_id, title: m.navigator_matters?.title, role: m.role, createdAt: m.navigator_matters?.created_at, updatedAt: m.navigator_matters?.updated_at })));
    }
    const matterId = path[1];
    if (path[0] !== 'matters' || !matterId || !uuid.test(matterId)) throw new WorkspaceError(404, 'NOT_FOUND');
    const members = await query('navigator_matter_members', { select: 'role', matter_id: 'eq.' + matterId, account_id: 'eq.' + accountId, role: 'eq.REVIEWER', limit: '2' }) as any[];
    if (members.length !== 1 || members[0].role !== 'REVIEWER') throw new WorkspaceError(403, 'UNAUTHORIZED');
    if (path[2] === 'overview' && path.length === 3) {
      const tables = { documents: 'navigator_documents', chronologyEvents: 'navigator_events', claims: 'navigator_claims', relationships: 'navigator_claim_relationships', evidenceGaps: 'navigator_evidence_gap_findings', legalIssues: 'navigator_case_intelligence_snapshots', reviewedItems: 'professional_reviews', caseRequirements: 'navigator_case_requirements' };
      const entries = await Promise.all(Object.entries(tables).map(async ([label, table]) => [label, await query(table, { select: 'id', matter_id: 'eq.' + matterId, ...(table === 'professional_reviews' ? { reviewer_account_id: 'eq.' + accountId } : {}) }, true)]));
      return json(Object.fromEntries(entries));
    }
    if (path[2] === 'intelligence' && path.length === 4) {
      const table = categories[path[3]];
      if (!table) throw new WorkspaceError(400, 'INVALID_CATEGORY');
      let items = await query(table, { select: '*', matter_id: 'eq.' + matterId, limit: '50' }) as any[];
      if (table === 'navigator_case_requirements') {
        const actions = await query('navigator_case_actions', { select: '*', matter_id: 'eq.' + matterId, limit: '1000' }) as any[];
        const links = await query('navigator_action_evidence_links', { select: '*', matter_id: 'eq.' + matterId, limit: '1000' }) as any[];
        items = items.map(({ lawyer_notes, ...item }) => ({ ...item, actions: actions.filter(a => a.requirement_id === item.id), evidenceLinks: links.filter(l => l.requirement_id === item.id) }));
      }
      const reviews = await query('professional_reviews', { select: '*', matter_id: 'eq.' + matterId, reviewer_account_id: 'eq.' + accountId, limit: '1000' });
      return json({ items, reviews });
    }
    if (path[2] === 'evidence' && path[4] === 'source' && path.length === 5 && uuid.test(path[3])) {
      const items = await query('navigator_evidence_items', { select: 'id,document_id,document_version_id,page_id,page_number', id: 'eq.' + path[3], matter_id: 'eq.' + matterId, limit: '2' }) as any[];
      if (items.length !== 1) throw new WorkspaceError(404, 'NOT_FOUND');
      const item = items[0];
      const pages = await query('navigator_document_pages', { select: 'id,page_number,text', id: 'eq.' + item.page_id, document_version_id: 'eq.' + item.document_version_id, page_number: 'eq.' + item.page_number, limit: '2' }) as any[];
      if (pages.length !== 1) throw new WorkspaceError(404, 'NOT_FOUND');
      return json({ evidenceId: item.id, documentId: item.document_id, versionId: item.document_version_id, page: pages[0] });
    }
    if (path[2] === 'reviews' && path.length === 4 && /^[A-Z_]{1,80}$/.test(path[3])) return json(await query('professional_reviews', { select: '*', matter_id: 'eq.' + matterId, reviewer_account_id: 'eq.' + accountId, finding_type: 'eq.' + path[3], limit: '1000' }));
    throw new WorkspaceError(404, 'NOT_FOUND');
  } catch (error) {
    return json({ code: error instanceof WorkspaceError ? error.code : 'REVIEW_UNAVAILABLE', error: 'Professional workspace request could not be completed.' }, error instanceof WorkspaceError ? error.status : 503);
  }
}
export const onRequest = ({ request, env }: { request: Request; env: Env }) => handleProfessionalWorkspace(request, env);
