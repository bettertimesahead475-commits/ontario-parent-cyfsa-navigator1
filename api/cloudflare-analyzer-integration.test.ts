import { describe, expect, it, vi } from 'vitest';
import { handleAnalyzeRequest, type AnalyzerEnv } from '../functions/api/analyze';
import type { GenerateFn } from './services/analyzerSections';

const mockAuthVerification = vi.fn();
const mockSessionRead = vi.fn();

vi.mock('../functions/api/_auth-check', () => ({
  verifyFirebaseRequest: (req: Request, env: any) => mockAuthVerification(req, env),
  onRequestGet: vi.fn(),
}));

vi.mock('../functions/api/_supabase-paid-session', () => ({
  readVerifiedPaidSession: (env: any, uid: string, sessionId: string) => mockSessionRead(env, uid, sessionId),
}));

const SAMPLE_DOC = `
SUPERIOR COURT OF JUSTICE (FAMILY COURT)
CHILDREN'S AID SOCIETY OF TORONTO v. J. DOE
AFFIDAVIT OF INVESTIGATING WORKER
1. On October 12, 2026, the Society initiated an intake investigation.
2. An anonymous caller reported seeing the parent intoxicated.
3. On October 14, 2026, worker attended the family home.
4. The Society previously stated in writing: "we did not inform the court of the kinship option within the statutory window."
`;

const VALID_DIRECT_JSON = JSON.stringify({
  documentTitle: "Children's Aid Society Protection Application",
  documentType: "Protection Application",
  metadata: {
    fileNumber: "FC-26-9999",
    applicantName: "Children's Aid Society",
    respondentName: "Jane Doe",
    childNames: "Child A",
    hearingDate: "November 15, 2026",
  },
  disclaimer: "Informational only.",
  completenessScore: 85,
  completenessScoreMethod: "Standard scoring",
  evidenceStrengthIndex: {
    score: 65,
    scale: "0-100",
    label: "Evidence Strength Index",
    method: "Calculated from documented evidence.",
    components: {
      firsthandKnowledge: { score: 15, max: 20, explanation: "Worker observations" },
      sourceReliability: { score: 10, max: 15, explanation: "Named sources" },
      corroboration: { score: 10, max: 15, explanation: "Some corroborating notes" },
      documentarySupport: { score: 10, max: 15, explanation: "Police report attached" },
      internalConsistency: { score: 8, max: 10, explanation: "Internally consistent" },
      contradictoryEvidenceHandling: { score: 6, max: 10, explanation: "Acknowledges mother's statement" },
      legalAuthorityVerification: { score: 4, max: 10, explanation: "CYFSA s. 74 cited" },
      proceduralDocumentation: { score: 2, max: 5, explanation: "Service proof noted" },
    },
    calculation: "Sum of components",
    limitations: "Heuristic evaluation only.",
  },
  fileSummary:
    "This document is a formal Child Protection Application filed under the CYFSA seeking supervision orders. It alleges lack of supervision during a domestic dispute on October 12, 2026. The strongest documented support is the investigating officer's contemporaneous notes. The primary evidentiary weakness is reliance on an anonymous neighbour's telephone report. The parent should verify the 911 dispatch audio and request full society disclosure.",
  redFlags: [
    {
      id: "rf1",
      severity: "Worth Raising With Counsel",
      category: "Hearsay",
      evidenceClassification: "HEARSAY",
      phraseDetected: "An anonymous caller reported seeing the parent intoxicated.",
      explanation:
        "The passage reports a secondhand telephone allegation from an unverified source. Under Ontario child protection evidentiary standards, anonymous tips cannot substitute for firsthand observations. This document contains no independent confirmation of intoxication at that time. The allegation remains uncorroborated without toxicological records or police observations.",
      verifyRequirement: "Request 911 audio recordings and intake screening notes from the reporting date.",
      legalReference: "CYFSA s. 74",
      locationInDocument: "Page 3, Paragraph 4",
      parentActionStep: "Ask your lawyer whether to seek an order excluding the anonymous report.",
    },
  ],
  chronology: [
    {
      date: "October 12, 2026",
      event: "Society received an anonymous report alleging parent intoxication.",
      locationInDocument: "Page 3, Paragraph 4",
      evidenceClassification: "HEARSAY",
    },
  ],
  contradictions: [
    {
      description: "Worker states parent refused contact on Oct 14, but intake log notes a 20-minute phone call on Oct 14.",
      locations: ["Page 4, Para 2", "Exhibit B, Page 2"],
      significance: "Affects the worker's credibility regarding parental cooperation.",
    },
  ],
  whatToVerify: [
    "Verify the intake recording of October 14 to confirm the length and substance of the call.",
  ],
  whatToAskALawyer: [
    "Question: Can the anonymous call be struck from the affidavit? | What the uploaded record shows: The worker concedes the caller refused to identify themselves | Still unknown: Whether CAS took steps to identify the caller | Source: Page 3, Paragraph 4.",
  ],
  whatIsMissing: [
    "Contemporaneous police notes from the October 12 response.",
  ],
  lawyerCaseBrief: [
    "ISSUE: Hearsay evidence in protection application — DOCUMENT EVIDENCE: Anonymous telephone report on Page 3 — SIGNIFICANCE: Low probative weight without corroboration — LIMITATION: CAS may argue reasonable grounds to investigate — VERIFY: Request disclosure of intake recording.",
  ],
});

function createMockToken(uid: string): string {
  const header = btoa(JSON.stringify({ alg: 'RS256', kid: 'test-key' })).replace(/=/g, '');
  const payload = btoa(
    JSON.stringify({
      sub: uid,
      aud: 'test-project',
      iss: 'https://securetoken.google.com/test-project',
      exp: Math.floor(Date.now() / 1000) + 3600,
      iat: Math.floor(Date.now() / 1000) - 10,
      auth_time: Math.floor(Date.now() / 1000) - 10,
    })
  ).replace(/=/g, '');
  const signature = btoa('dummy-signature').replace(/=/g, '');
  return `${header}.${payload}.${signature}`;
}

describe('Cloudflare Direct-First Analyzer Staging Integration', () => {
  const env: AnalyzerEnv = {
    ANALYZER_ENABLED: 'true',
    FIREBASE_PROJECT_ID: 'test-project',
    ANTHROPIC_API_KEY: 'test-anthropic-key',
    ANTHROPIC_QUICK_MODEL: 'claude-sonnet-5',
    ANTHROPIC_FORENSIC_MODEL: 'claude-opus-5',
    STAGING_SUPABASE_URL: 'https://nxfhvebzzobegubefcda.supabase.co',
    STAGING_SUPABASE_SERVICE_ROLE_KEY: 'test-service-key',
    STAGING_SUPABASE_READ_KEY: 'test-read-key',
  };

  it('fails closed with 503 if ANALYZER_ENABLED is not true', async () => {
    const request = new Request('https://staging.example/api/analyze', { method: 'POST' });
    const response = await handleAnalyzeRequest(request, { ...env, ANALYZER_ENABLED: 'false' });
    expect(response.status).toBe(503);
    const json = await response.json();
    expect(json.code).toBe('STAGING_ANALYZER_NOT_READY');
  });

  it('returns 400 for empty or invalid documentText', async () => {
    const token = createMockToken('user_123');
    const request = new Request('https://staging.example/api/analyze', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ documentText: '   ' }),
    });
    const response = await handleAnalyzeRequest(request, env);
    expect(response.status).toBe(400);
    const json = await response.json();
    expect(json.code).toBe('INVALID_REQUEST');
  });

  it('successfully executes single-pass direct analysis for eligible free user', async () => {
    const uid = 'user_free_456';
    const requestId = 'req_staging_test_01';
    let reservedCalled = false;
    let finalizedCalled = false;

    mockAuthVerification.mockResolvedValueOnce({ status: 'verified', uid });

    const mockRpc = vi.fn(async (name: string, args: Record<string, unknown>) => {
      if (name === 'free_reserve_scan') {
        reservedCalled = true;
        expect(args.p_uid).toBe(uid);
        expect(args.p_request).toBe(requestId);
        return { status: 'reserved', reservation_id: 'res_free_001' };
      }
      if (name === 'free_finalize_scan') {
        finalizedCalled = true;
        expect(args.p_uid).toBe(uid);
        expect(args.p_request).toBe(requestId);
        return { status: 'consumed' };
      }
      return { status: 'noop' };
    });

    const mockGenerate = vi.fn(async () => ({
      text: VALID_DIRECT_JSON,
      usage: { input_tokens: 600, output_tokens: 400 },
      model: 'claude-sonnet-5',
      durationMs: 500,
      stopReason: 'end_turn',
    })) as unknown as GenerateFn;

    const request = new Request('https://staging.example/api/analyze', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer mock_token`,
        'X-Analysis-Id': requestId,
        Accept: 'application/json',
      },
      body: JSON.stringify({
        documentText: SAMPLE_DOC,
        mode: 'fast',
        stream: false,
      }),
    });

    const response = await handleAnalyzeRequest(request, env, {
      rpc: mockRpc,
      generate: mockGenerate,
    });

    expect(response.status).toBe(200);
    const report = await response.json();

    // 1. Single direct call executed
    expect(mockGenerate).toHaveBeenCalledTimes(1);
    // 2. Reservation & finalization both executed in order
    expect(reservedCalled).toBe(true);
    expect(finalizedCalled).toBe(true);
    // 3. Complete structured sections present
    expect(report.documentTitle).toBe("Children's Aid Society Protection Application");
    expect(report.redFlags).toHaveLength(1);
    expect(report.redFlags[0].severity).toBe('Worth Raising With Counsel');
    expect(report.chronology).toHaveLength(1);
    expect(report.whatToAskALawyer).toHaveLength(1);
    // 4. Verbatim quotation preserved and verified
    expect(report.redFlags[0].phraseDetected).toContain('An anonymous caller reported seeing the parent intoxicated.');
  });

  it('releases free reservation when AI generation fails', async () => {
    const uid = 'user_free_err';
    const requestId = 'req_staging_test_err';
    let releasedCalled = false;

    mockAuthVerification.mockResolvedValueOnce({ status: 'verified', uid });

    const mockRpc = vi.fn(async (name: string, args: Record<string, unknown>) => {
      if (name === 'free_reserve_scan') {
        return { status: 'reserved', reservation_id: 'res_err_002' };
      }
      if (name === 'free_release_scan') {
        releasedCalled = true;
        expect(args.p_reservation_id).toBe('res_err_002');
        return { status: 'released' };
      }
      return { status: 'noop' };
    });

    const mockGenerate = vi.fn(async () => {
      throw new Error('Anthropic provider failure');
    }) as GenerateFn;

    const request = new Request('https://staging.example/api/analyze', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer mock_token`,
        'X-Analysis-Id': requestId,
        Accept: 'application/json',
      },
      body: JSON.stringify({
        documentText: SAMPLE_DOC,
        mode: 'fast',
        stream: false,
      }),
    });

    const response = await handleAnalyzeRequest(request, env, {
      rpc: mockRpc,
      generate: mockGenerate,
    });

    expect(response.ok).toBe(false);
    expect(releasedCalled).toBe(true);
  });

  it('streams progress and sections via Server-Sent Events', async () => {
    const uid = 'user_stream_789';
    const requestId = 'req_stream_test_03';

    mockAuthVerification.mockResolvedValueOnce({ status: 'verified', uid });

    const mockRpc = vi.fn(async (name: string) => {
      if (name === 'free_reserve_scan') return { status: 'reserved', reservation_id: 'res_stream_003' };
      if (name === 'free_finalize_scan') return { status: 'consumed' };
      return { status: 'noop' };
    });

    const mockGenerate = vi.fn(async () => ({
      text: VALID_DIRECT_JSON,
      usage: { input_tokens: 500, output_tokens: 300 },
      model: 'claude-sonnet-5',
      durationMs: 400,
      stopReason: 'end_turn',
    })) as unknown as GenerateFn;

    const request = new Request('https://staging.example/api/analyze', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer mock_token`,
        'X-Analysis-Id': requestId,
        Accept: 'text/event-stream',
      },
      body: JSON.stringify({
        documentText: SAMPLE_DOC,
        mode: 'fast',
        stream: true,
      }),
    });

    const response = await handleAnalyzeRequest(request, env, {
      rpc: mockRpc,
      generate: mockGenerate,
    });

    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Type')).toContain('text/event-stream');

    const streamText = await response.text();
    expect(streamText).toContain('event: stage');
    expect(streamText).toContain('event: section');
    expect(streamText).toContain('event: complete');
    expect(streamText).toContain("Children's Aid Society Protection Application");
  });

  it('executes paid analysis with verified database session and paid credit reservation', async () => {
    const uid = 'user_paid_999';
    const sessionId = '11111111-2222-4333-8444-555555555555';
    const requestId = 'req_paid_test_04';
    let paidReserved = false;
    let paidFinalized = false;

    mockAuthVerification.mockResolvedValueOnce({ status: 'verified', uid });
    mockSessionRead.mockResolvedValueOnce({
      status: 'verified',
      session: {
        sessionId,
        ownerUid: uid,
        tier: 'Premium',
        issuedAt: new Date(Date.now() - 3600_000).toISOString(),
        expiresAt: new Date(Date.now() + 86400_000).toISOString(),
      },
    });

    const mockRpc = vi.fn(async (name: string, args: Record<string, unknown>) => {
      if (name === 'paid_reserve_credit') {
        paidReserved = true;
        expect(args.p_session).toBe(sessionId);
        expect(args.p_request).toBe(requestId);
        return { status: 'reserved', reservation_id: 'res_paid_004' };
      }
      if (name === 'paid_finalize_credit') {
        paidFinalized = true;
        expect(args.p_session).toBe(sessionId);
        expect(args.p_request).toBe(requestId);
        return { status: 'consumed' };
      }
      return { status: 'noop' };
    });

    const mockGenerate = vi.fn(async () => ({
      text: VALID_DIRECT_JSON,
      usage: { input_tokens: 700, output_tokens: 450 },
      model: 'claude-sonnet-5',
      durationMs: 450,
      stopReason: 'end_turn',
    })) as unknown as GenerateFn;

    const request = new Request('https://staging.example/api/analyze', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer mock_token`,
        'X-Analysis-Id': requestId,
        Accept: 'application/json',
      },
      body: JSON.stringify({
        documentText: SAMPLE_DOC,
        mode: 'fast',
        sessionId,
        stream: false,
      }),
    });

    const response = await handleAnalyzeRequest(request, env, {
      rpc: mockRpc,
      generate: mockGenerate,
    });

    expect(response.status).toBe(200);
    expect(paidReserved).toBe(true);
    expect(paidFinalized).toBe(true);
    const report = await response.json();
    expect(report.documentTitle).toBe("Children's Aid Society Protection Application");
  });

  it('rejects paid request when database session is invalid or revoked', async () => {
    const uid = 'user_forged';
    const sessionId = '22222222-3333-4444-8555-666666666666';

    mockAuthVerification.mockResolvedValueOnce({ status: 'verified', uid });
    mockSessionRead.mockResolvedValueOnce({ status: 'denied' });

    const request = new Request('https://staging.example/api/analyze', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer mock_token`,
      },
      body: JSON.stringify({
        documentText: SAMPLE_DOC,
        sessionId,
      }),
    });

    const response = await handleAnalyzeRequest(request, env);
    expect(response.status).toBe(403);
    const json = await response.json();
    expect(json.code).toBe('SESSION_INVALID');
  });

  it('returns 402 CREDIT_LIMIT_REACHED when paid quota is exhausted', async () => {
    const uid = 'user_paid_exhausted';
    const sessionId = '33333333-4444-4555-8666-777777777777';

    mockAuthVerification.mockResolvedValueOnce({ status: 'verified', uid });
    mockSessionRead.mockResolvedValueOnce({
      status: 'verified',
      session: {
        sessionId,
        ownerUid: uid,
        tier: 'Basic',
        issuedAt: new Date(Date.now() - 3600_000).toISOString(),
      },
    });

    const mockRpc = vi.fn(async (name: string) => {
      if (name === 'paid_reserve_credit') return { status: 'limit' };
      return { status: 'noop' };
    });

    const request = new Request('https://staging.example/api/analyze', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer mock_token`,
      },
      body: JSON.stringify({
        documentText: SAMPLE_DOC,
        sessionId,
      }),
    });

    const response = await handleAnalyzeRequest(request, env, { rpc: mockRpc });
    expect(response.status).toBe(402);
    const json = await response.json();
    expect(json.code).toBe('CREDIT_LIMIT_REACHED');
  });
});
