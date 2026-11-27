/** Final Case Assessment limits enforced by functions/api/final-case-assessment.ts, shared so the client checks the same numbers. */
export const ASSESSMENT_REQUEST_MAX_BYTES = 150000;
export const ASSESSMENT_SOURCE_MAX_CHARS = 75000;
export const ASSESSMENT_SOURCE_SET_MAX_CHARS = 75000;
export const ASSESSMENT_MAX_SOURCES = 20;
export const ASSESSMENT_FILENAME_MAX_CHARS = 255;

const n = (value: number) => value.toLocaleString('en-CA');
const SPLIT = 'Split the document into several .txt files and add each one to this matter';

/** The exact body the client POSTs for a source document. */
export function sourceRequestBody(filename: string, text: string): string {
  return JSON.stringify({ filename, text });
}

/** UTF-8 byte length, which is what the server counts. */
export function utf8ByteLength(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}

/** A customer-readable reason the server would reject this source, or null when it is within every limit. */
export function sourceUploadProblem(filename: string, text: string): string | null {
  if (!filename.toLowerCase().endsWith('.txt')) return 'Only .txt files can be added. Save the document as plain text (.txt), then add it again';
  if (filename.length > ASSESSMENT_FILENAME_MAX_CHARS) return `The file name is ${n(filename.length)} characters; the limit is ${n(ASSESSMENT_FILENAME_MAX_CHARS)}. Rename the file, then add it again`;
  if (!text.trim()) return 'This file has no text. Choose a .txt file that contains the document text';
  const bytes = utf8ByteLength(sourceRequestBody(filename, text));
  if (bytes > ASSESSMENT_REQUEST_MAX_BYTES) return `This document is ${n(bytes)} bytes as sent (file name and text); the limit is ${n(ASSESSMENT_REQUEST_MAX_BYTES)} bytes per document. ${SPLIT}`;
  if (text.length > ASSESSMENT_SOURCE_MAX_CHARS) return `This document has ${n(text.length)} characters; the limit is ${n(ASSESSMENT_SOURCE_MAX_CHARS)} characters per document. ${SPLIT}`;
  return null;
}

export const SOURCE_SET_LIMIT_MESSAGE = `This matter has more source text than one assessment can read: up to ${n(ASSESSMENT_MAX_SOURCES)} documents and ${n(ASSESSMENT_SOURCE_SET_MAX_CHARS)} characters in total. Put the remaining documents in a separate matter`;
export const INPUT_TOO_LARGE_MESSAGE = `This document is over the ${n(ASSESSMENT_REQUEST_MAX_BYTES)}-byte limit per document (file name and text, as sent). ${SPLIT}`;
