/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Redaction toggle: lets a user hide known identifying fields (names, case/file numbers,
 * birthdates) before sharing a screen or exporting a document - e.g., sending analyzer
 * output to someone for feedback without exposing a real family's details.
 *
 * IMPORTANT, STATED HONESTLY RATHER THAN OVERCLAIMED: this only redacts the STRUCTURED
 * fields the app already tracks separately (metadata.respondentName, metadata.childNames,
 * metadata.fileNumber, AffidavitDraft fields, etc.) - not every mention of a name that might
 * appear inside free-form AI-generated analysis text (explanations, summaries, red-flag
 * descriptions). Attempting to pattern-match names out of arbitrary prose is unreliable and
 * would give false confidence - a missed name is worse than an honestly-labeled partial
 * redaction. The UI must say this plainly wherever the toggle appears, not imply complete
 * redaction.
 */
import { useState, useEffect, useCallback } from "react";
import { getUserKey } from "./storage";

const REDACTION_KEY = "OPA_REDACTION_ENABLED";

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

  return { enabled, toggle, redact };
}
