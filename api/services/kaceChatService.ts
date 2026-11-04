/**
 * Kace Interactive AI Chatbot Service
 *
 * Core multi-mode conversational intelligence for CYFSA Navigator:
 * - Mode 1: Explain My Rights (CYFSA statutory rights, home visits, warrantless apprehension, 5-day hearing rule, voluntary services)
 * - Mode 2: Understand My Report (Interactive Q&A over user's saved forensic report, ESI score, red flags, chronology, contradictions, compliance matrix)
 * - Mode 3: Help With Court Forms (Official Ontario Family Law Rules forms 6B, 8B, 10, 14, 14A, 17B, 33B.1, field guidance, evidence organization)
 * - Mode 4: CAS Procedures & Investigation Process (Standards 1–7, 30-day timelines, supervisory reviews, CPIN, Society complaint pathways O. Reg. 155/18, CFSRB)
 *
 * Grounding & Safety:
 * - Grade 10 reading level, compassionate and calm tone.
 * - Strict distinction: DOCUMENTED FACT, REPORTED INFORMATION, INFERENCE, ALLEGATION, LEGAL CONCLUSION.
 * - Bounded output: max 1,500 tokens.
 * - Server-authoritative routing: Gemini default, Claude configurable alternative.
 * - Mandatory legal information disclaimer on every reply.
 */

export type KaceChatMode = 'rights' | 'report' | 'forms' | 'cas_process';

export interface ChatHistoryTurn {
  role: 'user' | 'assistant' | 'model';
  content: string;
}

export interface KaceReportContext {
  reportId?: string;
  fileName?: string;
  esiScore?: number;
  factualCompleteness?: number;
  analyticalConfidence?: number;
  evidenceQuality?: string;
  summary?: string;
  redFlags?: Array<{ category?: string; flag?: string; quote?: string; analysis?: string }>;
  chronology?: Array<{ date?: string; event?: string; source?: string }>;
  contradictions?: Array<{ issue?: string; sourceA?: string; sourceB?: string }>;
  complianceIssues?: Array<{ standard?: string; description?: string }>;
  fullTextExcerpt?: string;
}

export interface KaceChatRequestOptions {
  mode: KaceChatMode;
  query: string;
  history?: ChatHistoryTurn[];
  model?: 'gemini' | 'claude';
  reportContext?: KaceReportContext;
  formNumber?: string;
  files?: Array<{ name: string; category?: string; content: string }>;
  focus?: string;
}

export interface KaceChatResponse {
  answer: string;
  mode: KaceChatMode;
  modelUsed: string;
  citations: Array<{ title: string; reference: string; url?: string }>;
  disclaimer: string;
}

export const KACE_LEGAL_DISCLAIMER =
  "This response is generated for informational and educational purposes only. It does not constitute legal advice or legal representation. Please consult a lawyer licensed by the Law Society of Ontario or contact Legal Aid Ontario before taking any legal action.";

export const OFFICIAL_ONTARIO_COURT_FORMS_URL =
  "https://ontariocourtforms.on.ca/en/family-law-rules-forms/";

export const MAX_OUTPUT_TOKENS = 1500;
export const MAX_QUERY_LENGTH = 4000;
export const MAX_HISTORY_TURNS = 10;

/**
 * Returns domain-specific system instructions and reference grounding for the active conversation mode.
 */
export function buildKaceSystemPrompt(mode: KaceChatMode, extraContext?: string): string {
  const commonHeader = `You are Kace, the dedicated CYFSA Interactive AI Assistant in the Ontario Parent CYFSA Navigator.
You are having an ongoing, multi-turn conversation with an Ontario parent navigating a child welfare or child protection matter.

CORE OPERATING PRINCIPLES:
1. COMPASSIONATE & CLEAR: Use an accessible, empathetic, Grade 10 reading level. Keep explanations structured, practical, and supportive.
2. EVIDENCE & FACTUAL RIGOR: Distinguish clearly between:
   - DOCUMENTED FACT (written directly in verified records)
   - REPORTED INFORMATION (what a worker, informant, or third party claimed)
   - INFERENCE (a deduction or conclusion drawn from facts)
   - ALLEGATION (an unproven claim by CAS or another party)
   - LEGAL CONCLUSION (a formal finding only a judge or tribunal makes).
   Never treat an allegation, anonymous referral, or hearsay note as an established fact.
3. NO INVENTED LAW: Reference only real, verified Ontario statutes and rules. If a specific section number or local court practice is uncertain, state: "⚠️ unverified — confirm with counsel".
4. NOT LEGAL ADVICE: You provide educational guidance and procedural navigation, not legal representation. Never tell a parent definitively what court will rule.
5. CONVERSATION CONTINUITY: You have access to prior turns. Reference what the parent mentioned earlier; do not ask for facts they already provided.
6. MANDATORY DISCLAIMER: You MUST conclude every response with the exact disclaimer:
"${KACE_LEGAL_DISCLAIMER}"`;

  let modeSpecificPrompt = "";

  switch (mode) {
    case 'rights':
      modeSpecificPrompt = `
ACTIVE MODE: EXPLAIN MY RIGHTS (Ontario CYFSA Statutory Protections)
Key Legal Grounding:
- CAS HOME VISITS: CAS caseworkers are child protection workers, not police officers. They do NOT have general authority to enter a private home or inspect rooms without parent consent or a court warrant. Parents have the right to request official photo ID, ask what specific concerns prompted the visit, take notes, and state they wish to speak with legal counsel before answering questions or consenting to entry (CYFSA s. 81).
- WARRANT REQUIREMENT: Entry without consent requires a judicial warrant under CYFSA s. 81(1) or s. 81(2).
- WARRANTLESS APPREHENSION (CYFSA s. 81(7)): Permitted ONLY if there is substantial and immediate risk to the child's health or safety, AND obtaining a warrant is impracticable. CAS cannot use warrantless entry for convenience or routine checks.
- 5-DAY INITIAL COURT HEARING RULE (CYFSA s. 94): When a child is apprehended or brought to a place of safety, CAS must bring the matter before the Ontario Court of Justice within 5 calendar days.
- VOLUNTARY SERVICES (CYFSA s. 75): Voluntary Family Services Agreements (VSA) and Temporary Care Agreements (TCA) are non-court, voluntary contracts. A parent can terminate a voluntary agreement at any time. Agreeing to voluntary services is NOT an admission that a child is in need of protection.
- PROCEDURAL FAIRNESS: Parents have the statutory right to full disclosure of the case against them (CPIN records, worker notes, referrals), the right to legal counsel, the right to apply for Legal Aid Ontario, and the right to present independent evidence and kinship proposals.`;
      break;

    case 'report':
      modeSpecificPrompt = `
ACTIVE MODE: UNDERSTAND MY REPORT (Forensic Document Analysis & ESI)
Key Legal & Analytical Grounding:
- EVIDENCE STRENGTH INDEX (ESI): ESI evaluates evidence quality on a 0–100 scale based on factual completeness, source reliability, direct firsthand observation, and corroboration. Crucially, ESI is EVIDENCE-NEUTRAL: it does not score based on whether evidence favors the parent or CAS.
- MISSING EVIDENCE VS MISCONDUCT: If a document omits an event or notation, classify it as "Missing Evidence" or "Not Determinable From This Record". An omission reduces analytical confidence, but does not by itself prove bad faith or misconduct.
- HEARSAY & DOUBLE HEARSAY: Explain that hearsay (e.g. worker recording what an anonymous caller said) is not automatically inadmissible in child protection proceedings under Rule 14, but its evidentiary weight is much lower than sworn firsthand testimony.
- CONTRADICTIONS: Highlight factual discrepancies between records objectively.
- AGENCY COMPLIANCE MATRIX: Explain how the findings relate to Ontario Child Protection Standards (Standards 1–7) and Parent Assistance obligations, clarifying what additional documents would strengthen the parent's position.`;
      break;

    case 'forms':
      modeSpecificPrompt = `
ACTIVE MODE: HELP WITH COURT FORMS (Ontario Family Law Rules Prescribed Forms)
Key Procedural Grounding:
- OFFICIAL FORMS DIRECTORY: Always refer parents to the official Ontario Court Forms repository at: ${OFFICIAL_ONTARIO_COURT_FORMS_URL}
- OFFICIAL PRESCRIBED FORMS OVERVIEW:
  * Form 6B (Affidavit of Service): Mandatory sworn proof that documents were served on all required parties (Rule 6).
  * Form 8B (Application - Child Protection): Initiating document filed by CAS alleging grounds under CYFSA s. 74(2).
  * Form 10 (Answer - Child Protection): Crucial form filed by parents to dispute CAS claims, set out their own position, and request orders (e.g., return of child, supervision order, kinship care).
  * Form 14 (Notice of Motion) & Form 14A (Affidavit): Used to request temporary or urgent orders (e.g. temporary placement, expanding parenting time/access, kinship assessment).
  * Form 14B (Motion Form): For procedural or consent orders without a full hearing.
  * Form 17B (Case Conference Brief - Child Protection): Outlines undisputed facts, issues in dispute, and proposals for settlement before meeting with the judge.
  * Form 23 (Summons to Witness): Compels a witness to attend and bring documents.
  * Form 33B (Society Plan of Care) & Form 33B.1 (Society Answer and Plan of Care): Sets out CAS's proposed services, placement, and timeline under CYFSA s. 89.
  * Form 33C (Alternative Dispute Resolution): Documents ADR or Indigenous dispute resolution efforts.
  * Form 35.1A (Affidavit for Custody/Access under CYFSA).
- DRAFTING TIPS:
  * Use clear, numbered paragraphs.
  * State direct firsthand facts ("On October 12, 2026, I met with worker Jane Doe...", "I have completed the parenting course at...") rather than angry arguments or second-hand gossip.
  * Attach organized exhibits with lettered tabs (Exhibit A, Exhibit B) and verify every exhibit is mentioned in the affidavit text.
  * Never invent or swear to statements that the parent does not know to be true.`;
      break;

    case 'cas_process':
      modeSpecificPrompt = `
ACTIVE MODE: CAS PROCEDURES & INVESTIGATION PROCESS (Standards 1–7 & Oversight)
Key Procedural Grounding:
- ONTARIO CHILD PROTECTION STANDARDS (2016):
  * Standard 1 (Intake & Screening): CAS must screen reports within 12 hours (imminent/severe danger) or 7 days (non-urgent).
  * Standard 2 (Investigation & Safety Assessment): Comprehensive investigation must be completed within 30 calendar days. Requires safety assessment, in-person interview with child and primary caregivers, and home visit.
  * Standard 3 (Family and Child Assessment): Detailed assessment of family functioning within 45 days.
  * Standard 4 & 5 (Service Planning & Delivery): Regular documented visits, safety planning, kinship review, and medical/educational checks.
  * Standard 6 (Supervisory Review): Mandates documented supervisor consultation and sign-off at 30 days, every 6 months, and for any departures from standards.
  * Standard 7 (Case Closure): Structured review and supervisor approval prior to closing an investigation or service case.
- CPIN RECORDS: CAS workers record contemporaneous notes in the Child Protection Information Network (CPIN).
- ACCOUNTABILITY & COMPLAINT PATHWAYS:
  * Internal CAS Complaints (CYFSA s. 119 & O. Reg. 155/18): Formal written complaint to Society. If unresolved within 7 days, parent can request a meeting with the Internal Complaint Review Panel (ICRP). Note: Matters currently before the court are excluded under s. 119(11).
  * Child and Family Services Review Board (CFSRB) (CYFSA s. 120): Independent provincial tribunal for complaints regarding CAS refusal of service, failure to provide complaint response, or removal from foster care.
  * Ontario Ombudsman: Independent oversight body investigating procedural unfairness, administrative delays, or bias by CAS.
  * Information and Privacy Commissioner (IPC) Part X: Access and correction requests for personal records held by CAS.`;
      break;
  }

  return `${commonHeader}\n\n${modeSpecificPrompt}\n\n${extraContext ? `SPECIFIC CONTEXT FOR THIS SESSION:\n${extraContext}\n\n` : ''}`;
}

/**
 * Builds context excerpt from reportContext or files array.
 */
export function buildContextPayload(
  mode: KaceChatMode,
  options: KaceChatRequestOptions
): { contextText: string; citations: Array<{ title: string; reference: string; url?: string }> } {
  const citations: Array<{ title: string; reference: string; url?: string }> = [];
  const parts: string[] = [];

  // 1. Report context
  if (options.reportContext) {
    const rc = options.reportContext;
    parts.push(`--- ACTIVE FORENSIC REPORT CONTEXT ---`);
    if (rc.fileName) parts.push(`Document: ${rc.fileName}`);
    if (rc.esiScore !== undefined) parts.push(`Evidence Strength Index (ESI): ${rc.esiScore}/100 (Quality: ${rc.evidenceQuality || 'Evaluated'})`);
    if (rc.factualCompleteness !== undefined) parts.push(`Factual Completeness: ${rc.factualCompleteness}/100`);
    if (rc.analyticalConfidence !== undefined) parts.push(`Analytical Confidence: ${rc.analyticalConfidence}/100`);
    if (rc.summary) parts.push(`Overview Summary: ${rc.summary}`);

    if (Array.isArray(rc.redFlags) && rc.redFlags.length > 0) {
      parts.push(`\nIdentified Red Flags (${rc.redFlags.length}):`);
      rc.redFlags.slice(0, 5).forEach((rf, i) => {
        parts.push(`  ${i + 1}. [${rf.category || 'General'}] ${rf.flag || ''}: ${rf.analysis || rf.quote || ''}`);
      });
      citations.push({ title: "Forensic Report Red Flags", reference: `${rc.redFlags.length} evidentiary issues identified` });
    }

    if (Array.isArray(rc.chronology) && rc.chronology.length > 0) {
      parts.push(`\nKey Chronological Events:`);
      rc.chronology.slice(0, 6).forEach((ch) => {
        parts.push(`  - ${ch.date || 'Undated'}: ${ch.event || ''} (Source: ${ch.source || 'Report'})`);
      });
      citations.push({ title: "Document Chronology", reference: `${rc.chronology.length} dated entries` });
    }

    if (Array.isArray(rc.contradictions) && rc.contradictions.length > 0) {
      parts.push(`\nDocumented Contradictions:`);
      rc.contradictions.slice(0, 4).forEach((ct, i) => {
        parts.push(`  ${i + 1}. ${ct.issue || ''} (Source A: ${ct.sourceA || 'Record'}, Source B: ${ct.sourceB || 'Record'})`);
      });
      citations.push({ title: "Evidentiary Contradictions", reference: `${rc.contradictions.length} discrepancies` });
    }

    if (Array.isArray(rc.complianceIssues) && rc.complianceIssues.length > 0) {
      parts.push(`\nAgency Compliance Findings:`);
      rc.complianceIssues.slice(0, 5).forEach((ci) => {
        parts.push(`  - [${ci.standard || 'CAS Standard'}]: ${ci.description || ''}`);
      });
      citations.push({ title: "CAS Compliance Matrix", reference: `${rc.complianceIssues.length} standard checkpoints` });
    }

    if (rc.fullTextExcerpt) {
      parts.push(`\nText Excerpt:\n${rc.fullTextExcerpt.slice(0, 3000)}`);
    }
    parts.push(`--- END FORENSIC REPORT CONTEXT ---`);
  }

  // 2. Specific form number in forms mode
  if (mode === 'forms') {
    citations.push({
      title: "Official Ontario Court Forms",
      reference: "Ontario Family Law Rules (O. Reg. 114/99)",
      url: OFFICIAL_ONTARIO_COURT_FORMS_URL,
    });
    if (options.formNumber) {
      const fNum = options.formNumber.toUpperCase().trim();
      parts.push(`USER SELECTED FORM: Form ${fNum}`);
      citations.push({
        title: `Form ${fNum}`,
        reference: `Prescribed Ontario Family Law Rules Form ${fNum}`,
        url: OFFICIAL_ONTARIO_COURT_FORMS_URL,
      });
    }
  }

  // 3. Raw uploaded files (for backwards compatibility / case cabinet files)
  if (Array.isArray(options.files) && options.files.length > 0) {
    const queryWords = (options.query || '').toLowerCase().split(/\s+/).filter((w) => w.length > 2);
    const scoredFiles = options.files.map((file) => {
      let score = 0;
      const content = (file.content || '').toLowerCase();
      const name = (file.name || '').toLowerCase();
      queryWords.forEach((word) => {
        if (name.includes(word)) score += 10;
        const matches = (content.match(new RegExp(word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g')) || []).length;
        score += matches;
      });
      return { ...file, score };
    });

    const topMatches = scoredFiles
      .filter((f) => f.score > 0 || scoredFiles.length <= 3)
      .sort((a, b) => b.score - a.score)
      .slice(0, 3);

    if (topMatches.length > 0) {
      parts.push(`--- RELEVANT UPLOADED FILES ---`);
      topMatches.forEach((f) => {
        parts.push(`[File: ${f.name} (${f.category || 'Document'})]\n${(f.content || '').slice(0, 2000)}`);
        citations.push({ title: f.name, reference: f.category || "Uploaded Document" });
      });
      parts.push(`--- END UPLOADED FILES ---`);
    }
  }

  // Add standard citations for other modes
  if (mode === 'rights') {
    citations.push({
      title: "Child, Youth and Family Services Act, 2017 (CYFSA)",
      reference: "S.O. 2017, c. 14, Sched. 1 (ss. 74, 75, 81, 94)",
      url: "https://www.ontario.ca/laws/statute/17c14",
    });
  } else if (mode === 'cas_process') {
    citations.push({
      title: "Ontario Child Protection Standards (2016)",
      reference: "Ministry of Children, Community and Social Services (Standards 1–7)",
    });
    citations.push({
      title: "Society Complaint Procedures Regulation",
      reference: "O. Reg. 155/18 under CYFSA",
    });
  }

  return { contextText: parts.join('\n\n'), citations };
}

/**
 * Format conversation history safely for Google Gemini REST format.
 */
export function formatGeminiContents(
  query: string,
  history: ChatHistoryTurn[] = []
): Array<{ role: 'user' | 'model'; parts: Array<{ text: string }> }> {
  const turns: Array<{ role: 'user' | 'model'; parts: Array<{ text: string }> }> = [];

  // Filter and limit recent turns
  const cleanTurns = history
    .filter((t) => t && typeof t.content === 'string' && t.content.trim().length > 0)
    .slice(-MAX_HISTORY_TURNS);

  for (const turn of cleanTurns) {
    const role: 'user' | 'model' = turn.role === 'user' ? 'user' : 'model';
    // If the list is empty and the first turn is 'model', skip it or Gemini rejects with 400
    if (turns.length === 0 && role === 'model') continue;

    // Gemini requires alternating roles. If two turns have the same role, combine them.
    const last = turns[turns.length - 1];
    if (last && last.role === role) {
      last.parts[0].text += `\n\n${turn.content.trim()}`;
    } else {
      turns.push({ role, parts: [{ text: turn.content.trim() }] });
    }
  }

  // Ensure last turn is user query
  const lastTurn = turns[turns.length - 1];
  if (lastTurn && lastTurn.role === 'user') {
    lastTurn.parts[0].text += `\n\n${query.trim()}`;
  } else {
    turns.push({ role: 'user', parts: [{ text: query.trim() }] });
  }

  return turns;
}

/**
 * Format conversation history safely for Anthropic Claude Messages API format.
 */
export function formatClaudeMessages(
  query: string,
  history: ChatHistoryTurn[] = []
): Array<{ role: 'user' | 'assistant'; content: string }> {
  const turns: Array<{ role: 'user' | 'assistant'; content: string }> = [];

  const cleanTurns = history
    .filter((t) => t && typeof t.content === 'string' && t.content.trim().length > 0)
    .slice(-MAX_HISTORY_TURNS);

  for (const turn of cleanTurns) {
    const role: 'user' | 'assistant' = turn.role === 'user' ? 'user' : 'assistant';
    if (turns.length === 0 && role === 'assistant') continue;

    const last = turns[turns.length - 1];
    if (last && last.role === role) {
      last.content += `\n\n${turn.content.trim()}`;
    } else {
      turns.push({ role, content: turn.content.trim() });
    }
  }

  const lastTurn = turns[turns.length - 1];
  if (lastTurn && lastTurn.role === 'user') {
    lastTurn.content += `\n\n${query.trim()}`;
  } else {
    turns.push({ role: 'user', content: query.trim() });
  }

  return turns;
}

export interface ChatServiceEnv {
  GEMINI_API_KEY?: string;
  GEMINI_CHAT_MODEL?: string;
  GEMINI_OCR_MODEL?: string;
  ANTHROPIC_API_KEY?: string;
  ANTHROPIC_API_URL?: string;
  ANTHROPIC_CHAT_MODEL?: string;
  DEFAULT_CHAT_MODEL?: 'gemini' | 'claude';
}

/**
 * Executes a conversational turn with Kace, using Gemini as default or Claude as configurable option.
 */
export async function executeKaceChat(
  env: ChatServiceEnv,
  options: KaceChatRequestOptions,
  deps: { fetcher?: typeof fetch } = {}
): Promise<KaceChatResponse> {
  const fetcher = deps.fetcher || fetch;
  const mode = options.mode || 'rights';
  const query = (options.query || '').trim();

  if (!query) {
    throw new Error("Missing question or prompt for Kace.");
  }
  if (query.length > MAX_QUERY_LENGTH) {
    throw new Error(`Question is too long (limit is ${MAX_QUERY_LENGTH} characters).`);
  }

  const { contextText, citations } = buildContextPayload(mode, options);
  const systemPrompt = buildKaceSystemPrompt(mode, contextText);

  // Model selection: default Gemini, Claude if requested or if GEMINI_API_KEY is missing
  const requestedModel = options.model || env.DEFAULT_CHAT_MODEL || 'gemini';
  const preferClaude = requestedModel === 'claude';

  let answerText = "";
  let modelUsed = "";

  // 1. If Claude requested and key available
  if (preferClaude && env.ANTHROPIC_API_KEY) {
    try {
      const claudeMessages = formatClaudeMessages(query, options.history);
      const wireModel = env.ANTHROPIC_CHAT_MODEL || 'claude-3-5-sonnet-20241022';
      const baseUrl = env.ANTHROPIC_API_URL || 'https://api.anthropic.com/v1/messages';

      const res = await fetcher(baseUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': env.ANTHROPIC_API_KEY,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model: wireModel,
          max_tokens: MAX_OUTPUT_TOKENS,
          system: systemPrompt,
          messages: claudeMessages,
        }),
        signal: AbortSignal.timeout(35_000),
      });

      if (res.ok) {
        const json: any = await res.json();
        const contentParts = Array.isArray(json?.content) ? json.content : [];
        answerText = contentParts
          .filter((p: any) => p.type === 'text')
          .map((p: any) => p.text)
          .join('\n');
        modelUsed = `Claude (${wireModel})`;
      } else {
        const errText = await res.text().catch(() => '');
        console.warn(`[Kace] Claude request failed (${res.status}): ${errText}`);
      }
    } catch (e: any) {
      console.warn("[Kace] Claude call exception, will check fallback:", e?.message);
    }
  }

  // 2. Default or fallback to Gemini
  if (!answerText && env.GEMINI_API_KEY) {
    try {
      const geminiModel = env.GEMINI_CHAT_MODEL || env.GEMINI_OCR_MODEL || 'gemini-3.6-flash';
      const geminiContents = formatGeminiContents(query, options.history);

      const geminiBody = {
        contents: geminiContents,
        systemInstruction: {
          parts: [{ text: systemPrompt }],
        },
        generationConfig: {
          maxOutputTokens: MAX_OUTPUT_TOKENS,
          temperature: 0.3,
        },
      };

      const res = await fetcher(
        `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(geminiModel)}:generateContent`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-goog-api-key': env.GEMINI_API_KEY,
          },
          body: JSON.stringify(geminiBody),
          signal: AbortSignal.timeout(30_000),
        }
      );

      if (res.ok) {
        const json: any = await res.json();
        const candidate = json?.candidates?.[0];
        const parts = candidate?.content?.parts;
        if (Array.isArray(parts)) {
          answerText = parts.map((p: any) => (typeof p?.text === 'string' ? p.text : '')).join('');
          modelUsed = `Gemini (${geminiModel})`;
        }
      } else {
        const errText = await res.text().catch(() => '');
        console.warn(`[Kace] Gemini request failed (${res.status}): ${errText}`);
      }
    } catch (e: any) {
      console.warn("[Kace] Gemini call exception:", e?.message);
    }
  }

  // 3. Fallback to Claude if Gemini failed but Claude key is present
  if (!answerText && env.ANTHROPIC_API_KEY && !preferClaude) {
    try {
      const claudeMessages = formatClaudeMessages(query, options.history);
      const wireModel = env.ANTHROPIC_CHAT_MODEL || 'claude-3-5-sonnet-20241022';
      const baseUrl = env.ANTHROPIC_API_URL || 'https://api.anthropic.com/v1/messages';

      const res = await fetcher(baseUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': env.ANTHROPIC_API_KEY,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model: wireModel,
          max_tokens: MAX_OUTPUT_TOKENS,
          system: systemPrompt,
          messages: claudeMessages,
        }),
        signal: AbortSignal.timeout(35_000),
      });

      if (res.ok) {
        const json: any = await res.json();
        const contentParts = Array.isArray(json?.content) ? json.content : [];
        answerText = contentParts
          .filter((p: any) => p.type === 'text')
          .map((p: any) => p.text)
          .join('\n');
        modelUsed = `Claude (${wireModel}) [Fallback]`;
      }
    } catch (e: any) {
      console.warn("[Kace] Claude fallback exception:", e?.message);
    }
  }

  // 4. Honest failure if no provider succeeded
  if (!answerText) {
    throw new Error(
      "Unable to generate response from Kace. The AI service is currently unavailable or unconfigured. Please check API keys or try again shortly."
    );
  }

  // Ensure disclaimer is attached
  let finalAnswer = answerText.trim();
  if (!finalAnswer.includes("legal advice")) {
    finalAnswer += `\n\n---\n*${KACE_LEGAL_DISCLAIMER}*`;
  }

  return {
    answer: finalAnswer,
    mode,
    modelUsed: modelUsed || 'AI Assistant',
    citations,
    disclaimer: KACE_LEGAL_DISCLAIMER,
  };
}
