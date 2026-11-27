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

const MONTH = "(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|June?|July?|Aug(?:ust)?|Sep(?:t(?:ember)?)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)";

/**
 * Masks common PII patterns in free text: phone numbers (incl. (416) 555-0199), dates (MM/DD/YYYY, YYYY-MM-DD,
 * DD-MON-YYYY, "April 3, 2019", "3 April 2019"),
 * Ontario court file numbers (FC-19-1234, FO-21-00012345-0000, C1234/19) and, optionally, known personal names.
 */
export function redactPiiText(text: string, knownNames: string[] = []): string {
  if (!text) return text;
  let redacted = text;
  // Court file numbers first, so the phone and ISO-date patterns cannot consume their digits.
  redacted = redacted.replace(/\b(?:FC|FO|FS|FD|CV|CFO|DFO)-?\d{2}-\d{2,8}(?:-\d{1,6}){0,2}\b/gi, "[FILE]");
  redacted = redacted.replace(/\b[A-Z]{1,2}\d{2,6}\/\d{2}\b/g, "[FILE]");
  redacted = redacted.replace(/(?:\(\d{3}\)\s?|\b\d{3}[-.\s]?)\d{3}[-.\s]?\d{4}\b/g, "[PHONE]");
  redacted = redacted.replace(new RegExp(`\\b${MONTH}\\.?\\s+\\d{1,2}(?:st|nd|rd|th)?,?\\s+\\d{4}\\b`, "gi"), "[DATE]");
  redacted = redacted.replace(new RegExp(`\\b\\d{1,2}(?:st|nd|rd|th)?\\s+(?:of\\s+)?${MONTH}\\.?,?\\s+\\d{4}\\b`, "gi"), "[DATE]");
  redacted = redacted.replace(/\b\d{1,2}\/\d{1,2}\/\d{4}\b/g, "[DATE]");
  redacted = redacted.replace(/\b\d{4}-\d{1,2}-\d{1,2}\b/g, "[DATE]");
  redacted = redacted.replace(/\b\d{1,2}-(JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)-\d{4}\b/gi, "[DATE]");
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
