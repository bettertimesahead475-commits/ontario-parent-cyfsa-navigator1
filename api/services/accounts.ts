import { getSupabase } from "./access.js";
import { LifecycleError } from "./lifecycleErrors.js";

export interface NavigatorAccount {
  id: string;
  primaryRole: "parent" | "lawyer" | "admin";
  status: "active" | "suspended" | "deleted";
}

// Callers must supply the UID from verifyFirebaseToken(), never request-body identity.
export async function findAccount(firebaseUid: string): Promise<NavigatorAccount | null> {
  const { data, error } = await getSupabase().from("accounts")
    .select("id, primary_role, status").eq("firebase_uid", firebaseUid).maybeSingle();
  if (error) throw new Error("Account lookup failed.");
  if (!data) return null;
  if (data.status !== "active") {
    throw new LifecycleError(403, "ACCOUNT_UNAVAILABLE", "Account is unavailable.");
  }
  return { id: data.id, primaryRole: data.primary_role, status: data.status };
}

export async function resolveAccount(firebaseUid: string, email: string | null): Promise<NavigatorAccount> {
  const existing = await findAccount(firebaseUid);
  if (existing) return existing;
  // UNIQUE(firebase_uid) arbitrates concurrent first requests. DO NOTHING preserves
  // all fields of a competing/existing row, including privileged roles and status.
  const { error } = await getSupabase().from("accounts").upsert({
    firebase_uid: firebaseUid, primary_role: "parent", email,
  }, { onConflict: "firebase_uid", ignoreDuplicates: true });
  if (error) throw new Error("Account provisioning failed.");
  const account = await findAccount(firebaseUid);
  if (!account) throw new Error("Account resolution failed.");
  return account;
}
