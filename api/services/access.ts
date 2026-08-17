// ---------------------------------------------------------------------------
// Real e-transfer access-code flow, backed by Supabase (project
// qboidsfpjuxeqtfotryj / cyfsa-parent-platform, tables: payments,
// access_codes — both already existed in the DB, unused, before this file).
//
// This replaces the old accessCode.js / accessRoutes.js / accessStore.js
// trio, which was CommonJS `require()` code sitting inside an ESM project
// (would throw immediately if ever imported) and used a local JSON file as
// its store, which does not persist on Vercel's serverless filesystem. That
// old code was never wired into api/_app.ts — it did nothing in production.
//
// Flow:
//   1. requestAccess(email, tier) — creates a `payments` row (status
//      'pending'), returns a reference number the parent puts in the
//      Interac e-transfer memo/message field.
//   2. approvePayment(referenceNumber, amountSentByParent) — admin-only
//      (gated by ADMIN_SECRET header in the route). Verifies the amount
//      matches or exceeds the tier price, flips the payment to 'approved',
//      generates a one-time access code, stores only its SHA-256 hash in
//      `access_codes`, and returns the plaintext code exactly once so it
//      can be sent to the parent.
//   3. verifyAccessCode(email, code) — parent-facing. Checks the code
//      against the stored hash, confirms it's unused and unexpired, marks
//      it used, and returns a signed session token (HMAC, no session table
//      needed) embedding { email, tier, exp }.
// ---------------------------------------------------------------------------

import crypto from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

export type Tier = "Pro" | "Premium";

export const TIER_PRICES: Record<Tier, number> = {
  Pro: 19,
  Premium: 49,
};

export const PAYMENT_EMAIL = "ontarioparentassist@gmail.com";

const CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"; // no 0/O/1/I/L — easy to type off a phone
const CODE_TTL_DAYS = 14; // an issued-but-unredeemed code expires after this long

let supabase: SupabaseClient | null = null;
export function getSupabase(): SupabaseClient {
  if (supabase) return supabase;
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;
  if (!url || !key) {
    throw Object.assign(
      new Error(
        "SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY (or SUPABASE_SERVICE_KEY) are not configured. Set them in Vercel → Project → Settings → Environment Variables, then redeploy."
      ),
      { statusCode: 503 }
    );
  }
  supabase = createClient(url, key, { auth: { persistSession: false } });
  return supabase;
}

function generateReferenceNumber(): string {
  // Short, human-typeable, put in the e-transfer memo so payments can be
  // matched even if the sender's name/email on the transfer doesn't match.
  const bytes = crypto.randomBytes(5);
  let code = "";
  for (let i = 0; i < bytes.length; i++) code += CODE_ALPHABET[bytes[i] % CODE_ALPHABET.length];
  return `PS-${code}`;
}

function generateAccessCode(): string {
  const bytes = crypto.randomBytes(10);
  let code = "";
  for (let i = 0; i < bytes.length; i++) code += CODE_ALPHABET[bytes[i] % CODE_ALPHABET.length];
  return code.match(/.{1,4}/g)!.join("-");
}

function hashCode(code: string): string {
  return crypto.createHash("sha256").update(code.toUpperCase().trim()).digest("hex");
}

function timingSafeEqualHex(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

// --- Session tokens: HMAC-signed, stateless, no session table needed ------
function getSessionSecret(): string {
  const secret = process.env.SESSION_SECRET || process.env.ADMIN_SECRET;
  if (!secret) {
    throw Object.assign(new Error("SESSION_SECRET (or ADMIN_SECRET) is not configured."), { statusCode: 503 });
  }
  return secret;
}

export function issueSessionToken(email: string, tier: Tier, ttlHours = 24 * 30): string {
  const exp = Date.now() + ttlHours * 60 * 60 * 1000;
  const payload = Buffer.from(JSON.stringify({ email, tier, exp })).toString("base64url");
  const sig = crypto.createHmac("sha256", getSessionSecret()).update(payload).digest("base64url");
  return `${payload}.${sig}`;
}

export function verifySessionToken(token: string): { email: string; tier: Tier } | null {
  const [payload, sig] = (token || "").split(".");
  if (!payload || !sig) return null;
  const expectedSig = crypto.createHmac("sha256", getSessionSecret()).update(payload).digest("base64url");
  if (!timingSafeEqualHex(sig, expectedSig)) return null;
  try {
    const parsed = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    if (typeof parsed.exp !== "number" || Date.now() > parsed.exp) return null;
    return { email: parsed.email, tier: parsed.tier };
  } catch {
    return null;
  }
}

// --- Step 1: parent requests access before paying --------------------------
export async function requestAccess(email: string, tier: Tier) {
  const db = getSupabase();
  const referenceNumber = generateReferenceNumber();
  const amount = TIER_PRICES[tier];

  const { error } = await db.from("payments").insert({
    plan: tier,
    user_role: "parent",
    amount,
    payment_method: "interac_etransfer",
    payment_email: PAYMENT_EMAIL,
    reference_number: referenceNumber,
    status: "pending",
    notes: `email:${email.toLowerCase().trim()}`,
  });
  if (error) throw Object.assign(new Error(`Failed to record payment request: ${error.message}`), { statusCode: 500 });

  return {
    referenceNumber,
    amount,
    payTo: PAYMENT_EMAIL,
    instructions: `Send an Interac e-transfer for $${amount} CAD to ${PAYMENT_EMAIL}. Put "${referenceNumber}" in the message/memo field so your payment can be matched. Once it's confirmed, you'll receive an access code.`,
  };
}

// --- Step 2: admin approves after confirming the e-transfer landed --------
export async function approvePayment(referenceNumber: string, amountReceived: number) {
  const db = getSupabase();
  const { data: payment, error: findErr } = await db
    .from("payments")
    .select("*")
    .eq("reference_number", referenceNumber)
    .eq("status", "pending")
    .maybeSingle();
  if (findErr) throw Object.assign(new Error(findErr.message), { statusCode: 500 });
  if (!payment) throw Object.assign(new Error("No pending payment found for that reference number."), { statusCode: 404 });

  const expected = Number(payment.amount);
  if (amountReceived < expected) {
    throw Object.assign(
      new Error(`Amount received ($${amountReceived}) is less than the expected $${expected} for ${payment.plan}. Not approving — check with the parent before overriding.`),
      { statusCode: 400 }
    );
  }

  const email = (payment.notes || "").replace(/^email:/, "").trim();
  const tier = payment.plan as Tier;
  const code = generateAccessCode();

  const { error: codeErr } = await db.from("access_codes").insert({
    email,
    tier,
    reference_number: referenceNumber,
    amount: amountReceived,
    code_hash: hashCode(code),
    expires_at: new Date(Date.now() + CODE_TTL_DAYS * 24 * 60 * 60 * 1000).toISOString(),
  });
  if (codeErr) throw Object.assign(new Error(`Payment matched but code generation failed: ${codeErr.message}`), { statusCode: 500 });

  const { error: updateErr } = await db
    .from("payments")
    .update({ status: "approved", approved_at: new Date().toISOString() })
    .eq("reference_number", referenceNumber);
  if (updateErr) throw Object.assign(new Error(`Code was generated but payment status failed to update: ${updateErr.message}`), { statusCode: 500 });

  // Plaintext code is only ever visible right here — send it to the parent
  // yourself (email/text). It is never stored in plaintext anywhere.
  return { email, tier, code, referenceNumber };
}

// --- Step 3: parent redeems email + code -----------------------------------
export async function verifyAccessCode(email: string, code: string) {
  const db = getSupabase();
  const normalizedEmail = email.toLowerCase().trim();

  const { data: candidates, error } = await db
    .from("access_codes")
    .select("*")
    .eq("email", normalizedEmail)
    .is("used_at", null)
    .order("created_at", { ascending: false });
  if (error) throw Object.assign(new Error(error.message), { statusCode: 500 });
  if (!candidates || candidates.length === 0) {
    throw Object.assign(new Error("Invalid email or code."), { statusCode: 401 });
  }

  const inputHash = hashCode(code);
  const match = candidates.find((c) => timingSafeEqualHex(c.code_hash, inputHash));
  if (!match) throw Object.assign(new Error("Invalid email or code."), { statusCode: 401 });

  if (match.expires_at && new Date(match.expires_at).getTime() < Date.now()) {
    throw Object.assign(new Error("This code has expired. Contact support for a new one."), { statusCode: 401 });
  }

  const { error: updateErr } = await db.from("access_codes").update({ used_at: new Date().toISOString() }).eq("id", match.id);
  if (updateErr) throw Object.assign(new Error(updateErr.message), { statusCode: 500 });

  const token = issueSessionToken(normalizedEmail, match.tier as Tier);
  return { token, tier: match.tier as Tier, email: normalizedEmail };
}
