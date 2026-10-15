// ---------------------------------------------------------------------------
// secrets.ts — encryption for values that must live in the database (Facebook
// Page access tokens) and signing for short-lived OAuth state.
//
// Key: MARKETING_TOKEN_ENCRYPTION_KEY, a base64-encoded 32-byte key. It is a
// server-only environment variable. It is never returned to the browser, never
// logged, and never stored next to the ciphertext it protects.
//
// Format: "v1.<iv>.<tag>.<ciphertext>" (base64url), AES-256-GCM with a fresh
// random 12-byte IV per value. GCM authenticates the ciphertext, so tampering
// or a wrong key makes decryption fail instead of returning garbage.
// ---------------------------------------------------------------------------

import { createCipheriv, createDecipheriv, createHmac, randomBytes, timingSafeEqual } from "node:crypto";

function loadKey(): Buffer {
  const raw = process.env.MARKETING_TOKEN_ENCRYPTION_KEY?.trim();
  if (!raw) {
    throw Object.assign(
      new Error("MARKETING_TOKEN_ENCRYPTION_KEY is not configured. Set a base64-encoded 32-byte key in Vercel (server-only)."),
      { statusCode: 503 }
    );
  }
  const key = Buffer.from(raw, "base64");
  if (key.length !== 32) {
    throw Object.assign(new Error("MARKETING_TOKEN_ENCRYPTION_KEY must decode to exactly 32 bytes."), { statusCode: 503 });
  }
  return key;
}

export function encryptSecret(plaintext: string): string {
  const key = loadKey();
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ct = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return ["v1", iv.toString("base64url"), tag.toString("base64url"), ct.toString("base64url")].join(".");
}

export function decryptSecret(payload: string): string {
  const key = loadKey();
  const parts = payload.split(".");
  if (parts.length !== 4 || parts[0] !== "v1") {
    throw new Error("Stored secret has an unrecognised format.");
  }
  const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(parts[1], "base64url"));
  decipher.setAuthTag(Buffer.from(parts[2], "base64url"));
  return Buffer.concat([decipher.update(Buffer.from(parts[3], "base64url")), decipher.final()]).toString("utf8");
}

// --- Signed OAuth state -------------------------------------------------------
// The Meta redirect carries no admin header, so the callback trusts only a state
// value this server minted: HMAC-signed, with an expiry, and a random nonce.

const STATE_TTL_MS = 10 * 60 * 1000;

function stateKey(): Buffer {
  // Derive a separate HMAC key so the state signature is not the encryption key.
  return createHmac("sha256", loadKey()).update("meta-oauth-state:v1").digest();
}

export function signOAuthState(now: number = Date.now()): string {
  const body = Buffer.from(JSON.stringify({ n: randomBytes(16).toString("base64url"), t: now })).toString("base64url");
  const sig = createHmac("sha256", stateKey()).update(body).digest("base64url");
  return `${body}.${sig}`;
}

export function verifyOAuthState(state: unknown, now: number = Date.now()): boolean {
  if (typeof state !== "string") return false;
  const [body, sig] = state.split(".");
  if (!body || !sig) return false;
  const expected = createHmac("sha256", stateKey()).update(body).digest("base64url");
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return false;
  try {
    const { t } = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as { t: number };
    return typeof t === "number" && now - t >= 0 && now - t <= STATE_TTL_MS;
  } catch {
    return false;
  }
}
