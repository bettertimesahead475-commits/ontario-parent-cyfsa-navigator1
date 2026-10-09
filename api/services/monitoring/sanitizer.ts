/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * CYFSA Navigator — Monitoring Data Sanitizer
 * Strips secrets, credentials, tokens, and PII from monitoring reports and logs.
 */

const SECRET_PATTERNS: RegExp[] = [
  /sk-ant-api[a-zA-Z0-9_\-]{10,}/gi,
  /sb_secret_[a-zA-Z0-9_\-]{10,}/gi,
  /eyJ[a-zA-Z0-9_\-]{20,}\.[a-zA-Z0-9_\-]{20,}\.[a-zA-Z0-9_\-]*/g,
  /-----BEGIN [A-Z ]+ PRIVATE KEY-----[\s\S]*?-----END [A-Z ]+ PRIVATE KEY-----/g,
  /(?:password|passwd|secret|api[_-]?key|access[_-]?token|service[_-]?role)[=:][\s]*["']?([^\s"';&]+)/gi,
  /Bearer\s+[a-zA-Z0-9_\.\-]+/gi,
  /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g, // Scrub emails (PII)
];

export function sanitizeText(text: string): string {
  let cleaned = text;
  for (const pattern of SECRET_PATTERNS) {
    cleaned = cleaned.replace(pattern, "[REDACTED]");
  }
  return cleaned;
}

export function sanitizeObject<T>(obj: T): T {
  if (obj === null || obj === undefined) return obj;
  if (typeof obj === "string") return sanitizeText(obj) as unknown as T;
  if (typeof obj === "number" || typeof obj === "boolean") return obj;

  if (Array.isArray(obj)) {
    return obj.map((item) => sanitizeObject(item)) as unknown as T;
  }

  if (typeof obj === "object") {
    const cleaned: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(obj)) {
      if (/password|secret|token|key|credential|auth/i.test(key) && typeof value === "string") {
        cleaned[key] = "[REDACTED]";
      } else {
        cleaned[key] = sanitizeObject(value);
      }
    }
    return cleaned as T;
  }

  return obj;
}
