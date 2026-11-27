/**
 * Free-trial entitlements (owner policy 2026-11-27): every eligible verified account gets ONE free Quick Document
 * Review and ONE free Forensic Deep Scan, lifetime, never replenished. Final Case Assessment and audio transcription
 * are paid only. Engineering record: engineering/FREE_TRIAL_POLICY_20261127.md.
 *
 * Enforcement reuses the live, qualified free_reserve_scan / free_finalize_scan / free_release_scan functions
 * (per-key advisory lock, one transaction, idempotent per request id), so no schema change is needed. Counter keys
 * (rows of public.free_usage; none collides with a Firebase uid, which has no ':'):
 * - `fq:<h>` / `ff:<h>`: the Quick / Forensic trial, h = sha256 of the normalized verified email. Keying on the email
 *   (not the uid) means deleting and re-creating an account, or a Gmail dot/+tag alias, never gets a second trial.
 * - the legacy uid counter: an account that started under the earlier 3-free-Quick-Reviews offer keeps what it was
 *   granted (3 minus what it used), reserved on that same counter.
 * - `fox:<h>`: lifetime OCR extractions for an account without a paid session (OCR is only for entitled processing).
 * - `fip:<h>:<yyyymmdd>` / `fim:<h>:<yyyymm>`: trials started per client IP per day / month (abuse detection).
 * - `plat:<lane>:<yyyymmdd>`: platform-wide daily caps checked before any provider call (lanes: paid, fq, ff, ocr).
 *   Free lanes stop first, and stop entirely once paid volume reaches FREE_TRIAL_PAUSE_AT_PAID_DAILY, so paid
 *   customers keep the capacity when the budget is constrained.
 * The reservation id is `free_res_<key>_<32 hex>`, so release and finalize recover the key from it (queue consumer).
 */
import type { CreditRpc } from './_paid-credit-reservation';
import { normalizeApiKey } from './_supabase-key';
import { reserveFreeScan } from './_free-credit-reservation';
import { finalizeFreeScan, releaseFreeScan } from './_free-credit-lifecycle';

export type FreeTrialKind = 'quick' | 'forensic';

export const FREE_TRIAL_LIMITS: Record<FreeTrialKind, number> = { quick: 1, forensic: 1 };
/** Free Quick Reviews granted under the superseded offer; honoured for accounts that already started using it. */
export const LEGACY_FREE_QUICK_LIMIT = 3;
/** Per free scan: 10 MB file, 30 pages (owner decision). Paid limits are unchanged (_document-extraction.ts). */
export const FREE_TRIAL_MAX_BYTES = 10 * 1024 * 1024;
export const FREE_TRIAL_MAX_PAGES = 30;
/** Text accepted by a free analysis: 30 pages at ~3,500 characters a page; Quick keeps its 75,000 ceiling. */
export const FREE_TRIAL_MAX_CHARS: Record<FreeTrialKind, number> = { quick: 75_000, forensic: 105_000 };
/** OCR extraction requests per account without a paid session, lifetime (two trials plus one re-read). */
export const FREE_OCR_LIFETIME_LIMIT = 3;

export interface FreeTrialEnv {
  STAGING_SUPABASE_URL?: string;
  STAGING_SUPABASE_SERVICE_ROLE_KEY?: string;
  TURNSTILE_SECRET_KEY?: string;
  FREE_TRIAL_REQUIRE_CAPTCHA?: string;
  FREE_TRIAL_IP_DAILY_LIMIT?: string;
  FREE_TRIAL_IP_MONTHLY_LIMIT?: string;
  FREE_QUICK_PLATFORM_DAILY_LIMIT?: string;
  FREE_FORENSIC_PLATFORM_DAILY_LIMIT?: string;
  FREE_OCR_PLATFORM_DAILY_LIMIT?: string;
  PAID_PLATFORM_DAILY_LIMIT?: string;
  FREE_TRIAL_PAUSE_AT_PAID_DAILY?: string;
}

/** Defaults; each is overridable by the env var of the same name (a non-negative integer; 0 disables that cap). */
export const SPEND_LIMIT_DEFAULTS = {
  FREE_TRIAL_IP_DAILY_LIMIT: 6,
  FREE_TRIAL_IP_MONTHLY_LIMIT: 15,
  FREE_QUICK_PLATFORM_DAILY_LIMIT: 25,
  FREE_FORENSIC_PLATFORM_DAILY_LIMIT: 10,
  FREE_OCR_PLATFORM_DAILY_LIMIT: 30,
  PAID_PLATFORM_DAILY_LIMIT: 300,
  FREE_TRIAL_PAUSE_AT_PAID_DAILY: 200,
} as const;
export type SpendLimitName = keyof typeof SPEND_LIMIT_DEFAULTS;

/** A configured whole number (0 blocks everything), "off" to disable the cap, otherwise the default. */
export function spendLimit(env: FreeTrialEnv | undefined, name: SpendLimitName): number {
  const raw = (env as Record<string, string | undefined> | undefined)?.[name];
  if (raw?.trim().toLowerCase() === 'off') return Number.POSITIVE_INFINITY;
  const n = Number(raw);
  return raw !== undefined && raw !== '' && Number.isInteger(n) && n >= 0 ? n : SPEND_LIMIT_DEFAULTS[name];
}

const hex = async (s: string, n: number) =>
  [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s)))].map((b) => b.toString(16).padStart(2, '0')).join('').slice(0, n);

/** Lowercase; drop a +tag; for Gmail also drop dots and map googlemail.com. Null when not an email address. */
export function normalizeEmail(email: string | null | undefined): string | null {
  const e = (email ?? '').trim().toLowerCase();
  const at = e.lastIndexOf('@');
  if (at < 1 || at === e.length - 1 || /\s/.test(e)) return null;
  let local = e.slice(0, at).split('+')[0];
  let domain = e.slice(at + 1);
  if (domain === 'googlemail.com') domain = 'gmail.com';
  if (domain === 'gmail.com') local = local.replace(/\./g, '');
  return local ? `${local}@${domain}` : null;
}

export const freeTrialKey = async (kind: FreeTrialKind, normalizedEmail: string) => `${kind === 'quick' ? 'fq' : 'ff'}:${await hex(normalizedEmail, 40)}`;
export const freeOcrKey = async (normalizedEmail: string) => `fox:${await hex(normalizedEmail, 40)}`;
const utcDay = (now: Date) => now.toISOString().slice(0, 10).replace(/-/g, '');
export const ipDayKey = async (ip: string, now: Date) => `fip:${await hex(ip, 32)}:${utcDay(now)}`;
export const ipMonthKey = async (ip: string, now: Date) => `fim:${await hex(ip, 32)}:${utcDay(now).slice(0, 6)}`;
export const platformDailyKey = (lane: 'paid' | 'fq' | 'ff' | 'ocr', now: Date) => `plat:${lane}:${utcDay(now)}`;

/** The counter key a free reservation belongs to (`free_res_<key>_<32 hex>`); falls back to the account uid. */
export function freeCounterKey(reservationId: string | null | undefined, uid: string): string {
  const m = /^free_res_(.+)_[0-9a-f]{32}$/.exec(reservationId ?? '');
  return m ? m[1] : uid;
}

export const finalizeFreeReservation = (uid: string, requestId: string, reservationId: string | null | undefined, rpc: CreditRpc) =>
  finalizeFreeScan(freeCounterKey(reservationId, uid), requestId, rpc);

export const releaseFreeReservation = (uid: string, requestId: string, reservationId: string, rpc: CreditRpc) =>
  releaseFreeScan(freeCounterKey(reservationId, uid), requestId, reservationId, rpc);

/**
 * Takes one unit of a cap for this request, consumed at once: provider spend is not refunded by a failure, so a cap
 * unit is never returned. A repeat of the same request id is not counted twice. limit 0 disables the cap.
 */
export async function takeCapUnit(key: string, requestId: string, limit: number, rpc: CreditRpc): Promise<'ok' | 'limit' | 'unavailable'> {
  if (!Number.isFinite(limit)) return 'ok';
  if (limit <= 0) return 'limit';
  try {
    const r = await reserveFreeScan(key, requestId, rpc, limit);
    if (r.status === 'limit') return 'limit';
    if (r.status === 'joined' || r.status === 'consumed') return 'ok';
    if (r.status !== 'reserved') return 'unavailable';
    return (await finalizeFreeScan(key, requestId, rpc)).status === 'consumed' ? 'ok' : 'unavailable';
  } catch {
    return 'unavailable';
  }
}

/** Cloudflare Turnstile server-side check (free service). Fails closed on any error. */
export async function verifyTurnstile(secret: string, token: string | null, ip: string | null, fetcher: typeof fetch = fetch): Promise<boolean> {
  if (!token || token.length > 4096) return false;
  try {
    const form = new FormData();
    form.set('secret', secret);
    form.set('response', token);
    if (ip) form.set('remoteip', ip);
    const res = await fetcher('https://challenges.cloudflare.com/turnstile/v0/siteverify', { method: 'POST', body: form, signal: AbortSignal.timeout(5000) });
    if (!res.ok) return false;
    const body = (await res.json()) as { success?: unknown };
    return body?.success === true;
  } catch {
    return false;
  }
}

export const captchaRequired = (env: FreeTrialEnv) => Boolean(normalizeApiKey(env.TURNSTILE_SECRET_KEY)) || env.FREE_TRIAL_REQUIRE_CAPTCHA === 'true';

export interface FreeTrialBalance {
  emailVerified: boolean;
  legacy: boolean;
  quickLimit: number;
  quickUsed: number | null;
  forensicUsed: number | null;
}

/** What reserveFreeTrial would allow, read without reserving. Null counts when the ledger cannot be read. */
export async function readFreeTrialBalance(env: FreeTrialEnv, uid: string, email: string | null, emailVerified: boolean, fetcher: typeof fetch = fetch): Promise<FreeTrialBalance> {
  const normalized = emailVerified ? normalizeEmail(email) : null;
  if (!normalized) return { emailVerified: false, legacy: false, quickLimit: FREE_TRIAL_LIMITS.quick, quickUsed: FREE_TRIAL_LIMITS.quick, forensicUsed: FREE_TRIAL_LIMITS.forensic };
  const [legacyUsed, quick, forensic] = await Promise.all([
    readCounter(env, uid, fetcher), readCounter(env, await freeTrialKey('quick', normalized), fetcher), readCounter(env, await freeTrialKey('forensic', normalized), fetcher),
  ]);
  const legacy = (legacyUsed ?? 0) > 0;
  return {
    emailVerified: true,
    legacy,
    quickLimit: legacy ? LEGACY_FREE_QUICK_LIMIT : FREE_TRIAL_LIMITS.quick,
    quickUsed: legacyUsed === null || quick === null ? null : legacy ? Math.min(LEGACY_FREE_QUICK_LIMIT, legacyUsed) : Math.min(FREE_TRIAL_LIMITS.quick, quick),
    forensicUsed: forensic === null ? null : Math.min(FREE_TRIAL_LIMITS.forensic, forensic),
  };
}

export type FreeTrialReservation =
  | { status: 'reserved'; reservationId: string }
  | { status: 'joined' | 'consumed' | 'limit' | 'email_unverified' | 'captcha_failed' | 'ip_limit' | 'paused' | 'unavailable' };

export interface FreeTrialRequest {
  kind: FreeTrialKind;
  uid: string;
  email: string | null;
  emailVerified: boolean;
  ip: string | null;
  captchaToken: string | null;
  requestId: string;
  rpc: CreditRpc;
  env: FreeTrialEnv;
  fetcher?: typeof fetch;
  now?: Date;
}

/**
 * Reserves the account's one free analysis of this kind, or says why it cannot. Order matters: the entitlement is
 * reserved first so a retry of the same request joins its reservation (and needs no new CAPTCHA token); every later
 * refusal releases it. Every unexpected state fails closed.
 */
export async function reserveFreeTrial(req: FreeTrialRequest): Promise<FreeTrialReservation> {
  const { env, rpc, requestId } = req;
  const fetcher = req.fetcher ?? fetch;
  const now = req.now ?? new Date();
  const email = req.emailVerified ? normalizeEmail(req.email) : null;
  if (!email) return { status: 'email_unverified' };

  let key: string;
  let limit: number;
  if (req.kind === 'quick') {
    const legacyUsed = await readCounter(env, req.uid, fetcher);
    if (legacyUsed === null) return { status: 'unavailable' };
    const legacy = legacyUsed > 0;
    key = legacy ? req.uid : await freeTrialKey('quick', email);
    limit = legacy ? LEGACY_FREE_QUICK_LIMIT : FREE_TRIAL_LIMITS.quick;
  } else {
    key = await freeTrialKey('forensic', email);
    limit = FREE_TRIAL_LIMITS.forensic;
  }
  const r = await reserveFreeScan(key, requestId, rpc, limit).catch(() => ({ status: 'unavailable' } as { status: string; reservation_id?: string | null }));
  if (r.status === 'limit' || r.status === 'joined' || r.status === 'consumed') return { status: r.status };
  if (r.status !== 'reserved' || !r.reservation_id) return { status: 'unavailable' };
  const reservationId = r.reservation_id;
  const refuse = async (status: Exclude<FreeTrialReservation['status'], 'reserved'>): Promise<FreeTrialReservation> => {
    await releaseFreeScan(key, requestId, reservationId, rpc).catch(() => undefined);
    return { status } as FreeTrialReservation;
  };

  if (captchaRequired(env)) {
    const secret = normalizeApiKey(env.TURNSTILE_SECRET_KEY);
    if (!secret) return refuse('unavailable');
    if (!(await verifyTurnstile(secret, req.captchaToken, req.ip, fetcher))) return refuse('captcha_failed');
  }

  // Paid priority: free trials pause once paid volume today reaches the threshold.
  const pauseAt = spendLimit(env, 'FREE_TRIAL_PAUSE_AT_PAID_DAILY');
  if (Number.isFinite(pauseAt)) {
    const paidToday = await readCounter(env, platformDailyKey('paid', now), fetcher);
    if (paidToday === null) return refuse('unavailable');
    if (paidToday >= pauseAt) return refuse('paused');
  }
  const lane = req.kind === 'quick' ? 'fq' : 'ff';
  const platform = await takeCapUnit(platformDailyKey(lane, now), requestId, spendLimit(env, req.kind === 'quick' ? 'FREE_QUICK_PLATFORM_DAILY_LIMIT' : 'FREE_FORENSIC_PLATFORM_DAILY_LIMIT'), rpc);
  if (platform !== 'ok') return refuse(platform === 'limit' ? 'paused' : 'unavailable');
  if (req.ip) {
    for (const [capKey, name] of [[await ipDayKey(req.ip, now), 'FREE_TRIAL_IP_DAILY_LIMIT'], [await ipMonthKey(req.ip, now), 'FREE_TRIAL_IP_MONTHLY_LIMIT']] as const) {
      const unit = await takeCapUnit(capKey, requestId, spendLimit(env, name), rpc);
      if (unit !== 'ok') return refuse(unit === 'limit' ? 'ip_limit' : 'unavailable');
    }
  }
  return { status: 'reserved', reservationId };
}

/** analyses_used for one counter row, 0 when the row does not exist yet, null when it cannot be read. */
export async function readCounter(env: { STAGING_SUPABASE_URL?: string; STAGING_SUPABASE_SERVICE_ROLE_KEY?: string }, key: string, fetcher: typeof fetch = fetch): Promise<number | null> {
  if (!env.STAGING_SUPABASE_URL || !env.STAGING_SUPABASE_SERVICE_ROLE_KEY) return null;
  try {
    const url = new URL('/rest/v1/free_usage', env.STAGING_SUPABASE_URL);
    url.searchParams.set('uid', `eq.${key}`);
    url.searchParams.set('select', 'analyses_used');
    const res = await fetcher(url.toString(), {
      headers: { apikey: (normalizeApiKey(env.STAGING_SUPABASE_SERVICE_ROLE_KEY) ?? ''), Authorization: `Bearer ${(normalizeApiKey(env.STAGING_SUPABASE_SERVICE_ROLE_KEY) ?? '')}`, Accept: 'application/json' },
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) return null;
    const rows = (await res.json()) as Array<{ analyses_used?: number }>;
    if (!Array.isArray(rows)) return null;
    const used = rows[0]?.analyses_used ?? 0;
    return typeof used === 'number' && Number.isFinite(used) ? used : null;
  } catch {
    return null;
  }
}


export type FreeOcrOutcome = 'ok' | 'email_unverified' | 'no_entitlement' | 'ocr_limit' | 'paused' | 'unavailable';

/**
 * OCR for an account without a paid session is allowed only while it has a free analysis left, at most
 * FREE_OCR_LIFETIME_LIMIT times per verified email, and within the platform's daily free OCR cap.
 */
export async function authorizeFreeOcr(env: FreeTrialEnv, uid: string, email: string | null, emailVerified: boolean, rpc: CreditRpc, fetcher: typeof fetch = fetch, now = new Date()): Promise<FreeOcrOutcome> {
  const normalized = emailVerified ? normalizeEmail(email) : null;
  if (!normalized) return 'email_unverified';
  const b = await readFreeTrialBalance(env, uid, email, emailVerified, fetcher);
  if (b.quickUsed === null || b.forensicUsed === null) return 'unavailable';
  if (b.quickUsed >= b.quickLimit && b.forensicUsed >= FREE_TRIAL_LIMITS.forensic) return 'no_entitlement';
  const requestId = crypto.randomUUID();
  const lifetime = await takeCapUnit(await freeOcrKey(normalized), requestId, FREE_OCR_LIFETIME_LIMIT, rpc);
  if (lifetime !== 'ok') return lifetime === 'limit' ? 'ocr_limit' : 'unavailable';
  const platform = await takeCapUnit(platformDailyKey('ocr', now), requestId, spendLimit(env, 'FREE_OCR_PLATFORM_DAILY_LIMIT'), rpc);
  return platform === 'ok' ? 'ok' : platform === 'limit' ? 'paused' : 'unavailable';
}
