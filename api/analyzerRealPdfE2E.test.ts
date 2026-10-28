import { beforeEach, describe, expect, it, vi } from "vitest";
import request from "supertest";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";

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
    url: "https://example.supabase.co",
    key: "test-service-role-key",
    source: "SUPABASE_SERVICE_ROLE_KEY",
  })),
  getConfiguredProjectRef: vi.fn(() => "test-project-ref"),
  extractProjectRef: vi.fn(() => "test-project-ref"),
  isSessionBoundToIdentity: vi.fn((session: any, identity: any) => {
    if (!session || !identity) return false;
    return session.firebaseUid === identity.uid;
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
  isAuthorizedSiteOwner: vi.fn((email: string | null | undefined, adminSecret?: string | null) => {
    if (adminSecret && adminSecret === "valid-admin-secret") return true;
    if (!email) return false;
    const lower = email.toLowerCase().trim();
    return (
      lower === "chris@cyfsanavigator.com" ||
      lower === "donations.ontarioparentassist@gmail.com" ||
      lower === "chrispelkie@gmail.com"
    );
  }),
}));

const mockFirebaseAdmin = vi.hoisted(() => ({
  verifyFirebaseToken: vi.fn(),
  verifyFirebaseIdentity: vi.fn(async (header: any) => {
    const r = await mockFirebaseAdmin.verifyFirebaseToken(header);
    return r ? { emailVerified: true, ...r } : null;
  }),
}));

// Free scans are held and consumed by the reservation model (mockFreeScan), not by the usage store.
const mockUsage = vi.hoisted(() => ({
  getFreeUsage: vi.fn(async () => 0),
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
process.env.ADMIN_SECRET = "valid-admin-secret";
process.env.ANTHROPIC_API_KEY = "test-anthropic-key";
process.env.SUPABASE_URL = "https://example.supabase.co";
process.env.SUPABASE_SERVICE_ROLE_KEY = "test-key";

const { default: app } = await import("./_server.js");
import { getAnalysisJob } from "./services/analyzerStreaming.js";

async function createCourtAffidavitPdf(): Promise<Buffer> {
  const pdfDoc = await PDFDocument.create();
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const boldFont = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

  const page = pdfDoc.addPage([612, 792]);
  const { height } = page.getSize();

  page.drawText("ONTARIO COURT OF JUSTICE", {
    x: 50,
    y: height - 50,
    size: 14,
    font: boldFont,
    color: rgb(0.1, 0.1, 0.1),
  });
  page.drawText("IN THE MATTER OF THE CHILD, YOUTH AND FAMILY SERVICES ACT, 2017", {
    x: 50,
    y: height - 70,
    size: 11,
    font: boldFont,
    color: rgb(0.2, 0.2, 0.2),
  });
  page.drawText("AFFIDAVIT OF CHILD PROTECTION WORKER SARAH JENKINS", {
    x: 50,
    y: height - 90,
    size: 12,
    font: boldFont,
    color: rgb(0, 0, 0),
  });

  const bodyText = [
    "1. I am a child protection worker employed with the Children's Aid Society.",
    "2. On September 15, 2026, the Society initiated a protection application under CYFSA Section 74.",
    "3. The maternal grandmother requested kin placement under section 94(5), but the Society placed the child with unrelated foster caregivers.",
    "4. A neighbour reported secondhand concerns stating 'a neighbour told me the children were unsupervised.'",
    "5. The Society requested an adjournment of 45 days to November 2, 2026, without respondent parent consent.",
  ];

  let y = height - 120;
  for (const line of bodyText) {
    page.drawText(line, {
      x: 50,
      y,
      size: 10,
      font,
      color: rgb(0.15, 0.15, 0.15),
      maxWidth: 512,
      lineHeight: 14,
    });
    y -= 24;
  }

  const pdfBytes = await pdfDoc.save();
  return Buffer.from(pdfBytes);
}

const REALISTIC_ANALYSIS_RESPONSE = {
  documentTitle: "Affidavit of Child Protection Worker Sarah Jenkins",
  documentType: "Court Affidavit",
  documentDate: "September 15, 2026",
  issuingAgency: "Children's Aid Society",
  caseNumber: "FC-26-0099",
  completenessScore: 88,
  evidenceStrengthIndex: {
    score: 52,
    scale: "0-100",
    label: "Moderate Evidentiary Weight",
    method: "Calculated across firsthand vs hearsay claims",
    components: {
      firsthandKnowledge: { score: 10, max: 20, explanation: "Worker relied largely on neighbour hearsay." },
      sourceReliability: { score: 8, max: 15, explanation: "Secondhand statements uncorroborated." },
      corroboration: { score: 6, max: 15, explanation: "No police report or physical evidence provided." },
      documentarySupport: { score: 8, max: 15, explanation: "Affidavit contains formal court caption." },
      internalConsistency: { score: 7, max: 10, explanation: "Chronology is internally consistent." },
      contradictoryEvidenceHandling: { score: 5, max: 10, explanation: "Grandmother kin placement omitted from initial filing." },
      legalAuthorityVerification: { score: 5, max: 10, explanation: "CYFSA s.74 cited." },
      proceduralDocumentation: { score: 3, max: 5, explanation: "Notice provided." },
    },
    calculation: "Sum of components",
    limitations: "Document evaluation only",
  },
  fileSummary: "CAS protection application alleging lack of supervision based primarily on uncorroborated neighbour hearsay.",
  redFlags: [
    {
      id: "rf_hearsay_1",
      severity: "Substantial Evidentiary Gap",
      category: "Uncorroborated Hearsay",
      evidenceClassification: "HEARSAY",
      phraseDetected: "a neighbour told me the children were unsupervised.",
      explanation: "Protection worker repeats anonymous neighbour hearsay without independent verification.",
      verifyRequirement: "Demand disclosure of contemporaneous worker notes and neighbour interview transcript.",
      legalReference: "CYFSA s. 74",
      locationInDocument: "Paragraph 4",
      parentActionStep: "Instruct counsel to object to hearsay under Evidence Act.",
    },
    {
      id: "rf_kinship_2",
      severity: "Procedural Violation",
      category: "Kinship Assessment Failure",
      evidenceClassification: "DIRECT",
      phraseDetected: "The maternal grandmother requested kin placement under section 94(5), but the Society placed the child with unrelated foster caregivers.",
      explanation: "Society bypassed mandatory kinship exploration before foster placement.",
      verifyRequirement: "Request immediate formal kinship assessment of maternal grandmother.",
      legalReference: "CYFSA s. 94(5)",
      locationInDocument: "Paragraph 3",
      parentActionStep: "File Form 14B motion for immediate temporary custody to grandmother.",
    },
  ],
  proceduralTimelineViolations: [
    {
      event: "Adjournment beyond 30-day statutory limit",
      targetDate: "October 18, 2026",
      actualDate: "November 2, 2026",
      delay: "15 days beyond statutory cap",
      statuteReference: "CYFSA s. 94(1)",
      evaluation: "CYFSA s. 94(1) strictly prohibits adjourning child protection hearings beyond 30 days without all-party consent.",
    },
  ],
};

const { COMPLETE_ANALYSIS, sectionResponder } = await import("./analyzerTestFixtures.js");

describe("Authentic End-to-End Real PDF Analyzer Verification", () => {
  beforeEach(() => {
    mockFreeScan.reset();
    vi.clearAllMocks();

    mockFirebaseAdmin.verifyFirebaseToken.mockImplementation(async (authHeader: string | undefined) => {
      if (authHeader === "Bearer owner-token") {
        return { uid: "owner-uid-123", email: "chris@cyfsanavigator.com" };
      }
      if (authHeader === "Bearer donations-owner-token") {
        return { uid: "owner-uid-456", email: "donations.ontarioparentassist@gmail.com" };
      }
      if (authHeader === "Bearer regular-parent-token") {
        return { uid: "parent-uid-789", email: "parent@example.com" };
      }
      return null;
    });

    mockCreateMessage.mockReset();
    // Every section request picks its own keys from one complete report.
    mockCreateMessage.mockImplementation(
      sectionResponder({
        ...COMPLETE_ANALYSIS,
        ...REALISTIC_ANALYSIS_RESPONSE,
        // The realistic fixture predates the Forensic section schema; take those from the complete one.
        thresholdAnalysis: COMPLETE_ANALYSIS.thresholdAnalysis,
        proceduralTimelineViolations: COMPLETE_ANALYSIS.proceduralTimelineViolations,
        charterAndHumanRightsIssues: COMPLETE_ANALYSIS.charterAndHumanRightsIssues,
      })
    );
  });

  it("1. Performs complete real PDF analysis from upload through Claude with SSE streaming and quote verification", async () => {
    const pdfBuffer = await createCourtAffidavitPdf();
    expect(pdfBuffer.length).toBeGreaterThan(1000);
    const base64Pdf = pdfBuffer.toString("base64");

    const analysisJobId = `req_${Date.now()}_realpdf1`;

    const res = await request(app)
      .post("/api/analyze")
      .set("Authorization", "Bearer owner-token")
      .set("x-analysis-id", analysisJobId)
      .set("Accept", "text/event-stream")
      .send({
        fileData: {
          base64: base64Pdf,
          mimeType: "application/pdf",
          name: "Affidavit_Sarah_Jenkins.pdf",
        },
        mode: "fast",
        stream: true,
      });

    expect(res.status).toBe(200);
    expect(res.header["content-type"]).toContain("text/event-stream");

    // Verify raw stream has 2KB preamble
    expect(res.text.length).toBeGreaterThan(2048);

    // Parse SSE stream events
    const rawChunks = res.text.split("\n\n");
    const events: any[] = [];
    for (const chunk of rawChunks) {
      const dataLine = chunk.split("\n").find((l) => l.startsWith("data: "));
      if (dataLine) {
        try {
          events.push(JSON.parse(dataLine.replace(/^data: /, "")));
        } catch {}
      }
    }

    expect(events.length).toBeGreaterThan(0);

    // Verify stage progression
    const stageEvents = events.filter((e) => e.type === "stage");
    const stages = stageEvents.map((e) => e.stage);
    expect(stages).toContain("extracting");
    expect(stages).toContain("reviewing_evidence");
    expect(stages).toContain("preparing_report");

    // Verify percentages advance monotonically
    const percents = stageEvents.map((e) => e.percent);
    for (let i = 1; i < percents.length; i++) {
      expect(percents[i]).toBeGreaterThanOrEqual(percents[i - 1]);
    }

    // Verify complete event
    const completeEvent = events.find((e) => e.type === "complete");
    expect(completeEvent).toBeDefined();
    expect(completeEvent.report).toBeDefined();

    const report = completeEvent.report;
    expect(report.documentTitle).toBe("Affidavit of Child Protection Worker Sarah Jenkins");
    expect(report.evidenceStrengthIndex.score).toBe(52);
    expect(report.redFlags.length).toBe(2);

    // Verify exact quote verification against the authentic text embedded in the PDF
    const hearsayFlag = report.redFlags.find((f: any) => f.id === "rf_hearsay_1");
    expect(hearsayFlag).toBeDefined();
    expect(hearsayFlag.quoteVerified).toBe(true);
    expect(hearsayFlag.quoteVerification).toBe("EXACT");

    const kinshipFlag = report.redFlags.find((f: any) => f.id === "rf_kinship_2");
    expect(kinshipFlag).toBeDefined();
    expect(kinshipFlag.quoteVerified).toBe(true);

    // Verify job was persisted and can be recovered
    const savedJob = getAnalysisJob(analysisJobId);
    expect(savedJob).toBeDefined();
    expect(savedJob?.status).toBe("completed");
    expect(savedJob?.percent).toBe(100);
  });

  it("2. Site owner enjoys admin testing entitlement: unlimited analyses without paywall or credit consumption", async () => {
    // 2a. GET /api/analyzer-usage returns admin entitlement for chris@cyfsanavigator.com
    const usageRes = await request(app)
      .get("/api/analyzer-usage")
      .set("Authorization", "Bearer owner-token");

    expect(usageRes.status).toBe(200);
    expect(usageRes.body.type).toBe("admin");
    expect(usageRes.body.isAdminEntitled).toBe(true);
    expect(usageRes.body.remaining).toBe(999);
    expect(usageRes.body.tier).toBe("Admin Testing Access");

    // 2b. GET /api/analyzer-usage returns admin entitlement for donations.ontarioparentassist@gmail.com
    const donationsRes = await request(app)
      .get("/api/analyzer-usage")
      .set("Authorization", "Bearer donations-owner-token");

    expect(donationsRes.status).toBe(200);
    expect(donationsRes.body.type).toBe("admin");
    expect(donationsRes.body.isAdminEntitled).toBe(true);

    // 2c. Owner can run Forensic In-Depth (mode: "full") without purchasing a paid pass
    const fullRes = await request(app)
      .post("/api/analyze")
      .set("Authorization", "Bearer owner-token")
      .send({
        textContent: "IN THE MATTER OF CYFSA 2017: Hearing adjournment requested.",
        mode: "full",
      });

    expect(fullRes.status).toBe(200);
    expect(fullRes.body.documentTitle).toBeDefined();
    // The site owner is entitled without a free scan: nothing is reserved, held or consumed.
    expect(mockFreeScan.reserveFreeScan).not.toHaveBeenCalled();
    expect(mockFreeScan.consumedFor("owner-uid-123")).toBe(0);
  });

  it("3. Regular parent without paid access cannot run Forensic In-Depth and is gated with 403", async () => {
    const res = await request(app)
      .post("/api/analyze")
      .set("Authorization", "Bearer regular-parent-token")
      .send({
        textContent: "Court document content.",
        mode: "full",
      });

    expect(res.status).toBe(403);
    expect(res.body.code).toBe("FORENSIC_UPGRADE_REQUIRED");
  });

  it("4. A free analysis that fails returns its reserved scan, so the parent keeps the allowance", async () => {
    // Simulate Claude failure on regular parent
    mockCreateMessage.mockRejectedValue(new Error("AI service temporary timeout"));

    const res = await request(app)
      .post("/api/analyze")
      .set("Authorization", "Bearer regular-parent-token")
      .send({
        textContent: "Parent statement for free analysis.",
        mode: "fast",
      });

    expect(res.status).toBe(503);
    expect(res.body.error).toBeDefined();

    // The scan was reserved for this request, then returned once the analysis failed. Nothing is held or consumed.
    expect(mockFreeScan.reserveFreeScan).toHaveBeenCalledWith(expect.objectContaining({ uid: "parent-uid-789" }));
    expect(mockFreeScan.releaseFreeScan).toHaveBeenCalledWith(expect.objectContaining({ uid: "parent-uid-789" }));
    expect(mockFreeScan.heldFor("parent-uid-789")).toBe(0);
    expect(mockFreeScan.consumedFor("parent-uid-789")).toBe(0);
  });

  it("4b. A delivered free analysis consumes exactly one scan; a repeat of it is not charged again", async () => {
    const analysisId = `req_${Date.now()}_freeone1`;
    const first = await request(app)
      .post("/api/analyze")
      .set("Authorization", "Bearer regular-parent-token")
      .set("x-analysis-id", analysisId)
      .send({ textContent: "Parent statement for free analysis.", mode: "fast" });
    expect(first.status).toBe(200);
    expect(mockFreeScan.consumedFor("parent-uid-789")).toBe(1);
    expect(mockFreeScan.heldFor("parent-uid-789")).toBe(1);

    // The same request again returns the saved report: still one scan, no second model run.
    const callsAfterFirst = mockCreateMessage.mock.calls.length;
    const repeat = await request(app)
      .post("/api/analyze")
      .set("Authorization", "Bearer regular-parent-token")
      .set("x-analysis-id", analysisId)
      .send({ textContent: "Parent statement for free analysis.", mode: "fast" });
    expect(repeat.status).toBe(200);
    expect(mockCreateMessage.mock.calls.length).toBe(callsAfterFirst);
    expect(mockFreeScan.consumedFor("parent-uid-789")).toBe(1);

    // A new analysis is refused: the one free scan is used.
    const second = await request(app)
      .post("/api/analyze")
      .set("Authorization", "Bearer regular-parent-token")
      .send({ textContent: "A second statement.", mode: "fast" });
    expect(second.status).toBe(402);
    expect(second.body.code).toBe("FREE_LIMIT_REACHED");
  });

  it("5. Retrying with identical idempotency key is safely deduplicated", async () => {
    const idempotencyKey = `idemp_test_${Date.now()}`;

    const res1 = await request(app)
      .post("/api/analyze")
      .set("Authorization", "Bearer owner-token")
      .set("idempotency-key", idempotencyKey)
      .send({
        textContent: "Document text to analyze.",
        mode: "fast",
      });

    expect(res1.status).toBe(200);

    const res2 = await request(app)
      .post("/api/analyze")
      .set("Authorization", "Bearer owner-token")
      .set("idempotency-key", idempotencyKey)
      .send({
        textContent: "Document text to analyze.",
        mode: "fast",
      });

    expect(res2.status).toBe(200);
    expect(res2.body.documentTitle).toBe(res1.body.documentTitle);
  });

  it("5b. Resubmitting a completed analysis id returns the saved report without a second model run", async () => {
    const analysisId = `req_${Date.now()}_dedupe1`;
    const first = await request(app)
      .post("/api/analyze")
      .set("Authorization", "Bearer owner-token")
      .set("x-analysis-id", analysisId)
      .send({ textContent: "Document text to analyze.", mode: "fast" });
    expect(first.status).toBe(200);
    const callsAfterFirst = mockCreateMessage.mock.calls.length;

    const again = await request(app)
      .post("/api/analyze")
      .set("Authorization", "Bearer owner-token")
      .set("x-analysis-id", analysisId)
      .send({ textContent: "Document text to analyze.", mode: "fast" });
    expect(again.status).toBe(200);
    expect(again.body.documentTitle).toBe(first.body.documentTitle);
    expect(mockCreateMessage.mock.calls.length).toBe(callsAfterFirst); // no second (paid) run

    // Another account cannot reuse (or read through) someone else's analysis id.
    const other = await request(app)
      .post("/api/analyze")
      .set("Authorization", "Bearer regular-parent-token")
      .set("x-analysis-id", analysisId)
      .send({ textContent: "Document text to analyze.", mode: "fast" });
    expect(other.status).toBe(409);
    expect(other.body.code).toBe("ANALYSIS_ID_CONFLICT");
  });

  it("6. Job recovery via GET /api/analyze/job/:jobId is isolated by authenticated user", async () => {
    const jobKey = `req_${Date.now()}_jobiso1`;
    const pdfBuffer = await createCourtAffidavitPdf();

    await request(app)
      .post("/api/analyze")
      .set("Authorization", "Bearer owner-token")
      .set("x-analysis-id", jobKey)
      .send({
        fileData: {
          base64: pdfBuffer.toString("base64"),
          mimeType: "application/pdf",
          name: "affidavit.pdf",
        },
        mode: "fast",
      });

    // Owner retrieves own job -> 200 OK
    const ownerGet = await request(app)
      .get(`/api/analyze/job/${jobKey}`)
      .set("Authorization", "Bearer owner-token");

    expect(ownerGet.status).toBe(200);
    expect(ownerGet.body.status).toBe("completed");

    // Other user attempts to retrieve owner's job -> 403 FORBIDDEN
    const otherGet = await request(app)
      .get(`/api/analyze/job/${jobKey}`)
      .set("Authorization", "Bearer regular-parent-token");

    expect(otherGet.status).toBe(403);
    expect(otherGet.body.code).toBe("FORBIDDEN");
  });
});
