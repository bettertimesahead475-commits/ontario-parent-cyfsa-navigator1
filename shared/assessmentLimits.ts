/** Final Case Assessment limits enforced by functions/api/final-case-assessment.ts, shared so the client checks the same numbers. */
export const ASSESSMENT_REQUEST_MAX_BYTES = 150000;
export const ASSESSMENT_SOURCE_MAX_CHARS = 75000;
export const ASSESSMENT_SOURCE_SET_MAX_CHARS = 75000;
export const ASSESSMENT_MAX_SOURCES = 20;
export const ASSESSMENT_FILENAME_MAX_CHARS = 255;

const n = (value: number) => value.toLocaleString('en-CA');
const SPLIT = 'Split the document into several .txt files and add each one to this matter';
const TRIM = 'Remove pages that are not evidence for this matter, or move them to a separate matter';

/** The exact body the client POSTs for a source document. */
export function sourceRequestBody(filename: string, text: string): string {
  return JSON.stringify({ filename, text });
}

/**
 * Characters one document adds to the assessment's source set, as the server counts them: a "[<64-hex id>] <name> page 1"
 * header line plus the text. A document that alone exceeds the set limit can never be assessed.
 */
export function sourceSetEntryLength(filename: string, text: string): number {
  return '['.length + 64 + '] '.length + filename.length + ' page 1\n'.length + text.length;
}

/** UTF-8 byte length, which is what the server counts. */
export function utf8ByteLength(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}

/**
 * A customer-readable reason the server would reject this source, or null when it is within every limit.
 * Splitting is suggested only for the byte limit: a matter's whole source set has the same character limit as one document.
 */
export function sourceUploadProblem(filename: string, text: string): string | null {
  if (!filename.toLowerCase().endsWith('.txt')) return 'Only .txt files can be added. Save the document as plain text (.txt), then add it again';
  if (filename.length > ASSESSMENT_FILENAME_MAX_CHARS) return `The file name is ${n(filename.length)} characters; the limit is ${n(ASSESSMENT_FILENAME_MAX_CHARS)}. Rename the file, then add it again`;
  if (!text.trim()) return 'This file has no text. Choose a .txt file that contains the document text';
  const bytes = utf8ByteLength(sourceRequestBody(filename, text));
  if (text.length > ASSESSMENT_SOURCE_MAX_CHARS || sourceSetEntryLength(filename, text) > ASSESSMENT_SOURCE_SET_MAX_CHARS) return `This document has ${n(text.length)} characters (with its name, ${n(sourceSetEntryLength(filename, text))}). One assessment reads about ${n(ASSESSMENT_SOURCE_SET_MAX_CHARS)} characters in total across all of a matter's documents, so splitting it will not help. ${TRIM}, then add it again`;
  if (bytes > ASSESSMENT_REQUEST_MAX_BYTES) return `This document is ${n(bytes)} bytes as sent (file name and text); the limit is ${n(ASSESSMENT_REQUEST_MAX_BYTES)} bytes per document. ${SPLIT}`;
  return null;
}

export const SOURCE_SET_LIMIT_MESSAGE = `This matter has more source text than one assessment can read: about ${n(ASSESSMENT_SOURCE_SET_MAX_CHARS)} characters in total, including each document's name, across up to ${n(ASSESSMENT_MAX_SOURCES)} documents. ${TRIM}`;
export const INPUT_TOO_LARGE_MESSAGE = `This document is over the ${n(ASSESSMENT_REQUEST_MAX_BYTES)}-byte limit per document (file name and text, as sent). ${SPLIT}`;

export const SOURCE_SET_NOTICE = `One assessment reads about ${n(ASSESSMENT_SOURCE_SET_MAX_CHARS)} characters in total, including each document's name, across up to ${n(ASSESSMENT_MAX_SOURCES)} documents in a matter.`;
