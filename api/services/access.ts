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
//      `access_codes`, and emails the plaintext code directly to the
//      parent (see sendAccessCodeEmail() below) - this is the only place
//      it's ever sent anywhere, on both the manual admin-approve route and
//      the automated Gmail-agent path, since both call this one function.
//   3. verifyAccessCode(identity, email, code) — parent-facing, requires a
//      verified Firebase identity (M-2/Finding-3 remediation). Checks the
//      code against the stored hash, confirms it's unused and unexpired,
//      atomically claims it, creates a row in the navigator_paid_sessions
//      table (see supabase/migrations_pending_approval/
//      create_navigator_paid_sessions.sql - not yet applied) binding the
//      session to the verified Firebase uid, and returns a signed,
//      minimal token (HMAC) embedding only { jti, exp } - the session row
//      itself, not the token, is authoritative for email/tier/revocation/
//      expiry. See verifySessionToken()/getActivePaidSession() below.
// ---------------------------------------------------------------------------

import crypto from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

export type Tier = "Pro" | "Premium";

export const TIER_PRICES: Record<Tier, number> = {
  Pro: 19,
  Premium: 49,
};

export const PAYMENT_EMAIL = "donations.ontarioparentassist@gmail.com";

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
// SECURITY FIX: this used to fall back to ADMIN_SECRET when SESSION_SECRET was unset, which
// meant a single leaked secret could both authenticate admin-only routes (x-admin-secret) AND
// forge paid-session tokens for any email/tier. Paid-session signing now requires its own,
// independently configured secret - no fallback, fails closed (throws, same as every other
// missing-configuration error in this codebase) if it's absent.
function getSessionSecret(): string {
  const secret = process.env.SESSION_SECRET;
  if (!secret) {
    throw Object.assign(new Error("SESSION_SECRET is not configured."), { statusCode: 503 });
  }
  return secret;
}

// SECURITY FIX (M-2 / Finding 3): this token used to embed { email, tier, exp } directly,
// which meant the token itself was fully self-contained and authoritative - anyone holding
// the bearer string got that email/tier forever (until natural expiry), with no way to
// revoke one specific session and no binding to the Firebase identity that redeemed it.
// The token now embeds only { jti, exp }: jti is the primary key of a
// navigator_paid_sessions row, and every fact that actually matters for an authorization
// decision (firebase_uid, tier, revoked_at, expires_at) lives in that row and is re-read on
// every request via getActivePaidSession() below - the token is a lookup key, not a claim.
export function issueSessionToken(jti: string, expiresAt: string | number): string {
  const exp = typeof expiresAt === "number" ? expiresAt : new Date(expiresAt).getTime();
  const payload = Buffer.from(JSON.stringify({ jti, exp })).toString("base64url");
  const sig = crypto.createHmac("sha256", getSessionSecret()).update(payload).digest("base64url");
  return `${payload}.${sig}`;
}

// Verifies the token's own signature/structure/expiry only - a cryptographic safeguard, not
// an authorization decision. A truthy result here proves the token wasn't tampered with and
// hasn't hit its own (generous) expiry; it does NOT prove the session is still active - the
// database row (getActivePaidSession) is what's authoritative for revocation/DB-side
// expiration/tier. Callers must always follow this with a getActivePaidSession() lookup
// before granting anything.
export function verifySessionToken(token: string): { jti: string } | null {
  const [payload, sig] = (token || "").split(".");
  if (!payload || !sig) return null;
  const expectedSig = crypto.createHmac("sha256", getSessionSecret()).update(payload).digest("base64url");
  if (!timingSafeEqualHex(sig, expectedSig)) return null;
  try {
    const parsed = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    if (typeof parsed.jti !== "string" || !parsed.jti) return null;
    if (typeof parsed.exp !== "number" || Date.now() > parsed.exp) return null;
    return { jti: parsed.jti };
  } catch {
    return null;
  }
}

// --- Database-backed paid sessions (public.navigator_paid_sessions) --------
// Table defined in supabase/migrations_pending_approval/create_navigator_paid_sessions.sql
// (reviewed, NOT yet applied to production). firebase_uid is always the server-verified uid
// from verifyFirebaseToken() - never a client-supplied value.
export interface PaidSession {
  id: string;
  firebaseUid: string;
  tier: Tier;
}

function mapPaidSessionRow(row: any): PaidSession {
  return { id: row.id, firebaseUid: row.firebase_uid, tier: row.tier as Tier };
}

const DEFAULT_SESSION_TTL_HOURS = 24 * 30;

// Creates the durable session row a redeemed access code produces. accessCodeId must be the
// id of the access_codes row already atomically claimed by the caller (see verifyAccessCode) -
// the table's UNIQUE(access_code_id) constraint is the final backstop against a code somehow
// producing two sessions (e.g. under a bug in the caller's own claim logic), surfaced here as
// a clean 409 rather than a raw constraint-violation message.
export async function createPaidSession(params: {
  firebaseUid: string;
  email: string | null;
  tier: Tier;
  accessCodeId: string;
  ttlHours?: number;
}): Promise<{ id: string; expiresAt: string }> {
  const db = getSupabase();
  const expiresAt = new Date(Date.now() + (params.ttlHours ?? DEFAULT_SESSION_TTL_HOURS) * 60 * 60 * 1000).toISOString();
  const { data, error } = await db
    .from("navigator_paid_sessions")
    .insert({
      firebase_uid: params.firebaseUid,
      email: params.email,
      tier: params.tier,
      expires_at: expiresAt,
      access_code_id: params.accessCodeId,
    })
    .select("id, expires_at")
    .single();
  if (error) {
    if (error.code === "23505") {
      throw Object.assign(new Error("This access code has already been redeemed."), { statusCode: 409, code: error.code });
    }
    throw Object.assign(new Error(`Failed to create paid session: ${error.message}`), { statusCode: 500, code: error.code });
  }
  return { id: data.id, expiresAt: data.expires_at };
}

// The single, authoritative check every protected route must perform: a session only counts
// as active if the row exists, has never been revoked, and hasn't passed its own DB-recorded
// expiry - the token's own exp claim (verifySessionToken above) is a secondary safeguard, not
// a substitute for this. Returns null for "not usable" without distinguishing why (not found /
// revoked / expired) - callers only ever need a yes/no answer, and not distinguishing avoids
// leaking which case applies to anything client-facing.
export async function getActivePaidSession(sessionId: string): Promise<PaidSession | null> {
  const db = getSupabase();
  const { data, error } = await db
    .from("navigator_paid_sessions")
    .select("id, firebase_uid, tier, revoked_at, expires_at")
    .eq("id", sessionId)
    .maybeSingle();
  if (error) throw Object.assign(new Error(`Failed to look up paid session: ${error.message}`), { statusCode: 500 });
  if (!data) return null;
  if (data.revoked_at) return null;
  if (new Date(data.expires_at).getTime() <= Date.now()) return null;
  return mapPaidSessionRow(data);
}

// --- Revocation ---------------------------------------------------------
// Both functions are idempotent (scoped to `revoked_at is null`) and return how many rows
// they actually changed, so a caller can tell "already revoked" apart from "revoked just now"
// without a separate read. Not exposed to any route without the existing x-admin-secret
// pattern already used by every other admin action in this codebase (see api/_server.ts) -
// no new authorization mechanism is introduced here.

export async function revokeSession(sessionId: string, reason?: string | null): Promise<boolean> {
  const db = getSupabase();
  const { data, error } = await db
    .from("navigator_paid_sessions")
    .update({ revoked_at: new Date().toISOString(), revocation_reason: reason ?? null })
    .eq("id", sessionId)
    .is("revoked_at", null)
    .select("id");
  if (error) throw Object.assign(new Error(`Failed to revoke session: ${error.message}`), { statusCode: 500 });
  return !!data && data.length > 0;
}

export async function revokeAllSessionsForUid(firebaseUid: string, reason?: string | null): Promise<number> {
  const db = getSupabase();
  const { data, error } = await db
    .from("navigator_paid_sessions")
    .update({ revoked_at: new Date().toISOString(), revocation_reason: reason ?? null })
    .eq("firebase_uid", firebaseUid)
    .is("revoked_at", null)
    .select("id");
  if (error) throw Object.assign(new Error(`Failed to revoke sessions for uid: ${error.message}`), { statusCode: 500 });
  return data ? data.length : 0;
}

// --- Free-tier quota: "1 free, then pay" for /api/analyze and /api/extract-evidence --------
// Backed by the free_tool_usage table (email, tool unique pair; tool CHECK-constrained to
// 'analyze'/'extract-evidence'). This table already existed in the live DB, unused by any
// route - /api/analyze has its own separate uid-keyed free_usage table/counter (see
// services/usage.ts); this one is for extract-evidence, keyed by the verified email a
// Firebase ID token carries (never a client-supplied header). The insert IS the claim: if it
// succeeds, this is the parent's first (free) use of that tool; if it fails on the unique
// constraint, they've already spent it. Race-safe under concurrent requests, unlike a
// select-then-insert check.
export type FreeTool = "analyze" | "extract-evidence";

export async function checkAndConsumeFreeToolUse(email: string, tool: FreeTool): Promise<boolean> {
  const db = getSupabase();
  const normalizedEmail = email.toLowerCase().trim();
  const { error } = await db.from("free_tool_usage").insert({ email: normalizedEmail, tool });
  if (!error) return true;
  if (error.code === "23505") return false; // unique_violation - already used this tool's free pass
  throw Object.assign(new Error(`Failed to check free tool usage: ${error.message}`), { statusCode: 500 });
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

  // Atomically claim this payment before doing anything else: scoping the UPDATE to
  // status = 'pending' and checking whether it actually matched a row is what makes this
  // safe against two near-simultaneous calls for the same reference number (e.g. an admin
  // approving by hand while the Gmail agent's cron is mid-run, or two overlapping cron
  // invocations at the 2-minute interval). Without this, both callers would pass the SELECT
  // above before either had written anything, and both would go on to mint and issue a
  // separate access code for the same payment. Postgres serializes the two UPDATEs even
  // though the SELECTs can race, so exactly one of them ever sees a matched row here.
  const { data: claimed, error: claimErr } = await db
    .from("payments")
    .update({ status: "approved", approved_at: new Date().toISOString() })
    .eq("reference_number", referenceNumber)
    .eq("status", "pending")
    .select("reference_number");
  if (claimErr) throw Object.assign(new Error(`Failed to claim payment for approval: ${claimErr.message}`), { statusCode: 500 });
  if (!claimed || claimed.length === 0) {
    throw Object.assign(
      new Error("This payment was already approved by a concurrent request. No second access code was issued."),
      { statusCode: 409 }
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
  if (codeErr) throw Object.assign(new Error(`Payment was marked approved but code generation failed: ${codeErr.message}`), { statusCode: 500 });

  // Plaintext code is only ever visible right here - it's never stored anywhere, so this
  // email IS the delivery mechanism, not a courtesy copy. Both callers (the manual
  // /api/admin/approve-payment route and the Gmail agent's automated scanForPayments()) go
  // through this one function, so wiring the send here - rather than in each caller - is
  // what makes it actually automatic on both paths instead of relying on Chris to forward it
  // by hand. A failed send does NOT fail the approval (the payment is already correctly
  // marked approved and the code already exists - that's the source of truth); the caller
  // gets emailSent: false back and decides what to do about it.
  const emailSent = await sendAccessCodeEmail(email, tier, code, referenceNumber);

  return { email, tier, code, referenceNumber, emailSent };
}

// --- Delivers the plaintext code to the parent - the only point it's ever sent anywhere ---
async function sendAccessCodeEmail(email: string, tier: Tier, code: string, referenceNumber: string): Promise<boolean> {
  const hasSmtpConfig = Boolean(process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS);
  if (!hasSmtpConfig) {
    console.error("[access-code email] SMTP not configured - code NOT emailed to parent:", referenceNumber);
    return false;
  }
  if (!email) {
    console.error("[access-code email] No parent email on file - code NOT emailed:", referenceNumber);
    return false;
  }
  try {
    const nodemailer = await import("nodemailer");
    const transporter = nodemailer.default.createTransport({
      host: process.env.SMTP_HOST,
      port: Number(process.env.SMTP_PORT) || 587,
      secure: process.env.SMTP_SECURE === "true",
      auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
    });
    await transporter.sendMail({
      from: process.env.SMTP_FROM || process.env.SMTP_USER,
      to: email,
      subject: `Your Ontario Parent Assist access code (${tier})`,
      text:
        `Your Interac e-transfer (reference ${referenceNumber}) has been confirmed. Here is your ${tier} access code:\n\n` +
        `${code}\n\n` +
        `To activate it: go to the Membership page, enter this email address (${email}) and the code above under "Enter Access Code," then click Activate.\n\n` +
        `This code is single-use and expires in ${CODE_TTL_DAYS} days if not activated. Keep it somewhere safe until then.\n\n` +
        `If you weren't expecting this email, you can ignore it.`,
    });
    return true;
  } catch (mailErr) {
    console.error("[access-code email] send failed", mailErr);
    return false;
  }
}

// --- Step 3: parent redeems email + code -----------------------------------
// `identity` is the caller's server-verified Firebase identity (verifyFirebaseToken(),
// checked by the route before this is ever called) - it is what the resulting paid session
// is bound to (navigator_paid_sessions.firebase_uid), never the `email` argument. `email` is
// still required and used exactly as before: it's the lookup key into the existing
// access_codes table (unmodified by this change - it has no firebase_uid column and is keyed
// by email), so it remains functionally necessary for finding the right code, but it is no
// longer what authorizes anything - a caller cannot get a session bound to a Firebase uid
// other than their own verified one no matter what email string they submit here.
export async function verifyAccessCode(identity: { uid: string; email: string | null }, email: string, code: string) {
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

  // SECURITY FIX: atomically claim the code before doing anything else, mirroring
  // approvePayment()'s established claim pattern above. Without scoping this UPDATE to
  // `used_at is null` and checking whether it actually matched a row, two near-simultaneous
  // redemption attempts for the same code could both pass the SELECT above before either
  // UPDATE landed, and both would go on to mint a session - the exact TOCTOU race a prior
  // audit identified in this function. Postgres serializes the two UPDATEs even though the
  // SELECTs can race, so exactly one caller ever sees a matched row here. The table's
  // UNIQUE(access_code_id) constraint (see the pending navigator_paid_sessions migration)
  // remains a second, independent backstop below - this fix does not replace it, and does not
  // modify the access_codes table itself.
  const { data: claimed, error: claimErr } = await db
    .from("access_codes")
    .update({ used_at: new Date().toISOString() })
    .eq("id", match.id)
    .is("used_at", null)
    .select("id");
  if (claimErr) throw Object.assign(new Error(claimErr.message), { statusCode: 500 });
  if (!claimed || claimed.length === 0) {
    throw Object.assign(new Error("This code was already redeemed by a concurrent request."), { statusCode: 409 });
  }

  const tier = match.tier as Tier;
  const session = await createPaidSession({
    firebaseUid: identity.uid,
    email: identity.email,
    tier,
    accessCodeId: match.id,
  });

  const token = issueSessionToken(session.id, session.expiresAt);
  return { token, tier, email: normalizedEmail };
}
