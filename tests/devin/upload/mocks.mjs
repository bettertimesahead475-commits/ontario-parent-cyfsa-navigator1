import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

export const origin = 'https://cyfsanavigator.com';
const pdf = 'application/pdf';
const word = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
export const fixtures = [
  ['synthetic-cas-letter.txt', 'text/plain', 'plain'],
  ['synthetic-cas-letter.pdf', pdf, 'pdf'],
  ['synthetic-cas-scanned.pdf', pdf, 'ocr'],
  ['synthetic-cas-letter.docx', word, 'docx'],
  ['synthetic-cas-letter.png', 'image/png', 'ocr'],
  ['synthetic-cas-letter.jpg', 'image/jpeg', 'ocr'],
  ['synthetic-oversized.pdf', pdf, 413, 'FILE_TOO_LARGE', 'File is too large. The limit is 20 MB.'],
  ['synthetic-empty.pdf', pdf, 422, 'EXTRACTION_EMPTY', 'No readable text could be extracted from this file.'],
  ['synthetic-wrong-extension.pdf', pdf, 415, 'FILE_TYPE_MISMATCH', "The file's contents do not match its type or extension."],
  ['synthetic-corrupted.pdf', pdf, 422, 'PDF_MALFORMED', 'This PDF appears to be damaged and could not be read.'],
];
const hash = value => createHash('sha256').update(value).digest('hex');
const paidPath = /^\/api\/(?:deep-scan|transcribe(?:-audio)?|case-timeline|rag-query|extract-evidence)\/?$/;
const matterPaidPath = /^\/api\/matters\/[^/]+\/(?:documents|document-versions\/[^/]+\/pages\/[^/]+\/evidence)\/?$/;
const googleAuthHosts = new Set([
  'accounts.google.com', 'apis.google.com', 'www.googleapis.com', 'www.google.com', 'www.gstatic.com',
  'identitytoolkit.googleapis.com', 'securetoken.googleapis.com', 'gen-lang-client-0105737183.firebaseapp.com',
]);

export function routeFor(url, method) {
  const { origin: target, hostname, pathname } = new URL(url);
  if (/(?:^|\.)(?:anthropic\.com|generativelanguage\.googleapis\.com|aiplatform\.googleapis\.com)$/.test(hostname)
      || /-aiplatform\.googleapis\.com$/.test(hostname)) return 'block';
  if (target !== origin) {
    if (target.startsWith('https://') && googleAuthHosts.has(hostname)) return 'allow';
    return method === 'GET' && ['fonts.googleapis.com', 'fonts.gstatic.com'].includes(hostname) ? 'allow' : 'block';
  }
  if (paidPath.test(pathname) || matterPaidPath.test(pathname)) return 'block';
  if (method === 'POST' && pathname === '/api/extract-text') return 'extract';
  if (method === 'POST' && pathname === '/api/analyze') return 'analyze';
  if (method === 'GET' && /^\/api\/analyze\/job\/[^/]+$/.test(pathname)) return 'job';
  if (method === 'GET' && pathname === '/api/final-case-assessment') return 'assessment';
  if (method === 'GET' && pathname === '/api/analyzer-usage') return 'usage';
  if (pathname === '/api' || pathname.startsWith('/api/')) return 'block';
  return ['GET', 'HEAD'].includes(method) ? 'allow' : 'block';
}

export function buildCases(fixtureDir) {
  const txt = readFileSync(join(fixtureDir, fixtures[0][0]), 'utf8');
  const letter = txt.split('\n').slice(0, 6).join('\n');
  const title = txt.split('\n')[0];
  return fixtures.map(([name, mimeType, kind, code, error]) => {
    const bytes = readFileSync(join(fixtureDir, name));
    const documentId = 'doc_' + hash(bytes).slice(0, 16);
    const base = { name, mimeType, kind, digest: hash(bytes), size: bytes.length };
    if (typeof kind === 'number') return { ...base, code, error };
    if (kind === 'plain') return { ...base, text: txt };
    const pageTexts = kind === 'pdf' ? [
      letter + '\nNative-text PDF — Page 1: fictional correspondence.',
      title + '\nNative-text PDF — Page 2: fictional meeting agenda.\nThe second page includes the unique extraction marker QA-PAGE-TWO.',
    ] : [letter];
    const extractionMethod = { docx: 'DOCX_XML', pdf: 'TEXT_LAYER', ocr: 'OCR' }[kind];
    const pages = pageTexts.map((text, i) => {
      const pageNumber = kind === 'docx' ? null : i + 1;
      return {
        pageNumber, text, extractionMethod, status: 'ok', characters: text.length,
        checksum: hash(text).slice(0, 16), sourceLocation: { documentId, fileName: name, page: pageNumber },
      };
    });
    const text = pages.map(p => p.pageNumber ? '[Page ' + p.pageNumber + ']\n' + p.text : p.text).join('\n\n');
    return { ...base, text, extraction: {
      extractedText: text, characters: text.length, contentHash: hash(text),
      document: {
        documentId, fileName: name, mimeType,
        detectedType: mimeType === pdf ? 'pdf' : kind === 'docx' ? 'docx' : 'image',
        pageCount: kind === 'docx' ? null : pages.length,
        pageAttribution: kind === 'docx' ? 'unavailable' : 'per-page',
        extractionMethods: [extractionMethod], complete: true, incomplete: [],
        ocrModel: kind === 'ocr' ? 'gemini-2.5-flash' : null,
      },
      pages, timing: { extractMs: 120 },
    } };
  });
}

export function makeRouter(cases, record) {
  const jobs = new Map();
  const test = { name: 'bootstrap', variant: 'success', expected: [] };
  const json = (route, status, body) => route.fulfill({ status, json: body });
  const fail = (route, status, code, error) => json(route, status, { code, error, retryable: false });
  const stage = 'event: stage\ndata: ' + JSON.stringify({
    stage: 'reviewing_evidence', percent: 45, message: 'Mock review in progress',
  }) + '\n\n';
  return {
    select(name, expected, variant = 'success') { Object.assign(test, { name, expected, variant }); },
    async dispatch(route) {
      const req = route.request();
      const method = req.method();
      const url = new URL(req.url());
      const action = routeFor(url, method);
      if (action === 'allow') return route.continue();
      const entry = { scenario: test.name, method, path: url.pathname, action };
      if (action === 'extract' || action === 'analyze') {
        let body;
        try { body = req.postDataJSON(); } catch { body = null; }
        const file = body?.fileData;
        const bytes = typeof file?.base64 === 'string' ? Buffer.from(file.base64, 'base64') : null;
        const fixture = cases.find(item => item.name === file?.fileName);
        const verified = fixture && fixture.mimeType === file.mimeType && bytes && hash(bytes) === fixture.digest;
        if (action === 'extract') {
          // Record only the bounded fixture proof, never headers, tokens or unrecognized document bytes.
          entry.payload = { fileName: file?.fileName, mimeType: file?.mimeType,
            size: bytes?.length, sha256: bytes && hash(bytes), fixtureVerified: Boolean(verified) };
          record(entry);
          if (!verified) return fail(route, 400, 'UNKNOWN_QA_FIXTURE', 'Input did not match a synthetic QA fixture.');
          if (typeof fixture.kind === 'number') return fail(route, fixture.kind, fixture.code, fixture.error);
          return json(route, 200, fixture.extraction);
        }

        const matched = test.expected.filter(item => typeof item.text === 'string' && item.text === body?.textContent);
        const id = req.headers()['x-analysis-id'];
        entry.payload = { textContent: matched.length ? body.textContent : undefined, textCharacters: body?.textContent?.length,
          matchedFixtures: matched.map(item => item.name), mode: body?.mode, stream: body?.stream, analysisId: id,
          hasUnexpectedFileData: Boolean(body?.fileData) };
        record(entry);
        if (!matched.length) return fail(route, 400, 'UNEXPECTED_QA_PAYLOAD', 'Unexpected analyzer input reached the QA mock.');
        if (test.variant === '500') return fail(route, 500, 'INTERNAL_ANALYSIS_ERROR', 'Synthetic 500: unable to complete analysis.');
        const report = {
          documentTitle: 'Synthetic QA report: ' + matched[0].name,
          documentType: 'Correspondence', metadata: {}, disclaimer: 'Synthetic test report, not legal advice.',
          completenessScore: 40, evidenceStrengthIndex: { score: 35, components: {} },
          fileSummary: 'Mock report for Jane Testparent, Fictional CAS.',
          lawyerCaseBrief: ['Synthetic QA brief: no real case facts or legal findings.'],
          timing: { mode: 'fast', durationMs: 1200 },
        };
        if (id) jobs.set(id, { report, variant: test.variant, reads: 0 });
        if (!body.stream) return json(route, 200, report);
        const complete = 'event: complete\ndata: ' + JSON.stringify(report) + '\n\n';
        return route.fulfill({ status: 200, contentType: 'text/event-stream', body: stage + (test.variant === 'success' ? complete : '') });
      }
      record(entry);
      if (action === 'job') {
        const jobId = decodeURIComponent(url.pathname.split('/').at(-1));
        const job = jobs.get(jobId);
        if (!job) return json(route, 404, { code: 'ANALYSIS_JOB_NOT_FOUND' });
        if (job.variant === 'timeout' && job.reads++ === 0) return json(route, 200, {
          jobId, status: 'running', currentStage: 'reviewing_evidence', percent: 45, message: 'Mock job running',
        });
        if (job.variant === 'timeout') return json(route, 200, {
          jobId, status: 'timed_out',
          error: { code: 'ANALYSIS_TIMEOUT', message: 'Synthetic timeout: analysis timed out.', statusCode: 504, retryable: false },
        });
        return json(route, 200, { jobId, status: 'completed', report: job.report });
      }
      if (action === 'assessment') return json(route, 200, {
        matters: [], allowance: 'One shared Deep Scan credit per new matter source set; five per paid month. Reopening and retries do not add a charge.',
      });
      if (action === 'usage') return json(route, 200, {});
      return route.abort('blockedbyclient');
    },
  };
}
