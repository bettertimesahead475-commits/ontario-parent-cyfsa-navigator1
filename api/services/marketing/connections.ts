// ---------------------------------------------------------------------------
// connections.ts — the stored Facebook Page connection. Tokens are encrypted
// before they reach the database and decrypted only inside the server process.
// Nothing here returns a token to a caller. Route responses carry page names
// and IDs only.
// ---------------------------------------------------------------------------

import { getSupabase } from "../access.js";
import { decryptSecret, encryptSecret } from "./secrets.js";
import { logAgentAction } from "./store.js";

export type ConnectionStatus = "pending_selection" | "connected" | "expired" | "disconnected";

export interface ManagedPage {
  id: string;
  name: string;
  accessToken: string;
}

interface ConnectionRow {
  platform: string;
  status: ConnectionStatus;
  page_id: string | null;
  page_name: string | null;
  token_ciphertext: string | null;
  pending_ciphertext: string | null;
  pending_expires_at: string | null;
  connected_at: string | null;
  connected_by: string | null;
  last_error: string | null;
}

const PENDING_TTL_MS = 15 * 60 * 1000;

async function readRow(): Promise<ConnectionRow | null> {
  const db = getSupabase();
  const { data, error } = await db.from("marketing_connections").select("*").eq("platform", "facebook").maybeSingle();
  if (error) throw Object.assign(new Error(`Failed to load Facebook connection: ${error.message}`), { statusCode: 500 });
  return (data as ConnectionRow) ?? null;
}

async function writeRow(patch: Partial<ConnectionRow>): Promise<void> {
  const db = getSupabase();
  const { error } = await db.from("marketing_connections").upsert({ platform: "facebook", ...patch }, { onConflict: "platform" });
  if (error) throw Object.assign(new Error(`Failed to save Facebook connection: ${error.message}`), { statusCode: 500 });
}

/** Public, token-free view for the admin UI. */
export async function getFacebookConnectionView(): Promise<{
  status: ConnectionStatus;
  pageId: string | null;
  pageName: string | null;
  connectedAt: string | null;
  lastError: string | null;
  pendingPages: { id: string; name: string }[];
}> {
  const row = await readRow();
  const pending = row?.status === "pending_selection" ? await readPending(row) : [];
  return {
    status: row?.status ?? "disconnected",
    pageId: row?.page_id ?? null,
    pageName: row?.page_name ?? null,
    connectedAt: row?.connected_at ?? null,
    lastError: row?.last_error ?? null,
    pendingPages: pending.map((p) => ({ id: p.id, name: p.name })),
  };
}

async function readPending(row: ConnectionRow): Promise<ManagedPage[]> {
  if (!row.pending_ciphertext || !row.pending_expires_at) return [];
  if (new Date(row.pending_expires_at).getTime() < Date.now()) return [];
  return JSON.parse(decryptSecret(row.pending_ciphertext)) as ManagedPage[];
}

/** Stores the Pages the owner may choose from. Tokens stay encrypted until selection. */
export async function savePendingPages(pages: ManagedPage[], connectedBy: string): Promise<void> {
  await writeRow({
    status: "pending_selection",
    pending_ciphertext: encryptSecret(JSON.stringify(pages)),
    pending_expires_at: new Date(Date.now() + PENDING_TTL_MS).toISOString(),
    connected_by: connectedBy,
    last_error: null,
  });
  await logAgentAction({ action: "facebook.connect", status: "info", platform: "facebook", detail: `Authorized; ${pages.length} Page(s) available to select.` });
}

/** Activates one Page the owner picked. Rejects IDs that were not in the saved list. */
export async function selectPendingPage(pageId: string, connectedBy: string): Promise<{ id: string; name: string }> {
  const row = await readRow();
  if (!row || row.status !== "pending_selection") {
    throw Object.assign(new Error("No Facebook Page is waiting for selection. Connect Facebook again."), { statusCode: 409 });
  }
  const pages = await readPending(row);
  const chosen = pages.find((p) => p.id === pageId);
  if (!chosen) {
    throw Object.assign(new Error("That Page is not in the list from Facebook, or the selection expired. Connect again."), { statusCode: 400 });
  }
  await writeRow({
    status: "connected",
    page_id: chosen.id,
    page_name: chosen.name,
    token_ciphertext: encryptSecret(chosen.accessToken),
    pending_ciphertext: null,
    pending_expires_at: null,
    connected_by: connectedBy,
    connected_at: new Date().toISOString(),
    last_error: null,
  });
  await logAgentAction({ action: "facebook.select", status: "success", platform: "facebook", detail: `Connected Page "${chosen.name}".` });
  return { id: chosen.id, name: chosen.name };
}

/** Returns the usable Page credentials, or null with a reason the caller can show. */
export async function loadFacebookCredentials(): Promise<{
  ok: boolean;
  pageId?: string;
  token?: string;
  reason?: "none" | "expired";
  message?: string;
}> {
  const row = await readRow();
  if (!row || row.status === "disconnected" || row.status === "pending_selection") {
    return { ok: false, reason: "none", message: "Facebook Page is not connected." };
  }
  if (row.status === "expired") {
    return { ok: false, reason: "expired", message: row.last_error || "Facebook connection expired. Reconnect the Page." };
  }
  if (!row.token_ciphertext || !row.page_id) {
    return { ok: false, reason: "none", message: "Facebook Page is not connected." };
  }
  return { ok: true, pageId: row.page_id, token: decryptSecret(row.token_ciphertext) };
}

/** Records that Facebook rejected the stored token. The owner must reconnect. */
export async function markFacebookExpired(detail: string): Promise<void> {
  await writeRow({ status: "expired", last_error: detail });
  await logAgentAction({ action: "facebook.expired", status: "error", platform: "facebook", detail });
}

/** Removes the stored token. Posts already on Facebook are unaffected. */
export async function disconnectFacebook(actor: string): Promise<void> {
  await writeRow({
    status: "disconnected",
    page_id: null,
    page_name: null,
    token_ciphertext: null,
    pending_ciphertext: null,
    pending_expires_at: null,
    connected_by: actor,
    connected_at: null,
    last_error: null,
  });
  await logAgentAction({ action: "facebook.disconnect", status: "info", platform: "facebook", detail: "Facebook Page disconnected; token removed." });
}
