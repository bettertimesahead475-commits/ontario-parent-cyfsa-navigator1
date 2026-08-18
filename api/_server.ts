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
    const modelsToTry = ["gemini-2.5-flash", "gemini-3.1-pro-preview"];
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
  const modelsToTry = ["gemini-2.5-flash", "gemini-3.1-pro-preview"];
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
const CLAUDE_MODELS = new Set(["claude-sonnet-4-20250514", "claude-3-5-sonnet-20241022"]);

async function generateContentWithFallback(
  params: {
    system?: string;
    messages: any[];
    max_tokens?: number;
    temperature?: number;
  },
  primaryModel: string = "claude-sonnet-4-20250514"
): Promise<{ text: string }> {
  const client = getAnthropicClient();
  const model = CLAUDE_MODELS.has(primaryModel) ? primaryModel : "claude-sonnet-4-20250514";
  const messages = params.messages.map((message: any) => ({
    role: message.role === "assistant" ? "assistant" : "user",
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
    max_tokens: params.max_tokens || 4000,
    system: params.system,
    temperature: params.temperature ?? 0.2,
    messages,
  });
  return {
    text: response.content
      .filter((block) => block.type === "text")
      .map((block) => block.text)
      .join(""),
  };
}

// Helper to extract JSON from any block resiliently
function extractJson(text: string): any {
  try {
    return JSON.parse(text.trim());
  } catch (e) {
    const match = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
    if (match) {
      return JSON.parse(match[1].trim());
    }
    const startIndex = text.indexOf('{');
    const endIndex = text.lastIndexOf('}');
    if (startIndex !== -1 && endIndex !== -1) {
      const putativeJson = text.substring(startIndex, endIndex + 1);
      return JSON.parse(putativeJson.trim());
    }
    throw e;
  }
}

// Unified AI error handling and user-friendly formatting with HTTP status codes
function handleAIError(error: any, contextDescription: string, res: Response) {
  console.error(`[AI Error] during ${contextDescription}:`, error);
  const errMsg = (error?.message || "").toLowerCase();
  const status = (error as any)?.status;
  
  const isRateLimit = 
    status === 429 || 
    errMsg.includes("429") || 
    errMsg.includes("quota") || 
    errMsg.includes("rate limit") ||
    errMsg.includes("overloaded") ||
    errMsg.includes("exhausted");

  if (isRateLimit) {
    return res.status(429).json({
      error: "AI provider quota or rate limit exceeded (429). Please wait and try again.",
      isRateLimit: true
    });
  }

  if (errMsg.includes("api key") || errMsg.includes("invalid key") || status === 403 || status === 401) {
    return res.status(status || 400).json({
      error: "AI provider authentication failed. Check the configured API key in Vercel project environment variables."
    });
  }

  res.status(status || 500).json({
    error: error?.message || `An unexpected error occurred during ${contextDescription}.`
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

  app.post("/api/search-connectors", async (req: Request, res: Response) => {
    try {
      const { query } = req.body;
      const ai = getGeminiClient();
      const response = await generateGeminiContentWithRetry(ai, ["gemini-2.5-flash"], {
        contents: [{ role: "user", parts: [{ text: `Search and explain the following legal concept for a family law context (CYFSA): ${query}` }] }],
        config: {
          systemInstruction: "You are a helpful legal assistant for the Ontario Children's Aid Society related matters (CYFSA/CLRA). Your goal is to explain concepts clearly, citing relevant statutes where appropriate, and offering actionable advice.",
        }
      });
      res.json({ response: response.text });
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

      const contents: any[] = [];
      if (targetText && targetText.trim()) {
        contents.push({
          type: "text",
          text: `DOCUMENT TEXT CONTENT:\n${targetText}`
        });
      }

      const systemInstruction = `You are ParentShield's Evidence Strength Audit tool. You analyze legal documents (affidavits, motion records, CAS correspondence) submitted by self-represented parents in Ontario child protection proceedings under the CYFSA. Your job is to help the parent and their lawyer identify weaknesses, procedural issues, and points worth raising — NOT to issue legal conclusions.

CORE RULES (non-negotiable)
1. Every flag requires three things, all present or the flag is not shown:
- Document quote: the exact phrase from the uploaded document, with page/paragraph locator.
- Statute citation: the specific CYFSA section, ONLY if verified (see Rule 2).
- Match explanation: one sentence connecting the specific document language to the specific statutory requirement — not a general summary of the section.

2. Statute verification is mandatory before displaying any citation.
- First check the section against the built-in Confirmed Statute Reference (loaded separately — see CYFSA-Statute-Reference.md).
- If the section is in the Confirmed list, cite it and quote its actual text.
- If the section is NOT in the Confirmed list, attempt a live web search against canlii.org or ontario.ca/laws for that section number before citing it.
- If you cannot verify the section's actual text through either method, DO NOT display a section number. Instead show: "⚠️ Statute citation unverified — confirm exact section with counsel before relying on this."
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

      const promptText = `
        DOCUMENT CONTENT TO ANALYZE:
        Please perform a granular educational review, assessing CAS thresholds, evidentiary weights, and timelines.
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
          ],
          "thresholdAnalysis": [
            {
              "thresholdChecked": "CYFSA s. 81 — Application / Child Protection Proceeding Authority",
              "isMet": "Yes / No / Inconclusive",
              "reasoning": "Analyze the role of CYFSA s. 81 in the proceeding. Do not characterize s. 81 itself as an "imminent danger" threshold. Distinguish the statutory authority for commencing proceedings from the separate statutory grounds and tests applicable to whether a child is in need of protection or may be apprehended.",
              "primarySourceLaw": "CYFSA 2017, Section 81(1)"
            },
            {
              "thresholdChecked": "Child in Need of Protection grounds (CYFSA s. 74)",
              "isMet": "Yes / No / Inconclusive",
              "reasoning": "Check whether any of the 16 grounds defined under s. 74 of the CYFSA are asserted in the file. Evaluate whether assertion stands on uncorroborated hearsay or objective proof.",
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
              "primarySourceLaw": "CYFSA 2017, Section 70"
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
              "timelineRule": "5-Day Post-Apprehension Court Hearing Rule (CYFSA s. 94(5))",
              "documentAssertion": "E.g. dates of removal or court schedules.",
              "evaluation": "Evaluate if the child was taken without a warrant and scheduling is compliant with the 5-court-day rule of s. 94(5). If child is safe at home, note standard home care safety.",
              "citation": "CYFSA, S.O. 2017, c. 14, s. 94",
              "locationInDocument": "Page X, Paragraph Y, or state 'Not applicable - child in home care'",
              "parentActionStep": "Verify immediate court scheduling if a sudden take occurs. Keep court liaison logs."
            },
            {
              "timelineRule": "Child Ombudsman Access & Continuous Care Rights (SCFA 2024 / Bill 33 2025)",
              "documentAssertion": "E.g. references to child consultation, Ombudsman access, or CAS contact rules.",
              "evaluation": "Evaluate if the child's rights under the Supporting Children's Futures Act, 2024, to reach the Ombudsman, or the duty for frequent in-care visitation are met. Focus on rights access.",
              "citation": "Supporting Children's Futures Act, 2024",
              "locationInDocument": "Page X, Paragraph Y, or 'Checked & Advised'",
              "parentActionStep": "Confirm child is aware they can contact the Ontario Ombudsman regarding CAS placements."
            },
            {
              "timelineRule": "300-Day Presumption of Parentage (CLRA s. 8(1))",
              "documentAssertion": "E.g. marriage status, cohabitant records, or parent naming details.",
              "evaluation": "Check for adherence to CLRA s. 8(1) presumptions of parentage for separations within 300 days of birth. Flag if active spousal roles are omitted by CAS.",
              "citation": "Children's Law Reform Act, s. 8(1)",
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

      contents.push({
        type: "text",
        text: promptText
      });

      const response = await generateContentWithFallback({
        system: systemInstruction,
        messages: [{ role: "user", content: contents }]
      }, model || "claude-sonnet-4-20250514");

      const responseText = response.text;

      if (!responseText) {
        throw new Error("Empty response received from the analysis service.");
      }

      const report = extractJson(responseText);
      res.json(report);

    } catch (error: any) {
      // Do NOT fabricate a fake analysis on failure — a parent could mistake
      // invented names/dates for a real reading of their own document.
      console.error("[document analysis] API error, returning honest failure (no fabricated fallback):", error);
      handleAIError(error, "document analysis", res);
    }
  });

  // API: Retrieval-Augmented Generation (RAG) Query Pipeline
  app.post("/api/rag-query", async (req: Request, res: Response) => {
    let queryVal = "";
    let filesVal: any[] = [];
    let focusVal = "";
    try {
      const { query, files, model, focus } = req.body;
      queryVal = query || "";
      filesVal = files || [];
      focusVal = focus || "";
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
- FIVE-DAY HEARING RULE: Apply the CYFSA s. 94(5) five-court-day analysis only when the evidence establishes or reasonably indicates an actual apprehension falling within the statutory provision. An informal access restriction alone is insufficient to conclude that s. 94(5) was triggered.
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
        `You are the expert CYFSA Ontario RAG Document Assistant powered by Claude.
         Your job is to answer the parent's query regarding their child welfare case by utilizing solely the provided documents context.
         You must strictly ground your feedback based on the documents. Always cite your source files explicitly in your paragraphs using bold bracket indicators, e.g., **[Source: CAS_Worker_Report_Sample.txt]**.
         If the files do not offer an answer, state that "The uploaded case files do not contain information regarding this request," and offer specific categories of documents (such as intake records or hospital dentist files) that would help verify it.
         
         You MUST cite specific legal standards of the CYFSA (s.74 protection grounds, s.94 hearing and adjournment requirements, and the proper statutory role of s.81, and Children's Law Reform Act s.8 parentage presumptions) when applicable to ground your assessment conceptually.
         
         CRITICAL ACCESSIBLE LINK REQUIREMENT:
         Whenever you refer to or cite standard legal rules, section numbers, or laws, you MUST use the exact keyword forms (such as 's. 74', 's. 94', 's. 81', 's. 125', 's. 3', 's. 101', 's. 87', 'CLRA', 'Evidence Act', or 'Charter of Rights') so that our database matches them instantly to fully accessible, real live government e-Laws URL links! Ensure you write them exactly so families can click on them (e.g., 'This invokes s. 81 of the CYFSA' or 'as defined under CLRA').
         
         ${focusGuideline}`;

      const promptBody = `
        PARENT CAS DATA ENQUIRY: "${query}"
        
        RETRIEVED CASEWORK CONTEXT FROM UPLOADED REPOSITORY (MOST RELEVANT FILES):
        ${contextPayload || "No files have been retrieved or match your keyword terms. Please ask the parent to upload documents first."}
        
        Please synthesize a detailed educational response summarizing findings, explaining violations or safety notes, citing specific source files, and outlining next steps.`;

      const response = await generateContentWithFallback({
        system: systemInstruction,
        messages: [{ role: "user", content: [{ type: "text", text: promptBody }] }],
        temperature: 0.2
      }, model || "claude-sonnet-4-20250514");

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
          "questionsForCounsel": "A highly relevant, strategic question that the parent should ask their family defense lawyer regarding the statutory rules or legal validity of this specific interaction."
        }
      `;

      const response = await generateContentWithFallback({
        system: systemInstruction,
        messages: [{ role: "user", content: [{ type: "text", text: promptText }] }],
        temperature: 0.1
      }, "claude-sonnet-4-20250514");

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
        messages: [{ role: "user", content: [{ type: "text", text: promptText }] }],
        temperature: 0.2,
      }, "claude-sonnet-4-20250514");

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
