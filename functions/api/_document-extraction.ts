/**
 * Document text extraction for Cloudflare Pages Functions, with page-level provenance.
 *
 * - The file type is decided by the file's own bytes (signature), not the declared MIME type or extension; a
 *   mismatch is refused.
 * - PDF: each page's text layer is read with unpdf (pdf.js built for edge runtimes). Pages without usable text are
 *   cut out one at a time with pdf-lib and sent to Gemini individually, so every OCR result belongs to a known page.
 *   Nothing is attributed to a page by guesswork.
 * - DOCX: the ZIP container is opened with fflate and word/document.xml is walked in document order. Headings, list
 *   items, table rows and paragraphs are kept. A DOCX has no fixed pages, so its page attribution is "unavailable".
 * - Images: one OCR call. An image is a single page.
 * - Plain text: decoded as strict UTF-8. No pages.
 * - Limits: MAX_FILE_BYTES, MAX_PDF_PAGES, MAX_OCR_PAGES per request. Pages past the OCR limit are listed as not
 *   processed, and the response says so; text is never cut silently.
 * - No confidence scores: neither the text layer nor this OCR call yields a calibrated one, so none is reported.
 */

import { unzipSync, strFromU8 } from 'fflate';
import { PDFDocument } from 'pdf-lib';
import { getDocumentProxy } from 'unpdf';
import { GeminiError, generateGemini, resolveGeminiModel, type GeminiEnv } from './_gemini';

export const MAX_FILE_BYTES = 20 * 1024 * 1024;
export const MAX_PDF_PAGES = 200;
export const MAX_OCR_PAGES = 30;
const OCR_CONCURRENCY = 3;
const OCR_PAGE_TIMEOUT_MS = 60_000;
/** A page with fewer letters and digits than this in its text layer is treated as needing OCR. */
const MIN_TEXT_LAYER_CHARS = 25;

export type DetectedType = 'pdf' | 'docx' | 'image' | 'text';
export type ExtractionMethod = 'TEXT_LAYER' | 'OCR' | 'DOCX_XML' | 'PLAIN_TEXT';
export type PageStatus = 'ok' | 'empty' | 'not_processed';

export interface ExtractedPage {
  /** The page in the source file, or null where the format has no fixed pages (DOCX, plain text). */
  pageNumber: number | null;
  text: string;
  extractionMethod: ExtractionMethod;
  status: PageStatus;
  characters: number;
  checksum: string;
  sourceLocation: { documentId: string; fileName: string; page: number | null };
}

export interface ExtractionResult {
  documentId: string;
  fileName: string;
  mimeType: string;
  detectedType: DetectedType;
  pageCount: number | null;
  pageAttribution: 'per-page' | 'unavailable';
  pages: ExtractedPage[];
  /** Text with [Page N] markers where pages are known, which the analyzer uses to cite pages. */
  extractedText: string;
  incomplete: string[];
  ocr: { model: string; calls: number; promptTokens: number; outputTokens: number } | null;
}

export class ExtractionError extends Error {
  constructor(readonly status: number, readonly code: string, readonly publicMessage: string) {
    super(code);
  }
}

const OCR_PROMPT =
  'Transcribe all text on this page exactly as written, in reading order. Keep line breaks, headings, dates, ' +
  'numbers, names and check-box states (write [X] for a marked box and [ ] for an empty one). Write [illegible] for ' +
  'text you cannot read. Do not summarise, translate, correct or add anything. If the page has no text, reply with ' +
  'exactly: [no text]';

// ---------------------------------------------------------------------------------------------------------------------

export function decodeBase64(input: string): Uint8Array {
  let s = input.trim();
  const comma = s.indexOf(',');
  if (s.startsWith('data:') && comma > 0) s = s.slice(comma + 1);
  s = s.replace(/\s+/g, '');
  if (!s || s.length % 4 === 1 || !/^[A-Za-z0-9+/]*={0,2}$/.test(s)) {
    throw new ExtractionError(400, 'INVALID_BASE64', 'The uploaded file could not be read. Please upload it again.');
  }
  if ((s.length * 3) / 4 > MAX_FILE_BYTES + 3) {
    throw new ExtractionError(413, 'FILE_TOO_LARGE', 'File is too large. The limit is 20 MB.');
  }
  let bin: string;
  try {
    bin = atob(s);
  } catch {
    throw new ExtractionError(400, 'INVALID_BASE64', 'The uploaded file could not be read. Please upload it again.');
  }
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function startsWith(bytes: Uint8Array, sig: number[], offset = 0): boolean {
  if (bytes.length < offset + sig.length) return false;
  for (let i = 0; i < sig.length; i++) if (bytes[offset + i] !== sig[i]) return false;
  return true;
}

/** The file's real type from its first bytes. */
export function detectType(bytes: Uint8Array): { type: DetectedType | 'ole' | 'unknown'; imageMime?: string } {
  // %PDF- may follow a little leading junk; the PDF spec allows the header within the first 1024 bytes.
  const head = strFromU8(bytes.subarray(0, Math.min(1024, bytes.length)), true);
  if (head.includes('%PDF-')) return { type: 'pdf' };
  if (startsWith(bytes, [0x50, 0x4b, 0x03, 0x04])) return { type: 'docx' };
  if (startsWith(bytes, [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1])) return { type: 'ole' };
  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47])) return { type: 'image', imageMime: 'image/png' };
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) return { type: 'image', imageMime: 'image/jpeg' };
  if (startsWith(bytes, [0x52, 0x49, 0x46, 0x46]) && startsWith(bytes, [0x57, 0x45, 0x42, 0x50], 8)) return { type: 'image', imageMime: 'image/webp' };
  if (startsWith(bytes, [0x47, 0x49, 0x46, 0x38])) return { type: 'image', imageMime: 'image/gif' };
  if (startsWith(bytes, [0x49, 0x49, 0x2a, 0x00]) || startsWith(bytes, [0x4d, 0x4d, 0x00, 0x2a])) return { type: 'image', imageMime: 'image/tiff' };
  // Plain text: valid UTF-8 with no NUL bytes in the sample.
  const sample = bytes.subarray(0, Math.min(8192, bytes.length));
  if (!sample.includes(0)) {
    try {
      new TextDecoder('utf-8', { fatal: true }).decode(sample);
      return { type: 'text' };
    } catch {
      // A multi-byte character cut at the sample boundary is not a binary file; check the whole file later.
      if (bytes.length > sample.length) return { type: 'text' };
    }
  }
  return { type: 'unknown' };
}

const DECLARED: Record<DetectedType, RegExp> = {
  pdf: /^application\/(pdf|x-pdf)$/,
  docx: /^application\/(vnd\.openxmlformats-officedocument\.wordprocessingml\.document|docx)$/,
  image: /^image\/(png|jpe?g|webp|gif|tiff)$/,
  text: /^text\/(plain|markdown|csv)$/,
};
const EXTENSIONS: Record<DetectedType, RegExp> = {
  pdf: /\.pdf$/i,
  docx: /\.docx$/i,
  image: /\.(png|jpe?g|webp|gif|tiff?)$/i,
  text: /\.(txt|md|csv|text)$/i,
};

async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function toBase64(bytes: Uint8Array): string {
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

const letters = (s: string) => (s.match(/[\p{L}\p{N}]/gu) || []).length;

// --- DOCX -------------------------------------------------------------------------------------------------------------

const XML_ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
function decodeXml(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (_, e: string) =>
    e[0] === '#' ? String.fromCodePoint(e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10)) : XML_ENTITIES[e.toLowerCase()]
  );
}
const attr = (attrs: string, name: string) => new RegExp(`${name}="([^"]*)"`).exec(attrs)?.[1] ?? null;

/**
 * Walks word/document.xml in order. This tokenizes decompressed, well-formed XML (tags and character data), which
 * is what a streaming XML parser does; it is not a scan of the compressed bytes.
 */
export function docxToText(xml: string): string {
  const out: string[] = [];
  const cellStack: string[][][] = []; // per open table: rows of cells
  let para: string[] | null = null;
  let headingLevel = 0;
  let listItem = false;
  let inText = false;
  let inParaProps = false;
  let cell: string[] | null = null;
  const cellStackOfCells: (string[] | null)[] = [];

  const flushPara = () => {
    if (!para) return;
    let text = para.join('').replace(/[ \t]+\n/g, '\n').trim();
    para = null;
    if (!text) return;
    if (headingLevel) text = `${'#'.repeat(Math.min(headingLevel, 6))} ${text}`;
    else if (listItem) text = `- ${text}`;
    if (cell) cell.push(text);
    else out.push(text);
  };

  const re = /<(\/?)([A-Za-z][\w.\-]*:)?([A-Za-z][\w.\-]*)([^>]*?)(\/?)>|([^<]+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml)) !== null) {
    if (m[6] !== undefined) {
      if (inText && para) para.push(decodeXml(m[6]));
      continue;
    }
    const closing = m[1] === '/';
    const selfClosing = m[5] === '/' || /\/\s*$/.test(m[4]);
    const ns = m[2] ?? '';
    const name = m[3];
    if (ns !== 'w:') continue;
    const attrs = m[4];
    if (name === 'p') {
      if (closing) flushPara();
      else {
        para = [];
        headingLevel = 0;
        listItem = false;
        if (selfClosing) para = null;
      }
    } else if (name === 'pPr') inParaProps = !closing && !selfClosing;
    else if (name === 'pStyle' && inParaProps) {
      const v = attr(attrs, 'w:val') ?? '';
      const h = /^heading\s?(\d)$/i.exec(v) || (/^title$/i.test(v) ? [v, '1'] : null);
      if (h) headingLevel = Number(h[1]);
      if (/list/i.test(v)) listItem = true;
    } else if (name === 'numPr' && inParaProps && !closing) listItem = true;
    else if (name === 't') inText = !closing && !selfClosing;
    else if ((name === 'tab' || name === 'ptab') && para && !closing) para.push('\t');
    else if ((name === 'br' || name === 'cr') && para && !closing) para.push('\n');
    else if (name === 'tbl') {
      if (!closing) {
        flushPara();
        cellStack.push([]);
        cellStackOfCells.push(cell);
        cell = null;
      } else {
        const rows = cellStack.pop() ?? [];
        cell = cellStackOfCells.pop() ?? null;
        const rendered = rows.map((r) => `| ${r.map((c) => c.replace(/\|/g, '/')).join(' | ')} |`).join('\n');
        if (rendered) (cell ?? out).push(rendered);
      }
    } else if (name === 'tr' && cellStack.length) {
      if (!closing) cellStack[cellStack.length - 1].push([]);
    } else if (name === 'tc' && cellStack.length) {
      if (!closing) cell = [];
      else {
        flushPara();
        const rows = cellStack[cellStack.length - 1];
        rows[rows.length - 1]?.push((cell ?? []).join(' ').trim());
        cell = null;
      }
    }
  }
  flushPara();
  return out.join('\n\n');
}

function extractDocx(bytes: Uint8Array): string {
  let files: Record<string, Uint8Array>;
  try {
    files = unzipSync(bytes, { filter: (f) => f.name === 'word/document.xml' || f.name === '[Content_Types].xml' });
  } catch {
    throw new ExtractionError(422, 'DOCX_MALFORMED', 'This Word document appears to be damaged and could not be read.');
  }
  const doc = files['word/document.xml'];
  if (!doc) throw new ExtractionError(422, 'DOCX_MALFORMED', 'This file is not a Word document (.docx) or is damaged.');
  if (doc.length > 50 * 1024 * 1024) throw new ExtractionError(413, 'FILE_TOO_LARGE', 'This Word document is too large to read.');
  return docxToText(strFromU8(doc));
}

// --- PDF --------------------------------------------------------------------------------------------------------------

async function readPdfTextLayer(bytes: Uint8Array, proxyGetter = getDocumentProxy): Promise<string[]> {
  let pdf: any;
  try {
    // unpdf/pdf.js may transfer the buffer; give it a copy so the bytes stay usable for page splitting.
    pdf = await proxyGetter(new Uint8Array(bytes), { isEvalSupported: false, useSystemFonts: false } as any);
  } catch (err: any) {
    if (err?.name === 'PasswordException' || /password/i.test(String(err?.message))) {
      throw new ExtractionError(422, 'PDF_ENCRYPTED', 'This PDF is password-protected. Remove the password and upload it again.');
    }
    console.error(JSON.stringify({
      tag: '[EXTRACT_DIAGNOSTIC]',
      stage: 'PDF_TEXT_LAYER_OPEN_FAILED',
      error: String(err?.message || err),
    }));
    return [];
  }
  try {
    if (pdf.numPages > MAX_PDF_PAGES) {
      throw new ExtractionError(413, 'TOO_MANY_PAGES', `This PDF has ${pdf.numPages} pages. The limit is ${MAX_PDF_PAGES}.`);
    }
    const pages: string[] = [];
    for (let i = 1; i <= pdf.numPages; i++) {
      let pageText = '';
      try {
        const page = await pdf.getPage(i);
        try {
          const content = await page.getTextContent();
          let text = '';
          for (const item of (content.items as any[])) {
            if (typeof item?.str !== 'string') continue;
            text += item.str;
            if (item.hasEOL) text += '\n';
          }
          pageText = text.replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
        } finally {
          page.cleanup?.();
        }
      } catch (pageErr: any) {
        console.warn(JSON.stringify({
          tag: '[EXTRACT_DIAGNOSTIC]',
          stage: 'PDF_PAGE_TEXT_LAYER_FAILED',
          page: i,
          error: String(pageErr?.message || pageErr),
        }));
        pageText = '';
      }
      pages.push(pageText);
    }
    return pages;
  } finally {
    await pdf.destroy?.().catch?.(() => {});
  }
}

async function singlePagePdf(source: PDFDocument, index: number): Promise<Uint8Array> {
  const out = await PDFDocument.create();
  const [page] = await out.copyPages(source, [index]);
  out.addPage(page);
  return out.save();
}

async function ocr(env: GeminiEnv, mimeType: string, data: Uint8Array, fetcher?: typeof fetch) {
  const model = resolveGeminiModel(env, 'ocr');
  const result = await generateGemini(
    env,
    model,
    {
      contents: [{ role: 'user', parts: [{ inlineData: { mimeType, data: toBase64(data) } }, { text: OCR_PROMPT }] }],
      generationConfig: { temperature: 0, maxOutputTokens: 8192 },
    },
    { timeoutMs: OCR_PAGE_TIMEOUT_MS, fetcher }
  );
  const text = result.text.trim();
  return { ...result, text: /^\[no text\]$/i.test(text) ? '' : text };
}

// --- Entry point ------------------------------------------------------------------------------------------------------

export async function extractDocument(
  input: { base64: string; mimeType?: string; fileName?: string },
  env: GeminiEnv,
  deps: { fetcher?: typeof fetch; getDocumentProxy?: typeof getDocumentProxy } = {}
): Promise<ExtractionResult> {
  const bytes = decodeBase64(input.base64);
  if (bytes.length > MAX_FILE_BYTES) throw new ExtractionError(413, 'FILE_TOO_LARGE', 'File is too large. The limit is 20 MB.');
  const fileName = String(input.fileName ?? 'document').slice(0, 255);
  const declared = String(input.mimeType ?? '').toLowerCase().split(';')[0].trim();
  const detected = detectType(bytes);
  if (detected.type === 'ole') {
    throw new ExtractionError(415, 'UNSUPPORTED_TYPE', 'This is a password-protected or older-format Word file (.doc). Save it as an unprotected .docx or PDF and upload it again.');
  }
  if (detected.type === 'unknown') throw new ExtractionError(415, 'UNSUPPORTED_TYPE', 'Unsupported file type. Upload a PDF, Word (.docx), image or text file.');
  const type = detected.type;
  // The declared type and extension must agree with the bytes when they are given.
  const declaredOk = !declared || declared === 'application/octet-stream' || DECLARED[type].test(declared) || (type === 'text' && declared.startsWith('text/'));
  const extOk = !/\.[a-z0-9]{1,5}$/i.test(fileName) || EXTENSIONS[type].test(fileName);
  if (!declaredOk || !extOk) {
    throw new ExtractionError(415, 'FILE_TYPE_MISMATCH', "The file's contents do not match its type or extension. Please upload the original file.");
  }

  const documentId = `doc_${(await sha256Hex(toBase64(bytes.subarray(0, 65536)) + bytes.length)).slice(0, 16)}`;
  const mimeType = type === 'image' ? detected.imageMime! : type === 'pdf' ? 'application/pdf' : type === 'docx' ? 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' : 'text/plain';
  const incomplete: string[] = [];
  const ocrStats = { model: '', calls: 0, promptTokens: 0, outputTokens: 0 };
  const page = async (pageNumber: number | null, text: string, method: ExtractionMethod, status: PageStatus): Promise<ExtractedPage> => ({
    pageNumber,
    text,
    extractionMethod: method,
    status,
    characters: text.length,
    checksum: (await sha256Hex(text)).slice(0, 16),
    sourceLocation: { documentId, fileName, page: pageNumber },
  });
  const track = (r: Awaited<ReturnType<typeof ocr>>) => {
    ocrStats.model = r.model;
    ocrStats.calls++;
    ocrStats.promptTokens += r.usage.promptTokens ?? 0;
    ocrStats.outputTokens += r.usage.outputTokens ?? 0;
    if (r.finishReason === 'MAX_TOKENS') incomplete.push('Part of a page was too long for text recognition; that page may be incomplete.');
  };

  let pages: ExtractedPage[];
  let pageCount: number | null = null;

  if (type === 'text') {
    let text: string;
    try {
      text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    } catch {
      throw new ExtractionError(422, 'DECODE_ERROR', 'This text file is not valid UTF-8 text.');
    }
    pages = [await page(null, text.replace(/\r\n/g, '\n').trim(), 'PLAIN_TEXT', 'ok')];
  } else if (type === 'docx') {
    pages = [await page(null, extractDocx(bytes), 'DOCX_XML', 'ok')];
  } else if (type === 'image') {
    const r = await ocr(env, mimeType, bytes, deps.fetcher);
    track(r);
    pageCount = 1;
    pages = [await page(1, r.text, 'OCR', r.text ? 'ok' : 'empty')];
  } else {
    let layer = await readPdfTextLayer(bytes, deps.getDocumentProxy);
    let source: PDFDocument | null = null;

    if (layer.length === 0) {
      // unpdf could not open the text layer (PDF_TEXT_LAYER_OPEN_FAILED).
      // Attempt fallback to pdf-lib to check if the PDF can be loaded and split for OCR.
      try {
        source = await PDFDocument.load(bytes, { updateMetadata: false, ignoreEncryption: true });
        const count = source.getPageCount();
        if (count > MAX_PDF_PAGES) {
          throw new ExtractionError(413, 'TOO_MANY_PAGES', `This PDF has ${count} pages. The limit is ${MAX_PDF_PAGES}.`);
        }
        layer = new Array(count).fill('');
      } catch (pdfLibErr: any) {
        if (pdfLibErr instanceof ExtractionError) throw pdfLibErr;
        console.error(JSON.stringify({
          tag: '[EXTRACT_DIAGNOSTIC]',
          stage: 'PDF_PAGE_SPLIT_FAILED',
          error: String(pdfLibErr?.message || pdfLibErr),
        }));
        throw new ExtractionError(422, 'PDF_MALFORMED', 'This PDF appears to be damaged and could not be read.');
      }
    }

    pageCount = layer.length;
    const needOcr = layer.map((t, i) => (letters(t) < MIN_TEXT_LAYER_CHARS ? i : -1)).filter((i) => i >= 0);
    const ocrNow = needOcr.slice(0, MAX_OCR_PAGES);
    const skipped = new Set(needOcr.slice(MAX_OCR_PAGES));
    const ocrText = new Map<number, string>();

    if (ocrNow.length) {
      if (!source) {
        try {
          source = await PDFDocument.load(bytes, { updateMetadata: false, ignoreEncryption: true });
        } catch (splitErr: any) {
          console.error(JSON.stringify({
            tag: '[EXTRACT_DIAGNOSTIC]',
            stage: 'PDF_PAGE_SPLIT_FAILED',
            error: String(splitErr?.message || splitErr),
          }));
        }
      }

      if (source) {
        for (let i = 0; i < ocrNow.length; i += OCR_CONCURRENCY) {
          const batch = ocrNow.slice(i, i + OCR_CONCURRENCY);
          const results = await Promise.all(
            batch.map(async (idx) => {
              let singleBytes: Uint8Array;
              try {
                singleBytes = await singlePagePdf(source!, idx);
              } catch (splitErr: any) {
                console.error(JSON.stringify({
                  tag: '[EXTRACT_DIAGNOSTIC]',
                  stage: 'PDF_PAGE_SPLIT_FAILED',
                  page: idx + 1,
                  error: String(splitErr?.message || splitErr),
                }));
                return null;
              }
              try {
                return await ocr(env, 'application/pdf', singleBytes, deps.fetcher);
              } catch (ocrErr: any) {
                if (ocrErr instanceof GeminiError) {
                  throw ocrErr;
                }
                console.error(JSON.stringify({
                  tag: '[EXTRACT_DIAGNOSTIC]',
                  stage: 'PDF_PAGE_OCR_FAILED',
                  page: idx + 1,
                  error: String(ocrErr?.message || ocrErr),
                }));
                return null;
              }
            })
          );
          results.forEach((r, j) => {
            if (r) {
              track(r);
              ocrText.set(batch[j], r.text);
            }
          });
        }
      } else {
        incomplete.push('Scanned page OCR could not be performed due to PDF page structure; using available text layer.');
      }
    }

    pages = await Promise.all(
      layer.map(async (t, i) => {
        if (skipped.has(i)) return page(i + 1, t, 'OCR', 'not_processed');
        if (ocrText.has(i)) {
          // Keep any text-layer fragment the page had alongside its OCR, without duplicating it.
          const o = ocrText.get(i)!;
          return page(i + 1, o || t, 'OCR', o || t ? 'ok' : 'empty');
        }
        if (needOcr.includes(i) && !t) {
          return page(i + 1, '', 'OCR', source ? 'empty' : 'not_processed');
        }
        return page(i + 1, t, 'TEXT_LAYER', t ? 'ok' : 'empty');
      })
    );
    if (skipped.size) {
      const list = [...skipped].map((i) => i + 1);
      incomplete.push(`${skipped.size} scanned page(s) were not read because one request reads at most ${MAX_OCR_PAGES} scanned pages: ${list.slice(0, 20).join(', ')}${list.length > 20 ? ', ...' : ''}. Split the PDF and upload the rest separately.`);
    }
    const empty = pages.filter((p) => p.status === 'empty').map((p) => p.pageNumber);
    if (empty.length) incomplete.push(`No text was found on page(s) ${empty.join(', ')}.`);
  }

  const perPage = pageCount !== null;
  const extractedText = perPage
    ? pages.filter((p) => p.text).map((p) => `[Page ${p.pageNumber}]\n${p.text}`).join('\n\n')
    : pages.map((p) => p.text).join('\n\n');
  return {
    documentId,
    fileName,
    mimeType,
    detectedType: type,
    pageCount,
    pageAttribution: perPage ? 'per-page' : 'unavailable',
    pages,
    extractedText,
    incomplete,
    ocr: ocrStats.calls ? ocrStats : null,
  };
}

export { GeminiError };
