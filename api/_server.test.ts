// Integration tests for the Express backend in _server.ts, run against the
// real route handlers with only the external SDKs (Anthropic, Gemini,
// nodemailer) and the Supabase-backed access-code service mocked out.
//
// Several of these tests exist specifically to lock in regressions that a
// past audit found and fixed (see HANDOFF.md) so they get caught by `npm
// test` instead of requiring another manual file-by-file sweep:
//   - /api/analyze and /api/case-timeline must always send max_tokens: 16000
//     (they were silently truncating at the old 8000 default).
//   - An unrecognized `model` string must fall back to claude-sonnet-5
//     rather than being sent to the Anthropic API as-is.
//   - /api/rag-query must actually forward the `history` array into the
//     prompt sent to Claude (the chat previously had no memory).
//   - /api/transcribe-audio must degrade to a 200 fallback response on
//     transcription failure rather than surfacing an error to the caller.
import { beforeEach, describe, expect, it, vi } from "vitest";
import request from "supertest";

const { mockCreateMessage, mockGenerateContent, mockSendMail } = vi.hoisted(() => ({
  mockCreateMessage: vi.fn(),
  mockGenerateContent: vi.fn(),
  mockSendMail: vi.fn(),
}));

const mockAccess = vi.hoisted(() => ({
  requestAccess: vi.fn(),
  approvePayment: vi.fn(),
  verifyAccessCode: vi.fn(),
  verifySessionToken: vi.fn(),
  getActivePaidSession: vi.fn(),
  revokeSession: vi.fn(),
  revokeAllSessionsForUid: vi.fn(),
  checkAndConsumeFreeToolUse: vi.fn(),
  TIER_PRICES: { Pro: 19, Premium: 49 },
}));

const mockFirebaseAdmin = vi.hoisted(() => ({
  verifyFirebaseToken: vi.fn(),
}));

const mockUsage = vi.hoisted(() => ({
  getFreeUsage: vi.fn(),
  recordFreeUse: vi.fn(),
  FREE_ANALYSES_LIMIT: 1,
}));

// Added in Phase 1.5 remediation: previously nothing mocked services/gmailAgent.js at all,
// which is why /api/admin/gmail-auth-url, /api/admin/gmail-callback, and
// /api/admin/check-payments had zero test coverage (AUDIT.md Finding L-5) - calling the real
// module in a test would have hit missing GOOGLE_CLIENT_ID/etc. env vars rather than exercising
// the route logic itself.
const mockGmailAgent = vi.hoisted(() => ({
  getGmailAuthUrl: vi.fn(),
  exchangeGmailAuthCode: vi.fn(),
  scanForPayments: vi.fn(),
  verifyOAuthState: vi.fn(),
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

vi.mock("nodemailer", () => ({
  default: {
    createTransport: () => ({ sendMail: mockSendMail }),
  },
}));

vi.mock("./services/access.js", () => mockAccess);
vi.mock("./services/firebaseAdmin.js", () => mockFirebaseAdmin);
vi.mock("./services/usage.js", () => mockUsage);
vi.mock("./services/gmailAgent.js", () => mockGmailAgent);
vi.mock("./services/cases.js", () => mockCases);

// `process.env.VERCEL` must be set BEFORE _server.ts is evaluated: it gates
// whether the module calls setupViteAndStart() (which would otherwise spin
// up a real Vite dev server / app.listen()) at import time. Static imports
// are hoisted above ordinary statements, so this has to be a dynamic import.
process.env.VERCEL = "1";
process.env.ANTHROPIC_API_KEY = "test-anthropic-key";
process.env.GEMINI_API_KEY = "test-gemini-key";
process.env.ADMIN_SECRET = "test-admin-secret";
process.env.SESSION_SECRET = "test-session-secret";
delete process.env.SMTP_HOST;
delete process.env.SMTP_USER;
delete process.env.SMTP_PASS;
delete process.env.LAWYER_INTAKE_TO;

const { default: app } = await import("./_server.js");

function claudeTextResponse(text: string) {
  return { content: [{ type: "text", text }], stop_reason: "end_turn", usage: {} };
}

function claudeJsonResponse(obj: unknown) {
  return claudeTextResponse(JSON.stringify(obj));
}

const MINIMAL_ANALYSIS = {
  documentTitle: "Uploaded Document",
  documentType: "Affidavit",
  metadata: {},
  disclaimer: "disclaimer",
  completenessScore: 50,
  evidenceStrengthIndex: { score: 50 },
  fileSummary: "summary",
  redFlags: [],
  thresholdAnalysis: [],
  proceduralTimelineViolations: [],
  charterAndHumanRightsIssues: [],
  whatToVerify: [],
  whatToAskALawyer: [],
  whatIsMissing: [],
  lawyerCaseBrief: [],
};

// A valid Pro/Premium session token + the Firebase identity it's bound to, sent together as
// `x-ps-session` + `Authorization`, for tests that exercise tool behavior rather than the
// paywall itself. Gating-specific tests below send no header (or an unrecognized one) and
// assert the 401/402 instead.
//
// M-2 / Finding 3 remediation: a session token alone is no longer sufficient - it must also
// resolve to a still-active navigator_paid_sessions row (getActivePaidSession) whose
// firebase_uid matches a verified Firebase identity for the SAME request. paid() therefore
// sends both headers, and the default mocks below wire PAID_SESSION_TOKEN -> PAID_JTI ->
// a session row bound to PAID_FIREBASE_UID, resolved only when PAID_FIREBASE_TOKEN is the
// bearer presented - exactly mirroring the real cross-check.
const PAID_SESSION_TOKEN = "valid-session-token";
const PAID_JTI = "session-row-1";
const PAID_FIREBASE_UID = "paid-firebase-uid-1";
const PAID_FIREBASE_TOKEN = "Bearer valid-firebase-token-for-paid-user";
const paid = () => ({ "x-ps-session": PAID_SESSION_TOKEN, Authorization: PAID_FIREBASE_TOKEN });

beforeEach(() => {
  vi.clearAllMocks();
  mockAccess.verifySessionToken.mockImplementation((token: string) => (token === PAID_SESSION_TOKEN ? { jti: PAID_JTI } : null));
  mockAccess.getActivePaidSession.mockImplementation(async (jti: string) =>
    jti === PAID_JTI ? { id: PAID_JTI, firebaseUid: PAID_FIREBASE_UID, tier: "Pro" } : null
  );
  // Tests that need a DIFFERENT (e.g. free-tier) identity override this with
  // .mockResolvedValue({...}) directly, which replaces this implementation entirely for the
  // rest of that test - unaffected by the header-based branching here.
  mockFirebaseAdmin.verifyFirebaseToken.mockImplementation(async (header: string | undefined) =>
    header === PAID_FIREBASE_TOKEN ? { uid: PAID_FIREBASE_UID, email: "paid@example.com" } : null
  );
  mockUsage.getFreeUsage.mockResolvedValue(0);
  mockUsage.recordFreeUse.mockResolvedValue(undefined);
  mockAccess.checkAndConsumeFreeToolUse.mockResolvedValue(false);
  mockGmailAgent.verifyOAuthState.mockReturnValue(false);
});

describe("GET /api/health", () => {
  it("reports healthy with a timestamp", async () => {
    const res = await request(app).get("/api/health");
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("healthy");
    expect(typeof res.body.timestamp).toBe("string");
  });
});

describe("GET /api/access-pricing", () => {
  it("returns the tier prices from the access service", async () => {
    const res = await request(app).get("/api/access-pricing");
    expect(res.status).toBe(200);
    expect(res.body.prices).toEqual({ Pro: 19, Premium: 49 });
  });
});

describe("POST /api/request-access", () => {
  it("rejects a missing/invalid email", async () => {
    const res = await request(app).post("/api/request-access").send({ email: "not-an-email", tier: "Pro" });
    expect(res.status).toBe(400);
    expect(mockAccess.requestAccess).not.toHaveBeenCalled();
  });

  it("rejects a tier that isn't Pro or Premium", async () => {
    const res = await request(app).post("/api/request-access").send({ email: "a@b.com", tier: "Gold" });
    expect(res.status).toBe(400);
  });

  it("returns the service result for a valid request", async () => {
    mockAccess.requestAccess.mockResolvedValueOnce({ referenceNumber: "PS-ABCDE", amount: 19 });
    const res = await request(app).post("/api/request-access").send({ email: "a@b.com", tier: "Pro" });
    expect(res.status).toBe(200);
    expect(res.body.referenceNumber).toBe("PS-ABCDE");
    expect(mockAccess.requestAccess).toHaveBeenCalledWith("a@b.com", "Pro");
  });

  it("propagates the service's status code on failure", async () => {
    mockAccess.requestAccess.mockRejectedValueOnce(Object.assign(new Error("db down"), { statusCode: 503 }));
    const res = await request(app).post("/api/request-access").send({ email: "a@b.com", tier: "Pro" });
    expect(res.status).toBe(503);
    expect(res.body.error).toBe("db down");
  });
});

describe("POST /api/admin/approve-payment", () => {
  it("rejects a request without the correct admin secret", async () => {
    const res = await request(app).post("/api/admin/approve-payment").send({ referenceNumber: "PS-X", amountReceived: 19 });
    expect(res.status).toBe(401);
    expect(mockAccess.approvePayment).not.toHaveBeenCalled();
  });

  it("rejects a missing amountReceived even with the correct secret", async () => {
    const res = await request(app)
      .post("/api/admin/approve-payment")
      .set("x-admin-secret", "test-admin-secret")
      .send({ referenceNumber: "PS-X" });
    expect(res.status).toBe(400);
  });

  it("approves a valid payment", async () => {
    mockAccess.approvePayment.mockResolvedValueOnce({ email: "a@b.com", tier: "Pro", code: "AAAA-BBBB", referenceNumber: "PS-X" });
    const res = await request(app)
      .post("/api/admin/approve-payment")
      .set("x-admin-secret", "test-admin-secret")
      .send({ referenceNumber: "PS-X", amountReceived: 19 });
    expect(res.status).toBe(200);
    expect(res.body.code).toBe("AAAA-BBBB");
  });
});

// Added in Phase 1.5 remediation (AUDIT.md Finding L-5: zero test coverage
// existed for any of these three admin/cron routes before this fix).
describe("GET /api/admin/gmail-auth-url", () => {
  it("rejects a request without the correct admin secret", async () => {
    const res = await request(app).get("/api/admin/gmail-auth-url");
    expect(res.status).toBe(401);
    expect(mockGmailAgent.getGmailAuthUrl).not.toHaveBeenCalled();
  });

  it("returns the Google consent URL with the correct admin secret", async () => {
    mockGmailAgent.getGmailAuthUrl.mockReturnValue("https://accounts.google.com/o/oauth2/v2/auth?state=abc");
    const res = await request(app).get("/api/admin/gmail-auth-url").set("x-admin-secret", "test-admin-secret");
    expect(res.status).toBe(200);
    expect(res.body.url).toContain("accounts.google.com");
  });
});

describe("GET /api/admin/gmail-callback", () => {
  // SECURITY REGRESSION TEST (Phase 1.5 remediation, AUDIT.md Finding M-1):
  // a code comment used to claim this route was protected by a `state`
  // parameter, but no such check actually existed anywhere. These tests
  // exist to fail if that check is ever removed again.
  it("rejects a request with no state parameter at all", async () => {
    const res = await request(app).get("/api/admin/gmail-callback").query({ code: "auth-code-123" });
    expect(res.status).toBe(401);
    expect(mockGmailAgent.exchangeGmailAuthCode).not.toHaveBeenCalled();
  });

  it("rejects a request with an invalid or expired state parameter", async () => {
    mockGmailAgent.verifyOAuthState.mockReturnValue(false);
    const res = await request(app).get("/api/admin/gmail-callback").query({ code: "auth-code-123", state: "forged-or-expired" });
    expect(res.status).toBe(401);
    expect(mockGmailAgent.exchangeGmailAuthCode).not.toHaveBeenCalled();
  });

  it("rejects a request with no code even if state is valid", async () => {
    mockGmailAgent.verifyOAuthState.mockReturnValue(true);
    const res = await request(app).get("/api/admin/gmail-callback").query({ state: "valid-state" });
    expect(res.status).toBe(400);
  });

  it("exchanges the code for a refresh token when both code and state are valid", async () => {
    mockGmailAgent.verifyOAuthState.mockReturnValue(true);
    mockGmailAgent.exchangeGmailAuthCode.mockResolvedValueOnce("refresh-token-xyz");
    const res = await request(app).get("/api/admin/gmail-callback").query({ code: "auth-code-123", state: "valid-state" });
    expect(res.status).toBe(200);
    expect(res.text).toContain("refresh-token-xyz");
  });
});

describe("GET /api/admin/check-payments", () => {
  it("rejects a request with neither the admin secret nor a valid cron bearer token", async () => {
    const res = await request(app).get("/api/admin/check-payments");
    expect(res.status).toBe(401);
    expect(mockGmailAgent.scanForPayments).not.toHaveBeenCalled();
  });

  it("runs the scan with the correct admin secret", async () => {
    mockGmailAgent.scanForPayments.mockResolvedValueOnce({ scanned: 0, alreadyProcessed: 0, matchedPendingApproval: [], noMatch: [], errors: [], stalePending: [] });
    const res = await request(app).get("/api/admin/check-payments").set("x-admin-secret", "test-admin-secret");
    expect(res.status).toBe(200);
    expect(mockGmailAgent.scanForPayments).toHaveBeenCalledTimes(1);
  });

  it("runs the scan when called by Vercel Cron with the correct bearer token", async () => {
    process.env.CRON_SECRET = "test-cron-secret";
    mockGmailAgent.scanForPayments.mockResolvedValueOnce({ scanned: 0, alreadyProcessed: 0, matchedPendingApproval: [], noMatch: [], errors: [], stalePending: [] });
    const res = await request(app).get("/api/admin/check-payments").set("authorization", "Bearer test-cron-secret");
    expect(res.status).toBe(200);
    delete process.env.CRON_SECRET;
  });

  it("rejects an incorrect cron bearer token", async () => {
    process.env.CRON_SECRET = "test-cron-secret";
    const res = await request(app).get("/api/admin/check-payments").set("authorization", "Bearer wrong-token");
    expect(res.status).toBe(401);
    delete process.env.CRON_SECRET;
  });
});

describe("POST /api/activate-code", () => {
  // SECURITY REGRESSION TEST (M-2 / Finding 3 remediation): this route used to accept an
  // unauthenticated caller-supplied email as the sole identity for the resulting session -
  // no Firebase sign-in was required at all. This test exists to fail if that gate is ever
  // removed again.
  it("rejects an unauthenticated activation attempt", async () => {
    const res = await request(app).post("/api/activate-code").send({ email: "a@b.com", code: "AAAA-BBBB" });
    expect(res.status).toBe(401);
    expect(res.body.code).toBe("SIGN_IN_REQUIRED");
    expect(mockAccess.verifyAccessCode).not.toHaveBeenCalled();
  });

  it("rejects a missing code or email even for a signed-in caller", async () => {
    mockFirebaseAdmin.verifyFirebaseToken.mockResolvedValue({ uid: "uid-1", email: "a@b.com" });
    const res = await request(app)
      .post("/api/activate-code")
      .set("Authorization", "Bearer irrelevant-in-this-mock")
      .send({ email: "a@b.com" });
    expect(res.status).toBe(400);
  });

  it("returns a session token for a valid code, passing the verified identity (not just the email) to the service", async () => {
    mockFirebaseAdmin.verifyFirebaseToken.mockResolvedValue({ uid: "verified-uid-1", email: "a@b.com" });
    mockAccess.verifyAccessCode.mockResolvedValueOnce({ token: "tok", tier: "Pro", email: "a@b.com" });
    const res = await request(app)
      .post("/api/activate-code")
      .set("Authorization", "Bearer irrelevant-in-this-mock")
      .send({ email: "a@b.com", code: "AAAA-BBBB" });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true, tier: "Pro", token: "tok", email: "a@b.com" });
    expect(mockAccess.verifyAccessCode).toHaveBeenCalledWith(
      { uid: "verified-uid-1", email: "a@b.com" },
      "a@b.com",
      "AAAA-BBBB"
    );
  });

  it("maps an invalid code to 401 for a signed-in caller", async () => {
    mockFirebaseAdmin.verifyFirebaseToken.mockResolvedValue({ uid: "uid-1", email: "a@b.com" });
    mockAccess.verifyAccessCode.mockRejectedValueOnce(Object.assign(new Error("Invalid email or code."), { statusCode: 401 }));
    const res = await request(app)
      .post("/api/activate-code")
      .set("Authorization", "Bearer irrelevant-in-this-mock")
      .send({ email: "a@b.com", code: "WRONG" });
    expect(res.status).toBe(401);
  });
});

describe("POST /api/extract-text", () => {
  // SECURITY REGRESSION TEST (Phase 1.5 remediation, AUDIT.md Finding H-1):
  // this endpoint had no authentication at all before this fix - anyone
  // could call it directly for free, unmetered Gemini OCR. This test exists
  // specifically to fail if that gate is ever removed again.
  it("rejects an unauthenticated request with SIGN_IN_REQUIRED", async () => {
    const res = await request(app).post("/api/extract-text").send({ fileData: { base64: "abcd", mimeType: "text/plain" } });
    expect(res.status).toBe(401);
    expect(res.body.code).toBe("SIGN_IN_REQUIRED");
    expect(mockGenerateContent).not.toHaveBeenCalled();
  });

  it("allows a signed-in-but-unpaid (Firebase-verified) caller through, since this step doesn't consume a free-tier slot", async () => {
    mockFirebaseAdmin.verifyFirebaseToken.mockResolvedValue({ uid: "uid-extract", email: "parent@example.com" });
    const base64 = Buffer.from("Hello world", "utf-8").toString("base64");
    const res = await request(app)
      .post("/api/extract-text")
      .set("Authorization", "Bearer valid-firebase-token")
      .send({ fileData: { base64, mimeType: "text/plain" } });
    expect(res.status).toBe(200);
  });

  it("rejects an oversized base64 payload before calling Gemini", async () => {
    const oversized = "a".repeat(30_000_001);
    const res = await request(app)
      .post("/api/extract-text")
      .set(paid())
      .send({ fileData: { base64: oversized, mimeType: "application/pdf" } });
    expect(res.status).toBe(413);
    expect(mockGenerateContent).not.toHaveBeenCalled();
  });

  it("rejects a missing fileData.base64", async () => {
    const res = await request(app).post("/api/extract-text").set(paid()).send({ fileData: {} });
    expect(res.status).toBe(400);
  });

  it("rejects an unsupported mime type", async () => {
    const res = await request(app)
      .post("/api/extract-text")
      .set(paid())
      .send({ fileData: { base64: "abcd", mimeType: "application/zip" } });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/Unsupported file type/);
  });

  it("decodes text/* files directly without calling Gemini", async () => {
    const base64 = Buffer.from("Hello world", "utf-8").toString("base64");
    const res = await request(app)
      .post("/api/extract-text")
      .set(paid())
      .send({ fileData: { base64, mimeType: "text/plain" } });
    expect(res.status).toBe(200);
    expect(res.body.extractedText).toBe("Hello world");
    expect(mockGenerateContent).not.toHaveBeenCalled();
  });

  it("runs PDFs/images through Gemini OCR", async () => {
    mockGenerateContent.mockResolvedValueOnce({ text: "Extracted content" });
    const res = await request(app)
      .post("/api/extract-text")
      .set(paid())
      .send({ fileData: { base64: "abcd", mimeType: "application/pdf" } });
    expect(res.status).toBe(200);
    expect(res.body.extractedText).toBe("Extracted content");
    expect(mockGenerateContent).toHaveBeenCalledTimes(1);
  });

  it("returns 422 when nothing readable comes back", async () => {
    mockGenerateContent.mockResolvedValueOnce({ text: "   " });
    const res = await request(app)
      .post("/api/extract-text")
      .set(paid())
      .send({ fileData: { base64: "abcd", mimeType: "image/png" } });
    expect(res.status).toBe(422);
  });
});

// SECURITY REGRESSION TESTS (Phase 1.5 remediation, AUDIT.md Finding H-2):
// this route had no authentication and zero test coverage at all before this
// fix - anyone could call it directly for free, unmetered Gemini calls.
describe("POST /api/search-connectors", () => {
  it("rejects an unauthenticated request", async () => {
    const res = await request(app).post("/api/search-connectors").send({ query: "what is a protection order?" });
    expect(res.status).toBe(402);
    expect(mockGenerateContent).not.toHaveBeenCalled();
  });

  it("rejects a missing query for an authenticated caller", async () => {
    const res = await request(app).post("/api/search-connectors").set(paid()).send({});
    expect(res.status).toBe(400);
  });

  it("rejects an oversized query", async () => {
    const res = await request(app).post("/api/search-connectors").set(paid()).send({ query: "a".repeat(2001) });
    expect(res.status).toBe(400);
  });

  it("answers a valid, authenticated query and appends the disclaimer", async () => {
    mockGenerateContent.mockResolvedValueOnce({ text: "A protection order is..." });
    const res = await request(app).post("/api/search-connectors").set(paid()).send({ query: "what is a protection order?" });
    expect(res.status).toBe(200);
    expect(res.body.response).toContain("A protection order is...");
    expect(res.body.response).toContain("informational/educational purposes only");
  });
});

describe("POST /api/analyze", () => {
  it("rejects a request with no text or file", async () => {
    const res = await request(app).post("/api/analyze").send({});
    expect(res.status).toBe(400);
  });

  // /api/analyze issues two concurrent Claude calls (a "core" pass and a "deep-dive" pass —
  // see the comment above documentContentBlock in _server.ts) instead of one, so every test
  // below queues a resolved/rejected value for each of the two calls the endpoint actually
  // makes, in the order they're constructed: core first, then deep-dive.
  it("always requests 8000 max_tokens on both concurrent calls, and falls back an unknown model to claude-sonnet-5", async () => {
    mockCreateMessage.mockResolvedValueOnce(claudeJsonResponse(MINIMAL_ANALYSIS));
    mockCreateMessage.mockResolvedValueOnce(claudeJsonResponse(MINIMAL_ANALYSIS));
    const res = await request(app)
      .post("/api/analyze")
      .set(paid())
      .send({ textContent: "some affidavit text", model: "not-a-real-model" });

    expect(res.status).toBe(200);
    expect(res.body.documentTitle).toBe("Uploaded Document");
    expect(mockCreateMessage).toHaveBeenCalledTimes(2);
    for (const call of mockCreateMessage.mock.calls) {
      expect(call[0].max_tokens).toBe(8000);
      expect(call[0].model).toBe("claude-sonnet-5");
    }
  });

  it("honors an explicitly valid model on both concurrent calls", async () => {
    mockCreateMessage.mockResolvedValueOnce(claudeJsonResponse(MINIMAL_ANALYSIS));
    mockCreateMessage.mockResolvedValueOnce(claudeJsonResponse(MINIMAL_ANALYSIS));
    await request(app)
      .post("/api/analyze")
      .set(paid())
      .send({ textContent: "some affidavit text", model: "claude-haiku-4-5-20251001" });
    expect(mockCreateMessage).toHaveBeenCalledTimes(2);
    for (const call of mockCreateMessage.mock.calls) {
      expect(call[0].model).toBe("claude-haiku-4-5-20251001");
    }
  });

  it("returns a clear error instead of fabricating a report when either response isn't valid JSON", async () => {
    mockCreateMessage.mockResolvedValueOnce(claudeTextResponse("not json at all"));
    mockCreateMessage.mockResolvedValueOnce(claudeJsonResponse(MINIMAL_ANALYSIS));
    const res = await request(app).post("/api/analyze").set(paid()).send({ textContent: "some text" });
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(res.body.documentTitle).toBeUndefined();
  });

  it("maps a rate-limit error from either concurrent call to HTTP 429", async () => {
    mockCreateMessage.mockResolvedValueOnce(claudeJsonResponse(MINIMAL_ANALYSIS));
    mockCreateMessage.mockRejectedValueOnce(Object.assign(new Error("rate limit exceeded"), { status: 429 }));
    const res = await request(app).post("/api/analyze").set(paid()).send({ textContent: "some text" });
    expect(res.status).toBe(429);
    expect(res.body.isRateLimit).toBe(true);
  });

  it("rejects an unauthenticated, unpaid request with SIGN_IN_REQUIRED", async () => {
    const res = await request(app).post("/api/analyze").send({ textContent: "some text" });
    expect(res.status).toBe(401);
    expect(res.body.code).toBe("SIGN_IN_REQUIRED");
    expect(mockCreateMessage).not.toHaveBeenCalled();
  });

  it("allows a signed-in parent's first free analysis, then blocks the second", async () => {
    mockFirebaseAdmin.verifyFirebaseToken.mockResolvedValue({ uid: "uid-1", email: "parent@example.com" });
    mockCreateMessage.mockResolvedValueOnce(claudeJsonResponse(MINIMAL_ANALYSIS));
    mockCreateMessage.mockResolvedValueOnce(claudeJsonResponse(MINIMAL_ANALYSIS));
    const res = await request(app)
      .post("/api/analyze")
      .set("Authorization", "Bearer valid-firebase-token")
      .send({ textContent: "some text" });
    expect(res.status).toBe(200);
    expect(mockUsage.recordFreeUse).toHaveBeenCalledWith("uid-1", "parent@example.com");

    mockUsage.getFreeUsage.mockResolvedValue(1); // already used their one free analysis
    const res2 = await request(app)
      .post("/api/analyze")
      .set("Authorization", "Bearer valid-firebase-token")
      .send({ textContent: "some text" });
    expect(res2.status).toBe(402);
    expect(res2.body.code).toBe("FREE_LIMIT_REACHED");
  });
});

describe("POST /api/case-timeline", () => {
  it("rejects an unpaid request before even validating the body", async () => {
    const res = await request(app).post("/api/case-timeline").send({ documents: [{ name: "a", text: "x" }] });
    expect(res.status).toBe(402);
    expect(res.body.code).toBe("SESSION_REQUIRED");
    expect(mockCreateMessage).not.toHaveBeenCalled();
  });

  it("rejects fewer than two documents", async () => {
    const res = await request(app).post("/api/case-timeline").set(paid()).send({ documents: [{ name: "a", text: "x" }] });
    expect(res.status).toBe(400);
  });

  it("always requests 16000 max_tokens for a valid multi-document request", async () => {
    mockCreateMessage.mockResolvedValueOnce(claudeJsonResponse({ timeline: [], conflicts: [], openItems: [] }));
    const res = await request(app)
      .post("/api/case-timeline")
      .set(paid())
      .send({
        documents: [
          { name: "affidavit.txt", text: "Event on Jan 1." },
          { name: "email.txt", text: "Follow-up on Jan 3." },
        ],
      });
    expect(res.status).toBe(200);
    const callArgs = mockCreateMessage.mock.calls[0][0];
    expect(callArgs.max_tokens).toBe(16000);
  });
});

describe("POST /api/rag-query", () => {
  it("keeps the free OPA Coach chat (focus: family-advocate) ungated", async () => {
    mockCreateMessage.mockResolvedValueOnce(claudeTextResponse("Here's my answer."));
    const res = await request(app)
      .post("/api/rag-query")
      .send({ query: "What happens at a 5-day hearing?", files: [], focus: "family-advocate" });
    expect(res.status).toBe(200);
  });

  it("rejects an unpaid request for any other focus", async () => {
    const res = await request(app)
      .post("/api/rag-query")
      .send({ query: "Audit this document", files: [], focus: "evidentiary-auditor" });
    expect(res.status).toBe(402);
    expect(res.body.code).toBe("SESSION_REQUIRED");
    expect(mockCreateMessage).not.toHaveBeenCalled();
  });

  it("rejects an unpaid request with no focus at all (the default statutory-audit mode)", async () => {
    const res = await request(app).post("/api/rag-query").send({ query: "Audit this document", files: [] });
    expect(res.status).toBe(402);
  });

  it("rejects a missing query", async () => {
    const res = await request(app).post("/api/rag-query").set(paid()).send({ files: [] });
    expect(res.status).toBe(400);
  });

  it("forwards conversation history into the prompt sent to Claude", async () => {
    mockCreateMessage.mockResolvedValueOnce(claudeTextResponse("Here's my answer."));
    const res = await request(app)
      .post("/api/rag-query")
      .set(paid())
      .send({
        query: "What did the worker say about overnight visits?",
        files: [],
        history: [
          { role: "user", content: "My name is Jane and my son is Max." },
          { role: "assistant", content: "Got it, Jane." },
        ],
      });

    expect(res.status).toBe(200);
    expect(res.body.answer).toBe("Here's my answer.");
    const sentPrompt = JSON.stringify(mockCreateMessage.mock.calls[0][0].messages);
    expect(sentPrompt).toContain("CONVERSATION SO FAR");
    expect(sentPrompt).toContain("Jane");
  });

  it("omits the conversation-history block when no history is given", async () => {
    mockCreateMessage.mockResolvedValueOnce(claudeTextResponse("Answer without history."));
    await request(app).post("/api/rag-query").set(paid()).send({ query: "A question", files: [] });
    const sentPrompt = JSON.stringify(mockCreateMessage.mock.calls[0][0].messages);
    expect(sentPrompt).not.toContain("CONVERSATION SO FAR");
  });
});

describe("POST /api/extract-evidence", () => {
  it("rejects an unauthenticated, unpaid request with SIGN_IN_REQUIRED", async () => {
    const res = await request(app).post("/api/extract-evidence").send({ narrativeText: "Yesterday the worker visited." });
    expect(res.status).toBe(401);
    expect(res.body.code).toBe("SIGN_IN_REQUIRED");
  });

  it("rejects empty narrative text", async () => {
    const res = await request(app).post("/api/extract-evidence").set(paid()).send({ narrativeText: "   " });
    expect(res.status).toBe(400);
  });

  it("returns the structured extraction on success for a paid session", async () => {
    mockCreateMessage.mockResolvedValueOnce(claudeJsonResponse({ date: "2026-08-01", whatHappened: "A visit occurred." }));
    const res = await request(app)
      .post("/api/extract-evidence")
      .set(paid())
      .send({ narrativeText: "Yesterday the worker visited." });
    expect(res.status).toBe(200);
    expect(res.body.whatHappened).toBe("A visit occurred.");
  });

  it("allows a signed-in parent's first free extraction, then blocks the second", async () => {
    mockFirebaseAdmin.verifyFirebaseToken.mockResolvedValue({ uid: "uid-2", email: "parent2@example.com" });
    mockAccess.checkAndConsumeFreeToolUse.mockResolvedValueOnce(true);
    mockCreateMessage.mockResolvedValueOnce(claudeJsonResponse({ date: "2026-08-01", whatHappened: "A visit occurred." }));
    const res = await request(app)
      .post("/api/extract-evidence")
      .set("Authorization", "Bearer valid-firebase-token")
      .send({ narrativeText: "Yesterday the worker visited." });
    expect(res.status).toBe(200);
    expect(mockAccess.checkAndConsumeFreeToolUse).toHaveBeenCalledWith("parent2@example.com", "extract-evidence");

    mockAccess.checkAndConsumeFreeToolUse.mockResolvedValueOnce(false); // already used their one free pass
    const res2 = await request(app)
      .post("/api/extract-evidence")
      .set("Authorization", "Bearer valid-firebase-token")
      .send({ narrativeText: "Yesterday the worker visited again." });
    expect(res2.status).toBe(402);
    expect(res2.body.code).toBe("SESSION_REQUIRED");
  });
});

describe("POST /api/deep-scan", () => {
  const MINIMAL_DEEP_SCAN = {
    gaps: [],
    missingEvidence: [],
    retorts: [],
    disclaimer: "disclaimer",
  };

  it("rejects an unpaid request before even validating the body", async () => {
    const res = await request(app).post("/api/deep-scan").send({ documentText: "   " });
    expect(res.status).toBe(402);
    expect(res.body.code).toBe("SESSION_REQUIRED");
  });

  it("rejects empty document text", async () => {
    const res = await request(app).post("/api/deep-scan").set(paid()).send({ documentText: "   " });
    expect(res.status).toBe(400);
  });

  it("returns the structured deep-scan report on success, requesting 16000 max_tokens", async () => {
    mockCreateMessage.mockResolvedValueOnce(claudeJsonResponse(MINIMAL_DEEP_SCAN));
    const res = await request(app)
      .post("/api/deep-scan")
      .set(paid())
      .send({ documentText: "Some CAS worker observation notes.", documentName: "notes.txt", category: "Worker Notes" });

    expect(res.status).toBe(200);
    expect(res.body.disclaimer).toBe("disclaimer");
    const callArgs = mockCreateMessage.mock.calls[0][0];
    expect(callArgs.max_tokens).toBe(16000);
  });

  it("tells the model there is no prior analysis when none is supplied", async () => {
    mockCreateMessage.mockResolvedValueOnce(claudeJsonResponse(MINIMAL_DEEP_SCAN));
    await request(app).post("/api/deep-scan").set(paid()).send({ documentText: "Some document text." });
    const sentPrompt = JSON.stringify(mockCreateMessage.mock.calls[0][0].messages);
    expect(sentPrompt).toContain("No prior analysis is available");
  });

  it("forwards the prior analysis's red flags and instructs the model not to repeat them", async () => {
    mockCreateMessage.mockResolvedValueOnce(claudeJsonResponse(MINIMAL_DEEP_SCAN));
    await request(app)
      .post("/api/deep-scan")
      .set(paid())
      .send({
        documentText: "Some document text.",
        priorAnalysis: {
          redFlags: [{ severity: "CRITICAL", category: "Hearsay", phraseDetected: "the worker said the child was unsafe", explanation: "uncorroborated" }],
          thresholdAnalysis: [{ thresholdChecked: "CYFSA s. 74", isMet: "Inconclusive", reasoning: "not enough facts" }],
          whatIsMissing: ["A signed consent form"],
        },
      });
    const sentPrompt = JSON.stringify(mockCreateMessage.mock.calls[0][0].messages);
    expect(sentPrompt).toContain("the worker said the child was unsafe");
    expect(sentPrompt).toContain("Do NOT repeat any of these");
    expect(sentPrompt).toContain("A signed consent form");
  });

  it("returns a clear error instead of fabricating a report when the response isn't valid JSON", async () => {
    mockCreateMessage.mockResolvedValueOnce(claudeTextResponse("not json at all"));
    const res = await request(app).post("/api/deep-scan").set(paid()).send({ documentText: "Some document text." });
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(res.body.gaps).toBeUndefined();
  });

  it("maps a rate-limit error from the model to HTTP 429", async () => {
    mockCreateMessage.mockRejectedValueOnce(Object.assign(new Error("rate limit exceeded"), { status: 429 }));
    const res = await request(app).post("/api/deep-scan").set(paid()).send({ documentText: "Some document text." });
    expect(res.status).toBe(429);
    expect(res.body.isRateLimit).toBe(true);
  });
});

// M-2 / Finding 3 remediation: a valid-looking x-ps-session token is no longer sufficient by
// itself on any paid route - it must resolve to a still-active navigator_paid_sessions row
// AND that row's firebase_uid must match a verified Firebase identity for the same request.
// /api/deep-scan is used as the representative route (hard-gated, no free tier, so the paid
// check is the whole story) - the same requireSession() function backs every other
// paid-only route, so this coverage applies there too.
describe("Database-backed paid-session authorization (M-2 / Finding 3)", () => {
  it("rejects a structurally valid token whose session row has been revoked or expired", async () => {
    // Firebase identity resolves fine, and the token itself parses - but the database says
    // this session is no longer active (revoked_at set, or expires_at passed).
    mockAccess.getActivePaidSession.mockResolvedValueOnce(null);
    const res = await request(app).post("/api/deep-scan").set(paid()).send({ documentText: "Some text." });
    expect(res.status).toBe(402);
    expect(res.body.code).toBe("SESSION_REQUIRED");
    expect(mockCreateMessage).not.toHaveBeenCalled();
  });

  it("rejects a valid, active session row whose firebase_uid does not match the caller's verified identity", async () => {
    // The session row is real and active, but belongs to someone else - proves a stolen
    // token can't be used by a different signed-in Firebase account.
    mockAccess.getActivePaidSession.mockResolvedValueOnce({ id: PAID_JTI, firebaseUid: "someone-elses-uid", tier: "Pro" });
    const res = await request(app).post("/api/deep-scan").set(paid()).send({ documentText: "Some text." });
    expect(res.status).toBe(402);
    expect(res.body.code).toBe("SESSION_REQUIRED");
    expect(mockCreateMessage).not.toHaveBeenCalled();
  });

  it("rejects a valid session token with no Firebase identity presented at all", async () => {
    // A bare x-ps-session with no Authorization header - the token alone must not be enough.
    const res = await request(app).post("/api/deep-scan").set("x-ps-session", PAID_SESSION_TOKEN).send({ documentText: "Some text." });
    expect(res.status).toBe(401);
    expect(res.body.code).toBe("SIGN_IN_REQUIRED");
    expect(mockCreateMessage).not.toHaveBeenCalled();
  });

  it("allows a fully valid, DB-active, uid-bound session through", async () => {
    mockCreateMessage.mockResolvedValueOnce(claudeJsonResponse({ gaps: [], missingEvidence: [], retorts: [], disclaimer: "d" }));
    const res = await request(app).post("/api/deep-scan").set(paid()).send({ documentText: "Some text." });
    expect(res.status).toBe(200);
  });
});

describe("POST /api/admin/revoke-session", () => {
  it("rejects a request without the correct admin secret", async () => {
    const res = await request(app).post("/api/admin/revoke-session").send({ sessionId: "session-1" });
    expect(res.status).toBe(401);
    expect(mockAccess.revokeSession).not.toHaveBeenCalled();
  });

  it("rejects a missing sessionId even with the correct secret", async () => {
    const res = await request(app).post("/api/admin/revoke-session").set("x-admin-secret", "test-admin-secret").send({});
    expect(res.status).toBe(400);
  });

  it("revokes the given session id", async () => {
    mockAccess.revokeSession.mockResolvedValueOnce(true);
    const res = await request(app)
      .post("/api/admin/revoke-session")
      .set("x-admin-secret", "test-admin-secret")
      .send({ sessionId: "session-1", reason: "refund issued" });
    expect(res.status).toBe(200);
    expect(res.body.revoked).toBe(true);
    expect(mockAccess.revokeSession).toHaveBeenCalledWith("session-1", "refund issued");
  });
});

describe("POST /api/admin/revoke-sessions-for-uid", () => {
  it("rejects a request without the correct admin secret", async () => {
    const res = await request(app).post("/api/admin/revoke-sessions-for-uid").send({ firebaseUid: "uid-1" });
    expect(res.status).toBe(401);
    expect(mockAccess.revokeAllSessionsForUid).not.toHaveBeenCalled();
  });

  it("rejects a missing firebaseUid even with the correct secret", async () => {
    const res = await request(app).post("/api/admin/revoke-sessions-for-uid").set("x-admin-secret", "test-admin-secret").send({});
    expect(res.status).toBe(400);
  });

  it("revokes every active session for the given uid", async () => {
    mockAccess.revokeAllSessionsForUid.mockResolvedValueOnce(3);
    const res = await request(app)
      .post("/api/admin/revoke-sessions-for-uid")
      .set("x-admin-secret", "test-admin-secret")
      .send({ firebaseUid: "uid-1", reason: "abuse report" });
    expect(res.status).toBe(200);
    expect(res.body.revokedCount).toBe(3);
    expect(mockAccess.revokeAllSessionsForUid).toHaveBeenCalledWith("uid-1", "abuse report");
  });
});

describe("POST /api/transcribe", () => {
  it("rejects a request with neither narrative text nor audio", async () => {
    const res = await request(app).post("/api/transcribe").send({});
    expect(res.status).toBe(400);
  });

  it("formats a typed narrative into a journal entry via Claude", async () => {
    mockCreateMessage.mockResolvedValueOnce(claudeTextResponse("Dear journal, ..."));
    const res = await request(app).post("/api/transcribe").send({ narrativeText: "the worker came by" });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.transcribedText).toBe("Dear journal, ...");
  });

  it("transcribes real audio via Gemini and labels it as an AI aid, not a certified transcript", async () => {
    mockGenerateContent.mockResolvedValueOnce({ text: "spoken words here" });
    const res = await request(app)
      .post("/api/transcribe")
      .send({ audioData: "base64audio", mimeType: "audio/webm", fileName: "call.webm" });
    expect(res.status).toBe(200);
    expect(res.body.transcribedText).toContain("spoken words here");
    expect(res.body.transcribedText).toContain("not a certified court transcript");
  });

  it("errors clearly when the audio transcribes to nothing", async () => {
    mockGenerateContent.mockResolvedValueOnce({ text: "   " });
    const res = await request(app)
      .post("/api/transcribe")
      .send({ audioData: "base64audio", mimeType: "audio/webm" });
    expect(res.status).toBeGreaterThanOrEqual(400);
  });
});

describe("POST /api/transcribe-audio", () => {
  it("rejects a request with no audio data", async () => {
    const res = await request(app).post("/api/transcribe-audio").send({});
    expect(res.status).toBe(400);
  });

  it("returns the transcription on success", async () => {
    mockGenerateContent.mockResolvedValueOnce({ text: "hello there" });
    const res = await request(app).post("/api/transcribe-audio").send({ audioData: "base64audio", mimeType: "audio/webm" });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true, text: "hello there" });
  });

  it("degrades gracefully to a 200 fallback instead of an error when transcription fails", async () => {
    mockGenerateContent.mockRejectedValueOnce(new Error("Gemini is down"));
    const res = await request(app).post("/api/transcribe-audio").send({ audioData: "base64audio", mimeType: "audio/webm" });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.isFallback).toBe(true);
  });
});

describe("POST /api/lawyer-intake", () => {
  const validBody = {
    parentName: "Jane Doe",
    lawyerId: "lawyer-123",
    email: "jane@example.com",
    city: "Toronto",
    details: "Need help with a motion.",
    consentGiven: true,
  };

  it("rejects a missing parentName", async () => {
    const res = await request(app).post("/api/lawyer-intake").send({ ...validBody, parentName: undefined });
    expect(res.status).toBe(400);
  });

  it("rejects an invalid email", async () => {
    const res = await request(app).post("/api/lawyer-intake").send({ ...validBody, email: "not-an-email" });
    expect(res.status).toBe(400);
  });

  it("rejects a request without consent", async () => {
    const res = await request(app).post("/api/lawyer-intake").send({ ...validBody, consentGiven: false });
    expect(res.status).toBe(400);
  });

  it("records the intake without claiming an email was sent when SMTP isn't configured", async () => {
    const res = await request(app).post("/api/lawyer-intake").send(validBody);
    expect(res.status).toBe(200);
    expect(res.body.emailSent).toBe(false);
    expect(res.body.message).toMatch(/isn't configured/);
    expect(mockSendMail).not.toHaveBeenCalled();
  });

  it("actually emails the intake when SMTP is configured", async () => {
    process.env.SMTP_HOST = "smtp.example.com";
    process.env.SMTP_USER = "user";
    process.env.SMTP_PASS = "pass";
    process.env.LAWYER_INTAKE_TO = "lawyers@example.com";
    mockSendMail.mockResolvedValueOnce({});
    try {
      const res = await request(app).post("/api/lawyer-intake").send(validBody);
      expect(res.status).toBe(200);
      expect(res.body.emailSent).toBe(true);
      expect(mockSendMail).toHaveBeenCalledTimes(1);
    } finally {
      delete process.env.SMTP_HOST;
      delete process.env.SMTP_USER;
      delete process.env.SMTP_PASS;
      delete process.env.LAWYER_INTAKE_TO;
    }
  });
});
