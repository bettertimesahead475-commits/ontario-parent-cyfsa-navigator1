import { getSupabase } from "./access.js";
import { resolveAccount } from "./accounts.js";
import { LifecycleError, requireText } from "./lifecycleErrors.js";

export async function requireOwnedClient(accountId: string, clientId: string): Promise<void> {
  const { data, error } = await getSupabase().from("clients").select("id")
    .eq("id", clientId).eq("account_id", accountId).maybeSingle();
  if (error) throw new Error("Client lookup failed.");
  // Do not reveal whether an inaccessible ID exists under another account.
  if (!data) throw new LifecycleError(404, "CLIENT_NOT_FOUND", "Client not found.");
}

export async function createClient(firebaseUid: string, email: string | null, name: unknown) {
  const trimmedName = requireText(name, "name", 200);
  const account = await resolveAccount(firebaseUid, email);
  const { data, error } = await getSupabase().from("clients").insert({
    account_id: account.id, name: trimmedName,
  }).select("id, name, created_at, updated_at").single();
  if (error || !data) throw new Error("Client creation failed.");
  return { id: data.id, name: data.name, createdAt: data.created_at, updatedAt: data.updated_at };
}
