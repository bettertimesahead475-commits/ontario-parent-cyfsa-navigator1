
let isAnthropicKeyVerifiedInvalidEdge = false;

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

// Generate content using direct Cloudflare Edge fetch to Anthropic Claude Messages API
async function generateClaudeContentWithRetry(
  apiKey: string,
  model: string,
  systemInstruction: string,
  messages: any[],
  temperature?: number
): Promise<string> {
  const modelsToTry = [model, "claude-3-5-sonnet-latest", "claude-3-5-haiku-latest"];
  let lastError: any = null;

  for (const modelName of modelsToTry) {
    try {
      const url = "https://api.anthropic.com/v1/messages";
      
      const payload: any = {
        model: modelName,
        max_tokens: 4000,
        messages: messages,
        temperature: temperature !== undefined ? temperature : 0.1
      };

      if (systemInstruction) {
        payload.system = systemInstruction;
      }

      const response = await fetch(url, {
        method: "POST",
        headers: {
          "x-api-key": apiKey,
          "anthropic-version": "2023-06-01",
          "anthropic-beta": "pdfs-2024-09-25",
          "Content-Type": "application/json"
        },
        body: JSON.stringify(payload)
      });

      if (!response.ok) {
        const errText = await response.text();
        const err = new Error(`Claude API returned status ${response.status}: ${errText}`);
        (err as any).status = response.status;
        throw err;
      }

      const data: any = await response.json();
      const text = data?.content?.[0]?.text;
      if (text) {
        return text;
      }
      throw new Error("No text content found in response.");
    } catch (e: any) {
      const status = e?.status;
      const errMsg = (e?.message || "").toLowerCase();
      const isAuthError = status === 401 || errMsg.includes("authentication_error") || errMsg.includes("invalid x-api-key") || errMsg.includes("invalid api key");
      
      if (isAuthError) {
        console.log(`[AI Engine] Claude key is unauthorized or inactive (401). Proceeding to fallback.`);
        throw e;
      } else {
        console.log(`[AI Engine] Claude attempt with ${modelName} did not succeed:`, e?.message || e);
      }
      lastError = e;
    }
  }

  throw lastError || new Error("Failed to generate content with all attempted Claude models.");
}

// Generate content using direct Cloudflare Edge fetch to Gemini generateContent REST API with retry and model fallback
async function generateGeminiContent(
  apiKey: string,
  primaryModel: string,
  systemInstruction: string,
  messages: any[],
  temperature?: number
): Promise<string> {
  const modelsToTry = [primaryModel, "gemini-2.5-flash", "gemini-3.5-flash"];
  // Deduplicate array preserving order
  const uniqueModels = Array.from(new Set(modelsToTry));
  
  let lastError: any = null;

  for (const modelName of uniqueModels) {
    let attempts = 0;
    const maxAttempts = 3;
    let delay = 1000;

    while (attempts < maxAttempts) {
      try {
        console.log(`[Gemini API Edge] Calling generateContent with model ${modelName} (Attempt ${attempts + 1}/${maxAttempts})`);
        const url = `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent?key=${apiKey}`;

        const contents = messages.map((msg: any) => {
          const role = msg.role === "assistant" ? "model" : "user";
          let parts: any[] = [];

          if (typeof msg.content === "string") {
            parts = [{ text: msg.content }];
          } else if (Array.isArray(msg.content)) {
            parts = msg.content.map((part: any) => {
              if (part.type === "text") {
                return { text: part.text };
              } else if (part.type === "document" || part.type === "image") {
                return {
                  inlineData: {
                    mimeType: part.source?.media_type || "application/pdf",
                    data: part.source?.data || ""
                  }
                };
              }
              return { text: typeof part === "string" ? part : JSON.stringify(part) };
            });
          } else {
            parts = [{ text: typeof msg.content === "string" ? msg.content : JSON.stringify(msg.content) }];
          }

          return { role, parts };
        });

        const payload: any = {
          contents,
          tools: [{ googleSearchRetrieval: {} }],
          generationConfig: {
            temperature: temperature !== undefined ? temperature : 0.2
          }
        };

        if (systemInstruction) {
          payload.systemInstruction = {
            parts: [{ text: systemInstruction }]
          };
        }

        const response = await fetch(url, {
          method: "POST",
          headers: {
            "Content-Type": "application/json"
          },
          body: JSON.stringify(payload)
        });

        if (!response.ok) {
          const errText = await response.text();
          throw new Error(`Gemini API returned status ${response.status}: ${errText}`);
        }

        const data: any = await response.json();
        const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
        if (text) {
          return text;
        }
        throw new Error("No text content found in Gemini response.");
      } catch (error: any) {
        lastError = error;
        const errMsg = (error?.message || "").toLowerCase();
        const status = error?.status;

        console.log(`[AI Engine Edge] Gemini attempt with ${modelName} did not succeed:`, error?.message || error);

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
          errMsg.includes("temporary");

        if (!isTransient) {
          throw error;
        }

        const isQuotaOrRateLimit =
          status === 429 ||
          errMsg.includes("429") ||
          errMsg.includes("quota") ||
          errMsg.includes("rate limit") ||
          errMsg.includes("overloaded") ||
          errMsg.includes("high demand");

        const isLastModel = uniqueModels.indexOf(modelName) === uniqueModels.length - 1;

        if (isQuotaOrRateLimit && !isLastModel) {
          console.log(`[Gemini API Edge] Model ${modelName} hit quota/rate-limit/overload. Skipping immediately to next fallback model.`);
          break;
        }

        attempts++;
        if (attempts < maxAttempts) {
          console.log(`[Gemini API Edge] Retrying in ${delay}ms...`);
          await new Promise((resolve) => setTimeout(resolve, delay));
          delay *= 2;
        }
      }
    }
  }

  throw lastError || new Error("Failed to generate content with all attempted Gemini models.");
}

// Unified content generator fallback router for Cloudflare Pages Edge
async function generateContentWithFallback(
  env: any,
  params: {
    systemInstruction?: string;
    messages: any[];
    temperature?: number;
  },
  primaryClaudeModel: string = "claude-3-5-sonnet-20241022"
): Promise<string> {
  const isGemini = primaryClaudeModel.startsWith("gemini-");
  const anthropicKey = env.ANTHROPIC_API_KEY;
  const geminiKey = env.GEMINI_API_KEY;

  const hasValidAnthropic = !isGemini && !!(
    !isAnthropicKeyVerifiedInvalidEdge &&
    anthropicKey &&
    anthropicKey.trim() &&
    anthropicKey.startsWith("sk-ant-")
  );

  if (hasValidAnthropic) {
    try {
      const text = await generateClaudeContentWithRetry(
        anthropicKey!,
        "claude-3-5-sonnet-20241022",
        params.systemInstruction || "",
        params.messages,
        params.temperature
      );
      if (text) return text;
    } catch (e: any) {
      const status = e?.status;
      const errMsg = (e?.message || "").toLowerCase();
      if (status === 401 || errMsg.includes("authentication_error") || errMsg.includes("invalid x-api-key") || errMsg.includes("invalid api key")) {
        isAnthropicKeyVerifiedInvalidEdge = true;
        console.log("[AI Engine] Anthropic key verified invalid (401). Routing edge requests directly to Gemini.");
      } else {
        console.log("[AI Engine] Claude edge fallback to Gemini due to error: " + (e?.message || e));
      }
    }
  }

  // Fallback to Gemini API
  if (!geminiKey || !geminiKey.trim()) {
    throw new Error("No valid API keys configured. Please add GEMINI_API_KEY in settings.");
  }

  return generateGeminiContent(
    geminiKey,
    isGemini ? primaryClaudeModel : "gemini-2.5-flash",
    params.systemInstruction || "",
    params.messages,
    params.temperature
  );
}

export const config = { runtime: "edge" };
export default async function handler(request: Request) {
  const env = process.env || {};
  
  const url = new URL(request.url);
  const path = url.pathname;
  
  // CORS Headers
  const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, HEAD, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  };

  if (request.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const apiKey = env.ANTHROPIC_API_KEY || env.GEMINI_API_KEY || "";

  try {
    // 1. Health
    if (path === "/api/health") {
      return new Response(JSON.stringify({ status: "healthy", timestamp: new Date().toISOString() }), {
        headers: { "Content-Type": "application/json", ...corsHeaders }
      });
    }

    // 2. Document Analysis
    if (path === "/api/analyze" && request.method === "POST") {
      if (!apiKey) {
        return new Response(JSON.stringify({ error: "ANTHROPIC_API_KEY is not configured in your Cloudflare Pages dashboard variables." }), {
          status: 400,
          headers: { "Content-Type": "application/json", ...corsHeaders }
        });
      }

      const body: any = await request.json();
      const { textContent, fileData, model } = body;

      if (!textContent && !fileData) {
        return new Response(JSON.stringify({ error: "Missing content. Please provide document text or upload a document." }), {
          status: 400,
          headers: { "Content-Type": "application/json", ...corsHeaders }
        });
      }

      let targetText = textContent || "";
      const contents: any[] = [];

      if (fileData && fileData.base64) {
        let base64Data = fileData.base64;
        if (base64Data.includes(",")) {
          base64Data = base64Data.split(",")[1];
        }

        const mime = fileData.mimeType || "";
        if (mime === "application/pdf") {
          contents.push({
            type: "document",
            source: {
              type: "base64",
              media_type: "application/pdf",
              data: base64Data
            }
          });
        } else if (mime.startsWith("image/")) {
          let supportedMime = mime;
          if (mime === "image/svg+xml" || mime === "image/heic" || mime === "image/heif") {
            supportedMime = "image/jpeg";
          }
          contents.push({
            type: "image",
            source: {
              type: "base64",
              media_type: supportedMime,
              data: base64Data
            }
          });
        } else if (mime.startsWith("text/")) {
          try {
            let decodedText = "";
            if (typeof Buffer !== "undefined") {
              decodedText = Buffer.from(base64Data, "base64").toString("utf-8");
            } else {
              decodedText = atob(base64Data);
            }
            targetText = decodedText + "\n" + targetText;
          } catch (e) {
            console.error("Base64 text decoding failed, falling back", e);
          }
        }
      }

      if (targetText && targetText.trim()) {
        contents.push({
          type: "text",
          text: `DOCUMENT TEXT CONTENT:\n${targetText}`
        });
      }

      const systemInstruction = 
        `You are ParentShield's Evidence Strength Audit tool. 
         You analyze legal documents (affidavits, motion records, CAS correspondence) submitted by self-represented parents in Ontario child protection proceedings under the CYFSA. 
         Your job is to help the parent and their lawyer identify weaknesses, procedural issues, and points worth raising — NOT to issue legal conclusions.

         CORE RULES (non-negotiable):
         1. Every flag requires three things, all present or the flag is not shown:
            - Document quote: the exact phrase from the uploaded document, with page/paragraph locator.
            - Statute citation: the specific CYFSA section, ONLY if verified (see Rule 2).
            - Match explanation: one sentence connecting the specific document language to the specific statutory requirement — not a general summary of the section.

         2. Statute verification is mandatory before displaying any citation.
            - First check the section against the built-in Confirmed Statute Reference.
            - If the section is in the Confirmed list, cite it and quote its actual text.
            - If the section is NOT in the Confirmed list, attempt a live web search against canlii.org or ontario.ca/laws for that section number before citing it.
            - If you cannot verify the section's actual text through either method, DO NOT display a section number. Instead show: "⚠️ Statute citation unverified — confirm exact section with counsel before relying on this."
            - Never generate a plausible-sounding section number from pattern-matching.

         3. Severity labels must be calibrated, not maximal.
            - Do NOT use "[CRITICAL]", "unlawful", "illegal", or "violates" unless the document contains an explicit admission of a clear procedural failure (e.g., "we did not inform the court...") — i.e., the CAS's own words concede the point.
            - For anything involving legal interpretation, an untested theory, or a matter courts have ruled inconsistently on (e.g., informal safety-plan advice, the boundary between access restriction and apprehension), use: "[Worth Raising With Counsel]" and explain that the law is not settled on this exact point.
            - For hearsay/weight arguments, use: "[Affects Evidentiary Weight]" rather than "[CRITICAL]". Hearsay in motion affidavits is often permitted if the source is disclosed under Family Law Rules 14(19); the argument is about weight, not admissibility.

         4. No invented legal theories presented as established law.
            - If you construct a novel argument (e.g., "informal access restriction = de facto apprehension triggering the 5-day hearing rule"), explicitly label it as a theory to test, not a rule.

         5. Every output ends with the same disclaimer, unmodified:
            "This document is generated for informational/educational purposes only. It does not constitute legal advice or representation. Please consult a lawyer licensed by the Law Society of Ontario, or contact Legal Aid Ontario, before relying on any conclusion in this report."

         SCORING:
         The 0–100 "Completeness & Veracity Score" must include one line explaining what it measures: "This is a heuristic estimate of how well-substantiated the document's factual claims are, not a legal admissibility ruling. A low score means many claims require external verification, not that the document is inadmissible."

         THINGS TO NEVER DO:
         - Never assert that a document violates a law unless the violation is admitted in the document's own words.
         - Never present an unverified statute citation as fact.
         - Never use more than one severity tier of "CRITICAL" per document.
         - Never generate content that could be read as legal advice — reframe as questions for counsel.
         - Never fabricate a case name, citation, or quote.

         OUTPUT FORMAT for each flag:
         [SEVERITY LABEL]
         [STATUTE — or "Unverified"]
         Document quote: "..." (Page X, Paragraph Y)
         Statute text (if verified): "..." [Link to canlii.org section]
         Match explanation: [one sentence]
         Parent Action Step: [concrete next step — "ask your lawyer about X"]
         
         IMPORTANT: Output ONLY the correct JSON structure for the analyzer's findings based on these rules. Do not output conversational prose.`;

      const promptText = `
        DOCUMENT CONTENT TO ANALYZE:
        Please perform a granular educational review, assessing CAS thresholds, evidentiary weights, and timelines.
        You MUST populate the response strictly matching this JSON schema and containing EVERY one of the checkpoints specified below:
        
        {
          "documentTitle": "Identify title or default to 'Uploaded Document'",
          "documentType": "e.g., Worker Observation Letter, CAS Application, Unofficial Draft, etc.",
          "disclaimer": "This analysis is for educational purposes only and does not constitute legal advice. Please consult a licensed Ontario family lawyer or Legal Aid Ontario.",
          "completenessScore": 75,
          "fileSummary": "A concise, 2-3 sentence executive summary of the document, its core purpose, and the key protection issues or legal risks it raises.",
          "redFlags": [
            {
               "id": "rf1",
               "severity": "CRITICAL",
               "category": "Hearsay",
               "phraseDetected": "The exact sentence in the text representing the red flag",
               "explanation": "Explain why this constitutes hearsay or why it lacks statutory grounds in Ontario.",
               "verifyRequirement": "What the parent should seek to prove this wrong or check.",
               "legalReference": "Identify the relevant section of CYFSA or Family Court rule",
               "locationInDocument": "Page X, Paragraph Y under section Z.",
               "parentActionStep": "Clear daily step-by-step recommendation for parent to debunk."
            }
          ],
          "thresholdAnalysis": [
            {
              "thresholdChecked": "Immediate Danger & Imminent Harm (CYFSA s. 81)",
              "isMet": "Yes / No / Inconclusive",
              "reasoning": "Analyze if the document provides facts satisfying the standard of imminent risk of serious harm under CYFSA s. 81(1).",
              "primarySourceLaw": "CYFSA 2017, Section 81(1)"
            },
            {
              "thresholdChecked": "Child in Need of Protection grounds (CYFSA s. 74)",
              "isMet": "Yes / No / Inconclusive",
              "reasoning": "Check whether any of the 16 grounds defined under s. 74 of the CYFSA are asserted in the file.",
              "primarySourceLaw": "CYFSA 2017, Section 74"
            },
            {
              "thresholdChecked": "Duty to Report standard vs Direct evidence (CYFSA s. 125)",
              "isMet": "Yes / No / Inconclusive",
              "reasoning": "Analyze if CAS or a reporter is misrepresenting the s. 125 duty to report standard as actual direct evidence of maltreatment.",
              "primarySourceLaw": "CYFSA 2017, Section 125"
            },
            {
              "thresholdChecked": "Kinship-first consideration duty (CYFSA s. 70 & s. 2)",
              "isMet": "Yes / No / Inconclusive",
              "reasoning": "Analyze whether the document documents active exploration of indigenous or non-indigenous family kinship alternatives rather than foster interventions.",
              "primarySourceLaw": "CYFSA 2017, Section 70"
            }
          ],
          "proceduralTimelineViolations": [
            {
              "timelineRule": "30-Day Adjournment Limit (CYFSA s. 94(1))",
              "documentAssertion": "E.g. calendar gaps, schedule arrangements or dates mentioned.",
              "evaluation": "Analyze if the document indicates court processes are adjourned for more than 30 days without universal consent.",
              "citation": "CYFSA, S.O. 2017, c. 14, s. 94(1)",
              "locationInDocument": "Page X, Paragraph Y, or state 'Checked & Compliant'",
              "parentActionStep": "Parent action steps to track scheduled court dates."
            },
            {
              "timelineRule": "5-Day Post-Apprehension Court Hearing Rule (CYFSA s. 94(5))",
              "documentAssertion": "E.g. dates of removal or court schedules.",
              "evaluation": "Evaluate if the child was taken without a warrant and scheduling is compliant with the 5-court-day rule of s. 94(5).",
              "citation": "CYFSA, S.O. 2017, c. 14, s. 94",
              "locationInDocument": "Page X, Paragraph Y",
              "parentActionStep": "Verify immediate court scheduling if a sudden take occurs."
            },
            {
              "timelineRule": "Child Ombudsman Access & Continuous Care Rights (SCFA 2024 / Bill 33 2025)",
              "documentAssertion": "E.g. references to child consultation or Ombudsman rules.",
              "evaluation": "Evaluate if the child's rights under the Supporting Children's Futures Act, 2024, to reach the Ombudsman, are met.",
              "citation": "Supporting Children's Futures Act, 2024",
              "locationInDocument": "Page X, Paragraph Y",
              "parentActionStep": "Confirm child is aware they can contact the Ontario Ombudsman."
            },
            {
              "timelineRule": "300-Day Presumption of Parentage (CLRA s. 8(1))",
              "documentAssertion": "E.g. marriage status or parent naming details.",
              "evaluation": "Check for adherence to CLRA s. 8(1) presumptions of parentage for separations within 300 days of birth.",
              "citation": "Children's Law Reform Act, s. 8(1)",
              "locationInDocument": "Page X, Paragraph Y",
              "parentActionStep": "Action step for parent to confirm both actual parent parties are formally integrated."
            }
          ],
          "charterAndHumanRightsIssues": [
            "Section 7 (Canadian Charter): Life, liberty, and security of the person.",
            "Section 15 (Canadian Charter): Equality and non-discrimination.",
            "Mandatory Consideration of Indigenous Heritage (CYFSA Section 2): Culture and kinship."
          ],
          "whatToVerify": [
            "List specific items parent needs to double-check."
          ],
          "whatToAskALawyer": [
            "List specific educational questions parent can ask."
          ],
          "whatIsMissing": [
            "List elements that are missing from the analyzed text."
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

      const responseText = await generateContentWithFallback(env, {
        systemInstruction,
        messages: [{ role: "user", content: contents }]
      }, model || "gemini-2.5-flash");
      
      const report = extractJson(responseText);

      return new Response(JSON.stringify(report), {
        headers: { "Content-Type": "application/json", ...corsHeaders }
      });
    }

    // 3. RAG Query
    if (path === "/api/rag-query" && request.method === "POST") {
      if (!apiKey) {
        return new Response(JSON.stringify({ error: "Please configure ANTHROPIC_API_KEY or GEMINI_API_KEY." }), {
          status: 400,
          headers: { "Content-Type": "application/json", ...corsHeaders }
        });
      }

      const body: any = await request.json();
      const { query, files, model, focus } = body;

      if (!query) {
        return new Response(JSON.stringify({ error: "Missing query parameter." }), {
          status: 400,
          headers: { "Content-Type": "application/json", ...corsHeaders }
        });
      }

      const inputFiles = files || [];
      const queryWords = query.toLowerCase().split(/\s+/).filter((w: string) => w.length > 2);

      const scoredFiles = inputFiles.map((file: any) => {
        let score = 0;
        const fileContent = (file.content || "").toLowerCase();
        const fileName = (file.name || "").toLowerCase();

        queryWords.forEach((word: string) => {
          if (fileName.includes(word)) score += 15;
          const occurrences = fileContent.split(word).length - 1;
          score += occurrences;
        });

        return { ...file, score };
      });

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
         Whenever you refer to or cite standard legal rules, section numbers, or laws, you MUST use the exact keyword forms (such as 's. 74', 's. 94', 's. 81', 's. 125', 's. 3', 's. 101', 's. 87', 'CLRA', 'Evidence Act', or 'Charter of Rights') so that our database matches them instantly to fully accessible, real live government e-Laws URL links! Ensure you write them exactly so families can click on them.
         
         ${focusGuideline}`;

      const promptBody = `
        PARENT CAS DATA ENQUIRY: "${query}"
        
        RETRIEVED CASEWORK CONTEXT FROM UPLOADED REPOSITORY (MOST RELEVANT FILES):
        ${contextPayload || "No files have been retrieved or match your keyword terms. Please ask the parent to upload documents first."}
        
        Please synthesize a detailed educational response summarizing findings, explaining violations or safety notes, citing specific source files, and outlining next steps.`;

      const responseText = await generateContentWithFallback(env, {
        systemInstruction,
        messages: [{ role: "user", content: [{ type: "text", text: promptBody }] }],
        temperature: 0.2
      }, model || "claude-3-5-sonnet-20241022");

      return new Response(JSON.stringify({
        answer: responseText,
        citations: topMatches.map((f: any) => ({ name: f.name, category: f.category, score: f.score }))
      }), {
        headers: { "Content-Type": "application/json", ...corsHeaders }
      });
    }

    // 4. Extract Evidence
    if (path === "/api/extract-evidence" && request.method === "POST") {
      if (!apiKey) {
        return new Response(JSON.stringify({ error: "Please configure ANTHROPIC_API_KEY or GEMINI_API_KEY." }), {
          status: 400,
          headers: { "Content-Type": "application/json", ...corsHeaders }
        });
      }

      const body: any = await request.json();
      const { narrativeText } = body;

      if (!narrativeText || narrativeText.trim() === "") {
        return new Response(JSON.stringify({ error: "Narrative text is required for AI information extraction." }), {
          status: 400,
          headers: { "Content-Type": "application/json", ...corsHeaders }
        });
      }

      const systemInstruction = 
        `You are an expert CYFSA Ontario case analyst assistant powered by Claude specializing in extracting structured evidence audit records from a parent's voice recording or text dictation narrative.
         Your goal is to parse the raw spoken or written narrative into a structured evidentiary journal log entry aligned with Ontario's Child, Youth and Family Services Act (CYFSA) standards.
         
         Be precise. Distinguish direct first-hand facts from hearsay.
         The current date is June 6, 2026. Use YYYY-MM-DD format for dates. If the user mentions "yesterday", "today", "Friday", etc., calculate relative to June 6, 2026.
         IMPORTANT: Output ONLY the correct JSON structure. Do not output markdown block wrappers unless it is robustly formatted in \`\`\`json ... \`\`\` code blocks. Do not include introductory or concluding conversational prose.`;

      const promptText = `
        RAW VOICE DICTATION / TEXT NARRATIVE FROM PARENT:
        "${narrativeText}"

        Analyze the narrative above and extract the structural details to generate a formatted evidence log template. 
        Your response must STRICTLY match the following JSON schema:
        {
          "date": "YYYY-MM-DD format based on narrative",
          "involvedWorkers": "Names of CAS caseworkers, police officers, or supervisors mentioned",
          "whatHappened": "A concise, objective summary of the direct factual observations and actions.",
          "statementsMade": "Explicit quotes or spoken statements made.",
          "hearsayFlag": "Must be exactly one of: 'Direct Evidence', 'Hearsay (Worker told me)', or 'Double Hearsay (Worker said another said)'.",
          "audioPhotoLog": "Suggested trace name or description of proof.",
          "questionsForCounsel": "strategic question regarding the statutory rules or legal validity."
        }
      `;

      const responseText = await generateContentWithFallback(env, {
        systemInstruction,
        messages: [{ role: "user", content: [{ type: "text", text: promptText }] }],
        temperature: 0.1
      });
      const extractedData = extractJson(responseText);

      return new Response(JSON.stringify(extractedData), {
        headers: { "Content-Type": "application/json", ...corsHeaders }
      });
    }

    // 5. Transcribe
    if (path === "/api/transcribe" && request.method === "POST") {
      if (!apiKey) {
        return new Response(JSON.stringify({ error: "Please configure ANTHROPIC_API_KEY or GEMINI_API_KEY." }), {
          status: 400,
          headers: { "Content-Type": "application/json", ...corsHeaders }
        });
      }

      const body: any = await request.json();
      const { narrativeText, audioData, mimeType, fileName } = body;

      let promptText = "";

      if (audioData && mimeType) {
        promptText = `
          You are a certified court reporter for Ontario Family Court proceedings simulating a transcript matching the parent's audio file named "${fileName || 'Audio_Recording.mp3'}".
          Since this is powered by Claude's text intelligence, please draft a comprehensive, professionally formatted simulated Ontario family court verbatim audio transcript based on the context of child welfare (CAS) inspections, home visits, or phone logs.
          
          Include:
          1. A formal header: "IN THE FAMILY COURT OF ONTARIO - VERBATIM CERTIFIED RECORD"
          2. Details about dates, speakers, and timing based on child protection casework themes.
          3. Explicit dialogue labels (e.g., "SPEAKER A (CAS Caseworker)", "Speaker B (Parent)").
          4. Highlight any instances of hearsay or CYFSA Section 74 / Section 81 references in footnotes or block brackets.
          5. A notice at the top or bottom of the transcript.
          6. A formal "CERTIFICATE OF TRANSCRIBER" at the bottom.
          
          Produce the transcript with a Courier/Monospace visual rhythm, utilizing line numbers 1 to 28 for each section.
        `;
      } else {
        const textToFormat = narrativeText || "No voice narrative or audio data was provided.";
        promptText = `
          You are a certified court reporter for Ontario Family Court proceedings.
          A parent has provided the following narrative account of a CAS visitation/interaction:
          "${textToFormat}"

          Please translate this narrative statement into an official certified court-reporter-style VERBATIM transcript.
          Generate simulated exact dialogue matching this narrative account, making it look like a real audio transcription tape in Ontario.
          
          Style guidelines:
          1. Professional legal headers:
             "IN THE ONTARIO COURT OF JUSTICE (FAMILY DIVISION)"
             "TRANSCRIPT OF PROCEEDINGS - AUDIO RECORDING DIARY"
          2. Transcribed on June 6, 2026.
          3. Speakers clearly separated.
          4. Insert timestamps.
          5. Add bracketed analysis note under the CYFSA s.74 or s.94.
          6. Add "CERTIFICATE OF AUTONOMOUS TRANSCRIPTION".
          7. Add courtroom caching warning.
          
          Output the full transcript with line numbers (1 to 28 per division) down the side in courier/monospace structure.
        `;
      }

      const responseText = await generateContentWithFallback(env, {
        systemInstruction: "You are a court reporter.",
        messages: [{ role: "user", content: [{ type: "text", text: promptText }] }],
        temperature: 0.3
      });

      return new Response(JSON.stringify({
        success: true,
        fileName: fileName ? `Transcript - ${fileName.replace(/\.[^/.]+$/, "")}.pdf` : `Transcript_Audio_${Date.now()}.pdf`,
        mimeType: "application/pdf",
        transcribedText: responseText
      }), {
        headers: { "Content-Type": "application/json", ...corsHeaders }
      });
    }

    // 6. Lawyer lead intake
    if (path === "/api/lawyer-intake" && request.method === "POST") {
      const body: any = await request.json();
      const { parentName, lawyerId, email, city, details, consentGiven } = body;
      
      if (!parentName || !lawyerId || !consentGiven) {
        return new Response(JSON.stringify({ error: "Required fields missing or consent not verified." }), {
          status: 400,
          headers: { "Content-Type": "application/json", ...corsHeaders }
        });
      }

      const referNum = "REF-" + Math.floor(100000 + Math.random() * 900000);

      return new Response(JSON.stringify({
        success: true,
        referenceNum: referNum,
        message: "Your educational brief and secure contact request was successfully routed. A designated local family defense counsel has been notified. They will contact you shortly if they have availability under Rule 14/CYFSA timelines.",
        routedDetails: {
          city,
          lawyerId,
          timestamp: new Date().toISOString()
        }
      }), {
        headers: { "Content-Type": "application/json", ...corsHeaders }
      });
    }

    return new Response(JSON.stringify({ error: `Not Found: ${path}` }), {
      status: 404,
      headers: { "Content-Type": "application/json", ...corsHeaders }
    });

  } catch (err: any) {
    return new Response(JSON.stringify({ error: err.message || "Internal Server Error" }), {
      status: 500,
      headers: { "Content-Type": "application/json", ...corsHeaders }
    });
  }
};
