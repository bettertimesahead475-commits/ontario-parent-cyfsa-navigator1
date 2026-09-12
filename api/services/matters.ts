// ---------------------------------------------------------------------------
// Matter foundation (unfinished domain additions in PR #21). See
// supabase/migrations_pending_approval/create_navigator_matters_foundation.sql
// (applied) for the exact schema and the create_navigator_matter_with_owner()
// function this service calls.
//
// Uses the accounts/clients/navigator_matters/navigator_matter_members
// tables and the create_navigator_matter_with_owner() function - NOT
// navigator_cases/navigator_case_members, which remain active through
// POST /api/cases. Retirement requires a separate authorized task.
//
// Reuses the same getSupabase() singleton every other service in this app
// uses (access.ts, usage.ts, cases.ts, gmailAgent.ts).
// ---------------------------------------------------------------------------

import { getSupabase } from "./access.js";
import { findAccount, resolveAccount } from "./accounts.js";
import { requireOwnedClient } from "./clients.js";
import { LifecycleError, requireText, requireUuid } from "./lifecycleErrors.js";

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
 * Verified Firebase UID only. Account provisioning is independently idempotent;
 * client ownership is prechecked for a safe 404, then checked again in the RPC.
 * The reviewed RPC still creates the matter and OWNER membership atomically.
 * Existing roles are read from accounts, never accepted from the browser.
 */
export async function createMatter(
  firebaseUid: string,
  clientId: string,
  title: string,
  description: string | null,
  email: string | null
): Promise<Matter> {
  clientId = requireUuid(clientId, "clientId");
  title = requireText(title, "title", 200);
  if (description !== null && (typeof description !== "string" || description.length > 10000)) {
    throw new LifecycleError(400, "INVALID_REQUEST", "description must be text of at most 10000 characters.");
  }
  const db = getSupabase();
  const account = await resolveAccount(firebaseUid, email);
  await requireOwnedClient(account.id, clientId);

  const { data, error } = await db.rpc("create_navigator_matter_with_owner", {
    p_firebase_uid: firebaseUid,
    p_primary_role: account.primaryRole,
    p_client_id: clientId,
    p_title: title,
    p_description: description,
    p_email: email,
  });
  if (error) {
    // Ownership may change after the precheck; keep the same non-enumerating error.
    if (error.message.includes("does not belong to the resolved account")) {
      throw new LifecycleError(404, "CLIENT_NOT_FOUND", "Client not found.");
    }
    throw new Error("Matter creation failed.");
  }
  // A function declared `returns public.navigator_matters` (a single row
  // type, not setof) is returned by PostgREST as one object; defensively
  // also accept an array, matching createCase()'s existing precedent.
  const row = Array.isArray(data) ? data[0] : data;
  if (!row) {
    throw new Error("Matter creation did not return a row.");
  }
  return mapMatterRow(row);
}

export async function getOwnedMatter(firebaseUid: string, matterId: string): Promise<Matter> {
  matterId = requireUuid(matterId, "matterId");
  const account = await findAccount(firebaseUid);
  const notFound = () => new LifecycleError(404, "MATTER_NOT_FOUND", "Matter not found.");
  if (!account) throw notFound();
  const db = getSupabase();
  const { data, error } = await db.from("navigator_matters")
    .select("id, account_id, client_id, title, description, created_at, updated_at")
    .eq("id", matterId).eq("account_id", account.id).maybeSingle();
  if (error) throw new Error("Matter lookup failed.");
  if (!data) throw notFound();
  const { data: member, error: memberError } = await db.from("navigator_matter_members")
    .select("id").eq("matter_id", matterId).eq("account_id", account.id).eq("role", "OWNER").maybeSingle();
  if (memberError) throw new Error("Matter membership lookup failed.");
  if (!member) throw notFound();
  await requireOwnedClient(account.id, data.client_id);
  return mapMatterRow(data);
}
