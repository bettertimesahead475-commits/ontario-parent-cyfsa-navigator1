// ---------------------------------------------------------------------------
// Phase 3: the permanent Matter foundation. See
// supabase/migrations_pending_approval/create_navigator_matters_foundation.sql
// (applied) for the exact schema and the create_navigator_matter_with_owner()
// function this service calls.
//
// Uses the accounts/clients/navigator_matters/navigator_matter_members
// tables and the create_navigator_matter_with_owner() function - NOT
// navigator_cases/navigator_case_members, which remain in place (inert,
// unmodified) until a separate, later-authorized task retires them.
//
// Reuses the same getSupabase() singleton every other service in this app
// uses (access.ts, usage.ts, cases.ts, gmailAgent.ts).
// ---------------------------------------------------------------------------

import { getSupabase } from "./access.js";

export interface Matter {
  id: string;
  accountId: string;
  clientId: string;
  title: string;
  description: string | null;
  createdAt: string;
  updatedAt: string;
}

function mapMatterRow(row: any): Matter {
  return {
    id: row.id,
    accountId: row.account_id,
    clientId: row.client_id,
    title: row.title,
    description: row.description ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/**
 * Creates a Matter AND its OWNER navigator_matter_members row atomically, via
 * the create_navigator_matter_with_owner() Postgres function (see the
 * migration file for why this - rather than separate application-code
 * inserts - guarantees a Matter can never exist without an OWNER, and an
 * account can never be resolved from anything but a server-verified Firebase
 * uid).
 *
 * `firebaseUid` must already be a server-verified Firebase uid by the time
 * this is called - this function does no authentication itself, matching
 * the pattern createCase() (cases.ts) and every other service function in
 * this app already follows.
 *
 * ROLE DETERMINATION (entirely server-side, never from a caller-supplied
 * argument): if an accounts row already exists for firebaseUid, this
 * function uses that row's own primary_role - unchanged, never overwritten
 * (the RPC's ON CONFLICT (firebase_uid) DO NOTHING guarantees this at the
 * database layer too). If no accounts row exists yet, this function passes
 * the hardcoded product default 'parent' - lawyer/admin accounts are
 * provisioned exclusively through a separate, not-yet-built, server-
 * controlled path, never through self-service Matter creation. There is no
 * `role`/`primaryRole` parameter on this function's public signature - role
 * is decided here, internally, so no caller (including the route above it)
 * can influence it.
 */
export async function createMatter(
  firebaseUid: string,
  clientId: string,
  title: string,
  description: string | null,
  email: string | null
): Promise<Matter> {
  const db = getSupabase();

  const { data: existingAccount, error: lookupErr } = await db
    .from("accounts")
    .select("primary_role")
    .eq("firebase_uid", firebaseUid)
    .maybeSingle();
  if (lookupErr) {
    throw Object.assign(new Error(`Failed to look up account: ${lookupErr.message}`), { statusCode: 500 });
  }
  const primaryRole = existingAccount?.primary_role ?? "parent";

  const { data, error } = await db.rpc("create_navigator_matter_with_owner", {
    p_firebase_uid: firebaseUid,
    p_primary_role: primaryRole,
    p_client_id: clientId,
    p_title: title,
    p_description: description,
    p_email: email,
  });
  if (error) {
    // The RPC raises a plain exception (not a distinct Postgres error code)
    // for "the supplied client does not belong to the resolved account" -
    // the smallest consistent choice, mirroring createCase()'s existing
    // generic-500 treatment of its own RPC errors, is to surface this one
    // specific, expected case as 403 (an authorization failure, not a
    // caller mistake or a server fault) and fall back to createCase()'s
    // same generic 500 for anything else, rather than inventing a broader
    // error-classification framework this codebase has no other example of.
    if (error.message.includes("does not belong to the resolved account")) {
      throw Object.assign(new Error("The supplied client does not belong to your account."), { statusCode: 403 });
    }
    throw Object.assign(new Error(`Failed to create matter: ${error.message}`), { statusCode: 500 });
  }
  // A function declared `returns public.navigator_matters` (a single row
  // type, not setof) is returned by PostgREST as one object; defensively
  // also accept an array, matching createCase()'s existing precedent.
  const row = Array.isArray(data) ? data[0] : data;
  if (!row) {
    throw Object.assign(new Error("Matter creation did not return a row."), { statusCode: 500 });
  }
  return mapMatterRow(row);
}
