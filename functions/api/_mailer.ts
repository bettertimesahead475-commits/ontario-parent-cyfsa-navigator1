/**
 * Transactional email sender for Cloudflare Pages Functions: Gmail API `users.messages.send` over fetch, authorised by
 * an OAuth refresh token (scope https://www.googleapis.com/auth/gmail.send) of the sending Gmail account. Workers
 * cannot run nodemailer/SMTP or the googleapis Node client, which the retired Express server used.
 *
 * Nothing is sent unless TRANSACTIONAL_EMAIL_ENABLED is exactly "true". TRANSACTIONAL_EMAIL_ALLOWLIST (comma-separated
 * addresses or "@domain" entries) restricts recipients, for testing with synthetic addresses before launch.
 */
export type TransactionalEmailEnv = {
  TRANSACTIONAL_EMAIL_ENABLED?: string;
  TRANSACTIONAL_EMAIL_ALLOWLIST?: string;
  TRANSACTIONAL_EMAIL_REPLY_TO?: string;
  TRANSACTIONAL_EMAIL_PAYLOAD_KEY?: string;
  GMAIL_SENDER_ADDRESS?: string;
  GMAIL_OAUTH_CLIENT_ID?: string;
  GMAIL_OAUTH_CLIENT_SECRET?: string;
  GMAIL_OAUTH_REFRESH_TOKEN?: string;
};

export type OutgoingEmail = { to: string; subject: string; text: string };
export interface TransactionalMailer {
  send(message: OutgoingEmail): Promise<{ id: string }>;
}

export class MailerError extends Error {
  constructor(readonly code: string, readonly retryable: boolean) {
    super(code);
  }
}

const EMAIL = /^[^\s@<>,;"'\\]{1,64}@[^\s@<>,;"'\\]{1,190}\.[A-Za-z]{2,}$/;

export const transactionalEmailEnabled = (env: TransactionalEmailEnv) => env.TRANSACTIONAL_EMAIL_ENABLED === 'true';

export function recipientAllowed(env: TransactionalEmailEnv, email: string): boolean {
  const list = (env.TRANSACTIONAL_EMAIL_ALLOWLIST || '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
  if (!list.length) return true;
  const address = email.trim().toLowerCase();
  return list.some((entry) => (entry.startsWith('@') ? address.endsWith(entry) : address === entry));
}

export function isValidRecipient(email: string): boolean {
  return EMAIL.test(email);
}

const utf8Base64 = (text: string) => {
  const bytes = new TextEncoder().encode(text);
  let binary = '';
  for (const b of bytes) binary += String.fromCodePoint(b);
  return btoa(binary);
};
const base64Url = (text: string) => utf8Base64(text).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');

/** RFC 2822 message. Header values never contain CR/LF (checked), and the subject is RFC 2047 encoded. */
export function buildRawMessage(from: string, message: OutgoingEmail, replyTo?: string): string {
  if (!isValidRecipient(message.to) || !isValidRecipient(from) || (replyTo && !isValidRecipient(replyTo))) {
    throw new MailerError('INVALID_ADDRESS', false);
  }
  if (/[\r\n]/.test(message.subject)) throw new MailerError('INVALID_SUBJECT', false);
  const headers = [
    `From: CYFSA Navigator <${from}>`,
    `To: ${message.to}`,
    ...(replyTo ? [`Reply-To: ${replyTo}`] : []),
    `Subject: =?UTF-8?B?${utf8Base64(message.subject)}?=`,
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset=UTF-8',
    'Content-Transfer-Encoding: base64',
    'Auto-Submitted: auto-generated',
  ];
  const body = (utf8Base64(message.text).match(/.{1,76}/g) || []).join('\r\n');
  return `${headers.join('\r\n')}\r\n\r\n${body}`;
}

export function gmailMailer(env: TransactionalEmailEnv, fetcher: typeof fetch = fetch): TransactionalMailer {
  const from = (env.GMAIL_SENDER_ADDRESS || '').trim();
  const configured = from && env.GMAIL_OAUTH_CLIENT_ID && env.GMAIL_OAUTH_CLIENT_SECRET && env.GMAIL_OAUTH_REFRESH_TOKEN;
  return {
    async send(message) {
      if (!configured) throw new MailerError('MAILER_NOT_CONFIGURED', false);
      const raw = base64Url(buildRawMessage(from, message, env.TRANSACTIONAL_EMAIL_REPLY_TO?.trim() || undefined));
      let tokenResponse: Response;
      try {
        tokenResponse = await fetcher('https://oauth2.googleapis.com/token', {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({
            grant_type: 'refresh_token',
            client_id: env.GMAIL_OAUTH_CLIENT_ID!,
            client_secret: env.GMAIL_OAUTH_CLIENT_SECRET!,
            refresh_token: env.GMAIL_OAUTH_REFRESH_TOKEN!,
          }).toString(),
          signal: AbortSignal.timeout(8000),
        });
      } catch {
        throw new MailerError('OAUTH_UNREACHABLE', true);
      }
      // 400/401 from the token endpoint means a revoked or wrong grant: retrying will not help.
      if (!tokenResponse.ok) throw new MailerError(`OAUTH_${tokenResponse.status}`, tokenResponse.status >= 500 || tokenResponse.status === 429);
      const { access_token } = (await tokenResponse.json()) as { access_token?: string };
      if (!access_token) throw new MailerError('OAUTH_NO_TOKEN', false);
      let sendResponse: Response;
      try {
        sendResponse = await fetcher('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', {
          method: 'POST',
          headers: { Authorization: `Bearer ${access_token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ raw }),
          signal: AbortSignal.timeout(10000),
        });
      } catch {
        // The request may have reached Gmail; the caller treats this as an unknown outcome, never as a safe retry.
        throw new MailerError('GMAIL_NO_RESPONSE', false);
      }
      if (!sendResponse.ok) throw new MailerError(`GMAIL_${sendResponse.status}`, sendResponse.status >= 500 || sendResponse.status === 429);
      const { id } = (await sendResponse.json()) as { id?: string };
      return { id: id || '' };
    },
  };
}

// ---------------------------------------------------------------- access-code payload encryption

const b64 = (bytes: Uint8Array) => btoa(String.fromCodePoint(...bytes));
const unb64 = (text: string) => Uint8Array.from(atob(text), (c) => c.codePointAt(0)!);

async function payloadKey(env: TransactionalEmailEnv): Promise<CryptoKey | null> {
  const raw = env.TRANSACTIONAL_EMAIL_PAYLOAD_KEY?.trim();
  if (!raw) return null;
  let bytes: Uint8Array;
  try {
    bytes = unb64(raw);
  } catch {
    return null;
  }
  if (bytes.length !== 32) return null;
  return crypto.subtle.importKey('raw', bytes, 'AES-GCM', false, ['encrypt', 'decrypt']);
}

/** AES-256-GCM, "iv.ciphertext" in base64. Null when no valid key is configured (the code is then not emailed). */
export async function sealPayload(env: TransactionalEmailEnv, plaintext: string, context: string): Promise<string | null> {
  const key = await payloadKey(env);
  if (!key) return null;
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const sealed = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: new TextEncoder().encode(context) }, key, new TextEncoder().encode(plaintext)));
  return `${b64(iv)}.${b64(sealed)}`;
}

export async function openPayload(env: TransactionalEmailEnv, sealed: string, context: string): Promise<string | null> {
  const key = await payloadKey(env);
  const [iv, data] = sealed.split('.');
  if (!key || !iv || !data) return null;
  try {
    const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(iv), additionalData: new TextEncoder().encode(context) }, key, unb64(data));
    return new TextDecoder().decode(plain);
  } catch {
    return null;
  }
}
