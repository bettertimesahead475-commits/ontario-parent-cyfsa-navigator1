/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * CYFSA Navigator — Structured Operational Logger
 * Emits structured telemetry without logging secrets, credentials, or PII.
 */

import { sanitizeObject, sanitizeText } from "./sanitizer.js";

export type LogLevel = "info" | "warn" | "error";

export function logOperationalEvent(
  level: LogLevel,
  component: string,
  message: string,
  context?: Record<string, unknown>
): void {
  const sanitizedContext = context ? sanitizeObject(context) : undefined;
  const payload = {
    timestamp: new Date().toISOString(),
    component,
    level,
    message: sanitizeText(message),
    ...(sanitizedContext ? { context: sanitizedContext } : {}),
  };

  const line = `[CYFSA-OPS] [${level.toUpperCase()}] [${component}] ${payload.message}`;
  if (level === "error") {
    console.error(line, sanitizedContext ? JSON.stringify(sanitizedContext) : "");
  } else if (level === "warn") {
    console.warn(line, sanitizedContext ? JSON.stringify(sanitizedContext) : "");
  } else {
    console.info(line, sanitizedContext ? JSON.stringify(sanitizedContext) : "");
  }
}
