/**
 * Which other case files can be sent with a Forensic Engine analysis as `additionalDocuments`, and the payload for
 * them. Only files whose text has already been extracted are offered: the server reads these as text and does not
 * extract them, so a file still holding raw upload data (base64) would be analyzed as gibberish.
 */

export const MAX_ADDITIONAL_DOCUMENTS = 9;
export const MAX_ADDITIONAL_CHARS = 300_000;

export interface CaseFileLike {
  id: string;
  name: string;
  mimeType?: string;
  content?: string;
}

/** Same test the analyzer uses before sending a file's content as text. */
export function hasExtractedText(file: CaseFileLike): boolean {
  const text = typeof file.content === "string" ? file.content : "";
  if (!text.trim()) return false;
  const isRawBase64 = file.mimeType !== "text/plain" && (text.startsWith("JVBER") || /^[A-Za-z0-9+/=]{100,}/.test(text.slice(0, 100)));
  return !isRawBase64 && text.length <= MAX_ADDITIONAL_CHARS;
}

export function eligibleAdditionalFiles<T extends CaseFileLike>(files: T[], primaryId: string | null): T[] {
  return files.filter((f) => f.id !== primaryId && hasExtractedText(f));
}

export function buildAdditionalDocuments(files: CaseFileLike[], selectedIds: string[], primaryId: string | null): Array<{ title: string; text: string }> {
  const eligible = eligibleAdditionalFiles(files, primaryId);
  return selectedIds
    .map((id) => eligible.find((f) => f.id === id))
    .filter((f): f is CaseFileLike => Boolean(f))
    .slice(0, MAX_ADDITIONAL_DOCUMENTS)
    .map((f) => ({ title: f.name.slice(0, 200), text: f.content as string }));
}
