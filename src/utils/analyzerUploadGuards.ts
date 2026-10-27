// Pure decisions the Document Analyzer makes about an uploaded file before any text reaches the server.
// Kept separate from the component so the rules have direct regression tests.

export const TRANSCRIPTION_FAILED_MESSAGE =
  "The recording could not be transcribed, so there is no text to analyze. Try again, or upload a written transcript.";

export const NO_READABLE_CONTENT_MESSAGE = "This file has no readable content to analyze.";

/** `text` is set only when `ok` is true. `error` is set only when `ok` is false. */
export interface TranscriptionOutcome {
  ok: boolean;
  text?: string;
  error?: string;
}

/**
 * Interprets the /api/transcribe response body. A transcription counts only when it contains text.
 * Anything else (missing field, empty string, whitespace) is a failure: placeholder text must never
 * stand in for a recording the analyzer could not hear.
 */
export function interpretTranscription(responseData: unknown): TranscriptionOutcome {
  const transcribed = (responseData as { transcribedText?: unknown } | null)?.transcribedText;
  if (typeof transcribed === "string" && transcribed.trim().length > 0) {
    return { ok: true, text: transcribed };
  }
  return { ok: false, error: TRANSCRIPTION_FAILED_MESSAGE };
}

/** A file may be sent for analysis only when it has content (text, or base64 for a document the server extracts). */
export function canSendForAnalysis(file: { content: string | null | undefined }): boolean {
  return typeof file.content === "string" && file.content.trim().length > 0;
}
