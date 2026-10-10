import { beforeEach, describe, expect, it, vi } from "vitest";
import request from "supertest";

const { mockCreateMessage, mockGenerateContent } = vi.hoisted(() => ({
  mockCreateMessage: vi.fn(),
  mockGenerateContent: vi.fn(),
}));

const mockAccess = vi.hoisted(() => ({
  requestAccess: vi.fn(),
  approvePayment: vi.fn(),
  verifyAccessCode: vi.fn(),
  verifySessionToken: vi.fn(),
  getActivePaidSession: vi.fn(),
  getSupabase: vi.fn(),
  revokeSession: vi.fn(),
  revokeAllSessionsForUid: vi.fn(),
  checkAndConsumeFreeToolUse: vi.fn(),
  resolveSupabaseCredentials: vi.fn(() => ({
    url: process.env.SUPABASE_URL || "https://example.supabase.co",
    key: process.env.SUPABASE_SERVICE_ROLE_KEY || "test-service-role-key",
    source: "SUPABASE_SERVICE_ROLE_KEY",
  })),
  getConfiguredProjectRef: vi.fn(() => "test-project-ref"),
  extractProjectRef: vi.fn((url: string | null) => "test-project-ref"),
  isSessionBoundToIdentity: vi.fn((session: any, identity: any) => {
    if (!session || !identity) return false;
    if (session.firebaseUid === identity.uid) return true;
    return false;
  }),
  healSessionUidBinding: vi.fn(async () => {}),
  TIER_PRICES: { Basic: 19.99, Premium: 49.99, Pro: 149 },
  ALL_TIER_PRICES: { Basic: 19.99, Premium: 49.99, Pro: 149 },
  LEGACY_TIER_PRICES: {},
  isAnalyzerTier: vi.fn(() => true),
  isCaseAccessTier: vi.fn(() => true),
  hasCaseAccess: vi.fn(() => true),
  hasAnalyzerAccess: vi.fn(() => true),
  hasForensicInDepthAccess: vi.fn(() => true),
}));

const mockFirebaseAdmin = vi.hoisted(() => ({ verifyFirebaseToken: vi.fn() }));
const mockUsage = vi.hoisted(() => ({
  getFreeUsage: vi.fn(async () => 0),
  recordFreeUse: vi.fn(async () => {}),
  FREE_ANALYSES_LIMIT: 1,
  BASIC_QUICK_REVIEWS_LIMIT: 3,
  PREMIUM_FORENSIC_ANALYSES_LIMIT: 3,
  CASE_ACCESS_FORENSIC_ANALYSES_LIMIT: 5,
  TIER_LIMITS: { Basic: 3, Premium: 3, Pro: 5 },
  checkPaidUsage: vi.fn(async () => ({ allowed: true, used: 0, limit: 5, remaining: 5 })),
  recordPaidUse: vi.fn(async () => {}),
  getPaidUsageStatus: vi.fn(async () => ({
    tier: "Pro",
    quickReviewsUsed: 0,
    quickReviewsLimit: 5,
    quickReviewsRemaining: 5,
    forensicAnalysesUsed: 0,
    forensicAnalysesLimit: 5,
    forensicAnalysesRemaining: 5,
  })),
}));

vi.mock("@anthropic-ai/sdk", () => ({
  default: class {
    messages = { create: mockCreateMessage };
  },
}));

vi.mock("@google/genai", () => ({
  GoogleGenAI: class {
    models = { generateContent: mockGenerateContent };
  },
}));

vi.mock("./services/access.js", () => mockAccess);
vi.mock("./services/firebaseAdmin.js", () => mockFirebaseAdmin);
vi.mock("./services/usage.js", () => mockUsage);

process.env.VERCEL = "1";
process.env.ANTHROPIC_API_KEY = "test-anthropic-key";
process.env.SUPABASE_URL = "https://example.supabase.co";
process.env.SUPABASE_SERVICE_ROLE_KEY = "test-key";

const { default: app } = await import("./_server.js");
import { createAnalysisJob } from "./services/analyzerStreaming.js";

const MINIMAL_ANALYSIS = {
  documentTitle: "Society Protection Application",
  documentType: "Protection Application",
  metadata: {
    fileNumber: "FC-26-0042",
    applicantName: "Children's Aid Society",
    respondentName: "Jane Doe",
    childNames: "John Doe",
    hearingDate: "2026-11-15",
  },
  disclaimer: "This document is generated for informational/educational purposes only.",
  completenessScore: 82,
  evidenceStrengthIndex: {
    score: 65,
    scale: "0-100",
    label: "Evidence Strength Index",
    method: "Calculate from the documented evidence in this file only.",
    components: {
      firsthandKnowledge: { score: 12, max: 20, explanation: "Limited" },
      sourceReliability: { score: 10, max: 15, explanation: "Average" },
      corroboration: { score: 8, max: 15, explanation: "Partial" },
      documentarySupport: { score: 10, max: 15, explanation: "Present" },
      internalConsistency: { score: 8, max: 10, explanation: "Consistent" },
      contradictoryEvidenceHandling: { score: 7, max: 10, explanation: "Addressed" },
      legalAuthorityVerification: { score: 7, max: 10, explanation: "Cited" },
      proceduralDocumentation: { score: 3, max: 5, explanation: "Procedural notice given" },
    },
    calculation: "Sum of eight components",
    limitations: "Heuristic assessment",
  },
  fileSummary: "Executive briefing of the document.",
  redFlags: [
    {
      id: "rf1",
      severity: "Affects Evidentiary Weight",
      category: "Hearsay",
      evidenceClassification: "HEARSAY",
      phraseDetected: "The mother appeared agitated during the visit.",
      explanation: "Subjective worker impression without recorded behavioral metrics.",
      verifyRequirement: "Request contemporaneous observation notes.",
      legalReference: "CYFSA s. 74",
      locationInDocument: "Page 1, Paragraph 3",
      parentActionStep: "Ask your lawyer about testing firsthand observation.",
    },
  ],
};

function paid() {
  return {
    Authorization: "Bearer mock-firebase-token",
    "x-ps-session": "valid-paid-token",
  };
}

describe("Analyzer Streaming & Job Recovery Integration", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.ANTHROPIC_API_KEY = "test-anthropic-key";
    process.env.SUPABASE_URL = "https://example.supabase.co";
    process.env.SUPABASE_SERVICE_ROLE_KEY = "test-key";

    mockFirebaseAdmin.verifyFirebaseToken.mockResolvedValue({
      uid: "test-parent-uid",
      email: "parent@example.com",
    });

    mockAccess.verifySessionToken.mockReturnValue({ jti: "session-jti-123" });
    mockAccess.getActivePaidSession.mockResolvedValue({
      id: "session-row-456",
      tier: "Pro",
      email: "parent@example.com",
      firebaseUid: "test-parent-uid",
    });
  });

  it("GET /api/analyze/job/:jobId returns 404 for nonexistent job", async () => {
    const res = await request(app).get("/api/analyze/job/nonexistent-job-id");
    expect(res.status).toBe(404);
    expect(res.body.code).toBe("JOB_NOT_FOUND");
  });

  it("GET /api/analyze/job/:jobId returns existing job status", async () => {
    const job = createAnalysisJob({
      jobId: "test-durable-job-123",
      uid: "test-parent-uid",
      mode: "fast",
    });
    expect(job).toBeDefined();

    const res = await request(app).get("/api/analyze/job/test-durable-job-123");
    expect(res.status).toBe(200);
    expect(res.body.jobId).toBe("test-durable-job-123");
    expect(res.body.mode).toBe("fast");
    expect(res.body.status).toBe("analyzing");
  });

  it("POST /api/analyze with stream: true emits SSE stream events with real stages", async () => {
    mockCreateMessage.mockResolvedValueOnce({
      content: [{ type: "text", text: JSON.stringify(MINIMAL_ANALYSIS) }],
      stop_reason: "end_turn",
      usage: { input_tokens: 1500, output_tokens: 600 },
    });

    const sourceText = "The mother appeared agitated during the visit. Worker recorded no metrics.";

    const res = await request(app)
      .post("/api/analyze")
      .set(paid())
      .send({
        textContent: sourceText,
        mode: "fast",
        stream: true,
      });

    expect(res.status).toBe(200);
    expect(res.header["content-type"]).toContain("text/event-stream");

    const events: any[] = [];
    const lines = res.text.split("\n\n");
    for (const line of lines) {
      if (line.startsWith("data: ")) {
        try {
          events.push(JSON.parse(line.replace("data: ", "")));
        } catch {}
      }
    }

    expect(events.length).toBeGreaterThan(0);
    const stageEvents = events.filter((e) => e.type === "stage");
    expect(stageEvents.length).toBeGreaterThan(0);

    const stagesObserved = stageEvents.map((e) => e.stage);
    expect(stagesObserved).toContain("extracting");
    expect(stagesObserved).toContain("reviewing_evidence");
    expect(stagesObserved).toContain("preparing_report");

    const completeEvent = events.find((e) => e.type === "complete");
    expect(completeEvent).toBeDefined();
    expect(completeEvent.report).toBeDefined();
    expect(completeEvent.report.documentTitle).toBe("Society Protection Application");

    // Quote verification was executed:
    const redFlag = completeEvent.report.redFlags[0];
    expect(redFlag.quoteVerified).toBe(true);
    expect(redFlag.quoteVerification).toBe("EXACT");
  });

  it("POST /api/analyze verifies quotes and detects unverified phrases", async () => {
    mockCreateMessage.mockResolvedValueOnce({
      content: [{ type: "text", text: JSON.stringify(MINIMAL_ANALYSIS) }],
      stop_reason: "end_turn",
      usage: { input_tokens: 1500, output_tokens: 600 },
    });

    // Notice: source document does NOT contain the red flag quote
    const nonMatchingSource = "Different document text completely unrelated to the visit.";

    const res = await request(app)
      .post("/api/analyze")
      .set(paid())
      .send({
        textContent: nonMatchingSource,
        mode: "fast",
      });

    expect(res.status).toBe(200);
    const redFlag = res.body.redFlags[0];
    expect(redFlag.quoteVerified).toBe(false);
    expect(redFlag.quoteVerification).toBe("ABSENT");
  });

  it("GET /api/analyze/job/:jobId rejects unauthenticated requests with 401 SIGN_IN_REQUIRED", async () => {
    mockFirebaseAdmin.verifyFirebaseToken.mockResolvedValueOnce(null);
    const res = await request(app).get("/api/analyze/job/job-anon-123");
    expect(res.status).toBe(401);
    expect(res.body.code).toBe("SIGN_IN_REQUIRED");
  });

  it("GET /api/analyze/job/:jobId forbids access to another user's job with 403 FORBIDDEN", async () => {
    createAnalysisJob({
      jobId: "job-owned-by-other",
      uid: "other-parent-uid",
      mode: "fast",
    });

    mockFirebaseAdmin.verifyFirebaseToken.mockResolvedValueOnce({
      uid: "test-parent-uid",
      email: "parent@example.com",
    });

    const res = await request(app)
      .get("/api/analyze/job/job-owned-by-other")
      .set(paid());

    expect(res.status).toBe(403);
    expect(res.body.code).toBe("FORBIDDEN");
  });

  it("GET /api/analyze/job/:jobId recovers own completed job with 200 OK", async () => {
    createAnalysisJob({
      jobId: "job-owned-by-me",
      uid: "test-parent-uid",
      mode: "fast",
    });

    mockFirebaseAdmin.verifyFirebaseToken.mockResolvedValueOnce({
      uid: "test-parent-uid",
      email: "parent@example.com",
    });

    const res = await request(app)
      .get("/api/analyze/job/job-owned-by-me")
      .set(paid());

    expect(res.status).toBe(200);
    expect(res.body.jobId).toBe("job-owned-by-me");
    expect(res.body.uid).toBe("test-parent-uid");
  });
});
