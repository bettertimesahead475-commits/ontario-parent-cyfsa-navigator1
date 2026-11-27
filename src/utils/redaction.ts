/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Redaction toggle: lets a user hide identifying fields (names, case/file numbers,
 * birthdates) before sharing a screen or exporting a document - e.g., sending analyzer
 * output to someone for feedback without exposing a real family's details.
 *
 * REDACTION STRATEGY:
 * - Redacts STRUCTURED metadata fields (respondentName, childNames, fileNumber)
 * - Redacts COMMON PII PATTERNS: phone numbers, dates of birth, court file numbers
 * - Does NOT attempt deep NLP name extraction from free-form text (unreliable)
 * - UI clearly states this is "partial" redaction, not complete
 *
 * Note: this only redacts the known fields the app tracks + basic patterns.
 * It is not a complete privacy solution; use with user data sensitivity in mind.
 */
import { useState, useEffect, useCallback } from "react";
import { getUserKey } from "./storage";

const REDACTION_KEY = "OPA_REDACTION_ENABLED";

/**
 * Masks common PII patterns in free text: phone numbers, dates (MM/DD/YYYY, YYYY-MM-DD, DD-MON-YYYY),
 * Ontario court file numbers (FC-XX-XXXXXXXX-XXXX) and, optionally, known personal names.
 */
export function redactPiiText(text: string, knownNames: string[] = []): string {
  if (!text) return text;
  let redacted = text;
  redacted = redacted.replace(/\b\d{3}[-.\s]?\d{3}[-.\s]?\d{4}\b/g, "[PHONE]");
  redacted = redacted.replace(/\b\d{1,2}\/\d{1,2}\/\d{4}\b/g, "[DATE]");
  redacted = redacted.replace(/\b\d{4}-\d{1,2}-\d{1,2}\b/g, "[DATE]");
  redacted = redacted.replace(/\b\d{1,2}-(JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)-\d{4}\b/gi, "[DATE]");
  redacted = redacted.replace(/\bFC-\d{2}-\d{8}-\d{4}\b/gi, "[FILE]");
  knownNames.forEach((name) => {
    if (name && name.trim()) {
      const nameRegex = new RegExp(`\\b${name.trim()}\\b`, "gi");
      redacted = redacted.replace(nameRegex, "[NAME]");
    }
  });
  return redacted;
}

export function useRedaction() {
  const [enabled, setEnabled] = useState<boolean>(() => {
    try {
      const key = getUserKey(REDACTION_KEY) || REDACTION_KEY;
      return localStorage.getItem(key) === "true";
    } catch {
      return false;
    }
  });

  useEffect(() => {
    try {
      const key = getUserKey(REDACTION_KEY) || REDACTION_KEY;
      localStorage.setItem(key, String(enabled));
    } catch {
      /* best-effort */
    }
  }, [enabled]);

  const toggle = useCallback(() => setEnabled((v) => !v), []);

  /** Redacts a single known-identifying value if redaction is on; otherwise returns it as-is. */
  const redact = useCallback(
    (value: string | undefined | null, placeholder: string = "[REDACTED]"): string => {
      if (!value) return value || "";
      return enabled ? placeholder : value;
    },
    [enabled]
  );

  const redactDocumentText = useCallback(
    (text: string, knownNames: string[] = []): string => (enabled ? redactPiiText(text, knownNames) : text),
    [enabled]
  );

  return { enabled, toggle, redact, redactDocumentText };
}
