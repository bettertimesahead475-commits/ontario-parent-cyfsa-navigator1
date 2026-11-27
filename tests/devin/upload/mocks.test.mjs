import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { buildCases, makeRouter, origin, routeFor } from './mocks.mjs';

const dir = process.env.CYFSA_QA_FIXTURES || join(homedir(), 'qa-fixtures');
const cases = buildCases(dir);

test('route allowlist blocks paid APIs, providers, and unrecognized mutations', () => {
  for (const path of [
    '/api/deep-scan', '/api/transcribe', '/api/transcribe-audio', '/api/case-timeline',
    '/api/rag-query', '/api/extract-evidence', '/api/matters/1/documents',
    '/api/matters/1/document-versions/2/pages/3/evidence', '/api/final-case-assessment',
    '/api/request-access', '/api/unknown', '/document-analyzer',
  ]) assert.equal(routeFor(origin + path + '?probe=1', 'POST'), 'block', path);
  for (const url of [
    'https://generativelanguage.googleapis.com/v1beta',
    'https://us-central1-aiplatform.googleapis.com/v1', 'https://api.anthropic.com/v1/messages',
    'https://unknown.example/api/extract-text',
  ]) assert.equal(routeFor(url, 'POST'), 'block', url);
  assert.equal(routeFor(origin + '/api/extract-text', 'POST'), 'extract');
  assert.equal(routeFor(origin + '/api/analyze', 'POST'), 'analyze');
  assert.equal(routeFor(origin + '/api/analyze/job/qa-123', 'GET'), 'job');
  assert.equal(routeFor(origin + '/document-analyzer', 'GET'), 'allow');
  assert.equal(routeFor('https://accounts.google.com/', 'GET'), 'allow');
});

function driver() {
  const records = [];
  const router = makeRouter(cases, entry => records.push(entry));
  const dispatch = (method, path, body, headers = {}) => router.dispatch({
    request: () => ({
      method: () => method, url: () => new URL(path, origin).href,
      postDataJSON: () => body, headers: () => headers,
    }),
    fulfill: response => response, abort: () => 'aborted', continue: () => 'continued',
  });
  return { router, records, dispatch };
}

test('only byte-verified fixtures return the expected extraction response or rejection', async () => {
  const { dispatch, records } = driver();
  for (const file of cases.filter(item => item.kind !== 'plain')) {
    const fileData = {
      base64: readFileSync(join(dir, file.name)).toString('base64'),
      mimeType: file.mimeType, fileName: file.name,
    };
    const result = await dispatch('POST', '/api/extract-text', { fileData });
    assert.equal(result.status, file.error ? file.kind : 200, file.name);
    assert.equal(result.json.code, file.code);
    assert.equal(result.json.extractedText, file.text);
    assert.equal(records.at(-1).payload.fixtureVerified, true);
    assert.ok(!('base64' in records.at(-1).payload));
  }
  const bogus = await dispatch('POST', '/api/extract-text', {
    fileData: { base64: 'YQ==', mimeType: cases[1].mimeType, fileName: cases[1].name },
  });
  assert.equal(bogus.json.code, 'UNKNOWN_QA_FIXTURE');
});

test('analyzer SSE, batch JSON, terminal 500, timeout polling and recovery stay mocked', async () => {
  const { dispatch, router, records } = driver();
  const [text] = cases;
  const send = (stream, id) => dispatch('POST', '/api/analyze', {
    stream, textContent: text.text, mode: 'fast', sessionId: 'TEST_SECRET_NEVER_CAPTURE',
  }, { 'x-analysis-id': id });
  router.select('batch', [text]);
  assert.match((await send(false, 'batch')).json.documentTitle, /synthetic-cas-letter\.txt/);
  assert.match((await send(true, 'normal')).body, /event: complete/);
  router.select('500', [text], '500');
  assert.equal((await send(true, '500')).status, 500);
  router.select('timeout', [text], 'timeout');
  assert.doesNotMatch((await send(true, 'timeout')).body, /event: complete/);
  assert.equal((await dispatch('GET', '/api/analyze/job/timeout')).json.status, 'running');
  assert.equal((await dispatch('GET', '/api/analyze/job/timeout')).json.status, 'timed_out');
  router.select('recover', [text], 'recover');
  assert.doesNotMatch((await send(true, 'recover')).body, /event: complete/);
  assert.equal((await dispatch('GET', '/api/analyze/job/recover')).json.status, 'completed');
  assert.doesNotMatch(JSON.stringify(records), /TEST_SECRET_NEVER_CAPTURE/);
  await dispatch('POST', '/api/analyze', { textContent: 'non-fixture data' });
  assert.equal(records.at(-1).payload.textContent, undefined);
});
