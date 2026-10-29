import { beforeEach, describe, expect, it, vi } from "vitest";
import { createProductionLikeDb } from "./testSupport/productionLikeCreditDb.js";
import request from "supertest";

const { mockCreateMessage, mockGenerateContent } = vi.hoisted(() => ({
  mockCreateMessage: vi.fn(),
  mockGenerateContent: vi.fn(),
}));

const dbHolder = vi.hoisted(() => ({ db: null as any }));
const mockAccess = vi.hoisted(() => ({
  requestAccess: vi.fn(),
  approvePayment: vi.fn(),
  verifyAccessCode: vi.fn(),
  verifySessionToken: vi.fn(),
  getActivePaidSession: vi.fn(),
  getSupabase: vi.fn(() => dbHolder.db),
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
  // Mirrors access.ts: the email allowlist only counts for a verified email.
  isVerifiedSiteOwner: vi.fn((identity: any, secret?: string | null) =>
    Boolean(mockAccess.isAuthorizedSiteOwner(null, secret)) ||
    (identity?.emailVerified === true && Boolean(mockAccess.isAuthorizedSiteOwner(identity.email, null)))),
  isAuthorizedSiteOwner: vi.fn((_email?: string | null, _secret?: string | null) => false),
}));

const mockFirebaseAdmin = vi.hoisted(() => ({
  verifyFirebaseToken: vi.fn(),
  verifyFirebaseIdentity: vi.fn(async (header: any) => {
    const r = await mockFirebaseAdmin.verifyFirebaseToken(header);
    return r ? { emailVerified: true, ...r } : null;
  }),
}));
const mockUsage = vi.hoisted(() => ({
  getFreeUsage: vi.fn(async () => 0),
  recordFreeUse: vi.fn(async () => {}),
  decrementFreeUse: vi.fn(async () => {}),
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
    messages = {
      create: mockCreateMessage,
      // Mirrors the SDK: stream(body, options).finalMessage() resolves the same response.
      stream: (body: any, options: any) => ({ finalMessage: () => mockCreateMessage(body, options) }),
    };
  },
}));

vi.mock("@google/genai", () => ({
  GoogleGenAI: class {
    models = { generateContent: mockGenerateContent };
  },
}));

vi.mock("./services/access.js", () => mockAccess);
vi.mock("./services/firebaseAdmin.js", () => mockFirebaseAdmin);
const mockFreeScan = await vi.hoisted(async () => {
  const { createFreeScanEmulator } = await import("./testSupport/freeScanEmulator.js");
  // Reads the stored counter through the mocked usage store, so the limit and fail-closed tests still drive the route.
  return createFreeScanEmulator((uid: string) => (mockUsage.getFreeUsage as unknown as (uid: string) => Promise<number>)(uid));
});
vi.mock("./services/freeScanReservation.js", () => mockFreeScan);
vi.mock("./services/usage.js", () => mockUsage);

process.env.VERCEL = "1";
process.env.ANTHROPIC_API_KEY = "test-anthropic-key";
process.env.SUPABASE_URL = "https://example.supabase.co";
process.env.SUPABASE_SERVICE_ROLE_KEY = "test-key";

const { default: app } = await import("./_server.js");
import { completeAnalysisJob, createAnalysisJob, failAnalysisJob } from "./services/analyzerStreaming.js";

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

const { COMPLETE_ANALYSIS, sectionResponder } = await import("./analyzerTestFixtures.js");
// This file's title and red flag on top of a report that passes every section validator.
const STREAM_REPORT = { ...COMPLETE_ANALYSIS, documentTitle: MINIMAL_ANALYSIS.documentTitle, redFlags: MINIMAL_ANALYSIS.redFlags };

describe("Analyzer Streaming & Job Recovery Integration", () => {
  beforeEach(() => {
  mockFreeScan.reset();
  dbHolder.db = createProductionLikeDb({
    sessions: [
      { id: "jti-1", tier: "Pro", revoked_at: null, issued_at: "2026-01-01T00:00:00Z" },
      { id: "session-row-456", tier: "Pro", revoked_at: null, issued_at: "2026-01-01T00:00:00Z" },
      { id: "session-google-sub", tier: "Premium", revoked_at: null, issued_at: "2026-01-01T00:00:00Z" },
    ],
  });
    vi.clearAllMocks();
    mockCreateMessage.mockReset();
    delete process.env.DIRECT_BRIEF_PREVIEW_ENABLED;
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

  it("GET /api/analyze/job/:jobId reports a recent, not-yet-created job as pending with no invented progress", async () => {
    const recentId = `req_${Date.now()}_abc1234`;
    const res = await request(app).get(`/api/analyze/job/${recentId}`);
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("pending");
    expect(res.body.percent).toBeUndefined();
    expect(res.body.currentStage).toBeUndefined();
  });

  it("GET /api/analyze/job/:jobId returns 404 for an old job id that never started", async () => {
    const oldId = `req_${Date.now() - 5 * 60 * 1000}_abc1234`;
    const res = await request(app).get(`/api/analyze/job/${oldId}`);
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

  it("a streamed free report that cannot be recorded sends a retryable error, never complete, and keeps the job completed", async () => {
    const analysisId = `req_${Date.now()}_streamfin1`;
    mockFirebaseAdmin.verifyFirebaseToken.mockResolvedValueOnce({ uid: "free-stream-uid", email: "free-stream@example.com" });
    mockCreateMessage.mockImplementation(sectionResponder(STREAM_REPORT));
    mockFreeScan.finalizeFreeScan.mockRejectedValueOnce(new Error("database unavailable"));

    const res = await request(app)
      .post("/api/analyze")
      .set("Authorization", "Bearer free-stream-token")
      .set("x-analysis-id", analysisId)
      .send({ textContent: "The mother appeared agitated during the visit.", mode: "fast", stream: true });

    const events: any[] = res.text
      .split("\n\n")
      .filter((line) => line.startsWith("data: "))
      .map((line) => JSON.parse(line.replace("data: ", "")));
    expect(events.some((e) => e.type === "complete")).toBe(false);
    const withheld = events.find((e) => e.type === "error");
    expect(withheld?.code).toBe("FREE_SCAN_NOT_RECORDED");
    expect(withheld?.retryable).toBe(true);
    expect(mockFreeScan.releaseFreeScan).not.toHaveBeenCalled();

    // The job was not marked failed: a retry of the same id is served the saved report, with no second model run.
    const callsBeforeRetry = mockCreateMessage.mock.calls.length;
    mockFirebaseAdmin.verifyFirebaseToken.mockResolvedValueOnce({ uid: "free-stream-uid", email: "free-stream@example.com" });
    const retry = await request(app)
      .post("/api/analyze")
      .set("Authorization", "Bearer free-stream-token")
      .set("x-analysis-id", analysisId)
      .send({ textContent: "The mother appeared agitated during the visit.", mode: "fast" });
    expect(retry.status).toBe(200);
    expect(retry.body.documentTitle).toBeDefined();
    expect(mockCreateMessage.mock.calls.length).toBe(callsBeforeRetry);
    expect(mockFreeScan.consumedFor("free-stream-uid")).toBe(1);
  });

  it("POST /api/analyze with stream: true emits SSE stream events with real stages", async () => {
    mockCreateMessage.mockImplementation(sectionResponder(STREAM_REPORT));

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

    // Each validated section is streamed as soon as it passes validation, and progress only moves forward.
    const sectionEvents = events.filter((e) => e.type === "section").map((e) => e.section).sort();
    expect(sectionEvents).toEqual(["chronology", "guidance", "overview", "redFlags"]);
    const percents = stageEvents.map((e) => e.percent);
    for (let i = 1; i < percents.length; i++) expect(percents[i]).toBeGreaterThanOrEqual(percents[i - 1]);

    const completeEvent = events.find((e) => e.type === "complete");
    expect(completeEvent).toBeDefined();
    expect(completeEvent.report).toBeDefined();
    expect(completeEvent.report.documentTitle).toBe("Society Protection Application");

    // Quote verification was executed:
    const redFlag = completeEvent.report.redFlags[0];
    expect(redFlag.quoteVerified).toBe(true);
    expect(redFlag.quoteVerification).toBe("EXACT");
  });

  it("opt-in direct preview streams an explicitly unverified brief without replacing the final report", async () => {
    process.env.DIRECT_BRIEF_PREVIEW_ENABLED = "true";
    const standardResponder = sectionResponder(STREAM_REPORT);
    mockCreateMessage.mockImplementation(async (body: any) => {
      const prompt = JSON.stringify(body.messages || []);
      if (prompt.includes("Draft a concise preliminary case brief in Markdown")) {
        return {
          id: "msg_preview",
          type: "message",
          role: "assistant",
          model: body.model,
          content: [{ type: "text", text: "Case Overview\\nPreliminary document findings." }],
          usage: { input_tokens: 120, output_tokens: 35 },
          stop_reason: "end_turn",
        };
      }
      return standardResponder(body);
    });

    const res = await request(app)
      .post("/api/analyze")
      .set(paid())
      .send({ textContent: "The mother appeared agitated during the visit.", mode: "fast", stream: true });

    expect(res.status).toBe(200);
    const events = res.text.split("\\n\\n")
      .filter((line: string) => line.startsWith("data: "))
      .map((line: string) => JSON.parse(line.slice(6)));
    const preview = events.find((e: any) => e.type === "section" && e.section === "preliminaryBrief");
    expect(preview?.data?.status).toBe("PRELIMINARY_UNVERIFIED");
    expect(preview?.data?.text).toContain("Preliminary document findings");
    const complete = events.find((e: any) => e.type === "complete");
    expect(complete?.report?.documentTitle).toBe("Society Protection Application");
    expect(complete?.report?.preliminaryBrief).toBeUndefined();
    expect(mockCreateMessage.mock.calls.length).toBeGreaterThan(4);
  });

  it("POST /api/analyze verifies quotes and detects unverified phrases", async () => {
    mockCreateMessage.mockImplementation(sectionResponder(STREAM_REPORT));

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

  // Job poll authorization. A job is released only to the Firebase account that owns it. A paid-session token
  // never releases a report by itself, and a missing, expired or invalid Firebase token is a sign-in problem (401),
  // not an access-denied one (403). The verifier returns null for expired and invalid tokens alike.
  describe("job poll authorization", () => {
    it("releases the job to its valid owner", async () => {
      createAnalysisJob({ jobId: "job-auth-owner", uid: "test-parent-uid", mode: "fast" });
      const res = await request(app).get("/api/analyze/job/job-auth-owner");
      expect(res.status).toBe(200);
      expect(res.body.jobId).toBe("job-auth-owner");
    });

    it("refuses a job owned by another account to a valid non-owner with 403 FORBIDDEN", async () => {
      createAnalysisJob({ jobId: "job-auth-other", uid: "other-parent-uid", mode: "fast" });
      const res = await request(app).get("/api/analyze/job/job-auth-other");
      expect(res.status).toBe(403);
      expect(res.body.code).toBe("FORBIDDEN");
    });

    it("refuses an anonymous caller with 401 SIGN_IN_REQUIRED", async () => {
      createAnalysisJob({ jobId: "job-auth-anon", uid: "test-parent-uid", mode: "fast" });
      mockFirebaseAdmin.verifyFirebaseToken.mockResolvedValueOnce(null);
      const res = await request(app).get("/api/analyze/job/job-auth-anon");
      expect(res.status).toBe(401);
      expect(res.body.code).toBe("SIGN_IN_REQUIRED");
    });

    it("answers an expired Firebase token with 401 SIGN_IN_REQUIRED, not 403, even with a valid paid session", async () => {
      createAnalysisJob({ jobId: "job-auth-expired", uid: "test-parent-uid", mode: "fast" });
      mockFirebaseAdmin.verifyFirebaseToken.mockResolvedValueOnce(null);
      const res = await request(app).get("/api/analyze/job/job-auth-expired").set(paid());
      expect(res.status).toBe(401);
      expect(res.body.code).toBe("SIGN_IN_REQUIRED");
      expect(res.body).not.toHaveProperty("report");
    });

    it("answers an invalid Firebase token with 401 SIGN_IN_REQUIRED, not 403, even with a valid paid session", async () => {
      createAnalysisJob({ jobId: "job-auth-invalid", uid: "test-parent-uid", mode: "fast" });
      mockFirebaseAdmin.verifyFirebaseToken.mockResolvedValueOnce(null);
      const res = await request(app)
        .get("/api/analyze/job/job-auth-invalid")
        .set("Authorization", "Bearer not-a-real-token")
        .set(paid());
      expect(res.status).toBe(401);
      expect(res.body.code).toBe("SIGN_IN_REQUIRED");
      expect(res.body).not.toHaveProperty("report");
    });

    it("never releases report content to a paid-session token alone (no Firebase identity)", async () => {
      createAnalysisJob({ jobId: "job-auth-session-only", uid: "test-parent-uid", mode: "fast" });
      mockFirebaseAdmin.verifyFirebaseToken.mockResolvedValueOnce(null);
      const res = await request(app).get("/api/analyze/job/job-auth-session-only").set(paid());
      expect(res.status).toBe(401);
      expect(res.body).not.toHaveProperty("report");
      expect(res.body).not.toHaveProperty("jobId");
    });

    it("refuses a session-only caller whose paid session has expired, with 401 SIGN_IN_REQUIRED", async () => {
      createAnalysisJob({ jobId: "job-auth-expired-session", uid: "test-parent-uid", mode: "fast" });
      mockFirebaseAdmin.verifyFirebaseToken.mockResolvedValueOnce(null);
      mockAccess.getActivePaidSession.mockResolvedValueOnce(null);
      const res = await request(app).get("/api/analyze/job/job-auth-expired-session").set(paid());
      expect(res.status).toBe(401);
      expect(res.body.code).toBe("SIGN_IN_REQUIRED");
    });

    it("refuses a session-only caller whose paid session was revoked, with 401 SIGN_IN_REQUIRED", async () => {
      createAnalysisJob({ jobId: "job-auth-revoked-session", uid: "test-parent-uid", mode: "fast" });
      mockFirebaseAdmin.verifyFirebaseToken.mockResolvedValueOnce(null);
      mockAccess.getActivePaidSession.mockResolvedValueOnce(null);
      const res = await request(app).get("/api/analyze/job/job-auth-revoked-session").set(paid());
      expect(res.status).toBe(401);
      expect(res.body.code).toBe("SIGN_IN_REQUIRED");
    });

    it("keeps the owner's own report readable with a valid Firebase identity (existing behaviour, unchanged)", async () => {
      createAnalysisJob({ jobId: "job-auth-owner-session-ended", uid: "test-parent-uid", mode: "fast" });
      mockAccess.getActivePaidSession.mockResolvedValueOnce(null);
      const res = await request(app).get("/api/analyze/job/job-auth-owner-session-ended").set(paid());
      expect(res.status).toBe(200);
      expect(res.body.jobId).toBe("job-auth-owner-session-ended");
    });

    it("after reauthentication, a completed, running, or failed saved job is returned as it stands", async () => {
      createAnalysisJob({ jobId: "job-state-done", uid: "test-parent-uid", mode: "fast" });
      completeAnalysisJob("job-state-done", { documentTitle: "Saved report" });
      createAnalysisJob({ jobId: "job-state-running", uid: "test-parent-uid", mode: "fast" });
      createAnalysisJob({ jobId: "job-state-failed", uid: "test-parent-uid", mode: "fast" });
      failAnalysisJob("job-state-failed", { code: "AI_RATE_LIMITED", message: "slow down", statusCode: 429, retryable: true });

      const done = await request(app).get("/api/analyze/job/job-state-done");
      expect(done.status).toBe(200);
      expect(done.body.status).toBe("completed");
      expect(done.body.report).toBeTruthy();

      const running = await request(app).get("/api/analyze/job/job-state-running");
      expect(running.status).toBe(200);
      expect(running.body.status).not.toBe("completed");

      const failed = await request(app).get("/api/analyze/job/job-state-failed");
      expect(failed.status).toBe(200);
      expect(failed.body.status).toBe("failed");
      expect(failed.body.error.code).toBe("AI_RATE_LIMITED");
    });

    it("reports a job that no longer exists as JOB_NOT_FOUND, not as access denied", async () => {
      const res = await request(app).get("/api/analyze/job/req_1000000000000_expired0001").set(paid());
      expect(res.status).toBe(404);
      expect(res.body.code).toBe("JOB_NOT_FOUND");
    });

    it("an expired sign-in on a retried analysis answers SIGN_IN_REQUIRED and starts nothing", async () => {
      createAnalysisJob({ jobId: "req_1700000000000_owned0001", uid: "test-parent-uid", mode: "fast" });
      mockFirebaseAdmin.verifyFirebaseIdentity.mockResolvedValueOnce(null);
      const res = await request(app)
        .post("/api/analyze")
        .set("x-analysis-id", "req_1700000000000_owned0001")
        .send({ textContent: "A short parent statement used only in this test.", mode: "fast" });
      expect(res.status).toBe(401);
      expect(res.body.code).toBe("SIGN_IN_REQUIRED");
      expect(res.body.code).not.toBe("ANALYSIS_ID_CONFLICT");
      expect(mockCreateMessage).not.toHaveBeenCalled();
    });

    it("an expired sign-in on a new analysis answers SIGN_IN_REQUIRED before any credit is reserved", async () => {
      mockFirebaseAdmin.verifyFirebaseIdentity.mockResolvedValueOnce(null);
      const res = await request(app)
        .post("/api/analyze")
        .set("x-analysis-id", "req_1700000000001_newjob0002")
        .set(paid())
        .send({ textContent: "A short parent statement used only in this test.", mode: "fast" });
      expect(res.status).toBe(401);
      expect(res.body.code).toBe("SIGN_IN_REQUIRED");
      expect(mockCreateMessage).not.toHaveBeenCalled();
    });

    // Duplicate retries. A retry sends the analysis id of an earlier attempt. The server answers it from the saved
    // record and must not start, charge, or call the model again.
    it("two simultaneous starts with one analysis id: the second is refused while the first is still starting", async () => {
      // Hold the first request at its free-usage check, so the second arrives before the first has saved its job.
      mockUsage.getFreeUsage.mockImplementationOnce(() => new Promise((resolve) => setTimeout(() => resolve(0), 80)));
      const id = "req_1700000000005_race000001";
      const body = { textContent: "A short parent statement used only in this test.", mode: "fast" };
      const [first, second] = await Promise.all([
        request(app).post("/api/analyze").set("Authorization", "Bearer test-token").set("x-analysis-id", id).send(body),
        request(app).post("/api/analyze").set("Authorization", "Bearer test-token").set("x-analysis-id", id).send(body),
      ]);
      const codes = [first, second].map((r) => r.body?.code);
      expect(codes.filter((c) => c === "ANALYSIS_IN_PROGRESS")).toHaveLength(1);
    });

    it("a job that has made no progress for six minutes is not treated as running, so a retry is not blocked forever", async () => {
      const start = Date.now();
      const spy = vi.spyOn(Date, "now").mockReturnValue(start);
      try {
        createAnalysisJob({ jobId: "req_1700000000006_stale00001", uid: "test-parent-uid", mode: "fast" });
        spy.mockReturnValue(start + 7 * 60 * 1000);
        const res = await request(app)
          .post("/api/analyze")
          .set("Authorization", "Bearer test-token")
          .set("x-analysis-id", "req_1700000000006_stale00001")
          .send({ textContent: "A short parent statement used only in this test.", mode: "fast" });
        expect(res.body.code).not.toBe("ANALYSIS_IN_PROGRESS");
      } finally {
        spy.mockRestore();
      }
    });

    it("a retry of a running analysis is refused as in progress, with no second analysis", async () => {
      createAnalysisJob({ jobId: "req_1700000000002_running001", uid: "test-parent-uid", mode: "fast" });
      const res = await request(app)
        .post("/api/analyze")
        .set("Authorization", "Bearer test-token")
        .set("x-analysis-id", "req_1700000000002_running001")
        .send({ textContent: "A short parent statement used only in this test.", mode: "fast" });
      expect(res.status).toBe(409);
      expect(res.body.code).toBe("ANALYSIS_IN_PROGRESS");
      expect(mockCreateMessage).not.toHaveBeenCalled();
      expect(mockFreeScan.finalizeFreeScan).not.toHaveBeenCalled();
    });

    it("a retry of a completed analysis returns its saved report, with no second analysis", async () => {
      createAnalysisJob({ jobId: "req_1700000000003_done000001", uid: "test-parent-uid", mode: "fast" });
      completeAnalysisJob("req_1700000000003_done000001", { documentTitle: "Saved report" });
      const res = await request(app)
        .post("/api/analyze")
        .set("Authorization", "Bearer test-token")
        .set("x-analysis-id", "req_1700000000003_done000001")
        .send({ textContent: "A short parent statement used only in this test.", mode: "fast" });
      expect(res.status).toBe(200);
      expect(res.body.documentTitle).toBe("Saved report");
      expect(mockCreateMessage).not.toHaveBeenCalled();
      expect(mockFreeScan.finalizeFreeScan).not.toHaveBeenCalled();
    });

    it("a retry by a different account never reads or re-runs another account's analysis", async () => {
      createAnalysisJob({ jobId: "req_1700000000004_other000001", uid: "other-parent-uid", mode: "fast" });
      completeAnalysisJob("req_1700000000004_other000001", { documentTitle: "Someone else's report" });
      const res = await request(app)
        .post("/api/analyze")
        .set("Authorization", "Bearer test-token")
        .set("x-analysis-id", "req_1700000000004_other000001")
        .send({ textContent: "A short parent statement used only in this test.", mode: "fast" });
      expect(res.status).toBe(409);
      expect(res.body.code).toBe("ANALYSIS_ID_CONFLICT");
      expect(res.body).not.toHaveProperty("documentTitle");
      expect(mockCreateMessage).not.toHaveBeenCalled();
    });

    it("recovers after reauthentication by polling the same job, without starting another analysis", async () => {
      createAnalysisJob({ jobId: "job-auth-resume", uid: "test-parent-uid", mode: "fast" });

      mockFirebaseAdmin.verifyFirebaseToken.mockResolvedValueOnce(null);
      const signedOut = await request(app).get("/api/analyze/job/job-auth-resume").set(paid());
      expect(signedOut.status).toBe(401);
      expect(signedOut.body.code).toBe("SIGN_IN_REQUIRED");

      mockFirebaseAdmin.verifyFirebaseToken.mockResolvedValueOnce({ uid: "test-parent-uid", email: "parent@example.com" });
      const resumed = await request(app).get("/api/analyze/job/job-auth-resume").set(paid());
      expect(resumed.status).toBe(200);
      expect(resumed.body.jobId).toBe("job-auth-resume");
      expect(mockCreateMessage).not.toHaveBeenCalled();
    });
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
