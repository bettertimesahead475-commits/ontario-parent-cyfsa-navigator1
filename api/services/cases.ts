// ---------------------------------------------------------------------------
// Phase 2A: the persistent case-ownership foundation. See
// PHASE_2_CYFSA_INTELLIGENCE_ARCHITECTURE.md and
// supabase/migrations_pending_approval/create_navigator_case_ownership_foundation.sql
// (not yet applied - see that file for why, and for the exact schema).
//
// Uses the navigator_cases/navigator_case_members tables and the
// create_navigator_case_with_owner() function - NOT public.cases/
// public.documents, which are unrelated, pre-existing legacy tables this
// application never reads or writes (see PHASE_2A_MIGRATION_PRE_APPROVAL_AUDIT.md
// and PHASE_2A_SCHEMA_COLLISION_REMEDIATION.md for why the original
// create_case_ownership_foundation.sql migration - now obsolete - collided
// with them and could never have applied).
//
// Reuses the same getSupabase() singleton every other service in this app
// uses (access.ts, usage.ts, gmailAgent.ts) - this app has exactly one
// Supabase client, always service_role, never a second competing one.
// ---------------------------------------------------------------------------

import { getSupabase } from "./access.js";

export interface Case {
  id: string;
  ownerUid: string;
  title: string;
  description: string | null;
  createdAt: string;
  updatedAt: string;
}

function mapCaseRow(row: any): Case {
  return {
    id: row.id,
    ownerUid: row.owner_uid,
    title: row.title,
    description: row.description ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/**
 * Creates a case AND its OWNER case_members row atomically, via the
 * create_navigator_case_with_owner() Postgres function (see the migration
 * file for why this - rather than two separate INSERTs from here - is what
 * guarantees a case can never exist without an owner).
 *
 * `ownerUid` must already be a server-verified Firebase uid by the time this
 * is called - this function does no authentication itself, matching the
 * pattern every other service function in this app follows (usage.ts,
 * access.ts's checkAndConsumeFreeToolUse) of trusting the uid it's given
 * because the route handler already verified it.
 */
export async function createCase(ownerUid: string, title: string): Promise<Case> {
  const db = getSupabase();
  const { data, error } = await db.rpc("create_navigator_case_with_owner", {
    p_owner_uid: ownerUid,
    p_title: title,
  });
  if (error) {
    throw Object.assign(new Error(`Failed to create case: ${error.message}`), { statusCode: 500 });
  }
  // A function declared `returns public.cases` (a single row type, not
  // setof) is returned by PostgREST as one object; defensively also accept
  // an array in case a future revision changes that, rather than assuming
  // one specific shape forever.
  const row = Array.isArray(data) ? data[0] : data;
  if (!row) {
    throw Object.assign(new Error("Case creation did not return a row."), { statusCode: 500 });
  }
  return mapCaseRow(row);
}
