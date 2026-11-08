import { describe, expect, it, vi, beforeEach } from 'vitest';
import { handleDeepScanRequest } from '../functions/api/deep-scan';
import type { AnalyzerEnv } from '../functions/api/analyze';
import type { GenerateFn } from './services/analyzerSections';

const mockSaveCompletedJob = vi.fn(async () => true);
const mockSaveJobState = vi.fn(async () => true);
vi.mock('../functions/api/_analysis-jobs', () => ({
  saveCompletedJob: () => mockSaveCompletedJob(),
  saveJobState: () => mockSaveJobState(),
}));

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

const OVERVIEW_JSON = JSON.stringify({
  documentTitle: "Children's Aid Society Protection Application",
  fileSummary: "This document is a formal Child Protection Application filed under the CYFSA seeking supervision orders. It alleges lack of supervision during a domestic dispute on October 12, 2026. The strongest documented support is the investigating officer's contemporaneous notes. The primary evidentiary weakness is reliance on an anonymous neighbour's telephone report. The parent should verify the 911 dispatch audio and request full society disclosure.",
  completenessScore: 85,
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
});

const REDFLAGS_JSON = JSON.stringify({
  redFlags: [
    {
      id: "rf1",
      severity: "Worth Raising With Counsel",
      category: "Hearsay",
      evidenceClassification: "HEARSAY",
      phraseDetected: "An anonymous caller reported seeing the parent intoxicated.",
      explanation: "The passage reports a secondhand telephone allegation from an unverified source. Under Ontario child protection evidentiary standards, anonymous tips cannot substitute for firsthand observations. This document contains no independent confirmation of intoxication at that time. The allegation remains uncorroborated without toxicological records or police observations.",
      verifyRequirement: "Request 911 audio recordings and intake screening notes from the reporting date.",
      legalReference: "CYFSA s. 74",
      locationInDocument: "Page 3, Paragraph 4",
      parentActionStep: "Ask your lawyer whether to seek an order excluding the anonymous report.",
    },
  ],
});

const CHRONOLOGY_JSON = JSON.stringify({
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
});

const GUIDANCE_JSON = JSON.stringify({
  whatToVerify: ["Verify the intake recording of October 14 to confirm call length."],
  whatToAskALawyer: ["Question: Can the anonymous call be struck? | What the record shows: Worker concedes anonymous caller | Still unknown: Steps taken | Source: Page 3."],
  whatIsMissing: ["Contemporaneous police notes from October 12."],
  lawyerCaseBrief: ["ISSUE: Hearsay evidence in application — DOCUMENT EVIDENCE: Anonymous telephone report — SIGNIFICANCE: Low probative weight — LIMITATION: CAS argument — VERIFY: Request recording."],
});

const THRESHOLDS_JSON = JSON.stringify({
  thresholdAnalysis: [
    { thresholdChecked: "Physical Harm Risk", isMet: "Not Met", reasoning: "No physical harm documented." },
    { thresholdChecked: "Emotional Harm Risk", isMet: "Not Met", reasoning: "No emotional impairment shown." },
    { thresholdChecked: "Medical Neglect Risk", isMet: "Not Met", reasoning: "Medical needs attended to." },
    { thresholdChecked: "Abandonment Risk", isMet: "Not Met", reasoning: "Parent actively present." },
  ],
});

const TIMELINE_JSON = JSON.stringify({
  proceduralTimelineViolations: [
    { timelineRule: "5-day first appearance", documentAssertion: "Application filed", evaluation: "Appearance within 5 days", citation: "CYFSA s. 74", locationInDocument: "Page 1", parentActionStep: "Confirm date" },
    { timelineRule: "30-day temporary care hearing", documentAssertion: "Hearing set", evaluation: "Scheduled in 30 days", citation: "CYFSA s. 94", locationInDocument: "Page 2", parentActionStep: "Review calendar" },
    { timelineRule: "Kinship placement priority", documentAssertion: "Kinship assessed", evaluation: "Grandmother proposed", citation: "CYFSA s. 74(3)", locationInDocument: "Page 2", parentActionStep: "Request home study" },
    { timelineRule: "Service of application", documentAssertion: "Personal service", evaluation: "Served 2 days prior", citation: "FLR r. 8", locationInDocument: "Page 1", parentActionStep: "Check affidavit of service" },
  ],
  charterAndHumanRightsIssues: [
    "Charter s. 7: Procedural fairness in notice of kinship options.",
    "Charter s. 8: Privacy rights during warrantless residential entry.",
    "Ontario Human Rights Code: Accommodation of parental disability during assessment.",
  ],
});

const VERIFICATION_JSON = JSON.stringify({
  findings: [
    { id: "rf1", verdict: "SUPPORTED", recommendedSeverity: "Worth Raising With Counsel", note: "Passage confirms anonymous source." },
  ],
  thresholds: [
    { thresholdChecked: "Physical Harm Risk", verdict: "SUPPORTED", note: "Document shows no physical harm." },
  ],
  overallAssessment: "Findings are accurately reflected in the underlying text.",
});

describe('Cloudflare Pages Functions /api/deep-scan Endpoint', () => {
  const env: AnalyzerEnv = {
    ANALYZER_ENABLED: 'true',
    FIREBASE_PROJECT_ID: 'test-project',
    ANTHROPIC_API_KEY: 'test-anthropic-key',
    ANTHROPIC_QUICK_MODEL: 'claude-sonnet-5',
    ANTHROPIC_FORENSIC_MODEL: 'claude-opus-5',
    STAGING_SUPABASE_URL: 'https://staging.supabase.co',
    STAGING_SUPABASE_SERVICE_ROLE_KEY: 'test-service-key',
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockSaveCompletedJob.mockResolvedValue(true);
    mockSaveJobState.mockResolvedValue(true);
  });

  it('rejects unauthenticated requests with HTTP 401', async () => {
    mockAuthVerification.mockResolvedValueOnce({ status: 'denied' });

    const req = new Request('https://cyfsa-navigator-git-staging.pages.dev/api/deep-scan', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ documentText: SAMPLE_DOC }),
    });

    const res = await handleDeepScanRequest(req, env);
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.code).toBe('SIGN_IN_REQUIRED');
  });

  it('rejects free user attempting Deep Scan with HTTP 403 UPGRADE_REQUIRED', async () => {
    mockAuthVerification.mockResolvedValueOnce({
      status: 'verified',
      uid: 'user_free_123',
      email: 'parent@example.com',
      emailVerified: true,
    });

    const req = new Request('https://cyfsa-navigator-git-staging.pages.dev/api/deep-scan', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ documentText: SAMPLE_DOC }),
    });

    const res = await handleDeepScanRequest(req, env);
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.code).toBe('UPGRADE_REQUIRED');
    expect(body.error).toContain('Forensic In-Depth analysis requires a paid plan');
  });

  it('rejects paid user with Basic tier (forensic: false) with HTTP 403 RESERVATION_UNAVAILABLE', async () => {
    mockAuthVerification.mockResolvedValueOnce({
      status: 'verified',
      uid: 'user_paid_basic',
      email: 'basic@example.com',
      emailVerified: true,
    });

    mockSessionRead.mockResolvedValueOnce({
      status: 'verified',
      session: {
        sessionId: '11111111-2222-3333-4444-555555555555',
        ownerUid: 'user_paid_basic',
        tier: 'Basic', // Basic does not allow forensic
        status: 'active',
        issuedAt: new Date(Date.now() - 3600_000).toISOString(),
        expiresAt: new Date(Date.now() + 86400_000).toISOString(),
      },
    });

    const req = new Request('https://cyfsa-navigator-git-staging.pages.dev/api/deep-scan', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        documentText: SAMPLE_DOC,
        sessionId: '11111111-2222-3333-4444-555555555555',
      }),
    });

    const mockRpc = vi.fn();
    const res = await handleDeepScanRequest(req, env, { rpc: mockRpc });
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.code).toBe('RESERVATION_UNAVAILABLE');
    expect(mockRpc).not.toHaveBeenCalled();
  });

  it('successfully executes 6-section forensic analysis with Opus verification for paid Premium user', async () => {
    mockAuthVerification.mockResolvedValueOnce({
      status: 'verified',
      uid: 'user_paid_premium',
      email: 'premium@example.com',
      emailVerified: true,
    });

    mockSessionRead.mockResolvedValueOnce({
      status: 'verified',
      session: {
        sessionId: '22222222-3333-4444-5555-666666666666',
        ownerUid: 'user_paid_premium',
        tier: 'Premium',
        status: 'active',
        issuedAt: new Date(Date.now() - 3600_000).toISOString(),
        expiresAt: new Date(Date.now() + 86400_000).toISOString(),
      },
    });

    const mockRpc = vi.fn().mockImplementation((name: string) => {
      if (name === 'paid_reserve_credit') {
        return Promise.resolve({ status: 'reserved', reservation_id: 'res_paid_123' });
      }
      if (name === 'paid_finalize_credit') {
        return Promise.resolve({ status: 'consumed' });
      }
      return Promise.resolve({ status: 'ok' });
    });

    const mockGenerate = vi.fn().mockImplementation((params: any) => {
      const stage = params?.stage || '';
      let text = OVERVIEW_JSON;
      if (stage === 'section:redFlags') text = REDFLAGS_JSON;
      else if (stage === 'section:chronology') text = CHRONOLOGY_JSON;
      else if (stage === 'section:guidance') text = GUIDANCE_JSON;
      else if (stage === 'section:thresholds') text = THRESHOLDS_JSON;
      else if (stage === 'section:timeline') text = TIMELINE_JSON;
      else if (stage === 'forensic_verification') text = VERIFICATION_JSON;

      return Promise.resolve({
        text,
        usage: { input_tokens: 500, output_tokens: 300 },
        model: 'claude-sonnet-5',
        durationMs: 50,
      });
    });

    const scanId = 'deep_scan_job_12345';
    const req = new Request('https://cyfsa-navigator-git-staging.pages.dev/api/deep-scan', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Analysis-Id': scanId,
      },
      body: JSON.stringify({
        documentText: SAMPLE_DOC,
        sessionId: '22222222-3333-4444-5555-666666666666',
        stream: false,
      }),
    });

    const res = await handleDeepScanRequest(req, env, { rpc: mockRpc, generate: mockGenerate as unknown as GenerateFn });
    expect(res.status).toBe(200);
    const report = await res.json();

    // Verify 6 sections + verification were processed
    expect(report.documentTitle).toBe("Children's Aid Society Protection Application");
    expect(report.redFlags).toHaveLength(1);
    expect(report.chronology).toHaveLength(1);
    expect(report.thresholdAnalysis).toHaveLength(4);
    expect(report.proceduralTimelineViolations).toHaveLength(4);
    expect(report.forensicVerification).toBeDefined();

    // Verify modelMetadata is correctly populated with mode === 'full'
    expect(report.modelMetadata).toBeDefined();
    expect(report.modelMetadata.mode).toBe('full');
    expect(report.modelMetadata.modeName).toBe('Forensic In-Depth Scan');
    expect(report._metadata.analysisMode).toBe('full');

    // Verify credit was finalized
    expect(mockRpc).toHaveBeenCalledWith('paid_finalize_credit', expect.objectContaining({
      p_session: '22222222-3333-4444-5555-666666666666',
      p_request: scanId,
    }));
  });

  it('does not finalize a paid credit when completed report storage fails', async () => {
    mockAuthVerification.mockResolvedValueOnce({
      status: 'verified',
      uid: 'user_paid_premium',
      email: 'premium@example.com',
      emailVerified: true,
    });

    mockSessionRead.mockResolvedValueOnce({
      status: 'verified',
      session: {
        sessionId: '22222222-3333-4444-5555-666666666666',
        ownerUid: 'user_paid_premium',
        tier: 'Premium',
        status: 'active',
        issuedAt: new Date(Date.now() - 3600_000).toISOString(),
        expiresAt: new Date(Date.now() + 86400_000).toISOString(),
      },
    });

    const mockRpc = vi.fn().mockImplementation((name: string) => {
      if (name === 'paid_reserve_credit') {
        return Promise.resolve({ status: 'reserved', reservation_id: 'res_paid_123' });
      }
      if (name === 'paid_finalize_credit') {
        return Promise.resolve({ status: 'consumed' });
      }
      return Promise.resolve({ status: 'ok' });
    });

    const mockGenerate = vi.fn().mockImplementation((params: any) => {
      const stage = params?.stage || '';
      let text = OVERVIEW_JSON;
      if (stage === 'section:redFlags') text = REDFLAGS_JSON;
      else if (stage === 'section:chronology') text = CHRONOLOGY_JSON;
      else if (stage === 'section:guidance') text = GUIDANCE_JSON;
      else if (stage === 'section:thresholds') text = THRESHOLDS_JSON;
      else if (stage === 'section:timeline') text = TIMELINE_JSON;
      else if (stage === 'forensic_verification') text = VERIFICATION_JSON;

      return Promise.resolve({
        text,
        usage: { input_tokens: 500, output_tokens: 300 },
        model: 'claude-sonnet-5',
        durationMs: 50,
      });
    });

    mockSaveCompletedJob.mockResolvedValue(false);
    const scanId = 'deep_scan_storage_failed_12345';
    const req = new Request('https://cyfsa-navigator-git-staging.pages.dev/api/deep-scan', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Analysis-Id': scanId,
      },
      body: JSON.stringify({
        documentText: SAMPLE_DOC,
        sessionId: '22222222-3333-4444-5555-666666666666',
        stream: false,
      }),
    });

    const res = await handleDeepScanRequest(req, env, { rpc: mockRpc, generate: mockGenerate as unknown as GenerateFn });
    expect(res.status).toBe(503);
    const error = await res.json();
    expect(error.code).toBe('ANALYSIS_PERSISTENCE_FAILED');
    expect(mockSaveCompletedJob).toHaveBeenCalledOnce();
    expect(mockRpc).not.toHaveBeenCalledWith('paid_finalize_credit', expect.anything());
  });
  
  it('allows owner user (mrpelkey@gmail.com) to execute Deep Scan without paid session', async () => {
    mockAuthVerification.mockResolvedValueOnce({
      status: 'verified',
      uid: 'owner_uid',
      email: 'mrpelkey@gmail.com',
      emailVerified: true,
    });

    const mockGenerate = vi.fn().mockImplementation((params: any) => {
      const stage = params?.stage || '';
      let text = OVERVIEW_JSON;
      if (stage === 'section:redFlags') text = REDFLAGS_JSON;
      else if (stage === 'section:chronology') text = CHRONOLOGY_JSON;
      else if (stage === 'section:guidance') text = GUIDANCE_JSON;
      else if (stage === 'section:thresholds') text = THRESHOLDS_JSON;
      else if (stage === 'section:timeline') text = TIMELINE_JSON;
      else if (stage === 'forensic_verification') text = VERIFICATION_JSON;

      return Promise.resolve({
        text,
        usage: { input_tokens: 500, output_tokens: 300 },
        model: 'claude-sonnet-5',
        durationMs: 50,
      });
    });

    const req = new Request('https://cyfsa-navigator-git-staging.pages.dev/api/deep-scan', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        documentText: SAMPLE_DOC,
        stream: false,
      }),
    });

    const res = await handleDeepScanRequest(req, env, { generate: mockGenerate as unknown as GenerateFn });
    expect(res.status).toBe(200);
    const report = await res.json();
    expect(report.modelMetadata.mode).toBe('full');
    expect(report.forensicVerification).toBeDefined();
  });

  it('streams SSE stage events including verification when Accept: text/event-stream is requested', async () => {
    mockAuthVerification.mockResolvedValueOnce({
      status: 'verified',
      uid: 'owner_uid',
      email: 'mrpelkey@gmail.com',
      emailVerified: true,
    });

    const mockGenerate = vi.fn().mockImplementation((params: any) => {
      const stage = params?.stage || '';
      let text = OVERVIEW_JSON;
      if (stage === 'section:redFlags') text = REDFLAGS_JSON;
      else if (stage === 'section:chronology') text = CHRONOLOGY_JSON;
      else if (stage === 'section:guidance') text = GUIDANCE_JSON;
      else if (stage === 'section:thresholds') text = THRESHOLDS_JSON;
      else if (stage === 'section:timeline') text = TIMELINE_JSON;
      else if (stage === 'forensic_verification') text = VERIFICATION_JSON;

      return Promise.resolve({
        text,
        usage: { input_tokens: 500, output_tokens: 300 },
        model: 'claude-sonnet-5',
        durationMs: 50,
      });
    });

    const req = new Request('https://cyfsa-navigator-git-staging.pages.dev/api/deep-scan', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'text/event-stream, application/json',
        'X-Analysis-Id': 'scan_stream_123',
      },
      body: JSON.stringify({
        documentText: SAMPLE_DOC,
        stream: true,
      }),
    });

    const res = await handleDeepScanRequest(req, env, { generate: mockGenerate as unknown as GenerateFn });
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/event-stream');

    const reader = res.body?.getReader();
    expect(reader).toBeDefined();
    const decoder = new TextDecoder();
    let streamText = '';
    while (true) {
      const { done, value } = await reader!.read();
      if (done) break;
      streamText += decoder.decode(value, { stream: true });
    }

    expect(streamText).toContain('event: stage');
    expect(streamText).toContain('Independent Claude Opus verification');
    expect(streamText).toContain('event: complete');
  });
});
