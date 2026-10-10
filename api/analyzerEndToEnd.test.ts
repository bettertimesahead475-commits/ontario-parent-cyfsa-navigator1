// Regression tests for the Document Analyzer request path, from access checks through the AI
// provider response to the JSON the frontend receives. Runs the real route handlers in
// _server.ts; only Firebase Admin, the Supabase-backed access/usage services and the AI SDKs are
// mocked (the same harness as _server.test.ts).
//
// Locks in the analyzer repair:
//   - access/usage outages fail CLOSED with a JSON 503 (never fail open, never hang),
//   - a provider-side 401/404 is not reported to the parent as "please sign in",
//   - refusals / malformed / empty model output are reported as AI_RESPONSE_INVALID,
//   - a failed analysis never consumes the free analysis,
//   - text extraction no longer depends on the paid-session database lookup.
import { beforeEach, describe, expect, it, vi } from "vitest";
import request from "supertest";
import { LifecycleError } from "./services/lifecycleErrors.js";

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
    if (Array.isArray(identity.allUids) && identity.allUids.includes(session.firebaseUid)) return true;
    return false;
  }),
  healSessionUidBinding: vi.fn(async () => {}),
  TIER_PRICES: {
    Basic: 19.99,
    AnalyzerBasic: 19.99,
    Premium: 49.99,
    AnalyzerPremium: 49.99,
    Pro: 149,
    Community5: 2000,
    Community10: 3500,
    Community25: 7500,
  },
  ALL_TIER_PRICES: {
    Basic: 19.99,
    AnalyzerBasic: 19.99,
    Premium: 49.99,
    AnalyzerPremium: 49.99,
    Pro: 149,
    Community5: 2000,
    Community10: 3500,
    Community25: 7500,
  },
  LEGACY_TIER_PRICES: {},
  isAnalyzerTier: vi.fn((tier: string) => ["Basic", "AnalyzerBasic", "Premium", "AnalyzerPremium"].includes(tier)),
  isCaseAccessTier: vi.fn((tier: string) => ["Pro", "Community5", "Community10", "Community25"].includes(tier)),
  hasCaseAccess: vi.fn((tier: string) => ["Pro", "Community5", "Community10", "Community25"].includes(tier)),
  hasAnalyzerAccess: vi.fn((tier: string) => ["Basic", "AnalyzerBasic", "Premium", "AnalyzerPremium", "Pro", "Community5", "Community10", "Community25"].includes(tier)),
  hasForensicInDepthAccess: vi.fn((tier: string) => ["Premium", "AnalyzerPremium", "Pro", "Community5", "Community10", "Community25"].includes(tier)),
}));
const mockFirebaseAdmin = vi.hoisted(() => ({ verifyFirebaseToken: vi.fn() }));
const mockUsage = vi.hoisted(() => ({
  getFreeUsage: vi.fn(async () => 0),
  recordFreeUse: vi.fn(async () => {}),
  FREE_ANALYSES_LIMIT: 1,
  BASIC_QUICK_REVIEWS_LIMIT: 3,
  PREMIUM_FORENSIC_ANALYSES_LIMIT: 3,
  CASE_ACCESS_FORENSIC_ANALYSES_LIMIT: 5,
  TIER_LIMITS: {
    Free: { quickReviews: 1, forensicAnalyses: 0 },
    Basic: { quickReviews: 3, forensicAnalyses: 0 },
    AnalyzerBasic: { quickReviews: 3, forensicAnalyses: 0 },
    Premium: { quickReviews: Infinity, forensicAnalyses: 3 },
    AnalyzerPremium: { quickReviews: Infinity, forensicAnalyses: 3 },
    Pro: { quickReviews: Infinity, forensicAnalyses: 5 },
    Community5: { quickReviews: Infinity, forensicAnalyses: 5 },
    Community10: { quickReviews: Infinity, forensicAnalyses: 5 },
    Community25: { quickReviews: Infinity, forensicAnalyses: 5 },
  },
  checkPaidUsage: vi.fn((_sessionId: string, tier: string, type: string) => ({
    allowed: true,
    used: 0,
    limit: type === "quick" ? (tier.startsWith("Basic") ? 3 : Infinity) : (tier === "Pro" || tier.startsWith("Community") ? 5 : 3),
    remaining: type === "quick" ? (tier.startsWith("Basic") ? 3 : null) : (tier === "Pro" || tier.startsWith("Community") ? 5 : 3),
    tier,
  }) as any),
  recordPaidUse: vi.fn(async () => 1),
  getPaidUsageStatus: vi.fn(async (_sessionId: string, tier: string) => ({
    tier,
    quickReviewsUsed: 0,
    quickReviewsLimit: tier.startsWith("Basic") ? 3 : null,
    quickReviewsRemaining: tier.startsWith("Basic") ? 3 : null,
    forensicAnalysesUsed: 0,
    forensicAnalysesLimit: tier === "Pro" || tier.startsWith("Community") ? 5 : 3,
    forensicAnalysesRemaining: tier === "Pro" || tier.startsWith("Community") ? 5 : 3,
  })),
  isAnalysisAlreadyRecorded: vi.fn(() => false),
  markAnalysisRecorded: vi.fn(),
  resetUsageCachesForTesting: vi.fn(),
}));

vi.mock("@anthropic-ai/sdk", () => ({
  default: class MockAnthropic {
    messages = { create: mockCreateMessage };
  },
}));
vi.mock("@google/genai", () => ({
  GoogleGenAI: class MockGoogleGenAI {
    models = { generateContent: mockGenerateContent };
  },
}));
vi.mock("nodemailer", () => ({ default: { createTransport: () => ({ sendMail: vi.fn() }) } }));
vi.mock("./services/access.js", () => mockAccess);
vi.mock("./services/firebaseAdmin.js", () => mockFirebaseAdmin);
vi.mock("./services/usage.js", () => mockUsage);
vi.mock("./services/gmailAgent.js", () => ({
  getGmailAuthUrl: vi.fn(),
  exchangeGmailAuthCode: vi.fn(),
  scanForPayments: vi.fn(),
  verifyOAuthState: vi.fn(() => false),
}));
vi.mock("./services/cases.js", () => ({ createCase: vi.fn() }));

process.env.VERCEL = "1";
process.env.ANTHROPIC_API_KEY = "test-anthropic-key";
process.env.GEMINI_API_KEY = "test-gemini-key";
process.env.ADMIN_SECRET = "test-admin-secret";
process.env.SESSION_SECRET = "test-session-secret";

const { default: app } = await import("./_server.js");

const FREE_TOKEN = "Bearer free-user-token";
const PAID_TOKEN = "Bearer paid-user-token";
const free = () => ({ Authorization: FREE_TOKEN });
const paid = () => ({ Authorization: PAID_TOKEN, "x-ps-session": "paid-session" });

const CORE = {
  documentTitle: "Affidavit of a worker",
  documentType: "Affidavit",
  metadata: {},
  disclaimer: "disclaimer",
  completenessScore: 40,
  evidenceStrengthIndex: { score: 35 },
  fileSummary: "summary",
  redFlags: [
    {
      id: "rf1",
      severity: "Affects Evidentiary Weight",
      category: "Hearsay",
      phraseDetected: "a neighbour told me",
      explanation: "secondhand",
      verifyRequirement: "ask for the source",
      legalReference: "⚠️ Statute citation unverified — confirm exact section with counsel before relying on this.",
      locationInDocument: "Page 2, Paragraph 4",
      parentActionStep: "ask your lawyer",
    },
  ],
};
const claudeText = (text: string, stop_reason = "end_turn") => ({ content: [{ type: "text", text }], stop_reason, usage: {} });

beforeEach(() => {
  vi.clearAllMocks();
  mockFirebaseAdmin.verifyFirebaseToken.mockImplementation(async (header?: string) => {
    if (header === FREE_TOKEN) return { uid: "free-uid", email: "free@example.com" };
    if (header === PAID_TOKEN) return { uid: "paid-uid", email: "paid@example.com" };
    return null;
  });
  mockAccess.verifySessionToken.mockImplementation((t: string) => (t === "paid-session" ? { jti: "jti-1" } : null));
  mockAccess.getActivePaidSession.mockResolvedValue({ id: "jti-1", firebaseUid: "paid-uid", tier: "Pro" });
  mockUsage.getFreeUsage.mockResolvedValue(0);
  mockUsage.recordFreeUse.mockResolvedValue(undefined);
  mockAccess.checkAndConsumeFreeToolUse.mockResolvedValue(false);
});

describe("analyzer access validation", () => {
  it("rejects an unauthenticated request without touching usage or the model", async () => {
    const res = await request(app).post("/api/analyze").send({ textContent: "text", mode: "fast" });
    expect(res.status).toBe(401);
    expect(res.body.code).toBe("SIGN_IN_REQUIRED");
    expect(mockUsage.getFreeUsage).not.toHaveBeenCalled();
    expect(mockCreateMessage).not.toHaveBeenCalled();
  });

  it("runs a free analysis end to end and records the use only after success", async () => {
    mockCreateMessage.mockResolvedValueOnce(claudeText(JSON.stringify(CORE)));
    const res = await request(app).post("/api/analyze").set(free()).send({ textContent: "a neighbour told me", mode: "fast" });
    expect(res.status).toBe(200);
    expect(res.body.documentTitle).toBe("Affidavit of a worker");
    expect(res.body.redFlags[0].locationInDocument).toBe("Page 2, Paragraph 4");
    expect(res.body.evidenceStrengthIndex.score).toBe(35);
    expect(res.body.timing.mode).toBe("fast");
    expect(mockUsage.recordFreeUse).toHaveBeenCalledWith("free-uid", "free@example.com");
  });

  it("blocks a free user whose free analysis is exhausted", async () => {
    mockUsage.getFreeUsage.mockResolvedValueOnce(1);
    const res = await request(app).post("/api/analyze").set(free()).send({ textContent: "text", mode: "fast" });
    expect(res.status).toBe(402);
    expect(res.body.code).toBe("FREE_LIMIT_REACHED");
    expect(mockCreateMessage).not.toHaveBeenCalled();
  });

  it("fails CLOSED with a JSON 503 when the usage service is unreachable (no fail-open)", async () => {
    mockUsage.getFreeUsage.mockRejectedValueOnce(
      new LifecycleError(503, "USAGE_SERVICE_TEMPORARILY_UNAVAILABLE", "We couldn't verify your analysis access right now.")
    );
    const res = await request(app).post("/api/analyze").set(free()).send({ textContent: "text", mode: "fast" });
    expect(res.status).toBe(503);
    expect(res.body.code).toBe("USAGE_SERVICE_TEMPORARILY_UNAVAILABLE");
    expect(res.body.retryable).toBe(true);
    expect(mockCreateMessage).not.toHaveBeenCalled();
    expect(mockUsage.recordFreeUse).not.toHaveBeenCalled();
  });

  it("fails CLOSED when the paid-session lookup errors, without falling back to the free tier", async () => {
    mockAccess.getActivePaidSession.mockRejectedValueOnce(new Error("Failed to look up paid session: TypeError: fetch failed"));
    const res = await request(app).post("/api/analyze").set(paid()).send({ textContent: "text", mode: "fast" });
    expect(res.status).toBe(503);
    expect(res.body.code).toBe("USAGE_SERVICE_TEMPORARILY_UNAVAILABLE");
    expect(mockUsage.getFreeUsage).not.toHaveBeenCalled();
    expect(mockCreateMessage).not.toHaveBeenCalled();
  });

  it("lets an active paid session analyze without reading or charging the free allowance", async () => {
    mockCreateMessage.mockResolvedValueOnce(claudeText(JSON.stringify(CORE)));
    const res = await request(app).post("/api/analyze").set(paid()).send({ textContent: "text", mode: "fast" });
    expect(res.status).toBe(200);
    expect(mockUsage.getFreeUsage).not.toHaveBeenCalled();
    expect(mockUsage.recordFreeUse).not.toHaveBeenCalled();
  });

  it("does not treat a session token bound to a different user as paid", async () => {
    mockAccess.getActivePaidSession.mockResolvedValueOnce({ id: "jti-1", firebaseUid: "someone-else", tier: "Pro" });
    mockUsage.getFreeUsage.mockResolvedValueOnce(1);
    const res = await request(app).post("/api/analyze").set(paid()).send({ textContent: "text", mode: "fast" });
    expect(res.status).toBe(402);
    expect(mockCreateMessage).not.toHaveBeenCalled();
  });
});

describe("analysis provider responses", () => {
  it("reports a provider authentication failure as a provider problem, not 'please sign in'", async () => {
    mockCreateMessage.mockRejectedValueOnce(Object.assign(new Error("invalid x-api-key"), { status: 401 }));
    const res = await request(app).post("/api/analyze").set(free()).send({ textContent: "text", mode: "fast" });
    expect(res.status).toBe(503);
    expect(res.body.code).toBe("AI_PROVIDER_CONFIGURATION_ERROR");
    expect(res.body.error).not.toMatch(/sign in/i);
    expect(mockUsage.recordFreeUse).not.toHaveBeenCalled();
  });

  it("reports an unknown-model 404 as a provider configuration problem", async () => {
    mockCreateMessage.mockRejectedValueOnce(Object.assign(new Error("model not found"), { status: 404 }));
    const res = await request(app).post("/api/analyze").set(free()).send({ textContent: "text", mode: "fast" });
    expect(res.status).toBe(503);
    expect(res.body.code).toBe("AI_PROVIDER_CONFIGURATION_ERROR");
  });

  it("reports a provider connection failure as temporarily unavailable and retryable", async () => {
    mockCreateMessage.mockRejectedValueOnce(Object.assign(new Error("Connection error."), { name: "APIConnectionError" }));
    const res = await request(app).post("/api/analyze").set(free()).send({ textContent: "text", mode: "fast" });
    expect(res.status).toBe(503);
    expect(res.body.code).toBe("AI_PROVIDER_TEMPORARILY_UNAVAILABLE");
    expect(res.body.retryable).toBe(true);
  });

  it("keeps the isRateLimit flag on 429 responses", async () => {
    mockCreateMessage.mockRejectedValueOnce(Object.assign(new Error("rate limited"), { status: 429 }));
    const res = await request(app).post("/api/analyze").set(free()).send({ textContent: "text", mode: "fast" });
    expect(res.status).toBe(429);
    expect(res.body.code).toBe("AI_RATE_LIMITED");
    expect(res.body.isRateLimit).toBe(true);
  });

  it("reports malformed model output as AI_RESPONSE_INVALID and does not consume the free use", async () => {
    mockCreateMessage.mockResolvedValueOnce(claudeText("this is not json"));
    const res = await request(app).post("/api/analyze").set(free()).send({ textContent: "text", mode: "fast" });
    expect(res.status).toBe(422);
    expect(res.body.code).toBe("AI_RESPONSE_INVALID");
    expect(mockUsage.recordFreeUse).not.toHaveBeenCalled();
  });

  it("reports truncated model output as incomplete", async () => {
    mockCreateMessage.mockResolvedValueOnce(claudeText('```json\n{"documentTitle": "x", "redFlags": [', "max_tokens"));
    const res = await request(app).post("/api/analyze").set(free()).send({ textContent: "text", mode: "fast" });
    expect(res.status).toBe(422);
    expect(res.body.code).toBe("AI_RESPONSE_INVALID");
    expect(res.body.error).toMatch(/incomplete/i);
  });

  it("reports a model refusal clearly", async () => {
    mockCreateMessage.mockResolvedValueOnce({ content: [], stop_reason: "refusal", usage: {} });
    const res = await request(app).post("/api/analyze").set(free()).send({ textContent: "text", mode: "fast" });
    expect(res.status).toBe(422);
    expect(res.body.code).toBe("AI_RESPONSE_INVALID");
    expect(res.body.error).toMatch(/declined/i);
  });

  it("returns the merged full report when mode is not fast", async () => {
    mockCreateMessage
      .mockResolvedValueOnce(claudeText(JSON.stringify(CORE)))
      .mockResolvedValueOnce(claudeText(JSON.stringify({ thresholdAnalysis: [{ thresholdChecked: "s.74" }], lawyerCaseBrief: ["b"] })));
    const res = await request(app).post("/api/analyze").set(free()).send({ textContent: "text" });
    expect(res.status).toBe(200);
    expect(res.body.redFlags).toHaveLength(1);
    expect(res.body.thresholdAnalysis).toHaveLength(1);
    expect(res.body.timing.mode).toBe("full");
  });
});

describe("POST /api/extract-text", () => {
  const textFile = (text: string) => ({ fileData: { base64: Buffer.from(text).toString("base64"), mimeType: "text/plain" } });

  it("requires a signed-in identity", async () => {
    const res = await request(app).post("/api/extract-text").send(textFile("hello"));
    expect(res.status).toBe(401);
  });

  it("extracts text without any paid-session database lookup", async () => {
    const res = await request(app).post("/api/extract-text").set(paid()).send(textFile("Paragraph one."));
    expect(res.status).toBe(200);
    expect(res.body.extractedText).toBe("Paragraph one.");
    expect(res.body.pages).toHaveLength(1);
    expect(mockAccess.getActivePaidSession).not.toHaveBeenCalled();
  });

  it("reports empty extraction accurately", async () => {
    const res = await request(app).post("/api/extract-text").set(free()).send(textFile("   "));
    expect(res.status).toBe(422);
    expect(res.body.code).toBe("EMPTY_SOURCE");
  });

  it("reports an OCR provider failure as EXTRACTION_FAILED", async () => {
    mockGenerateContent.mockRejectedValue(Object.assign(new Error("permission denied"), { status: 403 }));
    const png = { fileData: { base64: Buffer.from("not-really-a-png").toString("base64"), mimeType: "image/png" } };
    const res = await request(app).post("/api/extract-text").set(free()).send(png);
    expect(res.status).toBe(503);
    expect(res.body.code).toBe("EXTRACTION_FAILED");
    expect(res.body.error).not.toMatch(/sign in/i);
  });
});

describe("Forensic / deep scan access", () => {
  it("responds with JSON 503 (instead of hanging) when the paid-session lookup fails", async () => {
    mockAccess.getActivePaidSession.mockRejectedValueOnce(new Error("Failed to look up paid session: TypeError: fetch failed"));
    const res = await request(app).post("/api/deep-scan").set(paid()).send({ documentText: "text" });
    expect(res.status).toBe(503);
    expect(res.body.code).toBe("USAGE_SERVICE_TEMPORARILY_UNAVAILABLE");
    expect(mockCreateMessage).not.toHaveBeenCalled();
  });

  it("requires an active paid session", async () => {
    const res = await request(app).post("/api/deep-scan").set(free()).send({ documentText: "text" });
    expect(res.status).toBe(402);
    expect(mockCreateMessage).not.toHaveBeenCalled();
  });

  it("returns forensic findings for an entitled user", async () => {
    mockCreateMessage.mockResolvedValueOnce(
      claudeText(JSON.stringify({ gaps: ["g"], missingEvidence: ["m"], retorts: [{ claim: "c", objection: "o", action: "a" }] }))
    );
    const res = await request(app).post("/api/deep-scan").set(paid()).send({ documentText: "text", priorAnalysis: CORE });
    expect(res.status).toBe(200);
    expect(res.body.retorts[0].claim).toBe("c");
    expect(typeof res.body.timing.durationMs).toBe("number");
  });
});

describe("free-tool usage outage", () => {
  it("reports a usage-store outage as 503, not as 'requires a paid plan'", async () => {
    mockAccess.checkAndConsumeFreeToolUse.mockRejectedValueOnce(new Error("Failed to check free tool usage: TypeError: fetch failed"));
    const res = await request(app).post("/api/extract-evidence").set(free()).send({ documentText: "text" });
    expect(res.status).toBe(503);
    expect(res.body.code).toBe("USAGE_SERVICE_TEMPORARILY_UNAVAILABLE");
  });
});

describe("GET /api/admin/supabase-health", () => {
  it("requires the admin secret", async () => {
    const res = await request(app).get("/api/admin/supabase-health");
    expect(res.status).toBe(401);
    expect(mockAccess.getSupabase).not.toHaveBeenCalled();
  });

  it("returns only non-secret diagnostics", async () => {
    process.env.SUPABASE_URL = "https://abcdefghijklmnopqrst.supabase.co";
    const fakeKey = `x.${Buffer.from(JSON.stringify({ role: "service_role", ref: "abcdefghijklmnopqrst" })).toString("base64url")}.SIGNATURE-SECRET`;
    process.env.SUPABASE_SERVICE_ROLE_KEY = fakeKey;
    mockAccess.getSupabase.mockReturnValue({
      from: () => ({ select: () => ({ retry: async () => ({ error: null, count: 0 }) }) }),
    });
    try {
      const res = await request(app).get("/api/admin/supabase-health").set("x-admin-secret", "test-admin-secret");
      expect(res.body.host).toBe("abcdefghijklmnopqrst.supabase.co");
      expect(res.body.key).toEqual({ source: "SUPABASE_SERVICE_ROLE_KEY", format: "jwt", jwtRole: "service_role", jwtRef: "abcdefghijklmnopqrst" });
      expect(res.body.keyRefMatchesHost).toBe(true);
      expect(res.body.query.ok).toBe(true);
      expect(JSON.stringify(res.body)).not.toContain("SIGNATURE-SECRET");
    } finally {
      delete process.env.SUPABASE_URL;
      delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    }
  });
});

describe("Analyzer Access Isolation & Multi-Representation Binding", () => {
  it("recognizes paid access when session row was bound to user's Google numeric sub and caller presents Firebase localId with verified allUids link", async () => {
    const googleSub = "100892974326001234567";
    const firebaseLocalId = "Wq9jKl209abCdEfGhIj";
    const verifiedEmail = "parent.case@example.com";

    mockAccess.verifySessionToken.mockReturnValueOnce({ jti: "session-google-sub" });
    mockAccess.getActivePaidSession.mockResolvedValueOnce({
      id: "session-google-sub",
      firebaseUid: googleSub,
      tier: "Premium",
      email: verifiedEmail,
    });
    mockFirebaseAdmin.verifyFirebaseToken.mockResolvedValueOnce({
      uid: firebaseLocalId,
      email: verifiedEmail,
      allUids: [firebaseLocalId, googleSub],
    });
    mockCreateMessage.mockResolvedValueOnce(claudeText(JSON.stringify(CORE)));

    const res = await request(app)
      .post("/api/analyze")
      .set({
        Authorization: "Bearer token-with-firebase-localid",
        "x-ps-session": "token-for-google-sub",
      })
      .send({ textContent: "Valid test document text", mode: "fast" });

    expect(res.status).toBe(200);
    expect(res.body.documentTitle).toBe("Affidavit of a worker");
  });

  it("fails closed when identity email matches but UID does NOT match and is not in verified allUids", async () => {
    const verifiedEmail = "member@example.com";
    mockAccess.verifySessionToken.mockReturnValueOnce({ jti: "session-email-bound" });
    mockAccess.getActivePaidSession.mockResolvedValueOnce({
      id: "session-email-bound",
      firebaseUid: "old-account-uid-999",
      tier: "Premium",
      email: verifiedEmail,
    });
    mockFirebaseAdmin.verifyFirebaseToken.mockResolvedValueOnce({
      uid: "different-account-uid-111",
      email: verifiedEmail,
    });

    const res = await request(app)
      .get("/api/analyzer-usage")
      .set({
        Authorization: "Bearer different-account-token",
        "x-ps-session": "session-token",
      });

    expect(res.status).toBe(200);
    expect(res.body.type).toBe("free");
  });

  it("fails closed when identity email does NOT match the paid session", async () => {
    mockAccess.verifySessionToken.mockReturnValueOnce({ jti: "session-stolen" });
    mockAccess.getActivePaidSession.mockResolvedValueOnce({
      id: "session-stolen",
      firebaseUid: "legitimate-owner-uid",
      tier: "Premium",
      email: "owner@example.com",
    });
    mockFirebaseAdmin.verifyFirebaseToken.mockResolvedValueOnce({
      uid: "attacker-uid",
      email: "attacker@example.com",
    });

    const res = await request(app)
      .post("/api/analyze")
      .set({
        Authorization: "Bearer attacker-token",
        "x-ps-session": "stolen-session-token",
      })
      .send({ textContent: "Valid test document text", mode: "full" });

    // Mode full requires paid tier, since session does not match attacker, they are treated as unpaid -> 403
    expect(res.status).toBe(403);
    expect(res.body.code).toBe("FORENSIC_UPGRADE_REQUIRED");
  });

  it("fails closed with 401 when unauthenticated user attempts to analyze", async () => {
    mockFirebaseAdmin.verifyFirebaseToken.mockResolvedValueOnce(null);

    const res = await request(app)
      .post("/api/analyze")
      .send({ textContent: "Valid test document text", mode: "fast" });

    expect(res.status).toBe(401);
    expect(res.body.code).toBe("SIGN_IN_REQUIRED");
  });

  it("does NOT tell a signed-in user to sign in when a database error occurs", async () => {
    mockFirebaseAdmin.verifyFirebaseToken.mockResolvedValueOnce({
      uid: "signed-in-user",
      email: "user@example.com",
    });
    mockUsage.getFreeUsage.mockRejectedValueOnce(
      Object.assign(new Error("Supabase PostgREST 401 Unauthorized"), {
        statusCode: 401,
        supabaseError: { message: "JWT expired or unauthorized" },
      })
    );

    const res = await request(app)
      .post("/api/analyze")
      .set("Authorization", "Bearer signed-in-token")
      .send({ textContent: "Valid test document text", mode: "fast" });

    expect(res.status).toBe(503);
    expect(res.body.code).toBe("USAGE_SERVICE_TEMPORARILY_UNAVAILABLE");
    expect(res.body.error).not.toContain("sign in");
  });

  it("emits sanitized diagnostic logs without exposing tokens or document text", async () => {
    const consoleSpy = vi.spyOn(console, "log");
    mockFirebaseAdmin.verifyFirebaseToken.mockResolvedValueOnce({
      uid: "trace-uid-123",
      email: "trace@example.com",
    });
    mockCreateMessage.mockResolvedValueOnce(claudeText(JSON.stringify(CORE)));

    await request(app)
      .post("/api/analyze")
      .set("Authorization", "Bearer sensitive-secret-jwt-token")
      .send({ textContent: "Highly confidential court affidavit content", mode: "fast" });

    const traceCalls = consoleSpy.mock.calls
      .map((call) => call[0])
      .filter((str) => typeof str === "string" && str.includes("[ANALYZER_DIAGNOSTIC_TRACE]"));

    expect(traceCalls.length).toBeGreaterThan(0);
    for (const logLine of traceCalls) {
      expect(logLine).not.toContain("sensitive-secret-jwt-token");
      expect(logLine).not.toContain("Highly confidential court affidavit content");
    }
    consoleSpy.mockRestore();
  });

  describe("Dual-Engine Forensic Upgrade: Claude Sonnet & Claude Opus", () => {
    const SAMPLE_DEEP_DIVE = {
      thresholdAnalysis: [
        {
          thresholdChecked: "Child in Need of Protection grounds (CYFSA s. 74)",
          isMet: "Inconclusive",
          reasoning: "Allegations of domestic conflict lack corroborating police disclosure.",
          primarySourceLaw: "CYFSA 2017, Section 74",
        },
      ],
      proceduralTimelineViolations: [
        {
          timelineRule: "30-Day Adjournment Limit (CYFSA s. 94(1))",
          documentAssertion: "Adjournment of 45 days requested without parent consent.",
          evaluation: "Possible violation of s. 94(1) 30-day adjournment limit.",
          citation: "CYFSA, S.O. 2017, c. 14, s. 94(1)",
          locationInDocument: "Page 4, Para 12",
          parentActionStep: "Instruct legal counsel to assert s. 94(1) rights at next appearance.",
        },
      ],
      charterAndHumanRightsIssues: ["Section 7 Charter: Security of the person engaged."],
      whatToVerify: ["Request complete CAS disclosure notes from July 14, 2026."],
      whatToAskALawyer: ["Does the 45-day adjournment violate CYFSA s. 94(1)?"],
      whatIsMissing: ["Supervised access observation notes."],
      lawyerCaseBrief: [
        "ISSUE — Adjournment duration — DOCUMENT EVIDENCE — Page 4 Para 12 — SIGNIFICANCE — Exceeds 30 days — LIMITATION — Consent status unstated — VERIFY — Court endorsement record",
      ],
    };

    it("routes Quick Document Review to Claude Sonnet with accurate token metadata and cost accounting", async () => {
      mockCreateMessage.mockResolvedValueOnce({
        content: [{ type: "text", text: JSON.stringify(CORE) }],
        stop_reason: "end_turn",
        usage: { input_tokens: 3500, output_tokens: 1200 },
      });

      const res = await request(app)
        .post("/api/analyze")
        .set(paid())
        .send({ textContent: "Child protection affidavit excerpt...", mode: "fast" });

      expect(res.status).toBe(200);
      expect(mockCreateMessage).toHaveBeenCalledTimes(1);
      const call = mockCreateMessage.mock.calls[0][0];
      expect(call.model).toBe("claude-3-5-sonnet-20241022");
      expect(call.max_tokens).toBe(8000);

      // Verify metadata
      expect(res.body.modelMetadata).toBeDefined();
      expect(res.body.modelMetadata.engine).toBe("claude-3-5-sonnet-20241022");
      expect(res.body.modelMetadata.mode).toBe("fast");
      expect(res.body.modelMetadata.usage.inputTokens).toBe(3500);
      expect(res.body.modelMetadata.usage.outputTokens).toBe(1200);
      expect(res.body.modelMetadata.usage.totalTokens).toBe(4700);
      expect(res.body.modelMetadata.cost.totalCostUsd).toBeGreaterThan(0);
      expect(res.body.modelMetadata.cost.totalCostCad).toBeGreaterThan(0);
    });

    it("routes Forensic In-Depth to Claude Opus with dual passes and 16000 max_tokens per pass", async () => {
      mockCreateMessage.mockResolvedValueOnce({
        content: [{ type: "text", text: JSON.stringify(CORE) }],
        stop_reason: "end_turn",
        usage: { input_tokens: 6000, output_tokens: 2500 },
      });
      mockCreateMessage.mockResolvedValueOnce({
        content: [{ type: "text", text: JSON.stringify(SAMPLE_DEEP_DIVE) }],
        stop_reason: "end_turn",
        usage: { input_tokens: 6500, output_tokens: 3000 },
      });

      const res = await request(app)
        .post("/api/analyze")
        .set(paid())
        .send({ textContent: "Detailed child protection affidavit...", mode: "full" });

      expect(res.status).toBe(200);
      expect(mockCreateMessage).toHaveBeenCalledTimes(2);

      // Both passes must route to Claude Opus with 16000 token budget
      for (const call of mockCreateMessage.mock.calls) {
        expect(call[0].model).toBe("claude-3-opus-20240229");
        expect(call[0].max_tokens).toBe(16000);
      }

      // Verify merged forensic report
      expect(res.body.redFlags).toHaveLength(1);
      expect(res.body.thresholdAnalysis).toHaveLength(1);
      expect(res.body.proceduralTimelineViolations).toHaveLength(1);
      expect(res.body.timing.mode).toBe("full");

      // Verify aggregated Opus usage and cost accounting
      expect(res.body.modelMetadata.engine).toBe("claude-3-opus-20240229");
      expect(res.body.modelMetadata.mode).toBe("full");
      expect(res.body.modelMetadata.usage.inputTokens).toBe(12500);
      expect(res.body.modelMetadata.usage.outputTokens).toBe(5500);
      expect(res.body.modelMetadata.usage.totalTokens).toBe(18000);
      // Opus cost should reflect $15/MTok input and $75/MTok output
      expect(res.body.modelMetadata.cost.totalCostUsd).toBeCloseTo(
        (12500 / 1e6) * 15 + (5500 / 1e6) * 75,
        3
      );
      expect(res.body.modelMetadata.cost.totalCostCad).toBeGreaterThan(
        res.body.modelMetadata.cost.totalCostUsd
      );
    });

    it("prevents frontend from forcing unauthorized Opus access in Quick Review mode", async () => {
      mockCreateMessage.mockResolvedValueOnce({
        content: [{ type: "text", text: JSON.stringify(CORE) }],
        stop_reason: "end_turn",
        usage: { input_tokens: 2000, output_tokens: 800 },
      });

      const res = await request(app)
        .post("/api/analyze")
        .set(paid())
        .send({
          textContent: "Some affidavit text",
          mode: "fast",
          model: "claude-3-opus-20240229", // Client override attempt
        });

      expect(res.status).toBe(200);
      expect(mockCreateMessage).toHaveBeenCalledTimes(1);
      // Server must have forced Sonnet instead of honoring client Opus override
      expect(mockCreateMessage.mock.calls[0][0].model).toBe("claude-3-5-sonnet-20241022");
      expect(res.body.modelMetadata.engine).toBe("claude-3-5-sonnet-20241022");
    });

    it("rejects unpaid user from obtaining Forensic Opus mode with 403 FORENSIC_UPGRADE_REQUIRED", async () => {
      mockFirebaseAdmin.verifyFirebaseToken.mockResolvedValueOnce({
        uid: "free-parent-uid",
        email: "parent@example.com",
      });
      mockUsage.getFreeUsage.mockResolvedValueOnce(0);

      const res = await request(app)
        .post("/api/analyze")
        .set("Authorization", "Bearer free-parent-token")
        .send({
          textContent: "Some affidavit text",
          mode: "full",
        });

      expect(res.status).toBe(403);
      expect(res.body.code).toBe("FORENSIC_UPGRADE_REQUIRED");
      expect(mockCreateMessage).not.toHaveBeenCalled();
    });

    it("fails closed without silently substituting Sonnet when Opus engine fails", async () => {
      mockCreateMessage.mockRejectedValueOnce(
        Object.assign(new Error("Opus model overloaded or unavailable"), { status: 529 })
      );

      const res = await request(app)
        .post("/api/analyze")
        .set(paid())
        .send({ textContent: "Some court affidavit text", mode: "full" });

      expect(res.status).toBe(503);
      expect(res.body.code).toBe("AI_PROVIDER_TEMPORARILY_UNAVAILABLE");
      // Must NOT have silently substituted Sonnet: all calls made must be to Claude Opus
      expect(mockCreateMessage.mock.calls.length).toBeGreaterThan(0);
      for (const call of mockCreateMessage.mock.calls) {
        expect(call[0].model).toBe("claude-3-opus-20240229");
      }
    });

    it("processes TXT and DOCX files through the analyzer pipelines", async () => {
      mockCreateMessage.mockResolvedValueOnce({
        content: [{ type: "text", text: JSON.stringify(CORE) }],
        stop_reason: "end_turn",
        usage: { input_tokens: 1500, output_tokens: 500 },
      });

      const txtBase64 = Buffer.from("Court filing narrative text...").toString("base64");
      const res = await request(app)
        .post("/api/analyze")
        .set(paid())
        .send({
          fileData: { base64: txtBase64, mimeType: "text/plain", name: "affidavit.txt" },
          mode: "fast",
        });

      expect(res.status).toBe(200);
      expect(mockCreateMessage).toHaveBeenCalledTimes(1);
      expect(mockCreateMessage.mock.calls[0][0].model).toBe("claude-3-5-sonnet-20241022");
      expect(res.body.modelMetadata.engine).toBe("claude-3-5-sonnet-20241022");
    });
  });
});

