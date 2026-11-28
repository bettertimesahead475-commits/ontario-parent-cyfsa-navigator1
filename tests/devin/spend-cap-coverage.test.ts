import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import ts from 'typescript';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as firebase from '../../functions/api/_auth-check';
import { RATE_LIMITS } from '../../functions/api/_rate-limit';
import { onRequestPost as transcribe } from '../../functions/api/transcribe';
import { onRequestPost as transcribeAudio } from '../../functions/api/transcribe-audio';

const source = (path: string) => readFileSync(resolve(process.cwd(), path), 'utf8');
const pages = (name: string) => source(`functions/api/${name}.ts`);
const services = (name: string) => source(`api/services/${name}.ts`);
const trial = existsSync(resolve('functions/api/_free-trial.ts'));
const branch = trial ? 'trial' : 'integration';
const analyze = pages('analyze');
const analysis = analyze.slice(analyze.indexOf('export async function handleAnalyzeRequest'));
const sections = services('analyzerSections');
const assessment = pages('final-case-assessment');
const extraction = pages('extract-text');
const ocr = pages('_document-extraction');
const audio = pages('transcribe');
const gemini = pages('_gemini');
const worker = source('workers/analyzer-queue-consumer.ts');
const diag = pages('admin/analyzer-provider-check');
const freeTrial = trial ? pages('_free-trial') : '';
const legacy = source('api/_server.ts');
const legacyTree = ts.createSourceFile('api/_server.ts', legacy, ts.ScriptTarget.Latest, true);
const localRoutes = new Map<string, string>();
function collectPosts(node: ts.Node) {
  if (ts.isCallExpression(node) && node.expression.getText(legacyTree) === 'app.post') {
    const [path] = node.arguments;
    if (path && ts.isStringLiteral(path)) localRoutes.set(path.text, node.getText(legacyTree));
  }
  ts.forEachChild(node, collectPosts);
}
collectPosts(legacyTree);
const route = (name: string) => {
  const handler = localRoutes.get(`/api/${name}`);
  if (!handler) throw new Error(`Missing legacy route: ${name}`);
  return handler;
};
const has = (code: string, ...markers: string[]) => markers.every(marker => code.includes(marker));
const lacks = (code: string, pattern: RegExp) => !pattern.test(code);
const before = (code: string, first: string, second: string) => {
  const start = code.indexOf(first);
  return start >= 0 && code.indexOf(second, start + first.length) >= 0;
};
const credit = /(?:reserveVerifiedPaidCredit|reserveAnalysisCredit|reserveFreeScan|reserveFreeTrial|checkAndConsumeFreeToolUse|takeCapUnit)\(/;
const sharedLimit = /_persistent-rate-limit|persistentRateLimitRetryAfter\(/;
const extraCap = /(?:takeCapUnit|reserveFreeTrial|authorizeFreeOcr)\(/;
const localLimit = /rateLimitRetryAfter\(/;
const noDuration = (code: string) => lacks(code, /(?:MAX_AUDIO_DURATION|DURATION_LIMIT|duration\s*>)/i);

const keys = ['auth', 'credit', 'local', 'shared', 'trial-cap', 'input', 'execution', 'output'] as const;
type Proof = [accounted: boolean, assertion: boolean];
const a = (assertion: boolean): Proof => [true, assertion];
const u = (assertion: boolean): Proof => [false, assertion];
const cases = new Map<string, Record<(typeof keys)[number], Proof>>();
function row(name: string, ...proofs: [Proof, Proof, Proof, Proof, Proof, Proof, Proof, Proof]) {
  cases.set(name, Object.fromEntries(keys.map((key, i) => [key, proofs[i]])) as Record<(typeof keys)[number], Proof>);
}

const quickAuth = a(before(analysis, 'await verifyFirebaseRequest', 'await reserveVerifiedPaidCredit'));
const paidCredit = a(has(analysis, 'await reserveVerifiedPaidCredit(', 'await finalizePaidReservation(', 'await releasePaidReservation(', 'else if (isOwner)'));
const analyzeLocal = a(has(analysis, "rateLimitRetryAfter('analyze', rateLimitSubject(request, uid), RATE_LIMITS.analyze)"));
const analyzeShared = u(lacks(analyze, sharedLimit));
const analyzePaidCap = trial
  ? a(has(analysis, "takeCapUnit(platformDailyKey('paid', new Date())", "if (paidCap === 'limit')")
    && before(analysis, "if (paidCap === 'limit')", 'await reserveVerifiedPaidCredit')
    && lacks(analysis, /paidCap\s*===\s*'unavailable'/) && has(freeTrial, 'PAID_PLATFORM_DAILY_LIMIT: 300'))
  : u(lacks(analyze, extraCap));
const analyzeFreeCap = trial
  ? a(has(analysis, 'await reserveFreeTrial(', "trial.status === 'ip_limit'", "trial.status === 'paused'")
    && has(freeTrial, 'await ipDayKey(req.ip, now)', 'await ipMonthKey(req.ip, now)', 'if (req.ip)', "platformDailyKey('paid', now)", "platformDailyKey(lane, now)", 'return refuse(',
      'FREE_TRIAL_IP_DAILY_LIMIT: 6', 'FREE_TRIAL_IP_MONTHLY_LIMIT: 15', 'FREE_QUICK_PLATFORM_DAILY_LIMIT: 25',
      'FREE_FORENSIC_PLATFORM_DAILY_LIMIT: 10', 'FREE_TRIAL_PAUSE_AT_PAID_DAILY: 200'))
  : u(lacks(analyze, extraCap));
const quickInput = a(has(analysis, 'documentText.length > DIRECT_ANALYSIS_MAX_CHARS') && has(services('directAnalyzer'), 'DIRECT_ANALYSIS_MAX_CHARS = 75_000'));
const forensicInput = trial
  ? a(has(analysis, 'documentText.length > FREE_TRIAL_MAX_CHARS[kind]') && has(freeTrial, 'forensic: 105_000'))
  : u(lacks(analysis.slice(analysis.indexOf('await verifyFirebaseRequest')), /documentText\.length\s*>\s*(?!DIRECT_ANALYSIS_MAX_CHARS)[A-Z_]+/) && has(sections, 'opts.documentText, retryNote'));
const analyzerExecution = a(has(analysis, '100_000', '180_000', 'deadlineAt: aiDeadlineAt')
  && has(sections, 'attempt <= SECTION_ATTEMPTS', 'attempt <= VERIFICATION_ATTEMPTS', 'retries: opts.mode === "full" ? 0 : 1'));
const analyzerOutput = a(has(sections, 'max_tokens: spec.maxTokens[opts.mode]', 'max_tokens: 4000'));
row('quick-free', quickAuth, trial
  ? a(has(analysis, 'await reserveFreeTrial(', 'await finalizeFreeReservation(', 'await releaseFreeReservation(') && has(freeTrial, 'legacyUsed > 0', 'await freeTrialKey'))
  : a(has(analysis, 'await reserveFreeScan(uid, requestId, rpc)', 'await finalizeFreeScan(', 'await releaseFreeScan(') && has(pages('_free-credit-reservation'), 'FREE_SCAN_LIMIT = 3')),
analyzeLocal, analyzeShared, analyzeFreeCap, quickInput, analyzerExecution, analyzerOutput);
row('quick-paid', quickAuth, paidCredit, analyzeLocal, analyzeShared, analyzePaidCap, quickInput, analyzerExecution, analyzerOutput);
const alias = pages('deep-scan');
const deepDispatch = has(alias, "mode: 'full'", 'return handleAnalyzeRequest(forensicRequest, env, deps, waitUntil)');
const forensicQueue = has(analysis, 'await enqueueAnalyzerJob') || has(analysis, 'await enqueueDurableJob');
const paidDeepInput = u(has(sections, 'opts.documentText, retryNote') && lacks(analysis, /documentText\.length\s*>\s*(?!DIRECT_ANALYSIS_MAX_CHARS|FREE_TRIAL_MAX_CHARS)[A-Z_]+/));
row('deep-unpaid', a(deepDispatch && quickAuth[1]), trial
  ? a(has(analysis, 'const kind = isForensic', 'await reserveFreeTrial(') && has(freeTrial, "await freeTrialKey('forensic', email)"))
  : a(has(analysis, 'if (isForensic)', "code: 'UPGRADE_REQUIRED'")),
analyzeLocal, analyzeShared, analyzeFreeCap, forensicInput, analyzerExecution, analyzerOutput);
row('deep-paid', a(deepDispatch && quickAuth[1]), paidCredit, analyzeLocal, analyzeShared, analyzePaidCap, paidDeepInput, analyzerExecution, analyzerOutput);
row('owner-analyze', quickAuth, u(before(analysis, 'else if (isOwner)', 'else if (sessionId)')), analyzeLocal, analyzeShared,
  u(before(analysis, 'else if (isOwner)', 'else if (sessionId)')), paidDeepInput, analyzerExecution, analyzerOutput);

// Matter ownership is checked inline (parallel reads, PR #208) and re-verified before the credit is consumed.
row('assessment', a(has(assessment, 'deps.authenticate || verifyFirebaseRequest', 'await readVerifiedPaidSession', "session.tier !== 'Pro'", "role: 'eq.OWNER'", 'await reverifyOwnedMatter()')),
  a(before(assessment, "reserveVerifiedPaidCredit(paid.session, 'forensic'", 'const result = await generate(') && has(assessment, 'await releasePaidReservation(', 'await finalizePaidReservation(')),
  u(lacks(assessment, localLimit)), u(lacks(assessment, sharedLimit)), u(lacks(assessment, extraCap)),
  a(has(assessment, 'size > ASSESSMENT_REQUEST_MAX_BYTES', 'docs.length > ASSESSMENT_MAX_SOURCES', 'sourceText.length > ASSESSMENT_SOURCE_SET_MAX_CHARS')
    && has(source('shared/assessmentLimits.ts'), '150000', '75000', 'ASSESSMENT_MAX_SOURCES = 20')),
  a(has(assessment, 'timeoutMs: 75000, retries: 0')), a(has(assessment, 'max_tokens: 6000', '}, DEFAULT_FORENSIC_MODEL)')));

const ocrAuth = a(before(extraction, 'await verifyFirebaseRequest', 'await extractDocument') || before(extraction, 'await verifyFirebaseRequest', 'await extractText'));
const ocrLocal = a(has(extraction, "rateLimitRetryAfter('extractText'", 'RATE_LIMITS.extractText'));
const ocrShared = u(lacks(extraction + ocr, sharedLimit));
const ocrInput = a(has(extraction, 'MAX_BASE64_CHARS') && has(ocr, 'MAX_FILE_BYTES = 20 * 1024 * 1024', 'MAX_PDF_PAGES = 200', 'MAX_OCR_PAGES = 30'));
const geminiRetry = has(gemini, 'opts.maxAttempts ?? 2', 'Math.min(3,');
const ocrExecution = a(geminiRetry && has(ocr, 'OCR_PAGE_TIMEOUT_MS = 60_000', 'EXTRACTION_TIMEOUT_MS = 120_000', 'await ocr('));
const ocrOutput = a(has(ocr, 'maxOutputTokens: 8192'));
row('ocr-free', ocrAuth, trial
  ? a(has(extraction, 'await authorizeFreeOcr(') && has(freeTrial, 'FREE_OCR_LIFETIME_LIMIT = FREE_TRIAL_LIMITS.quick + FREE_TRIAL_LIMITS.forensic', 'await readFreeTrialBalance(', 'await takeCapUnit(await freeOcrKey('))
  : u(lacks(extraction + ocr, credit)),
ocrLocal, ocrShared, trial ? a(has(freeTrial, "takeCapUnit(platformDailyKey('ocr', now)", 'FREE_OCR_PLATFORM_DAILY_LIMIT: 30') && has(ocr, 'await authorizeOcr()'))
  : u(lacks(extraction + ocr, extraCap)),
trial ? a(ocrInput[1] && has(extraction, 'maxBytes: FREE_TRIAL_MAX_BYTES', 'maxPages: FREE_TRIAL_MAX_PAGES') && has(freeTrial, 'FREE_TRIAL_MAX_BYTES = 10 * 1024 * 1024', 'FREE_TRIAL_MAX_PAGES = 30')) : ocrInput,
ocrExecution, ocrOutput);
row('ocr-paid-owner', a(ocrAuth[1] && (trial ? has(extraction, "paid = read.status === 'verified'", 'identity.emailVerified') : lacks(extraction, /readVerifiedPaidSession\(/))),
  // The owner's OCR is unmetered; paid accounts are now metered per use (takePaidUsageUnit).
  u(trial ? has(extraction, 'const extractionDeps = isOwner ? {} : paid ?') : lacks(extraction + ocr, credit)),
  ocrLocal, ocrShared, u(trial ? has(extraction, 'const extractionDeps = isOwner ? {} : paid ?') : lacks(extraction + ocr, extraCap)),
  ocrInput, ocrExecution, ocrOutput);

row('audio', a(has(pages('transcribe-audio'), 'export const onRequestPost = transcribePost') && before(audio, 'await verifyFirebaseRequest', 'await generateGemini')
  && (trial ? has(audio, 'await readVerifiedPaidSession(', "paid.status !== 'verified'", 'if (!isOwner)') : lacks(audio, /readVerifiedPaidSession\(/))),
u(lacks(audio, credit)), a(has(audio, "rateLimitRetryAfter('transcribe'", 'RATE_LIMITS.transcribe')), u(lacks(audio, sharedLimit)), u(lacks(audio, extraCap)),
a(has(audio, 'audioData.length > MAX_TRANSCRIBE_AUDIO_CHARS', 'MAX_TRANSCRIBE_AUDIO_CHARS = 10 * 1024 * 1024') && noDuration(audio)),
a(geminiRetry && has(audio, 'timeoutMs: 60_000')), a(has(audio, 'maxOutputTokens: 8192')));

const relay = source('workers/staging-job-service.ts') + source('workers/staging-job-service-entrypoint.js') + source('workers/staging-queue-relay.ts');
row('queue', a(has(worker, 'await claimDurableJob(', 'trustedJob:', 'const input = await loadDurableInput(')
  && has(relay, 'executeStagingJob(', 'processJob(') && before(worker, 'await claimDurableJob(', 'await handleAnalyzeRequest(')),
a(has(worker, 'loadPersistedReport(', 'await finalizePaidReservation(', 'await releasePaidReservation(',
  trial ? 'await finalizeFreeReservation(' : 'await finalizeFreeScan(', trial ? 'await releaseFreeReservation(' : 'await releaseFreeScan(')
  && has(analysis, 'reservationId = deps.trustedJob.reservation_id')),
u(lacks(worker, localLimit) && has(analysis, 'if (!deps.trustedJob) {')), u(lacks(worker + relay, sharedLimit)),
// Free-trial: a redelivered free job spends from the entitlement's lifetime run budget (takeCapUnit in the worker).
trial ? a(has(worker, 'takeCapUnit(freeAttemptKey(') && before(analysis, 'if (deps.trustedJob) {', 'else if (sessionId)'))
  : u(lacks(worker + relay, extraCap) && before(analysis, 'if (deps.trustedJob) {', 'else if (sessionId)')), paidDeepInput,
a(analyzerExecution[1] && has(worker, 'attempt_count < 6', 'retryDelay(message.attempts)') && has(source('wrangler.production-analyzer-queue-consumer.jsonc'), '"max_retries": 5')), analyzerOutput);

row('staging-probe', a(has(diag, 'STAGING_PROVIDER_CHECKS_ENABLED', 'await verifyFirebaseRequest(', 'STAGING_PROVIDER_CHECK_UIDS', 'ANALYZER_PROVIDER_EXECUTOR.checkProvider(')
  && has(source('workers/staging-provider-service.ts'), 'await handleProviderCheck(')),
u(lacks(diag, credit)), u(lacks(diag, localLimit)), u(lacks(diag, sharedLimit)), u(lacks(diag, extraCap)),
a(has(diag, 'FIXED_SYNTHETIC_INPUT_ONLY', 'documentText: fixture')), a(analyzerExecution[1] && has(diag, '178000 : 98000')), analyzerOutput);

const cli = source('scripts/runLiveClaudeVerification.ts');
row('live-cli', a(has(cli, 'process.env.ANTHROPIC_API_KEY', 'if (!apiKey')), u(lacks(cli, credit)),
  u(lacks(cli, localLimit)), u(lacks(cli, sharedLimit)), u(lacks(cli, extraCap)), a(has(cli, 'await generateThreePageAffidavitPdf()')),
  a(has(cli, 'maxRetries: 1', 'client.messages.create(', 'timeout: fastResolution.timeoutMs', 'timeout: fullResolution.timeoutMs')),
  a(has(cli, 'max_tokens: fastResolution.tokenBudget', 'max_tokens: TOKEN_BUDGETS.FORENSIC_PASS_1', 'max_tokens: TOKEN_BUDGETS.FORENSIC_PASS_2')));

const globalLegacy = has(legacy, "app.use('/api', apiLimiter)", 'express.json({ limit: "100mb" })');
const geminiLegacy = has(legacy, 'const maxAttempts = 3;', 'await ai.models.generateContent(');
const anthropicLegacy = has(legacy, 'params.retries ??', 'max_tokens: params.max_tokens ||', 'client.messages.stream(createOptions, { timeout: timeoutMs })');
const legacyBodies = source('api/documentRoutes.ts');
const docSvc = services('documentSources');
const legacyClock = a(anthropicLegacy);
const legacyOut = a(has(legacy, 'max_tokens: params.max_tokens ||'));
function expressRow(name: string, code: string, auth: Proof, accounting: Proof, input: Proof, execution: Proof, output: Proof, dedicated: boolean) {
  row(`express-${name}`, auth, accounting,
    a(globalLegacy && (dedicated ? /aiCostLimiter|costLimit/.test(code) : lacks(code.split('\n')[0], /aiCostLimiter/))),
    u(lacks(code, sharedLimit)), u(lacks(code, extraCap)), input, execution, output);
}
const noCredit = (code: string) => u(lacks(code, credit));
const genericInput = a(globalLegacy);
for (const [name, gate, inputMarker, gem, output] of [
  ['search-connectors', 'await requireSession(', 'query.length > 2000', true, false],
  ['extract-text', 'await verifyFirebaseToken(', 'fileData.base64.length > MAX_EXTRACT_BASE64_CHARS', true, false],
  ['case-timeline', 'await requireCaseAccess(', 'documents.slice(0, MAX_DOCS)', false, true],
  ['rag-query', 'await requireSession(', '', false, true],
  ['extract-evidence', 'await allowFreeToolUse(', '', false, true],
  ['transcribe', '', 'audioData.length > MAX_TRANSCRIBE_AUDIO_CHARS', true, true],
  ['transcribe-audio', '', 'audioData.length > MAX_TRANSCRIBE_AUDIO_CHARS', true, false],
] as const) {
  const code = route(name);
  expressRow(name, code, gate ? a(has(code, gate)) : u(lacks(code, /await (?:requireSession|verifyFirebase|allowFreeToolUse)/)),
    name === 'extract-evidence' ? a(has(code, gate) && has(legacy, 'await checkAndConsumeFreeToolUse(')) : noCredit(code),
    a(globalLegacy && (!inputMarker || has(code, inputMarker))), gem ? a(geminiLegacy) : legacyClock,
    output && !gem ? legacyOut : u(lacks(code, /maxOutputTokens\s*:/)), gem);
}
for (const name of ['analyze', 'deep-scan']) {
  const code = route(name);
  expressRow(name, code, a(has(code, 'await verifyFirebaseIdentity(')),
    a(has(code, 'await reserveAnalysisCredit(', 'await finalizeAnalysisCredit(', 'await releaseAnalysisReservation(')),
    genericInput, name === 'analyze' ? a(anthropicLegacy && geminiLegacy && has(code, 'await extractTextWithGeminiBase64(')) : legacyClock,
    name === 'analyze' ? u(legacyOut[1] && lacks(code, /maxOutputTokens\s*:/)) : legacyOut, false);
}
const documentUpload = legacyBodies.slice(legacyBodies.indexOf("app.post('/api/matters/:matterId/documents'"), legacyBodies.indexOf('app.get('));
const pageEvidence = legacyBodies.slice(legacyBodies.indexOf("app.post('/api/matters/:matterId/document-versions"));
const documentAuth = a(has(legacyBodies, 'await verifyFirebaseToken('));
expressRow('matter-ocr', documentUpload, documentAuth, noCredit(documentUpload + docSvc),
  a(globalLegacy && has(documentUpload, 'uploadSource(') && has(services('pageSources'), 'base64.length > 30_000_000', 'pageCount > 20')),
  a(geminiLegacy && has(legacy, 'registerDocumentRoutes(app, ocrSingleSourceWithGemini')),
  u(lacks(legacy.slice(legacy.indexOf('async function ocrSingleSourceWithGemini'), legacy.indexOf('async function transcribeAudioWithGemini')), /maxOutputTokens\s*:/)), true);
expressRow('page-evidence', pageEvidence, a(documentAuth[1] && has(pageEvidence, 'evidenceAccess,', 'analyzeSourcePage(')),
  noCredit(pageEvidence + docSvc), a(has(docSvc, 'run.page.text.length>30000')),
  a(has(legacy, 'new Anthropic({ apiKey, maxRetries: 1 })')), a(has(legacy, 'model: "claude-sonnet-5", max_tokens: 8000')), true);
const marketingRoute = services('marketing/routes');
const marketing = services('marketing/ai');
expressRow('marketing', marketingRoute, a(has(marketingRoute, 'post("/generate", requireAdmin', 'await generateMarketingPosts(')),
  noCredit(marketingRoute + marketing), genericInput, u(lacks(marketing, /maxRetries|AbortSignal|timeout:/)),
  a(has(marketing, 'max_tokens: 4000')), false);

describe(`spend cap: ${branch}`, () => {
  const blockedFetch = vi.fn(() => { throw new Error('Network forbidden in spend-cap tests'); });
  beforeEach(() => {
    blockedFetch.mockClear();
    vi.stubGlobal('fetch', blockedFetch);
  });
  afterEach(() => {
    try { expect(blockedFetch).not.toHaveBeenCalled(); }
    finally {
      vi.restoreAllMocks();
      vi.unstubAllGlobals();
    }
  });

  for (const [id, controls] of cases) {
    for (const name of keys) {
      const [accounted, condition] = controls[name];
      it(`${id} / ${name} / ${accounted ? 'accounted' : 'unaccounted'}`, () => expect(condition).toBe(true));
    }
  }

  it('deep-scan delegates full work to the effective Pages queue producer', () => {
    expect(deepDispatch && (forensicQueue || has(analysis, '.send(createAnalyzerQueueMessage('))).toBe(true);
  });

  it('audio aliases share the UID bucket and the trial paid-session gate', async () => {
    vi.spyOn(firebase, 'verifyFirebaseRequest').mockResolvedValue({
      status: 'verified', uid: 'spend-audit-audio', email: 'synthetic@example.test', emailVerified: true,
    });
    const geminiFetch = vi.fn(async (url: string) => {
      if (!/^https:\/\/generativelanguage\.googleapis\.com\/v1beta\/models\/[^/]+:generateContent$/.test(url)) {
        return blockedFetch();
      }
      return Response.json({ candidates: [{ content: { parts: [{ text: 'Synthetic transcript.' }] } }] });
    });
    vi.stubGlobal('fetch', geminiFetch);
    const env = { FIREBASE_PROJECT_ID: 'synthetic', GEMINI_API_KEY: 'not-a-real-key' };
    for (let i = 0; i <= RATE_LIMITS.transcribe.limit; i++) {
      const handler = i % 2 === 0 ? transcribe : transcribeAudio;
      const result = await handler({ env, request: new Request('https://example.test/api/transcribe', {
        method: 'POST', body: JSON.stringify({ audioData: 'UklGRg==', mimeType: 'audio/wav' }),
      }) });
      expect(result.status).toBe(i === RATE_LIMITS.transcribe.limit ? 429 : trial ? 402 : 200);
    }
    expect(geminiFetch).toHaveBeenCalledTimes(trial ? 0 : RATE_LIMITS.transcribe.limit);
  });
});
