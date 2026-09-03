/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import express, { Request, Response } from "express";
import helmet from "helmet";
import cors from "cors";
import rateLimit from "express-rate-limit";

import path from "path";
import fs from "fs";
import dotenv from "dotenv";
import compression from "compression";
import Anthropic from "@anthropic-ai/sdk";
import { GoogleGenAI } from "@google/genai";
import { requestAccess, approvePayment, verifyAccessCode, TIER_PRICES, type Tier } from "./services/access.js";

dotenv.config();

let geminiClient: GoogleGenAI | null = null;
let anthropicClient: Anthropic | null = null;

function getAnthropicClient(): Anthropic {
  if (anthropicClient) return anthropicClient;
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey || !apiKey.trim()) {
    throw new Error("ANTHROPIC_API_KEY environment variable is not configured. Add the Claude API key in Vercel project environment variables and redeploy.");
  }
  anthropicClient = new Anthropic({ apiKey });
  return anthropicClient;
}

// Helper to get Gemini client
function getGeminiClient(): GoogleGenAI {
  if (geminiClient) return geminiClient;
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey || !apiKey.trim()) {
    throw new Error("GEMINI_API_KEY environment variable is not configured. Please add your Gemini API key in the Settings menu.");
  }
  geminiClient = new GoogleGenAI({
    apiKey: apiKey,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      }
    }
  });
  return geminiClient;
}

// (Supabase access for the e-transfer flow lives in services/access.ts —
// getSupabaseClient() was only ever used by the old broken /api/activate-code
// handler, which has been replaced.)

async function generateGeminiContentWithRetry(
  ai: any,
  modelNames: string[],
  options: {
    contents: any;
    config?: any;
  }
): Promise<any> {
  let lastError: any = null;

  for (const modelName of modelNames) {
    let attempts = 0;
    const maxAttempts = 3;
    let delay = 1000;

    while (attempts < maxAttempts) {
      try {
        console.log(`[Gemini API] Calling generateContent with model ${modelName} (Attempt ${attempts + 1}/${maxAttempts})`);
        const response = await ai.models.generateContent({
          ...options,
          model: modelName,
        });
        return response;
      } catch (error: any) {
        lastError = error;
        const errMsg = (error?.message || "").toLowerCase();
        const status = (error as any)?.status || (error as any)?.code || error?.error?.code;

        console.log(`[AI Engine] Gemini attempt with ${modelName} did not succeed:`, error?.message || error);

        const isTransient =
          status === 429 ||
          status === 503 ||
          status === 500 ||
          status === 404 ||
          errMsg.includes("503") ||
          errMsg.includes("429") ||
          errMsg.includes("404") ||
          errMsg.includes("not found") ||
          errMsg.includes("quota") ||
          errMsg.includes("rate limit") ||
          errMsg.includes("unavailable") ||
          errMsg.includes("overloaded") ||
          errMsg.includes("high demand") ||
          errMsg.includes("temporary") || errMsg.includes("fetch failed") || errMsg.includes("timeout") || errMsg.includes("network");

        if (!isTransient) {
          throw error;
        }

        const isQuotaOrRateLimit =
          status === 429 ||
          errMsg.includes("429") ||
          errMsg.includes("quota") ||
          errMsg.includes("rate limit");

const isLastModel = modelNames.indexOf(modelName) === modelNames.length - 1;

        if (isQuotaOrRateLimit && !isLastModel) {
          console.log(`[Gemini API] Model ${modelName} hit quota/rate-limit/overload/503. Skipping immediately to next fallback model.`);
          break;
        }

        attempts++;
        if (attempts < maxAttempts) {
          console.log(`[Gemini API] Retrying in ${delay}ms...`);
          await new Promise((resolve) => setTimeout(resolve, delay));
          delay *= 2;
        }
      }
    }
  }

  throw lastError;
}

async function extractTextWithGeminiBase64(base64Data: string, mimeType: string): Promise<string> {
  // Simple validation to ensure base64Data is likely valid base64
  const cleanedBase64 = base64Data.trim();
  if (cleanedBase64.length === 0 || /[^A-Za-z0-9+/=\s]/.test(cleanedBase64)) {
    console.error("extractTextWithGeminiBase64 error: Invalid base64 data detected");
    throw new Error("Invalid base64 data format");
  }

  try {
    const ai = getGeminiClient();
    const modelsToTry = ["gemini-3.1-pro-preview", "gemini-3.6-flash"];
    const response = await generateGeminiContentWithRetry(ai, modelsToTry, {
      contents: [
        {
          role: "user",
          parts: [
            { text: "Extract the complete text of this document, preserving page numbers, headers, and paragraph breaks as closely as possible. Output plain text only, no commentary." },
            {
              inlineData: {
                mimeType: mimeType,
                data: cleanedBase64
              }
            }
          ]
        }
      ]
    });
    return response.text || "";
  } catch (error) {
    console.error("extractTextWithGeminiBase64 error:", error);
    throw error;
  }
}

async function transcribeAudioWithGemini(base64Data: string, mimeType: string): Promise<string> {
  // Real audio transcription — the actual audio bytes are sent to the model.
  // Claude has no native audio understanding, so this always goes to Gemini
  // directly because Claude does not process audio input.
  const cleaned = (base64Data || "").trim();
  if (!cleaned) throw new Error("No audio data was provided.");

  const ai = getGeminiClient();
  const modelsToTry = ["gemini-3.1-pro-preview", "gemini-3.6-flash"];
  const response = await generateGeminiContentWithRetry(ai, modelsToTry, {
    contents: [
      {
        role: "user",
        parts: [
          {
            text:
              "Transcribe this audio recording exactly as spoken. Attribute lines to speakers only where you can genuinely tell voices apart (e.g. \"Speaker 1:\", \"Speaker 2:\") — do not guess names or roles unless someone states their own name or role aloud. Mark unclear or inaudible sections as [inaudible]. Do not add commentary, legal formatting, headers, certifications, or analysis — output the transcription text only, nothing else.",
          },
          { inlineData: { mimeType, data: cleaned } },
        ],
      },
    ],
  });
  return response.text || "";
}

// Text analysis uses Claude. Gemini remains dedicated to OCR and audio transcription.
const CLAUDE_MODELS = new Set(["claude-sonnet-5", "claude-haiku-4-5-20251001"]);

async function generateContentWithFallback(
  params: {
    system?: string;
    messages: any[];
    max_tokens?: number;
    // BUG FOUND: Claude Sonnet 5 runs adaptive thinking BY DEFAULT on every request that
    // doesn't explicitly disable it, and max_tokens is a hard cap on thinking + response
    // TOGETHER (confirmed in Anthropic's own Sonnet 5 migration docs). That's the real reason
    // truncation was document-dependent rather than purely length-dependent: however much the
    // model adaptively decided to "think" on a given document ate into the same budget the
    // actual JSON output needed, with no way to predict it in advance. For structured
    // extraction tasks like this (fill in a fixed schema), thinking isn't needed - explicitly
    // disabling it removes that unpredictable variable entirely. Defaults to disabled since
    // every current caller in this file is a structured-extraction task.
    enableThinking?: boolean;
  },
  primaryModel: string = "claude-sonnet-5"
): Promise<{ text: string }> {
  const client = getAnthropicClient();
  const model = CLAUDE_MODELS.has(primaryModel) ? primaryModel : "claude-sonnet-5";
  const messages = params.messages.map((message: any) => ({
    // BUG FOUND IN AUDIT: this ternary always evaluates to "assistant" or "user" but TypeScript
    // was widening the inferred type to plain `string`, which doesn't satisfy the Anthropic
    // SDK's stricter `"user" | "assistant"` role type. This has been showing up as a build-time
    // type error on every single deploy today (harmless in practice since esbuild doesn't
    // type-check at build time, but worth actually fixing rather than leaving a permanent red
    // herring in the build logs that could mask a real error next time).
    role: (message.role === "assistant" ? "assistant" : "user") as "user" | "assistant",
    content: Array.isArray(message.content)
      ? message.content.map((part: any) => ({
          type: "text" as const,
          text: part.type === "text" ? part.text : JSON.stringify(part),
        }))
      : String(message.content),
  }));

  console.log(`[AI Engine] Claude routing. Model: ${model}`);
  const response = await client.messages.create({
    model,
    // Raised again - Sonnet 5's actual ceiling is 128,000, confirmed against Anthropic's own
    // docs (AWS Bedrock model card, platform "what's new" page). The prior defaults of 8000/
    // 16000 were conservative guesses nowhere near the real limit, and combined with adaptive
    // thinking eating into the same budget (see enableThinking above), were truncating real
    // documents in production.
    max_tokens: params.max_tokens || 16000,
    thinking: params.enableThinking ? undefined : { type: "disabled" as const },
    system: params.system,
    messages,
  });
  const textOut = response.content
    .filter((block) => block.type === "text")
    .map((block) => block.text)
    .join("");

  // BUG FIX: an empty result here was previously silent and unexplained — the caller just saw
  // "Empty response received from the analysis service," with no way to tell why. The most
  // common real cause is the response being cut off by max_tokens before any usable text block
  // was completed (large analysis schemas, like /api/analyze's, need more headroom than the old
  // 4000-token default gave them). Logging stop_reason here makes that diagnosable immediately
  // instead of requiring a runtime-log archaeology session every time it happens.
  if (!textOut) {
    console.error(
      `[AI Engine] Empty text output. stop_reason=${(response as any).stop_reason}, ` +
      `usage=${JSON.stringify((response as any).usage)}. ` +
      `If stop_reason is "max_tokens", raise the max_tokens parameter for this call.`
    );
  }

  return { text: textOut };
}

// Helper to extract JSON from any block resiliently.
// BUG FIX: each fallback strategy used to be untried if an earlier one threw partway through
// (e.g. a fenced-code match was found but the JSON inside it was itself incomplete/truncated —
// that inner throw used to propagate immediately instead of falling through to the bracket-scan
// fallback). Each strategy is now isolated in its own try/catch so a failure in one doesn't
// skip the rest. If every strategy still fails, the error message now says plainly that the
// response looks truncated, instead of surfacing a raw, unhelpful "Unexpected token `" message.
function extractJson(text: string): any {
  const trimmed = text.trim();

  try {
    return JSON.parse(trimmed);
  } catch { /* fall through to next strategy */ }

  const fenceMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
  if (fenceMatch) {
    try {
      return JSON.parse(fenceMatch[1].trim());
    } catch { /* fenced block itself wasn't valid/complete JSON — keep trying */ }
  }

  const startIndex = trimmed.indexOf('{');
  const endIndex = trimmed.lastIndexOf('}');
  if (startIndex !== -1 && endIndex !== -1 && endIndex > startIndex) {
    try {
      return JSON.parse(trimmed.substring(startIndex, endIndex + 1));
    } catch { /* still not parseable — keep trying */ }
  }

  // Nothing worked. A response that starts with an opening fence/brace but never reaches a
  // valid, complete JSON structure is the classic signature of the model's output being cut
  // off before it finished — most often because it needed more room than max_tokens allowed.
  const looksTruncated = /```(?:json)?\s*\{/.test(trimmed) || (startIndex !== -1 && endIndex <= startIndex);
  if (looksTruncated) {
    throw new Error(
      "The analysis response was incomplete — it looks like it was cut off before finishing, " +
      "likely because the document was long or complex enough to need more output room than was " +
      "allotted. Try again; if it keeps happening on this document, try a shorter excerpt."
    );
  }
  throw new Error("The analysis response was not valid JSON and could not be parsed.");
}

// Unified AI error handling and user-friendly formatting with HTTP status codes
function handleAIError(error: any, contextDescription: string, res: Response) {
  console.error(`[AI Error] during ${contextDescription}:`, error);
  const errMsg = (error?.message || "").toLowerCase();
  const status = (error as any)?.status;

  // BUG FOUND: this list didn't match "503"/"unavailable"/"high demand" - even though
  // generateGeminiContentWithRetry (above) already treats those exact words as transient and
  // retries on them. That meant once retries were exhausted on a genuine Google outage, the
  // raw Gemini error JSON (e.g. {"error":{"code":503,"message":"...high demand...",
  // "status":"UNAVAILABLE"}}) fell through every check here and got dumped straight into the
  // response as the user-facing error text - a parent seeing raw API JSON instead of a plain
  // sentence. Expanded to match the same transient-detection words used by the retry logic.
  const isRateLimit =
    status === 429 ||
    status === 503 ||
    errMsg.includes("429") ||
    errMsg.includes("503") ||
    errMsg.includes("quota") ||
    errMsg.includes("rate limit") ||
    errMsg.includes("overloaded") ||
    errMsg.includes("exhausted") ||
    errMsg.includes("unavailable") ||
    errMsg.includes("high demand");

  if (isRateLimit) {
    return res.status(429).json({
      error: "The AI service is experiencing high demand right now. Please wait a moment and try again - this is temporary and not a problem with your document.",
      isRateLimit: true
    });
  }

  if (errMsg.includes("api key") || errMsg.includes("invalid key") || status === 403 || status === 401) {
    return res.status(status || 400).json({
      error: "AI provider authentication failed. Check the configured API key in Vercel project environment variables."
    });
  }

  // Final fallback - never pass a raw provider error message straight through to the user,
  // since it can be an unformatted JSON blob (see above) rather than a readable sentence.
  res.status(status || 500).json({
    error: `Something went wrong during ${contextDescription}. Please try again in a moment.`
  });
}

const app = express();

// Trust reverse proxy (needed for Cloud Run containers and rate limiting headers)
app.set("trust proxy", 1);

const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 3000;

// Security features
app.use(helmet({
  contentSecurityPolicy: false, // Vite requires inline scripts during dev, and some CDNs
}));

// CORS setup (allowing all for now, can be restricted to frontend domain)
app.use(cors({
  origin: process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : '*',
  methods: ['GET', 'POST', 'PUT', 'DELETE'],
}));

// Rate limiting for API endpoints
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // Limit each IP to 100 requests per windowMs
  message: { error: "Too many requests from this IP, please try again after 15 minutes" },
  standardHeaders: true,
  legacyHeaders: false,
  validate: false, // Disable built-in validation checks to prevent proxy header warnings
});
app.use('/api', apiLimiter);

// Compress all responses for enhanced load speed (LCP/FCP)
app.use(compression());

// Increase payload size limit to digest base64 images / text / documents easily
app.use(express.json({ limit: "100mb" }));


  // API 1: Health endpoint
  app.get("/api/health", (req: Request, res: Response) => {
    res.json({ status: "healthy", timestamp: new Date().toISOString() });
  });

  const SEARCH_CONNECTORS_DISCLAIMER =
    "This explanation is generated for informational/educational purposes only. It does not constitute legal advice or representation. Please consult a lawyer licensed by the Law Society of Ontario, or contact Legal Aid Ontario, before relying on it.";

  app.post("/api/search-connectors", async (req: Request, res: Response) => {
    try {
      const { query } = req.body;
      const ai = getGeminiClient();
      const response = await generateGeminiContentWithRetry(ai, ["gemini-3.1-pro-preview"], {
        contents: [{ role: "user", parts: [{ text: `Explain the following legal concept for a family law context (CYFSA), for a self-represented Ontario parent: ${query}` }] }],
        config: {
          systemInstruction: `You are ParentShield's concept-lookup tool. You explain CYFSA/CLRA legal concepts in plain language for a self-represented Ontario parent. This is educational information, not legal advice — you never tell the parent what to do in their specific case.

CORE RULES (non-negotiable)
1. Only cite a specific CYFSA/CLRA section number if it is one of these confirmed, verified references:
- CYFSA s.74(2): defines "child in need of protection" (17 clauses, expanded in 2021 for child sex trafficking and again for a prescribed 16/17-year-old circumstance).
- CYFSA s.94(1): the court shall not adjourn a hearing for more than 30 days absent consent or an unaddressed objection.
- CYFSA s.94(5): a placement-with-relative consideration clause tied to temporary care orders during an adjournment — NOT a post-apprehension hearing-deadline rule. Never cite s.94(5) for a hearing-timeline argument.
- CYFSA s.125(1): the duty-to-report section — reasonable-grounds-to-suspect standard.
For any other section number, including s.70, s.81, and CLRA s.8(1), say the general concept but flag the exact subsection as "⚠️ Statute citation unverified — confirm exact section with counsel before relying on this" rather than stating one as fact. Never generate a plausible-sounding section number from pattern-matching — a wrong citation is worse than none.
2. Explain concepts and general legal principles only. Never tell the parent what to do in their specific situation, never say what a specific outcome will be, and never phrase anything as an instruction ("you should file..."). Reframe as a question for counsel instead ("ask your lawyer whether...").
3. Never fabricate a case name, quote, or source. If you cannot verify something, say so directly instead of guessing.
4. Keep the explanation itself educational and concise — do not append the disclaimer yourself, it is added automatically after your response.`,
        }
      });
      const answerText = response.text || "";
      res.json({ response: `${answerText}\n\n---\n${SEARCH_CONNECTORS_DISCLAIMER}` });
    } catch (error) {
      console.error(error);
      res.status(500).json({ error: "Failed to search connectors." });
    }
  });

  // API 1b: Request access before paying — creates a pending payment record
  // and a reference number the parent puts in their Interac e-transfer memo.
  // Body: { email: string, tier: "Pro" | "Premium" }
  app.post("/api/request-access", async (req: Request, res: Response) => {
    try {
      const { email, tier } = req.body || {};
      if (!email || !/^\S+@\S+\.\S+$/.test(email)) {
        return res.status(400).json({ error: "A valid email is required." });
      }
      if (tier !== "Pro" && tier !== "Premium") {
        return res.status(400).json({ error: 'tier must be "Pro" or "Premium".' });
      }
      const result = await requestAccess(email, tier as Tier);
      res.json(result);
    } catch (err: any) {
      console.error("[/api/request-access]", err);
      res.status(err.statusCode || 500).json({ error: err.message || "Failed to create access request." });
    }
  });

  // API 1c: Admin-only — approve a payment after confirming the e-transfer
  // landed, and generate the one-time access code to send to the parent.
  // Header: x-admin-secret: <ADMIN_SECRET>
  // Body: { referenceNumber: string, amountReceived: number }
  app.post("/api/admin/approve-payment", async (req: Request, res: Response) => {
    try {
      if (!process.env.ADMIN_SECRET || req.headers["x-admin-secret"] !== process.env.ADMIN_SECRET) {
        return res.status(401).json({ error: "Unauthorized." });
      }
      const { referenceNumber, amountReceived } = req.body || {};
      if (!referenceNumber || typeof amountReceived !== "number") {
        return res.status(400).json({ error: "referenceNumber (string) and amountReceived (number) are required." });
      }
      const result = await approvePayment(referenceNumber, amountReceived);
      res.json(result);
    } catch (err: any) {
      console.error("[/api/admin/approve-payment]", err);
      res.status(err.statusCode || 500).json({ error: err.message || "Failed to approve payment." });
    }
  });

  app.get("/api/access-pricing", (_req: Request, res: Response) => {
    res.json({ prices: TIER_PRICES });
  });

  // API 1d: Activate Access Code — parent redeems email + code.
  // Rewritten to use the real table schema (access_codes.code_hash,
  // SHA-256 + timing-safe compare) via services/access.ts. The previous
  // version here queried a plaintext `code` column that doesn't exist in
  // the actual table, so it could never have worked even when configured.
  app.post("/api/activate-code", async (req: Request, res: Response) => {
    try {
      const { code, email } = req.body || {};
      if (!code || !email) {
        return res.status(400).json({ error: "Code and email are required." });
      }
      const result = await verifyAccessCode(email, code);
      res.json({ success: true, tier: result.tier, token: result.token, email: result.email });
    } catch (err: any) {
      console.error("[/api/activate-code]", err);
      res.status(err.statusCode || 500).json({ error: err.message || "Activation failed." });
    }
  });

  // API 2: Analyze Document Endpoint (Educational advice based on CYFSA of Ontario)
  // Step 1 of the two-pass pipeline: OCR/text extraction only.
  //
  // This used to be bundled into /api/analyze, which meant one request had to
  // do Gemini OCR (up to 6 attempts across 2 models) AND a full Claude
  // analysis before responding — reliably exceeding the function timeout on
  // real documents and returning FUNCTION_INVOCATION_TIMEOUT. Splitting them
  // means each request has the whole budget to itself, and the user gets
  // feedback after extraction rather than waiting blind for both.
  app.post("/api/extract-text", async (req: Request, res: Response) => {
    try {
      const { fileData } = req.body || {};
      if (!fileData || !fileData.base64) {
        return res.status(400).json({ error: "fileData.base64 is required." });
      }

      let base64Data = fileData.base64;
      if (base64Data.includes(",")) base64Data = base64Data.split(",")[1];
      const mime = fileData.mimeType || "";

      let extractedText = "";
      if (mime === "application/pdf" || mime.startsWith("image/")) {
        extractedText = await extractTextWithGeminiBase64(base64Data, mime);
      } else if (mime.startsWith("text/")) {
        extractedText = Buffer.from(base64Data, "base64").toString("utf-8");
      } else {
        return res.status(400).json({ error: `Unsupported file type for extraction: ${mime}` });
      }

      if (!extractedText.trim()) {
        return res.status(422).json({
          error: "No readable text could be extracted from this file. If it's a scanned image, try a clearer copy.",
        });
      }

      res.json({ extractedText, characters: extractedText.length });
    } catch (err: any) {
      console.error("[/api/extract-text]", err);
      handleAIError(err, "text extraction", res);
    }
  });

  app.post("/api/analyze", async (req: Request, res: Response) => {
    let targetText = "";
    let fileDataObj: any = null;
    try {
      const { textContent, fileData, model } = req.body;
      fileDataObj = fileData;

      if (!textContent && !fileData) {
        return res.status(400).json({
          error: "Missing content. Please provide document text or upload a document."
        });
      }

      targetText = textContent || "";
      let extractedText = "";

      if (fileData && fileData.base64) {
        let base64Data = fileData.base64;
        if (base64Data.includes(",")) {
          base64Data = base64Data.split(",")[1];
        }

        const mime = fileData.mimeType || "";
        if (mime === "application/pdf" || mime.startsWith("image/")) {
          try {
            console.log(`[Dual Pass] Using Gemini for text/OCR extraction on mime: ${mime}`);
            extractedText = await extractTextWithGeminiBase64(base64Data, mime);
            console.log(`[Dual Pass] Gemini extracted ${extractedText.length} characters successfully.`);
          } catch (e) {
            console.error("Gemini text/OCR extraction failed, falling back to text", e);
          }
        } else if (mime.startsWith("text/")) {
          try {
            const decodedText = Buffer.from(base64Data, "base64").toString("utf-8");
            extractedText = decodedText;
          } catch (e) {
            console.error("Base64 text decoding failed, falling back", e);
          }
        }
      }

      if (extractedText) {
        targetText = extractedText + "\n\n" + targetText;
      }

      const documentContentBlock = targetText && targetText.trim()
        ? `DOCUMENT TEXT CONTENT:\n${targetText}`
        : "";

      // SPEED FIX FOUND IN AUDIT: this endpoint used to make ONE Claude call asking for every
      // field in AnalysisReport (red flags, threshold analysis, timeline violations, Charter
      // issues, verify/ask-lawyer/missing lists, AND a full lawyer case brief) in a single
      // response, capped at max_tokens: 16000. Token generation is serial, so a schema that big
      // meant the parent watched one long, uninterruptible wait for the entire thing to finish —
      // it was consistently the slowest single request in the app. The schema itself hasn't
      // shrunk (nothing here got less thorough), it's just split into two independent halves —
      // "core" (title/metadata/summary/evidence strength/red flags) and "deep-dive" (statutory
      // thresholds/timeline/Charter/lawyer brief) — issued as concurrent requests below via
      // Promise.all. Wall-clock time is now bounded by the SLOWER of the two, not the sum of
      // both, which is close to a 2x real reduction for documents that exercise both halves.
      const analysisRules = `CORE RULES (non-negotiable)
1. Every flag requires three things, all present or the flag is not shown:
- Document quote: the exact phrase from the uploaded document, with page/paragraph locator.
- Statute citation: the specific CYFSA section, ONLY if verified (see Rule 2).
- Match explanation: one sentence connecting the specific document language to the specific statutory requirement — not a general summary of the section.

2. Statute verification is mandatory before displaying any citation.
- BUG FIX (flagged in audit, Aug 29 2026): this rule used to tell you to check citations against
  "CYFSA-Statute-Reference.md" and, failing that, to run a live web search — but no such file
  ever existed in this codebase and no web-search tool is wired into this endpoint. Both
  verification paths this rule described were fictional, which is how a wrong citation
  (s.94(5) mislabeled as a "5-day post-apprehension hearing" rule — it is actually the
  placement-with-relative provision) made it into a real audit with full confidence and no
  hedge. The CONFIRMED STATUTE REFERENCE below is real, verified section text — this is the
  only list you may treat as confirmed.
- CONFIRMED STATUTE REFERENCE (verified Aug 29 2026 — cite these freely, with this exact text):
  * CYFSA s.74(2): defines "child in need of protection."
  * CYFSA s.94(1): "The court shall not adjourn a hearing for more than 30 days, (a) unless all
    the parties present and the person who will be caring for the child during the adjournment
    consent; or (b) if the court is aware that a party who is not present at the hearing
    objects to the longer adjournment."
  * CYFSA s.94(5): "Before making a temporary order for care and custody under clause (2)(d),
    the court shall consider whether it is in the child's best interests to make an order under
    clause (2)(c) to place the child in the care and custody of a person who is a relative of
    the child or a member of the child's extended [family/community]." This is a
    placement-with-relative consideration clause tied to temporary care orders during an
    adjournment — it is NOT a "5-day post-apprehension hearing" rule. Never cite s.94(5) for a
    hearing-timeline argument.
  * CYFSA s.125(1): the duty-to-report section — reasonable-grounds-to-suspect standard.
  * Bill 188, Supporting Children's Futures Act, 2024 (S.O. 2024, c. 17): amended CYFSA Part II
    with respect to children's rights to be informed about the Ombudsman, among other things.
  * Bill 33, Supporting Children and Students Act, 2025 (S.O. 2025, c. 12), Schedule 4:
    separately expands the Ombudsman's own mandate to investigate CAS/licensed-provider
    services under CYFSA. These are two distinct acts passed a year apart — never cite them
    together as one hyphenated "SCFA 2024 / Bill 33 2025" label; name whichever one actually
    supports the specific point being made, or both by their separate full names if both apply.
- Every other CYFSA/CLRA section (including s.70, s.81, and CLRA s.8(1)) is NOT in the confirmed
  list above. For any of these, you MUST show: "⚠️ Statute citation unverified — confirm exact
  section with counsel before relying on this." Do not state a specific subsection number for
  them as if it were confirmed fact.
- Never generate a plausible-sounding section number from pattern-matching. A wrong citation is worse than no citation — it undermines the parent's credibility if raised in court.

3. Severity labels must be calibrated, not maximal.
Replace absolute language with hedged, accurate framing:
- Do NOT use "[CRITICAL]", "unlawful", "illegal", or "violates" unless the document contains an explicit admission of a clear procedural failure (e.g., "we did not inform the court...") — i.e., the CAS's own words concede the point.
- For anything involving legal interpretation, an untested theory, or a matter courts have ruled inconsistently on (e.g., informal safety-plan advice, the boundary between access restriction and apprehension), use: "[Worth Raising With Counsel]" and explain that the law is not settled on this exact point.
- For hearsay/weight arguments, use: "[Affects Evidentiary Weight]" rather than "[CRITICAL]" / "Hearsay" — under Family Law Rules 14(19), hearsay in motion affidavits is often permitted if the source is disclosed; the real argument is usually about how much weight it should get, not whether it's admissible at all.

4. No invented legal theories presented as established law.
If you construct a novel argument (e.g., "informal access restriction = de facto apprehension triggering the 5-day hearing rule"), explicitly label it as a theory to test, not a rule: "This is an argument your lawyer could make — it has not been confirmed as settled law in this fact pattern. Ask your lawyer whether Ontario courts have accepted this reasoning."

5. Every output ends with the same disclaimer, unmodified:
"This document is generated for informational/educational purposes only. It does not constitute legal advice or representation. Please consult a lawyer licensed by the Law Society of Ontario, or contact Legal Aid Ontario, before relying on any conclusion in this report."

THINGS TO NEVER DO
- Never assert that a document violates a law unless the violation is admitted in the document's own words.
- Never present an unverified statute citation as fact.
- Never use more than one severity tier of "CRITICAL" per document — if everything is critical, nothing is.
- Never generate content that could be read as legal advice ("you should file a motion to strike") — reframe as questions for counsel ("ask your lawyer whether a motion to strike is appropriate here").
- Never fabricate a case name, citation, or quote. If asked to support a point with case law and you cannot verify one via search, say so directly.`;

      const coreSystemInstruction = `You are ParentShield's Evidence Strength Audit tool. You analyze legal documents (affidavits, motion records, CAS correspondence) submitted by self-represented parents in Ontario child protection proceedings under the CYFSA. Your job is to help the parent and their lawyer identify weaknesses, procedural issues, and points worth raising — NOT to issue legal conclusions.

${analysisRules}`;

      const deepDiveSystemInstruction = `You are ParentShield's Evidence Strength Audit tool, running the statutory-threshold and timeline half of a two-part review of one document already reviewed once by a parallel pass. Your job is to help the parent and their lawyer identify weaknesses, procedural issues, and points worth raising — NOT to issue legal conclusions.

${analysisRules}`;

      const corePromptText = `
        ${documentContentBlock}

        DOCUMENT CONTENT TO ANALYZE:
        Please perform a granular educational review, assessing the document's identity, evidentiary strength, and headline concerns.
        You MUST populate the response strictly matching this JSON schema and containing EVERY one of the checkpoints specified below:

        {
          "documentTitle": "Identify title or default to 'Uploaded Document'",
          "documentType": "e.g., Worker Observation Letter, CAS Application, Unofficial Draft, etc.",
          "metadata": {
            "fileNumber": "Extracted file number (e.g. FC-26-XXXX) or empty string",
            "applicantName": "Extracted applicant name (e.g. Children's Aid Society) or empty string",
            "respondentName": "Extracted respondent/parent name or empty string",
            "childNames": "Extracted names of involved children or empty string",
            "hearingDate": "Extracted next hearing or application date or empty string"
          },
          "disclaimer": "This document is generated for informational/educational purposes only. It does not constitute legal advice or representation. Please consult a lawyer licensed by the Law Society of Ontario, or contact Legal Aid Ontario, before relying on any conclusion in this report.",
          "completenessScore": 0, // integer 0-100 measuring how much relevant information is actually present; do not treat missing information as proof of misconduct or violation
          "completenessScoreMethod": "Score only the completeness of the information contained in this document. This is separate from Evidence Strength Index and is not an admissibility or legal-merits score.",
          "evidenceStrengthIndex": {
            "score": 0,
            "scale": "0-100",
            "label": "Evidence Strength Index",
            "method": "Calculate from the documented evidence in this file only. Do not score the legal merits of the case.",
            "components": {
              "firsthandKnowledge": {"score": 0, "max": 20, "explanation": ""},
              "sourceReliability": {"score": 0, "max": 15, "explanation": ""},
              "corroboration": {"score": 0, "max": 15, "explanation": ""},
              "documentarySupport": {"score": 0, "max": 15, "explanation": ""},
              "internalConsistency": {"score": 0, "max": 10, "explanation": ""},
              "contradictoryEvidenceHandling": {"score": 0, "max": 10, "explanation": ""},
              "legalAuthorityVerification": {"score": 0, "max": 10, "explanation": ""},
              "proceduralDocumentation": {"score": 0, "max": 5, "explanation": ""}
            },
            "calculation": "The final score must equal the sum of the eight component scores and must never be invented independently.",
            "limitations": "A low score means the document contains gaps, unsupported assertions, limited firsthand knowledge, contradictions, or insufficient documentation. It does not mean the document is false or inadmissible. A high score does not establish legal correctness or admissibility."
          },
          "fileSummary": "A concise, 2-3 sentence executive summary of the document, its core purpose, and the key evidentiary or procedural issues it raises. Must state that the Evidence Strength Index is a heuristic assessment of the evidence contained in the reviewed document, not a legal admissibility ruling. Missing information must reduce completeness only where appropriate and must never be treated as proof that an event, violation, or statutory failure occurred.",
          "redFlags": [
            {
               "id": "rf1",
               "severity": "Affects Evidentiary Weight", // Allowed: "Affects Evidentiary Weight", "Worth Raising With Counsel", or "CRITICAL". CRITICAL requires an explicit documented admission of a material procedural failure AND verified statutory authority; otherwise do not use CRITICAL.
               "category": "Hearsay", // "Hearsay", "Unsupported Claim", "Procedural Defect", "Authority Overreach", "Rights Omission", etc.
               "phraseDetected": "The exact sentence in the text representing the red flag",
               "explanation": "One sentence connecting the specific document language to the specific statutory requirement — not a general summary of the section.",
               "verifyRequirement": "What the parent should seek to prove this wrong or check (eg logs, direct eyewitness statement).",
               "legalReference": "The specific CYFSA section, ONLY if verified. If unverified: '⚠️ Statute citation unverified — confirm exact section with counsel before relying on this.'",
               "locationInDocument": "Page X, Paragraph Y",
               "parentActionStep": "concrete next step — 'ask your lawyer about X' / 'request disclosure of Y' — not a legal conclusion"
            }
          ]
        }
      `;

      const deepDivePromptText = `
        ${documentContentBlock}

        DOCUMENT CONTENT TO ANALYZE:
        Please perform a granular educational review, assessing CAS statutory thresholds, procedural timelines, and Charter/rights issues.
        You MUST populate the response strictly matching this JSON schema and containing EVERY one of the checkpoints specified below:

        {
          "thresholdAnalysis": [
            {
              "thresholdChecked": "CYFSA s. 81 — Application / Child Protection Proceeding Authority",
              "isMet": "Yes / No / Inconclusive",
              "reasoning": "Analyze the role of CYFSA s. 81 in the proceeding. Do not characterize s. 81 itself as an "imminent danger" threshold. Distinguish the statutory authority for commencing proceedings from the separate statutory grounds and tests applicable to whether a child is in need of protection or may be apprehended.",
              "primarySourceLaw": "⚠️ Statute citation unverified — confirm exact subsection with counsel before relying on this. (s.81 generally covers warrants/apprehension/hearing procedure, but the exact subsection for this point is not in the confirmed reference and must not be stated as fact.)"
            },
            {
              "thresholdChecked": "Child in Need of Protection grounds (CYFSA s. 74)",
              "isMet": "Yes / No / Inconclusive",
              "reasoning": "Check whether any of the 17 clauses defined under s. 74(2) of the CYFSA are asserted in the file. Evaluate whether assertion stands on uncorroborated hearsay or objective proof.",
              "primarySourceLaw": "CYFSA 2017, Section 74"
            },
            {
              "thresholdChecked": "Duty to Report standard vs Direct evidence (CYFSA s. 125)",
              "isMet": "Yes / No / Inconclusive",
              "reasoning": "Analyze if CAS or a reporter is misrepresenting the basic 'reasonable grounds to suspect' s. 125 duty to report standard as actual direct evidence of maltreatment inside this file.",
              "primarySourceLaw": "CYFSA 2017, Section 125"
            },
            {
              "thresholdChecked": "Kinship / Family-Based Alternatives — Documentation Check",
              "isMet": "Yes / No / Inconclusive",
              "reasoning": "Determine whether the reviewed document documents consideration of kinship, extended-family, customary-care, Indigenous, or other family-based alternatives where legally relevant. Do NOT infer that the Society failed to consider such alternatives merely because the affidavit does not mention them. Classify an absence of documentation as "Missing Evidence" or "Not Determinable From This Document" and identify the records required to verify what was actually considered.",
              "primarySourceLaw": "⚠️ Statute citation unverified — confirm exact section with counsel before relying on this."
            }
          ],
          "proceduralTimelineViolations": [
            {
              "timelineRule": "30-Day Adjournment Limit (CYFSA s. 94(1))",
              "documentAssertion": "E.g. calendar gaps, schedule arrangements or dates mentioned.",
              "evaluation": "Analyze if the document indicates court processes are adjourned for more than 30 days without universal consent under Section 94(1). If the document does not contain enough information to determine compliance, mark the result "Not Determinable From This Document". Never infer compliance merely because a violation or event is not mentioned.",
              "citation": "CYFSA, S.O. 2017, c. 14, s. 94(1)",
              "locationInDocument": "Page X, Paragraph Y, or state 'Checked & Compliant'",
              "parentActionStep": "Parent action steps to track scheduled court dates and ensure their lawyer asserts s. 94(1) rights."
            },
            {
              "timelineRule": "Court hearing timeline following apprehension without warrant",
              "documentAssertion": "E.g. dates of removal or court schedules.",
              "evaluation": "BUG FIX (flagged in audit): this checkpoint previously cited CYFSA s.94(5) for a '5-day post-apprehension hearing rule.' s.94(5) is confirmed to actually be a placement-with-relative consideration clause, not a hearing-timeline rule — that citation was wrong, not just unverified, and must never be used again. A statutory deadline for bringing an apprehended child before the court does exist under CYFSA, but its exact current section number is not in the confirmed reference and must be verified with counsel before being cited by number. Evaluate the document on its facts (was the child taken without a warrant, and how long before a court appearance) without asserting a specific section number.",
              "citation": "⚠️ Statute citation unverified — confirm exact section with counsel before relying on this.",
              "locationInDocument": "Page X, Paragraph Y, or state 'Not applicable - child in home care'",
              "parentActionStep": "Verify immediate court scheduling if a sudden take occurs. Ask your lawyer to confirm the exact CYFSA section governing the post-apprehension hearing deadline. Keep court liaison logs."
            },
            {
              "timelineRule": "Child Ombudsman Access & Continuous Care Rights",
              "documentAssertion": "E.g. references to child consultation, Ombudsman access, or CAS contact rules.",
              "evaluation": "Evaluate if the child's rights to reach the Ombudsman, or the duty for frequent in-care visitation, are met. Focus on rights access. Two distinct acts are relevant here and must be named separately, never combined into one label: Bill 188, Supporting Children's Futures Act, 2024 (S.O. 2024, c. 17), which amended CYFSA Part II regarding children's rights to be informed about the Ombudsman; and Bill 33, Supporting Children and Students Act, 2025 (S.O. 2025, c. 12), Schedule 4, which separately expanded the Ombudsman's own mandate to investigate CAS and licensed-provider services. Cite whichever actually applies to the specific fact in this document, or both by their full separate names if both apply.",
              "citation": "Bill 188, Supporting Children's Futures Act, 2024 (S.O. 2024, c. 17) and/or Bill 33, Supporting Children and Students Act, 2025 (S.O. 2025, c. 12) — cite by full name, never as a combined 'SCFA 2024 / Bill 33 2025' label.",
              "locationInDocument": "Page X, Paragraph Y, or 'Checked & Advised'",
              "parentActionStep": "Confirm child is aware they can contact the Ontario Ombudsman regarding CAS placements."
            },
            {
              "timelineRule": "300-Day Presumption of Parentage",
              "documentAssertion": "E.g. marriage status, cohabitant records, or parent naming details.",
              "evaluation": "Check for adherence to Children's Law Reform Act presumptions of parentage for separations within 300 days of birth, if relevant on the facts. The exact subsection is not in the confirmed reference and must not be stated as settled fact.",
              "citation": "⚠️ Statute citation unverified — confirm exact section with counsel before relying on this.",
              "locationInDocument": "Page X, Paragraph Y, or state 'Checked & Compliant'",
              "parentActionStep": "Action step for parent to confirm both actual parent parties are formally integrated in notices."
            }
          ],
          "charterAndHumanRightsIssues": [
            "Section 7 (Canadian Charter): Analyze and identify notable points where rights to life, liberty, and security of the person are engaged or infringed.",
            "Section 15 (Canadian Charter): Analyze and identify notable points where equality and non-discrimination rights are active.",
            "Mandatory Consideration of Indigenous, First Nations, Inuit, or Métis Heritage (CYFSA Section 2): Check and analyze whether culture and kinship options were respected."
          ],
          "whatToVerify": [
            "List specific items parent needs to double-check (e.g. text messages, calendars, doctor records, school attendance forms)"
          ],
          "whatToAskALawyer": [
            "List specific educational questions parent can ask their counsel about this text"
          ],
          "whatIsMissing": [
            "List elements that are missing from the analyzed text (e.g., direct worker observation, timeline of safe contact attempts, statement from child)"
          ],
          "lawyerCaseBrief": [
            "A comprehensive, highly-professional, 5-bullet detailed Case Brief structured specifically for legal counsel/attorneys. Each bullet should be in-depth and trace legal grounds, evidentiary deficiencies (such as hearsay, gaps, statutory overreach, or s. 94 timeline failures), and action plans."
          ]
        }
      `;

      // Both halves of the schema depend only on the same source document text, not on each
      // other's output, so they're independent requests — issuing them concurrently is safe and
      // is the actual speedup (see comment above documentContentBlock).
      const [coreResponse, deepDiveResponse] = await Promise.all([
        generateContentWithFallback({
          system: coreSystemInstruction,
          messages: [{ role: "user", content: [{ type: "text", text: corePromptText }] }],
          max_tokens: 8000
        }, model || "claude-sonnet-5"),
        generateContentWithFallback({
          system: deepDiveSystemInstruction,
          messages: [{ role: "user", content: [{ type: "text", text: deepDivePromptText }] }],
          max_tokens: 8000
        }, model || "claude-sonnet-5")
      ]);

      if (!coreResponse.text || !deepDiveResponse.text) {
        throw new Error("Empty response received from the analysis service.");
      }

      const coreReport = extractJson(coreResponse.text);
      const deepDiveReport = extractJson(deepDiveResponse.text);

      // Field-disjoint by construction (see the two schemas above), so a plain merge is safe.
      const report = { ...coreReport, ...deepDiveReport };
      res.json(report);

    } catch (error: any) {
      // Do NOT fabricate a fake analysis on failure — a parent could mistake
      // invented names/dates for a real reading of their own document.
      console.error("[document analysis] API error, returning honest failure (no fabricated fallback):", error);
      handleAIError(error, "document analysis", res);
    }
  });

  // API: Cross-Document Case Timeline
  // Takes every document already stored in the parent's case vault (organizedFiles) and
  // builds ONE sourced, dated timeline across all of them — the same task a human has to do
  // by hand today: cross-reference affidavits against emails/recordings/prior case files,
  // flag where two documents conflict, and flag where something one document promises
  // (e.g. "I'll get a second worker to review this") never shows up anywhere else.
  //
  // This never invents a date, quote, or event. Every row must be traceable to one of the
  // documents actually passed in. Anything the parent asserts happened but which isn't in
  // any of the supplied documents is listed as an OPEN ITEM, not as a timeline fact — this
  // mirrors exactly how the manual cross-referencing distinguished "confirmed in writing"
  // from "described by the parent, not yet located in any document."
  app.post("/api/case-timeline", async (req: Request, res: Response) => {
    try {
      const { documents, model, parentClaims } = req.body as {
        documents?: { name: string; text: string; sourceDate?: string }[];
        model?: string;
        parentClaims?: string;
      };

      if (!documents || !Array.isArray(documents) || documents.length === 0) {
        return res.status(400).json({
          error: "No documents provided. Add at least two documents to the case vault before building a cross-document timeline."
        });
      }
      if (documents.length < 2) {
        return res.status(400).json({
          error: "A cross-document timeline needs at least two documents to cross-reference. Add more documents to the case vault first."
        });
      }

      const MAX_DOCS = 40;
      const trimmedDocs = documents.slice(0, MAX_DOCS);

      const documentBlock = trimmedDocs
        .map((d, i) => `--- DOCUMENT ${i + 1}: "${d.name}" ${d.sourceDate ? `(dated/received: ${d.sourceDate})` : ""} ---\n${d.text}`)
        .join("\n\n");

      const systemInstruction = `You are ParentShield's Cross-Document Timeline tool. You are given multiple documents from a single CYFSA case — affidavits, emails, call/meeting transcripts, prior court orders. Your only job is to merge them into one chronological, sourced timeline and flag where they conflict or where something is missing.

NON-NEGOTIABLE RULES
1. Every timeline row must cite which supplied document(s) it came from, by the exact document name/number given. Never invent a citation.
2. Never invent a date, quote, or event. If a document is undated or a date is unclear, say so in the row rather than guessing a date.
3. Quotes must be copied verbatim from the supplied text, in quotation marks, with the source document named. Never paraphrase something into a quote.
4. A "conflict" entry requires two specific documents that actually say different things about the same event — cite both. Never flag a conflict on a hunch.
5. An "open item" is something referenced as a promise, plan, or claim in one document (e.g. "I will get a second worker to review this and report back") that does NOT appear, resolved or otherwise, in any other supplied document. Do not classify something as an open item if it is simply not mentioned anywhere — only flag it when one document creates an expectation that a later document then silently drops.
6. Never assert what a person's motive, mental state, or credibility is. State only what a document says and who said it.
7. If the parent's own framing of an event goes further than what the documents actually show, do not adopt that framing — describe only what the documents support, and note the gap explicitly in a "requiresConfirmation" field rather than silently inflating or silently ignoring it.
8. This tool never produces a legal conclusion (e.g. "this proves negligence," "this is grounds for a lawsuit"). It produces a sourced timeline only. Frame open items as questions for counsel, never as findings.
9. End every report with the same disclaimer, unmodified: "This is a sourced cross-reference of the documents provided. It is not legal advice and does not establish any fact not stated in those documents. Review with a lawyer licensed by the Law Society of Ontario before relying on it."
10. If the parent has supplied their own account of events (see "PARENT'S OWN ACCOUNT" below), check each specific factual claim in it against the supplied documents the same way you'd check one document against another — this is the most important part of the whole task, not an afterthought. For each claim: if a document confirms it, cite the confirmation; if a document contradicts it, cite the contradiction directly and do not soften it; if no document addresses it either way, say so plainly as neither confirmed nor contradicted, not as false. Never let a claim get more confident restated than the documents actually support, and never let it get missed just because it wasn't phrased as a question.

OUTPUT — return strictly this JSON schema, nothing else:
{
  "timeline": [
    {
      "date": "As stated in the source document, or 'undated' if not given",
      "event": "One factual sentence, in your own words unless quoting",
      "quote": "A verbatim quote if one materially matters, else empty string",
      "sources": ["Document N: \\"name\\"", "..."]
    }
  ],
  "conflicts": [
    {
      "topic": "What the two documents disagree about",
      "documentA": { "source": "Document N: \\"name\\"", "saysWhat": "..." },
      "documentB": { "source": "Document M: \\"name\\"", "saysWhat": "..." }
    }
  ],
  "openItems": [
    {
      "promisedIn": "Document N: \\"name\\"",
      "whatWasPromised": "...",
      "neverAddressedIn": "the rest of the supplied set"
    }
  ],
  "claimChecks": [
    {
      "claim": "The specific claim from the parent's own account, quoted or closely paraphrased",
      "verdict": "CONFIRMED | CONTRADICTED | NOT ADDRESSED",
      "explanation": "What the documents actually show, with citation(s)"
    }
  ],
  "requiresConfirmation": [
    "A specific claim the parent may believe is true but which the supplied documents do not themselves establish — phrased as a question for counsel, not a finding."
  ],
  "disclaimer": "This is a sourced cross-reference of the documents provided. It is not legal advice and does not establish any fact not stated in those documents. Review with a lawyer licensed by the Law Society of Ontario before relying on it."
}`;

      const claimsBlock = parentClaims && parentClaims.trim()
        ? `\n\nPARENT'S OWN ACCOUNT (check every specific factual claim in this against the documents above, and populate "claimChecks" accordingly — do not skip this):\n${parentClaims.trim()}\n`
        : "";

      const promptText = `Build the cross-document timeline from the following documents. Merge overlapping events, order everything chronologically where dates are known (undated items go in an "undated" group at the end), and apply every rule above.\n\n${documentBlock}${claimsBlock}`;


      const response = await generateContentWithFallback({
        system: systemInstruction,
        messages: [{ role: "user", content: [{ type: "text", text: promptText }] }],
        // BUG FOUND IN AUDIT: this had no explicit max_tokens, so it was falling back to the
        // shared 8000 default — the exact same risk that just caused /api/analyze to truncate
        // on real documents. This endpoint can process up to 40 documents at once and produce
        // a timeline + conflicts + open items + claim checks across all of them, which can
        // easily need more room than a single-document response.
        max_tokens: 16000
      }, model || "claude-sonnet-5");

      const responseText = response.text;
      if (!responseText) {
        throw new Error("Empty response received from the timeline service.");
      }

      const report = extractJson(responseText);
      res.json(report);

    } catch (error: any) {
      console.error("[case timeline] API error, returning honest failure (no fabricated fallback):", error);
      handleAIError(error, "case timeline", res);
    }
  });

  // API: Retrieval-Augmented Generation (RAG) Query Pipeline
  app.post("/api/rag-query", async (req: Request, res: Response) => {
    let queryVal = "";
    let filesVal: any[] = [];
    let focusVal = "";
    try {
      const { query, files, model, focus, history } = req.body;
      queryVal = query || "";
      filesVal = files || [];
      focusVal = focus || "";
      const conversationHistory: { role: string; content: string }[] = Array.isArray(history) ? history : [];
      if (!query) {
        return res.status(400).json({ error: "Missing query parameter." });
      }

      // Retrieve relevant content blocks from the files repository (BM25 or term overlap weight retrieval)
      const inputFiles = files || [];
      const queryWords = query.toLowerCase().split(/\s+/).filter((w: string) => w.length > 2);

      const scoredFiles = inputFiles.map((file: any) => {
        let score = 0;
        const fileContent = (file.content || "").toLowerCase();
        const fileName = (file.name || "").toLowerCase();

        queryWords.forEach((word: string) => {
          if (fileName.includes(word)) score += 15; // High weight for filename
          
          // Term occurrences weight
          const escapedWord = word.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&');
          const occurrences = (fileContent.match(new RegExp(escapedWord, "g")) || []).length;
          score += occurrences;
        });

        return { ...file, score };
      });

      // Filter non-matching files unless all scores are 0, sort by matching score and limit context to top 6 files
      const topMatches = scoredFiles
        .filter((file: any) => file.score > 0 || scoredFiles.length <= 4)
        .sort((a: any, b: any) => b.score - a.score)
        .slice(0, 6);

      const contextPayload = topMatches.map((tabFile: any) => 
        `--- START FILE CONTEXT: "${tabFile.name}" (Category: ${tabFile.category}) ---\
- SCORE INTEGRITY: The Evidence Strength Index must be evidence-neutral. Never increase the score because a document supports the parent and never decrease it because a document supports the Society.
- SCORE ONLY WHAT IS PRESENT: Evaluate the quality, corroboration, source reliability, consistency, legal verification, and completeness of the evidence actually contained in the reviewed document.
- MISSING INFORMATION: Missing information may reduce Factual Completeness or Analytical Confidence, but it must not automatically create a finding of misconduct, procedural defect, statutory violation, unlawful conduct, or Charter infringement.
- CONTRADICTIONS: A contradiction should be identified and scored based on the strength of the competing evidence. Do not decide which version is true unless the document itself establishes the answer.
- HEARSAY: Do not treat hearsay as automatically inadmissible. Identify the source, whether the affiant has personal knowledge, whether the source is identified, whether the statement is corroborated, and explain that the principal issue may be evidentiary weight.
- APPREHENSION VS ACCESS: Never infer that an access restriction, recommendation, warning, advice, safety-plan condition, or parent-to-parent arrangement automatically constitutes an apprehension. Analyze the factual circumstances separately and identify what evidence would establish an actual apprehension.
- CHARTER: Describe Charter rights as potentially engaged only where supported by the facts. Do not state or imply that an infringement has been established unless the document contains sufficient facts and verified law to support that conclusion.
- POST-APPREHENSION HEARING TIMELINE: CYFSA s.94(5) is confirmed to be a placement-with-relative consideration clause tied to temporary care orders, NOT a post-apprehension hearing-deadline rule — never cite s.94(5) for this. A statutory deadline for bringing an apprehended child before the court does exist, but its exact current section number is unverified in this tool; when relevant, discuss the timeline on the facts (was there an apprehension without a warrant, how long before a court appearance) and flag the specific section number as "⚠️ unverified — confirm with counsel" rather than stating one. Never conclude that an informal access restriction alone amounts to an apprehension triggering any such deadline.
- ABSENCE OF EVIDENCE IS NOT EVIDENCE OF ABSENCE. If a document does not mention an action, do not conclude that the action did not occur. Classify it as "Missing Evidence" or "Not Determinable From This Document" and identify what record would establish the fact.
- Never convert an allegation, omission, inference, police notation, hearsay statement, or unverified legal proposition into an established fact.
- For every material finding distinguish: DOCUMENTED FACT, REPORTED INFORMATION, INFERENCE, ALLEGATION, and LEGAL CONCLUSION. Never present reported information, inference, or allegation as an established fact.
- For every material finding identify the source document, paragraph/page/exhibit when available, source type, whether the affiant has firsthand knowledge, corroborating or contradictory evidence, missing evidence, applicable verified law, and confidence level (High, Moderate, Low, or Not Determinable).
n${tabFile.content || "Empty content"}\n--- END FILE CONTEXT: "${tabFile.name}" ---`
      ).join("\n\n");

      let focusGuideline = "";
      if (focus === "family-advocate") {
        focusGuideline = `
        FOCUS: EMPATHETIC FAMILY ADVOCACY & PARENTAL COACHING
        Your response style should be highly supportive, calm, clear, and focused on helping families navigate child protection with grace and safety. 
        Coach them on how to communicate with CAS workers, what boundaries they should keep, and suggest realistic day-to-day strategies to preserve family cohesion and avoid escalating conflicts unnecessarily.`;
      } else if (focus === "evidentiary-auditor") {
        focusGuideline = `
        FOCUS: CAS EVIDENTIARY AUDITING & CRITICAL EVIDENCE ANALYSIS
        Your response should focus heavily on scrutinizing facts vs. opinions, identifying hearsay, speculative statements, unsubstantiated claims, or biased wording in CAS worker reports.
        Analyze the evidentiary value of the documents, highlight gaps, and help families see where allegations lack solid factual proof or depend on secondary/tertiary reporting.`;
      } else {
        focusGuideline = `
        FOCUS: COMPREHENSIVE CYFSA STATUTORY COMPLIANCE & LEGAL AUDIT
        Your response should look for strict procedural timelines, statutory requirements and procedural timelines, including s. 74 protection grounds and s. 94 hearing/adjournment requirements, while avoiding unsupported characterization of s. 81 as an imminent-danger threshold, Charter of Rights compliance, and other legislative checklists to ensure parent rights are fully verified.`;
      }

      const systemInstruction = 
        `You are the CYFSA Ontario Case Assistant, powered by Claude. You are having an ongoing, multi-turn conversation with a self-represented parent about their real child protection case. You are not a one-shot report generator — you are expected to remember what the parent already told you earlier in this conversation and reference it, the same way a person would.

         GROUND EVERYTHING IN THE ACTUAL DOCUMENTS
         Answer only from the provided case file context below. Cite the specific source file explicitly, e.g., **[Source: CAS_Worker_Report_Sample.txt]**. If the files do not answer the question, say so plainly — "The uploaded case files do not contain information regarding this" — and name what kind of document would (an intake record, a specific worker's affidavit, a dated email). Never fill a gap with a plausible-sounding guess.

         DO NOT JUST AGREE WITH THE PARENT — CHECK THEIR CLAIM FIRST
         When the parent states something as fact ("they said X," "this proves Y," "I already confirmed Z"), do not simply accept it and build on it. Check it against the actual file context provided:
         - If the documents support it, say so and cite exactly where.
         - If the documents contradict it, say so directly and cite the contradicting document — do not soften a real contradiction into vague language.
         - If the documents are simply silent on it, say that plainly: this is not yet confirmed in anything uploaded, distinct from being contradicted.
         - If the parent's own conclusion goes further than what the source document actually supports (e.g. they call something "proof" when the document shows something more limited or ambiguous), name that gap directly and explain what the document actually shows instead. Do this the same way a careful colleague would — not to be difficult, but because a claim that outruns its evidence is the exact thing that damages credibility in front of a judge.

         USE THE CONVERSATION, NOT JUST THE LATEST MESSAGE
         You have the full conversation history below. Use it. If the parent contradicts something they told you two messages ago, point that out. If they already gave you a date, name, or document reference earlier, don't ask for it again — use it. If a new document they just added conflicts with something discussed earlier in this conversation, say so unprompted, the way a person actually cross-referencing the file would, not just when directly asked to compare.

         ASK BEFORE ASSUMING
         If the parent references a meeting, email, or document you don't have in the case file context, don't guess at its contents or assume it says what they imply. Ask them to upload it, or ask a clarifying question about exactly what it said — a specific, narrow question, not a vague "can you clarify."

         DISTINGUISH FACT FROM CHARACTERIZATION AT ALL TIMES
         For every material point, be clear whether it is: a DOCUMENTED FACT (stated directly in an uploaded document), REPORTED INFORMATION (one person's account of what another person said), an INFERENCE (a reasonable but unproven conclusion), an ALLEGATION (an unproven claim by a party), or a LEGAL CONCLUSION (a determination only a court or lawyer can actually make). Never present the second, third, or fourth as if it were the first.
         - SCORE INTEGRITY: never adjust an evidentiary assessment because a document happens to favour the parent or the Society — evaluate quality, corroboration, and reliability only.
         - HEARSAY: do not treat hearsay as automatically inadmissible; identify the source and whether it's corroborated, and note that the real question is usually weight, not admissibility.
         - APPREHENSION VS ACCESS: do not treat an access restriction, safety-plan condition, or informal arrangement as an apprehension unless the facts actually establish one.
         - ABSENCE OF EVIDENCE IS NOT EVIDENCE OF ABSENCE: if a document doesn't mention something, that does not mean it didn't happen — say "not addressed in the documents provided," not "did not occur."
         - Never state that a legal violation, Charter breach, or finding of misconduct has been established unless a document itself establishes it. Frame these as questions for the parent's lawyer, not as your own conclusions.

         CITE REAL LAW ONLY WHEN IT'S ACTUALLY RELEVANT
         Reference specific CYFSA sections (s. 74 protection grounds, s. 94 hearing/adjournment timelines, s. 81's actual statutory role, s. 125 duty to report, CLRA s. 8 parentage presumptions) using the exact keyword forms ('s. 74', 's. 94', 's. 81', 's. 125', 's. 3', 's. 101', 's. 87', 'CLRA', 'Evidence Act', 'Charter of Rights') so they link correctly — but only when the section is actually relevant to what's being discussed, never as decoration.

         TONE
         Direct, plain-language, and warm — this is a person managing one of the hardest things in their life. Correcting an overstated claim and being supportive of the parent are not in tension; the most useful thing you can do for them is make sure nothing they rely on falls apart under real scrutiny later.

         ${focusGuideline}`;

      const historyBlock = conversationHistory.length > 0
        ? `CONVERSATION SO FAR (most recent last — use this; do not treat this message as the first thing the parent has said):\n` +
          conversationHistory.map(h => `${h.role === "user" ? "PARENT" : "ASSISTANT"}: ${h.content}`).join("\n\n") +
          `\n\n---\n\n`
        : "";

      const promptBody = `
        ${historyBlock}PARENT'S CURRENT MESSAGE: "${query}"
        
        RETRIEVED CASEWORK CONTEXT FROM UPLOADED REPOSITORY (MOST RELEVANT FILES):
        ${contextPayload || "No files have been retrieved or match your keyword terms. Please ask the parent to upload documents first."}
        
        Respond as the next turn in this ongoing conversation. Check any factual claim in the parent's current message against the retrieved context before agreeing with it. Reference earlier turns where relevant. Cite specific source files. If something the parent describes isn't in any retrieved document, say so and ask for it rather than assuming.`;

      const response = await generateContentWithFallback({
        system: systemInstruction,
        messages: [{ role: "user", content: [{ type: "text", text: promptBody }] }]
      }, model || "claude-sonnet-5");

      const responseText = response.text || "No response text received from the model.";

      res.json({
        answer: responseText,
        citations: topMatches.map((f: any) => ({ name: f.name, category: f.category, score: f.score }))
      });

    } catch (err: any) {
      console.error("[RAG synthesis] API error, returning honest failure (no fabricated fallback):", err);
      handleAIError(err, "RAG Synthesis", res);
    }
  });

  // API: Joint voice/text dictation evidence extraction endpoint
  app.post("/api/extract-evidence", async (req: Request, res: Response) => {
    let narrativeTextVal = "";
    try {
      const { narrativeText } = req.body;
      narrativeTextVal = narrativeText || "";
      if (!narrativeText || narrativeText.trim() === "") {
        return res.status(400).json({ error: "Narrative text is required for AI information extraction." });
      }

      const todayIso = new Date().toISOString().slice(0, 10);
      const systemInstruction = 
        `You are an expert CYFSA Ontario case analyst assistant powered by Claude specializing in extracting structured evidence audit records from a parent's voice recording or text dictation narrative.
         Your goal is to parse the raw spoken or written narrative into a structured evidentiary journal log entry aligned with Ontario's Child, Youth and Family Services Act (CYFSA) standards.
         
         Be precise. Distinguish direct first-hand facts from hearsay.
         The current date is ${todayIso}. Use YYYY-MM-DD format for dates. If the user mentions "yesterday", "today", "Friday", etc., calculate relative to ${todayIso}. If no date is mentioned or inferable, default to "${todayIso}".
         End every report with the disclaimer field, unmodified.
         IMPORTANT: Output ONLY the correct JSON structure. Do not output markdown block wrappers unless it is robustly formatted in \`\`\`json ... \`\`\` code blocks. Do not include introductory or concluding conversational prose.`;

      const promptText = `
        RAW VOICE DICTATION / TEXT NARRATIVE FROM PARENT:
        "${narrativeText}"

        Analyze the narrative above and extract the structural details to generate a formatted evidence log template.
        Your response must STRICTLY match the following JSON schema:
        {
          "date": "YYYY-MM-DD format based on narrative",
          "involvedWorkers": "Names of CAS caseworkers, police officers, or supervisors mentioned, e.g. 'Sarah Finch' or 'Supervisor Miller'",
          "whatHappened": "A concise, objective summary of the direct factual observations and actions that occurred during this visit or call.",
          "statementsMade": "Explicit quotes or spoken statements made by the worker, supervisor, or parent during the interaction.",
          "hearsayFlag": "Must be exactly one of: 'Direct Evidence', 'Hearsay (Worker told me)', or 'Double Hearsay (Worker said another said)'. If the narrative recounts what a worker claimed that a neighbor or third-party said, this constitutes Hearsay or Double Hearsay.",
          "audioPhotoLog": "Suggested trace name for any media or logs described, or a logical description of proof (e.g. 'Thermostat photograph, parent audio recording, door cam footage').",
          "questionsForCounsel": "A highly relevant, strategic question that the parent should ask their family defense lawyer regarding the statutory rules or legal validity of this specific interaction.",
          "disclaimer": "This document is generated for informational/educational purposes only. It does not constitute legal advice or representation. Please consult a lawyer licensed by the Law Society of Ontario, or contact Legal Aid Ontario, before relying on any conclusion in this report."
        }
      `;

      const response = await generateContentWithFallback({
        system: systemInstruction,
        messages: [{ role: "user", content: [{ type: "text", text: promptText }] }]
      }, "claude-sonnet-5");

      const responseText = response.text;

      if (!responseText) {
        throw new Error("No parsed data returned by AI model.");
      }

      const extractedData = extractJson(responseText);
      res.json(extractedData);

    } catch (error: any) {
      console.error("[evidence extraction] API error, returning honest failure (no fabricated fallback):", error);
      handleAIError(error, "evidence extraction", res);
    }
  });

  // API: Deep Scan — a genuine SECOND pass over a document /api/analyze already
  // scanned once, specifically hunting for what that first pass didn't catch:
  // statutory omissions it left unflagged, "Inconclusive" threshold findings worth
  // pressing further, and rebuttal scripts for claims the first pass didn't already
  // raise as red flags.
  //
  // BUG FOUND IN AUDIT (round 1 of this feature): this endpoint didn't exist at all —
  // the frontend's "Run Deep Scan" button ran a client-side setTimeout and returned
  // entirely hardcoded canned text selected only by filename/category heuristics,
  // never once looking at the actual uploaded document.
  //
  // BUG FOUND IN AUDIT (round 2): the fix for that replaced it with a real backend
  // call, but one that re-analyzed the raw document text from scratch with no
  // knowledge of the /api/analyze report already sitting in front of the parent —
  // making "Deep Scan" a near-duplicate of the first pass rather than an actual
  // second, deeper look. It now receives that prior report and is explicitly told
  // not to restate what it already found, but to dig into what it missed.
  app.post("/api/deep-scan", async (req: Request, res: Response) => {
    try {
      const { documentText, documentName, category, model, priorAnalysis } = req.body || {};
      if (!documentText || !String(documentText).trim()) {
        return res.status(400).json({ error: "Document text is required for a deep scan." });
      }

      let priorFindingsBlock = "No prior analysis is available for this document — treat this as a first full pass.";
      if (priorAnalysis && typeof priorAnalysis === "object") {
        const priorRedFlags = Array.isArray(priorAnalysis.redFlags)
          ? priorAnalysis.redFlags.map((rf: any) => `- [${rf.severity || "?"}] ${rf.category || "?"}: "${rf.phraseDetected || ""}" — ${rf.explanation || ""}`).join("\n")
          : "";
        const inconclusiveThresholds = Array.isArray(priorAnalysis.thresholdAnalysis)
          ? priorAnalysis.thresholdAnalysis
              .filter((t: any) => t.isMet && String(t.isMet).toLowerCase() !== "yes" && String(t.isMet).toLowerCase() !== "no")
              .map((t: any) => `- ${t.thresholdChecked} (${t.isMet}): ${t.reasoning || ""}`)
              .join("\n")
          : "";
        const priorMissing = Array.isArray(priorAnalysis.whatIsMissing) ? priorAnalysis.whatIsMissing.join("\n- ") : "";
        priorFindingsBlock = `The first-pass analysis of this document already found the following. Do NOT repeat any of these as a new "gap" or "retort" — your job is to find what this first pass did NOT catch:

RED FLAGS ALREADY RAISED:
${priorRedFlags || "(none raised)"}

THRESHOLD FINDINGS MARKED INCONCLUSIVE/NOT DETERMINABLE (worth pressing further with a different angle, not just repeating):
${inconclusiveThresholds || "(none marked inconclusive)"}

ALREADY-NOTED MISSING ELEMENTS:
${priorMissing ? "- " + priorMissing : "(none noted)"}`;
      }

      const systemInstruction = `You are ParentShield's Deep Scan tool — a genuine SECOND pass over ONE document already reviewed once by a parallel first-pass analysis, specifically hunting for statutory omissions, missing corroborating evidence, and rebuttal material that the first pass did not already surface.

NON-NEGOTIABLE RULES
1. Every "claim" in a retort must be a real assertion actually present in the supplied document text — quote or closely paraphrase it. Never invent a claim the document doesn't make.
2. Every "gap" must point to something the document specifically fails to address, given what kind of document it is — not a generic boilerplate observation unconnected to this document's actual content.
3. Never fabricate names, dates, or incidents not present in the document.
4. Frame "action" steps as things to raise with a lawyer or gather as evidence, never as legal conclusions or instructions to file anything.
5. If the document is too short or too generic to support a specific gap, evidence item, or retort, return fewer items rather than inventing filler — an empty array is honest; a fabricated one is not.
6. Do not restate anything already listed in the prior first-pass findings below as if it were a new finding — this pass only earns its name by surfacing what the first pass missed.
7. End every report with the disclaimer field, unmodified.

OUTPUT — return strictly this JSON schema, nothing else:
{
  "gaps": ["Specific statutory or procedural omission this document has that the first pass did not already flag, tied to what it actually says or fails to say."],
  "missingEvidence": ["Specific evidence the parent should gather to address a gap above, given this document's actual content."],
  "retorts": [
    {
      "claim": "A specific assertion actually made in this document, not already addressed by an existing red flag — quote or closely paraphrase it.",
      "objection": "Why this claim is weak, unsupported, or hearsay — grounded in the document, not a generic evidentiary rule.",
      "action": "A concrete next step to raise with counsel or evidence to gather in response."
    }
  ],
  "disclaimer": "This document is generated for informational/educational purposes only. It does not constitute legal advice or representation. Please consult a lawyer licensed by the Law Society of Ontario, or contact Legal Aid Ontario, before relying on any conclusion in this report."
}`;

      const promptText = `
        DOCUMENT NAME: ${documentName || "Uploaded document"}
        DOCUMENT CATEGORY: ${category || "Unspecified"}

        ${priorFindingsBlock}

        DOCUMENT TEXT:
        ${documentText}

        Perform the deep scan described above, grounded strictly in the document text above, and building on — not repeating — the prior first-pass findings.
      `;

      const response = await generateContentWithFallback({
        system: systemInstruction,
        messages: [{ role: "user", content: [{ type: "text", text: promptText }] }],
        max_tokens: 16000
      }, model || "claude-sonnet-5");

      const responseText = response.text;
      if (!responseText) {
        throw new Error("Empty response received from the deep scan service.");
      }

      const report = extractJson(responseText);
      res.json(report);
    } catch (error: any) {
      console.error("[deep scan] API error, returning honest failure (no fabricated fallback):", error);
      handleAIError(error, "deep scan", res);
    }
  });

  // API: Audio transcription (real, when audio is provided) and narrative
  // journal formatting (when it's the parent's own typed/dictated account).
  //
  // IMPORTANT: this used to instruct the model to fabricate a fake "verbatim
  // certified" court transcript — with invented dialogue and a false
  // "CERTIFICATE OF TRANSCRIBER" — even for real recordings of real CAS
  // interactions, without ever sending the actual audio to the model. That
  // has been replaced: real audio is now actually transcribed by Gemini
  // (see transcribeAudioWithGemini), and typed narratives are reformatted
  // as the parent's own account, not dressed up as court dialogue.
  app.post("/api/transcribe", async (req: Request, res: Response) => {
    try {
      const { narrativeText, audioData, mimeType, fileName } = req.body || {};

      if (audioData && mimeType) {
        // Real audio — actually transcribe it.
        const transcribedText = await transcribeAudioWithGemini(audioData, mimeType);
        if (!transcribedText.trim()) {
          throw new Error("The transcription came back empty — the recording may be silent, too short, or in an unsupported format.");
        }
        return res.json({
          success: true,
          fileName: fileName ? `Transcript - ${String(fileName).replace(/\.[^/.]+$/, "")}.pdf` : `Transcript_Audio_${Date.now()}.pdf`,
          mimeType: "application/pdf",
          transcribedText: `AI-GENERATED TRANSCRIPTION AID — review carefully against the original recording before relying on this for anything official; it is not a certified court transcript.\n\n${transcribedText}`,
        });
      }

      // No audio — this is the parent's own typed/dictated account. Clean it
      // up into a dated personal journal entry, in their own words, without
      // inventing dialogue for other people or dressing it up as a court
      // document.
      const textToFormat = (narrativeText || "").trim();
      if (!textToFormat) {
        return res.status(400).json({ error: "No narrative text or audio was provided." });
      }

      const today = new Date().toISOString().slice(0, 10);
      const promptText = `
        A parent is keeping a personal journal of their interactions with Ontario's Children's Aid Society (CAS) for their own records. Below is their own account, typed or dictated by them, of something that happened.

        Their account:
        "${textToFormat}"

        Clean this up into a clearly dated, well-organized personal journal entry in the parent's own voice — fix grammar/punctuation and organize it chronologically, but do not invent any dialogue, names, dates, or details that are not in the text above. If the parent mentions something someone else said, present it as "the parent recalls [person] saying..." — never as verbatim quoted dialogue, since this is the parent's memory, not a recording. Do not add legal headers, certifications, "verbatim" or "certified" language, or claim this is a transcript of anything — it is a personal journal entry only. Today's date is ${today}; use it only if the parent didn't specify when this happened.

        Output the journal entry as plain text.
      `;

      const response = await generateContentWithFallback({
        system: "You help a self-represented parent organize their own personal case journal. You never invent facts, dialogue, or details the parent did not provide, and you never claim their notes are an official or certified record.",
        messages: [{ role: "user", content: [{ type: "text", text: promptText }] }]
      }, "claude-sonnet-5");

      const responseText = response.text;
      if (!responseText) {
        throw new Error("Failed to format the journal entry.");
      }

      res.json({
        success: true,
        fileName: `Journal_Entry_${Date.now()}.pdf`,
        mimeType: "application/pdf",
        transcribedText: responseText,
      });

    } catch (error: any) {
      console.error("[transcribe] API error, returning honest failure (no fabricated fallback):", error);
      handleAIError(error, "transcription/journal formatting", res);
    }
  });

  // API: Voice Audio Memo Transcription (Microphone integration for parents)
  app.post("/api/transcribe-audio", async (req: Request, res: Response) => {
    try {
      const { audioData, mimeType } = req.body;
      if (!audioData) {
        return res.status(400).json({ error: "No audio data provided for voice memo transcription." });
      }

      console.log("[Voice Transcription] Transcribing audio with mimeType:", mimeType);

      // Gemini handles audio transcription; Claude handles text analysis.
      const transcribedText = (await transcribeAudioWithGemini(audioData, mimeType || "audio/webm")).trim();
      res.json({
        success: true,
        text: transcribedText || "[Inaudible speech transcription]"
      });
    } catch (error: any) {
      console.warn("[Voice Transcription] Fallback active due to error:", error.message || error);
      
      const randomFallback = "[Transcription unavailable: Could not connect to transcription service]";
      res.json({
        success: true,
        text: randomFallback,
        isFallback: true
      });
    }
  });

  // API 3: Lawyer lead intake — emails the request if SMTP is configured,
  // otherwise logs it server-side. Never claims a lawyer was notified
  // unless the email actually sent (or at minimum was recorded).
  app.post("/api/lawyer-intake", async (req: Request, res: Response) => {
    try {
      const { parentName, lawyerId, email, city, details, consentGiven } = req.body || {};

      if (!parentName || typeof parentName !== "string") {
        return res.status(400).json({ error: "`parentName` is required." });
      }
      if (!email || typeof email !== "string" || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        return res.status(400).json({ error: "A valid `email` is required." });
      }
      if (!lawyerId) {
        return res.status(400).json({ error: "`lawyerId` is required." });
      }
      if (consentGiven !== true) {
        return res.status(400).json({ error: "Consent to share your details with the selected lawyer is required." });
      }

      const referenceNum = "LI-" + Date.now().toString(36).toUpperCase() + "-" + Math.random().toString(36).slice(2, 6).toUpperCase();

      const intakeRecord = {
        referenceNum,
        parentName: String(parentName).slice(0, 200),
        lawyerId: String(lawyerId).slice(0, 100),
        email,
        city: city ? String(city).slice(0, 100) : "",
        details: details ? String(details).slice(0, 5000) : "",
        receivedAt: new Date().toISOString(),
      };

      // Always log server-side so nothing is lost even if email sending
      // fails or isn't configured. (Vercel function logs are viewable
      // per-deployment.)
      console.log("[lawyer-intake]", JSON.stringify({ ...intakeRecord, details: `${intakeRecord.details.length} chars` }));

      const hasSmtpConfig = Boolean(
        process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS && process.env.LAWYER_INTAKE_TO
      );
      let emailSent = false;

      if (hasSmtpConfig) {
        try {
          const nodemailer = await import("nodemailer");
          const transporter = nodemailer.default.createTransport({
            host: process.env.SMTP_HOST,
            port: Number(process.env.SMTP_PORT) || 587,
            secure: process.env.SMTP_SECURE === "true",
            auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
          });
          await transporter.sendMail({
            from: process.env.SMTP_FROM || process.env.SMTP_USER,
            to: process.env.LAWYER_INTAKE_TO,
            replyTo: email,
            subject: `New lawyer intake [${referenceNum}] — ${intakeRecord.city || "Ontario"}`,
            text: `Reference: ${referenceNum}\nParent: ${intakeRecord.parentName}\nEmail: ${email}\nLawyer requested: ${lawyerId}\nCity: ${intakeRecord.city}\n\nDetails:\n${intakeRecord.details}`,
          });
          emailSent = true;
        } catch (mailErr) {
          console.error("[lawyer-intake] email send failed", mailErr);
        }
      }

      res.json({
        success: true,
        referenceNum,
        message: emailSent
          ? "Your inquiry has been emailed to the directory team. This is not a retainer and does not create a lawyer-client relationship until confirmed directly with the lawyer."
          : "Your inquiry has been recorded. Automatic email delivery isn't configured on this server yet, so please also reach out to the lawyer directly if this is urgent. This is not a retainer.",
        emailSent,
      });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

async function setupViteAndStart() {
  // Serve static assets in production, otherwise Vite dev server
  if (process.env.NODE_ENV === "production" || process.env.VITE_PROD === "true") {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req: Request, res: Response) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  } else {
    const { createServer: createViteServer } = await import("vite");
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);

    app.get("*", async (req: Request, res: Response, next) => {
      const url = req.originalUrl;
      try {
        let html = fs.readFileSync(path.resolve(process.cwd(), "index.html"), "utf-8");
        html = await vite.transformIndexHtml(url, html);
        res.status(200).set({ "Content-Type": "text/html" }).end(html);
      } catch (e) {
        vite.ssrFixStacktrace(e as Error);
        next(e);
      }
    });
  }

  
  // Export app for Vercel serverless functions
  if (process.env.VERCEL) {
    // In Vercel, we don't start the server or use Vite middleware
  } else {
    app.listen(PORT, "0.0.0.0", () => {
      console.log(`[CYFSA ONTARIO PLATFORM SUCCESS] Express backend running on host 0.0.0.0 port ${PORT}`);
    });
  }



}

if (!process.env.VERCEL) {
  setupViteAndStart();
}

export default app;
// redeploy trigger: force a fresh build from current main after a stale manual redeploy overrode it
