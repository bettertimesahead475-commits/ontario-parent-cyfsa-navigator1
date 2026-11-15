// functions/api/_auth-check.ts
var jwksUrl = "https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com";
var json = (code, status) => Response.json({ authenticated: false, code }, { status, headers: { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" } });
function decodeSegment(segment) {
  if (!/^[A-Za-z0-9_-]+$/.test(segment)) throw new Error("Malformed token");
  const base64 = segment.replace(/-/g, "+").replace(/_/g, "/");
  return JSON.parse(atob(base64.padEnd(Math.ceil(base64.length / 4) * 4, "=")));
}
function signatureBytes(segment) {
  const base64 = segment.replace(/-/g, "+").replace(/_/g, "/");
  return Uint8Array.from(atob(base64.padEnd(Math.ceil(base64.length / 4) * 4, "=")), (c) => c.charCodeAt(0));
}
async function verifyFirebaseRequest(request, env) {
  const response = await onRequestGet({ request, env });
  if (!response.ok) return { status: response.status === 503 ? "unavailable" : "denied" };
  const body = await response.json();
  return body.authenticated && typeof body.uid === "string" ? {
    status: "verified",
    uid: body.uid,
    email: typeof body.email === "string" ? body.email : null,
    emailVerified: Boolean(body.emailVerified)
  } : { status: "denied" };
}
var onRequestGet = async ({ request, env }) => {
  if (!env.FIREBASE_PROJECT_ID) return json("AUTH_NOT_CONFIGURED", 503);
  const match = /^Bearer ([A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)$/.exec(request.headers.get("Authorization") || "");
  if (!match) return json("AUTH_REQUIRED", 401);
  try {
    const [encodedHeader, encodedPayload, encodedSignature] = match[1].split(".");
    const header = decodeSegment(encodedHeader);
    const claims = decodeSegment(encodedPayload);
    const now = Math.floor(Date.now() / 1e3);
    if (header.alg !== "RS256" || typeof header.kid !== "string" || !header.kid || claims.aud !== env.FIREBASE_PROJECT_ID || claims.iss !== "https://securetoken.google.com/" + env.FIREBASE_PROJECT_ID || typeof claims.sub !== "string" || !claims.sub || claims.sub.length > 128 || typeof claims.exp !== "number" || claims.exp <= now || typeof claims.iat !== "number" || claims.iat > now || typeof claims.auth_time !== "number" || claims.auth_time > now) return json("INVALID_FIREBASE_TOKEN", 401);
    const keysResponse = await fetch(jwksUrl, { headers: { Accept: "application/json" } });
    if (!keysResponse.ok) return json("AUTH_KEY_SERVICE_UNAVAILABLE", 503);
    const keys = await keysResponse.json();
    const jwk = keys.keys?.find((key) => key.kid === header.kid && key.kty === "RSA" && key.use === "sig" && (!key.alg || key.alg === "RS256"));
    if (!jwk) return json("INVALID_FIREBASE_TOKEN", 401);
    const publicKey = await crypto.subtle.importKey("jwk", jwk, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["verify"]);
    const valid = await crypto.subtle.verify(
      "RSASSA-PKCS1-v1_5",
      publicKey,
      signatureBytes(encodedSignature),
      new TextEncoder().encode(encodedHeader + "." + encodedPayload)
    );
    if (!valid) return json("INVALID_FIREBASE_TOKEN", 401);
    return Response.json(
      {
        authenticated: true,
        uid: claims.sub,
        email: typeof claims.email === "string" ? claims.email : null,
        emailVerified: Boolean(claims.email_verified),
        provider: "firebase"
      },
      { headers: { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" } }
    );
  } catch {
    return json("INVALID_FIREBASE_TOKEN", 401);
  }
};

// functions/api/_paid-session-validation.ts
var TIERS = /* @__PURE__ */ new Set([
  "Basic",
  "AnalyzerBasic",
  "Premium",
  "AnalyzerPremium",
  "Pro",
  "Community5",
  "Community10",
  "Community25"
]);
function validTimestamp(value) {
  return value === null || typeof value === "string" && value.length > 0 && Number.isFinite(Date.parse(value));
}
function validatePaidSessionRow(row, verifiedFirebaseUid, requestedSessionId, now = Date.now()) {
  if (!row || !verifiedFirebaseUid || !requestedSessionId || row.id !== requestedSessionId || row.firebase_uid !== verifiedFirebaseUid || !TIERS.has(row.tier) || row.revoked_at !== null || !validTimestamp(row.issued_at) || !validTimestamp(row.expires_at) || row.issued_at !== null && Date.parse(row.issued_at) > now || row.expires_at !== null && Date.parse(row.expires_at) <= now) {
    return null;
  }
  return {
    sessionId: row.id,
    ownerUid: row.firebase_uid,
    tier: row.tier,
    issuedAt: row.issued_at,
    expiresAt: row.expires_at
  };
}

// functions/api/_supabase-paid-session.ts
async function readVerifiedPaidSession(env, firebaseUid, sessionId, fetcher = fetch) {
  if (!firebaseUid || !sessionId || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(sessionId)) return { status: "denied" };
  const readKey = env.STAGING_SUPABASE_READ_KEY || env.STAGING_SUPABASE_SERVICE_ROLE_KEY;
  if (!env.STAGING_SUPABASE_URL || !readKey) return { status: "unavailable" };
  let url;
  try {
    url = new URL("/rest/v1/navigator_paid_sessions", env.STAGING_SUPABASE_URL);
    if (url.protocol !== "https:") return { status: "unavailable" };
    url.searchParams.set("select", "id,firebase_uid,tier,issued_at,expires_at,revoked_at");
    url.searchParams.set("id", "eq." + sessionId);
    url.searchParams.set("firebase_uid", "eq." + firebaseUid);
    url.searchParams.set("limit", "1");
  } catch {
    return { status: "unavailable" };
  }
  try {
    const response = await fetcher(url.toString(), {
      method: "GET",
      headers: {
        apikey: readKey,
        Authorization: "Bearer " + readKey,
        Accept: "application/json"
      },
      redirect: "manual",
      signal: AbortSignal.timeout(5e3)
    });
    if (!response.ok) return { status: "unavailable" };
    const rows = await response.json();
    if (!Array.isArray(rows) || rows.length > 1) return { status: "unavailable" };
    if (rows.length === 0) return { status: "denied" };
    const row = rows[0];
    const session = validatePaidSessionRow(row, firebaseUid, sessionId);
    return session ? { status: "verified", session } : { status: "denied" };
  } catch {
    return { status: "unavailable" };
  }
}

// functions/api/_monthly-credit-scope.ts
function monthlyCreditScope(issuedAt, now) {
  const issued = new Date(issuedAt);
  if (!Number.isFinite(issued.getTime()) || !Number.isFinite(now.getTime()) || issued > now) {
    throw new Error("Invalid billing cycle");
  }
  const anchor = (k2) => {
    const y = issued.getUTCFullYear();
    const m = issued.getUTCMonth() + k2;
    const lastDay = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
    return Date.UTC(
      y,
      m,
      Math.min(issued.getUTCDate(), lastDay),
      issued.getUTCHours(),
      issued.getUTCMinutes(),
      issued.getUTCSeconds(),
      issued.getUTCMilliseconds()
    );
  };
  let k = Math.max(0, (now.getUTCFullYear() - issued.getUTCFullYear()) * 12 + now.getUTCMonth() - issued.getUTCMonth());
  while (k > 0 && anchor(k) > now.getTime()) k--;
  while (anchor(k + 1) <= now.getTime()) k++;
  return "period:" + new Date(anchor(k)).toISOString().slice(0, 10);
}

// functions/api/_paid-credit-reservation.ts
var LIMITS = {
  Basic: { limit: 3, monthly: false, forensic: false },
  AnalyzerBasic: { limit: 3, monthly: false, forensic: false },
  Premium: { limit: 5, monthly: false, forensic: true },
  AnalyzerPremium: { limit: 5, monthly: false, forensic: true },
  Pro: { limit: 5, monthly: true, forensic: true },
  Community5: { limit: 5, monthly: true, forensic: true },
  Community10: { limit: 5, monthly: true, forensic: true },
  Community25: { limit: 5, monthly: true, forensic: true }
};
async function reserveVerifiedPaidCredit(session, analysisType, requestId, rpc2, now = /* @__PURE__ */ new Date()) {
  const tier = LIMITS[session.tier];
  if (!tier || !session.sessionId || !session.ownerUid || !/^[0-9a-f-]{36}$/i.test(session.sessionId) || !/^[A-Za-z0-9_-]{8,128}$/.test(requestId) || analysisType !== "quick" && analysisType !== "forensic" || analysisType === "forensic" && !tier.forensic || !Number.isFinite(now.getTime()) || !Number.isFinite(Date.parse(session.issuedAt)) || Date.parse(session.issuedAt) > now.getTime() || session.expiresAt && (!Number.isFinite(Date.parse(session.expiresAt)) || Date.parse(session.expiresAt) <= now.getTime())) {
    return { status: "denied" };
  }
  let scope = tier.monthly ? "none" : "total";
  if (tier.monthly && analysisType === "forensic") {
    try {
      scope = monthlyCreditScope(session.issuedAt || "", now);
    } catch {
      return { status: "denied" };
    }
  }
  try {
    const result = await rpc2("paid_reserve_credit", {
      p_session: session.sessionId,
      p_request: requestId,
      p_scope: scope,
      p_granted: tier.limit,
      p_now: now.toISOString(),
      p_ttl: "15 minutes",
      p_claim_window: "60 seconds"
    });
    if (!["reserved", "joined", "consumed", "in_progress", "limit"].includes(result.status)) return { status: "unavailable" };
    if (result.status === "reserved" && !result.reservation_id) return { status: "unavailable" };
    return result;
  } catch {
    return { status: "unavailable" };
  }
}

// functions/api/_paid-credit-lifecycle.ts
async function finalizePaidReservation(sessionId, requestId, rpc2, now = /* @__PURE__ */ new Date()) {
  if (!sessionId || !requestId) return { status: "missing" };
  try {
    const result = await rpc2("paid_finalize_credit", {
      p_session: sessionId,
      p_request: requestId,
      p_now: now.toISOString()
    });
    if (result.status === "consumed" || result.status === "released" || result.status === "missing") {
      return { status: result.status };
    }
    return { status: "unavailable" };
  } catch {
    return { status: "unavailable" };
  }
}
async function releasePaidReservation(sessionId, requestId, reservationId, rpc2, now = /* @__PURE__ */ new Date()) {
  if (!reservationId || !sessionId || !requestId) return { status: "missing" };
  try {
    const result = await rpc2("paid_release_credit", {
      p_session: sessionId,
      p_request: requestId,
      p_reservation_id: reservationId,
      p_now: now.toISOString()
    });
    if (result.status === "released" || result.status === "consumed" || result.status === "missing") {
      return { status: result.status };
    }
    return { status: "unavailable" };
  } catch {
    return { status: "unavailable" };
  }
}

// functions/api/_staging-credit-rpc.ts
var StagingRpcError = class extends Error {
  constructor(params) {
    const summary = [
      `Staging credit RPC ${params.rpcName} failed (HTTP ${params.httpStatus})`,
      params.pgCode ? `[${params.pgCode}]` : null,
      params.pgMessage || null
    ].filter(Boolean).join(" ");
    super(summary);
    this.name = "StagingRpcError";
    this.rpcName = params.rpcName;
    this.httpStatus = params.httpStatus;
    this.pgCode = params.pgCode ?? null;
    this.pgMessage = params.pgMessage ?? null;
    this.pgDetails = params.pgDetails ?? null;
    this.pgHint = params.pgHint ?? null;
  }
};
function createStagingCreditRpc(env, fetcher = fetch) {
  return async (name, args) => {
    if (!["paid_reserve_credit", "paid_finalize_credit", "paid_release_credit", "free_reserve_scan", "free_finalize_scan", "free_release_scan"].includes(name)) {
      throw new Error("Unsupported credit RPC");
    }
    if (!env.STAGING_SUPABASE_URL || !env.STAGING_SUPABASE_SERVICE_ROLE_KEY) throw new Error("Staging RPC not configured");
    const url = new URL("/rest/v1/rpc/" + name, env.STAGING_SUPABASE_URL);
    if (url.protocol !== "https:") throw new Error("HTTPS required");
    let response;
    try {
      response = await fetcher(url.toString(), {
        method: "POST",
        headers: {
          apikey: env.STAGING_SUPABASE_SERVICE_ROLE_KEY,
          Authorization: "Bearer " + env.STAGING_SUPABASE_SERVICE_ROLE_KEY,
          "Content-Type": "application/json",
          Accept: "application/json"
        },
        body: JSON.stringify(args),
        redirect: "manual",
        signal: AbortSignal.timeout(5e3)
      });
    } catch (fetchErr) {
      console.error(JSON.stringify({
        tag: "[STAGING_RPC_NETWORK_ERROR]",
        rpc: name,
        error: fetchErr?.message || String(fetchErr)
      }));
      throw new StagingRpcError({
        rpcName: name,
        httpStatus: 503,
        pgCode: "NETWORK_TIMEOUT",
        pgMessage: fetchErr?.message || "RPC transport connection failed"
      });
    }
    if (!response.ok) {
      let pgCode = null;
      let pgMessage = null;
      let pgDetails = null;
      let pgHint = null;
      try {
        const errPayload = await response.json();
        if (errPayload && typeof errPayload === "object") {
          pgCode = typeof errPayload.code === "string" ? errPayload.code : null;
          pgMessage = typeof errPayload.message === "string" ? errPayload.message : null;
          pgDetails = typeof errPayload.details === "string" ? errPayload.details : null;
          pgHint = typeof errPayload.hint === "string" ? errPayload.hint : null;
        }
      } catch {
      }
      console.error(JSON.stringify({
        tag: "[STAGING_RPC_ERROR]",
        rpc: name,
        httpStatus: response.status,
        pgCode,
        pgMessage,
        pgDetails,
        pgHint
      }));
      throw new StagingRpcError({
        rpcName: name,
        httpStatus: response.status,
        pgCode,
        pgMessage,
        pgDetails,
        pgHint
      });
    }
    let value;
    try {
      value = await response.json();
    } catch (parseErr) {
      console.error(JSON.stringify({
        tag: "[STAGING_RPC_JSON_PARSE_ERROR]",
        rpc: name,
        error: parseErr?.message || String(parseErr)
      }));
      throw new StagingRpcError({
        rpcName: name,
        httpStatus: response.status,
        pgCode: "MALFORMED_JSON",
        pgMessage: "Response body could not be parsed as JSON"
      });
    }
    if (!value || typeof value !== "object" || Array.isArray(value) || typeof value.status !== "string") {
      console.error(JSON.stringify({
        tag: "[STAGING_RPC_INVALID_PAYLOAD]",
        rpc: name,
        httpStatus: response.status,
        bodyType: Array.isArray(value) ? "array" : typeof value
      }));
      throw new StagingRpcError({
        rpcName: name,
        httpStatus: response.status,
        pgCode: "INVALID_RPC_RESPONSE",
        pgMessage: "Expected JSON object with status property"
      });
    }
    return value;
  };
}

// functions/api/_free-credit-reservation.ts
var FREE_SCAN_LIMIT = 3;
async function reserveFreeScan(verifiedFirebaseUid, requestId, rpc2) {
  if (!verifiedFirebaseUid || !/^[A-Za-z0-9_.:|@-]{1,128}$/.test(verifiedFirebaseUid) || !requestId || !/^[A-Za-z0-9_-]{8,128}$/.test(requestId)) {
    console.error(JSON.stringify({
      tag: "[FREE_RESERVE_DENIED]",
      reason: "invalid_format",
      uidValid: Boolean(verifiedFirebaseUid && /^[A-Za-z0-9_.:|@-]{1,128}$/.test(verifiedFirebaseUid)),
      reqValid: Boolean(requestId && /^[A-Za-z0-9_-]{8,128}$/.test(requestId))
    }));
    return { status: "denied", httpStatus: 400, pgCode: "INVALID_IDENTIFIER_FORMAT" };
  }
  try {
    const result = await rpc2("free_reserve_scan", {
      p_uid: verifiedFirebaseUid,
      p_request: requestId,
      p_limit: FREE_SCAN_LIMIT,
      p_now: (/* @__PURE__ */ new Date()).toISOString(),
      p_ttl: "15 minutes"
    });
    if (!["reserved", "joined", "consumed", "limit"].includes(result.status)) {
      console.error(JSON.stringify({
        tag: "[FREE_RESERVE_UNEXPECTED_STATUS]",
        status: result.status
      }));
      return { status: "unavailable", pgCode: "UNEXPECTED_STATUS", pgMessage: `Unknown status: ${result.status}` };
    }
    if (result.status === "reserved" && (typeof result.reservation_id !== "string" || !result.reservation_id)) {
      console.error(JSON.stringify({
        tag: "[FREE_RESERVE_MISSING_MARKER]",
        result
      }));
      return { status: "unavailable", pgCode: "MISSING_RESERVATION_ID", pgMessage: "Reservation marker missing" };
    }
    return result;
  } catch (err) {
    const httpStatus = err instanceof StagingRpcError ? err.httpStatus : typeof err?.httpStatus === "number" ? err.httpStatus : 503;
    const pgCode = err instanceof StagingRpcError ? err.pgCode : typeof err?.pgCode === "string" ? err.pgCode : "UNKNOWN_RPC_ERROR";
    const pgMessage = err instanceof StagingRpcError ? err.pgMessage : err?.pgMessage || err?.message || String(err);
    const pgDetails = err?.pgDetails || null;
    const pgHint = err?.pgHint || null;
    console.error(JSON.stringify({
      tag: "[FREE_RESERVE_SCAN_RPC_ERROR]",
      httpStatus,
      pgCode,
      pgMessage,
      pgDetails,
      pgHint
    }));
    return {
      status: "unavailable",
      httpStatus,
      pgCode,
      pgMessage,
      pgDetails,
      pgHint
    };
  }
}

// functions/api/_free-credit-lifecycle.ts
async function finalizeFreeScan(uid, requestId, rpc2) {
  if (!uid || !/^[A-Za-z0-9_.:|@-]{1,128}$/.test(uid) || !requestId || !/^[A-Za-z0-9_-]{8,128}$/.test(requestId)) {
    return { status: "denied" };
  }
  try {
    const result = await rpc2("free_finalize_scan", {
      p_uid: uid,
      p_request: requestId,
      p_now: (/* @__PURE__ */ new Date()).toISOString()
    });
    return { status: ["consumed", "released", "missing"].includes(result.status) ? result.status : "unavailable" };
  } catch (err) {
    console.error(JSON.stringify({
      tag: "[FREE_FINALIZE_SCAN_FAILED]",
      error: err?.message || String(err),
      pgCode: err?.pgCode || null
    }));
    return { status: "unavailable", pgCode: err?.pgCode || null };
  }
}
async function releaseFreeScan(uid, requestId, reservationId, rpc2) {
  if (!uid || !/^[A-Za-z0-9_.:|@-]{1,128}$/.test(uid) || !reservationId || !requestId || !/^[A-Za-z0-9_-]{8,128}$/.test(requestId)) {
    return { status: "denied" };
  }
  try {
    const result = await rpc2("free_release_scan", {
      p_uid: uid,
      p_request: requestId,
      p_reservation_id: reservationId,
      p_now: (/* @__PURE__ */ new Date()).toISOString()
    });
    return { status: ["released", "noop"].includes(result.status) ? result.status : "unavailable" };
  } catch (err) {
    console.error(JSON.stringify({
      tag: "[FREE_RELEASE_SCAN_FAILED]",
      error: err?.message || String(err),
      pgCode: err?.pgCode || null
    }));
    return { status: "unavailable", pgCode: err?.pgCode || null };
  }
}

// functions/api/_analysis-jobs.ts
var ANALYSIS_JOBS_BUCKET = "analysis_jobs";
function jobObjectUrl(supabaseUrl, jobId, mode) {
  const path = mode === "read" ? `/storage/v1/object/authenticated/${ANALYSIS_JOBS_BUCKET}/${jobId}.json` : `/storage/v1/object/${ANALYSIS_JOBS_BUCKET}/${jobId}.json`;
  return new URL(path, supabaseUrl).toString();
}
async function saveJobState(env, job, fetcher = fetch) {
  if (!env.STAGING_SUPABASE_URL || !env.STAGING_SUPABASE_SERVICE_ROLE_KEY) return false;
  const key = env.STAGING_SUPABASE_SERVICE_ROLE_KEY;
  const body = { jobId: job.jobId, uid: job.uid, status: job.status, updatedAt: Date.now() };
  if (job.status === "running") Object.assign(body, { currentStage: "running", percent: job.percent, message: job.message });
  if (job.status === "completed") Object.assign(body, { currentStage: "complete", percent: 100, report: job.report });
  if (job.status === "failed") Object.assign(body, { currentStage: "failed", percent: 100, error: job.error });
  try {
    const res = await fetcher(jobObjectUrl(env.STAGING_SUPABASE_URL, job.jobId, "write"), {
      method: "POST",
      headers: { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json", "x-upsert": "true" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(5e3)
    });
    if (!res.ok) console.error(JSON.stringify({ tag: "[ANALYSIS_JOB_SAVE_FAILED]", jobId: job.jobId, state: job.status, status: res.status }));
    return res.ok;
  } catch (err) {
    console.error(JSON.stringify({ tag: "[ANALYSIS_JOB_SAVE_FAILED]", jobId: job.jobId, state: job.status, status: err?.name ?? "error" }));
    return false;
  }
}
async function saveCompletedJob(env, job, fetcher = fetch) {
  return saveJobState(env, { ...job, status: "completed", report: job.report }, fetcher);
}
var RUNNING_JOB_STALE_MS = 5 * 6e4;

// functions/api/_durable-analysis-jobs.ts
var DurableJobStorageError = class extends Error {
  constructor(message, retryable, status) {
    super(message);
    this.retryable = retryable;
    this.status = status;
    this.name = "DurableJobStorageError";
  }
};
function serviceConfig(env) {
  if (!env.STAGING_SUPABASE_URL || !env.STAGING_SUPABASE_SERVICE_ROLE_KEY) {
    throw new DurableJobStorageError("Durable job database is not configured.", false);
  }
  const base = env.STAGING_SUPABASE_URL.replace(/\/$/, "");
  const key = env.STAGING_SUPABASE_SERVICE_ROLE_KEY;
  return { base, key };
}
async function rpc(env, name, args, fetcher = fetch) {
  const { base, key } = serviceConfig(env);
  let response;
  const start = Date.now();
  try {
    response = await fetcher(`${base}/rest/v1/rpc/${name}`, {
      method: "POST",
      headers: { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify(args),
      redirect: "manual",
      signal: AbortSignal.timeout(8e3)
    });
  } catch (error) {
    const diagnostic = error && typeof error === "object" ? error : {};
    console.error("[DURABLE_RPC_TRANSPORT_FAILURE]", JSON.stringify({
      rpcName: name,
      elapsedMs: Date.now() - start,
      exceptionClass: diagnostic.name || "unknown",
      causeClass: diagnostic.cause?.name || null,
      causeCode: typeof diagnostic.cause?.code === "string" ? diagnostic.cause.code.slice(0, 50) : null
    }));
    throw new DurableJobStorageError("Durable job database request failed.", true);
  }
  if (!response.ok) {
    let pgCode = null;
    let errorClass = "UNKNOWN";
    try {
      const error = await response.json();
      if (error && typeof error === "object") {
        const data = error;
        if (typeof data.code === "string" && /^[A-Za-z0-9]{1,20}$/.test(data.code)) pgCode = data.code;
        const message = [data.message, data.error].filter((x) => typeof x === "string").join(" ");
        if (/invalid api key/i.test(message)) errorClass = "INVALID_API_KEY";
        else if (/jwt|bearer token/i.test(message)) errorClass = "JWT_INVALID";
        else if (/unauthorized|permission denied/i.test(message)) errorClass = "AUTHORIZATION";
        else if (pgCode) errorClass = "POSTGRES_ERROR";
        else errorClass = "GATEWAY_ERROR";
      }
    } catch {
      errorClass = "NON_JSON_RESPONSE";
    }
    let serviceRoleClaim = null;
    let projectClaimMatches = null;
    let tokenExpired = null;
    try {
      const segment = key.split(".")[1];
      const payload = JSON.parse(atob(segment.replace(/-/g, "+").replace(/_/g, "/")));
      if (typeof payload.role === "string") serviceRoleClaim = payload.role === "service_role";
      if (typeof payload.ref === "string") {
        projectClaimMatches = payload.ref === new URL(base).hostname.split(".")[0];
      }
      if (typeof payload.exp === "number") tokenExpired = payload.exp <= Date.now() / 1e3;
    } catch {
    }
    let responseHostMatches = null;
    try {
      if (response.url) responseHostMatches = new URL(response.url).hostname === new URL(base).hostname;
    } catch {
    }
    console.error("[DURABLE_RPC_HTTP_REJECTED]", JSON.stringify({
      rpcName: name,
      httpStatus: response.status,
      pgCode,
      errorClass,
      contentType: (response.headers.get("content-type") || "").split(";")[0].slice(0, 48),
      credentialFormat: key.startsWith("eyJ") ? "legacy_jwt" : key.startsWith("sb_secret_") ? "secret_api_key" : "other",
      responseType: response.type,
      statusText: response.statusText.slice(0, 48),
      headerNames: ["server", "cf-ray", "content-length", "x-kong-response-latency", "sb-gateway-version"].filter((header) => response.headers.has(header)),
      hasResponseUrl: Boolean(response.url),
      responseHostMatches,
      serviceRoleClaim,
      projectClaimMatches,
      tokenExpired
    }));
    throw new DurableJobStorageError("Durable job database rejected the request.", response.status >= 500 || response.status === 429, response.status);
  }
  return await response.json();
}
function storageUrl(env, key, read = false) {
  const { base } = serviceConfig(env);
  const encodedKey = key.split("/").map(encodeURIComponent).join("/");
  return `${base}/storage/v1/object/${read ? "authenticated/" : ""}${ANALYSIS_JOBS_BUCKET}/${encodedKey}`;
}
function storageHeaders(env, contentType = "application/json") {
  const { key } = serviceConfig(env);
  return { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": contentType };
}
async function createDurableJob(env, job, fetcher = fetch) {
  return rpc(env, "analyzer_create_job", {
    p_job_id: job.job_id,
    p_owner_uid: job.owner_uid,
    p_mode: job.mode,
    p_input_key: job.input_key,
    p_session_id: job.session_id,
    p_reservation_id: job.reservation_id,
    p_owner_bypass: job.owner_bypass
  }, fetcher);
}
async function saveDurableInput(env, key, input, fetcher = fetch) {
  serviceConfig(env);
  let response;
  try {
    response = await fetcher(storageUrl(env, key), {
      method: "POST",
      headers: { ...storageHeaders(env), "x-upsert": "false" },
      body: JSON.stringify(input),
      redirect: "manual",
      signal: AbortSignal.timeout(1e4)
    });
  } catch {
    throw new DurableJobStorageError("Document input could not be saved securely.", true);
  }
  if (!response.ok) throw new DurableJobStorageError("Document input could not be saved securely.", response.status >= 500 || response.status === 429, response.status);
}
async function loadDurableInput(env, key, fetcher = fetch) {
  let response;
  try {
    response = await fetcher(storageUrl(env, key, true), {
      headers: storageHeaders(env),
      redirect: "manual",
      signal: AbortSignal.timeout(1e4)
    });
  } catch {
    throw new DurableJobStorageError("Stored document input could not be loaded.", true);
  }
  if (!response.ok) throw new DurableJobStorageError("Stored document input could not be loaded.", response.status >= 500 || response.status === 429, response.status);
  const value = await response.json();
  if (typeof value.documentText !== "string" || !value.documentText.trim()) throw new DurableJobStorageError("Stored document input is invalid.", false, 422);
  return { documentText: value.documentText, ...typeof value.fileName === "string" ? { fileName: value.fileName } : {} };
}
async function readDurableJob(env, jobId, fetcher = fetch) {
  return await rpc(env, "analyzer_get_job", { p_job_id: jobId }, fetcher);
}
async function claimDurableJob(env, jobId, workerToken, leaseSeconds = 240, fetcher = fetch) {
  return await rpc(env, "analyzer_claim_job", {
    p_job_id: jobId,
    p_worker_token: workerToken,
    p_lease_seconds: leaseSeconds
  }, fetcher);
}
async function updateDurableJob(env, input, fetcher = fetch) {
  return rpc(env, "analyzer_update_job", {
    p_job_id: input.jobId,
    p_worker_token: input.workerToken ?? null,
    p_status: input.status,
    p_error_code: input.errorCode ?? null,
    p_error_message: input.errorMessage ?? null,
    p_retryable: input.retryable ?? null,
    p_progress: input.progress ?? null,
    p_stage: input.stage ?? null
  }, fetcher);
}
async function failDeadLetterJob(env, jobId, fetcher = fetch) {
  return await rpc(env, "analyzer_fail_dead_letter", {
    p_job_id: jobId,
    p_error_code: "ANALYZER_RETRIES_EXHAUSTED",
    p_error_message: "The analysis could not be completed after multiple attempts. Your document remains available; you can retry it."
  }, fetcher);
}
async function completeRecoveredJob(env, jobId, fetcher = fetch) {
  return await rpc(env, "analyzer_complete_recovered_job", { p_job_id: jobId }, fetcher);
}
async function requeueFromDeadLetter(env, jobId, fetcher = fetch) {
  return await rpc(env, "analyzer_requeue_from_dlq", { p_job_id: jobId }, fetcher);
}
async function loadPersistedReport(env, jobId, fetcher = fetch) {
  let response;
  try {
    response = await fetcher(storageUrl(env, `${jobId}.json`, true), { headers: storageHeaders(env), redirect: "manual", signal: AbortSignal.timeout(8e3) });
  } catch {
    throw new DurableJobStorageError("Saved analysis report could not be loaded.", true);
  }
  if (response.status === 404) return null;
  if (!response.ok) throw new DurableJobStorageError("Saved analysis report could not be loaded.", response.status >= 500 || response.status === 429, response.status);
  const stored = await response.json();
  return stored.status === "completed" && stored.report && typeof stored.report === "object" ? stored.report : null;
}

// functions/api/_analyzer-queue-contract.ts
var JOB_ID = /^[A-Za-z0-9_-]{8,128}$/;
function createAnalyzerQueueMessage(jobId) {
  if (!JOB_ID.test(jobId)) {
    throw new Error("Invalid analyzer job identifier");
  }
  return { version: 1, jobId };
}
function parseAnalyzerQueueMessage(value) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Invalid analyzer queue payload");
  }
  const record = value;
  if (Object.keys(record).length !== 2 || record.version !== 1 || typeof record.jobId !== "string") {
    throw new Error("Invalid analyzer queue payload");
  }
  return createAnalyzerQueueMessage(record.jobId);
}

// shared/providerDiagnostics.ts
var codes = /* @__PURE__ */ new Set(["INVALID_ARGUMENT", "FAILED_PRECONDITION", "PERMISSION_DENIED", "UNAUTHENTICATED", "NOT_FOUND", "RESOURCE_EXHAUSTED", "UNAVAILABLE", "INTERNAL", "invalid_request_error", "authentication_error", "permission_error", "not_found_error", "rate_limit_error", "overloaded_error", "api_error", "billing_error"]);
var reasons = /* @__PURE__ */ new Set(["API_KEY_INVALID", "API_KEY_EXPIRED", "API_KEY_SERVICE_BLOCKED", "SERVICE_DISABLED", "BILLING_DISABLED", "CONSUMER_INVALID", "API_KEY_HTTP_REFERRER_BLOCKED", "API_KEY_IP_ADDRESS_BLOCKED", "API_KEY_ANDROID_APP_BLOCKED", "API_KEY_IOS_APP_BLOCKED", "RATE_LIMIT_EXCEEDED", "QUOTA_EXCEEDED"]);
function providerDiagnostic(httpStatus, body) {
  let error;
  try {
    error = JSON.parse(body)?.error;
  } catch {
  }
  const rawCode = error?.status || error?.type;
  const rawReason = Array.isArray(error?.details) ? error.details.map((d) => d?.reason).find((r) => reasons.has(r)) : void 0;
  const message = typeof error?.message === "string" ? error.message : body;
  const category = /plain HTTP request.*HTTPS port|HTTP.*request.*HTTPS.*port/i.test(message) ? "HTTP_TO_HTTPS_PORT" : /request.*(blocked|denied).*proxy|proxy.*(blocked|denied)|egress.*(blocked|denied)/i.test(message) ? "EGRESS_POLICY_BLOCKED" : /invalid.*host|host.*mismatch|invalid.*(header|URL)|header.*too (large|long)/i.test(message) ? "HTTP_REQUEST_REJECTED" : /credit balance.*too low|insufficient.*credit|out of credits/i.test(message) ? "INSUFFICIENT_PROVIDER_CREDIT" : /key.*(leaked|reported)/i.test(message) ? "KEY_REPORTED_LEAKED" : /API key.*(invalid|not valid|not found|expired)|API_KEY_INVALID|API_KEY_EXPIRED/i.test(message + " " + rawReason) ? "KEY_INVALID" : /SERVICE_DISABLED|API has not been used|service.*disabled/i.test(message + " " + rawReason) ? "SERVICE_DISABLED" : /API_KEY_.*BLOCKED|key.*(restricted|blocked)/i.test(message + " " + rawReason) ? "KEY_RESTRICTED" : /billing|paid plan|payment/i.test(message + " " + rawReason) ? "BILLING_REQUIRED" : /location.*not supported|country.*not.*supported/i.test(message) ? "LOCATION_UNSUPPORTED" : /model.*(not found|not supported|unavailable|invalid|not exist)|not supported for generateContent/i.test(message) ? "MODEL_UNAVAILABLE" : /thinking|budget_tokens|output_config/i.test(message) ? "THINKING_CONFIGURATION" : /max_tokens|maxOutputTokens|token.*limit/i.test(message) ? "TOKEN_LIMIT" : /unknown name|unknown field|unrecognized.*(field|parameter)|pageSize/i.test(message) ? "REQUEST_FIELD_UNSUPPORTED" : !error ? "NON_JSON_REJECTION" : "UNCLASSIFIED";
  const title = /<title[^>]*>([^<]{1,100})<\/title>/i.exec(body)?.[1]?.trim();
  const safeTitle = title && ["400 Bad Request", "Bad Request", "Access Denied", "Invalid URL", "403 Forbidden", "Error"].includes(title) ? title : null;
  return { responseLength: body.length, bodyFormat: /^\s*</.test(body) ? "html" : /^\s*[\[{]/.test(body) ? "json" : "text", knownTitle: safeTitle, httpStatus, providerCode: codes.has(rawCode) ? rawCode : null, reason: rawReason || null, category };
}

// api/services/analyzerErrors.ts
var AnalyzerError = class extends Error {
  constructor(code, statusCode, userMessage, retryable = false) {
    super(userMessage);
    this.name = "AnalyzerError";
    this.code = code;
    this.statusCode = statusCode;
    this.userMessage = userMessage;
    this.retryable = retryable;
  }
};
var DIAGNOSTIC_SECRET_PATTERNS = [
  [/\b(?:sk|pk|rk)_(?:live|test)_[A-Za-z0-9]{8,}/g, "[redacted]"],
  [/\bAKIA[0-9A-Z]{16}\b/g, "[redacted]"],
  [/\bgh[pousr]_[A-Za-z0-9]{20,}/g, "[redacted]"],
  [/\bxox[abprs]-[A-Za-z0-9-]{10,}/g, "[redacted]"],
  [/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g, "[redacted]"],
  [/\bsk-[A-Za-z0-9_-]{8,}/g, "[redacted]"],
  [/AIza[0-9A-Za-z_-]{20,}/g, "[redacted]"],
  [/\bBearer\s+\S+/gi, "Bearer [redacted]"],
  [/\bBasic\s+[A-Za-z0-9+/=]+/gi, "Basic [redacted]"],
  // Quoted JSON values, including values with spaces: "apiKey": "abc def".
  [/([A-Za-z_]*(?:api[_-]?key|apikey|token|secret|password|passwd|authorization|key)["']?\s*[:=]\s*)"[^"]*"/gi, '$1"[redacted]"'],
  // Unquoted labelled values: token=xyz, password: hunter2, ?key=abc.
  [/([A-Za-z_]*(?:api[_-]?key|apikey|token|secret|password|passwd|authorization|key)["']?\s*[:=]\s*)[^\s"',;&]+/gi, "$1[redacted]"],
  [/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, "[redacted]"]
];
function redactDiagnostic(input, maxLength = 240) {
  let text = String(input ?? "");
  for (const [pattern, replacement] of DIAGNOSTIC_SECRET_PATTERNS) text = text.replace(pattern, replacement);
  return text.length > maxLength ? `${text.slice(0, maxLength)}...` : text;
}
function logAnalyzerDiagnostic(stage, err) {
  const name = err?.name;
  console.warn(`[analyzer] ${stage} failed (${redactDiagnostic(name ?? "error", 40)}): ${redactDiagnostic(err?.message ?? err)}`);
}

// api/services/analyzerModels.ts
var DEFAULT_QUICK_MODEL = "claude-sonnet-5";
var DEFAULT_FORENSIC_MODEL = "claude-opus-5";
var ANALYZER_MODELS = {
  QUICK: (typeof process === "undefined" ? void 0 : process.env.ANTHROPIC_QUICK_MODEL) || DEFAULT_QUICK_MODEL,
  FORENSIC: (typeof process === "undefined" ? void 0 : process.env.ANTHROPIC_FORENSIC_MODEL) || DEFAULT_FORENSIC_MODEL
};
var CLAUDE_MODELS = /* @__PURE__ */ new Set([
  "claude-sonnet-5",
  "claude-sonnet-5-5",
  "claude-opus-5",
  "claude-opus-5-5",
  "claude-haiku-5-5",
  "claude-sonnet-4-6",
  "claude-opus-4-6",
  "claude-sonnet-4-5-20250929",
  "claude-opus-4-5-20251101",
  "claude-haiku-4-5-20251001",
  "claude-3-7-sonnet-20250219",
  "claude-3-7-sonnet-latest",
  "claude-3-5-sonnet-20241022",
  "claude-3-5-sonnet-latest",
  "claude-3-opus-20240229",
  "claude-3-opus-latest"
]);
function requireApprovedModel(model) {
  if (!CLAUDE_MODELS.has(model)) {
    throw new AnalyzerError(
      "AI_PROVIDER_CONFIGURATION_ERROR",
      500,
      "The configured analyzer model is not on the approved list, so the analysis was stopped rather than run on a different model. Nothing was charged.",
      false
    );
  }
  return model;
}
function resolveAnthropicWireModel(model) {
  return model || DEFAULT_QUICK_MODEL;
}
var MODELS_REJECTING_DISABLED_THINKING = /* @__PURE__ */ new Set([
  "claude-fable-5",
  "claude-fable-5-1",
  "claude-opus-5-5",
  "claude-sonnet-5-5",
  "claude-haiku-5-5"
]);
var CURRENT_GENERATION_MODEL = /^claude-(fable|opus|sonnet|haiku)-(5|4-[6-9])/;
function buildThinkingRequestFields(model, enableThinking, thinkingBudget) {
  if (enableThinking) {
    if (MODELS_REJECTING_DISABLED_THINKING.has(model)) {
      return {};
    }
    if (CURRENT_GENERATION_MODEL.test(model)) {
      return { thinking: { type: "adaptive" } };
    }
    return { thinking: { type: "enabled", budget_tokens: thinkingBudget || 2048 } };
  }
  if (MODELS_REJECTING_DISABLED_THINKING.has(model)) {
    return { output_config: { effort: "low" } };
  }
  if (model.startsWith("claude-3-") || !CURRENT_GENERATION_MODEL.test(model)) {
    return {};
  }
  return { thinking: { type: "disabled" } };
}

// functions/api/_analyzer-model-adapter.ts
function createCloudflareGenerateFn(env, fetcher = fetch) {
  return async (options, model) => {
    const apiKey = env.ANTHROPIC_API_KEY;
    if (!apiKey || !apiKey.trim()) {
      throw new AnalyzerError(
        "AI_PROVIDER_CONFIGURATION_ERROR",
        500,
        "ANTHROPIC_API_KEY is not configured on Cloudflare runtime.",
        false
      );
    }
    const approvedModel = requireApprovedModel(model);
    const wireModel = resolveAnthropicWireModel(approvedModel);
    const baseUrl = env.ANTHROPIC_API_URL || "https://api.anthropic.com/v1/messages";
    const maxRetries = options.retries ?? 0;
    let attempt = 0;
    let lastError = null;
    const overallStart = Date.now();
    const overallBudget = options.timeoutMs > 0 ? options.timeoutMs : 6e4;
    while (attempt <= maxRetries) {
      attempt++;
      const timeSpent = Date.now() - overallStart;
      const remainingTime = overallBudget - timeSpent;
      if (attempt > 1 && remainingTime <= 0) {
        break;
      }
      const timeoutMs = Math.max(1e3, Math.min(overallBudget, remainingTime));
      const attemptStart = Date.now();
      let activeTimer;
      try {
        const controller = new AbortController();
        activeTimer = setTimeout(() => controller.abort(), timeoutMs);
        const deadline = new Promise((_, reject) => {
          controller.signal.addEventListener(
            "abort",
            () => reject(new Error(`provider deadline of ${timeoutMs} ms exceeded`)),
            { once: true }
          );
        });
        deadline.catch(() => void 0);
        const bounded = (p) => Promise.race([p, deadline]);
        const thinkingFields = buildThinkingRequestFields(wireModel, Boolean(options.enableThinking), options.thinkingBudget);
        const requestBody = {
          model: wireModel,
          max_tokens: options.max_tokens || 8192,
          stream: true,
          system: options.system,
          messages: options.messages.map((m) => ({
            role: m.role,
            content: m.content.map((c) => typeof c === "string" ? c : c.text).join("\n")
          })),
          ...thinkingFields
        };
        const startTime = Date.now();
        let response;
        let rawBody = "";
        {
          response = await bounded(fetcher(baseUrl, {
            method: "POST",
            headers: {
              "x-api-key": apiKey,
              "anthropic-version": "2023-06-01",
              "content-type": "application/json",
              accept: "application/json, text/event-stream"
            },
            body: JSON.stringify(requestBody),
            signal: controller.signal
          }));
          const contentType2 = response.headers.get("content-type") || "";
          if (!response.ok || !contentType2.includes("text/event-stream")) {
            rawBody = await bounded(response.text()).catch((e) => {
              if (response.ok) throw e;
              return "Could not read error body";
            });
          }
        }
        if (!response.ok) {
          const status = response.status;
          const errorText = rawBody;
          const diagnostic = providerDiagnostic(status, errorText);
          console.warn(JSON.stringify({ tag: "[ANTHROPIC_REJECTED]", model: wireModel, ...diagnostic }));
          const rejected = (error) => {
            error.providerDiagnostic = diagnostic;
            throw error;
          };
          if (status === 429) {
            rejected(new AnalyzerError("AI_RATE_LIMITED", 429, "The AI service is busy right now. Please wait a moment and try again. Nothing was charged.", true));
          }
          if (status >= 500 && status < 600) {
            rejected(new AnalyzerError("AI_PROVIDER_TEMPORARILY_UNAVAILABLE", 503, "The AI analysis engine is temporarily unavailable. Please try again shortly. Nothing was charged.", true));
          }
          if (status === 400 && !errorText.trim() && apiKey.trim().length < 24) {
            rejected(new AnalyzerError("AI_PROVIDER_CONFIGURATION_ERROR", 503, "The analysis provider credentials are not configured correctly. Nothing was charged.", false));
          }
          if (status === 400) {
            rejected(new AnalyzerError("AI_REQUEST_REJECTED", 400, "The AI service could not process this request. Nothing was charged. Please try again or contact support.", false));
          }
          rejected(new AnalyzerError("AI_PROVIDER_CONFIGURATION_ERROR", 503, "The analysis service is not available right now because of a configuration problem on our side. Nothing was charged.", false));
        }
        let text = "";
        let stopReason;
        let inputTokens = 0;
        let outputTokens = 0;
        const contentType = response.headers.get("content-type") || "";
        if (contentType.includes("text/event-stream") && response.body) {
          const reader = response.body.getReader();
          const decoder = new TextDecoder();
          let streamBuf = "";
          let receivedMessageStop = false;
          try {
            while (!receivedMessageStop) {
              const { done, value } = await bounded(reader.read());
              if (done) break;
              streamBuf += decoder.decode(value, { stream: true });
              const events = streamBuf.split(/\r?\n\r?\n/);
              streamBuf = events.pop() || "";
              const MAX_SSE_EVENT_CHARS = 1048576;
              if (streamBuf.length > MAX_SSE_EVENT_CHARS) {
                throw new AnalyzerError("AI_RESPONSE_INVALID", 422, "The AI provider sent an oversized streaming event. Nothing was charged.", true);
              }
              for (const rawEvent of events) {
                if (rawEvent.length > MAX_SSE_EVENT_CHARS) {
                  throw new AnalyzerError("AI_RESPONSE_INVALID", 422, "The AI provider sent an oversized streaming event. Nothing was charged.", true);
                }
                const lines = rawEvent.split(/\r?\n/);
                for (const line of lines) {
                  const trimmed = line.trim();
                  if (trimmed.startsWith("data:")) {
                    const dataStr = trimmed.slice(5).trim();
                    if (!dataStr || dataStr === "[DONE]") continue;
                    try {
                      const evt = JSON.parse(dataStr);
                      if (evt.type === "content_block_delta" && evt.delta?.type === "text_delta") {
                        text += evt.delta.text || "";
                      } else if (evt.type === "message_start" && evt.message?.usage) {
                        inputTokens = evt.message.usage.input_tokens || 0;
                      } else if (evt.type === "error") {
                        throw new AnalyzerError("AI_PROVIDER_TEMPORARILY_UNAVAILABLE", 503, "The AI provider interrupted the analysis. Nothing was charged.", true);
                      } else if (evt.type === "message_stop") {
                        receivedMessageStop = true;
                      } else if (evt.type === "message_delta") {
                        if (evt.delta?.stop_reason) stopReason = evt.delta.stop_reason;
                        if (evt.usage?.output_tokens) outputTokens = evt.usage.output_tokens;
                      }
                    } catch (parseError) {
                      if (parseError instanceof AnalyzerError) throw parseError;
                      throw new AnalyzerError("AI_RESPONSE_INVALID", 422, "The AI provider returned an invalid streaming event. Nothing was charged.", true);
                    }
                  }
                }
              }
            }
            if (!receivedMessageStop || !text.trim() || stopReason !== "end_turn" && stopReason !== "stop_sequence") {
              throw new AnalyzerError("AI_RESPONSE_INVALID", 422, "The AI provider stream ended before the analysis completed. Nothing was charged.", true);
            }
          } finally {
            void reader.cancel().catch(() => void 0);
            reader.releaseLock();
          }
        } else {
          const data = JSON.parse(rawBody);
          text = data.content?.filter((c) => c.type === "text").map((c) => c.text).join("") || "";
          inputTokens = data.usage?.input_tokens ?? 0;
          outputTokens = data.usage?.output_tokens ?? 0;
          stopReason = data.stop_reason ?? void 0;
        }
        if (!text.trim() || stopReason !== "end_turn" && stopReason !== "stop_sequence") {
          throw new AnalyzerError("AI_RESPONSE_INVALID", 422, "The AI provider returned an incomplete analysis. Nothing was charged.", true);
        }
        return {
          text,
          usage: { input_tokens: inputTokens, output_tokens: outputTokens },
          model: wireModel,
          durationMs: Date.now() - startTime,
          stopReason
        };
      } catch (err) {
        lastError = err;
        if (err instanceof AnalyzerError && !err.retryable) {
          throw err;
        }
        const isTimeout = err?.name === "TimeoutError" || err?.name === "AbortError" || String(err?.message || "").toLowerCase().includes("timed out") || String(err?.message || "").toLowerCase().includes("deadline") || String(err?.message || "").toLowerCase().includes("timeout");
        const wasLongTimeout = isTimeout && Date.now() - attemptStart >= 3e4;
        if (wasLongTimeout) {
          logAnalyzerDiagnostic(`suppressing retry after lengthy provider timeout (${Date.now() - attemptStart} ms)`, err);
          break;
        }
        if (attempt <= maxRetries) {
          const backoffMs = Math.min(1e3 * Math.pow(2, attempt), 3e3);
          const remainingAfter = overallBudget - (Date.now() - overallStart);
          if (remainingAfter <= backoffMs) {
            break;
          }
          await new Promise((r) => setTimeout(r, backoffMs));
          continue;
        }
      } finally {
        if (activeTimer !== void 0) clearTimeout(activeTimer);
      }
    }
    if (lastError instanceof AnalyzerError) {
      throw lastError;
    }
    logAnalyzerDiagnostic(`provider transport after ${attempt} attempt(s)`, lastError ?? new Error("unknown"));
    throw new AnalyzerError(
      "AI_PROVIDER_TEMPORARILY_UNAVAILABLE",
      503,
      "The AI analysis engine did not respond in time. Please try again shortly. Nothing was charged.",
      true
    );
  };
}

// shared/citationVerification.ts
var INTERNAL_CYFSA_SECTION_KEYS = [
  "1(1)",
  "1(2)",
  "1(2), para. 1",
  "1(2), para. 2",
  "2(1)",
  "3",
  "9.1",
  "13(1)",
  "14",
  "15(2)",
  "15(4)",
  "35(1)",
  "35(2)",
  "72",
  "73",
  "74(1)",
  "74(2)",
  "74(3)",
  "75(1)",
  "75(4)",
  "75(5)",
  "75(6)",
  "76(3)",
  "78",
  "78(1)",
  "78(4)",
  "79(1)",
  "80",
  "81(1)",
  "81(2)",
  "81(7)",
  "81(12)",
  "81(13)",
  "88",
  "90(1)",
  "93(1)",
  "94(1)",
  "94(2)",
  "94(4)",
  "94(6)",
  "94(10)",
  "98(1)",
  "100",
  "101(1)",
  "101(1), para. 1",
  "101(2)",
  "101(3)",
  "101(4)",
  "101(5)",
  "101(7)",
  "102(1)",
  "104(1)",
  "105(1)",
  "105(5)",
  "109(2)",
  "109(2)(d)",
  "113(1)",
  "113(2)",
  "114",
  "115(2)",
  "116(1)",
  "116(4)",
  "119(1)",
  "119(2)",
  "119(11)",
  "120(1)",
  "120(4)",
  "120(8)",
  "121(1)",
  "121(2.1)",
  "121(3)",
  "122(1)",
  "122(5)",
  "123",
  "125(1)",
  "126(1)",
  "136(5)",
  "306(1)",
  "312(1)",
  "314(3)",
  "315(2)",
  "316(1)",
  "333(1)"
];
var VERIFIED_CYFSA_CLAUSES = {
  "1(2)": ["para. 1", "para. 2", "para. 3", "para. 4", "para. 5", "para. 6", "para. 7"],
  "3": ["para. 1", "para. 2", "para. 3", "para. 4", "para. 5"],
  // para. 6 repealed by 2018, c. 17, Sched. 34, s. 6(1)
  "14": ["a", "b"],
  "35(1)": ["a", "b", "c", "d", "e", "f", "g"],
  "35(2)": ["a", "b"],
  "72": ["a", "b", "c", "d", "e", "f", "g", "h", "i"],
  "74(2)": ["a", "b", "c", "d", "d.1", "d.2", "e", "f", "g", "h", "i", "j", "k", "l", "m", "n", "o"],
  "74(3)": ["a", "b", "c"],
  "75(4)": ["a", "b"],
  "75(6)": ["a", "b"],
  "76(3)": ["a", "b", "c"],
  "78(4)": ["a", "b", "c"],
  "79(1)": ["para. 1", "para. 2", "para. 3", "para. 4"],
  "80": ["a", "b", "c"],
  "81(2)": ["a", "b", "c"],
  "81(7)": ["a", "b", "c"],
  "88": ["a", "b", "c", "d", "e"],
  "93(1)": ["a", "b"],
  "94(1)": ["a", "b"],
  "94(2)": ["a", "b", "c", "d"],
  "94(6)": ["a", "b", "c"],
  "98(1)": ["para. 1", "para. 2", "para. 3"],
  "100": ["a", "b", "c", "d", "e", "f"],
  "101(1)": ["para. 1", "para. 2", "para. 3", "para. 4"],
  "101(5)": ["a", "b", "c"],
  "101(7)": ["a", "b", "c"],
  "104(1)": ["a", "b"],
  "105(5)": ["a", "b"],
  "109(2)": ["a", "b", "c", "d", "e"],
  "113(1)": ["para. 1", "para. 2", "para. 3", "para. 4", "para. 5"],
  "113(2)": ["a", "b", "c"],
  "114": ["a", "b", "c", "d"],
  "115(2)": ["a", "b", "c"],
  "116(1)": ["a", "b", "c"],
  "116(4)": ["a", "b", "c"],
  "119(11)": ["a", "b"],
  "120(1)": ["a", "b"],
  "120(4)": ["para. 1", "para. 2", "para. 3", "para. 4", "para. 5", "para. 6"],
  "120(8)": ["a", "b"],
  "121(1)": ["a", "b", "c", "d", "e"],
  "121(2.1)": ["a", "b"],
  "121(3)": ["a", "b"],
  "122(1)": ["a", "b"],
  "123": ["a", "b"],
  "312(1)": ["a", "b", "c", "d"],
  "314(3)": ["a", "b"]
};
var cyfsaNamePattern = () => /\bCYFSA\b|Child,?\s+Youth\s+and\s+Family\s+Services\s+Act(?:\s*,\s*2017)?|S\.\s*O\.\s*2017,?\s*c\.\s*14(?:\s*,\s*Sched(?:ule|\.)?\s*1)?/gi;
var otherInstrumentPattern = () => /\b(?:Acts?|Codes?|Charter|Regulations?|Regs?|Rules?|CLRA|FLR|OCPS|OCSWSSW|R\.R\.O\.|R\.S\.O\.|S\.\s*O\.|S\.\s*C\.|O\.\s*Reg\.?|Bills?|Statutes?|Ontario\s+Child\s+Protection\s+Standards)\b/gi;
function resolveBundledCyfsaKey(sectionKey) {
  const internalSet = new Set(INTERNAL_CYFSA_SECTION_KEYS);
  if (internalSet.has(sectionKey)) {
    return sectionKey;
  }
  const clauseMatch = sectionKey.match(/^(\d{1,3}(?:\.\d+)?(?:\(\d+(?:\.\d+)?\))*)\(([a-z](?:\.\d+)?)\)$/i);
  if (clauseMatch) {
    const base = clauseMatch[1];
    const clause = clauseMatch[2].toLowerCase();
    const validClauses = VERIFIED_CYFSA_CLAUSES[base];
    if (internalSet.has(base) && validClauses && validClauses.includes(clause)) {
      return base;
    }
    return null;
  }
  const paraMatch = sectionKey.match(/^(\d{1,3}(?:\.\d+)?(?:\(\d+(?:\.\d+)?\))*),\s*para\.\s*(\d+(?:\.\d+)?)$/i);
  if (paraMatch) {
    const base = paraMatch[1];
    const para = `para. ${paraMatch[2]}`;
    const validClauses = VERIFIED_CYFSA_CLAUSES[base];
    if (internalSet.has(base) && validClauses && validClauses.includes(para)) {
      return base;
    }
    return null;
  }
  return null;
}
function isVerifiedCyfsaSection(sectionKey) {
  return resolveBundledCyfsaKey(sectionKey) !== null;
}
function citedSections(text) {
  const out = [];
  const listPattern = /\b(?:s|ss|sec|secs|section|sections|subs?|subsections?|clause|clauses)\.?\s*((?:(?:\d{1,3}(?:\.\d+)?(?:\(\d+(?:\.\d+)?\))*(?:\([a-z](?:\.\d+)?\))*(?:\s*,\s*(?:para|paragraph)s?\.?\s*\d+(?:\.\d+)?)?|\(\d+(?:\.\d+)?\)(?:\([a-z](?:\.\d+)?\))*)(?:\s*(?:,|;|and|or|&|to|-|–)\s*)?)+)/gi;
  for (const m of text.matchAll(listPattern)) {
    const rawSegment = m[1];
    const expandedSegment = rawSegment.replace(
      /(\d{1,3}(?:\.\d+)?)\((\d+)\)\s*(?:-|–|to)\s*\((\d+)\)/gi,
      (_match, sec, startSub, endSub) => {
        const sNum = Number(startSub);
        const eNum = Number(endSub);
        if (Number.isInteger(sNum) && Number.isInteger(eNum) && eNum >= sNum && eNum - sNum <= 20) {
          const parts = [];
          for (let k = sNum; k <= eNum; k++) {
            parts.push(`${sec}(${k})`);
          }
          return parts.join(", ");
        }
        return _match;
      }
    );
    let base = "";
    const itemRegex = /(\d{1,3}(?:\.\d+)?)((?:\(\d+(?:\.\d+)?\))*)((?:\([a-z](?:\.\d+)?\))*)(?:\s*,\s*(?:para|paragraph)s?\.?\s*(\d+(?:\.\d+)?))?|\((\d+(?:\.\d+)?)\)((?:\([a-z](?:\.\d+)?\))*)/gi;
    for (const item of expandedSegment.matchAll(itemRegex)) {
      if (item[1]) {
        base = item[1];
        const subs = item[2] || "";
        const clauses = item[3] || "";
        const para = item[4] ? `, para. ${item[4]}` : "";
        out.push(`${base}${subs}${clauses}${para}`);
      } else if (item[5] && base) {
        const clauses = item[6] || "";
        out.push(`${base}(${item[5]})${clauses}`);
      }
    }
  }
  return out;
}
function identifyInstruments(text) {
  const cyfsa = cyfsaNamePattern().test(text);
  const rest = text.replace(cyfsaNamePattern(), " ");
  const others = [...rest.matchAll(otherInstrumentPattern())].map((m) => m[0]);
  return { cyfsa, others };
}
function identifyAuthorityCategory(text) {
  const t = (text || "").trim();
  if (!t) return "NONE";
  const { cyfsa, others } = identifyInstruments(t);
  if (cyfsa && others.length > 0) return "MULTIPLE";
  if (cyfsa) return "CYFSA";
  const hasBillC92 = /\bBill\s+C-92\b|\bS\.\s*C\.\s*2019,?\s*c\.\s*24\b|Act\s+respecting\s+First\s+Nations,?\s+Inuit\s+and\s+M[ée]tis\s+children/i.test(t);
  const hasFlr = /\b(?:Family\s+Law\s+Rules?|FLR|O\.\s*Reg\.?\s*114\/99)\b/i.test(t) || !cyfsa && /\b(?:Rule|Subrule|r\.)\s*(?:1\(8\)|1\.8|14\(18\)|14\.18|14\(19\)|14\.19|33)(?!\w)/i.test(t);
  const hasCharter = /\b(?:Canadian\s+)?Charter(?:\s+of\s+Rights\s+and\s+Freedoms)?\b/i.test(t);
  const hasClra = /\b(?:CLRA|Children['’]s\s+Law\s+Reform\s+Act)\b/i.test(t);
  const hasCasStandard = /\b(?:Ontario\s+Child\s+Protection\s+Standards|OCPS|Child\s+Protection\s+Standards\s*\(?2016\)?)\b/i.test(t);
  const hasProfessionalStandard = /\b(?:OCSWSSW|Ontario\s+College\s+of\s+Social\s+Workers(?:\s+and\s+Social\s+Service\s+Workers)?|Social\s+Work\s+and\s+Social\s+Service\s+Work\s+Act)\b/i.test(t);
  const hasOversightPathway = !cyfsa && /\b(?:Ombudsman\s+Act|Ontario\s+Ombudsman|Information\s+and\s+Privacy\s+Commissioner)\b/i.test(t);
  const hasReg = !hasFlr && /\b(?:O\.\s*Reg\.?|R\.R\.O\.|Regulations?)\b/i.test(t);
  const hasCaseLaw = /\bv\.\s+[A-Z]|\b\d{4}\s+(?:SCC|ONCA|ONSC|ONCJ)\s+\d+|\[\d{4}\]\s*\d+\s*S\.C\.R\./i.test(t);
  const matchedCategories = [];
  if (hasBillC92) matchedCategories.push("BILL_C92");
  if (hasFlr) matchedCategories.push("FAMILY_LAW_RULES");
  if (hasCharter) matchedCategories.push("CHARTER");
  if (hasClra) matchedCategories.push("CHILDRENS_LAW_REFORM_ACT");
  if (hasCasStandard) matchedCategories.push("CAS_STANDARD");
  if (hasProfessionalStandard) matchedCategories.push("PROFESSIONAL_STANDARD");
  if (hasOversightPathway) matchedCategories.push("OVERSIGHT_PATHWAY");
  if (hasReg) matchedCategories.push("REGULATION");
  if (hasCaseLaw) matchedCategories.push("CASE_LAW");
  if (matchedCategories.length > 1) return "MULTIPLE";
  if (matchedCategories.length === 1) return matchedCategories[0];
  if (others.length > 0) return "OTHER";
  return "NONE";
}
function classifyCitation(text) {
  const t = (text || "").trim();
  const authorityCategory = identifyAuthorityCategory(t);
  const none = (reason) => ({
    status: "NONE",
    identifiedAct: "NONE",
    authorityCategory: "NONE",
    sections: [],
    officialVerification: "NOT_CHECKED",
    reason
  });
  if (!t) return none("No statute is cited for this point.");
  if (/unverified/i.test(t)) {
    return {
      status: "UNVERIFIED",
      identifiedAct: identifyInstruments(t).cyfsa ? "CYFSA" : "NONE",
      authorityCategory,
      sections: citedSections(t),
      officialVerification: "NOT_CHECKED",
      reason: "The citation is already marked unverified."
    };
  }
  const { cyfsa, others } = identifyInstruments(t);
  const sections = citedSections(t);
  const unverified = (identifiedAct, reason) => ({
    status: "UNVERIFIED",
    identifiedAct,
    authorityCategory,
    sections,
    officialVerification: "NOT_CHECKED",
    reason
  });
  if (cyfsa && others.length > 0) {
    return unverified("MULTIPLE", "This citation names more than one statute or instrument, so it cannot be matched to one provision.");
  }
  if (!cyfsa && others.length > 0) {
    return unverified(
      "OTHER",
      "This citation names a statute, regulation or other instrument other than the CYFSA. The CYFSA reference text does not cover it, so it is not checked."
    );
  }
  if (!cyfsa) {
    if (sections.length > 0) {
      return unverified("NONE", "No Act is identified for this section number, so it cannot be matched to a provision.");
    }
    return none("No statute section is identified in this citation.");
  }
  if (sections.length === 0) {
    return unverified("CYFSA", "The CYFSA is named, but no section is identified.");
  }
  const notInternal = sections.filter((s) => !isVerifiedCyfsaSection(s));
  if (notInternal.length > 0) {
    return unverified(
      "CYFSA",
      `CYFSA section ${notInternal.join(", ")} is not in CYFSA Navigator's internal reference text. That does not show whether the section exists or applies.`
    );
  }
  return {
    status: "INTERNAL_REFERENCE_MATCH",
    identifiedAct: "CYFSA",
    authorityCategory: "CYFSA",
    sections,
    officialVerification: "NOT_CHECKED",
    reason: "Matches CYFSA Navigator's internal reference text. Not checked against official e-Laws, and not a finding that the section applies to these facts."
  };
}

// api/services/analyzerPrompts.ts
var INTERNAL_REFERENCE_LIST = INTERNAL_CYFSA_SECTION_KEYS.map((key) => `CYFSA s.${key}`).join(", ");
var ANALYSIS_RULES = `CORE RULES (non-negotiable)
1. Every flag requires three things, all present or the flag is not shown:
- Document quote: the exact phrase from the uploaded document, with page/paragraph locator.
- Statute citation: the specific CYFSA section, ONLY if on the internal reference list (see Rule 2).
- Match explanation: one sentence connecting the specific document language to the specific statutory requirement \u2014 not a general summary of the section.

2. Statute citations.
- A CYFSA section may be cited only if it is on the internal reference list: ${INTERNAL_REFERENCE_LIST}. Describe the list as CYFSA Navigator's internal reference text. It has NOT been checked against official e-Laws, and a section on the list does not show that it applies to these facts.
- Every other citation must carry this warning, unchanged: "\u26A0\uFE0F Statute citation unverified \u2014 confirm exact section with counsel before relying on this." This covers a section number given without the Act it belongs to; any other Act (such as the Family Law Act, the Criminal Code, or the Children's Law Reform Act); any regulation; and any CYFSA section not on the list.
- Do not reproduce statute wording. Give the section number and the warning.
- Never generate a plausible-sounding section number from pattern-matching. A wrong citation is worse than no citation, and it undermines the parent's credibility if it is raised in court.

3. Severity labels must be calibrated, not maximal.
Replace absolute language with hedged, accurate framing:
- Do NOT use "[CRITICAL]", "unlawful", "illegal", or "violates" unless the document contains an explicit admission of a clear procedural failure (e.g., "we did not inform the court...") \u2014 i.e., the CAS's own words concede the point.
- For anything involving legal interpretation, an untested theory, or a matter courts have ruled inconsistently on (e.g., informal safety-plan advice, the boundary between access restriction and apprehension), use: "[Worth Raising With Counsel]" and explain that the law is not settled on this exact point.
- For hearsay/weight arguments, use: "[Affects Evidentiary Weight]" rather than "[CRITICAL]" / "Hearsay" \u2014 under Family Law Rules 14(19) (not checked against the official rules text), hearsay in motion affidavits is often permitted if the source is disclosed; the real argument is usually about how much weight it should get, not whether it's admissible at all.

4. No invented legal theories presented as established law.
If you construct a novel argument (e.g., "informal access restriction = de facto apprehension triggering the 5-day hearing rule"), explicitly label it as a theory to test, not a rule: "This is an argument your lawyer could make \u2014 it has not been confirmed as settled law in this fact pattern. Ask your lawyer whether Ontario courts have accepted this reasoning."

5. Every output ends with the same disclaimer, unmodified:
"This document is generated for informational/educational purposes only. It does not constitute legal advice or representation. Please consult a lawyer licensed by the Law Society of Ontario, or contact Legal Aid Ontario, before relying on any conclusion in this report."

6. STATUTORY ISSUES REGISTER AND ANSWERED QUESTIONS (required in every report):
- In thresholdAnalysis and statutory timeline entries, list each applicable legal issue separately: provision/rule and precise subsection if on the internal reference list, document locator and short evidence quotation, factual concern, what the provision actually requires, preliminary outcome (Supported / Not supported / Inconclusive / Not applicable), verification status (Verified / Citation unverified), and the specific missing record needed to resolve it. Do not conflate a documentation gap with a statutory breach.
- For every question in whatToAskALawyer, include an evidence-grounded preliminary answer in the SAME string immediately after the question using the format 'Question: ... | What the uploaded record shows: ... | Still unknown: ... | Source: page/paragraph/exhibit ...'. If the record does not answer it, write 'Not determinable from the uploaded documents' rather than guessing. The question remains for counsel even when a provisional answer is supplied.
- In whatToVerify, connect each unresolved statutory issue to a concrete record to obtain and state what answer that record could supply.
- In lawyerCaseBrief, distinguish NEW document-supported findings from expanded legal interpretations. If a prior Quick Review is not included in the provided input, do NOT claim to have compared reports or invent a difference; say a comparison is unavailable.
- Never mark an issue 'No' or 'Violation' solely because a document omits evidence of compliance. If the record does not establish the legal test, use Inconclusive and state why.
- For Ontario Family Law Rules 14(18) and 14(19), the rule as commonly summarised is that motion affidavits should as far as possible be firsthand, but information from another named source may be included if the affiant states a belief that it is true; secondhand material is not automatically inadmissible.
- Keep every finding and answer within the existing report schema; do not invent new top-level JSON keys.

THINGS TO NEVER DO
- Never assert that a document violates a law unless the violation is admitted in the document's own words.
- Never present an unverified statute citation as fact.
- Never use more than one severity tier of "CRITICAL" per document \u2014 if everything is critical, nothing is.
- Never generate content that could be read as legal advice ("you should file a motion to strike") \u2014 reframe as questions for counsel ("ask your lawyer whether a motion to strike is appropriate here").
- Never fabricate a case name, citation, or quote. If asked to support a point with case law and you cannot verify one via search, say so directly.`;
var SYSTEM_PREAMBLE = `You are CYFSA Navigator's Evidence Strength Audit tool. You analyze legal documents (affidavits, motion records, CAS correspondence) submitted by self-represented parents in Ontario child protection proceedings under the CYFSA. Your job is to help the parent and their lawyer identify weaknesses, procedural issues, and points worth raising \u2014 NOT to issue legal conclusions.`;
var ANALYZER_SYSTEM_PROMPT = `${SYSTEM_PREAMBLE}

${ANALYSIS_RULES}`;
var FIELD_SCHEMAS = {
  documentTitle: `  "documentTitle": "Identify title or default to 'Uploaded Document'"`,
  documentType: `  "documentType": "e.g., Worker Observation Letter, CAS Application, Unofficial Draft, etc."`,
  metadata: `  "metadata": {
    "fileNumber": "Extracted file number (e.g. FC-26-XXXX) or empty string",
    "applicantName": "Extracted applicant name (e.g. Children's Aid Society) or empty string",
    "respondentName": "Extracted respondent/parent name or empty string",
    "childNames": "Extracted names of involved children or empty string",
    "hearingDate": "Extracted next hearing or application date or empty string"
  }`,
  disclaimer: `  "disclaimer": "This document is generated for informational/educational purposes only. It does not constitute legal advice or representation. Please consult a lawyer licensed by the Law Society of Ontario, or contact Legal Aid Ontario, before relying on any conclusion in this report."`,
  completenessScore: `  "completenessScore": 0, // integer 0-100 measuring how much relevant information is actually present; do not treat missing information as proof of misconduct or violation`,
  completenessScoreMethod: `  "completenessScoreMethod": "Score only the completeness of the information contained in this document. This is separate from Evidence Strength Index and is not an admissibility or legal-merits score."`,
  evidenceStrengthIndex: `  "evidenceStrengthIndex": {
    "score": 0,
    "scale": "0-100",
    "label": "Evidence Strength Index",
    "method": "Calculate from the documented evidence in this file only. Do not score the legal merits of the case.",
    "components": {
      "firsthandKnowledge": {"score": 0, "max": 20, "explanation": ""},
      "sourceReliability": {"score": 0, "max": 15, "explanation": ""},
      "corroboration": {"score": 0, "max": 15, "explanation": ""},
      "documentarySupport": {"score": 0, "max": 15, "explanation": ""},
      "internalConsistency": {"score": 0, "max": 10, "explanation": ""},
      "contradictoryEvidenceHandling": {"score": 0, "max": 10, "explanation": ""},
      "legalAuthorityVerification": {"score": 0, "max": 10, "explanation": ""},
      "proceduralDocumentation": {"score": 0, "max": 5, "explanation": ""}
    },
    "calculation": "The final score must equal the sum of the eight component scores and must never be invented independently.",
    "limitations": "A low score means the document contains gaps, unsupported assertions, limited firsthand knowledge, contradictions, or insufficient documentation. It does not mean the document is false or inadmissible. A high score does not establish legal correctness or admissibility."
  }`,
  fileSummary: `  "fileSummary": "Write a plain-language executive briefing of 5-8 sentences. Identify what the document is, what it is trying to establish, the 2-4 most important factual/evidentiary issues actually visible in the document, the strongest documented support, the most important gap or weakness, and what the parent should verify next. Explain legal significance cautiously and distinguish document facts from inference. State that the Evidence Strength Index is a heuristic assessment of the evidence contained in the reviewed document, not a legal admissibility ruling. Missing information must reduce completeness only where appropriate and must never be treated as proof that an event, violation, or statutory failure occurred."`,
  redFlags: `  "redFlags": [
    {
       "id": "rf1",
       "severity": "Affects Evidentiary Weight", // Allowed: "Affects Evidentiary Weight", "Worth Raising With Counsel", or "CRITICAL". CRITICAL requires an explicit documented admission of a material procedural failure AND verified statutory authority; otherwise do not use CRITICAL.
       "category": "Hearsay", // "Hearsay", "Unsupported Claim", "Procedural Defect", "Authority Overreach", "Rights Omission", etc.
       "evidenceClassification": "HEARSAY", // Must be strictly one of: "DIRECT", "DOCUMENTARY", "CORROBORATED", "HEARSAY", "INFERENCE", "OPINION", "UNSUPPORTED", "UNCLEAR"
       "phraseDetected": "The exact sentence in the text representing the red flag",
       "explanation": "Write 3-5 clear sentences: (1) what the quoted passage actually says, (2) why it affects evidentiary weight or procedure, (3) what evidence in this document supports or weakens the point, and (4) what cannot be concluded from this document alone. Do not use generic legal filler.",
       "verifyRequirement": "Give a specific verification checklist naming the record, witness, date, log, message, medical/school record, disclosure item, or other evidence that would confirm or challenge this exact point. Avoid vague phrases such as 'get more evidence'.",
       "legalReference": "The specific CYFSA section, ONLY if verified. If unverified: '\u26A0\uFE0F Statute citation unverified \u2014 confirm exact section with counsel before relying on this.'",
       "locationInDocument": "Page X, Paragraph Y",
       "parentActionStep": "concrete next step \u2014 'ask your lawyer about X' / 'request disclosure of Y' \u2014 not a legal conclusion"
    }
  ]`,
  thresholdAnalysis: `  "thresholdAnalysis": [
    {
      "thresholdChecked": "CYFSA s. 81 \u2014 Application / Child Protection Proceeding Authority",
      "isMet": "Yes / No / Inconclusive",
      "reasoning": "Analyze the role of CYFSA s. 81(1) in commencing the proceeding, distinguishing application authority under s. 81(1) from warrant-based apprehension under s. 81(2), warrantless apprehension under s. 81(7), and protection grounds under s. 74(2). Never attribute warrantless apprehension to s. 81(1) or s. 81(2).",
      "primarySourceLaw": "CYFSA, S.O. 2017, c. 14, Sched. 1, s. 81(1)"
    },
    {
      "thresholdChecked": "Child in Need of Protection grounds (CYFSA s. 74)",
      "isMet": "Yes / No / Inconclusive",
      "reasoning": "Identify the specific protection allegation(s) actually asserted in the file under s. 74(2). For each, separate allegation from supporting proof; name the strongest direct/documentary support, any hearsay or source limitation, any contradiction or missing corroboration, and state why the result is Yes, No, or Inconclusive. Be concrete and document-specific, not generic.",
      "primarySourceLaw": "CYFSA, S.O. 2017, c. 14, Sched. 1, s. 74(2)"
    },
    {
      "thresholdChecked": "Duty to Report standard vs Direct evidence (CYFSA s. 125)",
      "isMet": "Yes / No / Inconclusive",
      "reasoning": "Analyze if CAS or a reporter is misrepresenting the basic 'reasonable grounds to suspect' s. 125(1) duty to report standard as actual direct evidence of maltreatment inside this file.",
      "primarySourceLaw": "CYFSA, S.O. 2017, c. 14, Sched. 1, s. 125(1)"
    },
    {
      "thresholdChecked": "Kinship / Family-Based Alternatives \u2014 Documentation Check",
      "isMet": "Yes / No / Inconclusive",
      "reasoning": "Determine whether the reviewed document documents consideration of less disruptive alternatives, community assistance, or kinship/extended-family placement under CYFSA s. 101(2), s. 101(3), and s. 94(4). Note that under s. 94(6)(c) and s. 101(7)(c), court terms on a society cannot require the society to provide financial assistance or purchase goods or services. Do NOT infer that the Society failed to consider alternatives merely because the affidavit omits them; classify an absence of documentation as 'Not Determinable From This Document'.",
      "primarySourceLaw": "CYFSA, S.O. 2017, c. 14, Sched. 1, s. 101(3)"
    }
  ]`,
  proceduralTimelineViolations: `  "proceduralTimelineViolations": [
    {
      "timelineRule": "30-Day Adjournment Limit (CYFSA s. 94(1))",
      "documentAssertion": "E.g. calendar gaps, schedule arrangements or dates mentioned.",
      "evaluation": "Analyze if the document indicates court processes are adjourned for more than 30 days without universal consent under Section 94(1). If the document does not contain enough information to determine compliance, mark the result 'Not Determinable From This Document'. Never infer compliance merely because a violation or event is not mentioned.",
      "citation": "CYFSA, S.O. 2017, c. 14, s. 94(1)",
      "locationInDocument": "Page X, Paragraph Y, or state 'Checked & Compliant'",
      "parentActionStep": "Parent action steps to track scheduled court dates and ensure their lawyer asserts s. 94(1) rights."
    },
    {
      "timelineRule": "Court hearing timeline following apprehension without warrant (CYFSA s. 88)",
      "documentAssertion": "E.g. dates of removal or court schedules.",
      "evaluation": "Evaluate whether the matter was brought before the court as soon as practicable and within five days after the child was brought to a place of safety under CYFSA s. 88 (unless returned or reached an agreement). Never cite s. 94(5) for the 5-day hearing rule.",
      "citation": "CYFSA, S.O. 2017, c. 14, s. 88",
      "locationInDocument": "Page X, Paragraph Y, or state 'Not applicable - child in home care'",
      "parentActionStep": "Verify immediate court scheduling under CYFSA s. 88 if an apprehension occurs. Keep court liaison logs."
    },
    {
      "timelineRule": "Child Ombudsman Access & Continuous Care Rights (CYFSA s. 9.1)",
      "documentAssertion": "E.g. references to child consultation, Ombudsman access, or CAS contact rules.",
      "evaluation": "Evaluate if the child's rights to be informed of the Ombudsman under CYFSA s. 9.1 (enacted by S.O. 2024, c. 17) are documented where a child is in care.",
      "citation": "CYFSA, S.O. 2017, c. 14, s. 9.1",
      "locationInDocument": "Page X, Paragraph Y, or 'Checked & Advised'",
      "parentActionStep": "Confirm child is aware they can contact the Ontario Ombudsman regarding CAS placements under CYFSA s. 9.1."
    },
    {
      "timelineRule": "300-Day Presumption of Parentage",
      "documentAssertion": "E.g. marriage status, cohabitant records, or parent naming details.",
      "evaluation": "Check for adherence to Children's Law Reform Act presumptions of parentage for separations within 300 days of birth, if relevant on the facts. The CLRA is not in the internal CYFSA reference list and must carry the unverified citation warning.",
      "citation": "\u26A0\uFE0F Statute citation unverified \u2014 confirm exact section with counsel before relying on this.",
      "locationInDocument": "Page X, Paragraph Y, or state 'Checked & Compliant'",
      "parentActionStep": "Action step for parent to confirm both actual parent parties are formally integrated in notices."
    }
  ]`,
  charterAndHumanRightsIssues: `  "charterAndHumanRightsIssues": [
    "Section 7 (Canadian Charter): Analyze and identify notable points where rights to life, liberty, and security of the person are engaged or infringed.",
    "Section 15 (Canadian Charter): Analyze and identify notable points where equality and non-discrimination rights are active.",
    "Mandatory Consideration of Indigenous, First Nations, Inuit, or M\xE9tis Heritage (CYFSA Section 2): Check and analyze whether culture and kinship options were respected."
  ]`,
  whatToVerify: `  "whatToVerify": [
    "List 3-5 specific verification items where supported by the document. Each item must say WHAT to obtain/check, WHY it matters to a named finding, and WHAT question it could resolve. Prefer exact records, dates, people, logs, messages, medical/school records, disclosure, or court documents over generic advice."
  ]`,
  whatToAskALawyer: `  "whatToAskALawyer": [
    "List 3-5 precise questions for counsel tied to actual passages/findings. For EACH item use: Question: [specific question] | What the uploaded record shows: [grounded provisional answer or Not determinable from the uploaded documents] | Still unknown: [missing fact] | Source: [page/paragraph/exhibit]. Never invent a missing answer."
  ]`,
  whatIsMissing: `  "whatIsMissing": [
    "List 3-5 material information items missing from THIS document. For each item, explain why the missing information matters and what record/source would normally answer it. Never treat absence from this document as proof the event did not occur."
  ]`,
  lawyerCaseBrief: `  "lawyerCaseBrief": [
    "A comprehensive 3-5 bullet counsel briefing. Each bullet must use this internal structure in plain text: ISSUE \u2014 DOCUMENT EVIDENCE \u2014 SIGNIFICANCE \u2014 LIMITATION/COUNTERPOINT \u2014 VERIFY/NEXT QUESTION. Tie every bullet to the reviewed document and avoid generic legal commentary."
  ]`
};

// shared/analyzerRetryPolicy.ts
var SECTION_ATTEMPTS = 2;
var VERIFICATION_ATTEMPTS = 2;

// shared/legalVerificationPipeline.ts
var CYFSA_TITLE = "Child, Youth and Family Services Act, 2017, S.O. 2017, c. 14, Sched. 1";
var CYFSA_PERIOD = "Consolidation period: July 1, 2026 to Present (in force April 30, 2018)";
var BILL_C92_TITLE = "An Act respecting First Nations, Inuit and M\xE9tis children, youth and families, S.C. 2019, c. 24";
var FLR_TITLE = "Courts of Justice Act \u2014 Family Law Rules, O. Reg. 114/99";
var CHARTER_TITLE = "Constitution Act, 1982, Part I \u2014 Canadian Charter of Rights and Freedoms";
var CORE_AUTHORITIES = [
  {
    authorityId: "CYFSA:1(1)",
    citation: "CYFSA, s. 1(1)",
    instrument: "CYFSA",
    statuteTitle: CYFSA_TITLE,
    sectionKey: "1(1)",
    heading: "Paramount purpose",
    exactWording: "(1) The paramount purpose of this Act is to promote the best interests, protection and well-being of children.",
    sourceUrl: "https://www.ontario.ca/laws/statute/17c14#BK2",
    consolidationPeriod: CYFSA_PERIOD,
    effectiveFrom: "2018-04-30",
    effectiveTo: null,
    verificationSourceType: "BUNDLED_CONSOLIDATION_VERBATIM",
    verifiedDate: "2026-11-03",
    legalTestSummary: "Establishes that promoting the best interests, protection, and well-being of children is the paramount purpose of the CYFSA.",
    practiceNote: "All other statutory purposes under s. 1(2) operate subject to consistency with s. 1(1)."
  },
  {
    authorityId: "CYFSA:1(2)",
    citation: "CYFSA, s. 1(2)",
    instrument: "CYFSA",
    statuteTitle: CYFSA_TITLE,
    sectionKey: "1(2)",
    heading: "Other purposes",
    exactWording: "(2) The additional purposes of this Act, so long as they are consistent with the best interests, protection and well-being of children, are to recognize the following: 1. While parents may need help in caring for their children, that help should give support to the autonomy and integrity of the family unit and, wherever possible, be provided on the basis of mutual consent. 2. The least disruptive course of action that is available and is appropriate in a particular case to help a child, including the provision of prevention services, early intervention services and community support services, should be considered.",
    sourceUrl: "https://www.ontario.ca/laws/statute/17c14#BK2",
    consolidationPeriod: CYFSA_PERIOD,
    effectiveFrom: "2018-04-30",
    effectiveTo: null,
    verificationSourceType: "BUNDLED_CONSOLIDATION_VERBATIM",
    verifiedDate: "2026-11-03",
    legalTestSummary: "Sets out seven additional statutory purposes, including family autonomy, mutual consent, least disruptive course of action, continuity of care, and Indigenous service principles.",
    practiceNote: "Note that s. 1(2) uses numbered paragraphs (e.g. s. 1(2), para. 1 and para. 2), not lettered clauses."
  },
  {
    authorityId: "CYFSA:1(2), para. 1",
    citation: "CYFSA, s. 1(2), para. 1",
    instrument: "CYFSA",
    statuteTitle: CYFSA_TITLE,
    sectionKey: "1(2), para. 1",
    heading: "Other purposes \u2014 Support to family autonomy and mutual consent",
    exactWording: "1. While parents may need help in caring for their children, that help should give support to the autonomy and integrity of the family unit and, wherever possible, be provided on the basis of mutual consent.",
    sourceUrl: "https://www.ontario.ca/laws/statute/17c14#BK2",
    consolidationPeriod: CYFSA_PERIOD,
    effectiveFrom: "2018-04-30",
    effectiveTo: null,
    verificationSourceType: "BUNDLED_CONSOLIDATION_VERBATIM",
    verifiedDate: "2026-11-03",
    legalTestSummary: "Recognizes that assistance to parents should support the autonomy and integrity of the family unit and, wherever possible, be provided on the basis of mutual consent.",
    practiceNote: "Relevant when examining whether the Society offered collaborative support before seeking coercive orders."
  },
  {
    authorityId: "CYFSA:1(2), para. 2",
    citation: "CYFSA, s. 1(2), para. 2",
    instrument: "CYFSA",
    statuteTitle: CYFSA_TITLE,
    sectionKey: "1(2), para. 2",
    heading: "Other purposes \u2014 Least disruptive course of action",
    exactWording: "2. The least disruptive course of action that is available and is appropriate in a particular case to help a child, including the provision of prevention services, early intervention services and community support services, should be considered.",
    sourceUrl: "https://www.ontario.ca/laws/statute/17c14#BK2",
    consolidationPeriod: CYFSA_PERIOD,
    effectiveFrom: "2018-04-30",
    effectiveTo: null,
    verificationSourceType: "BUNDLED_CONSOLIDATION_VERBATIM",
    verifiedDate: "2026-11-03",
    legalTestSummary: "Recognizes that the least disruptive course of action available and appropriate, including prevention, early intervention, and community support services, should be considered.",
    practiceNote: "Read together with s. 101(2) and s. 101(3) on disposition, while noting the financial order limits in s. 94(6)(c) and s. 101(7)(c)."
  },
  {
    authorityId: "CYFSA:2(1)",
    citation: "CYFSA, s. 2(1)",
    instrument: "CYFSA",
    statuteTitle: CYFSA_TITLE,
    sectionKey: "2(1)",
    heading: "Interpretation \u2014 Definitions",
    exactWording: "(1) In this Act, \u201Cagency\u201D means a corporation; (\u201Cagence\u201D) \u201Cband\u201D has the same meaning as in the Indian Act (Canada); (\u201Cbande\u201D) \u201CBoard\u201D means the Child and Family Services Review Board continued under section 333; (\u201CCommission\u201D) \u201Cchild\u201D means a person younger than 18; (\u201Cenfant\u201D)",
    sourceUrl: "https://www.ontario.ca/laws/statute/17c14#BK3",
    consolidationPeriod: CYFSA_PERIOD,
    effectiveFrom: "2018-04-30",
    effectiveTo: null,
    verificationSourceType: "BUNDLED_CONSOLIDATION_VERBATIM",
    verifiedDate: "2026-11-03",
    legalTestSummary: "Defines core statutory terms including child, child in care, customary care, extended family, relative, residential care, service, service provider, and society.",
    practiceNote: "Also see s. 2(3) for members of a child's community and s. 2(4) for a child's bands and First Nations, Inuit or M\xE9tis communities."
  },
  {
    authorityId: "CYFSA:3",
    citation: "CYFSA, s. 3",
    instrument: "CYFSA",
    statuteTitle: CYFSA_TITLE,
    sectionKey: "3",
    heading: "Rights of children, young persons receiving services",
    exactWording: "Every child and young person receiving services under this Act has the following rights: 1. To express their own views freely and safely about matters that affect them. 2. To be engaged through an honest and respectful dialogue about how and why decisions affecting them are made and to have their views given due weight, in accordance with their age and maturity. 3. To be consulted on the nature of the services provided or to be provided to them, to participate in decisions about the services provided or to be provided to them and to be advised of the decisions made in respect of those services. 4. To raise concerns or recommend changes with respect to the services provided or to be provided to them without interference or fear of coercion, discrimination or reprisal and to receive a response to their concerns or recommended changes. 5. To be informed, in language suitable to their understanding, of their rights under this Part.",
    sourceUrl: "https://www.ontario.ca/laws/statute/17c14#BK5",
    consolidationPeriod: CYFSA_PERIOD,
    effectiveFrom: "2018-04-30",
    effectiveTo: null,
    verificationSourceType: "BUNDLED_CONSOLIDATION_VERBATIM",
    verifiedDate: "2026-11-03",
    legalTestSummary: "Guarantees every child and young person receiving services under the Act the right to express views freely and safely, be consulted, raise concerns without fear of reprisal, and be informed of their Part II rights.",
    practiceNote: "Paragraph 6 of s. 3 was repealed on May 1, 2019 (2018, c. 17, Sched. 34, s. 6(1)); Ombudsman notice rights for children in care were enacted in s. 9.1 effective July 1, 2024."
  },
  {
    authorityId: "CYFSA:9.1",
    citation: "CYFSA, s. 9.1",
    instrument: "CYFSA",
    statuteTitle: CYFSA_TITLE,
    sectionKey: "9.1",
    heading: "Right to be informed \u2014 Ombudsman",
    exactWording: "A child in care has a right to be informed in language suitable to their understanding, of the information described in subsection 14.0.1 (1) of the Ombudsman Act. 2024, c. 17, s. 2.",
    sourceUrl: "https://www.ontario.ca/laws/statute/17c14#BK12",
    consolidationPeriod: "In force July 1, 2024 to Present (S.O. 2024, c. 17, s. 2)",
    effectiveFrom: "2024-07-01",
    effectiveTo: null,
    verificationSourceType: "BUNDLED_CONSOLIDATION_VERBATIM",
    verifiedDate: "2026-11-03",
    legalTestSummary: "Requires that a child in care be informed in language suitable to their understanding of information regarding the Ontario Ombudsman under s. 14.0.1(1) of the Ombudsman Act.",
    practiceNote: "Enacted by Bill 188, Supporting Children's Futures Act, 2024 (S.O. 2024, c. 17, s. 2), effective July 1, 2024. Do not apply retroactively to events prior to July 1, 2024."
  },
  {
    authorityId: "CYFSA:13(1)",
    citation: "CYFSA, s. 13(1)",
    instrument: "CYFSA",
    statuteTitle: CYFSA_TITLE,
    sectionKey: "13(1)",
    heading: "Right to plan of care",
    exactWording: "(1) A child in care has a right to a plan of care designed to meet their particular needs, which shall be prepared within 30 days of the child\u2019s or young person\u2019s admission to the residential placement.",
    sourceUrl: "https://www.ontario.ca/laws/statute/17c14#BK16",
    consolidationPeriod: CYFSA_PERIOD,
    effectiveFrom: "2018-04-30",
    effectiveTo: null,
    verificationSourceType: "BUNDLED_CONSOLIDATION_VERBATIM",
    verifiedDate: "2026-11-03",
    legalTestSummary: "Gives a child in care a statutory right to an individualized plan of care prepared within 30 days of admission to a residential placement.",
    practiceNote: "Distinct from the Society's court-filed Plan of Care under s. 100."
  },
  {
    authorityId: "CYFSA:35(1)",
    citation: "CYFSA, s. 35(1)",
    instrument: "CYFSA",
    statuteTitle: CYFSA_TITLE,
    sectionKey: "35(1)",
    heading: "Functions of society",
    exactWording: "(1) The functions of a children\u2019s aid society are to, (a) investigate allegations or evidence that children may be in need of protection; (b) protect children where necessary; (c) provide guidance, counselling and other services to families for protecting children or for the prevention of circumstances requiring the protection of children; (d) provide care for children assigned or committed to its care under this Act; (e) supervise children assigned to its supervision under this Act; (f) place children for adoption under Part VIII (Adoption and Adoption Licensing); and (g) perform any other duties given to it by this Act or the regulations or any other Act.",
    sourceUrl: "https://www.ontario.ca/laws/statute/17c14#BK44",
    consolidationPeriod: CYFSA_PERIOD,
    effectiveFrom: "2018-04-30",
    effectiveTo: null,
    verificationSourceType: "BUNDLED_CONSOLIDATION_VERBATIM",
    verifiedDate: "2026-11-03",
    legalTestSummary: "Enumerates the statutory functions of a children's aid society, including investigation, child protection, and providing guidance, counselling, and other services to families for child protection and prevention.",
    practiceNote: "While s. 35(1)(c) makes family guidance, counselling, and prevention services a core statutory function of a Society, note that under s. 94(6)(c) and s. 101(7)(c) a court supervision order cannot require the society to provide financial assistance or purchase goods or services."
  },
  {
    authorityId: "CYFSA:72",
    citation: "CYFSA, s. 72",
    instrument: "CYFSA",
    statuteTitle: CYFSA_TITLE,
    sectionKey: "72",
    heading: "Duty to consult bands and First Nations, Inuit or M\xE9tis communities",
    exactWording: "A society, person or entity that provides services or exercises powers under this Act with respect to First Nations, Inuit or M\xE9tis children or young persons shall regularly consult with their bands and First Nations, Inuit or M\xE9tis communities about the provision of the services or the exercise of the powers and about matters affecting the children or young persons, including, (a) bringing children to a place of safety and the placement of children in residential care; (b) the provision of family support services; (c) the preparation of plans for the care of children; (d) status reviews under Part V (Child Protection); (e) temporary care agreements under Part V (Child Protection); (f) society agreements with 16 and 17 year olds under Part V (Child Protection); (g) adoption placements; (h) the establishment of emergency houses; and (i) any other matter that is prescribed.",
    sourceUrl: "https://www.ontario.ca/laws/statute/17c14#BK90",
    consolidationPeriod: CYFSA_PERIOD,
    effectiveFrom: "2018-04-30",
    effectiveTo: null,
    verificationSourceType: "BUNDLED_CONSOLIDATION_VERBATIM",
    verifiedDate: "2026-11-03",
    legalTestSummary: "Mandates regular consultation with bands and First Nations, Inuit, or M\xE9tis communities regarding apprehensions, residential placements, family support services, plans of care, and status reviews.",
    practiceNote: "Applies alongside s. 73 and federal notice requirements under Bill C-92, s. 12(1)."
  },
  {
    authorityId: "CYFSA:74",
    citation: "CYFSA, s. 74",
    instrument: "CYFSA",
    statuteTitle: CYFSA_TITLE,
    sectionKey: "74",
    heading: "Child in need of protection \u2014 Definitions, grounds, and best interests",
    exactWording: "74 (1) In this Part, \u201Cchild protection worker\u201D means a Director, a local director or a person who meets the prescribed requirements and who is authorized by a Director or local director for the purposes of section 81... (2) A child is in need of protection where, (a) the child has suffered physical harm... (b) there is a risk that the child is likely to suffer physical harm... (f) the child has suffered emotional harm... (h) there is a risk that the child is likely to suffer emotional harm...",
    sourceUrl: "https://www.ontario.ca/laws/statute/17c14#BK94",
    consolidationPeriod: CYFSA_PERIOD,
    effectiveFrom: "2018-04-30",
    effectiveTo: null,
    verificationSourceType: "BUNDLED_CONSOLIDATION_VERBATIM",
    verifiedDate: "2026-11-03",
    legalTestSummary: "Sets out Part V definitions (s. 74(1)), the exhaustive statutory grounds for finding a child in need of protection (s. 74(2)(a)-(o)), and the best-interests test (s. 74(3)).",
    practiceNote: "Prefer citing the specific subsection (s. 74(1), s. 74(2), or s. 74(3)) rather than bare s. 74."
  },
  {
    authorityId: "CYFSA:74(1)",
    citation: "CYFSA, s. 74(1)",
    instrument: "CYFSA",
    statuteTitle: CYFSA_TITLE,
    sectionKey: "74(1)",
    heading: "Interpretation \u2014 Definitions for Child Protection",
    exactWording: "74 (1) In this Part, \u201Cchild protection worker\u201D means a Director, a local director or a person who meets the prescribed requirements and who is authorized by a Director or local director for the purposes of section 81 (commencing child protection proceedings) and for other prescribed purposes...",
    sourceUrl: "https://www.ontario.ca/laws/statute/17c14#BK94",
    consolidationPeriod: CYFSA_PERIOD,
    effectiveFrom: "2018-04-30",
    effectiveTo: null,
    verificationSourceType: "BUNDLED_CONSOLIDATION_VERBATIM",
    verifiedDate: "2026-11-03",
    legalTestSummary: "Defines child protection worker, parent (paragraphs 1 to 8), and place of safety for Part V.",
    practiceNote: "Check whether the worker named in court records is an authorized child protection worker and whether all statutory parents under s. 74(1) received notice."
  },
  {
    authorityId: "CYFSA:74(2)",
    citation: "CYFSA, s. 74(2)",
    instrument: "CYFSA",
    statuteTitle: CYFSA_TITLE,
    sectionKey: "74(2)",
    heading: "Child in need of protection \u2014 Specific grounds",
    exactWording: "74 (2) A child is in need of protection where, (a) the child has suffered physical harm, inflicted by the person having charge of the child or caused by or resulting from that person\u2019s, (i) failure to adequately care for, provide for, supervise or protect the child, or (ii) pattern of neglect in caring for, providing for, supervising or protecting the child; (b) there is a risk that the child is likely to suffer physical harm... (c) the child has been sexually abused or sexually exploited... (d) risk of sexual abuse or exploitation... (d.1) child sex trafficking... (d.2) risk of child sex trafficking... (e) medical treatment required... (f) emotional harm demonstrated by serious anxiety, depression, withdrawal, self-destructive or aggressive behaviour, or delayed development... (g)-(i) emotional harm treatment/risk... (j) mental, emotional or developmental condition... (k) parent died or unavailable... (l)-(m) child younger than 12... (n) parent unable to care with consent... (o) child 16 or 17 prescribed circumstance.",
    sourceUrl: "https://www.ontario.ca/laws/statute/17c14#BK94",
    consolidationPeriod: CYFSA_PERIOD,
    effectiveFrom: "2018-04-30",
    effectiveTo: null,
    verificationSourceType: "BUNDLED_CONSOLIDATION_VERBATIM",
    verifiedDate: "2026-11-03",
    legalTestSummary: "Exhaustive statutory list of protection grounds in clauses (a) to (o). Each ground requires credible, objective evidence meeting the statutory wording on a balance of probabilities.",
    practiceNote: "Note that clauses (d.1) and (d.2) (child sex trafficking) came into force on October 1, 2021 (S.O. 2021, c. 21, Sched. 3, s. 1(2))."
  },
  {
    authorityId: "CYFSA:74(3)",
    citation: "CYFSA, s. 74(3)",
    instrument: "CYFSA",
    statuteTitle: CYFSA_TITLE,
    sectionKey: "74(3)",
    heading: "Best interests of child",
    exactWording: "(3) Where a person is directed in this Part to make an order or determination in the best interests of a child, the person shall, (a) consider the child\u2019s views and wishes, given due weight in accordance with the child\u2019s age and maturity, unless they cannot be ascertained; (b) in the case of a First Nations, Inuk or M\xE9tis child, consider the importance, in recognition of the uniqueness of First Nations, Inuit and M\xE9tis cultures, heritages and traditions, of preserving the child\u2019s cultural identity and connection to community, in addition to the considerations under clauses (a) and (c); and (c) consider any other circumstance of the case that the person considers relevant, including subclauses (i) to (xi).",
    sourceUrl: "https://www.ontario.ca/laws/statute/17c14#BK94",
    consolidationPeriod: CYFSA_PERIOD,
    effectiveFrom: "2018-04-30",
    effectiveTo: null,
    verificationSourceType: "BUNDLED_CONSOLIDATION_VERBATIM",
    verifiedDate: "2026-11-03",
    legalTestSummary: "Mandates consideration of the child's views and wishes, Indigenous cultural identity and community connection, and eleven enumerated best-interests factors including continuity of care and the merits of competing care plans.",
    practiceNote: "Under subclause (c)(x), the court must weigh the risk of harm from removing or keeping the child away from a parent against the risk of remaining with or returning to the parent."
  },
  {
    authorityId: "CYFSA:78",
    citation: "CYFSA, s. 78",
    instrument: "CYFSA",
    statuteTitle: CYFSA_TITLE,
    sectionKey: "78",
    heading: "Legal representation of child",
    exactWording: "78 (1) A child may have legal representation at any stage in a proceeding under this Part.",
    sourceUrl: "https://www.ontario.ca/laws/statute/17c14#BK99",
    consolidationPeriod: CYFSA_PERIOD,
    effectiveFrom: "2018-04-30",
    effectiveTo: null,
    verificationSourceType: "BUNDLED_CONSOLIDATION_VERBATIM",
    verifiedDate: "2026-11-03",
    legalTestSummary: "Governs legal representation of a child at any stage of a Part V child protection proceeding.",
    practiceNote: "Section 78 (not s. 41) governs legal representation of a child in Part V proceedings."
  },
  {
    authorityId: "CYFSA:78(1)",
    citation: "CYFSA, s. 78(1)",
    instrument: "CYFSA",
    statuteTitle: CYFSA_TITLE,
    sectionKey: "78(1)",
    heading: "Legal representation of child",
    exactWording: "(1) A child may have legal representation at any stage in a proceeding under this Part.",
    sourceUrl: "https://www.ontario.ca/laws/statute/17c14#BK99",
    consolidationPeriod: CYFSA_PERIOD,
    effectiveFrom: "2018-04-30",
    effectiveTo: null,
    verificationSourceType: "BUNDLED_CONSOLIDATION_VERBATIM",
    verifiedDate: "2026-11-03",
    legalTestSummary: "Provides that a child may have legal representation at any stage in a Part V proceeding.",
    practiceNote: "The court must consider as soon as practicable after commencement whether legal representation is desirable to protect the child's interests (s. 78(2))."
  },
  {
    authorityId: "CYFSA:78(4)",
    citation: "CYFSA, s. 78(4)",
    instrument: "CYFSA",
    statuteTitle: CYFSA_TITLE,
    sectionKey: "78(4)",
    heading: "Legal representation of child \u2014 Criteria",
    exactWording: "(4) Where, (a) the court is of the opinion that there is a difference of views between the child and a parent or a society, and the society proposes that the child be removed from a person\u2019s care or be placed in interim or extended society care under paragraph 2 or 3 of subsection 101 (1); (b) the child is in the society\u2019s care and, (i) no parent appears before the court, or (ii) it is alleged that the child is in need of protection within the meaning of clause 74 (2) (a), (c), (f), (g) or (j); or (c) the child is not permitted to be present at the hearing, legal representation is deemed to be desirable to protect the child\u2019s interests, unless the court is satisfied, taking into account the child\u2019s views and wishes, given due weight in accordance with the child\u2019s age and maturity, that the child\u2019s interests are otherwise adequately protected.",
    sourceUrl: "https://www.ontario.ca/laws/statute/17c14#BK99",
    consolidationPeriod: CYFSA_PERIOD,
    effectiveFrom: "2018-04-30",
    effectiveTo: null,
    verificationSourceType: "BUNDLED_CONSOLIDATION_VERBATIM",
    verifiedDate: "2026-11-03",
    legalTestSummary: "Creates a statutory presumption that legal representation is desirable for the child in specified circumstances, subject to the court's satisfaction that the child's interests are otherwise adequately protected.",
    practiceNote: "Always include the statutory qualifier regarding the child's views and wishes and whether the child's interests are otherwise adequately protected."
  },
  {
    authorityId: "CYFSA:81",
    citation: "CYFSA, s. 81",
    instrument: "CYFSA",
    statuteTitle: CYFSA_TITLE,
    sectionKey: "81",
    heading: "Commencing child protection proceedings / Warrants",
    exactWording: "81 (1) A society may apply to the court to determine whether a child is in need of protection. (2) A justice of the peace may issue a warrant authorizing a child protection worker to bring a child to a place of safety... (7) A child protection worker who believes on reasonable and probable grounds that (a) a child is in need of protection; (b) the child is younger than 16; and (c) there would be a substantial risk to the child's health or safety during the time necessary to bring the matter on for a hearing under subsection 90 (1) or obtain a warrant under subsection (2), may without a warrant bring the child to a place of safety.",
    sourceUrl: "https://www.ontario.ca/laws/statute/17c14#BK103",
    consolidationPeriod: CYFSA_PERIOD,
    effectiveFrom: "2018-04-30",
    effectiveTo: null,
    verificationSourceType: "BUNDLED_CONSOLIDATION_VERBATIM",
    verifiedDate: "2026-11-03",
    legalTestSummary: "Governs commencement of child protection proceedings by application (s. 81(1)), warrants to bring a child to a place of safety (s. 81(2)), and emergency warrantless apprehension (s. 81(7)).",
    practiceNote: "Distinguish s. 81(1) (application authority) from s. 81(2) (warrant) and s. 81(7) (warrantless apprehension)."
  },
  {
    authorityId: "CYFSA:81(1)",
    citation: "CYFSA, s. 81(1)",
    instrument: "CYFSA",
    statuteTitle: CYFSA_TITLE,
    sectionKey: "81(1)",
    heading: "Application to court for child protection determination",
    exactWording: "81 (1) A society may apply to the court to determine whether a child is in need of protection.",
    sourceUrl: "https://www.ontario.ca/laws/statute/17c14#BK103",
    consolidationPeriod: CYFSA_PERIOD,
    effectiveFrom: "2018-04-30",
    effectiveTo: null,
    verificationSourceType: "BUNDLED_CONSOLIDATION_VERBATIM",
    verifiedDate: "2026-11-03",
    legalTestSummary: "Authorizes a society to initiate a protection proceeding by application to the court.",
    practiceNote: "Section 81(1) is procedural application authority, NOT an imminent-danger or warrantless removal provision (which is s. 81(7))."
  },
  {
    authorityId: "CYFSA:81(2)",
    citation: "CYFSA, s. 81(2)",
    instrument: "CYFSA",
    statuteTitle: CYFSA_TITLE,
    sectionKey: "81(2)",
    heading: "Warrant to bring child to place of safety",
    exactWording: "(2) A justice of the peace may issue a warrant authorizing a child protection worker to bring a child to a place of safety if the justice of the peace is satisfied on the basis of a child protection worker\u2019s sworn information that there are reasonable and probable grounds to believe that, (a) the child is younger than 16; (b) the child is in need of protection; and (c) a less restrictive course of action is not available or will not protect the child adequately.",
    sourceUrl: "https://www.ontario.ca/laws/statute/17c14#BK103",
    consolidationPeriod: CYFSA_PERIOD,
    effectiveFrom: "2018-04-30",
    effectiveTo: null,
    verificationSourceType: "BUNDLED_CONSOLIDATION_VERBATIM",
    verifiedDate: "2026-11-03",
    legalTestSummary: "Requires sworn information establishing reasonable and probable grounds that the child is under 16, in need of protection, and that a less restrictive course of action will not protect the child adequately.",
    practiceNote: "Request disclosure of the sworn Information to Obtain (ITO) whenever a child is removed under a s. 81(2) warrant."
  },
  {
    authorityId: "CYFSA:81(7)",
    citation: "CYFSA, s. 81(7)",
    instrument: "CYFSA",
    statuteTitle: CYFSA_TITLE,
    sectionKey: "81(7)",
    heading: "Warrantless apprehension to place of safety",
    exactWording: "(7) A child protection worker who believes on reasonable and probable grounds that, (a) a child is in need of protection; (b) the child is younger than 16; and (c) there would be a substantial risk to the child\u2019s health or safety during the time necessary to bring the matter on for a hearing under subsection 90 (1) or obtain a warrant under subsection (2), may without a warrant bring the child to a place of safety.",
    sourceUrl: "https://www.ontario.ca/laws/statute/17c14#BK103",
    consolidationPeriod: CYFSA_PERIOD,
    effectiveFrom: "2018-04-30",
    effectiveTo: null,
    verificationSourceType: "BUNDLED_CONSOLIDATION_VERBATIM",
    verifiedDate: "2026-11-03",
    legalTestSummary: "Stringent three-part test for emergency removal without a warrant: (1) reasonable and probable grounds of protection need, (2) child younger than 16, and (3) substantial risk during the time necessary for a s. 90(1) hearing or s. 81(2) warrant.",
    practiceNote: "A child protection worker cannot bypass the warrant requirement without objective grounds showing substantial risk during the time needed to seek a warrant or hearing."
  },
  {
    authorityId: "CYFSA:81(12)",
    citation: "CYFSA, s. 81(12)",
    instrument: "CYFSA",
    statuteTitle: CYFSA_TITLE,
    sectionKey: "81(12)",
    heading: "Peace officer has powers of child protection worker",
    exactWording: "(12) Subsections (2), (6), (7), (10) and (11) apply to a peace officer as if the peace officer were a child protection worker.",
    sourceUrl: "https://www.ontario.ca/laws/statute/17c14#BK103",
    consolidationPeriod: CYFSA_PERIOD,
    effectiveFrom: "2018-04-30",
    effectiveTo: null,
    verificationSourceType: "BUNDLED_CONSOLIDATION_VERBATIM",
    verifiedDate: "2026-11-03",
    legalTestSummary: "Applies subsections 81(2), (6), (7), (10), and (11) to a peace officer as if the peace officer were a child protection worker.",
    practiceNote: "Do not confuse s. 81(12) with s. 81(13) (protection from personal liability) or s. 136(5) (unaccompanied child under 16 in a public place between midnight and 6 a.m.)."
  },
  {
    authorityId: "CYFSA:81(13)",
    citation: "CYFSA, s. 81(13)",
    instrument: "CYFSA",
    statuteTitle: CYFSA_TITLE,
    sectionKey: "81(13)",
    heading: "Protection from personal liability",
    exactWording: "(13) No action shall be instituted against a peace officer or child protection worker for any act done in good faith in the execution or intended execution of that person\u2019s duty under this section or for an alleged neglect or default in the execution in good faith of that duty.",
    sourceUrl: "https://www.ontario.ca/laws/statute/17c14#BK103",
    consolidationPeriod: CYFSA_PERIOD,
    effectiveFrom: "2018-04-30",
    effectiveTo: null,
    verificationSourceType: "BUNDLED_CONSOLIDATION_VERBATIM",
    verifiedDate: "2026-11-03",
    legalTestSummary: "Protects peace officers and child protection workers from personal liability for acts or alleged neglect or default in the execution in good faith of duties under s. 81.",
    practiceNote: "Applies only to acts or alleged neglect/default in good faith."
  },
  {
    authorityId: "CYFSA:88",
    citation: "CYFSA, s. 88",
    instrument: "CYFSA",
    statuteTitle: CYFSA_TITLE,
    sectionKey: "88",
    heading: "Time in place of safety limited \u2014 5-Day Hearing Requirement",
    exactWording: "88 As soon as practicable, but in any event within five days after a child is brought to a place of safety under section 81, subclause 83 (1) (a) (ii) or subsection 136 (5), (a) the matter shall be brought before a court for a hearing under subsection 90 (1) (child protection hearing); (b) the child shall be returned to the person who last had charge of the child or, where there is an order for the child\u2019s custody that is enforceable in Ontario, to the person entitled to custody under the order; (c) if the child is the subject of an extra-provincial child protection order, the child shall be returned to the child welfare authority or other person named in the order; (d) a temporary care agreement shall be made under subsection 75 (1); or (e) an agreement shall be made under section 77 (agreements with 16 and 17 year olds).",
    sourceUrl: "https://www.ontario.ca/laws/statute/17c14#BK111",
    consolidationPeriod: CYFSA_PERIOD,
    effectiveFrom: "2018-04-30",
    effectiveTo: null,
    verificationSourceType: "BUNDLED_CONSOLIDATION_VERBATIM",
    verifiedDate: "2026-11-03",
    legalTestSummary: "The mandatory 5-day post-apprehension rule. Within five days after a child is brought to a place of safety, the matter must be brought before a court for a s. 90(1) hearing, the child returned, or a valid agreement made.",
    practiceNote: "Section 88 has no numbered subsections (only clauses (a) to (e)). It is the sole statutory source of the 5-day post-apprehension hearing rule; s. 94 governs adjournments."
  },
  {
    authorityId: "CYFSA:90(1)",
    citation: "CYFSA, s. 90(1)",
    instrument: "CYFSA",
    statuteTitle: CYFSA_TITLE,
    sectionKey: "90(1)",
    heading: "Child protection hearing",
    exactWording: "90 (1) Where an application is made under subsection 81 (1) or a matter is brought before the court to determine whether the child is in need of protection, the court shall hold a hearing to determine the issue and make an order under section 101.",
    sourceUrl: "https://www.ontario.ca/laws/statute/17c14#BK113",
    consolidationPeriod: CYFSA_PERIOD,
    effectiveFrom: "2018-04-30",
    effectiveTo: null,
    verificationSourceType: "BUNDLED_CONSOLIDATION_VERBATIM",
    verifiedDate: "2026-11-03",
    legalTestSummary: "Requires the court to hold a hearing to determine whether the child is in need of protection and make an order under s. 101.",
    practiceNote: "Before determining whether the child is in need of protection, the court must also make the mandatory determinations in s. 90(2), including whether the child is a First Nations, Inuk, or M\xE9tis child."
  },
  {
    authorityId: "CYFSA:94(1)",
    citation: "CYFSA, s. 94(1)",
    instrument: "CYFSA",
    statuteTitle: CYFSA_TITLE,
    sectionKey: "94(1)",
    heading: "Adjournment limit \u2014 30-day maximum",
    exactWording: "94 (1) The court shall not adjourn a hearing for more than 30 days, (a) unless all the parties present and the person who will be caring for the child during the adjournment consent; or (b) if the court is aware that a party who is not present at the hearing objects to the longer adjournment.",
    sourceUrl: "https://www.ontario.ca/laws/statute/17c14#BK117",
    consolidationPeriod: CYFSA_PERIOD,
    effectiveFrom: "2018-04-30",
    effectiveTo: null,
    verificationSourceType: "BUNDLED_CONSOLIDATION_VERBATIM",
    verifiedDate: "2026-11-03",
    legalTestSummary: "Prohibits court adjournments exceeding 30 days unless all parties present and the caregiver during the adjournment consent, and no absent party is known to object.",
    practiceNote: "Distinct from s. 88 (the 5-day post-apprehension hearing rule)."
  },
  {
    authorityId: "CYFSA:94(2)",
    citation: "CYFSA, s. 94(2)",
    instrument: "CYFSA",
    statuteTitle: CYFSA_TITLE,
    sectionKey: "94(2)",
    heading: "Temporary care and custody order during adjournment",
    exactWording: "94 (2) Where a hearing is adjourned, the court shall make a temporary order for care and custody providing that the child, (a) remain in or be returned to the care and custody of the person who had charge of the child immediately before intervention under this Part; (b) remain in or be returned to the care and custody of the person referred to in clause (a), subject to the society\u2019s supervision and on such reasonable terms and conditions as the court considers appropriate; (c) be placed in the care and custody of a person other than the person referred to in clause (a), with the consent of that other person, subject to the society\u2019s supervision and on such reasonable terms and conditions as the court considers appropriate; or (d) remain or be placed in the care and custody of the society, but not be placed in a place of temporary detention, of open or of secure custody.",
    sourceUrl: "https://www.ontario.ca/laws/statute/17c14#BK117",
    consolidationPeriod: CYFSA_PERIOD,
    effectiveFrom: "2018-04-30",
    effectiveTo: null,
    verificationSourceType: "BUNDLED_CONSOLIDATION_VERBATIM",
    verifiedDate: "2026-11-03",
    legalTestSummary: "Mandates that upon adjournment the court make one of four progressive temporary care and custody orders, subject to the strict threshold in s. 94(4).",
    practiceNote: "Under s. 94(4), the court cannot make a temporary removal order under clause (c) or (d) unless satisfied that the child cannot be protected adequately under clause (a) or (b)."
  },
  {
    authorityId: "CYFSA:94(4)",
    citation: "CYFSA, s. 94(4)",
    instrument: "CYFSA",
    statuteTitle: CYFSA_TITLE,
    sectionKey: "94(4)",
    heading: "Criteria for temporary removal during adjournment",
    exactWording: "(4) The court shall not make an order under clause (2) (c) or (d) unless the court is satisfied that there are reasonable grounds to believe that there is a risk that the child is likely to suffer harm and that the child cannot be protected adequately by an order under clause (2) (a) or (b).",
    sourceUrl: "https://www.ontario.ca/laws/statute/17c14#BK117",
    consolidationPeriod: CYFSA_PERIOD,
    effectiveFrom: "2018-04-30",
    effectiveTo: null,
    verificationSourceType: "BUNDLED_CONSOLIDATION_VERBATIM",
    verifiedDate: "2026-11-03",
    legalTestSummary: "Establishes the two-part statutory test for temporary removal at a temporary care and custody hearing: (1) reasonable grounds to believe there is a risk the child is likely to suffer harm, AND (2) the child cannot be protected adequately with the parent under clause (2)(a) or (b).",
    practiceNote: "The burden rests on the Society to prove both branches on credible and trustworthy evidence (s. 94(10))."
  },
  {
    authorityId: "CYFSA:94(6)",
    citation: "CYFSA, s. 94(6)",
    instrument: "CYFSA",
    statuteTitle: CYFSA_TITLE,
    sectionKey: "94(6)",
    heading: "Terms and conditions in temporary supervision order",
    exactWording: "(6) A temporary order for care and custody of a child under clause (2) (b) or (c) may impose, (a) reasonable terms and conditions relating to the child\u2019s care and supervision; (b) reasonable terms and conditions on the child\u2019s parent, the person who will have care and custody of the child under the order, the child and any other person, other than a foster parent, who is putting forward a plan or who would participate in a plan for care and custody of or access to the child; and (c) reasonable terms and conditions on the society that will supervise the placement, but shall not require the society to provide financial assistance or to purchase any goods or services.",
    sourceUrl: "https://www.ontario.ca/laws/statute/17c14#BK117",
    consolidationPeriod: CYFSA_PERIOD,
    effectiveFrom: "2018-04-30",
    effectiveTo: null,
    verificationSourceType: "BUNDLED_CONSOLIDATION_VERBATIM",
    verifiedDate: "2026-11-03",
    legalTestSummary: "Permits reasonable terms and conditions on temporary supervision orders, while expressly prohibiting terms that require the society to provide financial assistance or purchase goods or services (s. 94(6)(c)).",
    practiceNote: "Do not assert that a court can compel CAS under s. 94(6) to fund or purchase goods or services."
  },
  {
    authorityId: "CYFSA:100",
    citation: "CYFSA, s. 100",
    instrument: "CYFSA",
    statuteTitle: CYFSA_TITLE,
    sectionKey: "100",
    heading: "Society's plan for child",
    exactWording: "100 The court shall, before making an order under section 101, 102, 114 or 116, obtain and consider a plan for the child\u2019s care prepared in writing by the society and including, (a) a description of the services to be provided to remedy the condition or situation on the basis of which the child was found to be in need of protection; (b) a statement of the criteria by which the society will determine when its care or supervision is no longer required; (c) an estimate of the time required to achieve the purpose of the society\u2019s intervention; (d) where the society proposes to remove or has removed the child from a person\u2019s care, (i) an explanation of why the child cannot be adequately protected while in the person\u2019s care, and a description of any past efforts to do so, and (ii) a statement of what efforts, if any, are planned to maintain the child\u2019s contact with the person; (e) where the society proposes to remove or has removed the child from a person\u2019s care permanently, a description of the arrangements made or being made for the child\u2019s long-term stable placement; and (f) a description of the arrangements made or being made to recognize the importance of the child\u2019s culture and to preserve the child\u2019s heritage, traditions and cultural identity.",
    sourceUrl: "https://www.ontario.ca/laws/statute/17c14#BK123",
    consolidationPeriod: CYFSA_PERIOD,
    effectiveFrom: "2018-04-30",
    effectiveTo: null,
    verificationSourceType: "BUNDLED_CONSOLIDATION_VERBATIM",
    verifiedDate: "2026-11-03",
    legalTestSummary: "Mandates that before making a disposition or status review order, the court must obtain and consider a written Society Plan of Care addressing all elements in clauses (a) to (f), including remedial services, exit criteria, and past efforts to protect the child in the parent's care.",
    practiceNote: "Section 100 (not s. 51) governs the Society's Plan of Care in child protection proceedings."
  },
  {
    authorityId: "CYFSA:101(1)",
    citation: "CYFSA, s. 101(1)",
    instrument: "CYFSA",
    statuteTitle: CYFSA_TITLE,
    sectionKey: "101(1)",
    heading: "Order where child in need of protection",
    exactWording: "(1) Where the court finds that a child is in need of protection and is satisfied that intervention through a court order is necessary to protect the child in the future, the court shall make one of the following orders or an order under section 102, in the child\u2019s best interests:",
    sourceUrl: "https://www.ontario.ca/laws/statute/17c14#BK124",
    consolidationPeriod: CYFSA_PERIOD,
    effectiveFrom: "2018-04-30",
    effectiveTo: null,
    verificationSourceType: "BUNDLED_CONSOLIDATION_VERBATIM",
    verifiedDate: "2026-11-03",
    legalTestSummary: "Requires both a finding that the child is in need of protection AND satisfaction that a court order is necessary to protect the child in the future before making a disposition order under paragraphs 1 to 4.",
    practiceNote: "If the court finds protection need but is not satisfied a court order is necessary to protect the child in the future, s. 101(8) requires returning the child."
  },
  {
    authorityId: "CYFSA:101(1), para. 1",
    citation: "CYFSA, s. 101(1), para. 1",
    instrument: "CYFSA",
    statuteTitle: CYFSA_TITLE,
    sectionKey: "101(1), para. 1",
    heading: "Supervision order",
    exactWording: "1. That the child be placed in the care and custody of a parent or another person, subject to the supervision of the society, for a specified period of at least three months and not more than 12 months.",
    sourceUrl: "https://www.ontario.ca/laws/statute/17c14#BK124",
    consolidationPeriod: CYFSA_PERIOD,
    effectiveFrom: "2018-04-30",
    effectiveTo: null,
    verificationSourceType: "BUNDLED_CONSOLIDATION_VERBATIM",
    verifiedDate: "2026-11-03",
    legalTestSummary: "Provides for a supervision order placing the child in the care and custody of a parent or another person subject to society supervision for 3 to 12 months.",
    practiceNote: "Supervision orders are made under s. 101(1), para. 1 (not s. 102, which governs custody orders)."
  },
  {
    authorityId: "CYFSA:101(2)",
    citation: "CYFSA, s. 101(2)",
    instrument: "CYFSA",
    statuteTitle: CYFSA_TITLE,
    sectionKey: "101(2)",
    heading: "Court to inquire into pre-intervention assistance efforts",
    exactWording: "(2) In determining which order to make under subsection (1) or section 102, the court shall ask the parties what efforts the society or another person or entity has made to assist the child before intervention under this Part.",
    sourceUrl: "https://www.ontario.ca/laws/statute/17c14#BK124",
    consolidationPeriod: CYFSA_PERIOD,
    effectiveFrom: "2018-04-30",
    effectiveTo: null,
    verificationSourceType: "BUNDLED_CONSOLIDATION_VERBATIM",
    verifiedDate: "2026-11-03",
    legalTestSummary: "Imposes a mandatory judicial duty to ask the parties what efforts the society or another person or entity made to assist the child before Part V intervention.",
    practiceNote: "Directly supports questioning whether the Society made pre-intervention assistance referrals or offered community services before seeking removal."
  },
  {
    authorityId: "CYFSA:101(3)",
    citation: "CYFSA, s. 101(3)",
    instrument: "CYFSA",
    statuteTitle: CYFSA_TITLE,
    sectionKey: "101(3)",
    heading: "Less disruptive alternatives preferred",
    exactWording: "(3) The court shall not make an order removing the child from the care of the person who had charge of the child immediately before intervention under this Part unless the court is satisfied that alternatives that are less disruptive to the child, including non-residential care and the assistance referred to in subsection (2), would be inadequate to protect the child.",
    sourceUrl: "https://www.ontario.ca/laws/statute/17c14#BK124",
    consolidationPeriod: CYFSA_PERIOD,
    effectiveFrom: "2018-04-30",
    effectiveTo: null,
    verificationSourceType: "BUNDLED_CONSOLIDATION_VERBATIM",
    verifiedDate: "2026-11-03",
    legalTestSummary: "Prohibits a court order removing a child unless the court is satisfied that less disruptive alternatives, including non-residential care and the assistance referred to in s. 101(2), would be inadequate to protect the child.",
    practiceNote: "Note the exact statutory standard: 'would be inadequate to protect the child' (not that every alternative must first have been tried and failed)."
  },
  {
    authorityId: "CYFSA:101(4)",
    citation: "CYFSA, s. 101(4)",
    instrument: "CYFSA",
    statuteTitle: CYFSA_TITLE,
    sectionKey: "101(4)",
    heading: "Community placement to be considered",
    exactWording: "(4) Where the court decides that it is necessary to remove the child from the care of the person who had charge of the child immediately before intervention under this Part, the court shall, before making an order under paragraph 2 or 3 of subsection (1), consider whether it is possible to place the child with a relative, neighbour or other member of the child\u2019s community or extended family under paragraph 1 of subsection (1) with the consent of the relative or other person.",
    sourceUrl: "https://www.ontario.ca/laws/statute/17c14#BK124",
    consolidationPeriod: CYFSA_PERIOD,
    effectiveFrom: "2018-04-30",
    effectiveTo: null,
    verificationSourceType: "BUNDLED_CONSOLIDATION_VERBATIM",
    verifiedDate: "2026-11-03",
    legalTestSummary: "Requires the court to consider placement with a consenting relative, neighbour, or member of the child's community or extended family under a supervision order before ordering interim or extended society care.",
    practiceNote: "Applies to all children on disposition; s. 101(5) adds specific mandatory placement priorities for First Nations, Inuk, or M\xE9tis children."
  },
  {
    authorityId: "CYFSA:101(5)",
    citation: "CYFSA, s. 101(5)",
    instrument: "CYFSA",
    statuteTitle: CYFSA_TITLE,
    sectionKey: "101(5)",
    heading: "First Nations, Inuk or M\xE9tis child placement priority",
    exactWording: "(5) Where the child referred to in subsection (4) is a First Nations, Inuk or M\xE9tis child, unless there is a substantial reason for placing the child elsewhere, the court shall place the child with a member of the child\u2019s extended family if it is possible or, if it is not possible, (a) in the case of a First Nations child, another First Nations family; (b) in the case of an Inuk child, another Inuit family; or (c) in the case of a M\xE9tis child, another M\xE9tis family.",
    sourceUrl: "https://www.ontario.ca/laws/statute/17c14#BK124",
    consolidationPeriod: CYFSA_PERIOD,
    effectiveFrom: "2018-04-30",
    effectiveTo: null,
    verificationSourceType: "BUNDLED_CONSOLIDATION_VERBATIM",
    verifiedDate: "2026-11-03",
    legalTestSummary: "Mandates placing a First Nations, Inuk, or M\xE9tis child with extended family or an Indigenous family unless there is a substantial reason for placing the child elsewhere.",
    practiceNote: "Read together with Bill C-92, s. 16(1) placement priority hierarchy."
  },
  {
    authorityId: "CYFSA:101(7)",
    citation: "CYFSA, s. 101(7)",
    instrument: "CYFSA",
    statuteTitle: CYFSA_TITLE,
    sectionKey: "101(7)",
    heading: "Terms and conditions of supervision order",
    exactWording: "(7) If the court makes a supervision order under paragraph 1 of subsection (1), the court may impose, (a) reasonable terms and conditions relating to the child\u2019s care and supervision; (b) reasonable terms and conditions on, (i) the child\u2019s parent, (ii) the person who will have care and custody of the child under the order, (iii) the child, and (iv) any other person, other than a foster parent, who is putting forward or would participate in a plan for the care and custody of or access to the child; and (c) reasonable terms and conditions on the society that will supervise the placement, but shall not require the society to provide financial assistance or purchase any goods or services.",
    sourceUrl: "https://www.ontario.ca/laws/statute/17c14#BK124",
    consolidationPeriod: CYFSA_PERIOD,
    effectiveFrom: "2018-04-30",
    effectiveTo: null,
    verificationSourceType: "BUNDLED_CONSOLIDATION_VERBATIM",
    verifiedDate: "2026-11-03",
    legalTestSummary: "Permits reasonable supervision terms on the parent, caregiver, child, and society, while clause (c) expressly prohibits requiring the society to provide financial assistance or purchase any goods or services.",
    practiceNote: "Critical statutory boundary: while the court can impose reasonable supervision terms on the Society, it cannot order the Society to fund or purchase goods or services under s. 101(7)(c)."
  },
  {
    authorityId: "CYFSA:102(1)",
    citation: "CYFSA, s. 102(1)",
    instrument: "CYFSA",
    statuteTitle: CYFSA_TITLE,
    sectionKey: "102(1)",
    heading: "Custody order",
    exactWording: "(1) Subject to subsection (6), if a court finds that an order under this section instead of an order under subsection 101 (1) would be in a child\u2019s best interests, the court may make an order granting custody of the child to one or more persons, other than a foster parent of the child, with the consent of the person or persons. 2017, c. 14, Sched. 1, s. 102 (1).",
    sourceUrl: "https://www.ontario.ca/laws/statute/17c14#BK125",
    consolidationPeriod: CYFSA_PERIOD,
    effectiveFrom: "2018-04-30",
    effectiveTo: null,
    verificationSourceType: "BUNDLED_CONSOLIDATION_VERBATIM",
    verifiedDate: "2026-11-03",
    legalTestSummary: "Authorizes a custody order in favour of one or more consenting persons (other than a foster parent) instead of an order under s. 101(1), deemed to be a parenting/contact order under CLRA s. 28.",
    practiceNote: "Section 102 has only subsections (1) through (7); it is a custody order, not a supervision order."
  },
  {
    authorityId: "CYFSA:104(1)",
    citation: "CYFSA, s. 104(1)",
    instrument: "CYFSA",
    statuteTitle: CYFSA_TITLE,
    sectionKey: "104(1)",
    heading: "Access order",
    exactWording: "(1) The court may, in the child\u2019s best interests, (a) when making an order under this Part; or (b) upon an application under subsection (2), make, vary or terminate an order respecting a person\u2019s access to the child or the child\u2019s access to a person, and may impose such terms and conditions on the order as the court considers appropriate.",
    sourceUrl: "https://www.ontario.ca/laws/statute/17c14#BK127",
    consolidationPeriod: CYFSA_PERIOD,
    effectiveFrom: "2018-04-30",
    effectiveTo: null,
    verificationSourceType: "BUNDLED_CONSOLIDATION_VERBATIM",
    verifiedDate: "2026-11-03",
    legalTestSummary: "Authorizes the court to make, vary, or terminate access orders in the child's best interests, subject to the mandatory access rules in s. 105.",
    practiceNote: "Under s. 105(1), when a child is removed under s. 101(1), para. 1 or 2, the court shall make an order for access by the person who had charge unless satisfied continued contact would not be in the child's best interests."
  },
  {
    authorityId: "CYFSA:109(2)",
    citation: "CYFSA, s. 109(2)",
    instrument: "CYFSA",
    statuteTitle: CYFSA_TITLE,
    sectionKey: "109(2)",
    heading: "Residential placement obligations",
    exactWording: "(2) The society having care of a child shall choose a residential placement for the child that, (a) represents the least restrictive alternative for the child; (b) where possible, respects the child\u2019s race, ancestry, place of origin, colour, ethnic origin, citizenship, family diversity, creed, sex, sexual orientation, gender identity and gender expression; (c) where possible, respects the child\u2019s cultural and linguistic heritage; (d) in the case of a First Nations, Inuk or M\xE9tis child, is with, if possible, a member of the child\u2019s extended family or, if that is not possible, (i) in the case of a First Nations child, another First Nations family, (ii) in the case of an Inuk child, another Inuit family, or (iii) in the case of a M\xE9tis child, another M\xE9tis family; and (e) takes into account the child\u2019s views and wishes, given due weight in accordance with the child\u2019s age and maturity, and the views and wishes of any parent who is entitled to access to the child.",
    sourceUrl: "https://www.ontario.ca/laws/statute/17c14#BK133",
    consolidationPeriod: CYFSA_PERIOD,
    effectiveFrom: "2018-04-30",
    effectiveTo: null,
    verificationSourceType: "BUNDLED_CONSOLIDATION_VERBATIM",
    verifiedDate: "2026-11-03",
    legalTestSummary: "Requires a society choosing a residential placement for a child in interim or extended care to choose the least restrictive alternative and take into account the views and wishes of the child and any parent entitled to access.",
    practiceNote: "Also see s. 109(5)(b), requiring the wishes of any parent entitled to access to be taken into account in the society's major decisions concerning the child."
  },
  {
    authorityId: "CYFSA:109(2)(d)",
    citation: "CYFSA, s. 109(2)(d)",
    instrument: "CYFSA",
    statuteTitle: CYFSA_TITLE,
    sectionKey: "109(2)(d)",
    heading: "Residential placement \u2014 First Nations, Inuk or M\xE9tis child",
    exactWording: "(d) in the case of a First Nations, Inuk or M\xE9tis child, is with, if possible, a member of the child\u2019s extended family or, if that is not possible, (i) in the case of a First Nations child, another First Nations family, (ii) in the case of an Inuk child, another Inuit family, or (iii) in the case of a M\xE9tis child, another M\xE9tis family; and",
    sourceUrl: "https://www.ontario.ca/laws/statute/17c14#BK133",
    consolidationPeriod: CYFSA_PERIOD,
    effectiveFrom: "2018-04-30",
    effectiveTo: null,
    verificationSourceType: "BUNDLED_CONSOLIDATION_VERBATIM",
    verifiedDate: "2026-11-03",
    legalTestSummary: "Requires a society choosing a residential placement for a First Nations, Inuk, or M\xE9tis child to place the child with a member of the child's extended family if possible, or otherwise with an Indigenous family.",
    practiceNote: "Operates alongside s. 101(5) and Bill C-92, s. 16(1)."
  },
  {
    authorityId: "CYFSA:115(2)",
    citation: "CYFSA, s. 115(2)",
    instrument: "CYFSA",
    statuteTitle: CYFSA_TITLE,
    sectionKey: "115(2)",
    heading: "Society to seek status review",
    exactWording: "(2) The society that has or had care, custody or supervision of the child, (a) may apply to the court at any time, subject to subsection (9), for a review of the child\u2019s status; (b) shall apply to the court for a review of the child\u2019s status before the order expires if the order is for society supervision, unless the expiry is by reason of section 123; and (c) shall apply to the court for a review of the child\u2019s status within five days after removing the child, if the society has removed the child, (i) from the care of a person with whom the child was placed under an order for society supervision described in clause 116 (1) (a), or (ii) from the custody of a person who had custody of the child under a custody order described in clause 116 (1) (b).",
    sourceUrl: "https://www.ontario.ca/laws/statute/17c14#BK141",
    consolidationPeriod: CYFSA_PERIOD,
    effectiveFrom: "2018-04-30",
    effectiveTo: null,
    verificationSourceType: "BUNDLED_CONSOLIDATION_VERBATIM",
    verifiedDate: "2026-11-03",
    legalTestSummary: "Mandates status review applications before expiry of supervision orders and within five days after removing a child from a person's care under a s. 116(1)(a) supervision or s. 116(1)(b) custody order (parallel to s. 113(2) for s. 101(1) orders).",
    practiceNote: "Check both s. 113(2) (status review of s. 101(1) orders) and s. 115(2) (status review of s. 116(1) orders)."
  },
  {
    authorityId: "CYFSA:121(1)",
    citation: "CYFSA, s. 121(1)",
    instrument: "CYFSA",
    statuteTitle: CYFSA_TITLE,
    sectionKey: "121(1)",
    heading: "Appeal from Part V order",
    exactWording: "(1) An appeal from a court\u2019s order under this Part may be made by, (a) the child, if the child is entitled to participate in the proceeding under subsection 79 (6) (child\u2019s participation); (b) any parent of the child; (c) the person who had charge of the child immediately before intervention under this Part; (d) a Director or local director; or (e) in the case of a First Nations, Inuk or M\xE9tis child, a person described in clause (a), (b), (c) or (d) or a representative chosen by each of the child\u2019s bands and First Nations, Inuit or M\xE9tis communities. 2017, c. 14, Sched. 1, s. 121 (1); 2020, c. 25, Sched. 2, s. 5 (1).",
    sourceUrl: "https://www.ontario.ca/laws/statute/17c14#BK147",
    consolidationPeriod: CYFSA_PERIOD,
    effectiveFrom: "2018-04-30",
    effectiveTo: null,
    verificationSourceType: "BUNDLED_CONSOLIDATION_VERBATIM",
    verifiedDate: "2026-11-03",
    legalTestSummary: "Establishes the statutory right to appeal a Part V order (other than a s. 98 assessment order).",
    practiceNote: "See s. 121(2.1) for the appellate court forum and s. 121(3) for the automatic 10-day stay."
  },
  {
    authorityId: "CYFSA:121(2.1)",
    citation: "CYFSA, s. 121(2.1)",
    instrument: "CYFSA",
    statuteTitle: CYFSA_TITLE,
    sectionKey: "121(2.1)",
    heading: "Appeal court forum",
    exactWording: "(2.1) The appeal shall be made to, (a) the Superior Court of Justice, if the order was made at the Ontario Court of Justice; or (b) the Divisional Court, if the order was made at the Family Court of the Superior Court of Justice. 2020, c. 25, Sched. 2, s. 5 (2).",
    sourceUrl: "https://www.ontario.ca/laws/statute/17c14#BK147",
    consolidationPeriod: "In force March 1, 2021 to Present (S.O. 2020, c. 25, Sched. 2, s. 5(2))",
    effectiveFrom: "2021-03-01",
    effectiveTo: null,
    verificationSourceType: "BUNDLED_CONSOLIDATION_VERBATIM",
    verifiedDate: "2026-11-03",
    legalTestSummary: "Specifies whether an appeal under s. 121 lies to the Superior Court of Justice or the Divisional Court.",
    practiceNote: "Added by the Moving Ontario Family Law Forward Act, 2020, effective March 1, 2021 (see transition rule in s. 121(9))."
  },
  {
    authorityId: "CYFSA:121(3)",
    citation: "CYFSA, s. 121(3)",
    instrument: "CYFSA",
    statuteTitle: CYFSA_TITLE,
    sectionKey: "121(3)",
    heading: "Care and custody pending appeal \u2014 10-day stay",
    exactWording: "(3) Where a decision regarding the care and custody of a child is appealed under subsection (1), execution of the decision shall be stayed for the 10 days immediately following service of the notice of appeal on the court that made the decision, and where the child is in the society\u2019s care and custody at the time the decision is made, the child shall remain in the care and custody of the society until, (a) the 10-day period of the stay has expired; or (b) an order is made under subsection (4), whichever is earlier. 2017, c. 14, Sched. 1, s. 121 (3).",
    sourceUrl: "https://www.ontario.ca/laws/statute/17c14#BK147",
    consolidationPeriod: CYFSA_PERIOD,
    effectiveFrom: "2018-04-30",
    effectiveTo: null,
    verificationSourceType: "BUNDLED_CONSOLIDATION_VERBATIM",
    verifiedDate: "2026-11-03",
    legalTestSummary: "Provides an automatic 10-day stay of execution of a care and custody decision upon service of the notice of appeal on the court that made the decision.",
    practiceNote: "Within the 10-day stay, a party may move under s. 121(4) for a temporary care and custody order pending final disposition of the appeal."
  },
  {
    authorityId: "CYFSA:123",
    citation: "CYFSA, s. 123",
    instrument: "CYFSA",
    statuteTitle: CYFSA_TITLE,
    sectionKey: "123",
    heading: "Expiry of orders",
    exactWording: "123 An order under this Part expires when the child who is the subject of the order, (a) turns 18; or (b) marries, whichever comes first.",
    sourceUrl: "https://www.ontario.ca/laws/statute/17c14#BK150",
    consolidationPeriod: CYFSA_PERIOD,
    effectiveFrom: "2018-04-30",
    effectiveTo: null,
    verificationSourceType: "BUNDLED_CONSOLIDATION_VERBATIM",
    verifiedDate: "2026-11-03",
    legalTestSummary: "Provides that any Part V order expires when the child turns 18 or marries, whichever comes first.",
    practiceNote: "After expiry at age 18, continued care and support agreements are governed by s. 124."
  },
  {
    authorityId: "CYFSA:125(1)",
    citation: "CYFSA, s. 125(1)",
    instrument: "CYFSA",
    statuteTitle: CYFSA_TITLE,
    sectionKey: "125(1)",
    heading: "Duty to report child in need of protection",
    exactWording: "125 (1) Despite the provisions of any other Act, if a person, including a person who performs professional or official duties with respect to children, has reasonable grounds to suspect one of the following, the person shall immediately report the suspicion and the information on which it is based to a society...",
    sourceUrl: "https://www.ontario.ca/laws/statute/17c14#BK152",
    consolidationPeriod: CYFSA_PERIOD,
    effectiveFrom: "2018-04-30",
    effectiveTo: null,
    verificationSourceType: "BUNDLED_CONSOLIDATION_VERBATIM",
    verifiedDate: "2026-11-03",
    legalTestSummary: "Establishes the 'reasonable grounds to suspect' reporting threshold for reporting suspected harm or risk to a Society.",
    practiceNote: "Section 125(1) is a reporting threshold, NOT an evidentiary standard for finding a child in need of protection under s. 74(2) or for warrantless removal under s. 81(7)."
  },
  {
    authorityId: "CYFSA:136(5)",
    citation: "CYFSA, s. 136(5)",
    instrument: "CYFSA",
    statuteTitle: CYFSA_TITLE,
    sectionKey: "136(5)",
    heading: "Police may bring child home or to place of safety",
    exactWording: "(5) Where a child who is actually or apparently younger than 16 is in a place to which the public has access between the hours of midnight and 6 a.m. and is not accompanied by a person described in clause (4) (b), a peace officer may bring the child to a place of safety without a warrant and proceed as if the child had been brought to a place of safety under subsection 84 (1).",
    sourceUrl: "https://www.ontario.ca/laws/statute/17c14#BK165",
    consolidationPeriod: CYFSA_PERIOD,
    effectiveFrom: "2018-04-30",
    effectiveTo: null,
    verificationSourceType: "BUNDLED_CONSOLIDATION_VERBATIM",
    verifiedDate: "2026-11-03",
    legalTestSummary: "Authorizes a peace officer to bring an unaccompanied child younger than 16 in a public place between midnight and 6 a.m. to a place of safety without a warrant.",
    practiceNote: "Triggers the s. 88 five-day limit if the child is kept in a place of safety."
  },
  {
    authorityId: "CYFSA:312(1)",
    citation: "CYFSA, s. 312(1)",
    instrument: "CYFSA",
    statuteTitle: CYFSA_TITLE,
    sectionKey: "312(1)",
    heading: "Right of access to record of personal information",
    exactWording: "(1) An individual has a right of access to a record of personal information about the individual that is in a service provider\u2019s custody or control and that relates to the provision of a service to the individual unless, (a) the record or the information in the record is subject to a legal privilege that restricts its disclosure to the individual; (b) another Act, an Act of Canada or a court order prohibits its disclosure to the individual; (c) the information in the record was collected or created primarily in anticipation of or for use in a proceeding, and the proceeding, together with all appeals or processes resulting from it, has not been concluded; or (d) granting the access could reasonably be expected to, (i) result in a risk of serious harm to the individual or another individual, (ii) lead to the identification of an individual who was required by law to provide information in the record to the service provider, or (iii) lead to the identification of an individual who provided information in the record to the service provider explicitly or implicitly in confidence if the service provider considers it appropriate in the circumstances that the identity of the individual be kept confidential.",
    sourceUrl: "https://www.ontario.ca/laws/statute/17c14#BK361",
    consolidationPeriod: "In force January 1, 2020 to Present (Part X)",
    effectiveFrom: "2020-01-01",
    effectiveTo: null,
    verificationSourceType: "BUNDLED_CONSOLIDATION_VERBATIM",
    verifiedDate: "2026-11-03",
    legalTestSummary: "Establishes an individual's Part X right of access to a record of personal information in a service provider's custody or control, subject to enumerated exceptions and severability under s. 312(2).",
    practiceNote: "Section 312(1) (not s. 292, which governs disclosure without consent) is the statutory right of access to personal information records under Part X."
  },
  {
    authorityId: "CYFSA:14",
    citation: "CYFSA, s. 14",
    instrument: "CYFSA",
    statuteTitle: CYFSA_TITLE,
    sectionKey: "14",
    heading: "Parental consent, etc. \u2014 Rights retained by parent of child in care",
    exactWording: "14 Subject to subsection 94 (7) and sections 110 and 111 (custody during adjournment, interim and extended society care), the parent of a child in care retains any right that the parent may have, (a) to direct the child\u2019s or young person\u2019s education and upbringing, in accordance with the child\u2019s or young person\u2019s creed, community identity and cultural identity; and (b) to consent to treatment on behalf of an incapable child or young person, if the parent is the child\u2019s or young person\u2019s substitute decision-maker in accordance with section 20 of the Health Care Consent Act, 1996.",
    sourceUrl: "https://www.ontario.ca/laws/statute/17c14#BK19",
    consolidationPeriod: CYFSA_PERIOD,
    effectiveFrom: "2018-04-30",
    effectiveTo: null,
    verificationSourceType: "BUNDLED_CONSOLIDATION_VERBATIM",
    verifiedDate: "2026-11-03",
    legalTestSummary: "Preserves a parent's rights to direct the child's education and upbringing (in accordance with creed, community identity, and cultural identity) and to consent to treatment under the HCCA 1996 when a child is in care, subject to s. 94(7) and ss. 110\u2013111.",
    practiceNote: "Applies particularly when a child is in care under a voluntary Temporary Care Agreement (s. 75) unless treatment consent authority was transferred under s. 75(9)."
  },
  {
    authorityId: "CYFSA:15(2)",
    citation: "CYFSA, s. 15(2)",
    instrument: "CYFSA",
    statuteTitle: CYFSA_TITLE,
    sectionKey: "15(2)",
    heading: "Children, young persons and parents to be heard and represented",
    exactWording: "(2) Service providers shall ensure that children and young persons and their parents have an opportunity to be heard and represented when decisions affecting their interests are made and to be heard when they have concerns about the services they are receiving.",
    sourceUrl: "https://www.ontario.ca/laws/statute/17c14#BK21",
    consolidationPeriod: CYFSA_PERIOD,
    effectiveFrom: "2018-04-30",
    effectiveTo: null,
    verificationSourceType: "BUNDLED_CONSOLIDATION_VERBATIM",
    verifiedDate: "2026-11-03",
    legalTestSummary: "Mandates that service providers ensure children, young persons, and their parents have an opportunity to be heard and represented when decisions affecting their interests are made, and to be heard regarding concerns about services received (subject to the s. 15(3) good-cause exception).",
    practiceNote: "Failure by a society to comply with s. 15(2) is an enumerated ground for direct review by the Child and Family Services Review Board (CFSRB) under CYFSA s. 120(4), para. 4 (unless the matter is before or decided by the court per s. 120(8))."
  },
  {
    authorityId: "CYFSA:15(4)",
    citation: "CYFSA, s. 15(4)",
    instrument: "CYFSA",
    statuteTitle: CYFSA_TITLE,
    sectionKey: "15(4)",
    heading: "Criteria and safeguards re decisions",
    exactWording: "(4) Service providers shall ensure that decisions affecting the interests and rights of children and young persons and their parents are made according to clear, consistent criteria and are subject to appropriate procedural safeguards.",
    sourceUrl: "https://www.ontario.ca/laws/statute/17c14#BK21",
    consolidationPeriod: CYFSA_PERIOD,
    effectiveFrom: "2018-04-30",
    effectiveTo: null,
    verificationSourceType: "BUNDLED_CONSOLIDATION_VERBATIM",
    verifiedDate: "2026-11-03",
    legalTestSummary: "Requires service providers to ensure decisions affecting the interests and rights of children, young persons, and their parents are made according to clear, consistent criteria and procedural safeguards.",
    practiceNote: "Supports scrutiny of arbitrary or undocumented service and access decisions."
  },
  {
    authorityId: "CYFSA:35(2)",
    citation: "CYFSA, s. 35(2)",
    instrument: "CYFSA",
    statuteTitle: CYFSA_TITLE,
    sectionKey: "35(2)",
    heading: "Society duty to provide prescribed standard of services",
    exactWording: "(2) A society shall, (a) provide the prescribed standard of services in its performance of its functions; and (b) follow the prescribed procedures and practices.",
    sourceUrl: "https://www.ontario.ca/laws/statute/17c14#BK46",
    consolidationPeriod: CYFSA_PERIOD,
    effectiveFrom: "2018-04-30",
    effectiveTo: null,
    verificationSourceType: "BUNDLED_CONSOLIDATION_VERBATIM",
    verifiedDate: "2026-11-03",
    legalTestSummary: "Statutorily obligates every children's aid society to provide the prescribed standard of services and follow prescribed procedures and practices.",
    practiceNote: "Links statutory CAS functions under s. 35(1) to the prescribed standards and practices under O. Reg. 156/18 and the Ontario Child Protection Standards (2016)."
  },
  {
    authorityId: "CYFSA:73",
    citation: "CYFSA, s. 73",
    instrument: "CYFSA",
    statuteTitle: CYFSA_TITLE,
    sectionKey: "73",
    heading: "Consultation in specified cases \u2014 First Nations, Inuk or M\xE9tis child",
    exactWording: "73 A society, person or entity that proposes to provide a prescribed service to a First Nations, Inuk or M\xE9tis child or young person, or to exercise a prescribed power under this Act in relation to such a child or young person, shall consult with a representative chosen by each of the child\u2019s or young person\u2019s bands and First Nations, Inuit or M\xE9tis communities in accordance with the regulations.",
    sourceUrl: "https://www.ontario.ca/laws/statute/17c14#BK90",
    consolidationPeriod: CYFSA_PERIOD,
    effectiveFrom: "2018-04-30",
    effectiveTo: null,
    verificationSourceType: "BUNDLED_CONSOLIDATION_VERBATIM",
    verifiedDate: "2026-11-03",
    legalTestSummary: "Mandates consultation with a representative chosen by each of a First Nations, Inuk, or M\xE9tis child's bands and communities when proposing to provide a prescribed service or exercise a prescribed power.",
    practiceNote: "Operates alongside CYFSA s. 72 and federal Bill C-92, s. 12(1)."
  },
  {
    authorityId: "CYFSA:75(1)",
    citation: "CYFSA, s. 75(1)",
    instrument: "CYFSA",
    statuteTitle: CYFSA_TITLE,
    sectionKey: "75(1)",
    heading: "Temporary care agreement",
    exactWording: "75 (1) A person who is temporarily unable to care adequately for a child in the person\u2019s custody, and the society having jurisdiction where the person resides, may make a written agreement for the society\u2019s care and custody of the child.",
    sourceUrl: "https://www.ontario.ca/laws/statute/17c14#BK93",
    consolidationPeriod: CYFSA_PERIOD,
    effectiveFrom: "2018-04-30",
    effectiveTo: null,
    verificationSourceType: "BUNDLED_CONSOLIDATION_VERBATIM",
    verifiedDate: "2026-11-03",
    legalTestSummary: "Authorizes a voluntary written Temporary Care Agreement between a custodial parent temporarily unable to care adequately for a child and the society.",
    practiceNote: "Must comply with the validity requirements for consent/agreements in CYFSA s. 21(2) (capacity, reasonably informed of nature, consequences, and alternatives, voluntary without coercion, and reasonable opportunity for independent advice)."
  },
  {
    authorityId: "CYFSA:75(4)",
    citation: "CYFSA, s. 75(4)",
    instrument: "CYFSA",
    statuteTitle: CYFSA_TITLE,
    sectionKey: "75(4)",
    heading: "Duty of society before making temporary care agreement",
    exactWording: "(4) A society shall not make a temporary care agreement unless the society, (a) has determined that an appropriate residential placement that is likely to benefit the child is available; and (b) is satisfied that no course of action less disruptive to the child, such as care in the child\u2019s own home, is able to adequately protect the child.",
    sourceUrl: "https://www.ontario.ca/laws/statute/17c14#BK93",
    consolidationPeriod: CYFSA_PERIOD,
    effectiveFrom: "2018-04-30",
    effectiveTo: null,
    verificationSourceType: "BUNDLED_CONSOLIDATION_VERBATIM",
    verifiedDate: "2026-11-03",
    legalTestSummary: "Prohibits a society from making a Temporary Care Agreement unless it has determined an appropriate beneficial placement is available and is satisfied that no less disruptive course of action (such as in-home care) can adequately protect the child.",
    practiceNote: "Under s. 75(10), para. 3, the agreement must also contain a statement that the parent has discussed alternatives to residential placement with the society."
  },
  {
    authorityId: "CYFSA:75(5)",
    citation: "CYFSA, s. 75(5)",
    instrument: "CYFSA",
    statuteTitle: CYFSA_TITLE,
    sectionKey: "75(5)",
    heading: "Term of temporary care agreement limited",
    exactWording: "(5) No temporary care agreement shall be made for a term exceeding six months, but the parties to a temporary care agreement may, with a Director\u2019s written approval, agree to extend it for a further period or periods if the total term of the agreement, as extended, does not exceed 12 months.",
    sourceUrl: "https://www.ontario.ca/laws/statute/17c14#BK93",
    consolidationPeriod: CYFSA_PERIOD,
    effectiveFrom: "2018-04-30",
    effectiveTo: null,
    verificationSourceType: "BUNDLED_CONSOLIDATION_VERBATIM",
    verifiedDate: "2026-11-03",
    legalTestSummary: "Caps an initial Temporary Care Agreement at 6 months and any extension (which requires a Director's written approval) at a total term of 12 months.",
    practiceNote: "Check whether any extension beyond 6 months has a documented written approval from a Director."
  },
  {
    authorityId: "CYFSA:75(6)",
    citation: "CYFSA, s. 75(6)",
    instrument: "CYFSA",
    statuteTitle: CYFSA_TITLE,
    sectionKey: "75(6)",
    heading: "Cumulative time limit \u2014 Temporary care agreement",
    exactWording: "(6) No temporary care agreement shall be made or extended so as to result in a child being in a society\u2019s care and custody, for a period exceeding, (a) 12 months, if the child is younger than 6 on the day the agreement is entered into or extended; or (b) 24 months, if the child is 6 or older on the day the agreement is entered into or extended.",
    sourceUrl: "https://www.ontario.ca/laws/statute/17c14#BK93",
    consolidationPeriod: CYFSA_PERIOD,
    effectiveFrom: "2018-04-30",
    effectiveTo: null,
    verificationSourceType: "BUNDLED_CONSOLIDATION_VERBATIM",
    verifiedDate: "2026-11-03",
    legalTestSummary: "Prohibits making or extending a Temporary Care Agreement if it would result in cumulative society care exceeding 12 months (child under 6) or 24 months (child 6 or older).",
    practiceNote: "Time under a Temporary Care Agreement also counts toward the cumulative interim care limit in CYFSA s. 122(1)\u2013(2)."
  },
  {
    authorityId: "CYFSA:76(3)",
    citation: "CYFSA, s. 76(3)",
    instrument: "CYFSA",
    statuteTitle: CYFSA_TITLE,
    sectionKey: "76(3)",
    heading: "Society response to notice of termination of temporary care agreement",
    exactWording: "(3) Where notice of a wish to terminate a temporary care agreement is given by or to a society under subsection (1), the society shall as soon as possible, and in any event before the agreement terminates under subsection (2), (a) cause the child to be returned to the person who made the agreement, or to a person who has obtained an order for the child\u2019s custody since the agreement was made; (b) where the society is of the opinion that the child would be in need of protection if returned to the person referred to in clause (a), bring the child before the court under this Part to determine whether the child would be in need of protection in that case; or (c) where the child is 16 or 17 and the criteria set out in clauses 77 (1) (a), (b), (c) and (d) are met, make a written agreement with the child under subsection 77 (1).",
    sourceUrl: "https://www.ontario.ca/laws/statute/17c14#BK94",
    consolidationPeriod: CYFSA_PERIOD,
    effectiveFrom: "2018-04-30",
    effectiveTo: null,
    verificationSourceType: "BUNDLED_CONSOLIDATION_VERBATIM",
    verifiedDate: "2026-11-03",
    legalTestSummary: "Requires a society receiving written notice of termination of a Temporary Care Agreement to either return the child or bring the matter before the court before the agreement terminates (5 days after receipt, or up to 21 days if specified in the agreement per s. 76(2)).",
    practiceNote: "A society cannot retain a child after a s. 76(1) termination notice expires without bringing the matter before the court."
  },
  {
    authorityId: "CYFSA:79(1)",
    citation: "CYFSA, s. 79(1)",
    instrument: "CYFSA",
    statuteTitle: CYFSA_TITLE,
    sectionKey: "79(1)",
    heading: "Statutory parties to a child protection proceeding",
    exactWording: "79 (1) The following are parties to a proceeding under this Part: 1. The applicant. 2. The society having jurisdiction in the matter. 3. The child\u2019s parent. 4. In the case of a First Nations, Inuk or M\xE9tis child, the persons described in paragraphs 1, 2 and 3 and a representative chosen by each of the child\u2019s bands and First Nations, Inuit or M\xE9tis communities.",
    sourceUrl: "https://www.ontario.ca/laws/statute/17c14#BK100",
    consolidationPeriod: CYFSA_PERIOD,
    effectiveFrom: "2018-04-30",
    effectiveTo: null,
    verificationSourceType: "BUNDLED_CONSOLIDATION_VERBATIM",
    verifiedDate: "2026-11-03",
    legalTestSummary: "Designates the applicant, the society, the child's parent, and (for a First Nations, Inuk, or M\xE9tis child) a representative chosen by each of the child's bands and communities as statutory parties to a Part V proceeding.",
    practiceNote: "Check that all statutory parties under s. 79(1) (and any person who cared for the child continuously during the 6 months before the hearing under s. 79(3), or a child 12+ under s. 79(4)) received proper notice."
  },
  {
    authorityId: "CYFSA:80",
    citation: "CYFSA, s. 80",
    instrument: "CYFSA",
    statuteTitle: CYFSA_TITLE,
    sectionKey: "80",
    heading: "Duty to pursue customary care",
    exactWording: "80 A society shall make all reasonable efforts to pursue a plan for customary care for a First Nations, Inuk or M\xE9tis child if the child, (a) is in need of protection; (b) cannot remain in or be returned to the care and custody of the person who had charge of the child immediately before intervention under this Part or, where there is an order for the child\u2019s custody that is enforceable in Ontario, of the person entitled to custody under the order; and (c) is a member of or identifies with a band, or is a member of or identifies with a First Nations, Inuit or M\xE9tis community.",
    sourceUrl: "https://www.ontario.ca/laws/statute/17c14#BK101",
    consolidationPeriod: CYFSA_PERIOD,
    effectiveFrom: "2018-04-30",
    effectiveTo: null,
    verificationSourceType: "BUNDLED_CONSOLIDATION_VERBATIM",
    verifiedDate: "2026-11-03",
    legalTestSummary: "Requires a society to make all reasonable efforts to pursue a plan for customary care for a First Nations, Inuk, or M\xE9tis child in need of protection who cannot remain with or return to the person who had charge.",
    practiceNote: "Examine whether the Society documented concrete efforts to consult the child's band or community regarding a customary care plan under s. 80 and subsidy availability under s. 71."
  },
  {
    authorityId: "CYFSA:93(1)",
    citation: "CYFSA, s. 93(1)",
    instrument: "CYFSA",
    statuteTitle: CYFSA_TITLE,
    sectionKey: "93(1)",
    heading: "Evidence \u2014 Past conduct and prior proceedings",
    exactWording: "93 (1) Despite anything in the Evidence Act, at a hearing under this Part, the court may admit as evidence, (a) evidence of past conduct of a person towards any child, if that conduct is relevant to that person\u2019s ability to care for a child; or (b) any oral or written statement or report that the court considers relevant to the proceeding, including a transcript, exhibit or finding in an earlier civil or criminal proceeding.",
    sourceUrl: "https://www.ontario.ca/laws/statute/17c14#BK116",
    consolidationPeriod: CYFSA_PERIOD,
    effectiveFrom: "2018-04-30",
    effectiveTo: null,
    verificationSourceType: "BUNDLED_CONSOLIDATION_VERBATIM",
    verifiedDate: "2026-11-03",
    legalTestSummary: "Permits admission of past parenting conduct if relevant to the person's ability to care for a child, as well as relevant statements, reports, transcripts, or findings from earlier proceedings.",
    practiceNote: "Past history that has no nexus to current parenting ability or current protection risk should be challenged as irrelevant under s. 93(1)(a)."
  },
  {
    authorityId: "CYFSA:94(10)",
    citation: "CYFSA, s. 94(10)",
    instrument: "CYFSA",
    statuteTitle: CYFSA_TITLE,
    sectionKey: "94(10)",
    heading: "Evidence on temporary care and custody hearing \u2014 Credible and trustworthy",
    exactWording: "(10) For the purpose of this section, the court may admit and act on evidence that the court considers credible and trustworthy in the circumstances.",
    sourceUrl: "https://www.ontario.ca/laws/statute/17c14#BK117",
    consolidationPeriod: CYFSA_PERIOD,
    effectiveFrom: "2018-04-30",
    effectiveTo: null,
    verificationSourceType: "BUNDLED_CONSOLIDATION_VERBATIM",
    verifiedDate: "2026-11-03",
    legalTestSummary: "Establishes that at a temporary care and custody hearing under s. 94, the court may admit and act on evidence it considers 'credible and trustworthy in the circumstances'.",
    practiceNote: "Anonymous, unattributed, or multi-level hearsay on contested material issues can be challenged as failing the 'credible and trustworthy' threshold under s. 94(10) and Family Law Rules r. 14(18)\u2013(19)."
  },
  {
    authorityId: "CYFSA:98(1)",
    citation: "CYFSA, s. 98(1)",
    instrument: "CYFSA",
    statuteTitle: CYFSA_TITLE,
    sectionKey: "98(1)",
    heading: "Order for assessment",
    exactWording: "98 (1) In the course of a proceeding under this Part, the court may order that one or more of the following persons undergo an assessment within a specified time by a person appointed in accordance with subsections (2) and (3): 1. The child. 2. A parent of the child. 3. Any other person, other than a foster parent, who is putting forward or would participate in a plan for the care and custody of or access to the child.",
    sourceUrl: "https://www.ontario.ca/laws/statute/17c14#BK121",
    consolidationPeriod: CYFSA_PERIOD,
    effectiveFrom: "2018-04-30",
    effectiveTo: null,
    verificationSourceType: "BUNDLED_CONSOLIDATION_VERBATIM",
    verifiedDate: "2026-11-03",
    legalTestSummary: "Authorizes the court to order a clinical/parenting assessment of the child, a parent, or a proposed caregiver by a qualified assessor.",
    practiceNote: "A society cannot unilaterally compel a parent to undergo a s. 98 clinical assessment without a court order or informed consent."
  },
  {
    authorityId: "CYFSA:105(1)",
    citation: "CYFSA, s. 105(1)",
    instrument: "CYFSA",
    statuteTitle: CYFSA_TITLE,
    sectionKey: "105(1)",
    heading: "Access: where child removed from person in charge",
    exactWording: "105 (1) Where an order is made under paragraph 1 or 2 of subsection 101 (1) removing a child from the person who had charge of the child immediately before intervention under this Part, the court shall make an order for access by the person unless the court is satisfied that continued contact with the person would not be in the child\u2019s best interests.",
    sourceUrl: "https://www.ontario.ca/laws/statute/17c14#BK128",
    consolidationPeriod: CYFSA_PERIOD,
    effectiveFrom: "2018-04-30",
    effectiveTo: null,
    verificationSourceType: "BUNDLED_CONSOLIDATION_VERBATIM",
    verifiedDate: "2026-11-03",
    legalTestSummary: "Creates a mandatory presumption in favour of an access order for the person from whom the child was removed under a supervision or interim society care order, unless the court is satisfied continued contact would not be in the child's best interests.",
    practiceNote: "Contrast s. 105(1) (presumption FOR access in interim/supervision care) with s. 105(5) (presumption AGAINST access in extended society care unless beneficial/meaningful and non-impairing)."
  },
  {
    authorityId: "CYFSA:105(5)",
    citation: "CYFSA, s. 105(5)",
    instrument: "CYFSA",
    statuteTitle: CYFSA_TITLE,
    sectionKey: "105(5)",
    heading: "Access to child in extended society care \u2014 Two-part test",
    exactWording: "(5) A court shall not make or vary an access order under section 104 with respect to a child who is in extended society care under an order made under paragraph 3 of subsection 101 (1) or clause 116 (1) (c) unless the court is satisfied that, (a) the relationship between the person and the child is beneficial and meaningful to the child; and (b) the ordered access will not impair the child\u2019s future opportunities for adoption.",
    sourceUrl: "https://www.ontario.ca/laws/statute/17c14#BK128",
    consolidationPeriod: CYFSA_PERIOD,
    effectiveFrom: "2018-04-30",
    effectiveTo: null,
    verificationSourceType: "BUNDLED_CONSOLIDATION_VERBATIM",
    verifiedDate: "2026-11-03",
    legalTestSummary: "Prohibits making or varying an access order for a child in extended society care unless satisfied that (a) the relationship is beneficial and meaningful to the child, and (b) ordered access will not impair future adoption opportunities.",
    practiceNote: "Ensure evidence of positive, consistent visits and emotional bond is documented in the record to satisfy s. 105(5)(a)."
  },
  {
    authorityId: "CYFSA:113(1)",
    citation: "CYFSA, s. 113(1)",
    instrument: "CYFSA",
    statuteTitle: CYFSA_TITLE,
    sectionKey: "113(1)",
    heading: "Status review application by parent, child, or caregiver",
    exactWording: "113 (1) Where a child is the subject of an order for society supervision or interim society care under subsection 101 (1) or an order for custody under subsection 102 (1), any of the following may apply to the court for a review of the child\u2019s status: 1. A parent of the child. 2. The child, if the child is 12 or older. 3. A person with whom the child has been placed under an order for society supervision. 4. A person to whom custody of the child has been granted under an order for custody. 5. In the case of a First Nations, Inuk or M\xE9tis child, a person described in paragraph 1, 2, 3 or 4 or a representative chosen by each of the child\u2019s bands and First Nations, Inuit or M\xE9tis communities.",
    sourceUrl: "https://www.ontario.ca/laws/statute/17c14#BK139",
    consolidationPeriod: CYFSA_PERIOD,
    effectiveFrom: "2018-04-30",
    effectiveTo: null,
    verificationSourceType: "BUNDLED_CONSOLIDATION_VERBATIM",
    verifiedDate: "2026-11-03",
    legalTestSummary: "Allows a parent, child 12+, caregiver, or FNIM representative to apply for a status review of a s. 101(1) supervision/interim care order or s. 102(1) custody order (subject to the 6-month limit in s. 113(3) absent leave).",
    practiceNote: "If a parent has completed key service-plan goals and reduced risk, a status review under s. 113(1) is the statutory mechanism to seek return of the child or less restrictive terms."
  },
  {
    authorityId: "CYFSA:113(2)",
    citation: "CYFSA, s. 113(2)",
    instrument: "CYFSA",
    statuteTitle: CYFSA_TITLE,
    sectionKey: "113(2)",
    heading: "Society mandatory status review application",
    exactWording: "(2) The society having care, custody or supervision of a child, (a) may apply to the court at any time for a review of the child\u2019s status; (b) shall apply to the court for a review of the child\u2019s status before the order expires, unless the expiry is by reason of section 123 (expiry at 18 or marriage); and (c) shall apply to the court for a review of the child\u2019s status within five days after removing the child, if the society has removed the child from the care of a person with whom the child was placed under an order for society supervision or from the custody of a person who had custody of the child under an order for custody.",
    sourceUrl: "https://www.ontario.ca/laws/statute/17c14#BK139",
    consolidationPeriod: CYFSA_PERIOD,
    effectiveFrom: "2018-04-30",
    effectiveTo: null,
    verificationSourceType: "BUNDLED_CONSOLIDATION_VERBATIM",
    verifiedDate: "2026-11-03",
    legalTestSummary: "Requires the society to apply for a status review before a supervision or interim care order expires (s. 113(2)(b)) and within 5 days after removing a child from a person's care under a s. 101(1) supervision or s. 102(1) custody order (s. 113(2)(c)).",
    practiceNote: "Verify whether the society brought its status review application before order expiry or within 5 days of removing a child under a supervision order."
  },
  {
    authorityId: "CYFSA:114",
    citation: "CYFSA, s. 114",
    instrument: "CYFSA",
    statuteTitle: CYFSA_TITLE,
    sectionKey: "114",
    heading: "Court powers on status review under s. 113",
    exactWording: "114 Where an application for review of a child\u2019s status is made under section 113, the court may, in the child\u2019s best interests, (a) vary or terminate the original order made under subsection 101 (1) or 102 (1), including a term or condition or a provision for access that is part of the order; (b) order that the original order terminate on a specified future date; (c) make a further order or orders under section 101; or (d) make an order under section 102.",
    sourceUrl: "https://www.ontario.ca/laws/statute/17c14#BK140",
    consolidationPeriod: CYFSA_PERIOD,
    effectiveFrom: "2018-04-30",
    effectiveTo: null,
    verificationSourceType: "BUNDLED_CONSOLIDATION_VERBATIM",
    verifiedDate: "2026-11-03",
    legalTestSummary: "Empowers the court on a s. 113 status review to vary or terminate the original order, set a termination date, or make a further order under s. 101 or s. 102 in the child's best interests.",
    practiceNote: "Under s. 100, the court must obtain and consider an updated written Plan of Care before making an order under s. 114."
  },
  {
    authorityId: "CYFSA:116(1)",
    citation: "CYFSA, s. 116(1)",
    instrument: "CYFSA",
    statuteTitle: CYFSA_TITLE,
    sectionKey: "116(1)",
    heading: "Court order on status review under s. 115",
    exactWording: "116 (1) When an application is made under section 115, the court may, in the child\u2019s best interests, (a) make an order for society supervision of the child for a specified period of at least three and not more than 12 months; (b) make an order granting custody of the child to one or more persons, other than a foster parent of the child, with the consent of the person or persons; or (c) make an order that the child be placed in extended society care until the order expires under section 123 (expiry at 18 or marriage).",
    sourceUrl: "https://www.ontario.ca/laws/statute/17c14#BK142",
    consolidationPeriod: CYFSA_PERIOD,
    effectiveFrom: "2018-04-30",
    effectiveTo: null,
    verificationSourceType: "BUNDLED_CONSOLIDATION_VERBATIM",
    verifiedDate: "2026-11-03",
    legalTestSummary: "Sets out the court's dispositive powers on a s. 115 status review: supervision order (3\u201312 months), custody order, or extended society care.",
    practiceNote: "Read together with s. 116(4) regarding supervision terms and conditions."
  },
  {
    authorityId: "CYFSA:116(4)",
    citation: "CYFSA, s. 116(4)",
    instrument: "CYFSA",
    statuteTitle: CYFSA_TITLE,
    sectionKey: "116(4)",
    heading: "Terms and conditions of status review supervision order \u2014 Non-funding rule",
    exactWording: "(4) If the court makes an order for society supervision under clause (1) (a), the court may impose, (a) reasonable terms and conditions relating to the child\u2019s care and supervision; (b) reasonable terms and conditions on, (i) the child\u2019s parent, (ii) the person who will have care and custody of the child under the order, (iii) the child, and (iv) any other person, other than a foster parent, who is putting forward or would participate in a plan for the care and custody of or access to the child; and (c) reasonable terms and conditions on the society that will supervise the placement, but shall not require the society to provide financial assistance or to purchase any goods or services.",
    sourceUrl: "https://www.ontario.ca/laws/statute/17c14#BK142",
    consolidationPeriod: CYFSA_PERIOD,
    effectiveFrom: "2018-04-30",
    effectiveTo: null,
    verificationSourceType: "BUNDLED_CONSOLIDATION_VERBATIM",
    verifiedDate: "2026-11-03",
    legalTestSummary: "Permits reasonable supervision terms on a s. 116(1)(a) supervision order, while clause (c) expressly prohibits requiring the society to provide financial assistance or purchase any goods or services.",
    practiceNote: "Together with s. 94(6)(c) and s. 101(7)(c), establishes that a court cannot compel a society via supervision terms to fund or purchase goods or services."
  },
  {
    authorityId: "CYFSA:119(1)",
    citation: "CYFSA, s. 119(1)",
    instrument: "CYFSA",
    statuteTitle: CYFSA_TITLE,
    sectionKey: "119(1)",
    heading: "Complaint to society",
    exactWording: "119 (1) A person may make a complaint to a society relating to a service sought or received by that person from the society in accordance with the regulations.",
    sourceUrl: "https://www.ontario.ca/laws/statute/17c14#BK145",
    consolidationPeriod: CYFSA_PERIOD,
    effectiveFrom: "2018-04-30",
    effectiveTo: null,
    verificationSourceType: "BUNDLED_CONSOLIDATION_VERBATIM",
    verifiedDate: "2026-11-03",
    legalTestSummary: "Provides the statutory right for a person who sought or received a service from a society to make a formal internal complaint in accordance with the regulations (O. Reg. 155/18).",
    practiceNote: "Subject to the mandatory court-issue exclusion in s. 119(11)."
  },
  {
    authorityId: "CYFSA:119(2)",
    citation: "CYFSA, s. 119(2)",
    instrument: "CYFSA",
    statuteTitle: CYFSA_TITLE,
    sectionKey: "119(2)",
    heading: "Society duty to follow complaint review procedure",
    exactWording: "(2) Where a society receives a complaint under subsection (1), it shall deal with the complaint in accordance with the complaint review procedure established by regulation, subject to subsection 120 (2).",
    sourceUrl: "https://www.ontario.ca/laws/statute/17c14#BK145",
    consolidationPeriod: CYFSA_PERIOD,
    effectiveFrom: "2018-04-30",
    effectiveTo: null,
    verificationSourceType: "BUNDLED_CONSOLIDATION_VERBATIM",
    verifiedDate: "2026-11-03",
    legalTestSummary: "Requires a society receiving a s. 119(1) complaint to process it in accordance with the regulatory complaint review procedure (Internal Complaint Review Panel under O. Reg. 155/18).",
    practiceNote: "If the society refuses to proceed or misses the regulatory timeframe, the complainant may apply to the CFSRB under s. 120(4), paras. 1\u20133."
  },
  {
    authorityId: "CYFSA:119(11)",
    citation: "CYFSA, s. 119(11)",
    instrument: "CYFSA",
    statuteTitle: CYFSA_TITLE,
    sectionKey: "119(11)",
    heading: "No society complaint review if matter within purview of court",
    exactWording: "(11) A society shall not conduct a review of a complaint under this section if the subject of the complaint, (a) is an issue that has been decided by the court or is before the court; or (b) is subject to another decision-making process under this Act or the Labour Relations Act, 1995.",
    sourceUrl: "https://www.ontario.ca/laws/statute/17c14#BK145",
    consolidationPeriod: CYFSA_PERIOD,
    effectiveFrom: "2018-04-30",
    effectiveTo: null,
    verificationSourceType: "BUNDLED_CONSOLIDATION_VERBATIM",
    verifiedDate: "2026-11-03",
    legalTestSummary: "Prohibits a society from reviewing a complaint under s. 119 if the subject of the complaint has been decided by the court or is before the court.",
    practiceNote: "Critical jurisdictional boundary: internal CAS complaints cannot review or overturn matters before the court or decided by a court order."
  },
  {
    authorityId: "CYFSA:120(1)",
    citation: "CYFSA, s. 120(1)",
    instrument: "CYFSA",
    statuteTitle: CYFSA_TITLE,
    sectionKey: "120(1)",
    heading: "Complaint to Child and Family Services Review Board (CFSRB)",
    exactWording: "120 (1) If a complaint in respect of a service sought or received from a society relates to a matter described in subsection (4), the person who sought or received the service may, (a) decide not to make the complaint to the society under section 119 and make the complaint directly to the Board under this section; or (b) where the person first makes the complaint to the society under section 119, submit the complaint to the Board before the society\u2019s complaint review procedure is completed.",
    sourceUrl: "https://www.ontario.ca/laws/statute/17c14#BK146",
    consolidationPeriod: CYFSA_PERIOD,
    effectiveFrom: "2018-04-30",
    effectiveTo: null,
    verificationSourceType: "BUNDLED_CONSOLIDATION_VERBATIM",
    verifiedDate: "2026-11-03",
    legalTestSummary: "Permits a person who sought or received a society service to file a complaint regarding a s. 120(4) matter directly with the CFSRB without exhausting the society's internal review.",
    practiceNote: "Applies only to the procedural and right-to-be-heard grounds enumerated in s. 120(4), and is barred if the issue is before or decided by the court (s. 120(8))."
  },
  {
    authorityId: "CYFSA:120(4)",
    citation: "CYFSA, s. 120(4)",
    instrument: "CYFSA",
    statuteTitle: CYFSA_TITLE,
    sectionKey: "120(4)",
    heading: "Matters for CFSRB review",
    exactWording: "(4) The following matters may be reviewed by the Board under this section: 1. Allegations that the society has refused to proceed with a complaint made by the complainant under subsection 119 (1) as required under subsection 119 (2). 2. Allegations that the society has failed to respond to the complainant\u2019s complaint within the timeframe required by regulation. 3. Allegations that the society has failed to comply with the complaint review procedure or with any other procedural requirements under this Act relating to the review of complaints. 4. Allegations that the society has failed to comply with subsection 15 (2). 5. Allegations that the society has failed to provide the complainant with reasons for a decision that affects the complainant\u2019s interests. 6. Such other matters as may be prescribed.",
    sourceUrl: "https://www.ontario.ca/laws/statute/17c14#BK146",
    consolidationPeriod: CYFSA_PERIOD,
    effectiveFrom: "2018-04-30",
    effectiveTo: null,
    verificationSourceType: "BUNDLED_CONSOLIDATION_VERBATIM",
    verifiedDate: "2026-11-03",
    legalTestSummary: "Defines the specific jurisdiction of the CFSRB on service complaints: refusal to proceed, missed regulatory complaint deadlines, procedural non-compliance, failure to provide an opportunity to be heard under s. 15(2), and failure to provide reasons for a decision affecting the complainant's interests.",
    practiceNote: "Under s. 120(7), the CFSRB can order the society to proceed with a complaint, respond within a specified period, comply with s. 15(2), or provide written reasons, but cannot overturn a court order."
  },
  {
    authorityId: "CYFSA:120(8)",
    citation: "CYFSA, s. 120(8)",
    instrument: "CYFSA",
    statuteTitle: CYFSA_TITLE,
    sectionKey: "120(8)",
    heading: "No CFSRB review if matter within purview of court",
    exactWording: "(8) The Board shall not conduct a review of a complaint under this section if the subject of the complaint, (a) is an issue that has been decided by the court or is before the court; or (b) is subject to another decision-making process under this Act or the Labour Relations Act, 1995.",
    sourceUrl: "https://www.ontario.ca/laws/statute/17c14#BK146",
    consolidationPeriod: CYFSA_PERIOD,
    effectiveFrom: "2018-04-30",
    effectiveTo: null,
    verificationSourceType: "BUNDLED_CONSOLIDATION_VERBATIM",
    verifiedDate: "2026-11-03",
    legalTestSummary: "Expressly prohibits the CFSRB from reviewing any complaint whose subject is an issue that has been decided by the court or is before the court.",
    practiceNote: "Never suggest that the CFSRB can review or overturn a court order or adjudicate protection issues pending before the court."
  },
  {
    authorityId: "CYFSA:122(1)",
    citation: "CYFSA, s. 122(1)",
    instrument: "CYFSA",
    statuteTitle: CYFSA_TITLE,
    sectionKey: "122(1)",
    heading: "Cumulative time limit for interim society care (12 / 24 months)",
    exactWording: "122 (1) Subject to subsections (4) and (5), the court shall not make an order for interim society care under paragraph 2 of subsection 101 (1) that results in a child being in the care and custody of a society for a period exceeding, (a) 12 months, if the child is younger than 6 on the day the court makes the order; or (b) 24 months, if the child is 6 or older on the day the court makes the order.",
    sourceUrl: "https://www.ontario.ca/laws/statute/17c14#BK149",
    consolidationPeriod: CYFSA_PERIOD,
    effectiveFrom: "2018-04-30",
    effectiveTo: null,
    verificationSourceType: "BUNDLED_CONSOLIDATION_VERBATIM",
    verifiedDate: "2026-11-03",
    legalTestSummary: "Establishes the mandatory cumulative time-in-care ceiling for interim society care: 12 months for children under 6, and 24 months for children 6 or older (counting time in temporary care agreements under s. 75(1) and temporary care orders under s. 94(2)(d), per s. 122(2)), subject to a discretionary 6-month extension under s. 122(5).",
    practiceNote: "Critical reunification clock: delays in offering parent assistance or completing service plans directly erode the parent's finite 12/24-month window under s. 122(1)."
  },
  {
    authorityId: "CYFSA:122(5)",
    citation: "CYFSA, s. 122(5)",
    instrument: "CYFSA",
    statuteTitle: CYFSA_TITLE,
    sectionKey: "122(5)",
    heading: "Six-month extension of cumulative time-in-care limit",
    exactWording: "(5) Subject to paragraphs 2 and 4 of subsection 101 (1), the court may by order extend the period permitted under subsection (1) by a period not to exceed six months if it is in the child\u2019s best interests to do so.",
    sourceUrl: "https://www.ontario.ca/laws/statute/17c14#BK149",
    consolidationPeriod: CYFSA_PERIOD,
    effectiveFrom: "2018-04-30",
    effectiveTo: null,
    verificationSourceType: "BUNDLED_CONSOLIDATION_VERBATIM",
    verifiedDate: "2026-11-03",
    legalTestSummary: "Authorizes the court to extend the cumulative 12-month or 24-month interim care limit in s. 122(1) by up to 6 months where it is in the child's best interests.",
    practiceNote: "Relevant where a parent is making demonstrable progress on service-plan goals or where agency delay impeded timely service access."
  },
  {
    authorityId: "CYFSA:126(1)",
    citation: "CYFSA, s. 126(1)",
    instrument: "CYFSA",
    statuteTitle: CYFSA_TITLE,
    sectionKey: "126(1)",
    heading: "Society duty to assess and verify child protection report",
    exactWording: "126 (1) A society that receives a report under section 125 that a child, including a child in the society\u2019s care or supervision, is or may be in need of protection shall as soon as possible carry out an assessment as prescribed and verify the reported information, or ensure that the information is assessed and verified by another society.",
    sourceUrl: "https://www.ontario.ca/laws/statute/17c14#BK153",
    consolidationPeriod: CYFSA_PERIOD,
    effectiveFrom: "2018-04-30",
    effectiveTo: null,
    verificationSourceType: "BUNDLED_CONSOLIDATION_VERBATIM",
    verifiedDate: "2026-11-03",
    legalTestSummary: "Mandates that a society receiving a s. 125 report carry out a prescribed assessment as soon as possible and verify the reported information.",
    practiceNote: "Connects statutory investigation duty to Ontario Child Protection Standards (2016) Standards 1\u20136."
  },
  {
    authorityId: "CYFSA:306(1)",
    citation: "CYFSA, s. 306(1)",
    instrument: "CYFSA",
    statuteTitle: CYFSA_TITLE,
    sectionKey: "306(1)",
    heading: "Part X duty to ensure accuracy of personal information",
    exactWording: "306 (1) A service provider that uses personal information for the purpose of providing a service shall take reasonable steps to ensure that the information is as accurate, complete and up-to-date as is necessary for the purposes for which it uses the information.",
    sourceUrl: "https://www.ontario.ca/laws/statute/17c14#BK355",
    consolidationPeriod: "In force January 1, 2020 to Present (Part X)",
    effectiveFrom: "2020-01-01",
    effectiveTo: null,
    verificationSourceType: "BUNDLED_CONSOLIDATION_VERBATIM",
    verifiedDate: "2026-11-03",
    legalTestSummary: "Requires a service provider using personal information to provide a service to take reasonable steps to ensure the information is accurate, complete, and up-to-date.",
    practiceNote: "Supports record-accuracy challenges and Part X correction requests under s. 315(2)."
  },
  {
    authorityId: "CYFSA:314(3)",
    citation: "CYFSA, s. 314(3)",
    instrument: "CYFSA",
    statuteTitle: CYFSA_TITLE,
    sectionKey: "314(3)",
    heading: "Part X 30-day response limit for personal information access requests",
    exactWording: "(3) As soon as possible, but no later than 30 days after receiving the request, the service provider shall, by written notice to the individual, give the response required by subsection (1) or extend the deadline for responding by not more than 90 days if, (a) responding to the request within 30 days would unreasonably interfere with the operations of the service provider because the information consists of numerous pieces of information or locating the information would necessitate a lengthy search; or (b) the time required to undertake an assessment under subsection 312 (1) necessary to respond to the request within 30 days after receiving it would make it not reasonably practical to respond within that time.",
    sourceUrl: "https://www.ontario.ca/laws/statute/17c14#BK363",
    consolidationPeriod: "In force January 1, 2020 to Present (Part X)",
    effectiveFrom: "2020-01-01",
    effectiveTo: null,
    verificationSourceType: "BUNDLED_CONSOLIDATION_VERBATIM",
    verifiedDate: "2026-11-03",
    legalTestSummary: "Requires a service provider to respond in writing to a s. 313 personal information access request within 30 days (or give written notice of an extension of up to 90 days).",
    practiceNote: "Failure to respond within the required time is a deemed refusal under s. 314(7), entitling the requester to complain to the IPC under s. 316."
  },
  {
    authorityId: "CYFSA:315(2)",
    citation: "CYFSA, s. 315(2)",
    instrument: "CYFSA",
    statuteTitle: CYFSA_TITLE,
    sectionKey: "315(2)",
    heading: "Part X right to request correction of personal information record",
    exactWording: "(2) If a service provider has granted an individual access to a record of personal information and if the individual believes that the record is inaccurate or incomplete, the individual may request in writing that the service provider correct the record. 2017, c. 14, Sched. 1, s. 315 (2).",
    sourceUrl: "https://www.ontario.ca/laws/statute/17c14#BK364",
    consolidationPeriod: "In force January 1, 2020 to Present (Part X)",
    effectiveFrom: "2020-01-01",
    effectiveTo: null,
    verificationSourceType: "BUNDLED_CONSOLIDATION_VERBATIM",
    verifiedDate: "2026-11-03",
    legalTestSummary: "Entitles an individual who has been granted access to their personal information record under Part X to request in writing that inaccurate or incomplete information be corrected.",
    practiceNote: "Under s. 315(10)(b), a service provider is not required to correct a good-faith professional opinion or observation, but under s. 315(12) the individual has the statutory right to require a Statement of Disagreement to be attached to the record."
  },
  {
    authorityId: "CYFSA:316(1)",
    citation: "CYFSA, s. 316(1)",
    instrument: "CYFSA",
    statuteTitle: CYFSA_TITLE,
    sectionKey: "316(1)",
    heading: "Part X complaint to Information and Privacy Commissioner (IPC)",
    exactWording: "316 (1) A person who has reasonable grounds to believe that another person has contravened or is about to contravene a provision of this Part or the regulations made for the purposes of this Part may make a complaint to the Commissioner.",
    sourceUrl: "https://www.ontario.ca/laws/statute/17c14#BK365",
    consolidationPeriod: "In force January 1, 2020 to Present (Part X)",
    effectiveFrom: "2020-01-01",
    effectiveTo: null,
    verificationSourceType: "BUNDLED_CONSOLIDATION_VERBATIM",
    verifiedDate: "2026-11-03",
    legalTestSummary: "Authorizes complaints to the Information and Privacy Commissioner of Ontario (IPC) regarding contraventions of Part X (within 1 year under s. 316(2), or within 6 months of an access or correction refusal under s. 316(3)).",
    practiceNote: "The IPC can order access or correction of personal information records under s. 321(1), but cannot adjudicate child protection custody or access orders."
  },
  {
    authorityId: "CYFSA:333(1)",
    citation: "CYFSA, s. 333(1)",
    instrument: "CYFSA",
    statuteTitle: CYFSA_TITLE,
    sectionKey: "333(1)",
    heading: "Child and Family Services Review Board (CFSRB)",
    exactWording: "333 (1) The Child and Family Services Review Board is continued under the name Child and Family Services Review Board in English and Commission de r\xE9vision des services \xE0 l\u2019enfance et \xE0 la famille in French.",
    sourceUrl: "https://www.ontario.ca/laws/statute/17c14#BK383",
    consolidationPeriod: CYFSA_PERIOD,
    effectiveFrom: "2018-04-30",
    effectiveTo: null,
    verificationSourceType: "BUNDLED_CONSOLIDATION_VERBATIM",
    verifiedDate: "2026-11-03",
    legalTestSummary: "Continues the Child and Family Services Review Board (CFSRB) with statutory review jurisdiction under sections 66, 119, 120, 192, and 265.",
    practiceNote: "The CFSRB is an administrative tribunal with strictly defined statutory jurisdiction; it cannot overturn Family Court orders."
  },
  // ---------------------------------------------------------------------------
  // FEDERAL STATUTE: Bill C-92 (S.C. 2019, c. 24) — Verbatim in legal-reference/Bill_C92_full_text.txt
  // ---------------------------------------------------------------------------
  {
    authorityId: "BILL_C92:10(1)",
    citation: "An Act respecting First Nations, Inuit and M\xE9tis children, youth and families, S.C. 2019, c. 24, s. 10(1)",
    instrument: "BILL_C92",
    statuteTitle: BILL_C92_TITLE,
    sectionKey: "10(1)",
    heading: "Best interests of Indigenous child",
    exactWording: "10(1) The best interests of the child must be a primary consideration in the making of decisions or the taking of actions in the context of the provision of child and family services in relation to an Indigenous child and, in the case of decisions or actions related to child apprehension, the best interests of the child must be the paramount consideration.",
    sourceUrl: "https://laws-lois.justice.gc.ca/eng/acts/F-11.73/",
    consolidationPeriod: "In force January 1, 2020 to Present (SI/2019-96)",
    effectiveFrom: "2020-01-01",
    effectiveTo: null,
    verificationSourceType: "BUNDLED_CONSOLIDATION_VERBATIM",
    verifiedDate: "2026-11-03",
    legalTestSummary: "Makes the best interests of an Indigenous child a primary consideration in child and family service decisions and the paramount consideration in apprehension decisions.",
    practiceNote: "Applies as binding federal minimum national standards across Ontario child protection proceedings involving First Nations, Inuit, and M\xE9tis children."
  },
  {
    authorityId: "BILL_C92:12(1)",
    citation: "An Act respecting First Nations, Inuit and M\xE9tis children, youth and families, S.C. 2019, c. 24, s. 12(1)",
    instrument: "BILL_C92",
    statuteTitle: BILL_C92_TITLE,
    sectionKey: "12(1)",
    heading: "Notice to parent, care provider, and Indigenous governing body before significant measures",
    exactWording: "12(1) In the context of providing child and family services in relation to an Indigenous child, to the extent that doing so is consistent with the best interests of the child, before taking any significant measure in relation to the child, the service provider must provide notice of the measure to the child's parent and the care provider, as well as to the Indigenous governing body that acts on behalf of the Indigenous group, community or people to which the child belongs and that has informed the service provider that they are acting on behalf of that Indigenous group, community or people.",
    sourceUrl: "https://laws-lois.justice.gc.ca/eng/acts/F-11.73/",
    consolidationPeriod: "In force January 1, 2020 to Present (SI/2019-96)",
    effectiveFrom: "2020-01-01",
    effectiveTo: null,
    verificationSourceType: "BUNDLED_CONSOLIDATION_VERBATIM",
    verifiedDate: "2026-11-03",
    legalTestSummary: "Requires advance notice to the parent, care provider, and applicable Indigenous governing body before taking any significant measure in relation to an Indigenous child.",
    practiceNote: "Verify in the court record when and how notice under s. 12(1) was delivered before any significant measure was taken."
  },
  {
    authorityId: "BILL_C92:14(1)",
    citation: "An Act respecting First Nations, Inuit and M\xE9tis children, youth and families, S.C. 2019, c. 24, s. 14(1)",
    instrument: "BILL_C92",
    statuteTitle: BILL_C92_TITLE,
    sectionKey: "14(1)",
    heading: "Priority to preventive care",
    exactWording: "14(1) In the context of providing child and family services in relation to an Indigenous child, to the extent that providing a service that promotes preventive care to support the child's family is consistent with the best interests of the child, the provision of that service is to be given priority over other services.",
    sourceUrl: "https://laws-lois.justice.gc.ca/eng/acts/F-11.73/",
    consolidationPeriod: "In force January 1, 2020 to Present (SI/2019-96)",
    effectiveFrom: "2020-01-01",
    effectiveTo: null,
    verificationSourceType: "BUNDLED_CONSOLIDATION_VERBATIM",
    verifiedDate: "2026-11-03",
    legalTestSummary: "Mandates that preventive care services to support an Indigenous child's family be given priority over other services where consistent with the child's best interests.",
    practiceNote: "Operates alongside s. 15 (no apprehension solely on socio-economic conditions) and s. 15.1 (reasonable efforts required before apprehension)."
  },
  {
    authorityId: "BILL_C92:15",
    citation: "An Act respecting First Nations, Inuit and M\xE9tis children, youth and families, S.C. 2019, c. 24, s. 15",
    instrument: "BILL_C92",
    statuteTitle: BILL_C92_TITLE,
    sectionKey: "15",
    heading: "No apprehension based solely on socio-economic conditions",
    exactWording: "15 In the context of providing child and family services in relation to an Indigenous child, to the extent that it is consistent with the best interests of the child, the child must not be apprehended solely on the basis of his or her socio-economic conditions, including poverty, lack of adequate housing or infrastructure or the state of health of his or her parent or the care provider.",
    sourceUrl: "https://laws-lois.justice.gc.ca/eng/acts/F-11.73/",
    consolidationPeriod: "In force January 1, 2020 to Present (SI/2019-96)",
    effectiveFrom: "2020-01-01",
    effectiveTo: null,
    verificationSourceType: "BUNDLED_CONSOLIDATION_VERBATIM",
    verifiedDate: "2026-11-03",
    legalTestSummary: "Prohibits apprehending an Indigenous child solely on the basis of socio-economic conditions, including poverty, lack of adequate housing or infrastructure, or parental state of health.",
    practiceNote: "Applies directly where an affidavit relies on housing inadequacy, poverty, or parental health status without independent protection grounds."
  },
  {
    authorityId: "BILL_C92:15.1",
    citation: "An Act respecting First Nations, Inuit and M\xE9tis children, youth and families, S.C. 2019, c. 24, s. 15.1",
    instrument: "BILL_C92",
    statuteTitle: BILL_C92_TITLE,
    sectionKey: "15.1",
    heading: "Reasonable efforts required before apprehension",
    exactWording: "15.1 In the context of providing child and family services in relation to an Indigenous child, unless immediate apprehension is consistent with the best interests of the child, before apprehending a child who resides with one of the child's parents or another adult member of the child's family, the service provider must demonstrate that he or she made reasonable efforts to have the child continue to reside with that person.",
    sourceUrl: "https://laws-lois.justice.gc.ca/eng/acts/F-11.73/",
    consolidationPeriod: "In force January 1, 2020 to Present (SI/2019-96)",
    effectiveFrom: "2020-01-01",
    effectiveTo: null,
    verificationSourceType: "BUNDLED_CONSOLIDATION_VERBATIM",
    verifiedDate: "2026-11-03",
    legalTestSummary: "Requires the service provider to demonstrate that reasonable efforts were made to have an Indigenous child continue to reside with their parent or adult family member before apprehension, unless immediate apprehension is consistent with the child's best interests.",
    practiceNote: "Places an affirmative evidentiary burden on the service provider to document reasonable pre-apprehension efforts."
  },
  {
    authorityId: "BILL_C92:16(1)",
    citation: "An Act respecting First Nations, Inuit and M\xE9tis children, youth and families, S.C. 2019, c. 24, s. 16(1)",
    instrument: "BILL_C92",
    statuteTitle: BILL_C92_TITLE,
    sectionKey: "16(1)",
    heading: "Placement of Indigenous child \u2014 Priority order",
    exactWording: "16(1) The placement of an Indigenous child in the context of providing child and family services in relation to the child, to the extent that it is consistent with the best interests of the child, is to occur in the following order of priority: (a) with one of the child's parents; (b) with another adult member of the child's family; (c) with an adult who belongs to the same Indigenous group, community or people as the child; (d) with an adult who belongs to an Indigenous group, community or people other than the one to which the child belongs; or (e) with any other adult.",
    sourceUrl: "https://laws-lois.justice.gc.ca/eng/acts/F-11.73/",
    consolidationPeriod: "In force January 1, 2020 to Present (SI/2019-96)",
    effectiveFrom: "2020-01-01",
    effectiveTo: null,
    verificationSourceType: "BUNDLED_CONSOLIDATION_VERBATIM",
    verifiedDate: "2026-11-03",
    legalTestSummary: "Establishes a five-tier federal placement priority order for an Indigenous child, starting with (a) a parent and (b) another adult member of the child's family.",
    practiceNote: "Requires the Society to document why higher-priority placements in s. 16(1)(a)-(d) were not used before placing a child under (e)."
  },
  // ---------------------------------------------------------------------------
  // FAMILY LAW RULES (O. Reg. 114/99) — Distinct category, never in CYFSA allowlist
  // ---------------------------------------------------------------------------
  {
    authorityId: "FLR:1(8)",
    citation: "Family Law Rules, O. Reg. 114/99, Rule 1(8)",
    instrument: "FAMILY_LAW_RULES",
    statuteTitle: FLR_TITLE,
    sectionKey: "1(8)",
    heading: "Failure to obey order",
    exactWording: "1 (8) If a person fails to obey an order in a case or a related case, the court may deal with the failure by making any order that it considers necessary for a just determination of the matter, including, (a) an order for costs; (b) an order dismissing a claim; (c) an order striking out any application, answer, notice of motion, motion to change, response to motion to change, financial statement, affidavit, or any other document filed by a party; (d) an order that all or part of a document that was required to be provided but was not, may not be used in the case; (e) an order that a party is not entitled to any further order from the court unless the court orders otherwise; (f) an order postponing the trial or any other step in the case; and (g) on motion, a contempt order.",
    sourceUrl: "https://www.ontario.ca/laws/regulation/990114#BK1",
    consolidationPeriod: "Consolidation period: In Force (O. Reg. 114/99, r. 1(8), as amended by O. Reg. 322/13, s. 1 and O. Reg. 298/18, s. 2)",
    effectiveFrom: "1999-09-15",
    effectiveTo: null,
    verificationSourceType: "REGULATION_REFERENCE_SUMMARY",
    verifiedDate: "2026-11-03",
    legalTestSummary: "Empowers the court to deal with a failure to obey an order in a case or a related case by making any order necessary for a just determination, including costs, dismissing a claim, striking documents, prohibiting use of undisclosed documents, postponing steps, or (on motion) a contempt order.",
    practiceNote: "Distinguish Rule 1(8) (failure to obey a court order) from Rule 1(8.1) (failure to follow the Family Law Rules, which excludes contempt under clause (g)). In child protection proceedings, courts exercise extreme caution before striking a parent's participation given the child's best interests."
  },
  {
    authorityId: "FLR:14(18)",
    citation: "Family Law Rules, O. Reg. 114/99, Rule 14(18)",
    instrument: "FAMILY_LAW_RULES",
    statuteTitle: FLR_TITLE,
    sectionKey: "14(18)",
    heading: "Affidavit evidence on motions \u2014 Information and belief",
    exactWording: "14 (18) An affidavit for use on a motion shall, as much as possible, contain only information within the personal knowledge of the person signing the affidavit, except as subrule (19) provides regarding information and belief.",
    sourceUrl: "https://www.ontario.ca/laws/regulation/990114#BK20",
    consolidationPeriod: "Consolidation period: In Force (O. Reg. 114/99; full text not bundled in local corpus)",
    effectiveFrom: "1999-09-15",
    effectiveTo: null,
    verificationSourceType: "REGULATION_REFERENCE_SUMMARY",
    verifiedDate: "2026-11-03",
    legalTestSummary: "Requires motion affidavits to contain personal firsthand knowledge as much as possible; under subrule 14(19), information and belief is permitted only if the source of the information and the fact that the affiant believes it to be true are stated.",
    practiceNote: "When an affidavit relies on secondhand information without identifying the source and stating belief in its truth, or relies on anonymous/double hearsay on contested issues, challenge its weight under Rule 14(18)-(19)."
  },
  {
    authorityId: "FLR:14(19)",
    citation: "Family Law Rules, O. Reg. 114/99, Rule 14(19)",
    instrument: "FAMILY_LAW_RULES",
    statuteTitle: FLR_TITLE,
    sectionKey: "14(19)",
    heading: "Affidavit evidence on motions \u2014 Information from other person",
    exactWording: "14 (19) The affidavit may also contain information that the person learned from someone else, but only if, (a) the source of the information is identified by name and the affidavit states that the person signing it believes the information is true; and (b) in addition, if the motion is a contempt motion under rule 31, the information is not likely to be disputed.",
    sourceUrl: "https://www.ontario.ca/laws/regulation/990114#BK20",
    consolidationPeriod: "Consolidation period: In Force (O. Reg. 114/99; full text not bundled in local corpus)",
    effectiveFrom: "1999-09-15",
    effectiveTo: null,
    verificationSourceType: "REGULATION_REFERENCE_SUMMARY",
    verifiedDate: "2026-11-03",
    legalTestSummary: "Permits secondhand information (information and belief) in a motion affidavit only if the source is identified by name and the affiant states a belief that the information is true.",
    practiceNote: "Even where formally admissible under Rule 14(19), uncorroborated hearsay on disputed central facts carries reduced evidentiary weight."
  },
  {
    authorityId: "FLR:33",
    citation: "Family Law Rules, O. Reg. 114/99, Rule 33",
    instrument: "FAMILY_LAW_RULES",
    statuteTitle: FLR_TITLE,
    sectionKey: "33",
    heading: "Child protection timetable and procedures",
    exactWording: "Rule 33 governs child protection proceedings and prescribed procedural timetables under the Family Law Rules, O. Reg. 114/99 (reference summary; full regulation text not bundled in local corpus).",
    sourceUrl: "https://www.ontario.ca/laws/regulation/990114",
    consolidationPeriod: "Consolidation period: In Force (O. Reg. 114/99; full text not bundled in local corpus)",
    effectiveFrom: "1999-09-15",
    effectiveTo: null,
    verificationSourceType: "REGULATION_REFERENCE_SUMMARY",
    verifiedDate: "2026-11-03",
    legalTestSummary: "Establishes the procedural timetable and filing rules for child protection cases in Ontario family court.",
    practiceNote: "Confirm current local practice directions and Rule 33 deadlines with counsel or the court office."
  },
  // ---------------------------------------------------------------------------
  // CHARTER PROVISIONS — Distinct category, never in CYFSA allowlist
  // ---------------------------------------------------------------------------
  {
    authorityId: "CHARTER:7",
    citation: "Canadian Charter of Rights and Freedoms, Section 7",
    instrument: "CHARTER",
    statuteTitle: CHARTER_TITLE,
    sectionKey: "7",
    heading: "Life, liberty and security of the person",
    exactWording: "7. Everyone has the right to life, liberty and security of the person and the right not to be deprived thereof except in accordance with the principles of fundamental justice.",
    sourceUrl: "https://laws-lois.justice.gc.ca/eng/const/page-12.html",
    consolidationPeriod: "Constitutional Law of Canada (in force April 17, 1982)",
    effectiveFrom: "1982-04-17",
    effectiveTo: null,
    verificationSourceType: "CONSTITUTIONAL_TEXT",
    verifiedDate: "2026-11-03",
    legalTestSummary: "Guarantees that state interference with parental custody and the parent-child bond engages security of the person and must accord with the principles of fundamental justice (New Brunswick (Minister of Health and Community Services) v. G. (J.), [1999] 3 S.C.R. 46).",
    practiceNote: "State-imposed child removal or access restriction requires a fair process and adherence to statutory safeguards."
  },
  {
    authorityId: "CHARTER:15",
    citation: "Canadian Charter of Rights and Freedoms, Section 15(1)",
    instrument: "CHARTER",
    statuteTitle: CHARTER_TITLE,
    sectionKey: "15",
    heading: "Equality before and under law and equal protection and benefit of law",
    exactWording: "15. (1) Every individual is equal before and under the law and has the right to the equal protection and equal benefit of the law without discrimination and, in particular, without discrimination based on race, national or ethnic origin, colour, religion, sex, age or mental or physical disability.",
    sourceUrl: "https://laws-lois.justice.gc.ca/eng/const/page-12.html",
    consolidationPeriod: "Constitutional Law of Canada (in force April 17, 1985)",
    effectiveFrom: "1985-04-17",
    effectiveTo: null,
    verificationSourceType: "CONSTITUTIONAL_TEXT",
    verifiedDate: "2026-11-03",
    legalTestSummary: "Protects equality before and under the law without discrimination based on enumerated or analogous grounds, including disability, race, and ethnic origin.",
    practiceNote: "Relevant where parenting assessments or service delivery fail to accommodate parental disability or cultural background."
  },
  {
    authorityId: "CHARTER:24(1)",
    citation: "Canadian Charter of Rights and Freedoms, Section 24(1)",
    instrument: "CHARTER",
    statuteTitle: CHARTER_TITLE,
    sectionKey: "24(1)",
    heading: "Enforcement of guaranteed rights and freedoms",
    exactWording: "24. (1) Anyone whose rights or freedoms, as guaranteed by this Charter, have been infringed or denied may apply to a court of competent jurisdiction to obtain such remedy as the court considers appropriate and just in the circumstances.",
    sourceUrl: "https://laws-lois.justice.gc.ca/eng/const/page-12.html",
    consolidationPeriod: "Constitutional Law of Canada (in force April 17, 1982)",
    effectiveFrom: "1982-04-17",
    effectiveTo: null,
    verificationSourceType: "CONSTITUTIONAL_TEXT",
    verifiedDate: "2026-11-03",
    legalTestSummary: "Authorizes an individual whose Charter rights or freedoms (such as s. 7 security of the person or s. 15 equality) have been infringed or denied by state action to apply to a court of competent jurisdiction for an appropriate and just remedy.",
    practiceNote: "Section 24(1) is a remedial provision, not an independent substantive right; it requires proving an infringement of a substantive Charter guarantee (such as s. 7 or s. 15) before a court with statutory jurisdiction over the parties, subject matter, and remedy sought."
  },
  // ---------------------------------------------------------------------------
  // ONTARIO CHILD PROTECTION STANDARDS (2016) — Ministry operational standards
  // Distinct category (CAS_STANDARD), never placed in INTERNAL_CYFSA_SECTION_KEYS.
  // Explicitly distinguishes mandatory Standard text from Practice Notes.
  // ---------------------------------------------------------------------------
  {
    authorityId: "OCPS:ALL_PHASES",
    citation: "Ontario Child Protection Standards (2016), Standards for All Phases of Child Protection Service Delivery",
    instrument: "CAS_STANDARD",
    statuteTitle: "Ontario Child Protection Standards (2016) (Ministry of Children, Community and Social Services)",
    sectionKey: "ALL_PHASES",
    heading: "Standards for All Phases \u2014 Family-Centred Service, Cultural & Religious Considerations, Contemporaneous Case Notes, and Supervision",
    exactWording: "Standards for All Phases of Child Protection Service Delivery (effective February 1, 2016; originally issued under the former Child and Family Services Act, R.S.O. 1990, c. C.11 and continued as operative ministry standards under CYFSA s. 35(2) and O. Reg. 156/18): (A) Child and Family Engagement and Participation; (B) Service to First Nations, Inuit and M\xE9tis Children and Families; (C) Anti-Oppressive Practice, Diversity and Inclusion; (D) French Language Services; (E) Alternative Dispute Resolution; (F) Differential Response; (G) Documentation and Contemporaneous Case Notes (requiring objective, factual, contemporaneous recording of date/time, method of contact, participants, significant discussions, observations, worker identity, date of note creation, supervisory consultations, and non-obliterating addenda); (H) Supervisory Consultation and Approval.",
    sourceUrl: "https://www.ontario.ca/page/ontario-child-protection-standards-2016",
    consolidationPeriod: "Effective February 1, 2016 to Present (issued under former CFSA; operative under CYFSA s. 35(2) / O. Reg. 156/18)",
    effectiveFrom: "2016-02-01",
    effectiveTo: null,
    verificationSourceType: "MINISTRY_STANDARD_SUMMARY",
    verifiedDate: "2026-11-03",
    legalTestSummary: "Establishes mandatory operational standards across all phases of child protection service delivery, including family engagement, contemporaneous case-note documentation, and supervisory consultation.",
    practiceNote: "Always distinguish text labeled 'Standard' (mandatory agency operational requirement) from 'Practice Notes' (professional guidance without the same mandatory force). Note that the 2016 Standards contain historical references to the former CFSA; current statutory authority derives from CYFSA s. 35(2) and O. Reg. 156/18."
  },
  {
    authorityId: "OCPS:STD_1",
    citation: "Ontario Child Protection Standards (2016), Standard 1 (Receipt of Report or Referral)",
    instrument: "CAS_STANDARD",
    statuteTitle: "Ontario Child Protection Standards (2016) (Ministry of Children, Community and Social Services)",
    sectionKey: "STD_1",
    heading: "Standard 1 \u2014 Receipt of Report or Referral and Eligibility Spectrum Screening",
    exactWording: "Standard 1 (Receipt of Report or Referral): The society shall receive and screen all reports and referrals concerning children who may be in need of protection using the Ontario Child Welfare Eligibility Spectrum, check prior agency/provincial child welfare history within 24 hours, determine response time (12 hours for immediate/extremely severe or 7 days for moderately severe), and obtain supervisory approval for the screening disposition.",
    sourceUrl: "https://www.ontario.ca/page/ontario-child-protection-standards-2016",
    consolidationPeriod: "Effective February 1, 2016 to Present",
    effectiveFrom: "2016-02-01",
    effectiveTo: null,
    verificationSourceType: "MINISTRY_STANDARD_SUMMARY",
    verifiedDate: "2026-11-03",
    legalTestSummary: "Requires Eligibility Spectrum screening, 24-hour child welfare history check, assignment of response priority (12 hours or 7 days), and supervisory approval of screening disposition.",
    practiceNote: "Separate the mandatory Standard requirements from Practice Notes on intake interviewing."
  },
  {
    authorityId: "OCPS:STD_2",
    citation: "Ontario Child Protection Standards (2016), Standard 2 (Planning and Conducting a Child Protection Investigation)",
    instrument: "CAS_STANDARD",
    statuteTitle: "Ontario Child Protection Standards (2016) (Ministry of Children, Community and Social Services)",
    sectionKey: "STD_2",
    heading: "Standard 2 \u2014 Planning and Conducting a Child Protection Investigation",
    exactWording: "Standard 2 (Planning and Conducting a Child Protection Investigation): The child protection worker shall develop an investigation plan in consultation with a supervisor (including whether a customized or traditional investigative response applies, Joint Police-CAS Protocol considerations, and FNIM band/community notice/consultation), conduct face-to-face interviews with the victim child, siblings, parents/caregivers, and collaterals, observe the home environment where relevant, and document supervisory approval for any departure from required response times.",
    sourceUrl: "https://www.ontario.ca/page/ontario-child-protection-standards-2016",
    consolidationPeriod: "Effective February 1, 2016 to Present",
    effectiveFrom: "2016-02-01",
    effectiveTo: null,
    verificationSourceType: "MINISTRY_STANDARD_SUMMARY",
    verifiedDate: "2026-11-03",
    legalTestSummary: "Mandates pre-investigation planning, face-to-face child and caregiver interviews, collateral verification, and supervisory consultation/approval for departures from response timeframes.",
    practiceNote: "Check whether the investigative record documents interviews with both parents and relevant neutral collaterals, or whether a one-sided account was accepted without verification."
  },
  {
    authorityId: "OCPS:STD_3",
    citation: "Ontario Child Protection Standards (2016), Standard 3 (Assessing Safety)",
    instrument: "CAS_STANDARD",
    statuteTitle: "Ontario Child Protection Standards (2016) (Ministry of Children, Community and Social Services)",
    sectionKey: "STD_3",
    heading: "Standard 3 \u2014 Assessing Immediate Child Safety and Safety Plans",
    exactWording: "Standard 3 (Assessing Safety): The worker shall conduct an initial Safety Assessment at the first face-to-face contact with the child and family. Where immediate safety threats are identified, the worker shall develop a least-intrusive Safety Plan in collaboration with the family and extended network where safe to do so, assess the feasibility and reliability of safety-plan participants, and obtain immediate supervisory approval of the Safety Assessment and Safety Plan.",
    sourceUrl: "https://www.ontario.ca/page/ontario-child-protection-standards-2016",
    consolidationPeriod: "Effective February 1, 2016 to Present",
    effectiveFrom: "2016-02-01",
    effectiveTo: null,
    verificationSourceType: "MINISTRY_STANDARD_SUMMARY",
    verifiedDate: "2026-11-03",
    legalTestSummary: "Requires a formal Safety Assessment at first face-to-face contact, collaborative consideration of in-home or kinship safety-plan interventions before removal where safe, and immediate supervisory approval.",
    practiceNote: "Examine whether an in-home or family-network safety plan was evaluated and documented under Standard 3 before removal."
  },
  {
    authorityId: "OCPS:STD_4",
    citation: "Ontario Child Protection Standards (2016), Standard 4 (Assessing Risk of Future Harm)",
    instrument: "CAS_STANDARD",
    statuteTitle: "Ontario Child Protection Standards (2016) (Ministry of Children, Community and Social Services)",
    sectionKey: "STD_4",
    heading: "Standard 4 \u2014 Actuarial Risk Assessment prior to Investigation Conclusion",
    exactWording: "Standard 4 (Assessing Risk): Prior to concluding a child protection investigation or transferring a case to ongoing services, the worker shall complete the prescribed Risk Assessment tool evaluating future risk of maltreatment, clinical factors, and family strengths/protective capacities, and obtain supervisory review and approval.",
    sourceUrl: "https://www.ontario.ca/page/ontario-child-protection-standards-2016",
    consolidationPeriod: "Effective February 1, 2016 to Present",
    effectiveFrom: "2016-02-01",
    effectiveTo: null,
    verificationSourceType: "MINISTRY_STANDARD_SUMMARY",
    verifiedDate: "2026-11-03",
    legalTestSummary: "Requires completion and supervisory approval of the standardized Risk Assessment tool before concluding an investigation or transferring to ongoing service.",
    practiceNote: "Distinguish immediate safety threats (Standard 3) from actuarial/clinical risk of future harm (Standard 4)."
  },
  {
    authorityId: "OCPS:STD_5",
    citation: "Ontario Child Protection Standards (2016), Standard 5 (Concluding a Child Protection Investigation)",
    instrument: "CAS_STANDARD",
    statuteTitle: "Ontario Child Protection Standards (2016) (Ministry of Children, Community and Social Services)",
    sectionKey: "STD_5",
    heading: "Standard 5 \u2014 Verification Decision and Concluding Investigation (45-Day Standard)",
    exactWording: "Standard 5 (Concluding a Child Protection Investigation): The worker shall reach a verification decision (verified, not verified, or inconclusive) based on a balance of probabilities (credible and probable evidence), determine the investigation disposition, complete investigation documentation within 45 days of referral (unless a supervisor approves a documented extension), obtain supervisory approval, and notify the parents and age-appropriate child of the outcome and reasons.",
    sourceUrl: "https://www.ontario.ca/page/ontario-child-protection-standards-2016",
    consolidationPeriod: "Effective February 1, 2016 to Present",
    effectiveFrom: "2016-02-01",
    effectiveTo: null,
    verificationSourceType: "MINISTRY_STANDARD_SUMMARY",
    verifiedDate: "2026-11-03",
    legalTestSummary: "Requires an evidence-based verification decision, completion within 45 days (absent supervisor-approved extension), supervisory sign-off, and notice of outcome and reasons to the family.",
    practiceNote: "A verification decision by CAS is an internal administrative determination under Standard 5, NOT a judicial finding under CYFSA s. 74(2)."
  },
  {
    authorityId: "OCPS:STD_6",
    citation: "Ontario Child Protection Standards (2016), Standard 6 (Transferring a Case)",
    instrument: "CAS_STANDARD",
    statuteTitle: "Ontario Child Protection Standards (2016) (Ministry of Children, Community and Social Services)",
    sectionKey: "STD_6",
    heading: "Standard 6 \u2014 Case Transfer to Ongoing Services or Another Society",
    exactWording: "Standard 6 (Transferring a Case): When a case is transferred from investigation to ongoing services (or between workers/societies), a transfer conference/meeting involving the transferring worker, receiving worker, supervisor(s), and the family (where appropriate) shall occur, and transfer documentation shall be completed and approved by the supervisor.",
    sourceUrl: "https://www.ontario.ca/page/ontario-child-protection-standards-2016",
    consolidationPeriod: "Effective February 1, 2016 to Present",
    effectiveFrom: "2016-02-01",
    effectiveTo: null,
    verificationSourceType: "MINISTRY_STANDARD_SUMMARY",
    verifiedDate: "2026-11-03",
    legalTestSummary: "Governs structured handoff, family involvement in transfer conferencing, and supervisory approval when transferring a file into ongoing child protection services.",
    practiceNote: "The date of investigation completion or case transfer under Standards 5\u20136 triggers the 30-day deadline for the initial Ongoing Service Plan under Standard 7."
  },
  {
    authorityId: "OCPS:STD_7",
    citation: "Ontario Child Protection Standards (2016), Standard 7 (Ongoing Service Case Management)",
    instrument: "CAS_STANDARD",
    statuteTitle: "Ontario Child Protection Standards (2016) (Ministry of Children, Community and Social Services)",
    sectionKey: "STD_7",
    heading: "Standard 7 \u2014 Ongoing Service Case Management, 30-Day Service Plan, Monitoring, and Reunification Review",
    exactWording: "Standard 7 (Ongoing Service Case Management): Within 30 days of completion of the investigation or case transfer to ongoing services, the worker shall complete a Family and Child Strengths and Needs Assessment and develop an initial written Service Plan in collaboration with the parents, child (as age-appropriate), extended family/community, and FNIM representatives where applicable. The Service Plan must specify clear protection outcomes, specific activities, responsible persons (parent, worker, community provider), completion timeframes, and concrete service referrals. The worker shall conduct at least monthly face-to-face contact with the child and parents (including home visits), coordinate and monitor service accessibility and progress, conduct formal reassessments and Service Plan reviews at least every 6 months (or upon a significant change in circumstances), evaluate reunification readiness and concurrent planning where the child is out of home, and obtain supervisory review and approval.",
    sourceUrl: "https://www.ontario.ca/page/ontario-child-protection-standards-2016",
    consolidationPeriod: "Effective February 1, 2016 to Present",
    effectiveFrom: "2016-02-01",
    effectiveTo: null,
    verificationSourceType: "MINISTRY_STANDARD_SUMMARY",
    verifiedDate: "2026-11-03",
    legalTestSummary: "Mandates an initial written Service Plan and Strengths-and-Needs Assessment within 30 days of investigation completion or case transfer (NOT measured from removal date alone), parent participation, clear goals/responsibilities/timeframes, active referral coordination, monthly home/face-to-face contact, 6-month formal case reviews, reunification assessment, and supervisory sign-off.",
    practiceNote: "If the investigation completion date or case transfer date is not documented in the uploaded record, the 30-day Standard 7 service-plan deadline is DEADLINE_NOT_DETERMINABLE and must never be fabricated from the apprehension date alone."
  },
  {
    authorityId: "OCPS:STD_8",
    citation: "Ontario Child Protection Standards (2016), Standard 8 (Ending Child Protection Services)",
    instrument: "CAS_STANDARD",
    statuteTitle: "Ontario Child Protection Standards (2016) (Ministry of Children, Community and Social Services)",
    sectionKey: "STD_8",
    heading: "Standard 8 \u2014 Ending Child Protection Services and Case Closure",
    exactWording: "Standard 8 (Ending Child Protection Services): Before closing an ongoing child protection case, the worker shall conduct a final safety and risk evaluation, review service-plan outcomes with the family, link the family to ongoing community supports where desired, notify the family in writing of case closure, and obtain supervisory approval.",
    sourceUrl: "https://www.ontario.ca/page/ontario-child-protection-standards-2016",
    consolidationPeriod: "Effective February 1, 2016 to Present",
    effectiveFrom: "2016-02-01",
    effectiveTo: null,
    verificationSourceType: "MINISTRY_STANDARD_SUMMARY",
    verifiedDate: "2026-11-03",
    legalTestSummary: "Requires a final safety/risk review, transition to community supports, family notification, and supervisory approval prior to ending ongoing child protection services.",
    practiceNote: "Compare documented exit criteria in the Society's Plan of Care (CYFSA s. 100(b)) against the Standard 8 closure criteria."
  },
  // ---------------------------------------------------------------------------
  // OCSWSSW PROFESSIONAL STANDARDS — Social Work and Social Service Work Act, 1998
  // Distinct category (PROFESSIONAL_STANDARD), applicable ONLY where registration is verified.
  // ---------------------------------------------------------------------------
  {
    authorityId: "OCSWSSW:REGISTRATION",
    citation: "Social Work and Social Service Work Act, 1998, S.O. 1998, c. 31, ss. 46\u201347 & OCSWSSW Code of Ethics",
    instrument: "PROFESSIONAL_STANDARD",
    statuteTitle: "Social Work and Social Service Work Act, 1998, S.O. 1998, c. 31",
    sectionKey: "REGISTRATION",
    heading: "OCSWSSW Registration Scope and Restricted Titles (RSW / RSSW)",
    exactWording: "Under the Social Work and Social Service Work Act, 1998, S.O. 1998, c. 31, ss. 46\u201347, only individuals registered with the Ontario College of Social Workers and Social Service Workers (OCSWSSW) may use the title 'social worker', 'registered social worker' (RSW), 'social service worker', or 'registered social service worker' (RSSW) or hold themselves out as such. OCSWSSW professional discipline and standards apply to registered members of the College.",
    sourceUrl: "https://www.ontario.ca/laws/statute/98s31",
    consolidationPeriod: "In Force (S.O. 1998, c. 31)",
    effectiveFrom: "2000-08-15",
    effectiveTo: null,
    verificationSourceType: "PROFESSIONAL_REGULATORY_STANDARD",
    verifiedDate: "2026-11-03",
    legalTestSummary: "Establishes that OCSWSSW regulatory jurisdiction, Code of Ethics, and Standards of Practice apply to registered members (RSW / RSSW) or individuals unlawfully holding themselves out as registered social workers / social service workers.",
    practiceNote: "Do NOT assume every CAS child protection worker is a registered social worker (RSW) or registered social service worker (RSSW); always verify registration on the public OCSWSSW Online Register first."
  },
  {
    authorityId: "OCSWSSW:PRIN_IV_RECORDS",
    citation: "OCSWSSW Code of Ethics and Standards of Practice, Principle IV (The Social Work and Social Service Work Record)",
    instrument: "PROFESSIONAL_STANDARD",
    statuteTitle: "OCSWSSW Code of Ethics and Standards of Practice (Second Edition)",
    sectionKey: "PRIN_IV_RECORDS",
    heading: "Principle IV \u2014 Professional Record-Keeping, Contemporaneous Recording, and Late Entries",
    exactWording: "OCSWSSW Standards of Practice, Principle IV (The Social Work and Social Service Work Record): College members must maintain clear, accurate, objective, and contemporaneous records of professional interventions, distinguish direct observations from third-party reports or professional opinions, identify the author and date of each entry, and never obliterate or backdate existing entries (any subsequent correction or addendum must be dated and signed as a late addition while preserving the original entry).",
    sourceUrl: "https://www.ocswssw.org/professional-practice/code-of-ethics-and-standards-of-practice/",
    consolidationPeriod: "In Force (OCSWSSW Standards of Practice)",
    effectiveFrom: "2008-09-01",
    effectiveTo: null,
    verificationSourceType: "PROFESSIONAL_REGULATORY_STANDARD",
    verifiedDate: "2026-11-03",
    legalTestSummary: "Requires OCSWSSW registrants (RSW/RSSW) to keep objective, contemporaneous records, separate fact from opinion, record entry dates, and make corrections only via dated addenda without altering original records.",
    practiceNote: "Applies where the worker or supervisor is a registered member of the OCSWSSW; operates alongside Ontario Child Protection Standards (2016) Standard G (Contemporaneous Case Notes)."
  },
  // ---------------------------------------------------------------------------
  // OVERSIGHT & REGULATIONS — Ombudsman Act & O. Reg. 155/18 / O. Reg. 156/18
  // ---------------------------------------------------------------------------
  {
    authorityId: "OVERSIGHT:OMBUDSMAN",
    citation: "Ombudsman Act, R.S.O. 1990, c. O.6, ss. 14(1.1), 14.0.1 (Children and Youth Unit)",
    instrument: "OVERSIGHT_PATHWAY",
    statuteTitle: "Ombudsman Act, R.S.O. 1990, c. O.6",
    sectionKey: "OMBUDSMAN",
    heading: "Ontario Ombudsman Oversight of Children's Aid Societies",
    exactWording: "Under the Ombudsman Act, R.S.O. 1990, c. O.6, ss. 14(1.1) and 14.0.1 (effective May 1, 2019, transferring investigative functions of the former Provincial Advocate for Children and Youth, and reinforced by CYFSA ss. 9.1 and 15.1), the Ontario Ombudsman has jurisdiction to investigate administrative conduct of children's aid societies and residential licensees regarding services sought or provided to children, young persons, and families.",
    sourceUrl: "https://www.ontario.ca/laws/statute/90o06",
    consolidationPeriod: "CAS oversight in force May 1, 2019 to Present (S.O. 2018, c. 17, Sched. 28)",
    effectiveFrom: "2019-05-01",
    effectiveTo: null,
    verificationSourceType: "REGULATION_REFERENCE_SUMMARY",
    verifiedDate: "2026-11-03",
    legalTestSummary: "Authorizes the Ontario Ombudsman to investigate administrative fairness, procedural failures, and systemic conduct of children's aid societies and residential licensees.",
    practiceNote: "The Ombudsman investigates administrative conduct and makes recommendations; the Ombudsman cannot act as legal counsel, adjudicate child protection proceedings, or overturn a court order."
  },
  {
    authorityId: "O_REG_155_18:COMPLAINTS",
    citation: "O. Reg. 155/18 (General Matters under the Authority of the LGIC), Complaints and Reviews",
    instrument: "REGULATION",
    statuteTitle: "O. Reg. 155/18 under the Child, Youth and Family Services Act, 2017",
    sectionKey: "155/18",
    heading: "Regulatory Timelines for CAS Internal Complaint Review Panel (ICRP) and CFSRB Reviews",
    exactWording: "Under O. Reg. 155/18 (made under the CYFSA, effective April 30, 2018), when a society receives a written complaint under CYFSA s. 119(1), it must determine eligibility and notify the complainant in writing within 7 days, convene an Internal Complaint Review Panel (ICRP) meeting within 14 days of confirming eligibility where sent to the panel, and issue a written summary of results within 14 days after the meeting.",
    sourceUrl: "https://www.ontario.ca/laws/regulation/180155",
    consolidationPeriod: "In force April 30, 2018 to Present (O. Reg. 155/18)",
    effectiveFrom: "2018-04-30",
    effectiveTo: null,
    verificationSourceType: "REGULATION_REFERENCE_SUMMARY",
    verifiedDate: "2026-11-03",
    legalTestSummary: "Prescribes the mandatory 7-day eligibility notice, 14-day ICRP hearing window, and 14-day post-meeting written decision timeline for internal CAS complaints under CYFSA s. 119.",
    practiceNote: "If the society misses these regulatory timeframes, the complainant may apply directly to the CFSRB under CYFSA s. 120(4), para. 2."
  },
  {
    authorityId: "O_REG_156_18:STANDARDS",
    citation: "O. Reg. 156/18 (General Matters under the Authority of the Minister), Child Protection Standards",
    instrument: "REGULATION",
    statuteTitle: "O. Reg. 156/18 under the Child, Youth and Family Services Act, 2017",
    sectionKey: "156/18",
    heading: "Prescribed Child Protection Standards and Eligibility Spectrum",
    exactWording: "Under O. Reg. 156/18 (made under the CYFSA, effective April 30, 2018), every children's aid society is required to use the Ontario Child Welfare Eligibility Spectrum and comply with the Ontario Child Protection Standards (2016) in performing its functions under CYFSA s. 35.",
    sourceUrl: "https://www.ontario.ca/laws/regulation/180156",
    consolidationPeriod: "In force April 30, 2018 to Present (O. Reg. 156/18)",
    effectiveFrom: "2018-04-30",
    effectiveTo: null,
    verificationSourceType: "REGULATION_REFERENCE_SUMMARY",
    verifiedDate: "2026-11-03",
    legalTestSummary: "Prescribes the Ontario Child Protection Standards (2016) and the Ontario Child Welfare Eligibility Spectrum as mandatory regulatory standards for children's aid societies under CYFSA s. 35(2).",
    practiceNote: "Provides the regulatory bridge making the 2016 Standards legally binding on societies under CYFSA s. 35(2)."
  }
];
var VERIFIED_AUTHORITIES_REGISTRY = {};
for (const entry of CORE_AUTHORITIES) {
  entry.id = entry.authorityId;
  entry.category = entry.instrument;
  VERIFIED_AUTHORITIES_REGISTRY[entry.authorityId] = entry;
  if (entry.instrument === "CYFSA") {
    VERIFIED_AUTHORITIES_REGISTRY[entry.sectionKey] = entry;
  }
}
VERIFIED_AUTHORITIES_REGISTRY["125"] = VERIFIED_AUTHORITIES_REGISTRY["CYFSA:125(1)"];
VERIFIED_AUTHORITIES_REGISTRY["FLR_1_8"] = VERIFIED_AUTHORITIES_REGISTRY["FLR:1(8)"];
VERIFIED_AUTHORITIES_REGISTRY["FLR_14_18"] = VERIFIED_AUTHORITIES_REGISTRY["FLR:14(18)"];
VERIFIED_AUTHORITIES_REGISTRY["FLR_14_19"] = VERIFIED_AUTHORITIES_REGISTRY["FLR:14(19)"];
VERIFIED_AUTHORITIES_REGISTRY["CHARTER_7"] = VERIFIED_AUTHORITIES_REGISTRY["CHARTER:7"];
VERIFIED_AUTHORITIES_REGISTRY["CHARTER_15"] = VERIFIED_AUTHORITIES_REGISTRY["CHARTER:15"];
VERIFIED_AUTHORITIES_REGISTRY["CHARTER_24_1"] = VERIFIED_AUTHORITIES_REGISTRY["CHARTER:24(1)"];
VERIFIED_AUTHORITIES_REGISTRY["CHARTER:24"] = VERIFIED_AUTHORITIES_REGISTRY["CHARTER:24(1)"];
VERIFIED_AUTHORITIES_REGISTRY["BILL_C92:10"] = VERIFIED_AUTHORITIES_REGISTRY["BILL_C92:10(1)"];
VERIFIED_AUTHORITIES_REGISTRY["BILL_C92:12"] = VERIFIED_AUTHORITIES_REGISTRY["BILL_C92:12(1)"];
VERIFIED_AUTHORITIES_REGISTRY["BILL_C92:14"] = VERIFIED_AUTHORITIES_REGISTRY["BILL_C92:14(1)"];
VERIFIED_AUTHORITIES_REGISTRY["BILL_C92:16"] = VERIFIED_AUTHORITIES_REGISTRY["BILL_C92:16(1)"];
function normalizeClauseAbbreviations(input) {
  return input.replace(/\b(s|ss|sec|sub|subs|para|r|c|O|S|R|Reg|Sched)\./gi, "$1 ");
}
function evaluateSection102Proposition(prop) {
  const reason = "CYFSA s. 102(1) governs custody orders (deemed parenting/contact orders under CLRA s. 28) granted instead of an order under s. 101(1). Supervision orders are governed by CYFSA s. 101(1), para. 1 (and s. 94(2)(b)-(c) on adjournment or s. 116(1)(a) on status review).";
  const norm = normalizeClauseAbbreviations(prop);
  if (/\b102(?:\(\d+\))?\s+(?:society\s+|temporary\s+|final\s+)?supervision\s+order\b|\bsupervision\s+order(?:s)?\s*\(\s*(?:CYFSA\s*,?\s*)?(?:s(?:ec(?:tion)?)?\s*|subsection\s+)?102(?:\(\d+\))?\s*\)|\bsupervision\s+order(?:s)?\s+(?:under|pursuant\s+to|in|per|by\s+virtue\s+of|governed\s+by)\s+(?:the\s+)?(?:CYFSA\s*,?\s*)?(?:s(?:ec(?:tion)?)?\s*|subsection\s+)?102(?:\(\d+\))?(?!\w)/i.test(
    norm
  )) {
    return { misapplied: true, reason };
  }
  if (/(?:(?:under|pursuant\s+to|in|per)\s+)?(?:CYFSA\s*,?\s*)?(?:s(?:ec(?:tion)?)?\s*|subsection\s+)102(?:\(\d+\))?(?:(?!\b(?:instead\s+of|rather\s+than|as\s+opposed\s+to|unlike|whereas|while|distinguished\s+from|distinct\s+from)\b)[^.;])*?\b(?:governs?|authorizes?|provides?\s+for|permits?|is\s+(?:a\s+)?|makes?\s+(?:a\s+)?|made\s+(?:a\s+)?|grants?\s+(?:a\s+)?|granted\s+(?:a\s+)?|imposes?\s+(?:a\s+)?|orders?\s+(?:a\s+)?|places?\s+[^.;]{1,35}\bunder\s+(?:a\s+)?)(?:an?\s+|temporary\s+|final\s+|society\s+|\d+-month\s+)?supervision\s+order\b/i.test(
    norm
  )) {
    return { misapplied: true, reason };
  }
  if (/\b102(?:\(\d+\))?(?:(?!\b(?:instead\s+of|rather\s+than|as\s+opposed\s+to|unlike|whereas|while)\b)[^.;])*?\b(?:custody\s+(?:order\s+)?(?:or|and)\s+(?:a\s+|society\s+)?supervision\s+order|supervision\s+(?:order\s+)?(?:or|and)\s+(?:a\s+)?custody\s+order)\b/i.test(
    norm
  )) {
    return { misapplied: true, reason };
  }
  if (/\bsupervision\s+order\b/i.test(norm) && !/\bcustody\b/i.test(norm)) {
    return { misapplied: true, reason };
  }
  return { misapplied: false, reason };
}
function evaluateSection81Proposition(secKey, prop) {
  const norm = normalizeClauseAbbreviations(prop);
  if (secKey === "81(1)") {
    const reason2 = "CYFSA s. 81(1) merely authorizes a society to apply to the court to determine whether a child is in need of protection. A warrant to apprehend is governed by CYFSA s. 81(2), and warrantless apprehension requires meeting the three-part test in CYFSA s. 81(7).";
    if (/\b(?:warrantless\s+apprehension|apprehend(?:ed|ing|s)?\s+(?:a\s+child\s+|the\s+child\s+)?without\s+a\s+warrant|remov(?:e|ed|ing|al)\s+(?:of\s+a\s+child\s+|the\s+child\s+)?without\s+a\s+warrant|emergency\s+warrantless\s+removal|warrant\s+to\s+apprehend|issu(?:e|ed|ing)\s+a\s+warrant)\s+(?:under|pursuant\s+to|in|per|by\s+virtue\s+of|governed\s+by|authorized\s+by)\s+(?:the\s+)?(?:CYFSA\s*,?\s*)?(?:s(?:ec(?:tion)?)?\s*|subsection\s+)?81\(1\)/i.test(
      norm
    ) || /(?:(?:under|pursuant\s+to|in|per)\s+)?(?:CYFSA\s*,?\s*)?(?:s(?:ec(?:tion)?)?\s*|subsection\s+)81\(1\)(?:(?!\b(?:whereas|while|unlike|as\s+opposed\s+to|distinct\s+from|distinguish(?:ed|ing)?\s+from|rather\s+than|following|after|prior\s+to|and\s+not)\b|,\s*(?:and\s+|or\s+)?(?:under\s+|pursuant\s+to\s+)?(?:CYFSA\s*,?\s*)?(?:s(?:ec(?:tion)?)?\s*|subsection\s+)\d+)[^.;])*?\b(?:(?:authorizes?|governs?|permits?|empowers?|allows?|sets?\s+the\s+(?:test|threshold|standard)\s+for|conduct(?:ed|s|ing)?|made|effect(?:ed|s|ing)?|exercis(?:ed|es|ing)?|may\s+apprehend|apprehend(?:ed|s|ing)?)\s+(?:(?!\b(?:whereas|while|unlike|as\s+opposed\s+to|distinct\s+from|rather\s+than)\b|,\s*(?:and\s+|or\s+)?(?:under\s+|pursuant\s+to\s+)?(?:CYFSA\s*,?\s*)?(?:s(?:ec(?:tion)?)?\s*|subsection\s+)\d+)[^.;]){0,65}?\b(?:warrantless\s+apprehension|(?:apprehend|remove)(?:ing)?\s+(?:a\s+child\s+|the\s+child\s+)?without\s+a\s+warrant|without\s+a\s+warrant|issu(?:e|ing)\s+a\s+warrant\s+to\s+apprehend|substantial\s+risk\s+during\s+the\s+time\s+necessary|imminent\s+danger)|warrantless\s+apprehension\s+authority)/i.test(
      norm
    ) || /\b81\(1\)\s+(?:warrantless\s+apprehension|apprehension\s+warrant|imminent\s+danger\s+test)\b/i.test(norm)) {
      return { misapplied: true, reason: reason2 };
    }
    const mentionsWarrantless = /\b(?:warrantless\s+apprehension|apprehend(?:ed|ing|s)?\s+(?:a\s+child\s+|the\s+child\s+)?without\s+a\s+warrant|remov(?:e|ed|ing)\s+(?:a\s+child\s+|the\s+child\s+)?without\s+a\s+warrant|substantial\s+risk\s+(?:to\s+the\s+child['’]?s\s+health\s+or\s+safety\s+)?during\s+the\s+time\s+necessary|imminent\s+danger)\b/i.test(
      norm
    );
    if (mentionsWarrantless) {
      const identifies81_7 = /\b81\(7\)|subsection\s*\(7\)/i.test(norm);
      const negates81_1Apprehension = /\b81\(1\)\b[^.;]*?\b(?:does\s+not|not)\s+(?:authorize|govern|permit)\s+(?:warrantless\s+)?apprehension/i.test(norm);
      if (!identifies81_7 && !negates81_1Apprehension) {
        return { misapplied: true, reason: reason2 };
      }
    }
    const mentionsWarrantIssuance = /\b(?:justice\s+of\s+the\s+peace\s+(?:may\s+)?issue(?:d|s)?\s+a\s+warrant|warrant\s+to\s+apprehend\s+(?:a\s+child|the\s+child))\b/i.test(
      norm
    );
    if (mentionsWarrantIssuance && !/\b81\(2\)|subsection\s*\(2\)/i.test(norm)) {
      return { misapplied: true, reason: reason2 };
    }
    return { misapplied: false, reason: reason2 };
  }
  if (secKey === "81(2)") {
    const reason2 = "CYFSA s. 81(2) governs warrants to apprehend a child issued by a justice of the peace where a less restrictive course of action is unavailable or inadequate. Warrantless apprehension by a worker is governed by CYFSA s. 81(7).";
    if (/\b(?:warrantless\s+apprehension|apprehend(?:ed|ing|s)?\s+(?:a\s+child\s+|the\s+child\s+)?without\s+a\s+warrant|remov(?:e|ed|ing)\s+(?:a\s+child\s+|the\s+child\s+)?without\s+a\s+warrant)\s+(?:under|pursuant\s+to|in|per|by\s+virtue\s+of|governed\s+by|authorized\s+by)\s+(?:the\s+)?(?:CYFSA\s*,?\s*)?(?:s(?:ec(?:tion)?)?\s*|subsection\s+)?81\(2\)/i.test(
      norm
    ) || /(?:(?:under|pursuant\s+to|in|per)\s+)?(?:CYFSA\s*,?\s*)?(?:s(?:ec(?:tion)?)?\s*|subsection\s+)81\(2\)(?:(?!\b(?:whereas|while|unlike|as\s+opposed\s+to|distinct\s+from|distinguish(?:ed|ing)?\s+from|rather\s+than|instead\s+of|time\s+necessary\s+to)\b|,\s*(?:and\s+|or\s+)?(?:under\s+|pursuant\s+to\s+)?(?:CYFSA\s*,?\s*)?(?:s(?:ec(?:tion)?)?\s*|subsection\s+)\d+)[^.;])*?\b(?:authorizes?|governs?|permits?|empowers?|allows?|sets?\s+the\s+(?:test|threshold|standard)\s+for|conduct(?:ed|s|ing)?|made|may\s+apprehend|apprehend(?:ed|s|ing)?)\s+(?:(?!\b(?:whereas|while|unlike|as\s+opposed\s+to|distinct\s+from|rather\s+than)\b|,\s*(?:and\s+|or\s+)?(?:under\s+|pursuant\s+to\s+)?(?:CYFSA\s*,?\s*)?(?:s(?:ec(?:tion)?)?\s*|subsection\s+)\d+)[^.;]){0,65}?\b(?:warrantless\s+apprehension|(?:apprehend|remove)(?:ing)?\s+(?:a\s+child\s+|the\s+child\s+)?without\s+a\s+warrant|without\s+a\s+warrant)\b/i.test(
      norm
    )) {
      return { misapplied: true, reason: reason2 };
    }
    const mentionsWarrantless = /\b(?:warrantless\s+apprehension|apprehend(?:ed|ing|s)?\s+(?:a\s+child\s+|the\s+child\s+)?without\s+a\s+warrant|remov(?:e|ed|ing)\s+(?:a\s+child\s+|the\s+child\s+)?without\s+a\s+warrant)\b/i.test(
      norm
    );
    if (mentionsWarrantless && !/\b81\(7\)|subsection\s*\(7\)/i.test(norm)) {
      return { misapplied: true, reason: reason2 };
    }
    return { misapplied: false, reason: reason2 };
  }
  const reason = "CYFSA s. 81(7) governs warrantless apprehension where there would be a substantial risk to the child's health or safety during the time necessary for a s. 90(1) hearing or to obtain a warrant under s. 81(2). Warrants to apprehend issued by a justice of the peace are governed by s. 81(2), and court applications are governed by s. 81(1).";
  if (/\b(?:warrant\s+to\s+apprehend|apprehension\s+warrant|justice\s+of\s+the\s+peace\s+(?:may\s+)?issue(?:d|s)?\s+a\s+warrant|issu(?:e|ed|ing)\s+a\s+warrant\s+to\s+apprehend)\s+(?:under|pursuant\s+to|in|per|by\s+virtue\s+of|governed\s+by|authorized\s+by)\s+(?:the\s+)?(?:CYFSA\s*,?\s*)?(?:s(?:ec(?:tion)?)?\s*|subsection\s+)?81\(7\)/i.test(
    norm
  ) || /(?:(?:under|pursuant\s+to|in|per)\s+)?(?:CYFSA\s*,?\s*)?(?:s(?:ec(?:tion)?)?\s*|subsection\s+)81\(7\)(?:(?!\b(?:whereas|while|unlike|as\s+opposed\s+to|distinct\s+from|rather\s+than|instead\s+of|time\s+necessary\s+to|without\s+a\s+warrant)\b|,\s*(?:and\s+|or\s+)?(?:under\s+|pursuant\s+to\s+)?(?:CYFSA\s*,?\s*)?(?:s(?:ec(?:tion)?)?\s*|subsection\s+)\d+)[^.;])*?\b(?:(?:authorizes?|governs?|permits?|empowers?)\s+(?:a\s+)?(?:justice\s+of\s+the\s+peace\s+to\s+issue\s+a\s+warrant|issu(?:e|ing)\s+a\s+warrant\s+to\s+apprehend)|justice\s+of\s+the\s+peace\s+(?:may|can|shall)\s+issue\s+a\s+warrant\s+to\s+apprehend)\b/i.test(
    norm
  )) {
    return { misapplied: true, reason };
  }
  if (/\b(?:apprehended\s+(?:pursuant\s+to|with)\s+a\s+warrant|justice\s+of\s+the\s+peace\s+(?:may\s+)?issue(?:d|s)?\s+a\s+warrant\s+to\s+apprehend)\b/i.test(
    norm
  ) && !/\b81\(2\)|subsection\s*\(2\)|without\s+a\s+warrant|warrantless\b/i.test(norm)) {
    return { misapplied: true, reason };
  }
  return { misapplied: false, reason };
}
function evaluateSection88And94Proposition(secKey, prop) {
  const norm = normalizeClauseAbbreviations(prop);
  if (secKey === "88") {
    const reason2 = "CYFSA s. 88 requires that as soon as practicable, and in any event within five days after a child is brought to a place of safety under s. 81, s. 83(1)(a)(ii), or s. 136(5), the matter be brought before a court for a s. 90(1) hearing, the child be returned, or a s. 75(1)/s. 77 agreement be made. Adjournments (30-day limit absent consent) are governed by CYFSA s. 94(1).";
    if (/\b(?:30-day|thirty-day|30\s+days?)\s+adjournment\s+(?:limit|maximum|rule|period|cap)?\s*(?:under|pursuant\s+to|in|per|governed\s+by)\s+(?:the\s+)?(?:CYFSA\s*,?\s*)?(?:s(?:ec(?:tion)?)?\s*)?88\b/i.test(
      norm
    ) || /(?:(?:under|pursuant\s+to|in|per)\s+)?(?:CYFSA\s*,?\s*)?(?:s(?:ec(?:tion)?)?\s*)88(?:(?!\b(?:whereas|while|unlike|as\s+opposed\s+to|distinct\s+from|after|following|and\s+then|subsequently)\b)[^.;])*?\b(?:shall\s+not\s+adjourn|adjourn(?:ed|ment|s)?\s+(?:a\s+hearing\s+)?(?:for\s+(?:more\s+than|up\s+to)|to)\s+30\s+days|limits?\s+adjournments?\s+to\s+30\s+days|governs?\s+(?:the\s+)?30-day\s+adjournment|sets?\s+(?:a\s+|the\s+)?30-day\s+adjournment)/i.test(
      norm
    )) {
      return { misapplied: true, support: "IRRELEVANT_OR_MISAPPLIED", reason: reason2 };
    }
    if (/\b(?:7|seven|10|ten|14|fourteen|15|fifteen|30|thirty|45|forty-five)-day\s+(?:post-apprehension|place\s+of\s+safety|initial|statutory)\s+hearing\s+(?:deadline|rule|requirement|limit)\s*(?:under|pursuant\s+to|in|per|governed\s+by)?\s*(?:the\s+)?(?:CYFSA\s*,?\s*)?(?:s(?:ec(?:tion)?)?\s*)?88\b/i.test(
      norm
    ) || /(?:(?:under|pursuant\s+to|in|per)\s+)?(?:CYFSA\s*,?\s*)?(?:s(?:ec(?:tion)?)?\s*)88(?:(?!\b(?:whereas|while|unlike|breach|violat|exceed|contrary|late|overdue|instead\s+of\s+the\s+(?:mandatory\s+)?(?:5|five))\b)[^.;])*?\b(?:(?:requires?|mandates?|permits?|allows?|provides?\s+that|sets?\s+a\s+deadline\s+of|has\s+a)\s+[^.;]{0,65}?\b(?:within\s+(?:7|seven|10|ten|14|fourteen|15|fifteen|30|thirty|45|forty-five)\s+days|(?:7|seven|10|ten|14|fourteen|15|fifteen|30|thirty|45|forty-five)-day\s+(?:post-apprehension|place\s+of\s+safety|initial|statutory)?\s*hearing\s+deadline)|(?:matter|child)\s+(?:shall|must|may)\s+be\s+brought\s+before\s+a\s+court\s+within\s+(?:7|seven|10|ten|14|fourteen|15|fifteen|30|thirty|45|forty-five)\s+days)\b/i.test(
      norm
    )) {
      return { misapplied: true, support: "CONTRADICTED_BY_STATUTE", reason: reason2 };
    }
    if (/\b(?:30-day|thirty-day)\s+adjournment\b|\badjourn(?:ed|ment)?\s+(?:a\s+hearing\s+)?for\s+more\s+than\s+30\s+days\b/i.test(
      norm
    ) && !/\b(?:5-day|five-day|(?:5|five)\s+days|place\s+of\s+safety|post-apprehension|initial\s+hearing)\b/i.test(norm)) {
      return { misapplied: true, support: "IRRELEVANT_OR_MISAPPLIED", reason: reason2 };
    }
    return { misapplied: false, reason: reason2 };
  }
  if (secKey === "94(1)") {
    const reason2 = "CYFSA s. 94(1) prohibits adjourning a hearing for more than 30 days unless all parties present and the caregiver during the adjournment consent and no absent party is known to object. It is NOT the 5-day post-apprehension hearing deadline, which is governed by CYFSA s. 88.";
    if (/\b(?:5-day|five-day|five\s+days?|5\s+days?)\s+(?:post-apprehension|place\s+of\s+safety|initial)?\s*hearing\s+(?:deadline|rule|requirement|limit|timeline)?\s*(?:under|pursuant\s+to|in|per|governed\s+by)\s+(?:the\s+)?(?:CYFSA\s*,?\s*)?(?:s(?:ec(?:tion)?)?\s*|subsection\s+)?94\(1\)/i.test(
      norm
    ) || /(?:(?:under|pursuant\s+to|in|per)\s+)?(?:CYFSA\s*,?\s*)?(?:s(?:ec(?:tion)?)?\s*|subsection\s+)94\(1\)(?:(?!\b(?:whereas|while|unlike|as\s+opposed\s+to|distinct\s+from|after|following)\b)[^.;])*?\b(?:within\s+(?:5|five)\s+days\s+after\s+(?:a\s+child\s+is\s+)?(?:brought\s+to\s+a\s+place\s+of\s+safety|apprehen(?:ded|sion)|remov(?:ed|al))|governs?\s+the\s+(?:5-day|five-day)\s+(?:post-apprehension\s+)?hearing|(?:initial\s+|post-apprehension\s+)?hearing\s+(?:shall|must)\s+(?:occur|take\s+place|be\s+held)\s+within\s+(?:5|five)\s+days|(?:matter|child)\s+(?:shall|must)\s+be\s+brought\s+before\s+a\s+court\s+within\s+(?:5|five)\s+days)\b/i.test(
      norm
    )) {
      return { misapplied: true, support: "IRRELEVANT_OR_MISAPPLIED", reason: reason2 };
    }
    if (/\b(?:5|7|10|14|45|60|90)-day\s+(?:statutory\s+|maximum\s+)?adjournment\s+(?:limit|maximum|cap|rule)\s*(?:under|pursuant\s+to|in|per|governed\s+by)?\s*(?:the\s+)?(?:CYFSA\s*,?\s*)?(?:s(?:ec(?:tion)?)?\s*|subsection\s+)?94\(1\)/i.test(
      norm
    ) || /(?:(?:under|pursuant\s+to|in|per)\s+)?(?:CYFSA\s*,?\s*)?(?:s(?:ec(?:tion)?)?\s*|subsection\s+)94\(1\)(?:(?!\b(?:breach|violat|exceed|contrary|unlawful|impermissibl|beyond\s+the\s+30-day)\b)[^.;])*?\b(?:(?:may|can|permits?\s+the\s+court\s+to)\s+adjourn\s+(?:a\s+(?:temporary\s+care\s+)?hearing\s+)?for\s+(?:up\s+to|more\s+than)\s+(?:45|60|90)\s+days\s+without\s+(?:all\s+parties['’]?\s+)?consent|shall\s+not\s+adjourn\s+(?:a\s+hearing\s+)?for\s+more\s+than\s+(?:5|7|10|14|45|60|90)\s+days|only\s+the\s+society['’]?s\s+consent\s+is\s+required\s+to\s+adjourn|even\s+if\s+an\s+absent\s+party\s+objects)\b/i.test(
      norm
    )) {
      return { misapplied: true, support: "CONTRADICTED_BY_STATUTE", reason: reason2 };
    }
    if (/\b(?:5-day|five-day|five\s+day|within\s+(?:5|five)\s+days|post-apprehension\s+hearing)\b/i.test(norm) && !/\b(?:adjourn(?:ed|ment|s|ing)?|30-day|thirty-day|30\s+days)\b/i.test(norm)) {
      return { misapplied: true, support: "IRRELEVANT_OR_MISAPPLIED", reason: reason2 };
    }
    return { misapplied: false, reason: reason2 };
  }
  const reason = "CYFSA s. 94(5) requires the court to consider placement with a relative or extended-family/community member before ordering temporary society custody on adjournment. It is NOT the 5-day post-apprehension hearing deadline (governed by CYFSA s. 88) or the 30-day adjournment limit (governed by CYFSA s. 94(1)).";
  if (/\b(?:5-day|five-day|five\s+days?|5\s+days?|30-day|thirty-day|30\s+days?)\s+(?:post-apprehension\s+|initial\s+)?(?:hearing|adjournment)\s*(?:deadline|rule|requirement|limit|timeline)?\s*(?:under|pursuant\s+to|in|per|governed\s+by)?\s*(?:the\s+)?(?:CYFSA\s*,?\s*)?(?:s(?:ec(?:tion)?)?\s*|subsection\s+)?94\(5\)/i.test(
    norm
  ) || /\b(?:5-day|five-day|five\s+day|post-apprehension\s+hearing|within\s+(?:5|five)\s+days)\b/i.test(norm) && !/\b(?:relative|extended\s+family|community)\b/i.test(norm)) {
    return { misapplied: true, support: "IRRELEVANT_OR_MISAPPLIED", reason };
  }
  return { misapplied: false, reason };
}
var KNOWN_MISAPPLIED_CYFSA_PROVISIONS = {
  "125": {
    actualHeading: "CYFSA s. 125(1) (Duty to report suspicion)",
    misappliedPattern: /\b(?:proves?|establishes?|satisfies)\b.*\b(?:in need of protection|74\(2\)|removal|apprehension threshold)\b|\b(?:warrantless apprehension authority|proof of maltreatment)\b/i,
    reason: "CYFSA s. 125(1) sets the 'reasonable grounds to suspect' threshold for reporting to a society. It does NOT establish proof that a child is in need of protection under s. 74(2) or authorize removal under s. 81(7)."
  },
  "125(1)": {
    actualHeading: "CYFSA s. 125(1) (Duty to report suspicion)",
    misappliedPattern: /\b(?:proves?|establishes?|satisfies)\b.*\b(?:in need of protection|74\(2\)|removal|apprehension threshold)\b|\b(?:warrantless apprehension authority|proof of maltreatment)\b/i,
    reason: "CYFSA s. 125(1) sets the 'reasonable grounds to suspect' threshold for reporting to a society. It does NOT establish proof that a child is in need of protection under s. 74(2) or authorize removal under s. 81(7)."
  },
  "41": {
    actualHeading: "CYFSA s. 41 (Society-Minister accountability agreement)",
    misappliedPattern: /\b(?:right to counsel|legal representation|lawyer|duty counsel|OCL|Children's Lawyer)\b/i,
    reason: "CYFSA s. 41 governs financial accountability agreements between a society and the Minister. A child's legal representation in Part V proceedings is governed by CYFSA s. 78."
  },
  "41(1)": {
    actualHeading: "CYFSA s. 41(1) (Society-Minister accountability agreement)",
    misappliedPattern: /\b(?:right to counsel|legal representation|lawyer|duty counsel|OCL|Children's Lawyer)\b/i,
    reason: "CYFSA s. 41(1) governs financial accountability agreements between a society and the Minister. A child's legal representation in Part V proceedings is governed by CYFSA s. 78."
  },
  "51": {
    actualHeading: "CYFSA s. 51 (Transfer of charitable property)",
    misappliedPattern: /\b(?:plan of care|society's plan|care plan|remedial services)\b/i,
    reason: "CYFSA s. 51 governs gifts and trusts upon transfer of charitable property. The Society's written Plan of Care is governed by CYFSA s. 100 (and s. 13(1) for a child in care)."
  },
  "51(1)": {
    actualHeading: "CYFSA s. 51(1) (Transfer of charitable property)",
    misappliedPattern: /\b(?:plan of care|society's plan|care plan|remedial services)\b/i,
    reason: "CYFSA s. 51(1) governs gifts and trusts upon transfer of charitable property. The Society's written Plan of Care is governed by CYFSA s. 100 (and s. 13(1) for a child in care)."
  },
  "81(12)": {
    actualHeading: "CYFSA s. 81(12) (Peace officer powers under s. 81)",
    misappliedPattern: /\b(?:Crown liability|personal liability|immunity|midnight and 6 a\.m\.|loiter)\b/i,
    reason: "CYFSA s. 81(12) applies s. 81(2), (6), (7), (10), and (11) to a peace officer. Good-faith protection from personal liability is s. 81(13), and the warrantless power regarding an unaccompanied child under 16 in a public place between midnight and 6 a.m. is s. 136(5)."
  },
  "292": {
    actualHeading: "CYFSA s. 292 (Disclosure without consent)",
    misappliedPattern: /\b(?:parent(?:'s)? right of access|individual(?:'s)? right of access|right to access own records|request access to personal information)\b/i,
    reason: "CYFSA s. 292(1) governs when a service provider may disclose personal information WITHOUT consent (e.g. to law enforcement). An individual's right of access to records of personal information in a service provider's custody or control is governed by CYFSA s. 312(1)."
  },
  "292(1)": {
    actualHeading: "CYFSA s. 292(1) (Disclosure without consent)",
    misappliedPattern: /\b(?:parent(?:'s)? right of access|individual(?:'s)? right of access|right to access own records|request access to personal information)\b/i,
    reason: "CYFSA s. 292(1) governs when a service provider may disclose personal information WITHOUT consent. An individual's right of access to records of personal information is governed by CYFSA s. 312(1)."
  }
};
var UNIVERSAL_FUNDING_CONTRADICTION_PATTERN = /\b(?:universal\s+(?:statutory\s+)?duty\s+to\s+(?:fund|pay\s+for|purchase)|must\s+(?:fund|pay\s+for|purchase)\s+all\s+(?:family\s+support\s+)?(?:goods\s+(?:or|and)\s+)?services|(?:court|supervision\s+order)\s+(?:can|may|shall|must)\s+(?:require|order|compel)\s+(?:the\s+)?(?:society|CAS)\s+to\s+(?:provide\s+financial\s+assistance|purchase\s+(?:any\s+|private\s+)?goods\s+(?:or|and)\s+services|fund\s+private\s+services))\b/i;
var isIsoDateString = (v) => typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v.trim()) && !Number.isNaN(Date.parse(v.trim()));
function evaluatePropositionSupport(sectionOrAuthorityKey, propositionText) {
  const prop = (propositionText || "").trim();
  if (!prop) {
    return { support: "NOT_EVALUATED", reason: null };
  }
  if (UNIVERSAL_FUNDING_CONTRADICTION_PATTERN.test(prop)) {
    return {
      support: "CONTRADICTED_BY_STATUTE",
      reason: "Contradicted by statute: While CYFSA s. 35(1)(c) and s. 101(2)-(3) address guidance, counselling, and pre-intervention assistance, CYFSA s. 94(6)(c) and s. 101(7)(c) (and s. 116(4)(c)) expressly state that court terms and conditions on a supervising society 'shall not require the society to provide financial assistance or to purchase any goods or services.'"
    };
  }
  if (/\b(?:CFSRB|Child\s+and\s+Family\s+Services\s+Review\s+Board|Internal\s+Complaint\s+Review\s+Panel|ICRP|Ombudsman|(?:s|section)\.?\s*(?:119|120))\b[^.;]*?\b(?:can|may|shall|has\s+(?:the\s+)?(?:authority|jurisdiction|power)\s+to)\s+(?:overturn|vacate|set\s+aside|reverse|override|vary)\s+(?:a\s+|the\s+)?(?:court\s+order|judge['’]?s\s+order|custody\s+order|supervision\s+order|temporary\s+care\s+order)/i.test(
    prop
  ) || /\b(?:CFSRB|Child\s+and\s+Family\s+Services\s+Review\s+Board|society\s+complaint\s+review)\b[^.;]*?\b(?:can|may|shall)\s+review\s+(?:an\s+issue|matters?)\s+(?:that\s+has\s+been\s+)?(?:decided\s+by\s+the\s+court|currently\s+before\s+the\s+court)/i.test(
    prop
  )) {
    return {
      support: "CONTRADICTED_BY_STATUTE",
      reason: "Contradicted by statute: CYFSA s. 119(11)(a) and s. 120(8)(a) expressly prohibit a society or the Child and Family Services Review Board (CFSRB) from reviewing a complaint if the subject is an issue that has been decided by the court or is before the court. Neither the CFSRB nor the Ontario Ombudsman can overturn a court order."
    };
  }
  if (/^(?:CYFSA:)?1\(2\)/i.test(sectionOrAuthorityKey)) {
    if (/\b(?:unconditional\s+(?:statutory\s+)?entitlement\s+to\s+every\s+requested\s+service|prohibits?\s+(?:emergency\s+)?apprehension\s+whenever\s+(?:any|an)\s+untried\s+(?:support\s+)?service\s+exists|guarantees?\s+every\s+service\s+requested\s+by\s+a\s+parent)\b/i.test(
      prop
    )) {
      return {
        support: "IRRELEVANT_OR_MISAPPLIED",
        reason: "CYFSA s. 1(2) sets out additional statutory purposes that apply 'so long as they are consistent with the best interests, protection and well-being of children' (s. 1(1)). It does not create an unconditional entitlement to every requested service or bar emergency intervention where a child cannot be adequately protected."
      };
    }
  }
  if (/^OCPS:/i.test(sectionOrAuthorityKey)) {
    if (/\b(?:practice\s+notes?\s+(?:have|carry|possess)\s+the\s+same\s+(?:binding\s+)?legal\s+force\s+as\s+(?:a\s+mandatory\s+standard|statute|statutory\s+law)|every\s+practice\s+note\s+is\s+a\s+mandatory\s+statutory\s+requirement)\b/i.test(
      prop
    )) {
      return {
        support: "IRRELEVANT_OR_MISAPPLIED",
        reason: "Under the Ontario Child Protection Standards (2016), mandatory agency obligations are set out in the text labeled 'Standard', whereas 'Practice Notes' provide explanatory clinical guidance and do not carry the same mandatory legal force."
      };
    }
    if (sectionOrAuthorityKey === "OCPS:STD_7" && /\b(?:30-day|thirty-day)\s+(?:initial\s+)?service[- ]plan\s+deadline\s+(?:runs|starts|is\s+calculated|is\s+measured)\s+(?:solely\s+)?from\s+(?:the\s+)?(?:date\s+of\s+)?(?:removal|apprehension)\s+alone\b/i.test(
      prop
    )) {
      return {
        support: "IRRELEVANT_OR_MISAPPLIED",
        reason: "Under Ontario Child Protection Standards (2016) Standard 7, the 30-day initial service-plan deadline runs from completion of the investigation or case transfer to ongoing services, NOT from the child's removal/apprehension date alone (whereas CYFSA s. 13(1) governs the residential placement Plan of Care within 30 days of admission)."
      };
    }
  }
  if (/^OCSWSSW:/i.test(sectionOrAuthorityKey)) {
    if (/\b(?:every\s+CAS\s+(?:worker|employee)\s+is\s+(?:automatically\s+)?a\s+registered\s+social\s+worker|all\s+child\s+protection\s+workers\s+are\s+automatically\s+members\s+of\s+OCSWSSW|universal\s+statutory\s+CAS\s+worker\s+oath\s+of\s+office)\b/i.test(
      prop
    )) {
      return {
        support: "IRRELEVANT_OR_MISAPPLIED",
        reason: "OCSWSSW regulatory jurisdiction under the Social Work and Social Service Work Act, 1998 applies only to registered members (RSW / RSSW) or persons unlawfully holding themselves out as such. Not every CAS employee is a registered social worker, and there is no universal statutory CAS worker oath of office."
      };
    }
  }
  if (/^(?:FLR:)?1\(8\)$/i.test(sectionOrAuthorityKey)) {
    if (/\b(?:contempt\s+order\s+for\s+failing\s+to\s+follow\s+(?:the\s+)?rules\s+without\s+(?:a\s+)?court\s+order|child\s+in\s+need\s+of\s+protection\s+threshold\s+under\s+Rule\s+1\(8\)|warrantless\s+apprehension|apprehend\s+a\s+child\s+without\s+a\s+warrant|(?:5-day|five-day)\s+post-apprehension\s+hearing|30-day\s+adjournment\s+limit)\b/i.test(
      prop
    )) {
      return {
        support: "IRRELEVANT_OR_MISAPPLIED",
        reason: "Family Law Rules r. 1(8) governs remedies for failing to obey a court order (whereas r. 1(8.1) governs failing to follow the Rules and excludes contempt under clause (g), and child protection apprehension/hearing rules are governed by the CYFSA)."
      };
    }
    return { support: "SUPPORTED", reason: null };
  }
  if (/^(?:FLR:)?14\((?:18|19)\)$/i.test(sectionOrAuthorityKey)) {
    if (/\b(?:anonymous\s+hearsay\s+is\s+admissible\s+without\s+identifying\s+the\s+source|unattributed\s+hearsay\s+without\s+naming\s+the\s+source\s+satisfies\s+Rule\s+14\((?:18|19)\))\b/i.test(
      prop
    )) {
      return {
        support: "CONTRADICTED_BY_STATUTE",
        reason: "Family Law Rules r. 14(18)-(19) permit information and belief in a motion affidavit ONLY if the source of the information is identified by name and the affiant states a belief that the information is true."
      };
    }
    return { support: "SUPPORTED", reason: null };
  }
  if (/^(?:CHARTER:)?24(?:\(1\))?$/i.test(sectionOrAuthorityKey)) {
    if (/\b(?:standalone\s+substantive\s+right\s+without\s+any\s+Charter\s+infringement|automatic\s+exclusion\s+of\s+evidence\s+under\s+s\.?\s*24\(1\)\s+without\s+a\s+Charter\s+breach|(?:5-day|five-day)\s+post-apprehension\s+hearing|30-day\s+adjournment\s+limit|warrantless\s+apprehension\s+authority)\b/i.test(
      prop
    )) {
      return {
        support: "IRRELEVANT_OR_MISAPPLIED",
        reason: "Charter s. 24(1) is a remedial enforcement provision requiring an infringement or denial of a guaranteed Charter right or freedom before a court of competent jurisdiction."
      };
    }
    return { support: "SUPPORTED", reason: null };
  }
  const normalizedKey = sectionOrAuthorityKey.replace(/^CYFSA:/i, "");
  if (normalizedKey === "102" || normalizedKey === "102(1)") {
    const check102 = evaluateSection102Proposition(prop);
    if (check102.misapplied) {
      return { support: "IRRELEVANT_OR_MISAPPLIED", reason: check102.reason };
    }
    return { support: "SUPPORTED", reason: null };
  }
  if (normalizedKey === "81(1)" || normalizedKey === "81(2)" || normalizedKey === "81(7)") {
    const check81 = evaluateSection81Proposition(normalizedKey, prop);
    if (check81.misapplied) {
      return { support: "IRRELEVANT_OR_MISAPPLIED", reason: check81.reason };
    }
    return { support: "SUPPORTED", reason: null };
  }
  if (normalizedKey === "88" || normalizedKey === "94(1)" || normalizedKey === "94(5)") {
    const check88_94 = evaluateSection88And94Proposition(normalizedKey, prop);
    if (check88_94.misapplied) {
      return {
        support: check88_94.support || "IRRELEVANT_OR_MISAPPLIED",
        reason: check88_94.reason
      };
    }
    return { support: "SUPPORTED", reason: null };
  }
  const misapplied = KNOWN_MISAPPLIED_CYFSA_PROVISIONS[normalizedKey];
  if (misapplied && misapplied.misappliedPattern.test(prop)) {
    return {
      support: "IRRELEVANT_OR_MISAPPLIED",
      reason: misapplied.reason
    };
  }
  return { support: "SUPPORTED", reason: null };
}
function resolveLegalAuthority(citationText, options) {
  const text = (citationText || "").trim();
  if (!text) {
    return {
      status: "NONE",
      authorityId: null,
      authorityCategory: "NONE",
      category: "NONE",
      entry: null,
      officialCitation: "",
      sourceUrl: null,
      exactWording: null,
      practiceNote: null,
      warningText: "No statutory citation provided.",
      sourceExists: false,
      temporalStatus: "NOT_CHECKED",
      propositionSupport: "NOT_EVALUATED",
      propositionReason: null
    };
  }
  const category = identifyAuthorityCategory(text);
  const combinedProposition = [options?.proposition || "", text].filter(Boolean).join(" ");
  const finalizeResolution = (entry, specificSectionCited, allSectionsCited) => {
    const sectionsToCheck = allSectionsCited && allSectionsCited.length > 0 ? allSectionsCited : [specificSectionCited || entry.sectionKey];
    let temporalStatus = "NOT_CHECKED";
    if (options?.caseDate != null && String(options.caseDate).trim() !== "") {
      const rawDate = String(options.caseDate).trim();
      if (!isIsoDateString(rawDate)) {
        return {
          status: "INAPPLICABLE",
          authorityId: entry.authorityId,
          authorityCategory: category,
          category,
          entry,
          officialCitation: entry.citation,
          sourceUrl: entry.sourceUrl,
          exactWording: entry.exactWording,
          practiceNote: entry.practiceNote,
          warningText: `Invalid case date "${rawDate}": temporal verification requires an ISO date (YYYY-MM-DD).`,
          sourceExists: true,
          temporalStatus: "INVALID_CASE_DATE",
          propositionSupport: "NOT_EVALUATED",
          propositionReason: null
        };
      }
      for (const sec of sectionsToCheck) {
        const secResolvedKey = category === "CYFSA" ? resolveBundledCyfsaKey(sec) : null;
        const secEntry = (category === "CYFSA" ? VERIFIED_AUTHORITIES_REGISTRY[`CYFSA:${sec}`] || (secResolvedKey ? VERIFIED_AUTHORITIES_REGISTRY[`CYFSA:${secResolvedKey}`] : null) : null) || entry;
        let effectiveFrom = secEntry.effectiveFrom;
        if (/^74\(2\)\(d\.[12]\)$/i.test(sec)) {
          effectiveFrom = "2021-10-01";
        }
        if (rawDate < effectiveFrom) {
          return {
            status: "INAPPLICABLE",
            authorityId: secEntry.authorityId,
            authorityCategory: category,
            category,
            entry: secEntry,
            officialCitation: secEntry.citation,
            sourceUrl: secEntry.sourceUrl,
            exactWording: secEntry.exactWording,
            practiceNote: secEntry.practiceNote,
            warningText: `Temporal version mismatch: ${category === "CYFSA" ? `CYFSA s. ${sec}` : secEntry.citation} came into force on ${effectiveFrom} and was not in force on the case date (${rawDate}).`,
            sourceExists: true,
            temporalStatus: "BEFORE_EARLIEST_VERSION",
            propositionSupport: "NOT_EVALUATED",
            propositionReason: null
          };
        }
        if (secEntry.effectiveTo !== null && rawDate >= secEntry.effectiveTo) {
          return {
            status: "INAPPLICABLE",
            authorityId: secEntry.authorityId,
            authorityCategory: category,
            category,
            entry: secEntry,
            officialCitation: secEntry.citation,
            sourceUrl: secEntry.sourceUrl,
            exactWording: secEntry.exactWording,
            practiceNote: secEntry.practiceNote,
            warningText: `Temporal version mismatch: ${secEntry.citation} was repealed or superseded on ${secEntry.effectiveTo} prior to the case date (${rawDate}).`,
            sourceExists: true,
            temporalStatus: "AFTER_REPEAL",
            propositionSupport: "NOT_EVALUATED",
            propositionReason: null
          };
        }
      }
      temporalStatus = "IN_FORCE";
    }
    const propTargetText = options?.proposition !== void 0 ? options.proposition : text;
    for (const sec of sectionsToCheck) {
      const propCheck = evaluatePropositionSupport(sec, propTargetText);
      if (propCheck.support === "IRRELEVANT_OR_MISAPPLIED" || propCheck.support === "CONTRADICTED_BY_STATUTE") {
        return {
          status: "INAPPLICABLE",
          authorityId: entry.authorityId,
          authorityCategory: category,
          category,
          entry,
          officialCitation: entry.citation,
          sourceUrl: entry.sourceUrl,
          exactWording: entry.exactWording,
          practiceNote: entry.practiceNote,
          warningText: propCheck.reason,
          sourceExists: true,
          temporalStatus,
          propositionSupport: propCheck.support,
          propositionReason: propCheck.reason,
          allSectionsCited: sectionsToCheck
        };
      }
    }
    const firstPropCheck = evaluatePropositionSupport(sectionsToCheck[0], propTargetText);
    return {
      status: "VERIFIED",
      authorityId: entry.authorityId,
      authorityCategory: category,
      category,
      entry,
      officialCitation: entry.citation,
      sourceUrl: entry.sourceUrl,
      exactWording: entry.exactWording,
      practiceNote: entry.practiceNote,
      warningText: null,
      sourceExists: true,
      temporalStatus,
      propositionSupport: options?.proposition ? "SUPPORTED" : firstPropCheck.support,
      propositionReason: null,
      allSectionsCited: sectionsToCheck
    };
  };
  if (category === "CYFSA") {
    const sections = citedSections(text);
    if (sections.length > 0) {
      for (const sec of sections) {
        const propEval = evaluatePropositionSupport(sec, combinedProposition);
        if (propEval.support === "IRRELEVANT_OR_MISAPPLIED" || propEval.support === "CONTRADICTED_BY_STATUTE") {
          const resolvedKey = resolveBundledCyfsaKey(sec);
          const fallbackEntry = VERIFIED_AUTHORITIES_REGISTRY[`CYFSA:${sec}`] || (resolvedKey ? VERIFIED_AUTHORITIES_REGISTRY[`CYFSA:${resolvedKey}`] : null) || null;
          return {
            status: "INAPPLICABLE",
            authorityId: fallbackEntry ? fallbackEntry.authorityId : `CYFSA:${sec}`,
            authorityCategory: "CYFSA",
            category: "CYFSA",
            entry: fallbackEntry,
            officialCitation: `CYFSA, s. ${sec}`,
            sourceUrl: "https://www.ontario.ca/laws/statute/17c14",
            exactWording: fallbackEntry?.exactWording || null,
            practiceNote: propEval.reason,
            warningText: propEval.reason,
            sourceExists: true,
            temporalStatus: "NOT_CHECKED",
            propositionSupport: propEval.support,
            propositionReason: propEval.reason
          };
        }
      }
      const firstSec = sections[0];
      if (sections.length === 1 && (firstSec === "74" || firstSec === "81" || firstSec === "125")) {
        const directEntry = VERIFIED_AUTHORITIES_REGISTRY[firstSec];
        if (directEntry) {
          return finalizeResolution(directEntry, firstSec, sections);
        }
      }
      const allVerified = sections.every((s) => isVerifiedCyfsaSection(s));
      if (allVerified) {
        const primaryKey = resolveBundledCyfsaKey(firstSec);
        const entry = VERIFIED_AUTHORITIES_REGISTRY[`CYFSA:${firstSec}`] || (primaryKey ? VERIFIED_AUTHORITIES_REGISTRY[`CYFSA:${primaryKey}`] : null);
        if (entry) {
          return finalizeResolution(entry, firstSec, sections);
        }
      }
    }
  }
  if (category === "BILL_C92") {
    const sections = citedSections(text);
    if (sections.length === 1) {
      const sec = sections[0];
      const entry = VERIFIED_AUTHORITIES_REGISTRY[`BILL_C92:${sec}`];
      if (entry) {
        return finalizeResolution(entry, sec, sections);
      }
    }
  }
  if (category === "FAMILY_LAW_RULES") {
    const ruleMatch = text.match(/\b(?:Rule|Subrule|r\.?|s\.?)\s*(1\(8\)|1\.8|14\(18\)|14\.18|14\(19\)|14\.19|33)(?!\w)/i) || text.match(/\b(1\(8\)|1\.8|14\(18\)|14\.18|14\(19\)|14\.19)(?!\w)/i);
    if (ruleMatch) {
      const normalizedRule = ruleMatch[1].replace(".", "(") + (ruleMatch[1].includes(".") ? ")" : "");
      const hasInvalidSuffix = /\b1\(8\.1\)|\b(?:1\(8\)|14\(18\)|14\(19\)|33)\(\d+|\b(?:1\(8\)|14\(18\)|14\(19\))\([h-z]\)/i.test(text);
      if (!hasInvalidSuffix) {
        const entry = VERIFIED_AUTHORITIES_REGISTRY[`FLR:${normalizedRule}`];
        if (entry) {
          return finalizeResolution(entry, `FLR:${normalizedRule}`);
        }
      }
    }
  }
  if (category === "CHARTER") {
    const charterSecMatch = text.match(/\b(?:Section|sec\.?|s\.?)\s*(7|15(?:\(1\))?|24\(1\)|24)(?!\w)/i);
    if (charterSecMatch) {
      const rawSec = charterSecMatch[1];
      const hasInvalidCharterSub = /\b(?:7|15|24)\((?!1\))\d+\)/i.test(text);
      if (!hasInvalidCharterSub) {
        const registryKey = rawSec.startsWith("24") ? "CHARTER:24(1)" : rawSec.startsWith("15") ? "CHARTER:15" : "CHARTER:7";
        const entry = VERIFIED_AUTHORITIES_REGISTRY[registryKey];
        if (entry) {
          return finalizeResolution(entry, registryKey);
        }
      }
    }
  }
  if (category === "CAS_STANDARD") {
    if (/\bStandard\s+(?:[9]|\d{2,})\b/i.test(text)) {
    } else {
      const stdMatch = text.match(/\b(?:Standard|STD_?)\s*([1-8])\b/i);
      if (stdMatch) {
        const key = `OCPS:STD_${stdMatch[1]}`;
        const entry = VERIFIED_AUTHORITIES_REGISTRY[key];
        if (entry) {
          return finalizeResolution(entry, key);
        }
      }
      if (/\b(?:All\s+Phases|Contemporaneous\s+Case\s+Notes|Standard\s+[A-H]|Supervisory\s+Consultation)\b/i.test(
        text
      )) {
        const entry = VERIFIED_AUTHORITIES_REGISTRY["OCPS:ALL_PHASES"];
        if (entry) {
          return finalizeResolution(entry, "OCPS:ALL_PHASES");
        }
      }
    }
  }
  if (category === "PROFESSIONAL_STANDARD") {
    if (/\b(?:Principle\s+IV|Record[- ]?Keeping|Social\s+Work\s+Record)\b/i.test(text)) {
      const entry2 = VERIFIED_AUTHORITIES_REGISTRY["OCSWSSW:PRIN_IV_RECORDS"];
      if (entry2) {
        return finalizeResolution(entry2, "OCSWSSW:PRIN_IV_RECORDS");
      }
    }
    const entry = VERIFIED_AUTHORITIES_REGISTRY["OCSWSSW:REGISTRATION"];
    if (entry) {
      return finalizeResolution(entry, "OCSWSSW:REGISTRATION");
    }
  }
  if (category === "OVERSIGHT_PATHWAY") {
    if (/\bOmbudsman\b/i.test(text)) {
      const entry = VERIFIED_AUTHORITIES_REGISTRY["OVERSIGHT:OMBUDSMAN"];
      if (entry) {
        return finalizeResolution(entry, "OVERSIGHT:OMBUDSMAN");
      }
    }
  }
  if (category === "REGULATION") {
    if (/\b155\/18\b/.test(text) && !/\bs\.\s*\d+/i.test(text)) {
      const entry = VERIFIED_AUTHORITIES_REGISTRY["O_REG_155_18:COMPLAINTS"];
      if (entry) {
        return finalizeResolution(entry, "O_REG_155_18:COMPLAINTS");
      }
    }
    if (/\b156\/18\b/.test(text) && !/\bs\.\s*\d+/i.test(text)) {
      const entry = VERIFIED_AUTHORITIES_REGISTRY["O_REG_156_18:STANDARDS"];
      if (entry) {
        return finalizeResolution(entry, "O_REG_156_18:STANDARDS");
      }
    }
  }
  return {
    status: "UNVERIFIED",
    authorityId: null,
    authorityCategory: category,
    category,
    entry: null,
    officialCitation: text,
    sourceUrl: null,
    exactWording: null,
    practiceNote: "Confirm exact subsection and current in-force wording with legal counsel before relying on this citation.",
    warningText: "\u26A0\uFE0F Statute citation unverified against official consolidation \u2014 confirm exact section with counsel.",
    sourceExists: false,
    temporalStatus: "NOT_CHECKED",
    propositionSupport: "NOT_EVALUATED",
    propositionReason: null
  };
}

// shared/quoteVerification.ts
var UNRECORDED_MATCH = "UNRECORDED_MATCH";
var SPACE = /\s/u;
var DROPPED = /* @__PURE__ */ new Set(["\xAD", "\u200B", "\u200C", "\u200D", "\uFEFF"]);
var PUNCTUATION_MAP = {
  "\u2018": "'",
  "\u2019": "'",
  "\u201A": "'",
  "\u201B": "'",
  "\u201C": '"',
  "\u201D": '"',
  "\u201E": '"',
  "\u201F": '"',
  "\u2013": "-",
  "\u2014": "-"
};
function canonicalize(input, mode) {
  const chars = [];
  const starts = [];
  const ends = [];
  const codePoints = Array.from(input);
  for (let k = 0; k < codePoints.length; k++) {
    const c = codePoints[k];
    if (SPACE.test(c)) {
      if (chars.length > 0 && chars[chars.length - 1] === " ") {
        ends[ends.length - 1] = k + 1;
      } else {
        chars.push(" ");
        starts.push(k);
        ends.push(k + 1);
      }
      continue;
    }
    if (mode === "variant") {
      if (DROPPED.has(c)) continue;
      const mapped = PUNCTUATION_MAP[c] ?? c.toLowerCase();
      const out = Array.from(mapped).length === 1 ? mapped : c;
      chars.push(out);
    } else {
      chars.push(c);
    }
    starts.push(k);
    ends.push(k + 1);
  }
  while (chars.length > 0 && chars[0] === " ") {
    chars.shift();
    starts.shift();
    ends.shift();
  }
  while (chars.length > 0 && chars[chars.length - 1] === " ") {
    chars.pop();
    starts.pop();
    ends.pop();
  }
  return { chars, starts, ends };
}
function occurrences(haystack, needle) {
  if (needle.length === 0) return [];
  const h = haystack.join("");
  const n = needle.join("");
  const hits = [];
  let at = h.indexOf(n);
  while (at >= 0 && hits.length < 2) {
    hits.push(Array.from(h.slice(0, at)).length);
    at = h.indexOf(n, at + 1);
  }
  return hits;
}
function unwrapQuote(quote) {
  return (quote || "").trim().replace(/^["'“‘]+|["'”’]+$/g, "").trim();
}
function pageAtOffset(source, codePointOffset) {
  const utf16 = Array.from(source).slice(0, codePointOffset).join("").length;
  const head = source.slice(0, utf16);
  let page = null;
  for (const m of head.matchAll(/\[Page (\d+)\]/g)) page = Number(m[1]);
  return page;
}
function withoutPageMarkers(source) {
  const cps = Array.from(source);
  const kept = [];
  const originalIndex = [];
  for (let k = 0; k < cps.length; ) {
    if (cps[k] === "[") {
      const marker = cps.slice(k, k + 20).join("").match(/^\[Page \d+\]/);
      if (marker) {
        k += Array.from(marker[0]).length;
        continue;
      }
    }
    kept.push(cps[k]);
    originalIndex.push(k);
    k++;
  }
  return { body: kept.join(""), originalIndex };
}
function locateQuote(source, quote) {
  const absent = { status: "ABSENT", page: null, startOffset: null, endOffset: null };
  const q = withoutPageMarkers(unwrapQuote(quote)).body.trim();
  if (!q || !source || !source.trim()) return absent;
  const { body, originalIndex } = withoutPageMarkers(source);
  if (!body.trim()) return absent;
  const bodyCp = Array.from(body);
  const quoteCp = Array.from(q);
  const found = (status, start, end) => {
    const from = originalIndex[start];
    const to = originalIndex[end - 1] + 1;
    return { status, page: pageAtOffset(source, from), startOffset: from, endOffset: to };
  };
  const ambiguous = { status: "AMBIGUOUS", page: null, startOffset: null, endOffset: null };
  const exact = occurrences(bodyCp, quoteCp);
  if (exact.length === 1) return found("EXACT", exact[0], exact[0] + quoteCp.length);
  if (exact.length > 1) return ambiguous;
  const ws = canonicalize(body, "whitespace");
  const wq = canonicalize(q, "whitespace");
  const wsHits = occurrences(ws.chars, wq.chars);
  if (wsHits.length === 1) {
    const h = wsHits[0];
    return found("NORMALIZED_WHITESPACE", ws.starts[h], ws.ends[h + wq.chars.length - 1]);
  }
  if (wsHits.length > 1) return ambiguous;
  const vs = canonicalize(body, "variant");
  const vq = canonicalize(q, "variant");
  const vHits = occurrences(vs.chars, vq.chars);
  if (vHits.length === 1) {
    const h = vHits[0];
    return found("CASE_OR_PUNCTUATION_VARIANT", vs.starts[h], vs.ends[h + vq.chars.length - 1]);
  }
  if (vHits.length > 1) return ambiguous;
  return absent;
}
function isVerbatimQuoteStatus(status) {
  return status === "EXACT" || status === "NORMALIZED_WHITESPACE";
}
function severityCeiling(status) {
  switch (status) {
    case "EXACT":
    case "NORMALIZED_WHITESPACE":
      return "CRITICAL";
    case "CASE_OR_PUNCTUATION_VARIANT":
    case "AMBIGUOUS":
    case UNRECORDED_MATCH:
      return "Worth Raising With Counsel";
    default:
      return "Affects Evidentiary Weight";
  }
}
var VERIFICATION_STATUS = {
  EXACT: "LOCATED_EXACT",
  NORMALIZED_WHITESPACE: "LOCATED_SPACING_DIFFERS",
  CASE_OR_PUNCTUATION_VARIANT: "LOCATED_WORDING_DIFFERS",
  AMBIGUOUS: "LOCATED_MULTIPLE_PLACES",
  ABSENT: "NOT_LOCATED"
};

// shared/casAccountabilityLibrary.ts
var A1_STATUTORY_CAS_DUTIES = [
  {
    ruleId: "CAS_DUTY:CYFSA_1_2_FAMILY_AUTONOMY_LEAST_DISRUPTIVE",
    librarySubcategory: "A1_STATUTORY_DUTY",
    authorityId: "CYFSA:1(2)",
    legalSource: "Child, Youth and Family Services Act, 2017, S.O. 2017, c. 14, Sched. 1",
    exactSectionOrStandard: "CYFSA, s. 1(1)\u2013(2), paras. 1\u20137",
    title: "Paramount Best Interests Purpose & Family Preservation / Least Disruptive Course Principles",
    effectiveFrom: "2018-04-30",
    effectiveTo: null,
    historicalBasisNote: "Succeeded former CFSA, R.S.O. 1990, c. C.11, s. 1(1)\u2013(2) on April 30, 2018.",
    legalForce: "STATUTORY_GUIDING_PRINCIPLE",
    ocpsTextType: "NOT_APPLICABLE",
    standardSummary: "While promoting the best interests, protection and well-being of children is the paramount purpose (s. 1(1)), additional purposes require recognizing that help to parents should support the autonomy and integrity of the family unit on the basis of mutual consent wherever possible (para. 1), considering the least disruptive course of action including prevention, early intervention and community support services (para. 2), building on family strengths (para. 5), and respecting FNIM cultures, traditions, and extended family (para. 6).",
    practiceNoteDistinction: "Section 1(2) establishes mandatory interpretive principles subject to s. 1(1); operational service-delivery duties are enforced through specific provisions such as ss. 35(1)(c), 94(4), 100, and 101(2)\u2013(3).",
    caseStages: ["ALL_STAGES"],
    responsibleParty: "CHILDRENS_AID_SOCIETY",
    requiredAction: "Consider the least disruptive course of action available and appropriate to help the child, including prevention, early intervention, and community support services, and build on family strengths wherever consistent with child safety.",
    triggeringCircumstances: "Any child protection intervention, service planning, or disposition recommendation.",
    deadlineDescription: "Ongoing throughout service delivery",
    deadlineDays: null,
    applicabilityConditions: [
      "Applies to all child protection services and court proceedings under the CYFSA",
      "Expressly subordinate to the paramount purpose of promoting the best interests, protection, and well-being of children under s. 1(1)"
    ],
    exceptions: [
      "Where a less disruptive course of action is inconsistent with the child's immediate safety, protection, or best interests under s. 1(1)"
    ],
    requiredComplianceEvidence: [
      "Documented consideration of prevention, early intervention, or community support services",
      "Assessment of family strengths and collaborative consent options in case notes or Plan of Care"
    ],
    legalConsequencesOfNonCompliance: "Informs judicial scrutiny of the Society's Plan of Care under s. 100 and whether removal thresholds under s. 94(4) or s. 101(2)\u2013(3) have been met.",
    antiOverclaimGuardrail: "Do NOT interpret s. 1(2) as creating an unconditional statutory entitlement to every requested service or as prohibiting emergency apprehension where immediate protection is required under s. 81(7).",
    sourceUrl: "https://www.ontario.ca/laws/statute/17c14#BK3"
  },
  {
    ruleId: "CAS_DUTY:CYFSA_15_2_OPPORTUNITY_TO_BE_HEARD",
    librarySubcategory: "A1_STATUTORY_DUTY",
    authorityId: "CYFSA:15(2)",
    legalSource: "Child, Youth and Family Services Act, 2017, S.O. 2017, c. 14, Sched. 1",
    exactSectionOrStandard: "CYFSA, s. 15(2)\u2013(4)",
    title: "Duty to Ensure Children and Parents Have an Opportunity to Be Heard and Represented",
    effectiveFrom: "2018-04-30",
    effectiveTo: null,
    historicalBasisNote: "Expanded procedural fairness duties under Part II of the CYFSA effective April 30, 2018.",
    legalForce: "STATUTORY_MANDATORY",
    ocpsTextType: "NOT_APPLICABLE",
    standardSummary: "Service providers shall ensure that children, young persons, and their parents have an opportunity to be heard and represented when decisions affecting their interests are made and when they have concerns about the services they are receiving (s. 15(2)), and that decisions are made according to clear, consistent criteria and procedural safeguards (s. 15(4)).",
    practiceNoteDistinction: "Enforceable statutory procedural duty; alleged non-compliance with s. 15(2) is an express ground for complaint to the CFSRB under CYFSA s. 120(4), para. 4.",
    caseStages: ["ALL_STAGES", "DECISION_MAKING", "ONGOING_SERVICE", "PLACEMENT_AND_CONTACT"].filter(
      (s) => s !== "DECISION_MAKING"
    ),
    responsibleParty: "CHILDRENS_AID_SOCIETY",
    requiredAction: "Provide children, young persons, and their parents a meaningful opportunity to be heard and represented before or when making decisions affecting their interests, and apply clear, consistent decision criteria.",
    triggeringCircumstances: "Any agency decision affecting the interests or rights of a child, young person, or parent (e.g., service planning, access changes, placement decisions).",
    deadlineDescription: "When decisions affecting their interests are made",
    deadlineDays: null,
    applicabilityConditions: [
      "Decision by a service provider (including a children's aid society) affecting the interests of a child, young person, or parent"
    ],
    exceptions: [
      "CYFSA s. 15(3): Does not apply if there is 'good cause' for not giving that person an opportunity to be heard or represented (e.g., acute emergency where prior notice would endanger the child)"
    ],
    requiredComplianceEvidence: [
      "Case notes or correspondence showing the parent and age-appropriate child were consulted and given an opportunity to state their views or involve a representative/support person before or during the decision",
      "Written reasons or documented criteria explaining how the decision was reached"
    ],
    legalConsequencesOfNonCompliance: "Subject to direct review by the Child and Family Services Review Board (CFSRB) under CYFSA s. 120(4), para. 4 (unless the issue is before or decided by the court per s. 120(8)), which may order compliance under s. 120(7)(c).",
    antiOverclaimGuardrail: "Always check whether the s. 15(3) 'good cause' exception applies or whether the issue is already before the court (which bars CFSRB review under s. 120(8)).",
    sourceUrl: "https://www.ontario.ca/laws/statute/17c14#BK21"
  },
  {
    ruleId: "CAS_DUTY:CYFSA_17_ADR_CONSIDERATION",
    librarySubcategory: "A1_STATUTORY_DUTY",
    authorityId: "CYFSA:100",
    legalSource: "Child, Youth and Family Services Act, 2017, S.O. 2017, c. 14, Sched. 1",
    exactSectionOrStandard: "CYFSA, s. 17(1)\u2013(2) & s. 95",
    title: "Duty to Consider Alternative Dispute Resolution (ADR) and Indigenous ADR Consultation",
    effectiveFrom: "2018-04-30",
    effectiveTo: null,
    historicalBasisNote: "Continued and strengthened from former CFSA s. 20.2.",
    legalForce: "STATUTORY_MANDATORY",
    ocpsTextType: "NOT_APPLICABLE",
    standardSummary: "If a child is or may be in need of protection, a society shall consider whether a prescribed method of alternative dispute resolution (ADR) could assist in resolving any issue related to the child or a plan for the child's care (s. 17(1)). For a First Nations, Inuk, or M\xE9tis child, the society shall consult with a representative chosen by each of the child's bands and communities regarding Indigenous or prescribed ADR processes (s. 17(2)).",
    practiceNoteDistinction: "Mandatory duty to consider ADR (and mandatory consultation with FNIM representatives under s. 17(2)), though participation in ADR itself requires party consent.",
    caseStages: ["INVESTIGATION", "DISPOSITION_PLANNING", "ONGOING_SERVICE"],
    responsibleParty: "CHILDRENS_AID_SOCIETY",
    requiredAction: "Consider whether a prescribed ADR method (such as Family Group Decision Making, Child Protection Mediation, or Indigenous Circle/ADR) could assist in resolving protection or care-plan issues, and consult the band/community representative for any FNIM child.",
    triggeringCircumstances: "Child is or may be in need of protection and an issue arises regarding the child or Plan of Care.",
    deadlineDescription: "During investigation, service planning, or court proceedings",
    deadlineDays: null,
    applicabilityConditions: ["Child is or may be in need of protection under the CYFSA"],
    exceptions: ["ADR participation itself requires voluntary informed consent of participants and safety suitability"],
    requiredComplianceEvidence: [
      "Documentation in case notes, transfer summary, or court filings that ADR was considered and discussed with the family",
      "For an FNIM child, documented consultation and notice to the band/community representative under s. 17(2) and s. 17(4)"
    ],
    legalConsequencesOfNonCompliance: "The court may adjourn a proceeding at any stage under CYFSA s. 95 (with party consent) to permit utilization of ADR; failure to consult FNIM representatives breaches s. 17(2).",
    antiOverclaimGuardrail: "Section 17(1) requires the society to consider ADR (and s. 17(2) requires consulting FNIM representatives), not that every dispute must be resolved out of court if safety risks or lack of consent preclude ADR.",
    sourceUrl: "https://www.ontario.ca/laws/statute/17c14#BK23"
  },
  {
    ruleId: "CAS_DUTY:CYFSA_35_SOCIETY_FUNCTIONS_AND_STANDARDS",
    librarySubcategory: "A1_STATUTORY_DUTY",
    authorityId: "CYFSA:35(1)",
    legalSource: "Child, Youth and Family Services Act, 2017, S.O. 2017, c. 14, Sched. 1",
    exactSectionOrStandard: "CYFSA, s. 35(1)\u2013(2)",
    title: "Statutory Functions of a Children's Aid Society & Mandatory Compliance with Prescribed Standards",
    effectiveFrom: "2018-04-30",
    effectiveTo: null,
    historicalBasisNote: "Succeeded former CFSA s. 15(3)\u2013(4) on April 30, 2018.",
    legalForce: "STATUTORY_MANDATORY",
    ocpsTextType: "NOT_APPLICABLE",
    standardSummary: "Under s. 35(1), the functions of a society are to (a) investigate allegations or evidence that children may be in need of protection, (b) protect children where necessary, (c) provide guidance, counselling and other services to families for protecting children or for the prevention of circumstances requiring protection, (d) provide care for children assigned/committed to its care, and (e) supervise children assigned to its supervision. Under s. 35(2), a society shall provide the prescribed standard of services and follow prescribed procedures and practices.",
    practiceNoteDistinction: "Section 35(1)(c) establishes the society's statutory preventive/supportive mandate; however, court supervision orders remain subject to the non-funding rule in ss. 94(6)(c), 101(7)(c), and 116(4)(c).",
    caseStages: ["ALL_STAGES"],
    responsibleParty: "CHILDRENS_AID_SOCIETY",
    requiredAction: "Carry out child protection investigations, provide guidance, counselling, and preventive/protective family services, care for or supervise children as authorized, and follow prescribed Ministry standards and procedures (OCPS 2016 / O. Reg. 156/18).",
    triggeringCircumstances: "Receipt of a protection report, open investigation, or ongoing family service / court supervision.",
    deadlineDescription: "Ongoing statutory mandate",
    deadlineDays: null,
    applicabilityConditions: ["Agency designated as a children's aid society under CYFSA s. 34(1)"],
    exceptions: [
      "Under CYFSA ss. 94(6)(c), 101(7)(c), and 116(4)(c), a court supervision order cannot compel a society to provide direct financial assistance or purchase goods or services"
    ],
    requiredComplianceEvidence: [
      "Documented investigation steps under s. 35(1)(a)",
      "Documented guidance, counselling, or referrals offered to the family under s. 35(1)(c)",
      "Adherence to prescribed standards under s. 35(2)"
    ],
    legalConsequencesOfNonCompliance: "Failure to offer guidance/counselling or preventive assistance under s. 35(1)(c) directly undermines the society's position under s. 101(2)\u2013(3) when seeking a removal order, and may trigger Ministry compliance orders under s. 43.",
    antiOverclaimGuardrail: "Never state that s. 35(1)(c) creates an unlimited obligation for CAS to pay for private therapy or purchase goods/services; always note the statutory limitation in ss. 94(6)(c), 101(7)(c), and 116(4)(c).",
    sourceUrl: "https://www.ontario.ca/laws/statute/17c14#BK46"
  },
  {
    ruleId: "CAS_DUTY:CYFSA_72_73_80_FNIM_CONSULTATION_AND_CUSTOMARY_CARE",
    librarySubcategory: "A1_STATUTORY_DUTY",
    authorityId: "CYFSA:72",
    legalSource: "Child, Youth and Family Services Act, 2017, S.O. 2017, c. 14, Sched. 1 & Federal Bill C-92",
    exactSectionOrStandard: "CYFSA, ss. 72, 73, 79(1) para. 4, 80, 101(5), 109(2)(d) & Bill C-92, ss. 12, 14, 15, 15.1, 16",
    title: "Indigenous (First Nations, Inuit, and M\xE9tis) Consultation, Party Notice, Customary Care & Placement Priority",
    effectiveFrom: "2018-04-30",
    effectiveTo: null,
    historicalBasisNote: "CYFSA Part IV in force April 30, 2018; federal Bill C-92 (S.C. 2019, c. 24) in force January 1, 2020.",
    legalForce: "STATUTORY_MANDATORY",
    ocpsTextType: "NOT_APPLICABLE",
    standardSummary: "When serving a First Nations, Inuk, or M\xE9tis child, a society must regularly consult the child's bands and FNIM communities (s. 72), consult chosen representatives on prescribed services/powers (s. 73), recognize band/community representatives as statutory parties (s. 79(1) para. 4), make all reasonable efforts to pursue customary care where the child cannot remain with the parent (s. 80), prioritize preventive care and reasonable pre-apprehension efforts (Bill C-92 ss. 14, 15.1), never apprehend solely on socio-economic conditions (Bill C-92 s. 15), and follow the statutory placement priority hierarchy (CYFSA ss. 101(5), 109(2)(d); Bill C-92 s. 16).",
    practiceNoteDistinction: "Binding provincial and federal statutory mandates, not discretionary practice guidelines.",
    caseStages: ["ALL_STAGES"],
    responsibleParty: "CHILDRENS_AID_SOCIETY",
    requiredAction: "Identify whether the child is a First Nations, Inuk, or M\xE9tis child (s. 90(2)(b)), give notice to and consult band/community representatives, prioritize preventive services, make all reasonable efforts to pursue a customary care plan (s. 80), and follow placement priority rules.",
    triggeringCircumstances: "Any child protection report, investigation, removal, agreement, service plan, or court proceeding involving a First Nations, Inuk, or M\xE9tis child.",
    deadlineDescription: "Prior to taking any significant measure (Bill C-92 s. 12(1)) and throughout the case",
    deadlineDays: null,
    applicabilityConditions: [
      "The child is a First Nations, Inuk, or M\xE9tis child (or identifies with / is a member of a band or listed FNIM community)"
    ],
    exceptions: [
      "Placement outside the priority hierarchy under s. 101(5) requires proving a 'substantial reason for placing the child elsewhere' and documenting why higher-priority placements under Bill C-92 s. 16(1) were not possible"
    ],
    requiredComplianceEvidence: [
      "Early identification inquiry into Indigenous heritage and band/community affiliation",
      "Written notice and consultation logs with the child's band(s) and FNIM community representatives",
      "Documented efforts to explore customary care (s. 80) and extended family placement (s. 101(5), Bill C-92 s. 16)"
    ],
    legalConsequencesOfNonCompliance: "Failure to notify/consult band representatives or demonstrate pre-apprehension reasonable efforts (Bill C-92 s. 15.1) can invalidate procedural steps, require adjournment for proper notice, or defeat a removal/disposition request.",
    antiOverclaimGuardrail: "If the uploaded record does not indicate whether the child is First Nations, Inuk, or M\xE9tis, mark Indigenous-specific rules as REQUIRES_FACTUAL_CLARIFICATION / NOT_APPLICABLE unless Indigenous identity is identified.",
    sourceUrl: "https://www.ontario.ca/laws/statute/17c14#BK89"
  },
  {
    ruleId: "CAS_DUTY:CYFSA_81_88_APPREHENSION_AND_5_DAY_HEARING",
    librarySubcategory: "A1_STATUTORY_DUTY",
    authorityId: "CYFSA:81(7)",
    legalSource: "Child, Youth and Family Services Act, 2017, S.O. 2017, c. 14, Sched. 1",
    exactSectionOrStandard: "CYFSA, ss. 81(2), 81(7) & 88",
    title: "Apprehension Thresholds (Warrant vs Warrantless) & Mandatory 5-Day Court Hearing Rule",
    effectiveFrom: "2018-04-30",
    effectiveTo: null,
    historicalBasisNote: "Succeeded former CFSA ss. 40(2), 40(7), and 46(1) on April 30, 2018.",
    legalForce: "STATUTORY_MANDATORY",
    ocpsTextType: "NOT_APPLICABLE",
    standardSummary: "A warrantless apprehension under s. 81(7) requires reasonable and probable grounds that (a) the child is in need of protection, (b) the child is under 16, and (c) there would be a substantial risk to the child's health or safety during the time necessary to bring the matter on for a s. 90(1) hearing or obtain a warrant under s. 81(2). Once brought to a place of safety, s. 88 requires that as soon as practicable, and in any event within 5 days, the matter be brought before a court for a s. 90(1) hearing, the child be returned, or a s. 75(1)/s. 77 agreement be made.",
    practiceNoteDistinction: "Strict statutory and constitutional (Charter s. 7) safeguards governing state removal of a child.",
    caseStages: ["APPREHENSION_REMOVAL", "INITIAL_COURT_HEARING"],
    responsibleParty: "CHILD_PROTECTION_WORKER",
    requiredAction: "Document objective reasonable and probable grounds explaining why time did not permit seeking a warrant (s. 81(2)) or hearing (s. 90(1)), and bring the matter before the court (or return the child / execute a valid agreement) within 5 days under s. 88.",
    triggeringCircumstances: "Bringing a child to a place of safety with or without a warrant.",
    deadlineDescription: "As soon as practicable, and in any event within 5 days after bringing the child to a place of safety (CYFSA s. 88)",
    deadlineDays: 5,
    applicabilityConditions: [
      "Child younger than 16 brought to a place of safety under s. 81, s. 83(1)(a)(ii), or s. 136(5)"
    ],
    exceptions: [
      "If the child is returned to the person who last had charge (s. 88(b)) or a valid s. 75(1) / s. 77 agreement is executed within the 5-day window (s. 88(d)\u2013(e))"
    ],
    requiredComplianceEvidence: [
      "Contemporaneous apprehension notes and sworn affidavit explaining why waiting for a s. 81(2) warrant or s. 90(1) hearing posed a substantial risk",
      "Court endorsement or application filing timestamp within 5 days of apprehension"
    ],
    legalConsequencesOfNonCompliance: "Holding a child in a place of safety beyond 5 days without bringing the matter to court or meeting s. 88(b)\u2013(e) is unlawful and breaches CYFSA s. 88.",
    antiOverclaimGuardrail: "Never attribute warrantless apprehension authority to s. 81(1), and never attribute the 5-day hearing rule to s. 94(1) or s. 94(5).",
    sourceUrl: "https://www.ontario.ca/laws/statute/17c14#BK103"
  },
  {
    ruleId: "CAS_DUTY:CYFSA_100_101_PLAN_OF_CARE_AND_DISPOSITION",
    librarySubcategory: "A1_STATUTORY_DUTY",
    authorityId: "CYFSA:100",
    legalSource: "Child, Youth and Family Services Act, 2017, S.O. 2017, c. 14, Sched. 1",
    exactSectionOrStandard: "CYFSA, ss. 100 & 101(1)\u2013(4), (7)",
    title: "Mandatory Written Plan of Care Elements, Pre-Intervention Assistance Inquiry & Less Disruptive Alternatives",
    effectiveFrom: "2018-04-30",
    effectiveTo: null,
    historicalBasisNote: "Succeeded former CFSA ss. 56 and 57 on April 30, 2018.",
    legalForce: "STATUTORY_MANDATORY",
    ocpsTextType: "NOT_APPLICABLE",
    standardSummary: "Before the court makes a disposition or status review order under s. 101, 102, 114, or 116, the society must prepare a written Plan of Care (s. 100) describing (a) remedial services to be provided, (b) criteria by which the society will determine when its care or supervision is no longer required, (c) estimated time required, (d) if removing the child, why the child cannot be protected in the person's care, past efforts to do so, and planned contact efforts, (e) long-term placement arrangements if permanent removal is sought, and (f) cultural preservation arrangements. Under s. 101(2)\u2013(4), the court must inquire into pre-intervention assistance efforts, prefer less disruptive alternatives, and consider placement with a relative or community member.",
    practiceNoteDistinction: "Mandatory statutory elements required in every written Plan of Care filed with the court.",
    caseStages: ["DISPOSITION_PLANNING", "STATUS_REVIEW"],
    responsibleParty: "CHILDRENS_AID_SOCIETY",
    requiredAction: "File a complete written Plan of Care satisfying all clauses of s. 100(a)\u2013(f), document pre-intervention assistance efforts (s. 101(2)), explain why less disruptive alternatives are inadequate (s. 101(3)), and assess kinship/community placement options (s. 101(4)).",
    triggeringCircumstances: "Any application for a disposition order under s. 101/102 or status review order under s. 114/116.",
    deadlineDescription: "Prior to the court making an order under s. 101, 102, 114, or 116",
    deadlineDays: null,
    applicabilityConditions: ["Court proceeding seeking an order under CYFSA s. 101, 102, 114, or 116"],
    exceptions: [
      "Under s. 101(7)(c), supervision terms on the society shall not require the society to provide financial assistance or purchase goods or services"
    ],
    requiredComplianceEvidence: [
      "Written Plan of Care addressing s. 100(a) remedial services, s. 100(b) measurable exit criteria, s. 100(c) time estimate, and s. 100(d) past in-home protection efforts and access plan",
      "Evidence of pre-intervention assistance efforts (s. 101(2)) and kinship assessment (s. 101(4))"
    ],
    legalConsequencesOfNonCompliance: "A Plan of Care that omits specific remedial services (s. 100(a)), measurable exit criteria (s. 100(b)), or past efforts to protect the child in the parent's care (s. 100(d)(i)) is statutorily deficient under s. 100.",
    antiOverclaimGuardrail: "Section 100 (not s. 51) governs the court Plan of Care; s. 13(1) governs the individual residential Plan of Care prepared within 30 days of admission to a residential placement.",
    sourceUrl: "https://www.ontario.ca/laws/statute/17c14#BK123"
  },
  {
    ruleId: "CAS_DUTY:CYFSA_306_312_315_PART_X_RECORDS_AND_PRIVACY",
    librarySubcategory: "A1_STATUTORY_DUTY",
    authorityId: "CYFSA:312(1)",
    legalSource: "Child, Youth and Family Services Act, 2017, S.O. 2017, c. 14, Sched. 1, Part X",
    exactSectionOrStandard: "CYFSA, ss. 306(1), 312(1), 314(3), 315(2), 315(12) & 316(1)",
    title: "Part X Personal Information Accuracy, Right of Access (30-Day Response) & Right to Request Correction",
    effectiveFrom: "2020-01-01",
    effectiveTo: null,
    historicalBasisNote: "Part X of the CYFSA came into force on January 1, 2020.",
    legalForce: "STATUTORY_MANDATORY",
    ocpsTextType: "NOT_APPLICABLE",
    standardSummary: "Service providers must take reasonable steps to ensure personal information used for providing a service is accurate, complete, and up-to-date (s. 306(1)). An individual has a right of access to records of their personal information (s. 312(1), subject to enumerated exceptions and severability under s. 312(2)), with a mandatory 30-day written response deadline (s. 314(3)). Once granted access, the individual may request in writing that inaccurate or incomplete records be corrected (s. 315(2)), and if refused, may require a Statement of Disagreement to be attached to the record (s. 315(12)) and complain to the IPC (s. 316).",
    practiceNoteDistinction: "Binding Part X statutory obligations overseen by the Information and Privacy Commissioner of Ontario (IPC).",
    caseStages: ["RECORDS_AND_PRIVACY", "ALL_STAGES"],
    responsibleParty: "CHILDRENS_AID_SOCIETY",
    requiredAction: "Maintain accurate, complete, and up-to-date personal information records (s. 306(1)), respond to written Part X access requests within 30 days (s. 314(3)), and respond to written correction requests within 30 days (s. 315(4)) or attach the requester's Statement of Disagreement (s. 315(12), (14)).",
    triggeringCircumstances: "Use/disclosure of personal information or receipt of a written access (s. 313) or correction (s. 315(2)) request on or after January 1, 2020.",
    deadlineDescription: "30 days after receiving a written access request (s. 314(3)) or correction request (s. 315(4)), subject to noticed extension up to 90 days",
    deadlineDays: 30,
    applicabilityConditions: [
      "Event or request occurs on or after January 1, 2020 (when Part X came into force)"
    ],
    exceptions: [
      "Access exceptions in s. 312(1)(a)\u2013(d) (privilege, ongoing proceeding preparation under (c), risk of serious harm or confidential informant identity under (d), subject to mandatory severability under s. 312(2))",
      "Correction exception in s. 315(10)(b) for a professional opinion or observation made in good faith (though the right to attach a Statement of Disagreement under s. 315(12) still applies)"
    ],
    requiredComplianceEvidence: [
      "Written response to s. 313 access request within 30 days (or written extension notice under s. 314(4))",
      "Written response to s. 315(2) correction request within 30 days, non-obliterating correction under s. 315(11), or attachment of Statement of Disagreement under s. 315(14)"
    ],
    legalConsequencesOfNonCompliance: "Failure to respond within 30 days is a deemed refusal (ss. 314(7), 315(7)), shifting the burden of proof onto the society in an IPC complaint (ss. 314(8)(b), 315(8)(b)).",
    antiOverclaimGuardrail: "Never cite s. 292 (disclosure without consent) for an individual's right to access their own records (which is s. 312(1)), and never apply Part X to events prior to January 1, 2020.",
    sourceUrl: "https://www.ontario.ca/laws/statute/17c14#BK361"
  }
];
var A2_OCPS_2016_STANDARDS = [
  {
    ruleId: "OCPS_2016:STD_1_REFERRAL_SCREENING",
    librarySubcategory: "A2_OCPS_STANDARD",
    authorityId: "OCPS:STD_1",
    legalSource: "Ontario Child Protection Standards (2016) & O. Reg. 156/18 under CYFSA s. 35(2)",
    exactSectionOrStandard: "OCPS (2016), Standard 1 (Receipt of Report or Referral)",
    title: "Standard 1 \u2014 Referral Screening, Eligibility Spectrum, 24-Hour History Check & Response Time",
    effectiveFrom: "2016-02-01",
    effectiveTo: null,
    historicalBasisNote: "Issued February 1, 2016 under the former CFSA; continued as prescribed operational standards under CYFSA s. 35(2) and O. Reg. 156/18 on April 30, 2018.",
    legalForce: "MINISTRY_STANDARD_MANDATORY",
    ocpsTextType: "STANDARD",
    standardSummary: "Standard 1 requires the worker to gather referral information, check local and provincial child welfare history within 24 hours of receipt, apply the Ontario Child Welfare Eligibility Spectrum to determine whether the report meets the threshold for a protection investigation, assign the required response time (12 hours for immediate/extremely severe or 7 days for moderately severe), and obtain supervisory approval within 24 hours for extreme/immediate referrals or prior to closing at intake.",
    practiceNoteDistinction: "STANDARD text mandates the 24-hour database/history check, Eligibility Spectrum coding, 12-hour vs 7-day response assignment, and supervisory sign-off. PRACTICE NOTES provide clinical guidance on questioning callers and exploring community referrals when a report does not meet the protection threshold; Practice Notes do not have the same mandatory legal force as the Standard.",
    caseStages: ["REFERRAL_SCREENING"],
    responsibleParty: "CHILD_PROTECTION_WORKER",
    requiredAction: "Screen referral using the Eligibility Spectrum, complete prior history check within 24 hours, assign 12-hour or 7-day response time, and obtain supervisory approval.",
    triggeringCircumstances: "Receipt of a report or referral under CYFSA s. 125 / s. 126(1).",
    deadlineDescription: "History check within 24 hours; response time of 12 hours (immediate) or 7 days (moderately severe)",
    deadlineDays: 7,
    applicabilityConditions: ["Report or referral received by a children's aid society"],
    exceptions: ["Supervisor-approved documented extension or inability to locate family despite documented diligent efforts"],
    requiredComplianceEvidence: [
      "Intake screening record showing Eligibility Spectrum code",
      "Prior child protection history check timestamp within 24 hours",
      "Assigned response timeframe (12 hours or 7 days) and supervisor sign-off"
    ],
    legalConsequencesOfNonCompliance: "Delayed or unapproved screening may indicate an investigative gap or unexplained delay inconsistent with alleged urgency.",
    antiOverclaimGuardrail: "Do not treat Practice Notes under Standard 1 as statutory rules; verify whether the intake screening record is actually included in the uploaded disclosure before concluding a step was omitted.",
    sourceUrl: "https://www.ontario.ca/page/ontario-child-protection-standards-2016"
  },
  {
    ruleId: "OCPS_2016:STD_2_INVESTIGATION_PLANNING_AND_CONDUCT",
    librarySubcategory: "A2_OCPS_STANDARD",
    authorityId: "OCPS:STD_2",
    legalSource: "Ontario Child Protection Standards (2016) & O. Reg. 156/18 under CYFSA s. 35(2)",
    exactSectionOrStandard: "OCPS (2016), Standard 2 (Planning and Conducting a Child Protection Investigation)",
    title: "Standard 2 \u2014 Investigation Planning, Customized vs Traditional Response, and Interviews",
    effectiveFrom: "2016-02-01",
    effectiveTo: null,
    historicalBasisNote: "Issued February 1, 2016 under the former CFSA; continued under CYFSA s. 35(2) and O. Reg. 156/18.",
    legalForce: "MINISTRY_STANDARD_MANDATORY",
    ocpsTextType: "STANDARD",
    standardSummary: "Standard 2 requires pre-investigation planning in consultation with a supervisor, selecting a customized or traditional investigative approach, conducting unannounced visits only where planned visits would compromise child safety or investigation integrity, conducting separate face-to-face interviews with the alleged victim child, other children in the home, all parents/caregivers, and relevant collateral witnesses, and directly observing non-verbal/young children.",
    practiceNoteDistinction: "STANDARD text mandates supervisory planning, face-to-face interviews with the child, siblings, and parents/caregivers, and collateral checks. PRACTICE NOTES offer interviewing techniques and scheduling tips, which are clinical guidance rather than mandatory rules.",
    caseStages: ["INVESTIGATION"],
    responsibleParty: "CHILD_PROTECTION_WORKER",
    requiredAction: "Plan the investigation with a supervisor, interview the child, siblings, both/all custodial parents/caregivers, and relevant neutral collaterals, and document direct observations.",
    triggeringCircumstances: " Referral screened in for a child protection investigation.",
    deadlineDescription: "First face-to-face contact with child within 12 hours or 7 days per assigned response priority",
    deadlineDays: 7,
    applicabilityConditions: ["Open child protection investigation"],
    exceptions: [
      "Documented supervisory approval for any departure from required response times or interview sequence where safety or police protocol requires"
    ],
    requiredComplianceEvidence: [
      "Documented investigation plan and supervisory consultation",
      "Case notes of face-to-face interviews with the child, parents/caregivers, and independent collaterals (e.g., school, physician)"
    ],
    legalConsequencesOfNonCompliance: "Failure to interview a parent, failure to contact obvious neutral collaterals, or relying solely on one party's uncorroborated allegations weakens the reliability of the society's investigative conclusions.",
    antiOverclaimGuardrail: "Absence of collateral notes in a partial court brief is a documentation gap to pursue through disclosure, not automatic proof that no collateral contact occurred.",
    sourceUrl: "https://www.ontario.ca/page/ontario-child-protection-standards-2016"
  },
  {
    ruleId: "OCPS_2016:STD_3_SAFETY_ASSESSMENT",
    librarySubcategory: "A2_OCPS_STANDARD",
    authorityId: "OCPS:STD_3",
    legalSource: "Ontario Child Protection Standards (2016) & O. Reg. 156/18 under CYFSA s. 35(2)",
    exactSectionOrStandard: "OCPS (2016), Standard 3 (Assessing Safety)",
    title: "Standard 3 \u2014 Immediate Safety Assessment, Collaborative Safety Planning & Supervisory Approval",
    effectiveFrom: "2016-02-01",
    effectiveTo: null,
    historicalBasisNote: "Issued February 1, 2016 under the former CFSA; continued under CYFSA s. 35(2) and O. Reg. 156/18.",
    legalForce: "MINISTRY_STANDARD_MANDATORY",
    ocpsTextType: "STANDARD",
    standardSummary: "Standard 3 requires the worker to assess immediate safety threats at the first face-to-face contact, engage the family and extended network in developing the least intrusive Safety Plan capable of controlling immediate safety threats (preferring in-home or kinship safety interventions over removal where safe), assess the suitability and commitment of safety-plan participants, monitor the Safety Plan while active, and obtain immediate supervisory approval when a safety threat is identified.",
    practiceNoteDistinction: "STANDARD text requires completing the Safety Assessment at first face-to-face contact, considering in-home/kinship safety interventions before removal, and obtaining immediate supervisory approval. PRACTICE NOTES discuss examples of safety interventions and family engagement strategies.",
    caseStages: ["SAFETY_ASSESSMENT", "INVESTIGATION", "APPREHENSION_REMOVAL"],
    responsibleParty: "CHILD_PROTECTION_WORKER",
    requiredAction: "Complete the Safety Assessment at first face-to-face contact, evaluate less intrusive in-home or family/kinship safety-plan options with the parent before removal, and obtain supervisory approval.",
    triggeringCircumstances: "First face-to-face contact in an investigation or any subsequent emergence of an immediate safety threat.",
    deadlineDescription: "Safety assessment at first face-to-face contact; supervisory approval within 24 hours (or immediately if safety threat identified)",
    deadlineDays: 1,
    applicabilityConditions: ["Investigation or ongoing case where immediate child safety is assessed"],
    exceptions: ["Immediate emergency removal where no in-home or kinship safety plan can adequately protect the child"],
    requiredComplianceEvidence: [
      "Completed Safety Assessment tool and documented Safety Plan (if safety threats identified)",
      "Documentation of why in-home or extended-family safety interventions were or were not feasible",
      "Supervisory consultation and sign-off timestamp"
    ],
    legalConsequencesOfNonCompliance: "Directly relevant to whether the society satisfied CYFSA s. 81(7)(c), s. 94(4), and s. 101(3) regarding less disruptive alternatives.",
    antiOverclaimGuardrail: "Do not assume a Safety Assessment was not completed merely because only an affidavit was uploaded; flag the Safety Assessment tool as a priority disclosure request.",
    sourceUrl: "https://www.ontario.ca/page/ontario-child-protection-standards-2016"
  },
  {
    ruleId: "OCPS_2016:STD_4_RISK_ASSESSMENT",
    librarySubcategory: "A2_OCPS_STANDARD",
    authorityId: "OCPS:STD_4",
    legalSource: "Ontario Child Protection Standards (2016) & O. Reg. 156/18 under CYFSA s. 35(2)",
    exactSectionOrStandard: "OCPS (2016), Standard 4 (Assessing Risk)",
    title: "Standard 4 \u2014 Actuarial Risk Assessment Before Concluding Investigation or Transferring Case",
    effectiveFrom: "2016-02-01",
    effectiveTo: null,
    historicalBasisNote: "Issued February 1, 2016 under the former CFSA; continued under CYFSA s. 35(2) and O. Reg. 156/18.",
    legalForce: "MINISTRY_STANDARD_MANDATORY",
    ocpsTextType: "STANDARD",
    standardSummary: "Standard 4 mandates completion of the Ontario Family Risk Assessment tool prior to concluding an investigation or transferring a case to ongoing services, incorporating clinical judgment and family protective capacities, with supervisory review and approval.",
    practiceNoteDistinction: "STANDARD text requires completing the Risk Assessment and obtaining supervisory approval prior to investigation conclusion/transfer. PRACTICE NOTES provide guidance on discussing risk factors with families.",
    caseStages: ["INVESTIGATION", "CASE_TRANSFER"],
    responsibleParty: "CHILD_PROTECTION_WORKER",
    requiredAction: "Complete the standardized Family Risk Assessment tool and obtain supervisory approval before concluding the investigation or transferring the file to ongoing services.",
    triggeringCircumstances: "Conclusion of a child protection investigation or transfer to ongoing services.",
    deadlineDescription: "Prior to concluding investigation (within 45 days of referral under Standard 5)",
    deadlineDays: 45,
    applicabilityConditions: ["Child protection investigation reaching disposition or transfer"],
    exceptions: ["Investigation terminated early because child/family does not exist or society lacks jurisdiction"],
    requiredComplianceEvidence: [
      "Completed Family Risk Assessment tool with scored items, clinical overrides (if any), and supervisor approval"
    ],
    legalConsequencesOfNonCompliance: "Proceeding to ongoing intervention or court disposition without a completed, supervisor-approved Risk Assessment departs from Standard 4.",
    antiOverclaimGuardrail: "Distinguish actuarial risk scores under Standard 4 from evidence proving a child is in need of protection under CYFSA s. 74(2).",
    sourceUrl: "https://www.ontario.ca/page/ontario-child-protection-standards-2016"
  },
  {
    ruleId: "OCPS_2016:STD_5_INVESTIGATION_CONCLUSION_AND_VERIFICATION",
    librarySubcategory: "A2_OCPS_STANDARD",
    authorityId: "OCPS:STD_5",
    legalSource: "Ontario Child Protection Standards (2016) & O. Reg. 156/18 under CYFSA s. 35(2)",
    exactSectionOrStandard: "OCPS (2016), Standard 5 (Concluding a Child Protection Investigation)",
    title: "Standard 5 \u2014 Verification Decision, 45-Day Investigation Completion & Notice of Outcome to Parents",
    effectiveFrom: "2016-02-01",
    effectiveTo: null,
    historicalBasisNote: "Issued February 1, 2016 under the former CFSA; continued under CYFSA s. 35(2) and O. Reg. 156/18.",
    legalForce: "MINISTRY_STANDARD_MANDATORY",
    ocpsTextType: "STANDARD",
    standardSummary: "Standard 5 requires the worker to make an evidence-based verification decision (verified, not verified, or inconclusive) on a balance of probabilities, conclude the investigation within 45 days of referral (unless a supervisor approves a documented extension), obtain supervisory sign-off, and inform the parents and child (as age-appropriate) of the investigation outcome, verification decision, and disposition.",
    practiceNoteDistinction: "STANDARD text mandates the balance-of-probabilities verification analysis, the 45-day timeframe (subject to supervisor-approved extension), supervisory approval, and notifying the family of the outcome. PRACTICE NOTES provide guidance on communicating verification decisions sensitively.",
    caseStages: ["INVESTIGATION", "CASE_TRANSFER"],
    responsibleParty: "CHILD_PROTECTION_WORKER",
    requiredAction: "Document the verification decision and supporting evidence, complete the investigation within 45 days (or obtain supervisory extension approval), obtain supervisory approval, and notify the parents of the outcome.",
    triggeringCircumstances: "Conclusion of a child protection investigation.",
    deadlineDescription: "Within 45 days of receipt of the referral (unless a supervisor approves a documented extension)",
    deadlineDays: 45,
    applicabilityConditions: ["Open child protection investigation"],
    exceptions: [
      "Supervisor-approved documented extension where third-party forensic/medical/police information is pending"
    ],
    requiredComplianceEvidence: [
      "Investigation Conclusion / Verification record dated within 45 days of referral (or documented supervisory extension)",
      "Supervisory approval of verification and disposition",
      "Record of verbal/written notification to parents of the investigation outcome and reasons"
    ],
    legalConsequencesOfNonCompliance: "Unapproved delays beyond 45 days or failure to notify parents of the verification decision and reasons engages CYFSA s. 15(2) and s. 120(4), para. 5.",
    antiOverclaimGuardrail: "A CAS 'verification' decision under Standard 5 is an internal agency decision, NOT a judicial protection finding under CYFSA s. 74(2).",
    sourceUrl: "https://www.ontario.ca/page/ontario-child-protection-standards-2016"
  },
  {
    ruleId: "OCPS_2016:STD_6_CASE_TRANSFER",
    librarySubcategory: "A2_OCPS_STANDARD",
    authorityId: "OCPS:STD_6",
    legalSource: "Ontario Child Protection Standards (2016) & O. Reg. 156/18 under CYFSA s. 35(2)",
    exactSectionOrStandard: "OCPS (2016), Standard 6 (Transferring a Case)",
    title: "Standard 6 \u2014 Case Transfer Conferencing, Continuity of Service & Supervisory Approval",
    effectiveFrom: "2016-02-01",
    effectiveTo: null,
    historicalBasisNote: "Issued February 1, 2016 under the former CFSA; continued under CYFSA s. 35(2) and O. Reg. 156/18.",
    legalForce: "MINISTRY_STANDARD_MANDATORY",
    ocpsTextType: "STANDARD",
    standardSummary: "Standard 6 requires that when transferring a case from investigation to ongoing services (or between workers or societies), the transferring and receiving workers hold a transfer conference/meeting (involving the family where appropriate), complete transfer documentation, and obtain supervisory approval so service continuity is maintained.",
    practiceNoteDistinction: "STANDARD text mandates transfer documentation, worker handoff conferencing, family notification/involvement, and supervisory approval. PRACTICE NOTES suggest ways to introduce the new worker to the family.",
    caseStages: ["CASE_TRANSFER"],
    responsibleParty: "CHILD_PROTECTION_WORKER",
    requiredAction: "Complete transfer documentation, hold a transfer conference between transferring and receiving workers (involving the family where appropriate), and obtain supervisory approval.",
    triggeringCircumstances: "Transfer of a file from investigation to ongoing service, between ongoing workers, or between societies.",
    deadlineDescription: "At the point of case transfer (which triggers the 30-day Standard 7 service-plan clock)",
    deadlineDays: null,
    applicabilityConditions: ["Case transferred to ongoing services, a new worker, or another society"],
    exceptions: ["Emergency worker reassignment due to sudden leave (where supervisor manages interim handoff)"],
    requiredComplianceEvidence: [
      "Case transfer record with exact transfer date, transferring/receiving worker names, and supervisor sign-off",
      "Documentation of transfer conference and family notification"
    ],
    legalConsequencesOfNonCompliance: "Uncoordinated transfers often cause dropped referrals, lost service momentum, and ambiguity over the Standard 7 30-day service-plan deadline.",
    antiOverclaimGuardrail: "Record the exact case transfer date when present; if absent, do not guess the transfer date.",
    sourceUrl: "https://www.ontario.ca/page/ontario-child-protection-standards-2016"
  },
  {
    ruleId: "OCPS_2016:STD_7_ONGOING_SERVICE_CASE_MANAGEMENT",
    librarySubcategory: "A2_OCPS_STANDARD",
    authorityId: "OCPS:STD_7",
    legalSource: "Ontario Child Protection Standards (2016) & O. Reg. 156/18 under CYFSA s. 35(2)",
    exactSectionOrStandard: "OCPS (2016), Standard 7 (Ongoing Service Case Management)",
    title: "Standard 7 \u2014 Ongoing Service Case Management, 30-Day Service Plan, Monthly Contact & 6-Month Reviews",
    effectiveFrom: "2016-02-01",
    effectiveTo: null,
    historicalBasisNote: "Issued February 1, 2016 under the former CFSA; continued under CYFSA s. 35(2) and O. Reg. 156/18.",
    legalForce: "MINISTRY_STANDARD_MANDATORY",
    ocpsTextType: "STANDARD",
    standardSummary: "Standard 7 requires completing a Family and Child Strengths and Needs Assessment and an initial written Service Plan within 30 days of investigation completion or case transfer to ongoing services, developed collaboratively with the parents, child, and extended network/FNIM representatives. It requires specific goals, activities, responsible persons, timeframes, active service referrals and monitoring, at least monthly face-to-face contact with the child and parents (including home visits), formal case reviews and Risk Reassessments at least every 6 months (or upon significant change), reunification assessment and concurrent planning where the child is out of home, and supervisory review/approval.",
    practiceNoteDistinction: "STANDARD text mandates the 30-day initial Service Plan from investigation completion/case transfer, collaborative parent participation, monthly face-to-face/home contact, active service coordination, 6-month formal case reviews, reunification assessment, and supervisory sign-off. PRACTICE NOTES discuss clinical goal-setting phrasing and conferencing styles.",
    caseStages: ["ONGOING_SERVICE", "DISPOSITION_PLANNING", "STATUS_REVIEW"],
    responsibleParty: "CHILD_PROTECTION_WORKER",
    requiredAction: "Complete the Strengths and Needs Assessment and initial collaborative Service Plan within 30 days of investigation completion or case transfer, make concrete referrals, maintain monthly face-to-face/home contact, review the Service Plan at least every 6 months, assess reunification, and obtain supervisory approval.",
    triggeringCircumstances: "Investigation completion with ongoing service disposition or transfer of case to ongoing protection services.",
    deadlineDescription: "Initial Service Plan within 30 days of investigation completion or case transfer; face-to-face contact at least monthly; formal case review at least every 6 months",
    deadlineDays: 30,
    applicabilityConditions: ["Case open in ongoing child protection services"],
    exceptions: [
      "If the triggering investigation completion date or case transfer date is not in the uploaded records, the 30-day deadline is DEADLINE_NOT_DETERMINABLE"
    ],
    requiredComplianceEvidence: [
      "Written Ongoing Service Plan and Family/Child Strengths and Needs Assessment dated within 30 days of investigation completion or case transfer",
      "Evidence of parent participation/signature or documented efforts to engage the parent",
      "Specific goals, activities, responsible persons, timeframes, and referral records",
      "Monthly face-to-face and home-visit case notes, 6-month formal review records, and supervisory approvals"
    ],
    legalConsequencesOfNonCompliance: "Failure to develop a timely collaborative Service Plan, make concrete referrals, or conduct periodic reunification reviews undermines any claim that the parent failed to remedy protection concerns within the s. 122(1) time-in-care limits.",
    antiOverclaimGuardrail: "NEVER calculate the Standard 7 30-day service-plan deadline from the removal/apprehension date alone; it runs from investigation completion or case transfer (if unknown, return DEADLINE_NOT_DETERMINABLE).",
    sourceUrl: "https://www.ontario.ca/page/ontario-child-protection-standards-2016"
  },
  {
    ruleId: "OCPS_2016:STD_8_ENDING_CHILD_PROTECTION_SERVICES",
    librarySubcategory: "A2_OCPS_STANDARD",
    authorityId: "OCPS:STD_8",
    legalSource: "Ontario Child Protection Standards (2016) & O. Reg. 156/18 under CYFSA s. 35(2)",
    exactSectionOrStandard: "OCPS (2016), Standard 8 (Ending Child Protection Services)",
    title: "Standard 8 \u2014 Final Safety/Risk Review, Community Linkages, Family Notice & Supervisory Approval on Closure",
    effectiveFrom: "2016-02-01",
    effectiveTo: null,
    historicalBasisNote: "Issued February 1, 2016 under the former CFSA; continued under CYFSA s. 35(2) and O. Reg. 156/18.",
    legalForce: "MINISTRY_STANDARD_MANDATORY",
    ocpsTextType: "STANDARD",
    standardSummary: "Standard 8 requires that prior to terminating ongoing child protection services, the worker assess current safety and risk, review achievement of service-plan goals with the family, arrange warm handoffs to community-based support services where needed, notify the family in writing of case closure, and obtain supervisory approval.",
    practiceNoteDistinction: "STANDARD text mandates final safety/risk assessment, family review, written closure notice, and supervisory approval. PRACTICE NOTES provide guidance on transition planning meetings.",
    caseStages: ["CASE_CLOSURE"],
    responsibleParty: "CHILD_PROTECTION_WORKER",
    requiredAction: "Assess current safety and risk against exit criteria, review outcomes with the family, connect to community supports, provide written closure notice, and obtain supervisory approval.",
    triggeringCircumstances: "Decision to end ongoing child protection services or close a protection file.",
    deadlineDescription: "Prior to or upon case closure",
    deadlineDays: null,
    applicabilityConditions: ["Ongoing child protection case being considered for closure"],
    exceptions: ["Closure due to child turning 18 (where s. 124 Continued Care and Support transition rules apply instead)"],
    requiredComplianceEvidence: [
      "Case closure summary documenting reduced risk/resolved protection concerns",
      "Written closure notice to family and supervisory sign-off"
    ],
    legalConsequencesOfNonCompliance: "If a family has met the Plan of Care exit criteria (CYFSA s. 100(b)) and safety/risk threats are resolved, continuing intrusive intervention without documented justification departs from Standard 8 and CYFSA s. 1(2).",
    antiOverclaimGuardrail: "Completing service activities alone does not mandate automatic closure if objective, documented safety threats remain unresolved on reassessment.",
    sourceUrl: "https://www.ontario.ca/page/ontario-child-protection-standards-2016"
  }
];
var A3_SUPERVISORY_ACCOUNTABILITY_RULES = [
  {
    ruleId: "CAS_SUPERVISION:MANDATORY_CONSULTATION_AND_APPROVALS",
    librarySubcategory: "A3_SUPERVISORY_ACCOUNTABILITY",
    authorityId: "OCPS:ALL_PHASES",
    legalSource: "Ontario Child Protection Standards (2016), Standards for All Phases & Standards 1\u20138",
    exactSectionOrStandard: "OCPS (2016), All Phases (Supervisory Consultation) & Standards 1, 2, 3, 4, 5, 6, 7, 8",
    title: "Mandatory Supervisory Consultation, Decision Approvals, Departures from Standards & Regular Supervision",
    effectiveFrom: "2016-02-01",
    effectiveTo: null,
    historicalBasisNote: "Issued February 1, 2016 under the former CFSA; continued under CYFSA s. 35(2) and O. Reg. 156/18.",
    legalForce: "MINISTRY_STANDARD_MANDATORY",
    ocpsTextType: "STANDARD",
    standardSummary: "Supervisors must review and approve: (1) referral screening and response-time dispositions (Standard 1), (2) investigation plans and any departure from required response times or interview sequences (Standard 2), (3) all Safety Assessments and Safety Plans within 24 hours / immediately when a safety threat is identified (Standard 3), (4) Risk Assessments (Standard 4), (5) verification decisions, 45-day extensions, and investigation conclusions (Standard 5), (6) case transfers (Standard 6), (7) initial 30-day Ongoing Service Plans, 6-month formal case reviews, placement/reunification decisions, and scheduled clinical supervision at least every 6 weeks in ongoing service (Standard 7), and (8) case closures (Standard 8). Every supervisory consultation and approval must be documented in the case record.",
    practiceNoteDistinction: "Mandatory supervisory approval points and documentation of departures from standards are STANDARD requirements, whereas clinical coaching techniques during supervision are Practice Notes.",
    caseStages: ["ALL_STAGES"],
    responsibleParty: "CHILD_PROTECTION_SUPERVISOR",
    requiredAction: "Conduct and document supervisory consultation and formal approval at every mandatory decision point, review and pre-approve any departure from a mandatory standard with documented reasons, and conduct regular ongoing case supervision.",
    triggeringCircumstances: "Screening disposition, Safety Plan/apprehension, departure from standard timeframe, verification decision, case transfer, initial 30-day Service Plan, 6-month review, placement change, or case closure.",
    deadlineDescription: "Immediate / within 24 hours for extreme safety referrals and Safety Plans; within 45 days for investigation conclusion; within 30 days of transfer for initial Service Plan; at least every 6 weeks for ongoing case supervision",
    deadlineDays: 1,
    applicabilityConditions: ["Any mandatory decision point or departure from a standard in a CAS file"],
    exceptions: ["None \u2014 departures from standards themselves require documented supervisory approval and rationale"],
    requiredComplianceEvidence: [
      "Supervisory sign-off / electronic approval timestamp on Safety Assessment, Risk Assessment, Investigation Conclusion, Transfer Summary, and Service Plan",
      "Supervisory case notes recording consultation rationale, placement consultation, and any approved departure from standards"
    ],
    legalConsequencesOfNonCompliance: "Unilateral worker decisions on safety plans, apprehensions, access restrictions, or verification findings without documented supervisory consultation/approval indicate a breakdown in required agency governance under OCPS (2016).",
    antiOverclaimGuardrail: "If only an affidavit or summary brief was uploaded, note that supervisory approval records are not documented in the uploaded excerpt and recommend requesting the complete supervisory sign-off log in disclosure.",
    sourceUrl: "https://www.ontario.ca/page/ontario-child-protection-standards-2016"
  }
];
function evaluateCaseNoteCompleteness(input) {
  const present = [];
  const missing = [];
  const checks = [
    [input.hasContactDateAndTime, "CONTACT_DATE_AND_TIME"],
    [input.hasMethodOfContact, "METHOD_OF_CONTACT"],
    [input.hasParticipantsIdentified, "PARTICIPANTS"],
    [input.hasSignificantDiscussionsRecorded, "SIGNIFICANT_DISCUSSIONS"],
    [input.hasDirectObservationsSeparatedFromOpinion, "OBSERVATIONS"],
    [input.hasWorkerIdentityAndRole, "WORKER_IDENTITY"],
    [input.hasDateOfNoteCreation, "DATE_OF_NOTE_CREATION"],
    [input.hasSupervisoryDiscussionsRecorded, "SUPERVISORY_DISCUSSIONS"],
    [input.hasLateEntryOrAmendmentAttribution, "SUBSEQUENT_CORRECTIONS_OR_ADDITIONS"]
  ];
  for (const [flag, code] of checks) {
    if (flag) {
      present.push(code);
    } else {
      missing.push(code);
    }
  }
  return {
    presentElements: present,
    missingElements: missing,
    distinctionNote: "CRITICAL DISTINCTION: Missing documentation in uploaded records establishes that the element is NOT DOCUMENTED in the available record \u2014 it is NOT proof that the underlying event or standard did not occur."
  };
}
var A4_CASE_NOTES_AND_RECORDKEEPING_RULES = [
  {
    ruleId: "CAS_RECORDS:CONTEMPORANEOUS_CASE_NOTES_STANDARD_G",
    librarySubcategory: "A4_CASE_NOTES",
    authorityId: "OCPS:ALL_PHASES",
    legalSource: "Ontario Child Protection Standards (2016), All Phases (Contemporaneous Case Notes) & CYFSA s. 306(1)",
    exactSectionOrStandard: "OCPS (2016), Standards for All Phases \u2014 Contemporaneous Case Notes & CYFSA, s. 306(1)",
    title: "Contemporaneous Case-Note Expectations, Fact-vs-Opinion Separation & Non-Obliterating Corrections",
    effectiveFrom: "2016-02-01",
    effectiveTo: null,
    historicalBasisNote: "OCPS (2016) Contemporaneous Case Notes standard effective February 1, 2016; reinforced by CYFSA Part X s. 306(1) accuracy duty effective January 1, 2020.",
    legalForce: "MINISTRY_STANDARD_MANDATORY",
    ocpsTextType: "STANDARD",
    standardSummary: "Workers must record case notes contemporaneously (as soon as possible after the event, generally within 24 hours for urgent/investigative events or prescribed agency timelines), recording contact date/time, method of contact, participants, significant discussions, concrete observations separated from professional opinion or third-party hearsay, worker identity, date of note creation, supervisory discussions, and dated non-obliterating addenda for any subsequent corrections.",
    practiceNoteDistinction: "Contemporaneous, accurate, factual recording is a mandatory operational and statutory (CYFSA s. 306(1)) expectation.",
    caseStages: ["ALL_STAGES", "RECORDS_AND_PRIVACY"],
    responsibleParty: "CHILD_PROTECTION_WORKER",
    requiredAction: "Record objective, contemporaneous case notes containing all 9 core documentation elements, distinguish direct observations from third-party hearsay and worker opinion, and never alter original entries without a dated addendum.",
    triggeringCircumstances: "Every client contact, home visit, collateral interview, observation, or supervisory consultation.",
    deadlineDescription: "Contemporaneously (as soon as possible after the contact; within 24 hours for urgent/safety events)",
    deadlineDays: 1,
    applicabilityConditions: ["All child protection case documentation"],
    exceptions: ["Documented emergency preventing immediate entry, where the late entry explicitly records both the event date/time and the later recording date/time"],
    requiredComplianceEvidence: [
      "Case notes showing both the event date/time and the system entry/creation timestamp",
      "Clear attribution of participants, method of contact, direct observations vs hearsay, and worker identity"
    ],
    legalConsequencesOfNonCompliance: "Substantial delay between an event and note creation reduces evidentiary reliability and weight; conflating third-party hearsay or opinion with firsthand observation violates Family Law Rules r. 14(18)\u2013(19) when repeated in an affidavit.",
    antiOverclaimGuardrail: "CRITICAL DISTINCTION: Missing documentation in uploaded records establishes that the event is NOT DOCUMENTED in the available record \u2014 it is NOT automatic proof that the underlying event did not occur, though the absence of contemporaneous records when an event should normally have been recorded is a legitimate evidentiary gap to raise.",
    sourceUrl: "https://www.ontario.ca/page/ontario-child-protection-standards-2016"
  }
];
var A5_PROFESSIONAL_ETHICS_AND_REGISTRATION_RULES = [
  {
    ruleId: "OCSWSSW_ETHICS:REGISTRATION_AND_STANDARDS_OF_PRACTICE",
    librarySubcategory: "A5_OCSWSSW_ETHICS",
    authorityId: "OCSWSSW:REGISTRATION",
    legalSource: "Social Work and Social Service Work Act, 1998, S.O. 1998, c. 31 & OCSWSSW Code of Ethics and Standards of Practice",
    exactSectionOrStandard: "SWSSWA, 1998, ss. 25\u201326, 46\u201347 & OCSWSSW Standards of Practice, Principles I\u2013V",
    title: "OCSWSSW Registration Requirement (RSW / RSSW), Competence, Record-Keeping & Confidentiality Standards",
    effectiveFrom: "2000-08-15",
    effectiveTo: null,
    historicalBasisNote: "Social Work and Social Service Work Act, 1998, S.O. 1998, c. 31 and OCSWSSW Standards of Practice (Second Edition).",
    legalForce: "PROFESSIONAL_REGULATORY_CODE",
    ocpsTextType: "NOT_APPLICABLE",
    standardSummary: "Under the Social Work and Social Service Work Act, 1998, only registered members of the Ontario College of Social Workers and Social Service Workers (OCSWSSW) may use the restricted titles 'Social Worker' / 'Registered Social Worker' (RSW) or 'Social Service Worker' / 'Registered Social Service Worker' (RSSW) (ss. 46\u201347). Where a CAS worker or supervisor is a registered member (RSW, RSSW, or both), they are bound by the OCSWSSW Code of Ethics and Standards of Practice, including Principle II (Competence and Integrity \u2014 rendering opinions only on adequate firsthand/verified knowledge), Principle IV (The Social Work and Social Service Work Record \u2014 accurate, objective, contemporaneous records and non-obliterating corrections), and Principle V (Confidentiality).",
    practiceNoteDistinction: "Enforceable professional regulatory standards for registered College members (RSW / RSSW).",
    caseStages: ["ALL_STAGES", "OVERSIGHT_AND_COMPLAINTS"],
    responsibleParty: "REGISTERED_SOCIAL_WORKER_OR_SSW",
    requiredAction: "If registered with the OCSWSSW (or holding oneself out as a social worker / social service worker), comply with OCSWSSW Standards of Practice regarding competence, objective assessment, contemporaneous recordkeeping (Principle IV), and confidentiality (Principle V).",
    triggeringCircumstances: "Professional conduct, assessment, or recordkeeping by a CAS employee who is a registered member of the OCSWSSW (RSW or RSSW) or who uses a restricted title under SWSSWA ss. 46\u201347.",
    deadlineDescription: "Ongoing professional obligation for registered members",
    deadlineDays: null,
    applicabilityConditions: [
      "The individual must be a registered member of the OCSWSSW (RSW or RSSW) for College discipline jurisdiction (SWSSWA ss. 25\u201326), OR must be an unregistered individual unlawfully using the restricted title 'social worker' or 'social service worker' (SWSSWA ss. 46\u201347)"
    ],
    exceptions: [
      "Not every CAS child protection worker is a registered social worker (RSW) or registered social service worker (RSSW); Ontario child protection workers may hold other qualifying degrees or credentials authorized by agency/ministry standards"
    ],
    requiredComplianceEvidence: [
      "Verification of the worker's or supervisor's registration status on the public OCSWSSW Online Register",
      "Comparison of documented conduct/records against OCSWSSW Principle II (Competence), Principle IV (Records), and Principle V (Confidentiality)"
    ],
    legalConsequencesOfNonCompliance: "A registered member (RSW/RSSW) may be the subject of a written professional conduct complaint to the OCSWSSW Complaints Committee (which can refer to the Discipline Committee, issue cautions/reprimands, impose terms/conditions, or suspend/revoke registration). An unregistered person using the title 'Social Worker' may be reported to the OCSWSSW for unauthorized title use under ss. 46\u201347.",
    antiOverclaimGuardrail: "NEVER assume every CAS employee is a registered social worker (RSW/RSSW). Always instruct the user to check the OCSWSSW Public Register first, and note that an OCSWSSW complaint addresses professional regulation of the member \u2014 it cannot overturn a Family Court order.",
    sourceUrl: "https://www.ocswssw.org/professional-practice/code-of-ethics-and-standards-of-practice/"
  }
];
var A6_OATHS_AND_SWORN_EVIDENCE_RULES = [
  {
    ruleId: "SWORN_EVIDENCE:AFFIDAVIT_COMMISSIONING_AND_FLR_14_18",
    librarySubcategory: "A6_SWORN_EVIDENCE",
    authorityId: "FLR:14(18)",
    legalSource: "Family Law Rules, O. Reg. 114/99, r. 14(18)\u2013(19), Evidence Act, R.S.O. 1990, c. E.23, ss. 43\u201345 & CYFSA, s. 81(2)",
    exactSectionOrStandard: "Family Law Rules, r. 14(18)\u2013(19) & Evidence Act, R.S.O. 1990, c. E.23, ss. 43\u201345",
    title: "Sworn/Affirmed Court Evidence, Affidavit Commissioning & Personal Knowledge vs Information-and-Belief Rules",
    effectiveFrom: "1999-09-15",
    effectiveTo: null,
    historicalBasisNote: "Governed by the Ontario Evidence Act, Commissioners for Taking Affidavits Act, and Family Law Rules r. 14(18)\u2013(19). Note: Ontario law does NOT impose a universal statutory 'CAS worker oath of office'; sworn legal obligations arise when a worker swears or affirms an Information to Obtain a warrant (CYFSA s. 81(2), s. 131) or an affidavit/oral testimony in court.",
    legalForce: "COURT_PROCEDURAL_RULE",
    ocpsTextType: "NOT_APPLICABLE",
    standardSummary: "There is no universal statutory 'CAS worker oath of office' in the CYFSA (agency employees sign employment confidentiality undertakings under Part X / agency policies). However, when a child protection worker gives evidence in court or swears/affirms an affidavit or Information to Obtain a warrant (CYFSA s. 81(2)), the worker is under a solemn legal oath or affirmation under the Evidence Act (ss. 43\u201345) and Commissioners for Taking Affidavits Act. Under Family Law Rules r. 14(18)\u2013(19), a motion affidavit must contain personal knowledge as much as possible, and may include secondhand information ONLY if the source is identified by name and the affiant states a belief that the information is true.",
    practiceNoteDistinction: "Binding evidentiary and court procedural requirements governing sworn/affirmed court filings.",
    caseStages: ["APPREHENSION_REMOVAL", "INITIAL_COURT_HEARING", "TEMPORARY_CARE_ADJOURNMENT", "DISPOSITION_PLANNING", "STATUS_REVIEW"],
    responsibleParty: "AFFIANT_OR_WITNESS",
    requiredAction: "Properly swear or affirm any court affidavit or warrant information before an authorized commissioner, restrict affidavit statements to personal knowledge or properly attributed information-and-belief (naming the source and stating belief in truth per FLR r. 14(19)), and present complete, non-misleading facts.",
    triggeringCircumstances: "Filing an affidavit in a Family Court child protection proceeding or swearing an Information to Obtain a warrant under CYFSA s. 81(2) or s. 131.",
    deadlineDescription: "At the time of swearing/affirming and filing the affidavit or information",
    deadlineDays: null,
    applicabilityConditions: ["Sworn or affirmed affidavit, warrant information, or oral court testimony"],
    exceptions: ["Uncommissioned draft documents or internal case notes are not sworn affidavits, though they remain subject to OCPS Standard G and CYFSA s. 306(1) accuracy duties"],
    requiredComplianceEvidence: [
      "Completed jurat showing date, location, affiant signature, and Commissioner for Taking Affidavits signature/stamp",
      "Compliance with FLR r. 14(18)\u2013(19) source-naming and belief statements for any secondhand facts",
      "Consistency between the sworn affidavit and underlying contemporaneous case notes / collateral records"
    ],
    legalConsequencesOfNonCompliance: "Defective commissioning, unattributed hearsay, or material omissions/inaccuracies in an affidavit allow counsel to move to strike inadmissible paragraphs, challenge evidentiary weight under CYFSA s. 94(10) and FLR r. 14(18)\u2013(19), cross-examine the affiant on prior inconsistent records, or seek costs.",
    antiOverclaimGuardrail: "NEVER invent a universal statutory CAS worker oath of office, and NEVER automatically classify an inaccurate or contradicted statement in an affidavit as criminal 'perjury' (which requires proof beyond a reasonable doubt in a criminal court of an intentional false statement under oath made with intent to mislead). Frame discrepancies accurately as material inconsistencies, reliability defects, or non-compliance with FLR r. 14(18)\u2013(19).",
    sourceUrl: "https://www.ontario.ca/laws/regulation/990114#BK20"
  }
];
var A7_ACCOUNTABILITY_AND_COMPLAINT_PATHWAYS = [
  {
    pathwayId: "OVERSIGHT:CAS_INTERNAL_COMPLAINT_119",
    name: "Internal CAS Complaint Review Procedure (ICRP)",
    authorityId: "CYFSA:119(1)",
    governingStatuteOrRegulation: "CYFSA, s. 119(1)\u2013(11) & O. Reg. 155/18",
    jurisdictionSummary: "Internal review by the children's aid society (including an Internal Complaint Review Panel) of complaints relating to a service sought or received from the society.",
    standingWhoMayApply: "Any person who has sought or received a service from the society (including a parent, child, or caregiver).",
    proceduralRequirements: [
      "Submit a written complaint to the society under CYFSA s. 119(1)",
      "Society must assess eligibility and provide written notice within 7 days (O. Reg. 155/18)",
      "If eligible for the Internal Complaint Review Panel (ICRP), the panel must convene a meeting within 14 days of eligibility notice and issue a written summary of results within 14 days after the meeting"
    ],
    deadlines: "7 days for society eligibility response; 14 days to hold ICRP meeting; 14 days after meeting for written decision (O. Reg. 155/18).",
    mandatoryExclusions: [
      "CYFSA s. 119(11)(a): The society SHALL NOT conduct a review if the subject of the complaint is an issue that has been decided by the court or is currently before the court",
      "CYFSA s. 119(11)(b): Excluded if subject to another decision-making process under the CYFSA or the Labour Relations Act, 1995"
    ],
    availableRemedies: [
      "Written explanation/reasons, service adjustments, corrective administrative steps, or facilitated resolution between the complainant and the service team"
    ],
    canOverturnCourtOrder: false,
    officialUrl: "https://www.ontario.ca/laws/statute/17c14#BK145"
  },
  {
    pathwayId: "OVERSIGHT:CFSRB_SERVICE_COMPLAINT_120",
    name: "Child and Family Services Review Board (CFSRB) \u2014 Service & Procedural Complaints",
    authorityId: "CYFSA:120(4)",
    governingStatuteOrRegulation: "CYFSA, ss. 119(5), 120(1)\u2013(8), 333 & O. Reg. 155/18",
    jurisdictionSummary: "Independent administrative tribunal review of enumerated procedural and right-to-be-heard complaints under CYFSA s. 120(4): (1) society refusal to proceed with a s. 119 complaint, (2) society failure to respond within regulatory timeframes, (3) society failure to comply with complaint review procedures, (4) society failure to comply with s. 15(2) (opportunity for child and parent to be heard and represented when decisions affecting their interests are made), and (5) society failure to provide reasons for a decision affecting the complainant's interests. (The CFSRB also hears residential placement reviews under s. 66, emergency secure treatment reviews, and adoption refusal/removal reviews under s. 192.)",
    standingWhoMayApply: "A person who sought or received a service from a society (or a child in care under s. 66 / applicant under s. 192).",
    proceduralRequirements: [
      "May file directly with the CFSRB under s. 120(1)(a) without first completing the internal CAS complaint process, or escalate under s. 120(1)(b) / s. 119(5)",
      "Complete the prescribed CFSRB Application about Complaints to a Children's Aid Society"
    ],
    deadlines: "CFSRB conducts preliminary eligibility review within 7 days and, if eligible, completes review/hearing within prescribed O. Reg. 155/18 timelines (typically 20\u201360 days).",
    mandatoryExclusions: [
      "CYFSA s. 120(8)(a): The CFSRB SHALL NOT conduct a review if the subject of the complaint is an issue that has been decided by the court or is before the court",
      "Cannot review the merits of a court protection finding or court custody/access order"
    ],
    availableRemedies: [
      "CYFSA s. 120(7): Order the society to proceed with a complaint (cl. (a)), order a response within a specified period (cl. (b)), order the society to comply with complaint procedures or s. 15(2) (cl. (c)), or order the society to provide written reasons for a decision (cl. (d))"
    ],
    canOverturnCourtOrder: false,
    officialUrl: "https://tribunalsontario.ca/cfsrb/"
  },
  {
    pathwayId: "OVERSIGHT:ONTARIO_OMBUDSMAN_CHILDREN_AND_YOUTH",
    name: "Ontario Ombudsman \u2014 Children and Youth Unit",
    authorityId: "OVERSIGHT:OMBUDSMAN",
    governingStatuteOrRegulation: "Ombudsman Act, R.S.O. 1990, c. O.6, ss. 14(1.1), 14.0.1 & CYFSA, ss. 9.1, 15.1",
    jurisdictionSummary: "Independent legislative officer empowered (since May 1, 2019) to investigate administrative conduct, procedural unfairness, delays, and systemic practices of children's aid societies and residential licensees.",
    standingWhoMayApply: "Any child, young person, parent, family member, or concerned person affected by CAS or residential licensee administration.",
    proceduralRequirements: [
      "Submit an online, telephone, or written complaint to the Ontario Ombudsman (Children and Youth Unit)",
      "For adults, the Ombudsman normally considers whether internal complaint mechanisms (such as s. 119) have been attempted unless urgent or systemic; children and youth in care have a direct statutory right to contact and be informed about the Ombudsman under CYFSA ss. 9.1, 10(1)(b)(iii), and 15.1"
    ],
    deadlines: "No strict statutory filing limitation, though complaints should be brought promptly while records and witnesses are available.",
    mandatoryExclusions: [
      "Cannot investigate judges or court decisions, cannot act as legal counsel for a party, and cannot overturn or vary a court order"
    ],
    availableRemedies: [
      "Informal administrative resolution, formal investigation, findings of maladministration, and recommendations for agency policy/practice changes or corrective administrative action"
    ],
    canOverturnCourtOrder: false,
    officialUrl: "https://www.ombudsman.on.ca/what-we-do/topics/children-and-youth"
  },
  {
    pathwayId: "OVERSIGHT:OCSWSSW_PROFESSIONAL_REGULATORY_COMPLAINT",
    name: "Ontario College of Social Workers and Social Service Workers (OCSWSSW) Complaint",
    authorityId: "OCSWSSW:REGISTRATION",
    governingStatuteOrRegulation: "Social Work and Social Service Work Act, 1998, S.O. 1998, c. 31, ss. 25\u201326, 46\u201347",
    jurisdictionSummary: "Professional regulatory oversight of registered social workers (RSW) and registered social service workers (RSSW) for professional misconduct, incompetence, or incapacity, as well as enforcement against unregistered individuals using restricted titles.",
    standingWhoMayApply: "Any member of the public, client, parent, or colleague.",
    proceduralRequirements: [
      "First confirm on the public OCSWSSW Online Register whether the worker or supervisor is a registered member (RSW or RSSW)",
      "Submit a signed written complaint to the OCSWSSW Registrar describing the specific professional conduct or recordkeeping concerns"
    ],
    deadlines: "No fixed statutory limitation period under the SWSSWA, 1998, but timely submission is recommended.",
    mandatoryExclusions: [
      "No disciplinary jurisdiction over CAS employees who are NOT registered members of the OCSWSSW (unless they unlawfully used a restricted title under ss. 46\u201347)",
      "Cannot adjudicate child custody/access, remove a worker from a court file, or overturn a court order"
    ],
    availableRemedies: [
      "Investigation by the Complaints Committee; remedial advice/caution, specified continuing education/remediation, or referral to the Discipline Committee (which can reprimand, impose practice conditions, or suspend/revoke registration)"
    ],
    canOverturnCourtOrder: false,
    officialUrl: "https://www.ocswssw.org/public/complaints-and-discipline/"
  },
  {
    pathwayId: "OVERSIGHT:IPC_PART_X_PRIVACY_AND_RECORDS_316",
    name: "Information and Privacy Commissioner of Ontario (IPC) \u2014 Part X Access, Correction & Privacy Complaints",
    authorityId: "CYFSA:316(1)",
    governingStatuteOrRegulation: "CYFSA, Part X, ss. 306, 312\u2013321",
    jurisdictionSummary: "Oversight of personal information collection, use, disclosure, security, accuracy (s. 306), individual access requests (s. 312\u2013314), and record correction requests / Statements of Disagreement (s. 315) by service providers under Part X of the CYFSA.",
    standingWhoMayApply: "Any individual whose personal information is held by a service provider or who has reasonable grounds to believe Part X has been contravened.",
    proceduralRequirements: [
      "For access or correction complaints, first submit a written access request (s. 313) or correction request (s. 315(2)) to the society and wait for the 30-day response window (or deemed refusal)",
      "File a written complaint with the IPC under s. 316"
    ],
    deadlines: "Within 6 months after a refusal or deemed refusal of an access or correction request (CYFSA s. 316(3)); within 1 year after a privacy contravention came or should reasonably have come to the complainant's attention (s. 316(2)).",
    mandatoryExclusions: [
      "Applies to Part X obligations (in force January 1, 2020)",
      "Under s. 315(10)(b), the IPC cannot compel alteration of a good-faith professional opinion or observation (though attachment of a Statement of Disagreement under s. 315(12) is mandatory)",
      "Cannot overturn a Family Court child protection order"
    ],
    availableRemedies: [
      "CYFSA s. 321(1): Binding orders directing the society to grant access to records (cl. (a)), make a factual correction (cl. (b)), attach a Statement of Disagreement (cl. (c)), or cease unauthorized collection/use/disclosure (cl. (d))"
    ],
    canOverturnCourtOrder: false,
    officialUrl: "https://www.ipc.on.ca/en/child-and-family-services"
  },
  {
    pathwayId: "OVERSIGHT:COURT_PROCEDURAL_AND_EVIDENTIARY_REMEDIES",
    name: "Family Court Procedural, Evidentiary & Dispositive Remedies",
    authorityId: "FLR:1(8)",
    governingStatuteOrRegulation: "CYFSA, ss. 88, 94, 100, 101, 113\u2013116, 121; Family Law Rules, rr. 1(8), 14(18)\u2013(19), 19, 20; Charter, s. 24(1)",
    jurisdictionSummary: "The Ontario Court of Justice or Family Court of the Superior Court of Justice has exclusive adjudicative jurisdiction over child protection findings, temporary care and custody orders, supervision terms, access orders, status reviews, and court disclosure/evidentiary motions.",
    standingWhoMayApply: "Any statutory party under CYFSA s. 79(1) (parent, society, child with party/participation status, FNIM band/community representative).",
    proceduralRequirements: [
      "Bring a motion or response within the child protection proceeding under the Family Law Rules (or an appeal under CYFSA s. 121)"
    ],
    deadlines: "Governed by CYFSA statutory timelines (e.g., 5-day hearing under s. 88; 30-day adjournment limit under s. 94(1); 10-day stay on appeal under s. 121(3)) and Family Law Rules r. 33.",
    mandatoryExclusions: [
      "Under CYFSA ss. 94(6)(c), 101(7)(c), and 116(4)(c), the court cannot impose supervision terms requiring the society to provide financial assistance or purchase goods or services"
    ],
    availableRemedies: [
      "Orders for disclosure/production of complete CAS records and third-party records (FLR r. 19 / CYFSA s. 130)",
      "Striking inadmissible hearsay paragraphs under FLR r. 14(18)\u2013(19) or questioning under FLR r. 20",
      "Returning the child or ordering less disruptive supervision/kinship terms under CYFSA s. 94(2)/(4) or s. 101(1)\u2013(4)",
      "Requiring an amended Plan of Care complying with CYFSA s. 100",
      "Varying access under CYFSA ss. 104\u2013105 or varying disposition on status review under ss. 113\u2013116",
      "Remedies for non-compliance with court orders under FLR r. 1(8) or Charter remedies under s. 24(1)"
    ],
    canOverturnCourtOrder: false,
    // A court varies/appeals orders through statutory procedure (s. 94(9), s. 114, s. 121), whereas non-court bodies never can.
    officialUrl: "https://www.ontario.ca/laws/regulation/990114"
  }
];
var ALL_CAS_ACCOUNTABILITY_RULES = [
  ...A1_STATUTORY_CAS_DUTIES,
  ...A2_OCPS_2016_STANDARDS,
  ...A3_SUPERVISORY_ACCOUNTABILITY_RULES,
  ...A4_CASE_NOTES_AND_RECORDKEEPING_RULES,
  ...A5_PROFESSIONAL_ETHICS_AND_REGISTRATION_RULES,
  ...A6_OATHS_AND_SWORN_EVIDENCE_RULES
];

// shared/parentAssistanceLibrary.ts
var B1_FAMILY_PRESERVATION_RULES = [
  {
    ruleId: "B1-CYFSA-1-2-PRESERVATION-PRINCIPLE",
    domain: "B1_FAMILY_PRESERVATION",
    authorityId: "CYFSA:1(2)",
    secondaryAuthorityIds: ["CYFSA:35(1)", "CYFSA:74(3)"],
    legalSource: "Child, Youth and Family Services Act, 2017, S.O. 2017, c. 14, Sched. 1",
    exactSectionOrStandard: "s. 1(2) paras. 1\u20133",
    effectiveDate: "2018-04-30",
    legalForce: "LEGALLY_REQUIRED",
    title: "Support for Family Autonomy, Least Disruptive Course of Action & Prevention Services",
    requiredOrExpectedAction: "Recognize and support the autonomy and integrity of the family unit, pursue the least disruptive course of action available and appropriate in the case to help a child, and provide early assessment, planning, and prevention services consistent with the paramount purpose of the child's best interests, protection, and well-being.",
    triggeringCircumstances: "All child protection assessments, planning, interventions, and court recommendations under the CYFSA.",
    applicabilityConditions: "Applies consistently with the paramount purpose in CYFSA s. 1(1) (promote the best interests, protection, and well-being of children).",
    exceptionsAndStatutoryLimits: "Subordinate to the paramount purpose of protecting the child's safety and well-being (s. 1(1)). Does not create an unconditional private entitlement to any specific parent-requested service or society expenditure.",
    accessibilityFactorsToEvaluate: [
      "Whether less disruptive community or extended-family supports were explored before removal or escalated intervention",
      "Whether prevention and early intervention services were matched to the specific protection concerns identified"
    ],
    evidenceEstablishingCompliance: [
      "Assessment or court affidavit detailing less disruptive interventions considered and why they were or were not sufficient",
      "Documentation of early support or prevention referrals offered to the family"
    ],
    overstatementGuard: "Never state that CYFSA s. 1(2) guarantees an unconditional right to every requested service or prohibits apprehension when immediate child safety cannot be managed in the home."
  },
  {
    ruleId: "B1-CYFSA-94-4-INTERIM-CARE-LEAST-DISRUPTIVE",
    domain: "B1_FAMILY_PRESERVATION",
    authorityId: "CYFSA:94(2)",
    secondaryAuthorityIds: ["CYFSA:94(4)"],
    legalSource: "Child, Youth and Family Services Act, 2017, S.O. 2017, c. 14, Sched. 1",
    exactSectionOrStandard: "s. 94(2), s. 94(4), s. 94(5)",
    effectiveDate: "2018-04-30",
    legalForce: "LEGALLY_REQUIRED",
    title: "Interim Care and Custody Test & Supervision Consideration",
    requiredOrExpectedAction: "At the temporary care and custody stage, the court shall not order a child removed from or kept out of the care of the person who had charge before intervention unless satisfied there are reasonable grounds to believe there is a risk the child is likely to suffer harm AND the child cannot be protected adequately by returning the child under parental or relative/community care with or without supervision conditions.",
    triggeringCircumstances: "Temporary care and custody hearing or motion under CYFSA s. 94 following apprehension or protection application.",
    applicabilityConditions: "Applies whenever CAS seeks an interim/temporary order placing the child outside the pre-intervention caregiver's care.",
    exceptionsAndStatutoryLimits: "Where reasonable grounds establish likely harm that cannot be mitigated by supervision conditions (s. 94(5)) or kinship placement (s. 94(2)(c)), temporary society care is legally authorized.",
    accessibilityFactorsToEvaluate: [
      "Whether concrete supervision terms under s. 94(5) were considered and explained",
      "Whether proposed family/community caregivers under s. 94(2)(c) were assessed"
    ],
    evidenceEstablishingCompliance: [
      "Affidavit evidence addressing both limbs of s. 94(4): (a) risk of likely harm and (b) why supervision or kin placement cannot adequately protect the child"
    ],
    overstatementGuard: "Do not treat an interim placement order as proof of final protection findings; s. 94(4) is an interim risk-and-adequacy test."
  },
  {
    ruleId: "B1-CYFSA-101-2-3-DISPOSITIONAL-LESS-DISRUPTIVE-INQUIRY",
    domain: "B1_FAMILY_PRESERVATION",
    authorityId: "CYFSA:101(2)",
    secondaryAuthorityIds: ["CYFSA:101(3)", "CYFSA:100"],
    legalSource: "Child, Youth and Family Services Act, 2017, S.O. 2017, c. 14, Sched. 1",
    exactSectionOrStandard: "s. 101(2), s. 101(3), s. 100",
    effectiveDate: "2018-04-30",
    legalForce: "LEGALLY_REQUIRED",
    title: "Mandatory Inquiry into Efforts to Assist & Less Disruptive Alternatives Before Removal Order",
    requiredOrExpectedAction: "Before making a dispositional order under s. 101(1), the court must ask what efforts the society or another person or entity has made to assist the child before intervention, and shall not make an order removing the child from the pre-intervention caregiver unless satisfied that less disruptive alternatives (including non-residential services and assistance to help the caregiver care for the child) would be inadequate to protect the child.",
    triggeringCircumstances: "Dispositional hearing following a finding that a child is in need of protection under CYFSA s. 74(2).",
    applicabilityConditions: "Applies to all dispositional orders under CYFSA s. 101, and specifically before any order removing a child from the pre-intervention caregiver (s. 101(3)).",
    exceptionsAndStatutoryLimits: "Requires the society's Plan of Care (s. 100(a)) to contain a description of the services to be provided to remedy the condition and the explanation of why the child cannot be adequately protected while in the parent's care (s. 100(c)(i)).",
    accessibilityFactorsToEvaluate: [
      "What pre-intervention and post-intervention assistance CAS or community agencies offered",
      "Why non-residential services or a supervision order under s. 101(1) para. 1 would or would not adequately protect the child"
    ],
    evidenceEstablishingCompliance: [
      "Society Plan of Care (s. 100) and supporting affidavit setting out pre-intervention assistance efforts (s. 101(2)) and why less disruptive alternatives are inadequate (s. 101(3))"
    ],
    overstatementGuard: "Distinguish between the court's mandatory inquiry under s. 101(2)\u2013(3) and whether a specific service was available in the community."
  },
  {
    ruleId: "B1-BILL-C92-14-PREVENTIVE-CARE-PRIORITY",
    domain: "B1_FAMILY_PRESERVATION",
    authorityId: "BILL_C92:14(1)",
    secondaryAuthorityIds: ["BILL_C92:10(1)", "BILL_C92:15", "BILL_C92:16(1)"],
    legalSource: "An Act respecting First Nations, Inuit and M\xE9tis children, youth and families, S.C. 2019, c. 24",
    exactSectionOrStandard: "s. 14(1), s. 15, s. 16(1)",
    effectiveDate: "2020-01-01",
    legalForce: "LEGALLY_REQUIRED",
    title: "Federal Priority for Preventive Care and Protection from Socio-Economic Apprehension for Indigenous Children",
    requiredOrExpectedAction: "In providing child and family services in relation to an Indigenous child, the provision of preventive care to support the child's family must be given priority over other services (s. 14(1)); a child must not be apprehended solely on the basis of socio-economic conditions, including poverty, lack of adequate housing or infrastructure, or parent health (s. 15); and out-of-home placement must prioritize parents, extended family, and the child's Indigenous community (s. 16(1)).",
    triggeringCircumstances: "Any child protection service delivery involving a First Nations, Inuit, or M\xE9tis child.",
    applicabilityConditions: "Applies as paramount federal law whenever the child is an Indigenous child within the meaning of S.C. 2019, c. 24.",
    exceptionsAndStatutoryLimits: "Consistent with the best interests of the Indigenous child under Bill C-92 ss. 9(1) and 10(1).",
    accessibilityFactorsToEvaluate: [
      "Whether culturally appropriate preventive services through an Indigenous service provider or band/community were offered first",
      "Whether notice under Bill C-92 s. 12(1) was provided to the parent, care provider, and Indigenous governing body"
    ],
    evidenceEstablishingCompliance: [
      "Documentation of preventive care priority, cultural continuity planning, and s. 12(1) notice to the Indigenous governing body"
    ],
    overstatementGuard: "Only apply Bill C-92 provisions when the record indicates or raises the question that the child is First Nations, Inuit, or M\xE9tis."
  }
];
var B2_PARENTING_SUPPORT_RULES = [
  {
    ruleId: "B2-CYFSA-35-1-PREVENTIVE-AND-COUNSELLING-FUNCTION",
    domain: "B2_PARENTING_SUPPORT",
    authorityId: "CYFSA:35(1)",
    secondaryAuthorityIds: ["CYFSA:100"],
    legalSource: "Child, Youth and Family Services Act, 2017, S.O. 2017, c. 14, Sched. 1",
    exactSectionOrStandard: "s. 35(1)(b), s. 35(1)(d), s. 100(a)",
    effectiveDate: "2018-04-30",
    legalForce: "LEGALLY_REQUIRED",
    title: "Statutory Function to Provide Guidance, Counselling & Supportive Services",
    requiredOrExpectedAction: "Perform the statutory function of providing guidance, counselling, and other services to families for protecting children or for the prevention of circumstances requiring the protection of children, and specify in any court Plan of Care (s. 100(a)) the services to be provided to remedy the condition causing the child to be in need of protection.",
    triggeringCircumstances: "Verified protection concerns or court proceedings where a Plan of Care is filed under CYFSA s. 100.",
    applicabilityConditions: "Applies across child protection service delivery; under s. 35(2), society functions are carried out in accordance with prescribed standards (OCPS 2016).",
    exceptionsAndStatutoryLimits: "Specific parenting programs may be provided directly by CAS or through community referrals depending on local service availability.",
    accessibilityFactorsToEvaluate: [
      "Waitlists and program availability in the parent's community",
      "Cost and whether free or subsidized options were identified",
      "Transportation, distance, and work/childcare scheduling compatibility",
      "Language, literacy, disability, neurodiversity, or cultural accommodations"
    ],
    evidenceEstablishingCompliance: [
      "Service Plan or Plan of Care identifying specific parenting programs or in-home family support",
      "Case notes documenting concrete referral steps, intake coordination, and follow-up on waitlists or barriers"
    ],
    overstatementGuard: "Classify statutory Plan of Care disclosure (s. 100(a)) as LEGALLY_REQUIRED, OCPS Standard 7 referral coordination as STANDARDS_BASED, and specific non-mandated program choices as DISCRETIONARY or RECOMMENDED."
  },
  {
    ruleId: "B2-OCPS-STD-7-PARENTING-REFERRAL-AND-BARRIER-COORDINATION",
    domain: "B2_PARENTING_SUPPORT",
    authorityId: "OCPS:STD_7",
    secondaryAuthorityIds: ["O_REG_156_18:STANDARDS"],
    legalSource: "Ontario Child Protection Standards (2016) & O. Reg. 156/18, s. 1",
    exactSectionOrStandard: "Standard 7 \u2014 Ongoing Service Case Management (Service Plan & Service Provision)",
    effectiveDate: "2016-01-01",
    legalForce: "STANDARDS_BASED",
    title: "Tailored Parenting Support Referrals & Active Barrier Monitoring",
    requiredOrExpectedAction: "Develop a Service Plan with the family that links parenting or family-support interventions directly to the verified protection concerns, make referrals to required services, and actively coordinate with community service providers while monitoring barriers to participation.",
    triggeringCircumstances: "Ongoing child protection service delivery following investigation verification or transfer.",
    applicabilityConditions: "Mandatory operational standard under OCPS (2016) Standard 7, prescribed under O. Reg. 156/18, s. 1.",
    exceptionsAndStatutoryLimits: "Practice Notes regarding preferred coaching modalities or specific curriculum selection are guidance (`PRACTICE_NOTE`), whereas developing and monitoring the Service Plan is a mandatory `STANDARD`.",
    accessibilityFactorsToEvaluate: [
      "Whether the parenting program matched the child's developmental stage and the specific safety/risk concern",
      "Whether CAS assisted with referral intake rather than providing a generic phone list without follow-up",
      "Whether disability, trauma, or language accommodations were addressed"
    ],
    evidenceEstablishingCompliance: [
      "Signed Service Plan linking parenting support activities to specific behavioural protection goals",
      "Case notes recording referral transmission, provider contact, and barrier problem-solving"
    ],
    overstatementGuard: "Do not treat a parent's placement on a community waitlist as non-compliance by either the parent or CAS unless the record shows a failure to refer or monitor."
  }
];
var B3_MENTAL_HEALTH_AND_ADDICTIONS_RULES = [
  {
    ruleId: "B3-CYFSA-NON-FUNDING-STATUTORY-LIMIT",
    domain: "B3_MENTAL_HEALTH_AND_ADDICTIONS",
    authorityId: "CYFSA:94(6)",
    secondaryAuthorityIds: ["CYFSA:101(7)", "CYFSA:116(4)"],
    legalSource: "Child, Youth and Family Services Act, 2017, S.O. 2017, c. 14, Sched. 1",
    exactSectionOrStandard: "s. 94(6)(c), s. 101(7)(c), s. 116(4)(c)",
    effectiveDate: "2018-04-30",
    legalForce: "LEGALLY_REQUIRED",
    title: "Statutory Prohibition on Court Orders Requiring CAS to Fund or Purchase Goods or Services",
    requiredOrExpectedAction: "Recognize the express statutory limitation in CYFSA ss. 94(6)(c), 101(7)(c), and 116(4)(c): when the court imposes terms and conditions on a temporary supervision order, dispositional supervision order, or status review supervision order, the court SHALL NOT require the society to provide financial assistance or to purchase any goods or services.",
    triggeringCircumstances: "Any analysis of whether CAS was legally required to pay for private therapy, private residential addiction treatment, private psychological assessments, drug testing, or other purchased goods/services under a supervision order.",
    applicabilityConditions: "Applies to all court-imposed supervision terms and conditions under ss. 94(5), 101(6), and 116(3).",
    exceptionsAndStatutoryLimits: "While a court cannot order CAS to purchase goods or services under ss. 94(6)(c), 101(7)(c), or 116(4)(c), CAS remains subject to its duty under s. 100(a) to specify in its Plan of Care the services to be provided, its inquiry under s. 101(2)\u2013(3) regarding assistance efforts, and its OCPS Standard 7 duty to make and coordinate referrals to publicly funded or accessible community services. CAS may also exercise discretionary budget authority to fund services voluntarily.",
    accessibilityFactorsToEvaluate: [
      "Whether publicly funded (OHIP-covered or community-funded) mental health, trauma, or addiction services were identified and referred",
      "Whether private unfunded services were demanded of an indigent parent without accessible publicly funded alternatives or reasonable time to access waitlist services",
      "Whether privacy/consent releases for treatment providers were proportionate and focused on safety/participation rather than wholesale disclosure without basis"
    ],
    evidenceEstablishingCompliance: [
      "Referrals to publicly funded community mental health, addiction, or trauma programs",
      "Clear differentiation in the Service Plan between mandatory safety steps and voluntary/recommended therapy"
    ],
    overstatementGuard: "NEVER assert that CYFSA legally compels CAS to pay for private therapy or private addiction treatment; always cite the statutory bar in ss. 94(6)(c), 101(7)(c), and 116(4)(c) while evaluating whether accessible public referrals were made."
  },
  {
    ruleId: "B3-OCPS-STD-7-MENTAL-HEALTH-ADDICTION-COORDINATION",
    domain: "B3_MENTAL_HEALTH_AND_ADDICTIONS",
    authorityId: "OCPS:STD_7",
    secondaryAuthorityIds: ["CYFSA:100", "CYFSA:101(2)"],
    legalSource: "Ontario Child Protection Standards (2016) & CYFSA s. 100(a), s. 101(2)",
    exactSectionOrStandard: "OCPS (2016) Standard 7; CYFSA s. 100(a), s. 101(2)",
    effectiveDate: "2016-01-01",
    legalForce: "STANDARDS_BASED",
    title: "Assessment-Linked Mental Health, Trauma, Domestic Violence & Substance Use Referrals",
    requiredOrExpectedAction: "Where parental mental health, trauma, domestic violence victimization, or substance use is identified as contributing to child protection risk, include specific, realistic goals in the Service Plan, facilitate referrals to appropriate community services, and evaluate progress based on impact on child safety and parenting capacity rather than diagnosis alone.",
    triggeringCircumstances: "Cases where parental mental health, addiction, or domestic violence exposure is cited as a protection concern.",
    applicabilityConditions: "Applies during ongoing service planning (OCPS Standard 7) and Plan of Care preparation (CYFSA s. 100(a)).",
    exceptionsAndStatutoryLimits: "A mental health diagnosis or history of substance use is not, by itself, a ground for a protection finding under CYFSA s. 74(2) absent evidence of resulting physical/emotional harm or likely risk of harm to the child.",
    accessibilityFactorsToEvaluate: [
      "Waitlist durations for publicly funded counselling, detox, or residential treatment",
      "Whether domestic violence support was trauma-informed and did not penalize a non-offending protective parent for seeking help",
      "Whether relapse or treatment barriers were assessed in relation to actual child safety mitigation plans"
    ],
    evidenceEstablishingCompliance: [
      "Service Plan goals linking substance use or mental health supports to concrete child safety outcomes",
      "Documentation of referral offers, consent forms, and collateral follow-up with treatment providers"
    ],
    overstatementGuard: "Do not equate a mental health diagnosis or past substance use with child neglect unless the evidence links it to a statutory ground in CYFSA s. 74(2)."
  }
];
var B4_HOUSING_AND_BASIC_NECESSITIES_RULES = [
  {
    ruleId: "B4-POVERTY-AND-SOCIOECONOMIC-CONDITIONS-DISTINCTION",
    domain: "B4_HOUSING_AND_BASIC_NECESSITIES",
    authorityId: "CYFSA:74(2)",
    secondaryAuthorityIds: ["CYFSA:1(2)", "CYFSA:101(2)", "BILL_C92:14", "CYFSA:94(6)"],
    legalSource: "Child, Youth and Family Services Act, 2017, s. 74(2), s. 101(2)\u2013(3), s. 94(6)(c); Bill C-92, S.C. 2019, c. 24, s. 15",
    exactSectionOrStandard: "CYFSA s. 74(2), s. 101(2)\u2013(3), s. 94(6)(c); S.C. 2019, c. 24, s. 15",
    effectiveDate: "2018-04-30",
    legalForce: "LEGALLY_REQUIRED",
    title: "Distinguishing Poverty / Housing Hardship from Child Neglect & Navigation of Basic-Needs Supports",
    requiredOrExpectedAction: "Distinguish financial hardship, precarious housing, or lack of material resources from culpable neglect under CYFSA s. 74(2). For Indigenous children, Bill C-92 s. 15 expressly prohibits apprehension solely on the basis of socio-economic conditions, including poverty, lack of adequate housing or infrastructure, or the state of health of the parent. While a court cannot order CAS to provide direct financial assistance under CYFSA ss. 94(6)(c), 101(7)(c), or 116(4)(c), CAS must identify assistance efforts under s. 101(2) and coordinate community housing/income referrals under OCPS Standard 7.",
    triggeringCircumstances: "Cases involving inadequate housing, overcrowding, shelter residence, utility arrears, food insecurity, or lack of infant/child supplies.",
    applicabilityConditions: "CYFSA s. 74(2) and s. 101(2)\u2013(3) apply to all families; Bill C-92 s. 15 applies as paramount federal law to First Nations, Inuit, and M\xE9tis children.",
    exceptionsAndStatutoryLimits: "CAS is not a public housing authority or income-maintenance ministry and cannot be court-ordered to pay rent or provide financial assistance (ss. 94(6)(c), 101(7)(c), 116(4)(c)). However, CAS may issue support letters for special priority housing, navigate Ontario Works/ODSP/shelter supports, or provide discretionary emergency vouchers where agency policy permits.",
    accessibilityFactorsToEvaluate: [
      "Whether CAS provided housing support letters, shelter navigation, or referrals to housing stability / income support programs",
      "Whether housing conditions posed an actual safety hazard to the child vs. poverty-related crowding or aesthetic concerns",
      "Whether Bill C-92 s. 15 applies (for Indigenous children)"
    ],
    evidenceEstablishingCompliance: [
      "Documentation distinguishing actual physical safety hazards from socio-economic hardship",
      "Case notes or correspondence showing housing support letters, community resource referrals, or concrete problem-solving around basic necessities"
    ],
    overstatementGuard: "Never state that CAS has a statutory duty to provide housing or pay rent; instead evaluate whether CAS coordinated housing/income navigation and whether poverty was improperly conflated with protection risk."
  }
];
var B5_KINSHIP_AND_FAMILY_NETWORKS_RULES = [
  {
    ruleId: "B5-CYFSA-KINSHIP-PRIORITY-AND-ASSESSMENT",
    domain: "B5_KINSHIP_AND_FAMILY_NETWORKS",
    authorityId: "CYFSA:101(4)",
    secondaryAuthorityIds: ["CYFSA:94(2)", "CYFSA:101(5)", "CYFSA:109(2)", "BILL_C92:16(1)"],
    legalSource: "Child, Youth and Family Services Act, 2017, ss. 74(4), 94(2)(c), 101(4)\u2013(5), 109(2)(d); O. Reg. 156/18 Part II (Kinship Service Standards); Bill C-92 s. 16",
    exactSectionOrStandard: "CYFSA ss. 74(4), 94(2)(c), 101(4), 101(5), 109(2)(d); Bill C-92 s. 16(1)\u2013(2)",
    effectiveDate: "2018-04-30",
    legalForce: "LEGALLY_REQUIRED",
    title: "Mandatory Consideration of Relative, Extended Family, and Community Placement Before Society Care",
    requiredOrExpectedAction: "Where a child cannot remain safely with a parent, the court and society must consider whether the child can be placed with a relative, extended family member, or member of the child's community (CYFSA s. 94(2)(c) at interim stage; s. 101(4) before making a temporary or extended society care order; s. 109(2)(d) in society placement decisions). For Indigenous children, Bill C-92 s. 16(1) mandates placement priority: (a) parent, (b) family member, (c) member of the same Indigenous group/community, (d) member of another Indigenous group, before non-Indigenous placement.",
    triggeringCircumstances: "Any out-of-home placement decision, interim care motion (s. 94), or dispositional hearing (s. 101), or whenever a parent or family member proposes a kin caregiver.",
    applicabilityConditions: "Applies to all out-of-home placements under the CYFSA; heightened statutory duties apply to First Nations, Inuk, or M\xE9tis children under CYFSA ss. 74(4), 101(5) and Bill C-92 s. 16.",
    exceptionsAndStatutoryLimits: "Proposed kinship placements are subject to safety/kinship assessment under the Ontario Kinship Service Standards (O. Reg. 156/18, s. 2) and the child's best interests (CYFSA s. 74(3)).",
    accessibilityFactorsToEvaluate: [
      "Whether CAS asked the parents and child to identify relatives, extended family, or community members early in the case",
      "Whether proposed kin caregivers were assessed promptly under the Kinship Service Standards rather than left unassessed",
      "If a proposed kin caregiver was rejected, whether the specific safety reasons were documented and communicated",
      "Whether Family Group Decision Making, family-centred conferencing, or ADR (CYFSA s. 17 / s. 76(3)) was offered to build a family safety network"
    ],
    evidenceEstablishingCompliance: [
      "Kinship identification inquiries and Kinship Service Assessment records",
      "Plan of Care or affidavit explaining the assessment of proposed relatives/community members under s. 94(2)(c) or s. 101(4)\u2013(5)"
    ],
    overstatementGuard: "Do not assert that every proposed relative must be approved; CAS is required to consider and assess proposed kin against child safety and best-interests criteria."
  }
];
var B6_PARENT_CHILD_CONTACT_RULES = [
  {
    ruleId: "B6-CYFSA-104-105-ACCESS-AND-MEANINGFUL-CONTACT",
    domain: "B6_PARENT_CHILD_CONTACT",
    authorityId: "CYFSA:104(1)",
    secondaryAuthorityIds: ["CYFSA:105(1)", "CYFSA:105(5)", "CYFSA:100"],
    legalSource: "Child, Youth and Family Services Act, 2017, S.O. 2017, c. 14, Sched. 1",
    exactSectionOrStandard: "ss. 10(1)(a), 100(d)(ii), 104(1), 105(1), 105(5)",
    effectiveDate: "2018-04-30",
    legalForce: "LEGALLY_REQUIRED",
    title: "Access Orders, Plan of Care Access Arrangements & Beneficial/Meaningful Contact",
    requiredOrExpectedAction: "When a child is placed out of the parent's care, the society's Plan of Care must specify the arrangements for access between the child and parents, siblings, and extended family (s. 100(d)(ii)), and the child in care has a statutory right to speak in private with family members subject to court orders (s. 10(1)(a)). The court may make an access order in the child's best interests (s. 104(1)), must make an access order where custody is transferred under s. 102 unless best interests dictate otherwise (s. 105(1)), and shall not make an access order for a child in extended society care unless the relationship is beneficial and meaningful to the child (s. 105(5)).",
    triggeringCircumstances: "Any out-of-home placement, interim care order, temporary society care order, custody order, or extended society care order.",
    applicabilityConditions: "Applies whenever a child is removed from or living apart from a parent or sibling under CYFSA intervention.",
    exceptionsAndStatutoryLimits: "Access frequency, duration, location, and supervision are governed by the child's safety and best interests (s. 74(3), s. 104(1)). Supervision of visits or restriction of contact must be justified by documented child safety or emotional well-being concerns.",
    accessibilityFactorsToEvaluate: [
      "Frequency, duration, and developmental appropriateness of visits (especially for infants and young children)",
      "Whether the level of supervision (fully supervised at CAS office vs. semi-supervised, community, or kin-supervised) is justified by specific safety risks",
      "Whether CAS progressively reviewed expanding access (longer, less supervised, community/home visits) as safety goals were met",
      "Whether practical barriers to visits (transportation, transit tokens, distance, parent work hours, school schedules) were addressed",
      "Whether sibling contact and cultural/linguistic continuity were maintained"
    ],
    evidenceEstablishingCompliance: [
      "Plan of Care section addressing access arrangements (s. 100(d)(ii))",
      "Access observation notes and periodic reviews evaluating whether supervision can be reduced or frequency increased"
    ],
    overstatementGuard: "Distinguish between court-ordered access parameters and discretionary CAS scheduling decisions where an order leaves access in the society's discretion."
  }
];
var B7_REUNIFICATION_AND_PERMANENCY_RULES = [
  {
    ruleId: "B7-CYFSA-122-CUMULATIVE-TIME-IN-CARE-AND-REUNIFICATION",
    domain: "B7_REUNIFICATION_AND_PERMANENCY",
    authorityId: "CYFSA:122(1)",
    secondaryAuthorityIds: ["CYFSA:122(5)", "CYFSA:100", "CYFSA:113(1)", "CYFSA:114", "CYFSA:75(6)"],
    legalSource: "Child, Youth and Family Services Act, 2017, S.O. 2017, c. 14, Sched. 1",
    exactSectionOrStandard: "ss. 75(6), 100(b), 113(1), 114, 122(1), 122(2), 122(4), 122(5)",
    effectiveDate: "2018-04-30",
    legalForce: "LEGALLY_REQUIRED",
    title: "Statutory Cumulative Interim Society Care Time Limits (12 / 24 Months), Deemed Extension (s. 122(4)), Discretionary 6-Month Extension (s. 122(5)) & Status Review",
    requiredOrExpectedAction: "Ensure timely reunification planning and status review (ss. 113\u2013114) within statutory cumulative interim society care limits under CYFSA s. 122(1): 12 months if the child is younger than 6 on the day the court makes the order, or 24 months if the child is 6 or older on the day the court makes the order. Time in care under temporary care agreements (s. 75(1)) or temporary adjournment custody (s. 94(2)(d)) counts toward the limit (s. 122(2)). Where the period expires while an appeal of a s. 101(1) order is pending or a s. 114 status review hearing is adjourned, the period is deemed extended until the appeal is disposed of or the s. 114 order is made (s. 122(4)). Under s. 122(5), the court may by order extend the period permitted under s. 122(1) by up to 6 months if in the child's best interests. Where the society intends for the child to return to a parent, the Plan of Care (s. 100(b)(i)) must state the changes required before the child can return.",
    triggeringCircumstances: "Any case where a child is in temporary care (by Temporary Care Agreement under s. 75 or interim society care order under s. 101(1) para. 2) or approaching a status review under s. 113.",
    applicabilityConditions: "Applies to all children in interim society care; s. 122(2) includes time spent in society care under temporary care agreements (s. 75(6) max 12 months in 24) and temporary orders.",
    exceptionsAndStatutoryLimits: "Deemed extension under s. 122(4) during pending appeals or adjourned s. 114 status review hearings; discretionary judicial extension of up to 6 months under s. 122(5) where in the child's best interests.",
    accessibilityFactorsToEvaluate: [
      "Whether the required behavioural/safety changes for return of the child were clearly stated in the Plan of Care (s. 100(b)(i)) and Service Plan",
      "Whether referral delays or waitlists consumed the 12-month or 24-month statutory clock under s. 122(1)",
      "Whether transition planning, step-down access, and post-reunification supervision/supports were prepared"
    ],
    evidenceEstablishingCompliance: [
      "Plan of Care explicitly stating the changes required for return of the child (s. 100(b)(i))",
      "Status review application filed before expiry of the existing order (s. 113(2)) and accurate calculation of cumulative time in care under s. 122"
    ],
    overstatementGuard: "Always state both the statutory ceiling (12 months for under 6; 24 months for 6 and older under s. 122(1)), the deemed extension under s. 122(4), and the court's discretionary authority to extend by up to 6 months under s. 122(5)."
  }
];
var ALL_PARENT_ASSISTANCE_RULES = [
  ...B1_FAMILY_PRESERVATION_RULES,
  ...B2_PARENTING_SUPPORT_RULES,
  ...B3_MENTAL_HEALTH_AND_ADDICTIONS_RULES,
  ...B4_HOUSING_AND_BASIC_NECESSITIES_RULES,
  ...B5_KINSHIP_AND_FAMILY_NETWORKS_RULES,
  ...B6_PARENT_CHILD_CONTACT_RULES,
  ...B7_REUNIFICATION_AND_PERMANENCY_RULES
];
function parseIsoDateUtc(dateStr) {
  if (!dateStr || typeof dateStr !== "string") return null;
  const trimmed = dateStr.trim();
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(trimmed);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) {
    return null;
  }
  return date;
}
function formatIsoDateUtc(date) {
  return date.toISOString().slice(0, 10);
}
function calculateStandard7ServicePlanDeadline(input) {
  const investigationCompletion = parseIsoDateUtc(input.investigationCompletionDate);
  const caseTransfer = parseIsoDateUtc(input.caseTransferDate);
  const servicePlanCompletion = parseIsoDateUtc(input.servicePlanCompletionDate);
  const removal = parseIsoDateUtc(input.removalDate);
  let triggerDateObj = null;
  let triggerEventUsed = "NONE";
  let deadlineStatus = "DEADLINE_NOT_DETERMINABLE";
  if (caseTransfer) {
    triggerDateObj = caseTransfer;
    triggerEventUsed = "CASE_TRANSFER";
    deadlineStatus = "DETERMINED_FROM_CASE_TRANSFER";
  } else if (investigationCompletion) {
    triggerDateObj = investigationCompletion;
    triggerEventUsed = "INVESTIGATION_COMPLETION";
    deadlineStatus = "DETERMINED_FROM_INVESTIGATION_COMPLETION";
  }
  if (!triggerDateObj) {
    const removalNote = removal ? `Although a child removal/apprehension date (${formatIsoDateUtc(removal)}) appears in the record, OCPS (2016) Standard 7 measures the 30-day initial Service Plan timeline from completion of the investigation or transfer to ongoing services \u2014 NOT from the date of removal alone.` : "Neither the investigation completion date nor the ongoing service case transfer date is documented in the uploaded records.";
    return {
      deadlineStatus: "DEADLINE_NOT_DETERMINABLE",
      triggerEventUsed: "NONE",
      triggerDate: null,
      calculatedDeadlineDate: null,
      servicePlanCompletionDate: servicePlanCompletion ? formatIsoDateUtc(servicePlanCompletion) : null,
      daysElapsedToServicePlan: null,
      withinThirtyDayStandard: null,
      explanation: `DEADLINE_NOT_DETERMINABLE: ${removalNote} Additional records (such as the Investigation Conclusion / Case Transfer record under OCPS Standard 6) are needed to determine the exact 30-day Standard 7 deadline.`,
      cautionNote: "Do not calculate the 30-day OCPS Standard 7 initial Service Plan deadline from the date of apprehension/removal or referral alone."
    };
  }
  const deadlineDateObj = new Date(triggerDateObj.getTime() + 30 * 864e5);
  const triggerDateIso = formatIsoDateUtc(triggerDateObj);
  const deadlineDateIso = formatIsoDateUtc(deadlineDateObj);
  if (!servicePlanCompletion) {
    return {
      deadlineStatus,
      triggerEventUsed,
      triggerDate: triggerDateIso,
      calculatedDeadlineDate: deadlineDateIso,
      servicePlanCompletionDate: null,
      daysElapsedToServicePlan: null,
      withinThirtyDayStandard: null,
      explanation: `Based on the documented ${triggerEventUsed === "CASE_TRANSFER" ? "case transfer" : "investigation completion"} date (${triggerDateIso}), the 30-day OCPS Standard 7 deadline for the initial ongoing Service Plan is ${deadlineDateIso}. The completion date of the initial Service Plan is not documented in the uploaded records.`,
      cautionNote: "Missing Service Plan completion date in the uploaded excerpt means the Service Plan is not documented in the uploaded records \u2014 not a confirmed failure to create one."
    };
  }
  const servicePlanIso = formatIsoDateUtc(servicePlanCompletion);
  const daysElapsed = Math.round(
    (servicePlanCompletion.getTime() - triggerDateObj.getTime()) / 864e5
  );
  const withinStandard = daysElapsed >= 0 && daysElapsed <= 30;
  return {
    deadlineStatus,
    triggerEventUsed,
    triggerDate: triggerDateIso,
    calculatedDeadlineDate: deadlineDateIso,
    servicePlanCompletionDate: servicePlanIso,
    daysElapsedToServicePlan: daysElapsed,
    withinThirtyDayStandard: withinStandard,
    explanation: withinStandard ? `The initial ongoing Service Plan (${servicePlanIso}) was completed ${daysElapsed} day(s) after ${triggerEventUsed === "CASE_TRANSFER" ? "case transfer" : "investigation completion"} (${triggerDateIso}), within the 30-day OCPS (2016) Standard 7 timeline (deadline ${deadlineDateIso}).` : `The initial ongoing Service Plan (${servicePlanIso}) was completed ${daysElapsed} day(s) after ${triggerEventUsed === "CASE_TRANSFER" ? "case transfer" : "investigation completion"} (${triggerDateIso}), which is outside the 30-day OCPS (2016) Standard 7 timeline (deadline ${deadlineDateIso}). Check whether supervisory approval and reasons for a timeline departure were documented.`,
    cautionNote: "Under OCPS (2016), a departure from the 30-day Standard 7 timeline may be authorized with supervisory consultation, approval, and documented reasons."
  };
}

// shared/complianceMatrixEngine.ts
function enforceMissingDocumentNeutralityGuard(params) {
  if (params.exceptionMayApply) {
    return "EXCEPTION_MAY_APPLY";
  }
  if (params.isSolelyMissingDocumentInUpload && !params.hasAffirmativeEvidenceOfConductOrOmission) {
    if (params.proposedStatus === "POTENTIAL_NONCOMPLIANCE" || params.proposedStatus === "COMPLIANT_ON_AVAILABLE_EVIDENCE") {
      return "NOT_DOCUMENTED_IN_UPLOADED_RECORDS";
    }
  }
  return params.proposedStatus;
}
function extractFirstMatchingSpan(sourceText, patterns, fallbackExcerpt) {
  if (!sourceText || !sourceText.trim()) {
    return {
      excerpt: fallbackExcerpt,
      page: 1,
      paragraphOrSpan: "Uploaded Document Overview"
    };
  }
  const lines = sourceText.split(/\r?\n/).map((line) => line.trim()).filter((line) => line.length > 0);
  for (const pattern of patterns) {
    for (let i = 0; i < lines.length; i++) {
      if (pattern.test(lines[i])) {
        const snippet = lines[i].slice(0, 260);
        const estimatedPage = Math.max(1, Math.ceil((i + 1) / Math.max(lines.length, 1) * 4));
        return {
          excerpt: snippet,
          page: estimatedPage,
          paragraphOrSpan: `Para. / Line ${i + 1}`
        };
      }
    }
  }
  const firstLine = lines[0] ? lines[0].slice(0, 240) : fallbackExcerpt;
  return {
    excerpt: firstLine,
    page: 1,
    paragraphOrSpan: "Para. / Line 1"
  };
}
function extractDatesForStandard7(sourceText, explicitDates) {
  if (explicitDates) {
    return explicitDates;
  }
  const text = sourceText || "";
  const transferMatch = /(?:transfer(?:red)?\s+to\s+ongoing(?:\s+services?)?|case\s+transfer(?:\s+date)?)\s*(?:on|:)?\s*(\d{4}-\d{2}-\d{2})/i.exec(
    text
  );
  const investigationCompletionMatch = /(?:investigation\s+(?:completed|completion|concluded|disposition))\s*(?:on|:)?\s*(\d{4}-\d{2}-\d{2})/i.exec(
    text
  );
  const servicePlanMatch = /(?:initial\s+service\s+plan|service\s+plan\s+(?:completed|signed|approved))\s*(?:on|:)?\s*(\d{4}-\d{2}-\d{2})/i.exec(
    text
  );
  const removalMatch = /(?:apprehended|removed\s+from\s+care|removal\s+date)\s*(?:on|:)?\s*(\d{4}-\d{2}-\d{2})/i.exec(
    text
  );
  return {
    investigationCompletionDate: investigationCompletionMatch?.[1] ?? null,
    caseTransferDate: transferMatch?.[1] ?? null,
    servicePlanCompletionDate: servicePlanMatch?.[1] ?? null,
    removalDate: removalMatch?.[1] ?? null
  };
}
function buildOversightPathwaySummary(pathwayId) {
  const found = A7_ACCOUNTABILITY_AND_COMPLAINT_PATHWAYS.find((p) => p.pathwayId === pathwayId);
  if (!found) return null;
  return {
    pathwayId: found.pathwayId,
    pathwayName: found.name,
    statutoryAuthority: found.governingStatuteOrRegulation,
    jurisdictionNote: found.mandatoryExclusions.join("; "),
    cannotOverturnCourtOrder: !found.canOverturnCourtOrder
  };
}
function verifyMatrixAuthority(authorityId, propositionText) {
  const entry = VERIFIED_AUTHORITIES_REGISTRY[authorityId];
  if (!entry) {
    return "UNVERIFIED";
  }
  const propCheck = evaluatePropositionSupport(entry.sectionKey || authorityId, propositionText);
  if (propCheck.support === "IRRELEVANT_OR_MISAPPLIED" || propCheck.support === "CONTRADICTED_BY_STATUTE") {
    return "IRRELEVANT_OR_UNSUPPORTED";
  }
  return "VERIFIED";
}
function evaluateParentAssistanceNeed15Questions(params) {
  const {
    needId,
    identifiedNeedTitle,
    domain,
    sourceText,
    legalForceClassification,
    relevantPatterns
  } = params;
  const text = sourceText || "";
  const span = extractFirstMatchingSpan(
    text,
    relevantPatterns,
    "No specific excerpt for this support domain appears in the uploaded record."
  );
  const hasNeedMention = relevantPatterns.some((re) => re.test(text));
  const hasReferralMention = /\b(?:referr(?:ed|al)|offered\s+services?|connected\s+with|intake|program\s+referral|counsel(?:ling|lor)|parenting\s+program|housing\s+support)\b/i.test(
    text
  );
  const hasWaitlistOrBarrierMention = /\b(?:wait\s*list|waitlist|barrier|transportation|cost|unaffordable|private\s+pay|hours\s+conflict|child\s*care|language\s+barrier|inaccessible)\b/i.test(
    text
  );
  const hasParticipationMention = /\b(?:attended|completed|participat(?:ed|ing)|engaged\s+in|enrolled|waitlisted)\b/i.test(text);
  const hasDeclinedMention = /\b(?:declined|refused\s+service|did\s+not\s+attend)\b/i.test(text);
  const hasFollowUpMention = /\b(?:follow(?:ed)?\s*-?\s*up|collateral\s+check|adjusted\s+plan|updated\s+service\s+plan)\b/i.test(
    text
  );
  const hasKinshipMention = /\b(?:kinship|relative|grandmother|grandfather|aunt|uncle|extended\s+family|community\s+member|family\s+network)\b/i.test(
    text
  );
  const hasPrivateFundingDemand = /\b(?:private\s+therapy|pay\s+for\s+private|purchase\s+services?|fund\s+residential|financial\s+assistance\s+order)\b/i.test(
    text
  );
  const statuses = [];
  if (hasNeedMention) {
    statuses.push("NEED_IDENTIFIED");
  }
  if (hasReferralMention) {
    statuses.push("SERVICE_CONSIDERED", "SERVICE_OFFERED", "REFERRAL_MADE");
  } else if (hasNeedMention) {
    statuses.push("NO_OFFER_DOCUMENTED");
  }
  if (hasWaitlistOrBarrierMention) {
    statuses.push("SERVICE_INACCESSIBLE");
  } else if (hasReferralMention) {
    statuses.push("SERVICE_ACCESSIBLE");
  }
  if (hasParticipationMention) {
    statuses.push("SERVICE_ACCEPTED");
    if (/\bcompleted\b/i.test(text)) {
      statuses.push("SERVICE_COMPLETED");
    }
  }
  if (hasDeclinedMention) {
    statuses.push("SERVICE_DECLINED");
  }
  if (hasFollowUpMention) {
    statuses.push("FOLLOW_UP_DOCUMENTED");
  }
  if (statuses.length === 0) {
    statuses.push("UNKNOWN");
  }
  const statutoryNonFundingRuleTriggered = domain === "B3_MENTAL_HEALTH_AND_ADDICTIONS" || domain === "B4_HOUSING_AND_BASIC_NECESSITIES" || hasPrivateFundingDemand;
  return {
    needId,
    identifiedNeedTitle,
    domain,
    coexistingStatuses: statuses,
    legalForceClassification,
    statutoryNonFundingRuleTriggered,
    statutoryNonFundingExplanation: statutoryNonFundingRuleTriggered ? "Under CYFSA ss. 94(6)(c), 101(7)(c), and 116(4)(c), a court cannot order a society to provide financial assistance or purchase goods or services as a supervision condition. However, CAS remains subject to CYFSA s. 100(a) (Plan of Care service specification), s. 101(2)\u2013(3) (inquiry into pre-intervention assistance and less disruptive alternatives), and OCPS (2016) Standard 7 (referrals to accessible community/publicly funded supports)." : "Standard statutory and operational referral duties apply (CYFSA ss. 35(1), 100(a), 101(2)\u2013(3); OCPS Standard 7).",
    questions: {
      q1_concernIdentifiedByCas: hasNeedMention ? `The uploaded record references ${identifiedNeedTitle.toLowerCase()} (${span.paragraphOrSpan}: "${span.excerpt}").` : `No explicit concern regarding ${identifiedNeedTitle.toLowerCase()} is detailed in the uploaded excerpt.`,
      q2_rootProblemBehindConcern: hasNeedMention ? "Assess whether the underlying factor is an acute safety threat, an unmet treatment/support need, or a socio-economic/housing barrier." : "Not determinable from the uploaded excerpt alone.",
      q3_serviceCouldReduceRisk: "Targeted community referrals, structured safety planning, and accessible family/parenting or clinical supports tied to behavioural safety outcomes under OCPS Standard 7.",
      q4_serviceDiscussedWithParent: hasReferralMention ? "The uploaded record indicates services or referrals were mentioned; verify in contemporaneous case notes how options were explained to the parent." : "No discussion of concrete service options for this concern is documented in the uploaded record.",
      q5_referralOrServiceOffered: hasReferralMention ? "A service or referral reference appears in the record; verify whether a concrete intake referral was submitted or only a general recommendation was noted." : "No concrete referral or service offer for this need is documented in the uploaded record (`NO_OFFER_DOCUMENTED`).",
      q6_whenWasItOffered: "Exact referral date is not fully specified in the uploaded excerpt; request the referral transmission log and Service Plan date.",
      q7_whoWasResponsibleForFollowUp: "Under OCPS (2016) Standard 7, the ongoing CAS worker is responsible for coordinating referrals and monitoring progress, with each task assigned in the Service Plan.",
      q8_wasServiceAccessible: hasWaitlistOrBarrierMention ? "Potential accessibility barriers (such as waitlists, cost, scheduling, or transportation) are indicated in the record (`SERVICE_INACCESSIBLE`)." : hasReferralMention ? "Accessibility details (waitlists, cost, location, hours, language/disability accommodation) are not fully documented; confirm whether the service was practically accessible." : "Cannot be determined because no referral is documented in the uploaded record.",
      q9_didParentParticipateOrAttempt: hasParticipationMention ? "The record indicates parent engagement, attendance, or waitlist enrollment (`SERVICE_ACCEPTED`)." : hasDeclinedMention ? "The record notes a service was declined or not attended (`SERVICE_DECLINED`); examine whether barriers or lack of accommodation contributed." : "Parent participation status is not documented in the uploaded excerpt.",
      q10_barriersPreventingParticipation: hasWaitlistOrBarrierMention ? "Waitlists, cost, transportation, or scheduling barriers are noted in the record." : "Not documented in the uploaded records; inquire whether waitlist, financial, transportation, childcare, cultural, or disability barriers existed.",
      q11_didCasAdjustPlanWhenBarriersAppeared: hasFollowUpMention ? "The record references follow-up or plan adjustment (`FOLLOW_UP_DOCUMENTED`)." : "The uploaded record does not show whether the Service Plan was adjusted to address barriers.",
      q12_wereKinshipOrCommunitySupportsExplored: hasKinshipMention ? "Kinship, relative, or community network references appear in the record; verify whether formal Kinship Service Assessment was completed." : "Exploration of relative, extended family, or community network supports under CYFSA ss. 94(2)(c), 101(4) is not documented in this excerpt.",
      q13_howDidAssistanceAffectRiskAndReunification: "Under CYFSA ss. 100(a)\u2013(b) and 101(2)\u2013(3), the availability, accessibility, and completion of targeted assistance directly inform whether less disruptive alternatives or reunification under supervision can adequately protect the child.",
      q14_whatEvidenceSupportsEachAnswer: `Attributed to ${span.paragraphOrSpan} (Page ${span.page}): "${span.excerpt}"`,
      q15_whatRecordsAreMissing: [
        "Initial and revised OCPS Standard 7 Service Plans with supervisor sign-off",
        "Family and Child Strengths and Needs Assessment",
        "Referral intake forms, waitlist confirmations, and collateral correspondence",
        "Contemporaneous case notes of service planning discussions with the parent"
      ].join("; ")
    },
    pageAndParagraphAttribution: `Page ${span.page}, ${span.paragraphOrSpan}`,
    exactExcerpt: span.excerpt
  };
}
function buildComplianceMatrixFromReport(report, sourceText, options = {}) {
  const docId = options.documentId || "uploaded-cas-record-1";
  const docTitle = options.documentTitle || report.documentType || "Uploaded CAS Record";
  const combinedText = [
    sourceText || "",
    report.executiveSummary || "",
    ...(report.statutoryFindings || []).map(
      (f) => `${f.title || ""} ${f.statute || ""} ${f.description || ""} ${(f.evidenceQuotes || []).join(" ")}`
    )
  ].join("\n").trim();
  const std7Dates = extractDatesForStandard7(combinedText, options.standard7Dates);
  const standard7DeadlineAssessment = calculateStandard7ServicePlanDeadline(std7Dates);
  const caseNoteEval = evaluateCaseNoteCompleteness({
    hasContactDateAndTime: /\b(?:\d{4}-\d{2}-\d{2}|\d{1,2}\/\d{1,2}\/\d{2,4}|\b(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+\d{1,2},?\s+\d{4})\b/i.test(
      combinedText
    ),
    hasMethodOfContact: /\b(?:home\s+visit|office\s+visit|telephone|phone\s+call|in-person|unannounced\s+visit|video\s+call)\b/i.test(
      combinedText
    ),
    hasParticipantsIdentified: /\b(?:present|participants?|mother|father|parent|child|worker|supervisor)\b/i.test(
      combinedText
    ),
    hasSignificantDiscussionsRecorded: combinedText.length > 80,
    hasDirectObservationsSeparatedFromOpinion: /\b(?:observed|saw|stated|reported)\b/i.test(
      combinedText
    ),
    hasWorkerIdentityAndRole: /\b(?:worker|social\s+worker|csw|child\s+protection\s+worker|affiant)\b/i.test(
      combinedText
    ),
    hasDateOfNoteCreation: /\b(?:note\s+created|entered\s+on|recorded\s+on|sworn\s+on|dated)\b/i.test(
      combinedText
    ),
    hasSupervisoryDiscussionsRecorded: /\b(?:supervisor|supervisory\s+consult(?:ation)?|approved\s+by\s+supervisor)\b/i.test(
      combinedText
    ),
    hasLateEntryOrAmendmentAttribution: /\b(?:late\s+entry|addendum|amended|corrected)\b/i.test(
      combinedText
    )
  });
  const items = [];
  {
    const span = extractFirstMatchingSpan(
      combinedText,
      [
        /\b(?:less\s+disruptive|efforts?\s+to\s+assist|supervision\s+order|remove|apprehend|temporary\s+care)\b/i
      ],
      "Uploaded document does not set out a complete record of pre-intervention assistance efforts or less disruptive alternatives."
    );
    const hasLessDisruptiveAnalysis = /\b(?:less\s+disruptive\s+alternatives?|efforts?\s+to\s+assist|why\s+supervision\s+would\s+be\s+inadequate)\b/i.test(
      combinedText
    );
    const hasRemovalWithoutAlternatives = /\b(?:apprehended|removed\s+from\s+care|society\s+care)\b/i.test(combinedText) && !hasLessDisruptiveAnalysis;
    const rawStatus = hasLessDisruptiveAnalysis ? "COMPLIANT_ON_AVAILABLE_EVIDENCE" : hasRemovalWithoutAlternatives ? "INSUFFICIENT_EVIDENCE" : "NOT_DOCUMENTED_IN_UPLOADED_RECORDS";
    const complianceStatus = enforceMissingDocumentNeutralityGuard({
      proposedStatus: rawStatus,
      hasAffirmativeEvidenceOfConductOrOmission: false,
      isSolelyMissingDocumentInUpload: !hasLessDisruptiveAnalysis
    });
    const authorityId = "CYFSA:101(2)";
    const verificationStatus = verifyMatrixAuthority(
      authorityId,
      "Before making a protection order under s. 101(1), the court shall ask what efforts the society or another person or entity has made to assist the child before intervention, and under s. 101(3) shall not make an order removing the child unless satisfied that less disruptive alternatives would be inadequate."
    );
    items.push({
      itemId: "MATRIX-LAW-01-LESS-DISRUPTIVE",
      category: "LAW_AND_PROCEDURE",
      title: "Mandatory Assessment of Pre-Intervention Assistance & Less Disruptive Alternatives",
      authority: {
        authorityId,
        legalSource: "Child, Youth and Family Services Act, 2017, S.O. 2017, c. 14, Sched. 1",
        exactSectionOrStandard: "s. 101(2), s. 101(3), s. 94(4), s. 100(a)\u2013(c)",
        effectiveDate: "2018-04-30",
        legalForce: "STATUTORY_MANDATORY",
        applicabilityConditions: "Applies to every dispositional protection hearing under CYFSA s. 101 and interim care analysis under s. 94(4).",
        exceptions: "Where immediate child safety cannot be protected adequately through non-residential services, supervision conditions (s. 94(5) / s. 101(6)), or kinship placement (s. 94(2)(c) / s. 101(4))."
      },
      obligation: {
        responsibleParty: "CAS_AGENCY",
        requiredAction: "Detail in the Plan of Care (s. 100) and court evidence what efforts were made to assist the child before intervention (s. 101(2)) and why less disruptive alternatives\u2014including non-residential services and a supervision order\u2014would or would not adequately protect the child (s. 101(3)).",
        triggeringEvent: "Commencement of protection application, temporary care motion (s. 94), or dispositional hearing (s. 101).",
        deadline: "Prior to or at the temporary care / dispositional hearing.",
        requiredDocumentation: "Society Plan of Care (CYFSA s. 100) and supporting sworn affidavit.",
        availableDiscretion: "Selection of specific community services is tailored to the family's assessed risk, but the statutory inquiry under s. 101(2)\u2013(3) is mandatory."
      },
      evidence: {
        documentId: docId,
        documentTitle: docTitle,
        page: span.page,
        paragraphOrSpan: span.paragraphOrSpan,
        eventDate: options.documentDate ?? null,
        recordDate: options.documentDate ?? null,
        author: "CAS Worker / Author of Uploaded Record",
        exactExcerpt: span.excerpt,
        corroboratingEvidence: hasLessDisruptiveAnalysis ? ["Uploaded text references assistance efforts or supervision consideration."] : [],
        contradictoryEvidence: [],
        evidenceLimitations: "Assessment is limited to the uploaded document excerpt; separate service logs or prior Plans of Care may exist in the complete CAS file."
      },
      assessment: {
        applicabilityStatus: "APPLIES",
        complianceStatus,
        reasoning: hasLessDisruptiveAnalysis ? "The uploaded record contains discussion of assistance efforts or less disruptive alternatives. Verify whether the concrete reasons why in-home services or supervision were adequate or inadequate are fully supported by primary case notes." : "The uploaded excerpt does not set out a complete record of pre-intervention assistance efforts under CYFSA s. 101(2) or an itemized comparison of less disruptive alternatives under s. 101(3). Missing documentation in a single uploaded excerpt does not prove those steps did not occur, but requires disclosure of the full Plan of Care and case notes.",
        missingInformation: [
          "Complete Society Plan of Care under CYFSA s. 100",
          "Chronology of pre-intervention referrals and non-residential support offers",
          "Specific safety analysis explaining why supervision conditions under s. 94(5) or s. 101(6) were or were not sufficient"
        ],
        exceptionsConsidered: [
          "Immediate acute safety threat where in-home safety plan could not mitigate imminent risk of harm"
        ],
        sourceVerificationStatus: verificationStatus,
        confidenceOrUncertainty: "High confidence in statutory authority (CYFSA ss. 94(4), 100, 101(2)\u2013(3)); factual completeness depends on full file disclosure.",
        suggestedFollowUpQuestions: [
          "What specific non-residential services or in-home supports were offered to the parent prior to or instead of removal under CYFSA s. 101(2)\u2013(3)?",
          "What concrete supervision terms under CYFSA s. 94(5) or s. 101(6) were considered, and what documented evidence showed they would be inadequate?"
        ],
        potentialOversightPathway: buildOversightPathwaySummary("OVERSIGHT:COURT_PROCEDURAL_AND_EVIDENTIARY_REMEDIES")
      },
      presentation: {
        educationalMode: {
          whatRuleRequires: "Before a court orders a child removed from a parent's care under CYFSA s. 101, the court must look at what help CAS or other services offered before stepping in (s. 101(2)), and whether less disruptive steps\u2014like support services in the home or a supervision order\u2014could keep the child safe (s. 101(3)).",
          whyItAppliesOrMayNotApply: "This rule applies whenever CAS asks a court to place or keep a child out of a parent's care, though urgent safety risks can justify temporary protective placement when in-home conditions cannot keep the child safe.",
          whatDocumentShows: `In ${span.paragraphOrSpan} (Page ${span.page}), the uploaded record states: "${span.excerpt}"`,
          whatIsMissing: "The complete Plan of Care (CYFSA s. 100) and case notes showing each support service considered or offered before removal.",
          questionsToAskNext: [
            "What community or in-home supports were considered before seeking removal?",
            "Why would a supervision order with safety conditions not be enough to protect the child?"
          ]
        },
        courtroomMode: {
          relevantRuleAndAuthority: "Pursuant to CYFSA s. 101(2)\u2013(3) and s. 100(a), (c)(i), the court must inquire into pre-intervention efforts to assist the child and must be satisfied that less disruptive alternatives, including non-residential services, would be inadequate before making a removal order (see also s. 94(4) at the interim stage).",
          documentedFactAndAttribution: `At Page ${span.page}, ${span.paragraphOrSpan} of ${docTitle}: "${span.excerpt}"`,
          evidentialGapOrInconsistency: hasLessDisruptiveAnalysis ? "Verify underlying primary referral records and collateral notes corroborating the summary assertions in the uploaded record." : "The uploaded record does not contain a complete itemized account of pre-intervention assistance under s. 101(2) or why less disruptive supervision terms under s. 94(5)/101(6) were rejected.",
          targetedDisclosureOrClarificationRequest: [
            "Request disclosure of all intake, investigation, and ongoing case notes recording pre-intervention services offered under CYFSA s. 101(2).",
            "Request the complete Society Plan of Care prepared pursuant to CYFSA s. 100(a) and s. 100(c)(i)."
          ]
        }
      }
    });
  }
  {
    const span = extractFirstMatchingSpan(
      combinedText,
      [
        /\b(?:supervisor|supervisory|case\s+note|approved\s+by|safety\s+assessment|risk\s+assessment)\b/i
      ],
      "Supervisory consultation sign-offs and contemporaneous case-note metadata are not fully set out in this excerpt."
    );
    const hasSupervisorMention = /\b(?:supervisor|supervisory\s+consult(?:ation)?|approved\s+by\s+supervisor)\b/i.test(
      combinedText
    );
    const complianceStatus = enforceMissingDocumentNeutralityGuard({
      proposedStatus: hasSupervisorMention ? "PARTIAL_COMPLIANCE" : "NOT_DOCUMENTED_IN_UPLOADED_RECORDS",
      hasAffirmativeEvidenceOfConductOrOmission: false,
      isSolelyMissingDocumentInUpload: !hasSupervisorMention
    });
    const authorityId = "OCPS:ALL_PHASES";
    const verificationStatus = verifyMatrixAuthority(
      authorityId,
      "Across all phases of child protection service delivery, workers must consult with a supervisor at key decision points, obtain supervisory approval for mandatory assessments and departures from standards, and maintain contemporaneous case notes."
    );
    items.push({
      itemId: "MATRIX-ACC-01-SUPERVISION-AND-RECORDS",
      category: "CAS_ACCOUNTABILITY",
      title: "Mandatory Supervisory Consultation, Approvals & Contemporaneous Case-Note Standards",
      authority: {
        authorityId,
        legalSource: "Ontario Child Protection Standards (2016) & O. Reg. 156/18, s. 1",
        exactSectionOrStandard: "OCPS (2016) Standards Applying Across All Phases of Service Delivery; Standards 1\u20138; O. Reg. 156/18, s. 1",
        effectiveDate: "2016-01-01",
        legalForce: "MINISTRY_STANDARD_MANDATORY",
        applicabilityConditions: "Applies across all child protection investigations and ongoing service cases conducted by an Ontario Children's Aid Society.",
        exceptions: "Departures from prescribed timelines are permitted only where the worker consults with a supervisor, obtains supervisory approval, and documents the rationale in the case record."
      },
      obligation: {
        responsibleParty: "CAS_SUPERVISOR",
        requiredAction: "Review and approve safety assessments, risk assessments, verification/disposition decisions, initial and revised Service Plans, case closures, and any departures from standards; ensure contemporaneous case notes record date/time, method of contact, participants, observations, worker identity, creation date, and supervisory consultations.",
        triggeringEvent: "Key decision points across Standards 1\u20138 and at least every 6 weeks during ongoing service.",
        deadline: "At each mandatory decision point and within the prescribed standard timeframe (or documented supervisory-approved departure).",
        requiredDocumentation: "Supervisor approval signatures/timestamps and contemporaneous case notes in the electronic case management system.",
        availableDiscretion: "Supervisors have professional authority to approve departures from standard timelines where justified by case-specific circumstances and documented in writing."
      },
      evidence: {
        documentId: docId,
        documentTitle: docTitle,
        page: span.page,
        paragraphOrSpan: span.paragraphOrSpan,
        eventDate: options.documentDate ?? null,
        recordDate: options.documentDate ?? null,
        author: "CAS Worker / Supervisor",
        exactExcerpt: span.excerpt,
        corroboratingEvidence: caseNoteEval.presentElements.length > 0 ? [
          `Case-note completeness check identified ${caseNoteEval.presentElements.length}/9 standard elements in the uploaded text.`
        ] : [],
        contradictoryEvidence: [],
        evidenceLimitations: caseNoteEval.distinctionNote
      },
      assessment: {
        applicabilityStatus: "APPLIES",
        complianceStatus,
        reasoning: hasSupervisorMention ? `The uploaded record references supervisory involvement, and ${caseNoteEval.presentElements.length} of 9 standard recordkeeping elements appear in the text. However, complete supervisory sign-off logs and original note-creation timestamps (${caseNoteEval.missingElements.join(", ") || "none"}) require verification against the primary file.` : "Supervisory consultation approvals and full contemporaneous case-note metadata (such as original note-creation timestamps vs. event dates) are not documented in the uploaded excerpt. Under the missing-document neutrality rule, this is classified as NOT_DOCUMENTED_IN_UPLOADED_RECORDS rather than a confirmed breach.",
        missingInformation: [
          "Supervisory consultation notes and sign-off timestamps for Safety Assessment, Risk Assessment, and Service Plan",
          "Original electronic entry creation dates vs. contact dates for case notes",
          "Documentation of any supervisory-approved departures from OCPS (2016) timelines"
        ],
        exceptionsConsidered: [
          "Supervisory-approved timeline modifications documented in the internal CPIN/case management file"
        ],
        sourceVerificationStatus: verificationStatus,
        confidenceOrUncertainty: "Verified against OCPS (2016) Standards Applying Across All Phases and O. Reg. 156/18, s. 1.",
        suggestedFollowUpQuestions: [
          "Were the Safety Assessment, Risk Assessment, and Service Plan reviewed and approved by a supervisor within the OCPS (2016) timeframes?",
          "What are the electronic note-creation dates compared to the contact dates for the key observations relied upon?"
        ],
        potentialOversightPathway: buildOversightPathwaySummary("OVERSIGHT:CAS_INTERNAL_COMPLAINT_119")
      },
      presentation: {
        educationalMode: {
          whatRuleRequires: "Under the Ontario Child Protection Standards (2016), CAS workers must consult with a supervisor at major decision points, get supervisor approval for key assessments and service plans, and keep accurate, timely case notes.",
          whyItAppliesOrMayNotApply: "These standards apply to every CAS investigation and ongoing file in Ontario under O. Reg. 156/18.",
          whatDocumentShows: `At Page ${span.page}, ${span.paragraphOrSpan}: "${span.excerpt}" (${caseNoteEval.presentElements.length}/9 case-note elements visible in this excerpt).`,
          whatIsMissing: "Supervisor sign-off records and the original timestamps showing when case notes were written.",
          questionsToAskNext: [
            "When did a supervisor review and approve the assessments and service plan in this file?",
            "Were the case notes written right after the visits occurred, or added later?"
          ]
        },
        courtroomMode: {
          relevantRuleAndAuthority: "Pursuant to O. Reg. 156/18, s. 1 and the Ontario Child Protection Standards (2016) (Standards Applying Across All Phases of Service Delivery; Standards 1\u20138), mandatory assessments, case transfers, service plans, and any departures from prescribed timelines require supervisory consultation and documented approval.",
          documentedFactAndAttribution: `At Page ${span.page}, ${span.paragraphOrSpan} of ${docTitle}: "${span.excerpt}"`,
          evidentialGapOrInconsistency: "The uploaded document does not include the underlying supervisory approval audit trail or contemporaneous note-entry timestamps (`DATE_OF_NOTE_CREATION` vs. `CONTACT_DATE_AND_TIME`).",
          targetedDisclosureOrClarificationRequest: [
            "Request the supervisory consultation log and approval timestamps for all OCPS Standards 2\u20137 instruments in the relevant period.",
            "Request unredacted case-note metadata showing author identity, contact date/time, and electronic note-creation date."
          ]
        }
      }
    });
  }
  {
    const span = extractFirstMatchingSpan(
      combinedText,
      [
        /\b(?:counselling|therapy|addiction|substance|mental\s+health|parenting\s+program|referral|waitlist|financial\s+assistance)\b/i
      ],
      "Specific referral intake records, waitlist tracking, and service accessibility assessments are not fully documented in the uploaded excerpt."
    );
    const hasSupportOffer = /\b(?:referr(?:ed|al)|offered\s+services?|parenting\s+program|counselling\s+referral)\b/i.test(
      combinedText
    );
    const hasUnaddressedBarrier = /\b(?:waitlist|wait\s*list|cannot\s+afford|unaffordable|no\s+transportation)\b/i.test(
      combinedText
    ) && !/\b(?:alternative\s+referral|subsidized|transit\s+tokens|adjusted\s+plan)\b/i.test(combinedText);
    const rawStatus = hasUnaddressedBarrier ? "PARTIAL_COMPLIANCE" : hasSupportOffer ? "COMPLIANT_ON_AVAILABLE_EVIDENCE" : "NOT_DOCUMENTED_IN_UPLOADED_RECORDS";
    const complianceStatus = enforceMissingDocumentNeutralityGuard({
      proposedStatus: rawStatus,
      hasAffirmativeEvidenceOfConductOrOmission: hasUnaddressedBarrier,
      isSolelyMissingDocumentInUpload: !hasSupportOffer && !hasUnaddressedBarrier
    });
    const authorityId = "CYFSA:94(6)";
    const verificationStatus = verifyMatrixAuthority(
      authorityId,
      "Under CYFSA s. 94(6)(c), s. 101(7)(c), and s. 116(4)(c), the court shall not require a society to provide financial assistance or to purchase any goods or services under supervision terms and conditions, while CAS coordinates community referrals under s. 100(a) and OCPS Standard 7."
    );
    items.push({
      itemId: "MATRIX-ASSIST-01-SUPPORT-AND-FUNDING-BOUNDARY",
      category: "PARENT_ASSISTANCE",
      title: "Parent Support Referrals, Accessibility Monitoring & Statutory Non-Funding Rule",
      authority: {
        authorityId,
        legalSource: "Child, Youth and Family Services Act, 2017, ss. 35(1)(b), 94(6)(c), 100(a), 101(2), 101(7)(c), 116(4)(c); OCPS (2016) Standard 7",
        exactSectionOrStandard: "CYFSA ss. 35(1)(b), 94(6)(c), 100(a), 101(2), 101(7)(c), 116(4)(c); OCPS Standard 7",
        effectiveDate: "2018-04-30",
        legalForce: "STATUTORY_MANDATORY",
        applicabilityConditions: "Applies whenever CAS identifies parenting, mental health, trauma, domestic violence, substance use, or housing needs as relevant to child protection risk or supervision conditions.",
        exceptions: "EXPRESS STATUTORY LIMIT: Under CYFSA ss. 94(6)(c), 101(7)(c), and 116(4)(c), a court SHALL NOT order a society to provide financial assistance or purchase goods or services as a term of supervision."
      },
      obligation: {
        responsibleParty: "CAS_WORKER",
        requiredAction: "Specify in the Plan of Care (s. 100(a)) and OCPS Standard 7 Service Plan the services to be provided to remedy the protection concern, make concrete referrals to publicly funded or accessible community programs, and monitor waitlists or barriers\u2014while recognizing that a court cannot order CAS to purchase private services under ss. 94(6)(c), 101(7)(c), or 116(4)(c).",
        triggeringEvent: "Identification of caregiver support needs during investigation or ongoing service.",
        deadline: "Within the 30-day initial Service Plan cycle (OCPS Standard 7) and ongoing across 6-month case reviews.",
        requiredDocumentation: "Service Plan goals/referrals, referral transmission logs, and case notes documenting accessibility and barrier problem-solving.",
        availableDiscretion: "CAS has operational discretion regarding whether to voluntarily fund an external service from agency budgets, but referrals to accessible community services under the Service Plan are a mandatory OCPS Standard 7 requirement."
      },
      evidence: {
        documentId: docId,
        documentTitle: docTitle,
        page: span.page,
        paragraphOrSpan: span.paragraphOrSpan,
        eventDate: options.documentDate ?? null,
        recordDate: options.documentDate ?? null,
        author: "CAS Worker",
        exactExcerpt: span.excerpt,
        corroboratingEvidence: hasSupportOffer ? ["Uploaded record contains references to services or referrals."] : [],
        contradictoryEvidence: hasUnaddressedBarrier ? ["Uploaded record notes waitlist, cost, or transportation barriers without documented plan adjustment."] : [],
        evidenceLimitations: "Referral letters and collateral intake forms may be stored separately from the uploaded document."
      },
      assessment: {
        applicabilityStatus: "APPLIES",
        complianceStatus,
        reasoning: hasUnaddressedBarrier ? "The uploaded record indicates that a service or expectation was discussed, but accessibility barriers (such as waitlist, cost, or transportation) appear without documented adjustment of the Service Plan. Note that while a court cannot order CAS to purchase private services (CYFSA ss. 94(6)(c), 101(7)(c), 116(4)(c)), OCPS Standard 7 requires coordinating accessible community referrals and monitoring barriers." : hasSupportOffer ? "The uploaded record documents service or referral activity. Confirm whether the referred programs were practically accessible (waitlists, cost, hours, language/cultural fit) and linked to clear behavioural goals." : "Concrete referral records and accessibility assessments for parent support services are not documented in the uploaded excerpt (`NOT_DOCUMENTED_IN_UPLOADED_RECORDS`).",
        missingInformation: [
          "Dates and intake confirmations for each community referral made by CAS",
          "Documentation of waitlist lengths, program cost (OHIP/public vs. private pay), and transportation/scheduling feasibility",
          "Whether the Service Plan distinguished mandatory safety requirements from discretionary recommendations"
        ],
        exceptionsConsidered: [
          "Statutory prohibition on court orders requiring CAS to provide financial assistance or purchase goods or services (CYFSA ss. 94(6)(c), 101(7)(c), 116(4)(c))"
        ],
        sourceVerificationStatus: verificationStatus,
        confidenceOrUncertainty: "High confidence in statutory boundary (ss. 94(6)(c), 101(7)(c), 116(4)(c)) and OCPS Standard 7 referral standards.",
        suggestedFollowUpQuestions: [
          "Which publicly funded or community-accessible programs were referred to address the identified protection concerns?",
          "If a recommended program had a waitlist or private fee, what accessible interim alternative was incorporated into the Service Plan?"
        ],
        potentialOversightPathway: buildOversightPathwaySummary("OVERSIGHT:CFSRB_SERVICE_COMPLAINT_120")
      },
      presentation: {
        educationalMode: {
          whatRuleRequires: "CAS must set out in its Plan of Care and Service Plan what services will help address the protection concerns (CYFSA s. 100(a); OCPS Standard 7) and help connect parents with accessible community programs. At the same time, Ontario law (CYFSA ss. 94(6)(c), 101(7)(c), 116(4)(c)) says a court cannot order CAS to give financial assistance or buy private goods or services under a supervision order.",
          whyItAppliesOrMayNotApply: "This applies whenever CAS expects a parent to complete parenting, mental health, counselling, or addiction programs to safely care for their child.",
          whatDocumentShows: `At Page ${span.page}, ${span.paragraphOrSpan}: "${span.excerpt}"`,
          whatIsMissing: "Details on when referrals were sent, whether the programs were free/publicly funded, how long the waitlist was, and how barriers were handled.",
          questionsToAskNext: [
            "Were publicly funded (free) community referrals made for each program CAS asked the parent to complete?",
            "How did CAS adjust the timeline if the parent was placed on a community waitlist?"
          ]
        },
        courtroomMode: {
          relevantRuleAndAuthority: "Under CYFSA s. 100(a) and s. 101(2), together with OCPS (2016) Standard 7, the society must specify the services to be provided to remedy the protection concern and coordinate referrals to accessible services, subject to the statutory limitation in CYFSA ss. 94(6)(c), 101(7)(c), and 116(4)(c) that a court shall not require the society to provide financial assistance or purchase goods or services.",
          documentedFactAndAttribution: `At Page ${span.page}, ${span.paragraphOrSpan} of ${docTitle}: "${span.excerpt}"`,
          evidentialGapOrInconsistency: "The uploaded record does not fully establish referral transmission dates, waitlist duration, or whether any demanded assessment/treatment required private payment unavailable to the parent.",
          targetedDisclosureOrClarificationRequest: [
            "Request copies of all referral packages transmitted by the society and all collateral responses regarding waitlists and program eligibility.",
            "Clarify which expectations in the Service Plan are mandatory safety requirements versus discretionary recommendations."
          ]
        }
      }
    });
  }
  {
    const span = extractFirstMatchingSpan(
      combinedText,
      [
        /\b(?:service\s+plan|reunification|return\s+of\s+the\s+child|plan\s+of\s+care|status\s+review|12\s+months|24\s+months|case\s+review|access|kinship)\b/i
      ],
      "Ongoing Service Plan timelines, 6-month formal case reviews, and reunification criteria are not fully set out in the uploaded excerpt."
    );
    let std7ComplianceStatus = "NOT_DOCUMENTED_IN_UPLOADED_RECORDS";
    if (standard7DeadlineAssessment.withinThirtyDayStandard === true) {
      std7ComplianceStatus = "COMPLIANT_ON_AVAILABLE_EVIDENCE";
    } else if (standard7DeadlineAssessment.withinThirtyDayStandard === false) {
      std7ComplianceStatus = "POTENTIAL_NONCOMPLIANCE";
    } else if (standard7DeadlineAssessment.deadlineStatus === "DEADLINE_NOT_DETERMINABLE") {
      std7ComplianceStatus = "INSUFFICIENT_EVIDENCE";
    }
    const authorityId = "OCPS:STD_7";
    const verificationStatus = verifyMatrixAuthority(
      authorityId,
      "Under OCPS (2016) Standard 7, the initial Service Plan must be developed with the family within 30 days of completion of the investigation or transfer to ongoing services, with minimum monthly home contact and formal case reviews every 6 months."
    );
    items.push({
      itemId: "MATRIX-REUNIF-01-STD7-AND-S122",
      category: "REUNIFICATION",
      title: "Standard 7 Ongoing Service Plan (30-Day Rule from Investigation Completion/Transfer), 6-Month Reviews & CYFSA s. 122 Time Limits",
      authority: {
        authorityId,
        legalSource: "Ontario Child Protection Standards (2016) Standard 7; Child, Youth and Family Services Act, 2017, ss. 100(b)(i), 104(1), 113(1), 122(1), 122(5)",
        exactSectionOrStandard: "OCPS (2016) Standard 7 (18 Ongoing Case Management Elements); CYFSA ss. 100(b)(i), 104(1), 113(1), 122(1), 122(5)",
        effectiveDate: "2016-01-01",
        legalForce: "MINISTRY_STANDARD_MANDATORY",
        applicabilityConditions: "Applies to all ongoing child protection cases and all cases where a child is in temporary care with a reunification or permanency plan.",
        exceptions: "Departures from the 30-day initial Service Plan timeline require supervisory approval and documented reasons. Under CYFSA s. 122(5), the court may extend the s. 122(1) 12-month (under age 6) or 24-month (age 6+) cumulative time-in-care limit by up to 6 months in the child's best interests."
      },
      obligation: {
        responsibleParty: "CAS_WORKER_AND_SUPERVISOR",
        requiredAction: "Complete the Family and Child Strengths and Needs Assessment and initial Service Plan with parent participation within 30 days of investigation completion or case transfer (never measured from removal date alone); specify clear behavioural goals, responsible persons, timeframes, and reunification conditions (CYFSA s. 100(b)(i)); conduct minimum monthly home visits and formal 6-month case reviews; and track cumulative time in care under CYFSA s. 122(1) (12 months for under 6; 24 months for 6+).",
        triggeringEvent: "Completion of child protection investigation (Standard 6) or transfer of the case to ongoing protection services (Standard 7).",
        deadline: standard7DeadlineAssessment.calculatedDeadlineDate ? `30 days from ${standard7DeadlineAssessment.triggerEventUsed === "CASE_TRANSFER" ? "case transfer" : "investigation completion"} (${standard7DeadlineAssessment.triggerDate}) -> ${standard7DeadlineAssessment.calculatedDeadlineDate}` : "DEADLINE_NOT_DETERMINABLE from uploaded records (requires investigation completion or case transfer date; cannot be calculated from removal date alone).",
        requiredDocumentation: "Family and Child Strengths and Needs Assessment, signed initial Service Plan, 6-month Formal Case Reviews, Risk Reassessments, and court Plan of Care (CYFSA s. 100(b)(i)).",
        availableDiscretion: "Supervisory-approved timeline departures under OCPS Standard 7; discretionary judicial extension of up to 6 months under CYFSA s. 122(5)."
      },
      evidence: {
        documentId: docId,
        documentTitle: docTitle,
        page: span.page,
        paragraphOrSpan: span.paragraphOrSpan,
        eventDate: standard7DeadlineAssessment.triggerDate,
        recordDate: standard7DeadlineAssessment.servicePlanCompletionDate,
        author: "CAS Ongoing Worker & Supervisor",
        exactExcerpt: span.excerpt,
        corroboratingEvidence: [standard7DeadlineAssessment.explanation],
        contradictoryEvidence: [],
        evidenceLimitations: standard7DeadlineAssessment.cautionNote
      },
      assessment: {
        applicabilityStatus: "APPLIES",
        complianceStatus: std7ComplianceStatus,
        reasoning: `${standard7DeadlineAssessment.explanation} Additionally, under CYFSA s. 100(b)(i), where the society intends for a child to return to a parent, the Plan of Care must state the specific changes required before the child can return, and cumulative temporary care is governed by CYFSA s. 122(1) (12 months if under 6; 24 months if 6 or older, subject to a discretionary extension of up to 6 months under s. 122(5)).`,
        missingInformation: [
          ...standard7DeadlineAssessment.deadlineStatus === "DEADLINE_NOT_DETERMINABLE" ? ["Exact date of investigation completion (Standard 6) or transfer to ongoing services (Standard 7)"] : [],
          ...standard7DeadlineAssessment.servicePlanCompletionDate === null ? ["Signed and supervisor-approved initial ongoing Service Plan with completion date"] : [],
          "Family and Child Strengths and Needs Assessment and 6-month Formal Case Reviews",
          "Calculation of cumulative days/months in care under CYFSA s. 122(1)\u2013(2)"
        ],
        exceptionsConsidered: [
          "Supervisory-approved departure from the 30-day Service Plan timeline under OCPS (2016) Standard 7",
          "Discretionary court extension of up to 6 months under CYFSA s. 122(5)"
        ],
        sourceVerificationStatus: verificationStatus,
        confidenceOrUncertainty: standard7DeadlineAssessment.deadlineStatus === "DEADLINE_NOT_DETERMINABLE" ? "DEADLINE_NOT_DETERMINABLE: Trigger date (investigation completion or case transfer) is absent from the uploaded record." : "Deterministic 30-day timeline calculation verified against OCPS (2016) Standard 7.",
        suggestedFollowUpQuestions: [
          "On what exact date was the investigation completed or the file transferred to ongoing services, and on what date was the initial Service Plan approved by a supervisor?",
          "Were the parents invited to participate in developing the Service Plan and provided with a copy under OCPS Standard 7?",
          "What specific, measurable behavioural changes are required for the return of the child under CYFSA s. 100(b)(i)?"
        ],
        potentialOversightPathway: buildOversightPathwaySummary("OVERSIGHT:CAS_INTERNAL_COMPLAINT_119")
      },
      presentation: {
        educationalMode: {
          whatRuleRequires: "Under OCPS (2016) Standard 7, CAS must work with the family to create an initial Service Plan within 30 days of when the investigation ends or the case transfers to ongoing service (not measured from the removal date alone). CAS must also review the plan every 6 months, visit at least monthly, and clearly explain what changes are needed for a child to return home within Ontario's 12-month (under age 6) or 24-month (age 6+) time-in-care limits (CYFSA s. 122(1)).",
          whyItAppliesOrMayNotApply: "This rule applies to every ongoing protection file and reunification plan.",
          whatDocumentShows: `${standard7DeadlineAssessment.explanation} Excerpt (${span.paragraphOrSpan}, Page ${span.page}): "${span.excerpt}"`,
          whatIsMissing: "The exact investigation completion / case transfer date, the signed initial Service Plan, and the 6-month formal case reviews.",
          questionsToAskNext: [
            "What date was the case transferred to ongoing services, and when was the first Service Plan signed?",
            "What exact steps must be completed for the child to return home or for visits to become less supervised?"
          ]
        },
        courtroomMode: {
          relevantRuleAndAuthority: "Pursuant to OCPS (2016) Standard 7 (prescribed by O. Reg. 156/18, s. 1), the initial Service Plan must be completed within 30 days of investigation completion or case transfer, informed by a Family and Child Strengths and Needs Assessment, with formal reviews at least every 6 months. Under CYFSA s. 100(b)(i) and s. 122(1), (5), the Plan of Care must specify the changes required for return of the child within the 12-month (under age 6) or 24-month (age 6+) statutory ceiling (subject to up to a 6-month extension under s. 122(5)).",
          documentedFactAndAttribution: `${standard7DeadlineAssessment.explanation} Reference: Page ${span.page}, ${span.paragraphOrSpan} of ${docTitle} ("${span.excerpt}").`,
          evidentialGapOrInconsistency: standard7DeadlineAssessment.deadlineStatus === "DEADLINE_NOT_DETERMINABLE" ? "The 30-day Standard 7 deadline is `DEADLINE_NOT_DETERMINABLE` on the current record because the investigation completion/transfer trigger date is not disclosed." : standard7DeadlineAssessment.explanation,
          targetedDisclosureOrClarificationRequest: [
            "Request the OCPS Standard 6 Investigation Conclusion / Case Transfer record establishing the trigger date for the 30-day Standard 7 Service Plan.",
            "Request all initial and 6-month revised Service Plans, Family and Child Strengths and Needs Assessments, and Risk Reassessments."
          ]
        }
      }
    });
  }
  {
    const firstContradiction = (report.contradictions || [])[0];
    const span = firstContradiction ? {
      excerpt: `${firstContradiction.claim || ""} vs. ${firstContradiction.counterEvidence || ""}`.trim(),
      page: firstContradiction.sourcePage || 1,
      paragraphOrSpan: firstContradiction.paragraphReference || "Contradiction Span"
    } : extractFirstMatchingSpan(
      combinedText,
      [
        /\b(?:affidavit|sworn|believed|hearsay|informed\s+by|registered\s+social\s+worker|rsw|ocswssw)\b/i
      ],
      "Evaluate whether statements in court materials distinguish personal knowledge from sourced information and belief."
    );
    const hasUnsourcedHearsayIndicator = /\b(?:it\s+was\s+reported\s+that|sources?\s+indicated|concerns?\s+were\s+raised\s+that)\b/i.test(
      combinedText
    );
    const hasContradictions = (report.contradictions || []).length > 0;
    const complianceStatus = hasContradictions || hasUnsourcedHearsayIndicator ? "REQUIRES_LEGAL_REVIEW" : "INSUFFICIENT_EVIDENCE";
    const authorityId = "FLR:14(18)";
    const verificationStatus = verifyMatrixAuthority(
      authorityId,
      "Under Family Law Rules r. 14(18) and r. 14(19), an affidavit shall contain only facts within the personal knowledge of the person signing it unless the source of the information and the fact of belief are specified."
    );
    items.push({
      itemId: "MATRIX-EVID-01-AFFIDAVIT-AND-REGISTRATION",
      category: "EVIDENCE_AND_CONTRADICTIONS",
      title: "Affidavit Personal Knowledge / Sourced Belief Rule (FLR r. 14(18)\u2013(19)) & OCSWSSW Registration Scope",
      authority: {
        authorityId,
        legalSource: "Family Law Rules, O. Reg. 114/99, r. 14(18)\u2013(19); Social Work and Social Service Work Act, 1998, S.O. 1998, c. 31, ss. 46\u201347",
        exactSectionOrStandard: "O. Reg. 114/99, r. 14(18)\u2013(19); SWSSWA 1998, ss. 46\u201347",
        effectiveDate: "1999-09-15",
        legalForce: "COURT_PROCEDURAL_RULE",
        applicabilityConditions: "FLR r. 14(18)\u2013(19) applies to all affidavits filed on motions in child protection proceedings. OCSWSSW standards apply where the worker is a registered member of the College or uses restricted titles ('social worker', 'registered social worker', 'social service worker').",
        exceptions: "Not every CAS child protection worker is statutorily required to be registered with the OCSWSSW unless they use a restricted title or hold themselves out as a social worker / social service worker (SWSSWA ss. 46\u201347). Factual inaccuracies in an affidavit must not be automatically classified as criminal perjury."
      },
      obligation: {
        responsibleParty: "CAS_WORKER",
        requiredAction: "Confine affidavit evidence to facts within the affiant's personal knowledge or, on a motion, clearly specify the named source of information and the fact of belief (FLR r. 14(18)\u2013(19)); separate direct observation from opinion; and accurately state professional credentials and OCSWSSW registration status if applicable.",
        triggeringEvent: "Swearing/affirming a child protection affidavit or recording formal evidentiary statements.",
        deadline: "At the time of commissioning and filing the affidavit or record.",
        requiredDocumentation: "Sworn/affirmed affidavit identifying direct observations vs. named collateral sources, commissioned jurat, and accurate professional title.",
        availableDiscretion: "None regarding compliance with the rules of evidence and truthful commissioning."
      },
      evidence: {
        documentId: docId,
        documentTitle: docTitle,
        page: span.page,
        paragraphOrSpan: span.paragraphOrSpan,
        eventDate: options.documentDate ?? null,
        recordDate: options.documentDate ?? null,
        author: "Affiant / Record Author",
        exactExcerpt: span.excerpt,
        corroboratingEvidence: [],
        contradictoryEvidence: (report.contradictions || []).map(
          (c) => `${c.claim || "Claim"} <-> ${c.counterEvidence || "Counter-evidence"}`
        ),
        evidenceLimitations: "Factual disputes between an affidavit and primary records require cross-reference against primary case notes and collateral records; do not label disputed statements as perjury."
      },
      assessment: {
        applicabilityStatus: "APPLIES",
        complianceStatus,
        reasoning: "Under Family Law Rules r. 14(18)\u2013(19), affidavit statements relying on third-party information must identify the source of the information and the fact of belief, and factual summaries must align with contemporaneous primary case notes. Additionally, verify on the OCSWSSW Public Register whether the worker is a registered member before applying OCSWSSW professional discipline rules (SWSSWA ss. 46\u201347), and remember there is no universal statutory 'CAS worker oath' beyond standard court/affidavit oaths and confidentiality undertakings.",
        missingInformation: [
          "Underlying contemporaneous case notes and collateral records for each second-hand statement in the document",
          "Confirmation of whether the author is registered on the OCSWSSW Public Register"
        ],
        exceptionsConsidered: [
          "Information-and-belief evidence is permissible on a motion under FLR r. 14(19) when both the source of information and fact of belief are explicitly stated",
          "Non-registered CAS workers who do not use restricted titles under SWSSWA ss. 46\u201347 are governed by CYFSA, OCPS (2016), and internal CAS accountability rather than OCSWSSW discipline"
        ],
        sourceVerificationStatus: verificationStatus,
        confidenceOrUncertainty: "High confidence in FLR r. 14(18)\u2013(19) and SWSSWA ss. 46\u201347 legal standards; evidentiary weight of specific disputed passages is a matter for legal review and the court.",
        suggestedFollowUpQuestions: [
          "For each disputed or second-hand assertion, who is the exact named source of the information and what is the date of the underlying primary note?",
          "Is the worker who authored the record registered with the OCSWSSW on the Public Register?"
        ],
        potentialOversightPathway: buildOversightPathwaySummary("OVERSIGHT:COURT_PROCEDURAL_AND_EVIDENTIARY_REMEDIES")
      },
      presentation: {
        educationalMode: {
          whatRuleRequires: "When a CAS worker signs a court affidavit, Ontario's Family Law Rules (Rule 14(18)\u2013(19)) say they must stick to what they personally saw or heard, or clearly name who told them the information and state that they believe it. Also, while there is no special universal 'CAS worker oath,' workers who use the title 'Social Worker' must be registered with the OCSWSSW.",
          whyItAppliesOrMayNotApply: "Rule 14(18)\u2013(19) applies to all court affidavits. OCSWSSW rules apply only if the worker is registered with the College or uses a protected social work title.",
          whatDocumentShows: `At Page ${span.page}, ${span.paragraphOrSpan}: "${span.excerpt}"`,
          whatIsMissing: "The original case notes or third-party reports behind summary claims, and confirmation of whether the worker is registered with the OCSWSSW.",
          questionsToAskNext: [
            "Which statements did the worker observe firsthand, and which ones came from someone else?",
            "Do the original case notes match how the event is described in the summary or affidavit?"
          ]
        },
        courtroomMode: {
          relevantRuleAndAuthority: "Pursuant to Family Law Rules, O. Reg. 114/99, r. 14(18)\u2013(19), an affidavit shall contain only facts within the personal knowledge of the affiant unless, on a motion, the source of the information and the fact of belief are specified. Professional regulatory jurisdiction under the Social Work and Social Service Work Act, 1998, ss. 46\u201347 depends on registration status or restricted title use.",
          documentedFactAndAttribution: `At Page ${span.page}, ${span.paragraphOrSpan} of ${docTitle}: "${span.excerpt}"`,
          evidentialGapOrInconsistency: hasContradictions ? `${(report.contradictions || []).length} internal or documentary tension(s) identified for verification against primary records.` : "Verify that all second-hand assertions comply with the source-attribution requirement of FLR r. 14(19) and align with contemporaneous case notes.",
          targetedDisclosureOrClarificationRequest: [
            "Request the primary contemporaneous case notes and third-party source records underlying each contested paragraph.",
            "Where second-hand statements do not identify the source and fact of belief under FLR r. 14(19), seek clarification or evidentiary review by counsel."
          ]
        }
      }
    });
  }
  const parentAssistanceAnalyses = [
    evaluateParentAssistanceNeed15Questions({
      needId: "PA-NEED-01-PARENTING-AND-PRESERVATION",
      identifiedNeedTitle: "Parenting Support, In-Home Family Preservation & Less Disruptive Alternatives",
      domain: "B2_PARENTING_SUPPORT",
      sourceText: combinedText,
      legalForceClassification: "STANDARDS_BASED",
      relevantPatterns: [
        /\b(?:parenting|supervision|in-home\s+support|family\s+preservation|service\s+plan|less\s+disruptive)\b/i
      ]
    }),
    evaluateParentAssistanceNeed15Questions({
      needId: "PA-NEED-02-MENTAL-HEALTH-TRAUMA-ADDICTIONS",
      identifiedNeedTitle: "Mental Health, Trauma, Domestic Violence & Substance Use Support",
      domain: "B3_MENTAL_HEALTH_AND_ADDICTIONS",
      sourceText: combinedText,
      legalForceClassification: "STANDARDS_BASED",
      relevantPatterns: [
        /\b(?:mental\s+health|counselling|therapy|trauma|domestic\s+violence|substance|addiction|relapse|treatment)\b/i
      ]
    }),
    evaluateParentAssistanceNeed15Questions({
      needId: "PA-NEED-03-HOUSING-KINSHIP-AND-CONTACT",
      identifiedNeedTitle: "Housing/Basic Necessities Navigation, Kinship Placement & Parent-Child Contact",
      domain: "B5_KINSHIP_AND_FAMILY_NETWORKS",
      sourceText: combinedText,
      legalForceClassification: "LEGALLY_REQUIRED",
      relevantPatterns: [
        /\b(?:housing|rent|shelter|poverty|kinship|relative|grandmother|aunt|access|visit(?:ation|s)?|contact)\b/i
      ]
    })
  ];
  const summaryCounts = {
    totalItemsEvaluated: items.length,
    compliantOnAvailableEvidenceCount: items.filter(
      (i) => i.assessment.complianceStatus === "COMPLIANT_ON_AVAILABLE_EVIDENCE"
    ).length,
    potentialNoncomplianceCount: items.filter(
      (i) => i.assessment.complianceStatus === "POTENTIAL_NONCOMPLIANCE"
    ).length,
    partialComplianceCount: items.filter(
      (i) => i.assessment.complianceStatus === "PARTIAL_COMPLIANCE"
    ).length,
    notDocumentedInUploadedRecordsCount: items.filter(
      (i) => i.assessment.complianceStatus === "NOT_DOCUMENTED_IN_UPLOADED_RECORDS"
    ).length,
    insufficientEvidenceCount: items.filter(
      (i) => i.assessment.complianceStatus === "INSUFFICIENT_EVIDENCE"
    ).length,
    notApplicableCount: items.filter(
      (i) => i.assessment.complianceStatus === "NOT_APPLICABLE"
    ).length,
    exceptionMayApplyCount: items.filter(
      (i) => i.assessment.complianceStatus === "EXCEPTION_MAY_APPLY"
    ).length,
    requiresLegalReviewCount: items.filter(
      (i) => i.assessment.complianceStatus === "REQUIRES_LEGAL_REVIEW"
    ).length,
    byCategory: {
      LAW_AND_PROCEDURE: items.filter((i) => i.category === "LAW_AND_PROCEDURE").length,
      CAS_ACCOUNTABILITY: items.filter((i) => i.category === "CAS_ACCOUNTABILITY").length,
      PARENT_ASSISTANCE: items.filter((i) => i.category === "PARENT_ASSISTANCE").length,
      REUNIFICATION: items.filter((i) => i.category === "REUNIFICATION").length,
      EVIDENCE_AND_CONTRADICTIONS: items.filter(
        (i) => i.category === "EVIDENCE_AND_CONTRADICTIONS"
      ).length
    }
  };
  return {
    matrixVersion: "2.0.0",
    generatedAtIso: (/* @__PURE__ */ new Date()).toISOString(),
    documentTitle: docTitle,
    standard7DeadlineAssessment,
    caseNoteCompletenessSummary: {
      presentElementsCount: caseNoteEval.presentElements.length,
      missingElementsCount: caseNoteEval.missingElements.length,
      missingElementCodes: caseNoteEval.missingElements,
      distinctionNote: caseNoteEval.distinctionNote
    },
    items,
    parentAssistanceAnalyses,
    parentAssistanceAnalysis: parentAssistanceAnalyses[0],
    summaryCounts,
    neutralityAndMethodologyDisclaimer: "NEUTRAL LEGAL INTELLIGENCE NOTICE: This Agency Compliance & Evidence Matrix compares verified Ontario statutory and operational authorities against the uploaded document excerpts. It does not presume either that CAS complied or that CAS committed wrongdoing. Where records are absent from an upload, the item is classified as NOT_DOCUMENTED_IN_UPLOADED_RECORDS or INSUFFICIENT_EVIDENCE rather than a confirmed breach. Review all findings with qualified Ontario child protection legal counsel.",
    missingRecordsWarning: "NEUTRAL LEGAL INTELLIGENCE NOTICE: This Agency Compliance & Evidence Matrix compares verified Ontario statutory and operational authorities against the uploaded document excerpts. It does not presume either that CAS complied or that CAS committed wrongdoing. Where records are absent from an upload, the item is classified as NOT_DOCUMENTED_IN_UPLOADED_RECORDS or INSUFFICIENT_EVIDENCE rather than a confirmed breach. Review all findings with qualified Ontario child protection legal counsel."
  };
}

// api/services/analyzerSections.ts
var EVIDENCE_CLASSIFICATIONS = [
  "DIRECT",
  "DOCUMENTARY",
  "CORROBORATED",
  "HEARSAY",
  "INFERENCE",
  "OPINION",
  "UNSUPPORTED",
  "UNCLEAR"
];
var SEVERITIES = ["Affects Evidentiary Weight", "Worth Raising With Counsel", "CRITICAL"];
var SEVERITY_RANK = {
  "Affects Evidentiary Weight": 1,
  "Worth Raising With Counsel": 2,
  CRITICAL: 3
};
var CANONICAL_DISCLAIMER = "This document is generated for informational/educational purposes only. It does not constitute legal advice or representation. Please consult a lawyer licensed by the Law Society of Ontario, or contact Legal Aid Ontario, before relying on any conclusion in this report.";
var UNVERIFIED_CITATION_NOTE = "\u26A0\uFE0F Statute citation unverified \u2014 confirm exact section with counsel before relying on this.";
var ESI_COMPONENT_MAX = {
  firsthandKnowledge: 20,
  sourceReliability: 15,
  corroboration: 15,
  documentarySupport: 15,
  internalConsistency: 10,
  contradictoryEvidenceHandling: 10,
  legalAuthorityVerification: 10,
  proceduralDocumentation: 5
};
function str(v, fallback = "") {
  if (typeof v === "string") return v.trim();
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  if (v && typeof v === "object") {
    const obj = v;
    const candidate = obj.text || obj.issue || obj.description || obj.point || obj.item || obj.summary || obj.question || obj.assertion || obj.evaluation || obj.content;
    if (typeof candidate === "string" && candidate.trim()) return candidate.trim();
    const joined = Object.values(obj).filter((val) => typeof val === "string" && val.trim()).join(" \u2014 ");
    if (joined.trim()) return joined.trim();
  }
  return fallback;
}
function toStrList(v, max, altKeys) {
  if (Array.isArray(v)) {
    const res = v.map((x) => str(x)).filter(Boolean).slice(0, max);
    if (res.length > 0) return res;
  }
  if (typeof v === "string" && v.trim()) {
    const lines = v.split(/\r?\n|[•\-]\s+|\d+\.\s+/).map((s) => s.trim()).filter(Boolean);
    if (lines.length > 0) return lines.slice(0, max);
    return [v.trim()];
  }
  if (altKeys && altKeys.length > 0) {
    for (const alt of altKeys) {
      const res = toStrList(alt, max);
      if (res.length > 0) return res;
    }
  }
  return [];
}
function strList(v, max) {
  return toStrList(v, max);
}
function clampInt(v, min, max) {
  const n = Math.round(Number(v));
  if (!Number.isFinite(n)) return min;
  return Math.min(max, Math.max(min, n));
}
function normalizeClassification(v) {
  const up = str(v).toUpperCase();
  return EVIDENCE_CLASSIFICATIONS.includes(up) ? up : "UNCLEAR";
}
function normalizeSeverity(v) {
  const s = str(v).replace(/^\[|\]$/g, "").trim();
  const match = SEVERITIES.find((x) => x.toLowerCase() === s.toLowerCase());
  return match || "Worth Raising With Counsel";
}
function normalizeIsMet(v) {
  const s = str(v).toLowerCase();
  if (s.startsWith("yes")) return "Yes";
  if (s.startsWith("no") && !s.startsWith("not")) return "No";
  if (s.includes("not determinable")) return "Not Determinable From This Document";
  return "Inconclusive";
}
function validateOverview(raw) {
  const problems = [];
  const fileSummary = str(raw?.fileSummary);
  if (fileSummary.length < 40) problems.push("fileSummary is missing or too short");
  const md = raw?.metadata && typeof raw.metadata === "object" ? raw.metadata : {};
  const esiRaw = raw?.evidenceStrengthIndex && typeof raw.evidenceStrengthIndex === "object" ? raw.evidenceStrengthIndex : {};
  if (problems.length) return { ok: false, problems };
  const compSource = esiRaw && typeof esiRaw.components === "object" && esiRaw.components !== null ? esiRaw.components : esiRaw || {};
  const components = {};
  let sum = 0;
  for (const [name, max] of Object.entries(ESI_COMPONENT_MAX)) {
    const c = compSource?.[name] || {};
    const score = clampInt(c.score, 0, max);
    sum += score;
    components[name] = { score, max, explanation: str(c.explanation) };
  }
  return {
    ok: true,
    value: {
      documentTitle: str(raw.documentTitle) || "Uploaded Document",
      documentType: str(raw.documentType) || "Unclassified document",
      metadata: {
        fileNumber: str(md.fileNumber),
        applicantName: str(md.applicantName),
        respondentName: str(md.respondentName),
        childNames: str(md.childNames),
        hearingDate: str(md.hearingDate)
      },
      // The disclaimer is fixed text; never trust a model-written variant of it.
      disclaimer: CANONICAL_DISCLAIMER,
      completenessScore: clampInt(raw.completenessScore, 0, 100),
      completenessScoreMethod: str(raw.completenessScoreMethod),
      evidenceStrengthIndex: {
        score: sum,
        // the published method: the score is the sum of the components, never invented
        scale: "0-100",
        label: "Evidence Strength Index",
        method: str(esiRaw.method) || "Calculated from the documented evidence in this file only.",
        components,
        calculation: "The final score equals the sum of the eight component scores.",
        limitations: str(esiRaw.limitations)
      },
      fileSummary
    }
  };
}
function validateRedFlags(raw, mode) {
  if (!Array.isArray(raw?.redFlags)) return { ok: false, problems: ["redFlags must be an array"] };
  const max = mode === "fast" ? 6 : 10;
  const flags = raw.redFlags.filter((f) => f && typeof f === "object").map((f, i) => ({
    id: str(f.id) || `rf${i + 1}`,
    severity: normalizeSeverity(f.severity),
    category: str(f.category) || "Unclassified",
    evidenceClassification: normalizeClassification(f.evidenceClassification),
    phraseDetected: str(f.phraseDetected || f.quote || f.quotedText || f.phrase || f.quoteText),
    explanation: str(f.explanation || f.analysis || f.reasoning || f.details || f.concern),
    verifyRequirement: str(f.verifyRequirement),
    legalReference: str(f.legalReference),
    locationInDocument: str(f.locationInDocument),
    parentActionStep: str(f.parentActionStep)
  })).filter((f) => f.phraseDetected && f.explanation).slice(0, max);
  if (raw.redFlags.length > 0 && flags.length === 0) {
    return { ok: false, problems: ["every red flag was missing its exact quote (phraseDetected) or explanation"] };
  }
  let seenCritical = false;
  for (const f of flags) {
    if (f.severity === "CRITICAL") {
      if (seenCritical) f.severity = "Worth Raising With Counsel";
      seenCritical = true;
    }
  }
  return { ok: true, value: { redFlags: flags } };
}
function validateChronology(raw, mode) {
  if (!Array.isArray(raw?.chronology)) return { ok: false, problems: ["chronology must be an array"] };
  const chronology = raw.chronology.filter((e) => e && typeof e === "object" && str(e.event)).map((e) => ({
    date: str(e.date) || "Undated",
    event: str(e.event),
    locationInDocument: str(e.locationInDocument),
    evidenceClassification: normalizeClassification(e.evidenceClassification)
  })).slice(0, mode === "fast" ? 15 : 25);
  const contradictions = Array.isArray(raw?.contradictions) ? raw.contradictions.filter((c) => c && typeof c === "object" && str(c.description)).map((c) => ({
    description: str(c.description),
    locations: strList(c.locations, 6),
    significance: str(c.significance)
  })).slice(0, 8) : [];
  return { ok: true, value: { chronology, contradictions } };
}
function validateGuidance(raw) {
  const value = {
    whatToVerify: toStrList(raw?.whatToVerify, 6, [raw?.verificationSteps, raw?.verify]),
    whatToAskALawyer: toStrList(raw?.whatToAskALawyer, 6, [raw?.questionsForCounsel, raw?.questionsForLawyer, raw?.askALawyer]),
    whatIsMissing: toStrList(raw?.whatIsMissing, 6, [raw?.missingEvidence, raw?.missingInformation, raw?.missingDocuments]),
    lawyerCaseBrief: toStrList(raw?.lawyerCaseBrief, 6, [raw?.caseBrief, raw?.brief, raw?.summaryForCounsel])
  };
  const empty = Object.entries(value).filter(([, v]) => v.length === 0).map(([k]) => k);
  if (empty.length) return { ok: false, problems: empty.map((k) => `${k} is empty`) };
  return { ok: true, value };
}
var CANONICAL_THRESHOLDS = [
  {
    match: /81/i,
    thresholdChecked: "CYFSA s. 81 \u2014 Application / Child Protection Proceeding Authority",
    primarySourceLaw: "CYFSA, 2017, S.O. 2017, c. 14, Sched. 1, s. 81(1)"
  },
  {
    match: /74/i,
    thresholdChecked: "Child in Need of Protection grounds (CYFSA s. 74)",
    primarySourceLaw: "CYFSA, 2017, S.O. 2017, c. 14, Sched. 1, s. 74(2)"
  },
  {
    match: /125/i,
    thresholdChecked: "Duty to Report standard vs Direct evidence (CYFSA s. 125)",
    primarySourceLaw: "CYFSA, 2017, S.O. 2017, c. 14, Sched. 1, s. 125(1)"
  },
  {
    match: /kinship|alternative/i,
    thresholdChecked: "Kinship / Family-Based Alternatives \u2014 Documentation Check",
    primarySourceLaw: "CYFSA, 2017, S.O. 2017, c. 14, Sched. 1, s. 101(3)"
  }
];
function validateThresholds(raw) {
  const rawList = Array.isArray(raw?.thresholdAnalysis) ? raw.thresholdAnalysis : Array.isArray(raw?.thresholds) ? raw.thresholds : Array.isArray(raw?.statutoryThresholds) ? raw.statutoryThresholds : [];
  const items = rawList.filter((t) => t && typeof t === "object" && (str(t.thresholdChecked) || str(t.name) || str(t.threshold)) && (str(t.reasoning) || str(t.evaluation) || str(t.notes))).map((t) => {
    const isMet = normalizeIsMet(t.isMet);
    const evalStatus = isMet === "Yes" ? "EVALUATED_SUPPORTED" : isMet === "No" ? "EVALUATED_CONCERN" : isMet === "Not Applicable" ? "NOT_APPLICABLE" : "NOT_DETERMINABLE";
    return {
      thresholdChecked: str(t.thresholdChecked || t.name || t.threshold),
      isMet,
      evaluationStatus: t.evaluationStatus || evalStatus,
      isSystemPlaceholder: Boolean(t.isSystemPlaceholder ?? false),
      reasoning: str(t.reasoning || t.evaluation || t.notes),
      primarySourceLaw: str(t.primarySourceLaw || t.citation || "CYFSA 2017")
    };
  });
  if (items.length < 4) {
    for (const canon of CANONICAL_THRESHOLDS) {
      if (items.length >= 4) break;
      if (!items.some((i) => canon.match.test(i.thresholdChecked))) {
        items.push({
          thresholdChecked: canon.thresholdChecked,
          isMet: "Not Determinable From This Document",
          evaluationStatus: "NOT_EVALUATED",
          isSystemPlaceholder: true,
          reasoning: "Not specifically addressed or determinable in this document filing; retained from standard CYFSA statutory checklist.",
          primarySourceLaw: canon.primarySourceLaw
        });
      }
    }
  }
  return { ok: true, value: { thresholdAnalysis: items.slice(0, 6) } };
}
var CANONICAL_TIMELINES = [
  {
    match: /30-day|adjournment|94\(1\)/i,
    timelineRule: "30-Day Adjournment Limit (CYFSA s. 94(1))",
    citation: "CYFSA, S.O. 2017, c. 14, s. 94(1)"
  },
  {
    match: /hearing|apprehension|warrant|88/i,
    timelineRule: "Court hearing timeline following apprehension without warrant (CYFSA s. 88)",
    citation: "CYFSA, S.O. 2017, c. 14, s. 88"
  },
  {
    match: /ombudsman|care rights|bill 188|bill 33|9\.1/i,
    timelineRule: "Child Ombudsman Access & Continuous Care Rights (CYFSA s. 9.1)",
    citation: "CYFSA, S.O. 2017, c. 14, s. 9.1"
  },
  {
    match: /300-day|parentage|presumption/i,
    timelineRule: "300-Day Presumption of Parentage",
    citation: "\u26A0\uFE0F Statute citation unverified \u2014 confirm exact section with counsel before relying on this."
  }
];
var CANONICAL_CHARTER = [
  "Section 7 (Canadian Charter): Rights to life, liberty, and security of the person considerations.",
  "Section 15 (Canadian Charter): Equality and non-discrimination considerations.",
  "Mandatory Consideration of Indigenous, First Nations, Inuit, or M\xE9tis Heritage (CYFSA Section 2)."
];
function validateTimeline(raw) {
  const rawTimeline = Array.isArray(raw?.proceduralTimelineViolations) ? raw.proceduralTimelineViolations : Array.isArray(raw?.timeline) ? raw.timeline : Array.isArray(raw?.timelineViolations) ? raw.timelineViolations : Array.isArray(raw?.proceduralViolations) ? raw.proceduralViolations : [];
  const items = rawTimeline.filter((t) => t && typeof t === "object" && (str(t.timelineRule) || str(t.rule) || str(t.name)) && (str(t.evaluation) || str(t.reasoning) || str(t.notes))).map((t) => ({
    timelineRule: str(t.timelineRule || t.rule || t.name),
    documentAssertion: str(t.documentAssertion || t.assertion || "Not explicitly documented"),
    evaluation: str(t.evaluation || t.reasoning || t.notes),
    evaluationStatus: t.evaluationStatus || "EVALUATED_SUPPORTED",
    isSystemPlaceholder: Boolean(t.isSystemPlaceholder ?? false),
    citation: str(t.citation || "CYFSA"),
    locationInDocument: str(t.locationInDocument || "Checked & Compliant"),
    parentActionStep: str(t.parentActionStep || "Review timeline adherence with legal counsel.")
  }));
  if (items.length < 4) {
    for (const canon of CANONICAL_TIMELINES) {
      if (items.length >= 4) break;
      if (!items.some((i) => canon.match.test(i.timelineRule))) {
        items.push({
          timelineRule: canon.timelineRule,
          documentAssertion: "No specific statutory violation or exception documented.",
          evaluation: "Not determinable or not asserted in the provided document record.",
          evaluationStatus: "NOT_EVALUATED",
          isSystemPlaceholder: true,
          citation: canon.citation,
          locationInDocument: "Checked & Compliant",
          parentActionStep: "Confirm statutory procedural deadlines with legal counsel."
        });
      }
    }
  }
  const charterRaw = raw?.charterAndHumanRightsIssues ?? raw?.charterIssues ?? raw?.humanRightsIssues;
  const charter = toStrList(charterRaw, 6);
  for (let i = charter.length; i < 3; i++) {
    charter.push(CANONICAL_CHARTER[i] || "No additional charter issues determinable from this record.");
  }
  return { ok: true, value: { proceduralTimelineViolations: items.slice(0, 6), charterAndHumanRightsIssues: charter } };
}
var CHRONOLOGY_SCHEMA = `"chronology": [
  {
    "date": "Date exactly as written in the document (e.g. 'March 3, 2026'), or 'Undated' with the nearest sequence marker",
    "event": "One sentence describing what the document says happened. Attribute it (e.g. 'Worker states...') rather than presenting it as established fact.",
    "locationInDocument": "Page X, Paragraph Y",
    "evidenceClassification": "One of: DIRECT, DOCUMENTARY, CORROBORATED, HEARSAY, INFERENCE, OPINION, UNSUPPORTED, UNCLEAR"
  }
],
"contradictions": [
  {
    "description": "Two statements in THIS document that cannot both be accurate, described neutrally. Only include genuine internal inconsistencies.",
    "locations": ["Page X, Paragraph Y", "Page X, Paragraph Z"],
    "significance": "Why the inconsistency matters to evidentiary weight, and what record could resolve it."
  }
]`;
var SECTION_SPECS = {
  overview: {
    key: "overview",
    title: "Document summary and Evidence Strength Index",
    stage: "reviewing_evidence",
    fields: [
      "documentTitle",
      "documentType",
      "metadata",
      "disclaimer",
      "completenessScore",
      "completenessScoreMethod",
      "evidenceStrengthIndex",
      "fileSummary"
    ],
    maxTokens: { fast: 3500, full: 8e3 },
    limits: () => "fileSummary: 5-8 sentences. Each Evidence Strength Index component explanation: at most 2 sentences.",
    validate: (raw) => validateOverview(raw)
  },
  redFlags: {
    key: "redFlags",
    title: "Evidence findings",
    stage: "reviewing_evidence",
    fields: ["redFlags"],
    maxTokens: { fast: 5e3, full: 8192 },
    limits: (mode) => `At most ${mode === "fast" ? 6 : 10} red flags - choose the most significant. Each explanation: 3-5 sentences. phraseDetected must be copied verbatim from the document (an exact, contiguous passage); never paraphrase inside it. If the document contains no red flags, return an empty array.`,
    validate: (raw, mode) => validateRedFlags(raw, mode)
  },
  chronology: {
    key: "chronology",
    title: "Chronology and contradictions",
    stage: "building_chronology",
    fields: [],
    extraSchema: CHRONOLOGY_SCHEMA,
    maxTokens: { fast: 3500, full: 5e3 },
    limits: (mode) => `chronology: at most ${mode === "fast" ? 15 : 25} entries in date order, each one sentence. contradictions: at most 8; return [] if there are none.`,
    validate: (raw, mode) => validateChronology(raw, mode)
  },
  guidance: {
    key: "guidance",
    title: "Preparation guidance and questions for counsel",
    stage: "preparing_report",
    fields: ["whatToVerify", "whatToAskALawyer", "whatIsMissing", "lawyerCaseBrief"],
    maxTokens: { fast: 3500, full: 4e3 },
    limits: () => "Each list: 3-5 items. Each item: at most 3 sentences.",
    validate: (raw) => validateGuidance(raw)
  },
  thresholds: {
    key: "thresholds",
    title: "CYFSA statutory thresholds",
    stage: "identifying_legal_issues",
    fields: ["thresholdAnalysis"],
    maxTokens: { fast: 4e3, full: 4500 },
    limits: () => "Exactly the 4 checkpoints listed, in that order. Each reasoning: 3-5 sentences.",
    validate: (raw) => validateThresholds(raw)
  },
  timeline: {
    key: "timeline",
    title: "Procedural timelines and Charter issues",
    stage: "identifying_legal_issues",
    fields: ["proceduralTimelineViolations", "charterAndHumanRightsIssues"],
    maxTokens: { fast: 5e3, full: 5e3 },
    limits: () => "proceduralTimelineViolations: exactly the 4 checkpoints listed, each evaluation 2-3 sentences. charterAndHumanRightsIssues: exactly 3 items, each 2-3 sentences.",
    validate: (raw) => validateTimeline(raw)
  }
};
var QUICK_SECTIONS = ["overview", "redFlags", "chronology", "guidance"];
var FORENSIC_SECTIONS = ["overview", "redFlags", "chronology", "guidance", "thresholds", "timeline"];
function sectionTitle(key) {
  return SECTION_SPECS[key]?.title || key;
}
function buildSectionPrompt(key, mode, documentText, retryNote) {
  const spec = SECTION_SPECS[key];
  const schemaParts = spec.fields.map((f) => FIELD_SCHEMAS[f]).filter(Boolean);
  if (spec.extraSchema) schemaParts.push(spec.extraSchema);
  return [
    "<document>",
    "DOCUMENT TEXT CONTENT:",
    documentText,
    "</document>",
    "",
    `TASK: Produce ONLY the "${spec.title}" section of an educational CYFSA evidence audit of the document above. Other sections of the report are produced separately, so include only the keys shown below.`,
    "",
    "Return exactly one JSON object - no markdown fences, no commentary before or after it - with these keys. The text inside each value describes what to write; replace it with your analysis of this document:",
    "{",
    schemaParts.join(",\n"),
    "}",
    "",
    `LIMITS: ${spec.limits(mode)}`,
    "Every direct quotation must be copied verbatim from the document. Never present your own interpretation as a quotation.",
    retryNote ? `
CORRECTION REQUIRED: ${retryNote}` : ""
  ].join("\n");
}
function repairJsonText(text) {
  let out = "";
  let inString = false;
  let escaped = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === '"') inString = false;
      else if (ch === "\n") {
        out += "\\n";
        continue;
      } else if (ch === "\r") {
        out += "\\r";
        continue;
      } else if (ch === "	") {
        out += "\\t";
        continue;
      }
      out += ch;
      continue;
    }
    if (ch === '"') inString = true;
    if (ch === ",") {
      let j = i + 1;
      while (j < text.length && /\s/.test(text[j])) j++;
      if (text[j] === "}" || text[j] === "]") continue;
    }
    out += ch;
  }
  return out;
}
function parseJsonLenient(text) {
  try {
    return JSON.parse(text);
  } catch {
    return JSON.parse(repairJsonText(text));
  }
}
function parseJsonObject(text) {
  if (!text) return null;
  let t = text.trim();
  const fenced = t.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced) t = fenced[1].trim();
  const start = t.indexOf("{");
  if (start < 0) return null;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < t.length; i++) {
    const ch = t[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) {
        try {
          return parseJsonLenient(t.slice(start, i + 1));
        } catch {
          return null;
        }
      }
    }
  }
  return null;
}
var SEVERITY_CAP_REASON = {
  ABSENT: "The quoted passage could not be located in the uploaded text, so the severity is limited until it is found.",
  AMBIGUOUS: "The quoted wording appears in more than one place, so the severity is limited until the passage is confirmed.",
  CASE_OR_PUNCTUATION_VARIANT: "The quoted wording does not match the document exactly, so the severity is limited until it is checked."
};
var VERIFICATION_NOTE = {
  ABSENT: "The quoted passage could not be located in the uploaded document. This point is the analyzer's reading, not a located passage. Treat it as an unverified allegation.",
  AMBIGUOUS: "The quoted wording appears in more than one place. Confirm which passage this point refers to.",
  CASE_OR_PUNCTUATION_VARIANT: "The quoted wording differs from the document in capitalisation or punctuation. Check the passage before relying on this point."
};
var CORROBORATION_LABELS = /* @__PURE__ */ new Set(["CORROBORATED", "DOCUMENTARY", "DIRECT"]);
function guardCitation(text, options) {
  const t = str(text);
  const normalizedOptions = typeof options === "string" ? { proposition: options } : options;
  const c = classifyCitation(t);
  const auth = resolveLegalAuthority(t, normalizedOptions);
  const authorityResolution = auth.status === "VERIFIED" && auth.entry ? {
    id: auth.entry.id,
    category: auth.entry.category,
    citation: auth.entry.citation,
    heading: auth.entry.heading,
    sourceUrl: auth.entry.sourceUrl,
    exactWording: auth.entry.exactWording,
    practiceNote: auth.entry.practiceNote,
    verificationSourceType: auth.entry.verificationSourceType
  } : void 0;
  if (auth.status === "INAPPLICABLE") {
    return {
      text: /unverified/i.test(t) ? t : `${t} ${UNVERIFIED_CITATION_NOTE}`,
      status: "UNVERIFIED",
      identifiedAct: c.identifiedAct,
      reason: auth.warningText || c.reason,
      authorityId: auth.entry?.id,
      authorityResolution: void 0
    };
  }
  if (c.status === "UNVERIFIED" && !/unverified/i.test(t)) {
    return {
      text: `${t} ${UNVERIFIED_CITATION_NOTE}`,
      status: "UNVERIFIED",
      identifiedAct: c.identifiedAct,
      reason: c.reason,
      authorityId: auth.entry?.id,
      authorityResolution
    };
  }
  return {
    text: t,
    status: c.status,
    identifiedAct: c.identifiedAct,
    reason: c.reason,
    authorityId: auth.entry?.id,
    authorityResolution
  };
}
function applyReportGuards(report, sourceText) {
  for (const flag of Array.isArray(report.redFlags) ? report.redFlags : []) {
    if (!flag || typeof flag !== "object") continue;
    if (flag.modelSeverity === void 0) flag.modelSeverity = flag.severity;
    const loc = locateQuote(sourceText, flag.phraseDetected);
    flag.quoteVerification = loc.status;
    flag.quoteVerified = isVerbatimQuoteStatus(loc.status);
    flag.verificationStatus = VERIFICATION_STATUS[loc.status];
    flag.quoteLocation = { page: loc.page, startOffset: loc.startOffset, endOffset: loc.endOffset };
    const ceiling = severityCeiling(loc.status);
    const current = typeof flag.severity === "string" ? flag.severity : "";
    if (current && (SEVERITY_RANK[current] ?? 0) > SEVERITY_RANK[ceiling]) {
      flag.severity = ceiling;
      flag.severityCapReason = SEVERITY_CAP_REASON[loc.status];
    }
    const note = VERIFICATION_NOTE[loc.status];
    if (note) flag.verificationNote = note;
    if (loc.status === "ABSENT" && CORROBORATION_LABELS.has(flag.evidenceClassification)) {
      flag.classificationCaveat = `The analyzer labelled this point ${flag.evidenceClassification}, but the passage behind that label was not located. It is not shown as corroborated.`;
    }
    const g = guardCitation(flag.legalReference, { proposition: flag.explanation });
    flag.legalReference = g.text;
    flag.citationStatus = g.status;
    flag.citationReason = g.reason;
    flag.identifiedAct = g.identifiedAct;
    if (g.authorityId) flag.authorityId = g.authorityId;
  }
  applyCitationGuards(report);
  if (!report.complianceMatrix) {
    try {
      report.complianceMatrix = buildComplianceMatrixFromReport(report, sourceText);
    } catch (err) {
      logAnalyzerDiagnostic("compliance matrix generation", err);
    }
  }
  return report;
}
function applyCitationGuards(report) {
  for (const t of Array.isArray(report.thresholdAnalysis) ? report.thresholdAnalysis : []) {
    if (!t || typeof t !== "object") continue;
    const g = guardCitation(t.primarySourceLaw, { proposition: `${t.thresholdChecked || ""} ${t.reasoning || ""}` });
    t.primarySourceLaw = g.text;
    t.citationStatus = g.status;
    t.citationReason = g.reason;
    if (g.authorityId) t.authorityId = g.authorityId;
  }
  for (const item of Array.isArray(report.proceduralTimelineViolations) ? report.proceduralTimelineViolations : []) {
    if (!item || typeof item !== "object") continue;
    if (/94\(5\)/.test(`${item.evaluation} ${item.citation}`) && /5-day|five-day|five day/i.test(item.evaluation) && !/\b(?:relative|extended\s+family|community)\b/i.test(item.evaluation)) {
      item.citation = UNVERIFIED_CITATION_NOTE;
    }
    const g = guardCitation(item.citation, { proposition: `${item.timelineRule || ""} ${item.evaluation || ""}` });
    item.citation = g.text;
    item.citationStatus = g.status;
    item.citationReason = g.reason;
    if (g.authorityId) item.authorityId = g.authorityId;
  }
  report.citationVerification = {
    method: "Each citation was matched to CYFSA Navigator's internal reference text. That text has not been checked against official e-Laws, and no external legal database was queried."
  };
  return report;
}
var SECTION_TIMEOUT_MS = { fast: 75e3, full: 11e4 };
var MIN_RETRY_BUDGET_MS = 25e3;
function addUsage(acc, model, usage) {
  if (!usage) return;
  const cur = acc[model] || { input_tokens: 0, output_tokens: 0 };
  cur.input_tokens += usage.input_tokens || 0;
  cur.output_tokens += usage.output_tokens || 0;
  acc[model] = cur;
}
async function runOneSection(key, opts, usage) {
  const spec = SECTION_SPECS[key];
  const now = opts.now || Date.now;
  let retryNote;
  let lastProblem = "";
  let lastProviderError = null;
  for (let attempt = 1; attempt <= SECTION_ATTEMPTS; attempt++) {
    const remaining = opts.deadlineAt - now();
    if (attempt > 1 && remaining < MIN_RETRY_BUDGET_MS) break;
    if (remaining < 5e3) break;
    const timeoutMs = Math.min(SECTION_TIMEOUT_MS[opts.mode], remaining - 3e3);
    let result;
    try {
      result = await opts.generate(
        {
          system: ANALYZER_SYSTEM_PROMPT,
          messages: [{ role: "user", content: [{ type: "text", text: buildSectionPrompt(key, opts.mode, opts.documentText, retryNote) }] }],
          max_tokens: spec.maxTokens[opts.mode],
          timeoutMs,
          retries: 1,
          // retries are handled here, inside the deadline, not stacked in the client
          requestId: opts.requestId,
          stage: `section:${key}`,
          mode: opts.mode
        },
        opts.primaryModel
      );
    } catch (err) {
      if (err instanceof AnalyzerError && !err.retryable) throw err;
      lastProviderError = err instanceof AnalyzerError ? err : null;
      logAnalyzerDiagnostic(`section ${key} attempt ${attempt}`, err);
      lastProblem = "the AI service did not return a usable response";
      if (attempt === 1) await new Promise((r) => setTimeout(r, 750 + Math.floor(Math.random() * 500)));
      continue;
    }
    addUsage(usage, opts.primaryModel, result.usage);
    lastProviderError = null;
    if (result.stopReason === "max_tokens") {
      lastProblem = "the response was incomplete - it hit its length limit before finishing";
      retryNote = "Your previous answer was cut off because it was too long. Stay strictly within the LIMITS: fewer items and shorter sentences.";
      continue;
    }
    const parsed = parseJsonObject(result.text);
    if (!parsed) {
      lastProblem = "the response was not a valid JSON object";
      retryNote = "Your previous answer was not one valid JSON object. Return only the JSON object, with no other text.";
      continue;
    }
    const checked = spec.validate(parsed, opts.mode);
    if (checked.ok === true) return { value: checked.value, attempts: attempt };
    lastProblem = checked.problems.join("; ");
    retryNote = `Your previous answer failed validation: ${lastProblem}. Fix these problems and return the complete section.`;
  }
  if (lastProviderError) throw lastProviderError;
  throw new AnalyzerError(
    "AI_RESPONSE_INVALID",
    422,
    `Part of the analysis ("${spec.title}") could not be completed reliably (${lastProblem || "time limit reached"}). Your document is safe and no partial report was saved as complete. Please retry.`,
    true
  );
}
async function runSectionedAnalysis(opts) {
  const defaultKeys = opts.mode === "full" ? FORENSIC_SECTIONS : QUICK_SECTIONS;
  const keys = opts.targetSections && opts.targetSections.length > 0 ? opts.targetSections : defaultKeys;
  const usageByModel = {};
  const sectionTimingsMs = {};
  const attempts = {};
  const now = opts.now || Date.now;
  const started = now();
  const report = { ...opts.initialSections || {} };
  let completed = Object.keys(opts.initialSections || {}).length;
  const totalCount = keys.length + completed;
  const concurrency = Math.min(3, keys.length);
  const queue = [...keys];
  const outcomes = [];
  const workers = Array.from({ length: concurrency }, async () => {
    while (queue.length > 0) {
      const key = queue.shift();
      if (!key) break;
      try {
        const { value, attempts: n } = await runOneSection(key, opts, usageByModel);
        sectionTimingsMs[key] = now() - started;
        attempts[key] = n;
        Object.assign(report, value);
        completed++;
        await opts.onSectionComplete?.(key, value, completed, totalCount);
      } catch (err) {
        outcomes.push(err);
      }
    }
  });
  await Promise.all(workers);
  const failure = outcomes.find((o) => o != null);
  if (failure) throw failure;
  applyReportGuards(report, opts.documentText);
  if (opts.mode === "full" && opts.verificationModel) {
    opts.onVerificationStart?.();
    report.forensicVerification = await runForensicVerification(report, opts, usageByModel);
  }
  return { report, usageByModel, sectionTimingsMs, attempts };
}
var VERDICTS = ["SUPPORTED", "OVERSTATED", "UNSUPPORTED", "MISQUOTED", "NEEDS_CONTEXT"];
function buildVerificationPrompt(report, documentText) {
  const findings = (report.redFlags || []).map((f) => ({
    id: f.id,
    severity: f.severity,
    category: f.category,
    evidenceClassification: f.evidenceClassification,
    quotedText: f.phraseDetected,
    quoteFoundVerbatim: f.quoteVerified === true,
    explanation: f.explanation,
    legalReference: f.legalReference
  }));
  const thresholds = (report.thresholdAnalysis || []).map((t) => ({
    thresholdChecked: t.thresholdChecked,
    isMet: t.isMet,
    reasoning: t.reasoning
  }));
  return [
    "<document>",
    documentText,
    "</document>",
    "",
    "You are the independent verification reviewer for an educational CYFSA evidence audit of the document above. Another model produced the findings below. Check each one against the document itself, not against the other model's reasoning.",
    "",
    "<findings>",
    JSON.stringify({ redFlags: findings, thresholdAnalysis: thresholds }, null, 1),
    "</findings>",
    "",
    "For every finding decide: SUPPORTED (the document supports it as stated), OVERSTATED (real issue, but the severity or certainty goes beyond what the document shows), UNSUPPORTED (the document does not support it), MISQUOTED (the quoted text is not in the document or is taken out of context), or NEEDS_CONTEXT (cannot be judged without records not in this document). Flag unsupported factual conclusions, mischaracterized quotations, statutory references stated with more confidence than the verified reference allows, and overconfident legal assertions. Do not add new findings.",
    "",
    "Return exactly one JSON object, no other text:",
    "{",
    '  "findings": [{"id": "rf1", "verdict": "SUPPORTED|OVERSTATED|UNSUPPORTED|MISQUOTED|NEEDS_CONTEXT", "recommendedSeverity": "Affects Evidentiary Weight|Worth Raising With Counsel|CRITICAL", "note": "1-2 sentences citing the passage that decides it"}],',
    '  "thresholds": [{"thresholdChecked": "exact name from the input", "verdict": "SUPPORTED|OVERSTATED|UNSUPPORTED|NEEDS_CONTEXT", "note": "1-2 sentences"}],',
    '  "overallAssessment": "2-4 sentences on how reliable the findings are overall"',
    "}"
  ].join("\n");
}
function mergeVerification(report, parsed, model) {
  let checked = 0;
  const byId = /* @__PURE__ */ new Map();
  for (const v of Array.isArray(parsed?.findings) ? parsed.findings : []) {
    if (v && typeof v === "object" && str(v.id)) byId.set(str(v.id), v);
  }
  const activeFlags = [];
  const unsupportedFindings = [];
  report.auditTrail = report.auditTrail || {};
  for (const flag of report.redFlags || []) {
    const v = byId.get(flag.id);
    if (!v) {
      activeFlags.push(flag);
      continue;
    }
    const verdict = VERDICTS.includes(str(v.verdict).toUpperCase()) ? str(v.verdict).toUpperCase() : "NEEDS_CONTEXT";
    flag.forensicVerification = { verdict, note: str(v.note), verifiedBy: VERIFIER_LABEL };
    if (verdict === "UNSUPPORTED") {
      unsupportedFindings.push({
        ...flag,
        removalReason: str(v.note) || "Independent second review confirmed finding is unsupported by document text.",
        reconciledStatus: "UNSUPPORTED_REMOVED"
      });
      checked++;
      continue;
    }
    if (verdict === "OVERSTATED") {
      flag.reconciledStatus = "OVERSTATED_RECONCILED";
      flag.originalExplanation = flag.explanation;
      if (str(v.note)) {
        flag.reconciliationNote = str(v.note);
      }
    } else if (verdict === "SUPPORTED") {
      flag.reconciledStatus = "CONFIRMED_SUPPORTED";
    }
    const rec = SEVERITIES.find((s) => s.toLowerCase() === str(v.recommendedSeverity).toLowerCase());
    if (rec && SEVERITY_RANK[rec] < SEVERITY_RANK[flag.severity]) {
      flag.originalSeverity = flag.severity;
      flag.severity = rec;
    }
    activeFlags.push(flag);
    checked++;
  }
  report.redFlags = activeFlags;
  if (unsupportedFindings.length > 0) {
    report.auditTrail.unsupportedFindings = unsupportedFindings;
  }
  const thresholdVerdicts = /* @__PURE__ */ new Map();
  for (const v of Array.isArray(parsed?.thresholds) ? parsed.thresholds : []) {
    if (v && typeof v === "object") thresholdVerdicts.set(str(v.thresholdChecked).toLowerCase(), v);
  }
  for (const t of report.thresholdAnalysis || []) {
    const v = thresholdVerdicts.get(str(t.thresholdChecked).toLowerCase());
    if (!v) continue;
    const verdict = VERDICTS.includes(str(v.verdict).toUpperCase()) ? str(v.verdict).toUpperCase() : "NEEDS_CONTEXT";
    t.forensicVerification = { verdict, note: str(v.note), verifiedBy: VERIFIER_LABEL };
    checked++;
  }
  return checked;
}
var VERIFIER_LABEL = "Independent second review";
async function runForensicVerification(report, opts, usage) {
  const model = opts.verificationModel;
  const now = opts.now || Date.now;
  const started = now();
  const findingCount = (report.redFlags || []).length + (report.thresholdAnalysis || []).length;
  if (findingCount === 0) {
    return { status: "completed", checkedFindings: 0, overallAssessment: "There were no findings to verify.", durationMs: 0 };
  }
  let reason = "";
  for (let attempt = 1; attempt <= VERIFICATION_ATTEMPTS; attempt++) {
    const remaining = opts.deadlineAt - now();
    if (remaining < (attempt === 1 ? 3e4 : MIN_RETRY_BUDGET_MS)) {
      reason = reason || "not enough time remained within the analysis time limit";
      break;
    }
    try {
      const result = await opts.generate(
        {
          system: ANALYZER_SYSTEM_PROMPT,
          messages: [{ role: "user", content: [{ type: "text", text: buildVerificationPrompt(report, opts.documentText) }] }],
          max_tokens: 4e3,
          timeoutMs: Math.min(9e4, remaining - 3e3),
          retries: 1,
          requestId: opts.requestId,
          stage: "forensic_verification",
          mode: "full"
        },
        model
      );
      addUsage(usage, model, result.usage);
      const parsed = result.stopReason === "max_tokens" ? null : parseJsonObject(result.text);
      if (!parsed) {
        reason = "the verification response was incomplete";
        continue;
      }
      const checked = mergeVerification(report, parsed, model);
      return {
        status: "completed",
        checkedFindings: checked,
        totalFindings: findingCount,
        overallAssessment: str(parsed.overallAssessment),
        durationMs: now() - started
      };
    } catch (err) {
      if (err instanceof AnalyzerError && !err.retryable) {
        reason = err.userMessage;
        break;
      }
      logAnalyzerDiagnostic("forensic verification", err);
      reason = "the verification request could not be completed";
    }
  }
  return {
    status: "incomplete",
    checkedFindings: 0,
    totalFindings: findingCount,
    reason: `Independent verification could not be completed: ${reason}. The findings below have not been second-reviewed.`,
    durationMs: now() - started
  };
}

// api/services/directAnalyzer.ts
var DIRECT_ANALYSIS_MAX_CHARS = 75e3;

// functions/api/analyze.ts
function extractSessionId(raw) {
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  if (/^[0-9a-f-]{36}$/i.test(trimmed)) return trimmed;
  if (trimmed.includes(".")) {
    try {
      const part = trimmed.split(".")[0];
      const base64 = part.replace(/-/g, "+").replace(/_/g, "/");
      const padded = base64.padEnd(base64.length + (4 - base64.length % 4) % 4, "=");
      const decoded = atob(padded);
      const parsed = JSON.parse(decoded);
      if (typeof parsed?.jti === "string" && /^[0-9a-f-]{36}$/i.test(parsed.jti)) {
        return parsed.jti;
      }
    } catch {
    }
  }
  return null;
}
var DEFAULT_HEADERS = {
  "Cache-Control": "no-store",
  "X-Content-Type-Options": "nosniff"
};
function clampBudget(raw, fallback) {
  const n = Number(raw);
  return Number.isFinite(n) && n >= 1e4 && n <= 3e5 ? n : fallback;
}
var HARD_DEADLINE_GRACE_MS = 5e3;
var HEARTBEAT_INTERVAL_MS = 5e3;
function withHardDeadline(work, ms, makeError) {
  let timer;
  const expired = new Promise((_, reject) => {
    timer = setTimeout(() => reject(makeError()), ms);
  });
  return Promise.race([work, expired]).finally(() => clearTimeout(timer));
}
async function handleAnalyzeRequest(request, env, deps = {}, waitUntil) {
  const pipelineStartedAt = Date.now();
  if (env.ANALYZER_ENABLED !== "true") {
    return Response.json(
      { code: "STAGING_ANALYZER_NOT_READY", analyzerReady: false },
      { status: 503, headers: DEFAULT_HEADERS }
    );
  }
  if (!env.FIREBASE_PROJECT_ID || !env.ANTHROPIC_API_KEY) {
    return Response.json(
      { error: "Analyzer service configuration is incomplete.", code: "CONFIGURATION_ERROR", analyzerReady: false },
      { status: 503, headers: DEFAULT_HEADERS }
    );
  }
  let body;
  try {
    body = await request.json();
  } catch {
    return Response.json(
      { error: "Invalid JSON request body.", code: "INVALID_REQUEST" },
      { status: 400, headers: DEFAULT_HEADERS }
    );
  }
  let rawText = body?.documentText ?? body?.textContent ?? body?.text ?? "";
  if (!rawText && body?.fileData?.base64 && (body?.fileData?.mimeType === "text/plain" || !body?.fileData?.mimeType)) {
    try {
      let b64 = String(body.fileData.base64);
      if (b64.includes(",")) b64 = b64.split(",")[1];
      rawText = atob(b64);
    } catch {
    }
  }
  const documentText = typeof rawText === "string" ? rawText.trim() : "";
  if (!documentText) {
    return Response.json(
      { error: "Missing or empty documentText.", code: "INVALID_REQUEST" },
      { status: 400, headers: DEFAULT_HEADERS }
    );
  }
  if (body?.mode !== void 0 && body?.mode !== null && body.mode !== "fast" && body.mode !== "full") {
    return Response.json({ error: "Analysis mode must be fast or full.", code: "INVALID_ANALYSIS_MODE" }, { status: 400, headers: DEFAULT_HEADERS });
  }
  if (documentText.startsWith("%PDF-") || documentText.startsWith("JVBER") || documentText.startsWith("UEsDB") || /^data:application\/(pdf|vnd|octet-stream)/i.test(documentText)) {
    return Response.json(
      { error: "Document contains unextracted binary or base64 data. Please run text extraction first.", code: "DOCUMENT_UNEXTRACTED" },
      { status: 400, headers: DEFAULT_HEADERS }
    );
  }
  const mode = body?.mode === "full" ? "full" : "fast";
  const isForensic = mode === "full";
  const rawSession = body?.sessionId || request.headers.get("x-ps-session") || request.headers.get("x-session-id");
  const sessionId = deps.trustedJob ? deps.trustedJob.session_id : extractSessionId(rawSession);
  const rawRequestId = request.headers.get("X-Analysis-Id") || body?.analysisId || "";
  const requestId = /^[A-Za-z0-9_-]{8,128}$/.test(rawRequestId) ? rawRequestId : `req_${Date.now()}_${Math.random().toString(36).substring(2, 10)}`;
  const acceptHeader = request.headers.get("accept") || "";
  const wantsStream = body?.stream !== false && acceptHeader.includes("text/event-stream");
  if (isForensic && env.FORENSIC_REQUIRE_QUEUE === "true" && !env.ANALYZER_JOBS_QUEUE && !deps.trustedJob) {
    return Response.json(
      {
        error: "Forensic processing is temporarily unavailable. No analysis credits were reserved.",
        code: "FORENSIC_QUEUE_UNAVAILABLE",
        retryable: true
      },
      { status: 503, headers: DEFAULT_HEADERS }
    );
  }
  const authFetcher = deps.fetcher || fetch;
  const identity = deps.trustedJob ? { status: "verified", uid: deps.trustedJob.owner_uid, emailVerified: false, email: null } : await verifyFirebaseRequest(request, env);
  if (identity.status !== "verified") {
    const status = identity.status === "unavailable" ? 503 : 401;
    return Response.json(
      { error: "Authentication required to run document analysis.", code: "SIGN_IN_REQUIRED" },
      { status, headers: DEFAULT_HEADERS }
    );
  }
  const uid = identity.uid;
  const isOwner = deps.trustedJob ? deps.trustedJob.owner_bypass : identity.emailVerified && identity.email?.trim().toLowerCase() === "mr.pelkie@gmail.com";
  const rpc2 = deps.rpc || createStagingCreditRpc(env, authFetcher);
  let reservationId = null;
  if (deps.trustedJob) {
    reservationId = deps.trustedJob.reservation_id;
  } else if (isOwner) {
  } else if (sessionId) {
    const sessionRead = await readVerifiedPaidSession(env, uid, sessionId, authFetcher);
    if (sessionRead.status !== "verified") {
      return Response.json(
        { error: "Paid session is invalid, expired, or revoked.", code: "SESSION_INVALID" },
        { status: sessionRead.status === "unavailable" ? 503 : 403, headers: DEFAULT_HEADERS }
      );
    }
    const reservation = await reserveVerifiedPaidCredit(sessionRead.session, isForensic ? "forensic" : "quick", requestId, rpc2);
    if (reservation.status === "limit") {
      return Response.json(
        { error: "Plan credit limit reached for this billing period.", code: "CREDIT_LIMIT_REACHED" },
        { status: 402, headers: DEFAULT_HEADERS }
      );
    }
    if (reservation.status === "in_progress" || reservation.status === "joined" || reservation.status === "consumed") {
      return Response.json(
        { error: "This analysis is already running. Results will display shortly.", code: "ANALYSIS_IN_PROGRESS", jobId: requestId },
        { status: 409, headers: DEFAULT_HEADERS }
      );
    }
    if (reservation.status !== "reserved" || !reservation.reservation_id) {
      return Response.json(
        { error: "Credit reservation service is temporarily unavailable.", code: "RESERVATION_UNAVAILABLE" },
        { status: reservation.status === "denied" ? 403 : 503, headers: DEFAULT_HEADERS }
      );
    }
    reservationId = reservation.reservation_id;
  } else {
    if (isForensic) {
      return Response.json(
        { error: "Forensic In-Depth analysis requires a paid plan.", code: "UPGRADE_REQUIRED" },
        { status: 403, headers: DEFAULT_HEADERS }
      );
    }
    const reservation = await reserveFreeScan(uid, requestId, rpc2);
    if (reservation.status === "limit") {
      return Response.json(
        { error: "You've used your free analysis. Upgrade to continue.", code: "FREE_LIMIT_REACHED" },
        { status: 402, headers: DEFAULT_HEADERS }
      );
    }
    if (reservation.status === "joined" || reservation.status === "consumed") {
      return Response.json(
        { error: "This analysis is already running or completed.", code: "ANALYSIS_IN_PROGRESS", jobId: requestId },
        { status: 409, headers: DEFAULT_HEADERS }
      );
    }
    if (reservation.status !== "reserved" || !reservation.reservation_id) {
      console.error("[FREE_SCAN_RESERVATION_UNAVAILABLE]", JSON.stringify({
        status: reservation.status,
        httpStatus: reservation.httpStatus,
        pgCode: reservation.pgCode
      }));
      return Response.json({
        error: "Free scan reservation unavailable.",
        code: "RESERVATION_UNAVAILABLE"
      }, {
        status: reservation.status === "denied" ? 403 : 503,
        headers: DEFAULT_HEADERS
      });
    }
    reservationId = reservation.reservation_id;
  }
  const shouldQueue = isForensic || env.QUEUE_QUICK_ANALYSIS === "true";
  if (!deps.trustedJob && env.ANALYZER_JOBS_QUEUE && shouldQueue) {
    const inputKey = `inputs/${requestId}.json`;
    const job = {
      job_id: requestId,
      owner_uid: uid,
      mode,
      input_key: inputKey,
      session_id: sessionId,
      reservation_id: reservationId,
      owner_bypass: isOwner
    };
    try {
      await createDurableJob(env, job, authFetcher);
      await saveDurableInput(env, inputKey, { documentText, fileName: typeof body?.documentName === "string" ? body.documentName : void 0 }, authFetcher);
      await env.ANALYZER_JOBS_QUEUE.send(createAnalyzerQueueMessage(requestId));
      return Response.json({
        jobId: requestId,
        status: "queued",
        statusUrl: `/api/analyze/job/${encodeURIComponent(requestId)}`,
        stream: wantsStream ? "poll" : void 0
      }, { status: 202, headers: DEFAULT_HEADERS });
    } catch {
      const retryable = false;
      try {
        await updateDurableJob(env, { jobId: requestId, status: "failed", errorCode: "ANALYSIS_ENQUEUE_FAILED", errorMessage: "The analysis could not be placed in the queue. Please retry.", retryable }, authFetcher);
      } catch {
      }
      if (!isOwner && reservationId) {
        try {
          if (sessionId) await releasePaidReservation(sessionId, requestId, reservationId, rpc2);
          else await releaseFreeScan(uid, requestId, reservationId, rpc2);
        } catch (releaseError) {
          console.error("[ANALYZER_ENQUEUE_RELEASE_FAILED]", releaseError instanceof Error ? releaseError.name : "error");
        }
      }
      return Response.json({
        error: "The analysis could not be queued. Your reserved credit was released when possible.",
        code: "ANALYSIS_ENQUEUE_FAILED",
        retryable
      }, { status: 503, headers: DEFAULT_HEADERS });
    }
  }
  const verificationModel = env.ANTHROPIC_FORENSIC_MODEL || DEFAULT_FORENSIC_MODEL;
  const primaryModel = isForensic ? verificationModel : env.ANTHROPIC_QUICK_MODEL || DEFAULT_QUICK_MODEL;
  const generate = deps.generate || createCloudflareGenerateFn(env, authFetcher);
  const analysisBudgetMs = isForensic ? clampBudget(env.FORENSIC_ANALYSIS_BUDGET_MS, 18e4) : clampBudget(env.QUICK_ANALYSIS_BUDGET_MS, 1e5);
  const aiDeadlineAt = Date.now() + analysisBudgetMs - 2e3;
  await saveJobState(env, { jobId: requestId, uid, status: "running", percent: 35, message: "Analysis started." }, deps.fetcher || fetch);
  const executeAnalysis = async (onProgress, onSection) => {
    let run = null;
    if (!isForensic) {
      if (documentText.length > DIRECT_ANALYSIS_MAX_CHARS) {
        throw new AnalyzerError(
          "AI_REQUEST_REJECTED",
          400,
          `This document exceeds the 75,000 character limit for Quick Review. Please select Forensic In-Depth mode for comprehensive analysis of larger records. Nothing was charged.`,
          false
        );
      }
      if (aiDeadlineAt - Date.now() < 1e4) {
        throw new AnalyzerError("ANALYSIS_TIMED_OUT", 408, "Not enough time remains to start Quick Review. Nothing was charged.", true);
      }
      const sectionedStartedAt = Date.now();
      await onProgress?.("reviewing_evidence", 35, "Analyzing four independent evidence sections...");
      run = await runSectionedAnalysis({
        mode: "fast",
        documentText,
        primaryModel,
        generate,
        deadlineAt: aiDeadlineAt,
        requestId,
        onSectionComplete: async (key, value, completed, total) => {
          const percent = 35 + Math.round(completed / total * 60);
          await onSection?.(key, value);
          await onProgress?.(
            completed === total ? "preparing_report" : "reviewing_evidence",
            percent,
            `Validated ${completed} of ${total} evidence sections: ${sectionTitle(key)}.`
          );
        }
      });
      console.info("[analyzer_latency]", JSON.stringify({ path: "quick_sectioned", elapsedMs: Date.now() - sectionedStartedAt, outcome: "success" }));
    } else {
      const sectionedStartedAt = Date.now();
      await onProgress?.("reviewing_evidence", 35, "Analyzing document across evidence sections...");
      run = await runSectionedAnalysis({
        mode,
        documentText,
        primaryModel,
        verificationModel,
        generate,
        deadlineAt: aiDeadlineAt,
        requestId,
        onSectionComplete: async (key, value, completed, total) => {
          const span = 50;
          const percent = 35 + Math.round(completed / total * span);
          const message = `Completed ${completed} of ${total} report sections: ${sectionTitle(key)}.`;
          await onSection?.(key, value);
          await onProgress?.(completed === total ? "preparing_report" : "reviewing_evidence", percent, message);
        },
        onVerificationStart: () => {
          void onProgress?.("verifying_findings", 88, "Independent Claude Opus verification of high-impact findings...");
        }
      });
      console.info("[analyzer_latency]", JSON.stringify({ path: "sectioned", elapsedMs: Date.now() - sectionedStartedAt, outcome: "success" }));
    }
    await onProgress?.("preparing_report", 96, "Validating quotations and assembling the report...");
    const report = {
      ...run.report,
      modelMetadata: {
        engineName: isForensic ? "Claude Opus" : "Claude Sonnet",
        mode,
        modeName: isForensic ? "Forensic In-Depth Scan" : "Quick Document Review",
        durationMs: Date.now() - pipelineStartedAt
      },
      _metadata: {
        requestId,
        analysisMode: mode,
        modelUsed: primaryModel,
        verificationModelUsed: isForensic ? verificationModel : void 0,
        analyzedAt: (/* @__PURE__ */ new Date()).toISOString()
      }
    };
    try {
      report.complianceMatrix = buildComplianceMatrixFromReport(
        {
          documentType: report.documentType,
          executiveSummary: report.fileSummary,
          statutoryFindings: (report.redFlags || []).map((rf) => ({
            title: rf.category,
            statute: rf.legalReference,
            description: rf.explanation,
            severity: rf.severity,
            evidenceQuotes: rf.phraseDetected ? [rf.phraseDetected] : [],
            pageNumber: rf.locationInDocument ? parseInt(rf.locationInDocument.match(/\d+/)?.[0] || "1", 10) : 1,
            paragraphReference: rf.locationInDocument
          })),
          contradictions: (report.contradictions || []).map((c) => ({
            claim: c.statementA || c.description,
            counterEvidence: c.statementB || c.counterEvidence,
            significance: c.explanation || c.significance
          }))
        },
        documentText,
        {
          documentTitle: report.documentTitle || "Uploaded Record"
        }
      );
    } catch (matrixErr) {
      console.warn("[compliance_matrix] Non-fatal evaluation error:", matrixErr);
    }
    applyReportGuards(report, documentText);
    return report;
  };
  const finalize = async () => {
    if (deps.trustedJob) return true;
    if (isOwner) return true;
    if (sessionId) {
      const res = await finalizePaidReservation(sessionId, requestId, rpc2);
      return res.status === "consumed";
    } else {
      const res = await finalizeFreeScan(uid, requestId, rpc2);
      return res.status === "consumed";
    }
  };
  const release = async () => {
    if (deps.trustedJob) return;
    if (isOwner || !reservationId) return;
    try {
      if (sessionId) {
        await releasePaidReservation(sessionId, requestId, reservationId, rpc2);
      } else {
        await releaseFreeScan(uid, requestId, reservationId, rpc2);
      }
    } catch (e) {
      console.error("[ANALYZER_RELEASE_FAILED]", e);
    }
  };
  const persistBeforeFinalization = async (report) => {
    const saved = await saveCompletedJob(env, { jobId: requestId, uid, report }, deps.fetcher || fetch);
    if (!saved) {
      throw new AnalyzerError(
        "ANALYSIS_PERSISTENCE_FAILED",
        503,
        "The completed report could not be saved. Your credit was not finalized. Please retry.",
        true
      );
    }
  };
  if (wantsStream) {
    let streamController;
    const readable = new ReadableStream({
      start(controller) {
        streamController = controller;
      },
      cancel() {
        streamController = void 0;
      }
    });
    const encoder = new TextEncoder();
    const sendEvent = (event, data) => {
      if (!streamController) return;
      if (event === "heartbeat" && (streamController.desiredSize ?? 0) <= 0) return;
      streamController.enqueue(encoder.encode(`event: ${event}
data: ${JSON.stringify(data)}

`));
    };
    const streamStartedAt = Date.now();
    const stageLog = (stage, extra = {}) => {
      console.info("[analyzer_stage]", JSON.stringify({ requestId, mode, path: isForensic ? "forensic" : "quick", stage, elapsedMs: Date.now() - streamStartedAt, ...extra }));
    };
    const heartbeat = setInterval(() => {
      void sendEvent("heartbeat", { requestId, elapsedMs: Date.now() - streamStartedAt });
    }, HEARTBEAT_INTERVAL_MS);
    const analysisTask = (async () => {
      stageLog("started");
      try {
        await sendEvent("stage", { requestId, stage: "verifying_access", percent: 30, message: "Verifying account authorization & entitlements..." });
        const report = await withHardDeadline(
          executeAnalysis(
            async (stage, percent, message) => {
              stageLog("progress", { progressStage: stage, percent });
              await sendEvent("stage", { requestId, stage, percent, message });
            },
            async (key, value) => {
              await sendEvent("section", { requestId, section: key, ...value });
            }
          ),
          analysisBudgetMs + HARD_DEADLINE_GRACE_MS,
          () => new AnalyzerError("ANALYSIS_TIMED_OUT", 504, "The analysis did not finish in time. Nothing was charged. Please try again.", true)
        );
        stageLog("analysis_done");
        await persistBeforeFinalization(report);
        stageLog("persisted");
        const finalized = await finalize();
        if (!finalized) {
          throw new AnalyzerError("ANALYSIS_PERSISTENCE_FAILED", 503, "Credit finalization failed. Result cannot be delivered.", false);
        }
        stageLog("finalized");
        await sendEvent("complete", report);
        stageLog("complete");
      } catch (err) {
        const code = err instanceof AnalyzerError ? err.code : "ANALYSIS_FAILED";
        const message = err instanceof AnalyzerError ? err.userMessage : "The analysis could not be completed. Nothing was charged. Please try again.";
        const retryable = err instanceof AnalyzerError ? err.retryable : true;
        stageLog("failed", { code, retryable, errorName: err?.name ?? "unknown" });
        try {
          await release();
        } catch (e) {
          console.error("[ANALYZER_RELEASE_FAILED]", e);
        }
        try {
          await saveJobState(env, { jobId: requestId, uid, status: "failed", error: { code, message, retryable } }, deps.fetcher || fetch);
        } catch (e) {
          console.error("[ANALYSIS_JOB_SAVE_FAILED]", e instanceof Error ? e.name : "error");
        }
        await sendEvent("error", { requestId, error: message, code, retryable });
      } finally {
        clearInterval(heartbeat);
        streamController?.close();
        streamController = void 0;
      }
    })();
    waitUntil?.(analysisTask);
    return new Response(readable, {
      status: 200,
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache, no-transform",
        "Connection": "keep-alive",
        "X-Content-Type-Options": "nosniff"
      }
    });
  }
  try {
    const report = await withHardDeadline(
      executeAnalysis(deps.trustedJob?.onProgress),
      analysisBudgetMs + HARD_DEADLINE_GRACE_MS,
      () => new AnalyzerError("ANALYSIS_TIMED_OUT", 504, "The analysis did not finish in time. Your document is safe. Please retry.", true)
    );
    await persistBeforeFinalization(report);
    const finalized = await finalize();
    if (!finalized) {
      await release();
      return Response.json(
        { error: "Credit finalization failed.", code: "CREDIT_FINALIZATION_FAILED" },
        { status: 503, headers: DEFAULT_HEADERS }
      );
    }
    return Response.json(report, { status: 200, headers: DEFAULT_HEADERS });
  } catch (err) {
    await release();
    const status = err instanceof AnalyzerError ? err.statusCode : 500;
    const code = err instanceof AnalyzerError ? err.code : "ANALYSIS_FAILED";
    const message = err instanceof AnalyzerError ? err.userMessage : "The analysis could not be completed. Nothing was charged. Please try again.";
    const retryable = err instanceof AnalyzerError ? err.retryable : true;
    await saveJobState(env, { jobId: requestId, uid, status: "failed", error: { code, message, retryable } }, deps.fetcher || fetch);
    return Response.json(
      { error: message, code, retryable },
      { status, headers: DEFAULT_HEADERS }
    );
  }
}

// workers/analyzer-queue-consumer.ts
var RETRY_BASE_SECONDS = 20;
var RETRY_MAX_SECONDS = 900;
var retryDelay = (attempts) => Math.min(RETRY_MAX_SECONDS, RETRY_BASE_SECONDS * 2 ** Math.min(10, Math.max(0, attempts - 1)));
async function errorResponse(response) {
  const fallback = {
    code: "ANALYSIS_FAILED",
    error: "The analysis failed.",
    retryable: response.status === 408 || response.status === 429 || response.status >= 500
  };
  try {
    const payload = await response.json();
    if (!payload || typeof payload !== "object") return fallback;
    const data = payload;
    return {
      code: typeof data.code === "string" ? data.code : fallback.code,
      // Never trust arbitrary upstream error text for durable user-visible status.
      error: fallback.error,
      retryable: typeof data.retryable === "boolean" ? data.retryable : fallback.retryable
    };
  } catch {
    return fallback;
  }
}
async function releaseReservation(env, job) {
  if (job.owner_bypass || !job.reservation_id) return;
  const rpc2 = createStagingCreditRpc(env);
  const released = job.session_id ? await releasePaidReservation(job.session_id, job.job_id, job.reservation_id, rpc2) : await releaseFreeScan(job.owner_uid, job.job_id, job.reservation_id, rpc2);
  if (released.status === "unavailable" || released.status === "denied") {
    throw Object.assign(new Error("Credit release is not yet confirmed."), { retryable: true, code: "CREDIT_RELEASE_UNAVAILABLE" });
  }
}
async function finalizeReservation(env, job) {
  if (job.owner_bypass) return true;
  const rpc2 = createStagingCreditRpc(env);
  const result = job.session_id ? await finalizePaidReservation(job.session_id, job.job_id, rpc2) : await finalizeFreeScan(job.owner_uid, job.job_id, rpc2);
  return result.status === "consumed";
}
async function markPermanentFailure(env, job, workerToken, code, message) {
  if (!await updateDurableJob(env, { jobId: job.job_id, workerToken, status: "failed", errorCode: code, errorMessage: message, retryable: false, progress: 100, stage: "failed" })) {
    throw Object.assign(new Error("Failed job state could not be persisted."), { retryable: true, code: "JOB_STATE_PERSISTENCE_FAILED" });
  }
  await releaseReservation(env, job);
}
async function persistJobUpdate(env, input) {
  if (!await updateDurableJob(env, input)) {
    throw Object.assign(new Error("Job state could not be persisted."), { retryable: true, code: "JOB_STATE_PERSISTENCE_FAILED" });
  }
}
async function processJob(message, env) {
  let parsed;
  try {
    parsed = parseAnalyzerQueueMessage(message.body);
  } catch {
    console.error("[ANALYZER_QUEUE_INVALID_MESSAGE]");
    message.ack();
    return;
  }
  const token = crypto.randomUUID();
  let job;
  try {
    job = await claimDurableJob(env, parsed.jobId, token, 240);
  } catch (error) {
    const detail = error && typeof error === "object" ? error : {};
    console.error("[ANALYZER_CLAIM_FAILED]", JSON.stringify({
      errorClass: detail.name || "unknown",
      httpStatus: typeof detail.status === "number" ? detail.status : null,
      retryable: detail.retryable ?? true
    }));
    message.retry({ delaySeconds: retryDelay(message.attempts) });
    return;
  }
  if (!job) {
    try {
      const current = await readDurableJob(env, parsed.jobId);
      if (!current || current.status === "completed") {
        message.ack();
        return;
      }
      if (current.status === "failed") {
        await releaseReservation(env, current);
        message.ack();
        return;
      }
      message.retry({ delaySeconds: Math.max(30, Math.min(240, retryDelay(message.attempts))) });
    } catch {
      message.retry({ delaySeconds: retryDelay(message.attempts) });
    }
    return;
  }
  try {
    const recoveredReport = await loadPersistedReport(env, job.job_id);
    if (recoveredReport) {
      if (!await finalizeReservation(env, job)) throw Object.assign(new Error("Credit finalization is not yet confirmed."), { retryable: true, code: "CREDIT_FINALIZATION_UNAVAILABLE" });
      await persistJobUpdate(env, { jobId: job.job_id, workerToken: token, status: "completed", progress: 100, stage: "complete" });
      message.ack();
      return;
    }
    const input = await loadDurableInput(env, job.input_key);
    const request = new Request("https://analyzer-queue.internal/api/analyze", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Analysis-Id": job.job_id, Accept: "application/json" },
      body: JSON.stringify({ documentText: input.documentText, documentName: input.fileName, mode: job.mode, stream: false, analysisId: job.job_id })
    });
    const response = await handleAnalyzeRequest(request, env, {
      trustedJob: {
        ...job,
        workerToken: token,
        onProgress: async (stage, progress, message2) => {
          await persistJobUpdate(env, { jobId: job.job_id, workerToken: token, status: "running", stage, progress });
          void message2;
        }
      }
    });
    if (!response.ok) {
      const failure = await errorResponse(response);
      if (failure.retryable) {
        await persistJobUpdate(env, { jobId: job.job_id, workerToken: token, status: "queued", errorCode: failure.code, errorMessage: failure.error, retryable: true });
        message.retry({ delaySeconds: retryDelay(message.attempts) });
      } else {
        await markPermanentFailure(env, job, token, failure.code, failure.error);
        message.ack();
      }
      return;
    }
    if (!await loadPersistedReport(env, job.job_id)) throw Object.assign(new Error("Completed report was not persisted."), { retryable: true, code: "ANALYSIS_PERSISTENCE_FAILED" });
    if (!await finalizeReservation(env, job)) throw Object.assign(new Error("Credit finalization is not yet confirmed."), { retryable: true, code: "CREDIT_FINALIZATION_UNAVAILABLE" });
    await persistJobUpdate(env, { jobId: job.job_id, workerToken: token, status: "completed", progress: 100, stage: "complete" });
    message.ack();
  } catch (error) {
    const retryable = !(error && typeof error === "object" && "retryable" in error && error.retryable === false);
    const code = error && typeof error === "object" && "code" in error ? String(error.code) : "ANALYZER_QUEUE_FAILURE";
    const safeMessage = "The analysis could not be completed. The worker will retry it when possible.";
    try {
      if (retryable) {
        await persistJobUpdate(env, { jobId: job.job_id, workerToken: token, status: "queued", errorCode: code, errorMessage: safeMessage, retryable: true });
        message.retry({ delaySeconds: retryDelay(message.attempts) });
      } else {
        await markPermanentFailure(env, job, token, code, safeMessage);
        message.ack();
      }
    } catch {
      message.retry({ delaySeconds: retryDelay(message.attempts) });
    }
  }
}
async function processDeadLetter(message, env) {
  let jobId;
  try {
    jobId = parseAnalyzerQueueMessage(message.body).jobId;
  } catch {
    console.error("[ANALYZER_DLQ_INVALID_MESSAGE]");
    message.ack();
    return;
  }
  try {
    const current = await readDurableJob(env, jobId);
    if (!current) {
      message.ack();
      return;
    }
    if (current.status === "completed") {
      message.ack();
      return;
    }
    if (current.status === "failed") {
      await releaseReservation(env, current);
      message.ack();
      return;
    }
    const report = await loadPersistedReport(env, jobId);
    if (report) {
      if (!await finalizeReservation(env, current)) {
        throw new Error("Persisted report credit finalization is not yet confirmed.");
      }
      if (await completeRecoveredJob(env, jobId)) {
        message.ack();
        return;
      }
      const latest = await readDurableJob(env, jobId);
      if (latest?.status === "completed") {
        message.ack();
        return;
      }
      throw new Error("Persisted report completion is not yet confirmed.");
    }
    const leaseExpiry = current.lease_expires_at ? Date.parse(current.lease_expires_at) : 0;
    if (current.status === "running" && Number.isFinite(leaseExpiry) && leaseExpiry > Date.now()) {
      message.retry({ delaySeconds: Math.max(1, Math.min(900, Math.ceil((leaseExpiry - Date.now()) / 1e3) + 5)) });
      return;
    }
    if (current.attempt_count !== void 0 && current.attempt_count < 6) {
      if (!env.ANALYZER_JOBS_REQUEUE) throw new Error("Primary analyzer queue producer binding is not configured.");
      if (await requeueFromDeadLetter(env, jobId)) {
        await env.ANALYZER_JOBS_REQUEUE.send(createAnalyzerQueueMessage(jobId));
        message.ack();
        return;
      }
    }
    const job = await failDeadLetterJob(env, jobId);
    if (job?.status === "failed") {
      await releaseReservation(env, job);
    } else {
      const latest = await readDurableJob(env, jobId);
      if (latest?.status === "failed") {
        await releaseReservation(env, latest);
      } else if (latest?.status !== "completed" && latest !== null) {
        throw new Error("Dead-letter job was not terminally settled.");
      }
    }
  } catch (error) {
    console.error("[ANALYZER_DLQ_FINALIZATION_FAILED]", error instanceof Error ? error.name : "unknown");
    message.retry({ delaySeconds: retryDelay(message.attempts) });
    return;
  }
  message.ack();
}
var consumer = {
  async queue(batch, env) {
    const primary = env.ANALYZER_JOBS_QUEUE_NAME || "cyfsa-analyzer-jobs";
    const dlq = env.ANALYZER_JOBS_DLQ_NAME || "cyfsa-analyzer-dead-letter";
    if (batch.queue !== primary && batch.queue !== dlq) throw new Error("Unexpected analyzer queue");
    if (env.ANALYZER_ENABLED !== "true") {
      for (const message of batch.messages) message.retry({ delaySeconds: RETRY_MAX_SECONDS });
      return;
    }
    for (const message of batch.messages) {
      if (batch.queue === (env.ANALYZER_JOBS_DLQ_NAME || "cyfsa-analyzer-dead-letter")) await processDeadLetter(message, env);
      else await processJob(message, env);
    }
  }
};
var analyzer_queue_consumer_default = consumer;
export {
  analyzer_queue_consumer_default as default,
  processDeadLetter,
  processJob,
  retryDelay
};
