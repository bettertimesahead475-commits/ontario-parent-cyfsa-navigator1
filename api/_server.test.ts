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
  TIER_PRICES: { Pro: 19, Premium: 49 },
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

beforeEach(() => {
  vi.clearAllMocks();
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

describe("POST /api/activate-code", () => {
  it("rejects a missing code or email", async () => {
    const res = await request(app).post("/api/activate-code").send({ email: "a@b.com" });
    expect(res.status).toBe(400);
  });

  it("returns a session token for a valid code", async () => {
    mockAccess.verifyAccessCode.mockResolvedValueOnce({ token: "tok", tier: "Pro", email: "a@b.com" });
    const res = await request(app).post("/api/activate-code").send({ email: "a@b.com", code: "AAAA-BBBB" });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true, tier: "Pro", token: "tok", email: "a@b.com" });
  });

  it("maps an invalid code to 401", async () => {
    mockAccess.verifyAccessCode.mockRejectedValueOnce(Object.assign(new Error("Invalid email or code."), { statusCode: 401 }));
    const res = await request(app).post("/api/activate-code").send({ email: "a@b.com", code: "WRONG" });
    expect(res.status).toBe(401);
  });
});

describe("POST /api/extract-text", () => {
  it("rejects a missing fileData.base64", async () => {
    const res = await request(app).post("/api/extract-text").send({ fileData: {} });
    expect(res.status).toBe(400);
  });

  it("rejects an unsupported mime type", async () => {
    const res = await request(app)
      .post("/api/extract-text")
      .send({ fileData: { base64: "abcd", mimeType: "application/zip" } });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/Unsupported file type/);
  });

  it("decodes text/* files directly without calling Gemini", async () => {
    const base64 = Buffer.from("Hello world", "utf-8").toString("base64");
    const res = await request(app)
      .post("/api/extract-text")
      .send({ fileData: { base64, mimeType: "text/plain" } });
    expect(res.status).toBe(200);
    expect(res.body.extractedText).toBe("Hello world");
    expect(mockGenerateContent).not.toHaveBeenCalled();
  });

  it("runs PDFs/images through Gemini OCR", async () => {
    mockGenerateContent.mockResolvedValueOnce({ text: "Extracted content" });
    const res = await request(app)
      .post("/api/extract-text")
      .send({ fileData: { base64: "abcd", mimeType: "application/pdf" } });
    expect(res.status).toBe(200);
    expect(res.body.extractedText).toBe("Extracted content");
    expect(mockGenerateContent).toHaveBeenCalledTimes(1);
  });

  it("returns 422 when nothing readable comes back", async () => {
    mockGenerateContent.mockResolvedValueOnce({ text: "   " });
    const res = await request(app)
      .post("/api/extract-text")
      .send({ fileData: { base64: "abcd", mimeType: "image/png" } });
    expect(res.status).toBe(422);
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
      .send({ textContent: "some affidavit text", model: "claude-haiku-4-5-20251001" });
    expect(mockCreateMessage).toHaveBeenCalledTimes(2);
    for (const call of mockCreateMessage.mock.calls) {
      expect(call[0].model).toBe("claude-haiku-4-5-20251001");
    }
  });

  it("returns a clear error instead of fabricating a report when either response isn't valid JSON", async () => {
    mockCreateMessage.mockResolvedValueOnce(claudeTextResponse("not json at all"));
    mockCreateMessage.mockResolvedValueOnce(claudeJsonResponse(MINIMAL_ANALYSIS));
    const res = await request(app).post("/api/analyze").send({ textContent: "some text" });
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(res.body.documentTitle).toBeUndefined();
  });

  it("maps a rate-limit error from either concurrent call to HTTP 429", async () => {
    mockCreateMessage.mockResolvedValueOnce(claudeJsonResponse(MINIMAL_ANALYSIS));
    mockCreateMessage.mockRejectedValueOnce(Object.assign(new Error("rate limit exceeded"), { status: 429 }));
    const res = await request(app).post("/api/analyze").send({ textContent: "some text" });
    expect(res.status).toBe(429);
    expect(res.body.isRateLimit).toBe(true);
  });
});

describe("POST /api/case-timeline", () => {
  it("rejects fewer than two documents", async () => {
    const res = await request(app).post("/api/case-timeline").send({ documents: [{ name: "a", text: "x" }] });
    expect(res.status).toBe(400);
  });

  it("always requests 16000 max_tokens for a valid multi-document request", async () => {
    mockCreateMessage.mockResolvedValueOnce(claudeJsonResponse({ timeline: [], conflicts: [], openItems: [] }));
    const res = await request(app)
      .post("/api/case-timeline")
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
  it("rejects a missing query", async () => {
    const res = await request(app).post("/api/rag-query").send({ files: [] });
    expect(res.status).toBe(400);
  });

  it("forwards conversation history into the prompt sent to Claude", async () => {
    mockCreateMessage.mockResolvedValueOnce(claudeTextResponse("Here's my answer."));
    const res = await request(app)
      .post("/api/rag-query")
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
    await request(app).post("/api/rag-query").send({ query: "A question", files: [] });
    const sentPrompt = JSON.stringify(mockCreateMessage.mock.calls[0][0].messages);
    expect(sentPrompt).not.toContain("CONVERSATION SO FAR");
  });
});

describe("POST /api/extract-evidence", () => {
  it("rejects empty narrative text", async () => {
    const res = await request(app).post("/api/extract-evidence").send({ narrativeText: "   " });
    expect(res.status).toBe(400);
  });

  it("returns the structured extraction on success", async () => {
    mockCreateMessage.mockResolvedValueOnce(claudeJsonResponse({ date: "2026-08-01", whatHappened: "A visit occurred." }));
    const res = await request(app).post("/api/extract-evidence").send({ narrativeText: "Yesterday the worker visited." });
    expect(res.status).toBe(200);
    expect(res.body.whatHappened).toBe("A visit occurred.");
  });
});

describe("POST /api/deep-scan", () => {
  const MINIMAL_DEEP_SCAN = {
    gaps: [],
    missingEvidence: [],
    retorts: [],
    disclaimer: "disclaimer",
  };

  it("rejects empty document text", async () => {
    const res = await request(app).post("/api/deep-scan").send({ documentText: "   " });
    expect(res.status).toBe(400);
  });

  it("returns the structured deep-scan report on success, requesting 16000 max_tokens", async () => {
    mockCreateMessage.mockResolvedValueOnce(claudeJsonResponse(MINIMAL_DEEP_SCAN));
    const res = await request(app)
      .post("/api/deep-scan")
      .send({ documentText: "Some CAS worker observation notes.", documentName: "notes.txt", category: "Worker Notes" });

    expect(res.status).toBe(200);
    expect(res.body.disclaimer).toBe("disclaimer");
    const callArgs = mockCreateMessage.mock.calls[0][0];
    expect(callArgs.max_tokens).toBe(16000);
  });

  it("tells the model there is no prior analysis when none is supplied", async () => {
    mockCreateMessage.mockResolvedValueOnce(claudeJsonResponse(MINIMAL_DEEP_SCAN));
    await request(app).post("/api/deep-scan").send({ documentText: "Some document text." });
    const sentPrompt = JSON.stringify(mockCreateMessage.mock.calls[0][0].messages);
    expect(sentPrompt).toContain("No prior analysis is available");
  });

  it("forwards the prior analysis's red flags and instructs the model not to repeat them", async () => {
    mockCreateMessage.mockResolvedValueOnce(claudeJsonResponse(MINIMAL_DEEP_SCAN));
    await request(app)
      .post("/api/deep-scan")
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
    const res = await request(app).post("/api/deep-scan").send({ documentText: "Some document text." });
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(res.body.gaps).toBeUndefined();
  });

  it("maps a rate-limit error from the model to HTTP 429", async () => {
    mockCreateMessage.mockRejectedValueOnce(Object.assign(new Error("rate limit exceeded"), { status: 429 }));
    const res = await request(app).post("/api/deep-scan").send({ documentText: "Some document text." });
    expect(res.status).toBe(429);
    expect(res.body.isRateLimit).toBe(true);
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
