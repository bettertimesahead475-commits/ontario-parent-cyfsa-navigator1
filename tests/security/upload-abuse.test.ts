// T-14 (c): oversized bodies, wrong or disguised content types, DOCX/ZIP decompression bombs, huge page counts and
// path-like filenames are refused (or bounded) before any expensive work, provider call or storage write.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { strToU8, zipSync } from 'fflate';
import { PDFDocument } from 'pdf-lib';
import { PROJECT, installFirebase, sharedFetcher, type Firebase } from './_firebase';
import { fakeSupabase, type FakeSupabase } from './_supabase';
import { handleExtractRequest } from '../../functions/api/extract-text';
import { MAX_FILE_BYTES, MAX_PDF_PAGES, DOCX_MAX_PART_BYTES } from '../../functions/api/_document-extraction';
import { onRequestPost as transcribe } from '../../functions/api/transcribe';
import { handleAssessment } from '../../functions/api/final-case-assessment';
import { ASSESSMENT_REQUEST_MAX_BYTES } from '../../shared/assessmentLimits';

const env: any = {
  FIREBASE_PROJECT_ID: PROJECT, ANALYZER_ENABLED: 'true', GEMINI_API_KEY: 'synthetic-gemini',
  STAGING_SUPABASE_URL: 'https://synthetic.supabase.test/', STAGING_SUPABASE_SERVICE_ROLE_KEY: 'eyJhbGciOiJIUzI1NiJ9.eyJyb2xlIjoic2VydmljZV9yb2xlIn0.c2ln',
};
let fb: Firebase; let db: FakeSupabase; let n = 0;
beforeEach(async () => {
  vi.unstubAllGlobals();
  fb = await installFirebase(); db = fakeSupabase(); fb.respond = db.handle;
  for (const m of ['warn', 'error', 'info', 'log'] as const) vi.spyOn(console, m).mockImplementation(() => {});
});
// A fresh uid per request keeps the per-user rate limits out of the way.
const auth = async (sub = `uploader_${++n}`) => `Bearer ${await fb.token({ sub })}`;
const b64 = (u: Uint8Array) => Buffer.from(u).toString('base64');
const extract = async (fileData: unknown, headers: Record<string, string> = {}, raw?: string) => handleExtractRequest(new Request('https://cyfsa.test/api/extract-text', {
  method: 'POST', headers: { Authorization: await auth(), 'Content-Type': 'application/json', ...headers }, body: raw ?? JSON.stringify({ fileData }),
}), env, { fetcher: sharedFetcher() });
const codeOf = async (res: Response) => (await res.clone().json()).code;

describe('upload abuse: /api/extract-text', () => {
  it('a declared Content-Length over the limit is refused with 413 before the body is read', async () => {
    const res = await handleExtractRequest(new Request('https://cyfsa.test/api/extract-text', {
      method: 'POST', headers: { Authorization: await auth(), 'Content-Type': 'application/json', 'Content-Length': String(40 * 1024 * 1024) }, body: '{}',
    }), env);
    expect([res.status, await codeOf(res)]).toEqual([413, 'FILE_TOO_LARGE']);
  });

  it('a base64 payload over 20 MB is refused with 413 without decoding it', async () => {
    const res = await extract({ base64: 'A'.repeat(Math.ceil((MAX_FILE_BYTES * 4) / 3) + 8), mimeType: 'application/pdf' });
    expect([res.status, await codeOf(res)]).toEqual([413, 'FILE_TOO_LARGE']);
    expect(fb.calls).toEqual([]);
  });

  it.each([
    ['a non-JSON multipart body', 'multipart/form-data; boundary=x', '--x\r\nContent-Disposition: form-data; name="file"\r\n\r\nMZ\r\n--x--'],
    ['an empty body', 'application/json', ''],
    ['fileData without base64', 'application/json', JSON.stringify({ fileData: { url: 'file:///etc/passwd' } })],
    ['a non-string base64', 'application/json', JSON.stringify({ fileData: { base64: { length: 1 } } })],
  ])('%s is a 400', async (_l, type, raw) => {
    const res = await extract(undefined, { 'Content-Type': type }, raw);
    expect(res.status).toBe(400);
    expect(fb.calls).toEqual([]);
  });

  it.each([
    ['a Windows executable declared as a PDF', strToU8('MZ\x90\x00\x03\x00\x00\x00 synthetic'), 'application/pdf', 'statement.pdf', 'UNSUPPORTED_TYPE'],
    ['an ELF binary', new Uint8Array([0x7f, 0x45, 0x4c, 0x46, 2, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0]), 'application/octet-stream', 'x', 'UNSUPPORTED_TYPE'],
    ['plain text declared as a PDF', strToU8('Synthetic plain text, not a PDF.'), 'application/pdf', 'a.pdf', 'FILE_TYPE_MISMATCH'],
    ['a PDF declared as an image', strToU8('%PDF-1.4\n%synthetic\n'), 'image/png', 'scan.png', 'FILE_TYPE_MISMATCH'],
    ['plain text with an .exe name', strToU8('Synthetic plain text.'), 'text/plain', 'notes.exe', 'FILE_TYPE_MISMATCH'],
    ['a legacy/protected OLE .doc', new Uint8Array([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1, 0, 0, 0, 0]), 'application/msword', 'old.doc', 'UNSUPPORTED_TYPE'],
  ])('%s is refused with 415 and nothing is sent to OCR or storage', async (_l, bytes, mimeType, fileName, code) => {
    const res = await extract({ base64: b64(bytes), mimeType, fileName });
    expect([res.status, await codeOf(res)]).toEqual([415, code]);
    expect(fb.calls).toEqual([]);
  });

  it('a DOCX bomb (document.xml inflating past 50 MB) is refused with 413 within 5 s (declared-size check, then the inflated-size check)', async () => {
    const bomb = zipSync({
      '[Content_Types].xml': strToU8('<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>'),
      'word/document.xml': new Uint8Array(DOCX_MAX_PART_BYTES + 1024),
    }, { level: 9 });
    expect(bomb.length).toBeLessThan(200_000);
    const started = Date.now();
    const res = await extract({ base64: b64(bomb), mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', fileName: 'bomb.docx' });
    expect([res.status, await codeOf(res)]).toEqual([413, 'FILE_TOO_LARGE']);
    expect(Date.now() - started).toBeLessThan(5_000);
    expect(fb.calls).toEqual([]);
  });

  it('a ZIP with many small parts summing past the limit is refused', async () => {
    const parts: Record<string, Uint8Array> = { '[Content_Types].xml': strToU8('<Types/>'), 'word/document.xml': strToU8('<w:document/>') };
    for (let i = 0; i < 60; i++) parts[`word/media/pad${i}.bin`] = new Uint8Array(1024 * 1024);
    const res = await extract({ base64: b64(zipSync(parts, { level: 9 })), mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', fileName: 'many.docx' });
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(res.status).toBeLessThan(500);
    expect(fb.calls).toEqual([]);
  });

  it(`a PDF with ${MAX_PDF_PAGES + 1} pages is refused with 413 TOO_MANY_PAGES and no OCR call`, async () => {
    const pdf = await PDFDocument.create();
    for (let i = 0; i <= MAX_PDF_PAGES; i++) pdf.addPage([200, 200]);
    const res = await extract({ base64: b64(await pdf.save()), mimeType: 'application/pdf', fileName: 'huge.pdf' });
    expect([res.status, await codeOf(res)]).toEqual([413, 'TOO_MANY_PAGES']);
    expect(fb.calls).toEqual([]);
  }, 30_000);

  it.each(['../../../../etc/passwd', '..\\..\\Windows\\System32\\config', '/var/lib/secret', 'C:\\x\\..\\..\\y', '%2e%2e%2fetc%2fpasswd'])(
    'path-like filename %j is only echoed as a bounded label: no fetch, storage key or path use', async (fileName) => {
      const res = await extract({ base64: b64(strToU8('Synthetic note for a path test.')), mimeType: 'text/plain', fileName });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.document.fileName).toBe(fileName);
      expect(fb.calls).toEqual([]);
      expect(db.writes).toEqual([]);
    });

  it('a path-like name ending in a mismatched extension is refused', async () => {
    const res = await extract({ base64: b64(strToU8('Synthetic.')), mimeType: 'text/plain', fileName: '../../../functions/api/_auth-check.ts' });
    expect([res.status, await codeOf(res)]).toEqual([415, 'FILE_TYPE_MISMATCH']);
  });

  it('a 10,000-character filename is truncated to 255 characters', async () => {
    const res = await extract({ base64: b64(strToU8('Synthetic.')), mimeType: 'text/plain', fileName: '../'.repeat(3334) });
    expect(res.status).toBe(200);
    expect((await res.json()).document.fileName.length).toBe(255);
  });
});

describe('upload abuse: /api/transcribe', () => {
  const post = async (body: unknown) => transcribe({ request: new Request('https://cyfsa.test/api/transcribe', { method: 'POST', headers: { Authorization: await auth(), 'Content-Type': 'application/json' }, body: JSON.stringify(body) }), env });

  it('audio over the size limit is refused with 413 and never sent to the provider', async () => {
    const res = await post({ audioData: 'A'.repeat(10 * 1024 * 1024 + 1), mimeType: 'audio/webm' });
    expect(res.status).toBe(413);
    expect(fb.calls).toEqual([]);
  });

  it.each(['application/x-msdownload', 'text/html', 'image/svg+xml', 'application/pdf'])('a %s "audio" upload is refused with 415 and never sent to the provider', async (mimeType) => {
    const res = await post({ audioData: btoa('synthetic'), mimeType });
    expect(res.status).toBe(415);
    expect(fb.calls).toEqual([]);
  });

  it('non-string audio data is a 400 without a provider call', async () => {
    const res = await post({ audioData: { length: 5 }, mimeType: 'audio/webm' });
    expect(res.status).toBe(400);
    expect(fb.calls).toEqual([]);
  });
});

describe('upload abuse: /api/final-case-assessment', () => {
  const SESSION = '0a0a0a0a-1111-4222-8333-444444444444';
  const MATTER = 'aaaaaaaa-1111-4222-8333-444444444444';
  const setup = (uid: string) => {
    db.tables = {
      navigator_paid_sessions: [{ id: SESSION, firebase_uid: uid, tier: 'Pro', issued_at: new Date(Date.now() - 1000).toISOString(), expires_at: new Date(Date.now() + 86400_000).toISOString(), revoked_at: null }],
      accounts: [{ id: 'acct', status: 'active', firebase_uid: uid }],
      navigator_matters: [{ id: MATTER, title: 'M', client_id: 'c', account_id: 'acct' }],
      navigator_matter_members: [{ matter_id: MATTER, account_id: 'acct', role: 'OWNER' }],
      clients: [{ id: 'c', account_id: 'acct' }],
    };
  };
  const post = async (path: string, body: string) => { const uid = `assessor_${++n}`; setup(uid); const generate = vi.fn();
    const res = await handleAssessment(new Request(`https://cyfsa.test${path}`, { method: 'POST', headers: { Authorization: `Bearer ${await fb.token({ sub: uid })}`, 'Content-Type': 'application/json', 'X-PS-Session': SESSION }, body }), env, { fetcher: sharedFetcher(), rpc: vi.fn(), generate } as any);
    return { res, generate }; };

  it('a body over the assessment request limit is refused with 413, with no generation and no write', async () => {
    const { res, generate } = await post(`/api/final-case-assessment?matterId=${MATTER}&action=source`, JSON.stringify({ filename: 'a.txt', text: 'x'.repeat(ASSESSMENT_REQUEST_MAX_BYTES) }));
    expect(res.status).toBe(413);
    expect(generate).not.toHaveBeenCalled();
    expect(db.writes).toEqual([]);
  });

  it.each(['../../assessment_sources/other_user/x.txt', '..%2F..%2Fx.txt'])('a path-like source filename %j never becomes part of the storage key', async (filename) => {
    const { res } = await post(`/api/final-case-assessment?matterId=${MATTER}&action=source`, JSON.stringify({ filename, text: 'Synthetic source text.' }));
    expect(res.status).toBe(200);
    expect(db.writes).toHaveLength(1);
    const key = new URL(db.writes[0].url).pathname;
    expect(key).not.toContain('..');
    expect(key).not.toContain('other_user');
    expect(key).toMatch(new RegExp(`/assessment_sources/[0-9a-f]+/${MATTER}/[0-9a-f]+(\\.json)?$`));
  });

  it.each([['an .exe source', 'payload.exe'], ['an over-long filename', 'a'.repeat(5000) + '.txt']])('%s is a 400 with no write', async (_l, filename) => {
    const { res } = await post(`/api/final-case-assessment?matterId=${MATTER}&action=source`, JSON.stringify({ filename, text: 'Synthetic.' }));
    expect(res.status).toBe(400);
    expect(db.writes).toEqual([]);
  });
});
