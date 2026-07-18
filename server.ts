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
import { createHash } from "crypto";
import Anthropic from "@anthropic-ai/sdk";
import { createClient } from "@supabase/supabase-js";

dotenv.config();

let anthropicClient: Anthropic | null = null;
let isAnthropicKeyVerifiedInvalid = false;

// Helper to get Anthropic Claude client
function getAnthropicClient(): Anthropic {
  if (anthropicClient) return anthropicClient;

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey || !apiKey.trim()) {
    throw new Error("ANTHROPIC_API_KEY environment variable is not configured.");
  }

  anthropicClient = new Anthropic({
    apiKey: apiKey,
  });

  return anthropicClient;
}

let supabaseClient: any = null;

function getSupabaseClient(): any {
  if (supabaseClient) return supabaseClient;
  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseServiceKey = process.env.SUPABASE_SERVICE_KEY;
  if (!supabaseUrl || !supabaseServiceKey) {
    throw new Error("Supabase is not configured. Please configure SUPABASE_URL and SUPABASE_SERVICE_KEY environment variables.");
  }
  supabaseClient = createClient(supabaseUrl, supabaseServiceKey);
  return supabaseClient;
}

async function extractPdfTextLocally(base64Data: string): Promise<string> {
  const cleanedBase64 = base64Data.includes(",") ? base64Data.split(",")[1] : base64Data;
  const { PDFParse } = await import("pdf-parse");
  const parser = new PDFParse({ data: Buffer.from(cleanedBase64, "base64") });

  try {
    const result = await parser.getText();
    return result.text || "";
  } finally {
    await parser.destroy();
  }
}

async function extractTextWithClaudeBase64(base64Data: string, mimeType: string): Promise<string> {
  // Simple validation to ensure base64Data is likely valid base64
  const cleanedBase64 = base64Data.trim();
  if (cleanedBase64.length === 0 || /[^A-Za-z0-9+/=\s]/.test(cleanedBase64)) {
    console.error("extractTextWithClaudeBase64 error: Invalid base64 data detected");
    throw new Error("Invalid base64 data format");
  }

  const extractionCacheKey = hashAnalyzerInput(JSON.stringify({
    version: ANALYZER_CACHE_VERSION,
    type: "ocr",
    mimeType,
    sourceHash: hashAnalyzerInput(cleanedBase64)
  }));
  const cachedExtraction = getCachedValue(analyzerExtractionCache, extractionCacheKey);
  if (cachedExtraction !== null) {
    console.log("[Analyzer Cost Control] Reusing cached OCR extraction.");
    return cachedExtraction;
  }

  try {
    const ai = getAnthropicClient();
    const sourceBlock = mimeType === "application/pdf"
      ? {
          type: "document",
          source: {
            type: "base64",
            media_type: "application/pdf",
            data: cleanedBase64
          }
        }
      : {
          type: "image",
          source: {
            type: "base64",
            media_type: mimeType,
            data: cleanedBase64
          }
        };

    const response = await generateClaudeContentWithRetry(ai, {
      messages: [{
        role: "user",
        content: [
          sourceBlock,
          { type: "text", text: "Extract the complete text of this document, preserving page numbers, headers, paragraph numbers, exhibit labels, and paragraph breaks as closely as possible. Output only text that is visible in the provided document. Do not summarize and do not invent missing text." }
        ]
      }],
      max_tokens: 8000,
      temperature: 0
    }, ANALYZER_FAST_MODEL);

    const extractedText = response.content?.[0]?.text || "";
    setCachedValue(analyzerExtractionCache, extractionCacheKey, extractedText);
    return extractedText;
  } catch (error) {
    console.error("extractTextWithClaudeBase64 error:", error);
    throw error;
  }
}

// Unified content generator using Anthropic only. Never falls back to synthetic output.
async function generateContentWithFallback(
  params: {
    system?: string;
    messages: any[];
    max_tokens?: number;
    temperature?: number;
  },
  primaryClaudeModel: string = "claude-3-5-sonnet-20241022"
): Promise<{ text: string }> {
  if (!primaryClaudeModel.startsWith("claude-")) {
    throw new Error("Analyzer requires an Anthropic Claude model. Non-Anthropic and synthetic fallbacks are disabled.");
  }

  if (isAnthropicKeyVerifiedInvalid) {
    throw new Error("ANTHROPIC_API_KEY was rejected by Anthropic and must be replaced before analysis can run.");
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey || !apiKey.trim() || !apiKey.startsWith("sk-ant-")) {
    throw new Error("ANTHROPIC_API_KEY environment variable is required. Synthetic fallback analysis is disabled.");
  }

  try {
    const ai = getAnthropicClient();
    const response = await generateClaudeContentWithRetry(ai, params, primaryClaudeModel);
    const text = response.content?.[0]?.text;
    if (!text) {
      throw new Error("Anthropic returned no text content.");
    }
    return { text };
  } catch (error: any) {
    const status = error?.status;
    const errMsg = (error?.message || "").toLowerCase();
    if (status === 401 || errMsg.includes("authentication_error") || errMsg.includes("invalid x-api-key") || errMsg.includes("invalid api key")) {
      isAnthropicKeyVerifiedInvalid = true;
    }
    throw error;
  }
}

// Robust wrapper with transient error retry (exponential backoff) and model fallback for Claude
async function generateClaudeContentWithRetry(
  ai: Anthropic,
  params: {
    system?: string;
    messages: any[];
    max_tokens?: number;
    temperature?: number;
  },
  primaryModel: string = "claude-3-5-sonnet-20241022"
): Promise<any> {
  const modelsToTry = [primaryModel, "claude-3-5-sonnet-latest", "claude-3-5-haiku-20241022", "claude-3-5-haiku-latest"];
  let lastError: any = null;

  for (const modelName of modelsToTry) {
    let attempts = 0;
    const maxAttempts = 3;
    let delay = 1000; // start with 1 second delay

    while (attempts < maxAttempts) {
      try {
        console.log(`[Claude API] Calling messages.create with model ${modelName} (Attempt ${attempts + 1}/${maxAttempts})`);
        const response = await ai.messages.create({
          model: modelName,
          system: params.system,
          messages: params.messages,
          max_tokens: params.max_tokens || 4000,
          temperature: params.temperature ?? 0.1,
        }, {
          headers: {
            "anthropic-beta": "pdfs-2024-09-25"
          }
        });
        return response;
      } catch (error: any) {
        lastError = error;
        const errMsg = (error?.message || "").toLowerCase();
        const status = (error as any)?.status;
        
        const isAuthError = status === 401 || errMsg.includes("authentication_error") || errMsg.includes("invalid x-api-key") || errMsg.includes("invalid api key");
        
        if (isAuthError) {
          console.log(`[AI Engine] Claude API key is unauthorized or inactive (401).`);
        } else {
          console.log(`[AI Engine] Claude attempt with ${modelName} did not succeed:`, error?.message || error);
        }

        const isTransient =
          status === 429 ||
          status === 503 ||
          status === 500 ||
          errMsg.includes("503") ||
          errMsg.includes("429") ||
          errMsg.includes("quota") ||
          errMsg.includes("rate limit") ||
          errMsg.includes("unavailable") ||
          errMsg.includes("overloaded") ||
          errMsg.includes("high demand") ||
          errMsg.includes("temporary") || errMsg.includes("fetch failed") || errMsg.includes("timeout") || errMsg.includes("network");

        if (!isTransient) {
          // Bad API key, invalid payload, etc. - throw immediately
          throw error;
        }

        attempts++;
        if (attempts < maxAttempts) {
          console.log(`[Claude API] Retrying in ${delay}ms...`);
          await new Promise((resolve) => setTimeout(resolve, delay));
          delay *= 2; // exponential backoff
        }
      }
    }
  }

  throw lastError;
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

const ANALYZER_DEBUG_LOGS = process.env.ANALYZER_DEBUG_LOGS === "true";

const ANALYZER_CACHE_VERSION = "analyzer-cost-v1";
const ANALYZER_FAST_MODEL = process.env.ANALYZER_FAST_MODEL || "claude-3-5-haiku-20241022";
const ANALYZER_DEEP_MODEL = process.env.ANALYZER_DEEP_MODEL || "claude-3-5-sonnet-20241022";
const ANALYZER_CACHE_TTL_MS = Number(process.env.ANALYZER_CACHE_TTL_MS || 6 * 60 * 60 * 1000);
const ANALYZER_CACHE_MAX_ENTRIES = Number(process.env.ANALYZER_CACHE_MAX_ENTRIES || 200);
const COST_CONTROLLED_MODELS = new Set([
  "claude-3-5-haiku-20241022",
  "claude-3-5-haiku-latest"
]);

type AnalyzerMode = "fast" | "deep";
type CacheEntry<T> = { value: T; expiresAt: number };

const analyzerResponseCache = new Map<string, CacheEntry<any>>();
const analyzerExtractionCache = new Map<string, CacheEntry<string>>();

function hashAnalyzerInput(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function getCachedValue<T>(cache: Map<string, CacheEntry<T>>, key: string): T | null {
  const cached = cache.get(key);
  if (!cached) return null;
  if (cached.expiresAt <= Date.now()) {
    cache.delete(key);
    return null;
  }
  return cached.value;
}

function setCachedValue<T>(cache: Map<string, CacheEntry<T>>, key: string, value: T) {
  cache.set(key, { value, expiresAt: Date.now() + ANALYZER_CACHE_TTL_MS });
  while (cache.size > ANALYZER_CACHE_MAX_ENTRIES) {
    const oldestKey = cache.keys().next().value;
    if (!oldestKey) break;
    cache.delete(oldestKey);
  }
}

function normalizeAnalyzerMode(value: unknown): AnalyzerMode {
  return value === "deep" ? "deep" : "fast";
}

function selectAnalyzerModel(requestedModel: unknown, mode: AnalyzerMode): string {
  const requested = typeof requestedModel === "string" ? requestedModel.trim() : "";

  if (mode === "deep") {
    return requested.startsWith("claude-") ? requested : ANALYZER_DEEP_MODEL;
  }

  if (requested && COST_CONTROLLED_MODELS.has(requested)) {
    return requested;
  }

  return ANALYZER_FAST_MODEL;
}

function createAnalyzerCacheKey(args: {
  sourceHash: string;
  model: string;
  mode: AnalyzerMode;
}) {
  return hashAnalyzerInput(JSON.stringify({
    version: ANALYZER_CACHE_VERSION,
    sourceHash: args.sourceHash,
    model: args.model,
    mode: args.mode
  }));
}

function logAnalyzerTextSample(label: string, text: string) {
  if (!ANALYZER_DEBUG_LOGS) return;
  console.log(`[Analyzer Debug] ${label} length=${text.length}`);
  console.log(`[Analyzer Debug] ${label} first500=${JSON.stringify(text.slice(0, 500))}`);
  console.log(`[Analyzer Debug] ${label} last500=${JSON.stringify(text.slice(-500))}`);
}

function normalizeForQuoteMatch(value: string): string {
  return value.toLowerCase().replace(/[“”]/g, '"').replace(/[‘’]/g, "'").replace(/\s+/g, " ").trim();
}

function isPlaceholderQuote(value: string): boolean {
  const normalized = normalizeForQuoteMatch(value);
  return (
    normalized.length < 12 ||
    normalized.includes("not found in this document") ||
    normalized.includes("checked & compliant") ||
    normalized.includes("not applicable") ||
    normalized.includes("page x") ||
    normalized.startsWith("e.g.")
  );
}

function collectUnverifiedAnalyzerQuotes(report: any, sourceText: string): string[] {
  const normalizedSource = normalizeForQuoteMatch(sourceText);
  const failures: string[] = [];

  const checkValue = (path: string, value: unknown) => {
    if (typeof value !== "string" || isPlaceholderQuote(value)) return;
    if (!normalizedSource.includes(normalizeForQuoteMatch(value))) {
      failures.push(`${path}: ${value.slice(0, 160)}`);
    }
  };

  for (const [index, flag] of (Array.isArray(report?.redFlags) ? report.redFlags : []).entries()) {
    checkValue(`redFlags[${index}].phraseDetected`, flag?.phraseDetected);
  }

  return failures;
}

// Unified Claude error handling and user-friendly formatting with HTTP status codes
function handleClaudeError(error: any, contextDescription: string, res: Response) {
  console.error(`Claude Error during ${contextDescription}:`, error);
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
      error: `Claude API Quota/Rate Limit Exceeded (429): You have exceeded your active API rate limit or token quota. Please wait about 60 seconds before retrying.`,
      isRateLimit: true
    });
  }

  if (errMsg.includes("anthropic_api_key environment variable is required") || errMsg.includes("environment variable is not configured")) {
    return res.status(400).json({
      error: "ANTHROPIC_API_KEY is required before analysis can run. Synthetic analysis is disabled."
    });
  }

  if (errMsg.includes("api key") || errMsg.includes("invalid key") || status === 403 || status === 401) {
    return res.status(status || 400).json({
      error: `Claude API Authentication Error: Your ANTHROPIC_API_KEY appears to be invalid or deactivated. Please check your credentials in the settings panel.`
    });
  }

  res.status(status || 500).json({
    error: error?.message || `An unexpected error occurred during ${contextDescription}.`
  });
}

// Local synthetic analyzer fallbacks are intentionally disabled. All generated analysis must come from real user-provided input and Anthropic.


const app = express();

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
      if (!query || !String(query).trim()) {
        return res.status(400).json({ error: "Query is required." });
      }
      const response = await generateContentWithFallback({
        system: "You are a helpful legal assistant for Ontario child welfare matters (CYFSA/CLRA). Ground the answer in the user's provided query and do not invent facts.",
        messages: [{ role: "user", content: [{ type: "text", text: `Search and explain this legal concept for a family law context (CYFSA): ${query}` }] }],
        temperature: 0.1
      }, ANALYZER_FAST_MODEL);
      res.json({ response: response.text });
    } catch (error: any) {
      handleClaudeError(error, "connector search", res);
    }
  });

  // API 1b: Activate Access Code via Supabase
  app.post("/api/activate-code", async (req: Request, res: Response) => {
    try {
      const { code, email } = req.body;
      if (!code || !email) {
        return res.status(400).json({ error: "Code and email are required." });
      }

      const supabase = getSupabaseClient();
      const cleanCode = code.trim().toUpperCase();
      const cleanEmail = email.trim().toLowerCase();

      // Query the code row matching both code and email (or handle email validation)
      const { data: codeRow, error } = await supabase
        .from("access_codes")
        .select("*")
        .eq("code", cleanCode)
        .eq("email", cleanEmail)
        .single();

      if (error || !codeRow) {
        return res.status(404).json({ error: "Invalid code or email. Please confirm they match your Interac e-Transfer memo." });
      }

      if (codeRow.used_at) {
        return res.status(410).json({ error: "This access code has already been activated and cannot be reused." });
      }

      if (codeRow.expires_at && new Date(codeRow.expires_at) < new Date()) {
        return res.status(410).json({ error: "This access code has expired." });
      }

      // Single-use enforcement: update used_at to prevent future reuse
      const { error: updateError } = await supabase
        .from("access_codes")
        .update({ used_at: new Date().toISOString() })
        .eq("id", codeRow.id);

      if (updateError) {
        throw updateError;
      }

      // Map DB tier back to frontend tiers ("Pro" or "Premium")
      // tier in DB could be 'pro_advocate' or 'premium_attorney'
      let tier = "Basic";
      if (codeRow.tier === "pro_advocate" || codeRow.tier === "Pro") {
        tier = "Pro";
      } else if (codeRow.tier === "premium_attorney" || codeRow.tier === "Premium") {
        tier = "Premium";
      }

      res.json({ success: true, tier });
    } catch (err: any) {
      console.error("Activation error:", err);
      res.status(500).json({ error: err.message || "Activation failed. Please check if Supabase is properly configured." });
    }
  });

  // API 2: Analyze Document Endpoint (Educational advice based on CYFSA of Ontario)
  app.post("/api/analyze", async (req: Request, res: Response) => {
    let targetText = "";
    let fileDataObj: any = null;
    try {
      const { textContent, fileData, model, analysisMode } = req.body;
      fileDataObj = fileData;
      const analyzerMode = normalizeAnalyzerMode(analysisMode);
      const selectedAnalyzerModel = selectAnalyzerModel(model, analyzerMode);

      if (!textContent && !fileData) {
        return res.status(400).json({
          error: "Missing content. Please provide document text or upload a document."
        });
      }

      targetText = fileData ? "" : (textContent || "");
      let extractedText = "";
      let requiresExtractedText = false;

      if (fileData && fileData.base64) {
        let base64Data = fileData.base64;
        if (base64Data.includes(",")) {
          base64Data = base64Data.split(",")[1];
        }

        const mime = fileData.mimeType || "";
        requiresExtractedText = mime === "application/pdf" || mime.startsWith("image/");

        if (requiresExtractedText) {
          try {
            console.log(`[Analyzer Extraction] Extracting source text from ${mime} (${fileData.fileName || "uploaded file"})`);
            if (mime === "application/pdf") {
              extractedText = await extractPdfTextLocally(base64Data);
              logAnalyzerTextSample("localPdfText", extractedText);
            }

            if (extractedText.trim().length < 25) {
              extractedText = await extractTextWithClaudeBase64(base64Data, mime);
              logAnalyzerTextSample("ocrExtractedText", extractedText);
            }
          } catch (e: any) {
            console.error("[Analyzer Extraction] Text extraction failed", e);
            return res.status(422).json({
              error: "Unable to extract readable text from this document. The audit was not generated because it would not be grounded in the uploaded source file.",
              detail: e?.message || "Document text extraction failed."
            });
          }
        } else if (mime.startsWith("text/")) {
          try {
            const decodedText = Buffer.from(base64Data, "base64").toString("utf-8");
            extractedText = decodedText;
            logAnalyzerTextSample("decodedText", extractedText);
          } catch (e: any) {
            console.error("Base64 text decoding failed", e);
            return res.status(422).json({
              error: "Unable to decode the uploaded text file. The audit was not generated because it would not be grounded in the uploaded source file.",
              detail: e?.message || "Text decoding failed."
            });
          }
        }
      }

      if (extractedText) {
        targetText = extractedText;
      }

      if (requiresExtractedText && targetText.trim().length < 25) {
        return res.status(422).json({
          error: "Unable to extract enough readable text from this document. The audit was not generated because it would not be grounded in the uploaded source file."
        });
      }

      const sourceHash = hashAnalyzerInput(targetText.trim());
      const analyzerCacheKey = createAnalyzerCacheKey({
        sourceHash,
        model: selectedAnalyzerModel,
        mode: analyzerMode
      });
      const cachedReport = getCachedValue(analyzerResponseCache, analyzerCacheKey);
      if (cachedReport) {
        return res.json({
          ...cachedReport,
          analyzerMeta: {
            ...(cachedReport.analyzerMeta || {}),
            cacheHit: true,
            mode: analyzerMode,
            model: selectedAnalyzerModel,
            sourceHash
          }
        });
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

Only quote text that appears verbatim in the provided document. Never invent names, quotes, or facts not present in the source text. If the document does not contain a clear example of a category you're asked to assess, state 'not found in this document' rather than generating a plausible-sounding example.

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
          "completenessScore": 75, // integer 0-100 indicating evidentiary reliability or thoroughness
          "fileSummary": "A concise, 2-3 sentence executive summary of the document, its core purpose, and the key protection issues or legal risks it raises. Must include: This is a heuristic estimate of how well-substantiated the document's factual claims are, not a legal admissibility ruling. A low score means many claims require external verification, not that the document is inadmissible.",
          "redFlags": [
            {
               "id": "rf1",
               "severity": "CRITICAL", // "[CRITICAL]" (only if admitted), "[Worth Raising With Counsel]", or "[Affects Evidentiary Weight]"
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
              "thresholdChecked": "Immediate Danger & Imminent Harm (CYFSA s. 81)",
              "isMet": "Yes / No / Inconclusive",
              "reasoning": "Analyze if the document provides facts satisfying the standard of imminent risk of serious harm under CYFSA s. 81(1). If no apprehension is discussed, analyze how the home environment holds up against s. 81 risk standards.",
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
              "thresholdChecked": "Kinship-first consideration duty (CYFSA s. 70 & s. 2)",
              "isMet": "Yes / No / Inconclusive",
              "reasoning": "Analyze whether the document documents active exploration of indigenous or non-indigenous family kinship alternatives rather than foster interventions. Note if this crucial statutory consideration has been forgotten.",
              "primarySourceLaw": "CYFSA 2017, Section 70"
            }
          ],
          "proceduralTimelineViolations": [
            {
              "timelineRule": "30-Day Adjournment Limit (CYFSA s. 94(1))",
              "documentAssertion": "E.g. calendar gaps, schedule arrangements or dates mentioned.",
              "evaluation": "Analyze if the document indicates court processes are adjourned for more than 30 days without universal consent under Section 94(1). If none is mentioned, mark as 'Checked & Compliant'.",
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

      if (ANALYZER_DEBUG_LOGS) {
        console.log("[Analyzer Debug] finalPayload=" + JSON.stringify({
          system: systemInstruction,
          messages: [{ role: "user", content: contents }]
        }));
      }

      const response = await generateContentWithFallback({
        system: systemInstruction,
        messages: [{ role: "user", content: contents }],
        temperature: analyzerMode === "deep" ? 0.15 : 0.05
      }, selectedAnalyzerModel);

      const responseText = response.text;

      if (!responseText) {
        throw new Error("Empty response received from the analysis service.");
      }

      const report = extractJson(responseText);
      const unverifiedQuotes = collectUnverifiedAnalyzerQuotes(report, targetText);
      if (unverifiedQuotes.length > 0) {
        console.error("[Analyzer Grounding] Model returned unverified source quotes", unverifiedQuotes);
        return res.status(422).json({
          error: "The generated audit included quote text that could not be verified against the uploaded document, so it was not returned.",
          unverifiedQuotes
        });
      }

      const reportWithMeta = {
        ...report,
        analyzerMeta: {
          ...(report.analyzerMeta || {}),
          cacheHit: false,
          mode: analyzerMode,
          model: selectedAnalyzerModel,
          sourceHash
        }
      };
      setCachedValue(analyzerResponseCache, analyzerCacheKey, reportWithMeta);
      res.json(reportWithMeta);

    } catch (error: any) {
      console.error("[Analyzer] Document analysis failed", error);
      handleClaudeError(error, "document analysis", res);
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
        `--- START FILE CONTEXT: "${tabFile.name}" (Category: ${tabFile.category}) ---\n${tabFile.content || "Empty content"}\n--- END FILE CONTEXT: "${tabFile.name}" ---`
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
        Your response should look for strict procedural timelines, statutory thresholds (e.g., s.81 apprehension standard, s.94 burden of proof, s.74 protection needs), Charter of Rights compliance, and other legislative checklists to ensure parent rights are fully verified.`;
      }

      const systemInstruction = 
        `You are the expert CYFSA Ontario RAG Document Assistant powered by Claude.
         Your job is to answer the parent's query regarding their child welfare case by utilizing solely the provided documents context.
         You must strictly ground your feedback based on the documents. Always cite your source files explicitly in your paragraphs using bold bracket indicators, e.g., **[Source: CAS_Worker_Report_Sample.txt]**.
         If the files do not offer an answer, state that "The uploaded case files do not contain information regarding this request," and offer specific categories of documents (such as intake records or hospital dentist files) that would help verify it.
         
         You MUST cite specific legal standards of the CYFSA (s.74 protection grounds, s.94 burden of proof, s.81(1) imminent danger thresholds, and Children's Law Reform Act s.8 parentage presumptions) when applicable to ground your assessment conceptually.
         
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
      }, model || "claude-3-5-sonnet-20241022");

      const responseText = response.text || "No response text received from the model.";

      res.json({
        answer: responseText,
        citations: topMatches.map((f: any) => ({ name: f.name, category: f.category, score: f.score }))
      });

    } catch (err: any) {
      handleClaudeError(err, "RAG Synthesis", res);
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

      const systemInstruction = 
        `You are an expert CYFSA Ontario case analyst assistant powered by Claude specializing in extracting structured evidence audit records from a parent's voice recording or text dictation narrative.
         Your goal is to parse the raw spoken or written narrative into a structured evidentiary journal log entry aligned with Ontario's Child, Youth and Family Services Act (CYFSA) standards.
         
         Be precise. Distinguish direct first-hand facts from hearsay.
         The current date is June 6, 2026. Use YYYY-MM-DD format for dates. If the user mentions "yesterday", "today", "Friday", etc., calculate relative to June 6, 2026. If no date is mentioned or inferable, default to "2026-06-06".
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
      }, "claude-3-5-sonnet-20241022");

      const responseText = response.text;

      if (!responseText) {
        throw new Error("No parsed data returned by AI model.");
      }

      const extractedData = extractJson(responseText);
      res.json(extractedData);

    } catch (error: any) {
      handleClaudeError(error, "evidence extraction", res);
    }
  });

  // API: Automated Transcription for Audio Recordings stored in PDF format
  app.post("/api/transcribe", async (req: Request, res: Response) => {
    let narrativeTextVal = "";
    let fileNameVal = "";
    try {
      const { narrativeText, audioData, mimeType, fileName } = req.body;
      narrativeTextVal = narrativeText || "";
      fileNameVal = fileName || "";
      
      if (audioData && mimeType) {
        return res.status(422).json({
          error: "Direct audio transcription is not enabled. Synthetic transcripts are disabled. Upload a real text transcript or paste the verified narrative text."
        });
      }

      if (!narrativeText || !narrativeText.trim()) {
        return res.status(400).json({ error: "Verified narrative text is required. Synthetic transcript generation is disabled." });
      }

      const promptText = `
        You are a certified court reporter for Ontario Family Court proceedings.
        Format only the verified narrative text supplied below into a clear court-record-style transcript note.
        Do not invent speakers, timestamps, quotes, dialogue, events, legal conclusions, or facts that are not explicitly present in the supplied text.

        VERIFIED NARRATIVE TEXT:
        "${narrativeText}"
      `;

      const response = await generateContentWithFallback({
        system: "You are a court reporter.",
        messages: [{ role: "user", content: [{ type: "text", text: promptText }] }],
        temperature: 0.3
      }, "claude-3-5-sonnet-20241022");

      const responseText = response.text;

      if (!responseText) {
        throw new Error("Failure processing audio transcription.");
      }

      res.json({
        success: true,
        fileName: fileName ? `Transcript - ${fileName.replace(/\.[^/.]+$/, "")}.pdf` : `Transcript_Audio_${Date.now()}.pdf`,
        mimeType: "application/pdf",
        transcribedText: responseText
      });

    } catch (error: any) {
      handleClaudeError(error, "audio transcription", res);
    }
  });

  // API: Voice Audio Memo Transcription (Microphone integration for parents)
  app.post("/api/transcribe-audio", async (req: Request, res: Response) => {
    return res.status(422).json({
      error: "Direct audio transcription is not enabled. The system will not fabricate a transcript. Paste a verified transcript or narrative text instead."
    });
  });

  // API 3: Lawyer lead intake
  app.post("/api/lawyer-intake", (req: Request, res: Response) => {
    return res.status(501).json({
      error: "Lawyer intake routing is not connected. The system will not generate a synthetic reference number or claim that counsel was contacted."
    });
  });

if (process.env.VERCEL !== "1") {
  app.listen(PORT, "0.0.0.0", () => {
    console.log(`[CYFSA ONTARIO PLATFORM SUCCESS] Express backend running on host 0.0.0.0 port ${PORT}`);
  });
}

export default app;
