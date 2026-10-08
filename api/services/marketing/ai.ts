// ---------------------------------------------------------------------------
// ai.ts — the content-drafting half of the Marketing Agent. Uses Claude to
// draft platform-tailored social posts for CYFSA Navigator, a nonprofit
// educational tool for self-represented Ontario parents in child-protection
// (CYFSA) matters.
//
// Because the audience is vulnerable families and the subject is legal, the
// guardrails here are strict and mirror the rest of the app's AI prompts:
// NO legal advice, NO guaranteed outcomes, NO fabricated testimonials /
// statistics / success rates / case results, NO fear-mongering. Every drafted
// post is a DRAFT that a human must approve before it can ever be published —
// this function never publishes anything, it only proposes copy.
//
// Self-contained Anthropic client (same pattern as services/access.ts's own
// Supabase client) so this module doesn't have to import the Express app.
// ---------------------------------------------------------------------------

import Anthropic from "@anthropic-ai/sdk";
import type { Platform } from "./types.js";
import { getAdapter } from "./adapters/registry.js";

const CLAUDE_MODELS = new Set(["claude-sonnet-5", "claude-haiku-4-5-20251001"]);
const DEFAULT_MODEL = "claude-sonnet-5";

let client: Anthropic | null = null;
function getClient(): Anthropic {
  if (client) return client;
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey || !apiKey.trim()) {
    throw Object.assign(
      new Error(
        "ANTHROPIC_API_KEY is not configured. Add the Claude API key in Vercel → Project → Settings → Environment Variables and redeploy."
      ),
      { statusCode: 503 }
    );
  }
  client = new Anthropic({ apiKey });
  return client;
}

const SYSTEM_PROMPT = `You are the content writer for CYFSA Navigator — a nonprofit, educational web tool that helps self-represented parents in Ontario understand the child-protection process under the Child, Youth and Family Services Act (CYFSA). You draft short social media posts that raise awareness of the free educational resources the tool offers.

Your audience includes parents who may be frightened, in crisis, or dealing with a child-protection investigation. Treat them with dignity and calm. These are non-negotiable rules:

1. NO LEGAL ADVICE. Never tell anyone what to do in their case, never state what an outcome will be, never imply the tool replaces a lawyer. Always position the tool as educational information, and encourage contacting a lawyer licensed by the Law Society of Ontario or Legal Aid Ontario.
2. NO FABRICATION. Never invent testimonials, quotes, user counts, success rates, statistics, case results, endorsements, or awards. Do not state numbers you were not given. If you have no real figure, don't use one.
3. NO FEAR-MONGERING OR TARGETING. Do not use scare tactics, do not imply the reader is in danger to drive clicks, do not sensationalize child apprehension. Be supportive and factual, not alarmist.
4. NO GUARANTEES. Never promise help, protection, winning, or any result. Use calm, hopeful, informational language ("learn about…", "understand your rights…", "a free guide to…").
5. ACCURACY. Describe only what the tool actually does: plain-language explanations of CYFSA, document analysis for educational review, Charter-rights information, templates, and a lawyer directory. Do not claim features that aren't mentioned.
6. TONE: warm, clear, plain-language, respectful. No emojis spam (at most one or two, tasteful). No ALL-CAPS shouting.

You write platform-appropriate copy and return STRICT JSON only.`;

export interface GenerateOptions {
  platforms: Platform[];
  topic: string;
  objective?: string;
  callToAction?: string;
  linkUrl?: string;
  variantsPerPlatform?: number;
  model?: string;
}

export interface DraftPost {
  platform: Platform;
  content: string;
  hashtags: string[];
}

// Minimal, resilient JSON extraction (mirrors _server.ts's extractJson intent).
function extractJson(text: string): any {
  const trimmed = (text || "").trim();
  try {
    return JSON.parse(trimmed);
  } catch {
    /* try fenced */
  }
  const fence = trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
  if (fence) {
    try {
      return JSON.parse(fence[1].trim());
    } catch {
      /* keep trying */
    }
  }
  const start = trimmed.indexOf("[");
  const end = trimmed.lastIndexOf("]");
  if (start !== -1 && end > start) {
    try {
      return JSON.parse(trimmed.substring(start, end + 1));
    } catch {
      /* keep trying */
    }
  }
  const objStart = trimmed.indexOf("{");
  const objEnd = trimmed.lastIndexOf("}");
  if (objStart !== -1 && objEnd > objStart) {
    try {
      return JSON.parse(trimmed.substring(objStart, objEnd + 1));
    } catch {
      /* fall through */
    }
  }
  throw new Error("The content generator returned a response that could not be parsed as JSON.");
}

/**
 * Drafts social posts. Returns DRAFTS only — nothing is published. The caller
 * persists these as status='draft' for human review.
 */
export async function generateMarketingPosts(opts: GenerateOptions): Promise<{ drafts: DraftPost[]; model: string }> {
  if (!opts.platforms?.length) throw Object.assign(new Error("At least one platform is required."), { statusCode: 400 });
  if (!opts.topic?.trim()) throw Object.assign(new Error("A topic/theme is required."), { statusCode: 400 });

  const model = CLAUDE_MODELS.has(opts.model || "") ? (opts.model as string) : DEFAULT_MODEL;
  const variants = Math.min(Math.max(opts.variantsPerPlatform ?? 1, 1), 3);

  const platformSpecs = opts.platforms
    .map((p) => {
      const a = getAdapter(p);
      const limit = a.maxContentLength > 0 ? `${a.maxContentLength} characters max` : "no strict limit";
      const media = a.requiresMedia ? " (this platform requires an image/video; write a caption that works with a supportive, non-identifying stock-style image)" : "";
      return `- ${p} (${a.displayName}): ${limit}${media}`;
    })
    .join("\n");

  const userPrompt = `Draft social media posts about this topic for CYFSA Navigator.

TOPIC / THEME: ${opts.topic}
${opts.objective ? `CAMPAIGN OBJECTIVE: ${opts.objective}` : ""}
${opts.callToAction ? `SUGGESTED CALL TO ACTION: ${opts.callToAction}` : ""}
${opts.linkUrl ? `LINK TO INCLUDE (append naturally, do not fabricate a different URL): ${opts.linkUrl}` : ""}

Write ${variants} distinct variant(s) for EACH of these platforms, respecting each platform's limit and norms:
${platformSpecs}

Return STRICT JSON — an array of objects, no prose, no markdown fences:
[
  { "platform": "<one of: ${opts.platforms.join(", ")}>", "content": "the post text (without hashtags)", "hashtags": ["Relevant", "Hashtags", "WithoutHashSymbol"] }
]

Keep hashtags relevant and non-misleading (e.g. OntarioParents, CYFSA, KnowYourRights, ChildProtection, LegalAidOntario). Do not include a hashtag that implies a guarantee or outcome. Remember: educational only, no legal advice, no fabricated numbers or testimonials.`;

  const resp = await getClient().messages.create({
    model,
    max_tokens: 4000,
    thinking: { type: "disabled" as const },
    system: SYSTEM_PROMPT,
    messages: [{ role: "user", content: userPrompt }],
  });

  const text = resp.content
    .filter((b) => b.type === "text")
    .map((b) => (b as any).text)
    .join("");

  const parsed = extractJson(text);
  const rawArray: any[] = Array.isArray(parsed) ? parsed : Array.isArray(parsed?.posts) ? parsed.posts : [];
  if (!rawArray.length) {
    throw Object.assign(new Error("The content generator did not return any usable drafts."), { statusCode: 502 });
  }

  const allowed = new Set(opts.platforms);
  const drafts: DraftPost[] = [];
  for (const item of rawArray) {
    const platform = item?.platform as Platform;
    if (!allowed.has(platform)) continue; // never trust the model to invent a platform
    const content = typeof item?.content === "string" ? item.content.trim() : "";
    if (!content) continue;
    const hashtags = Array.isArray(item?.hashtags)
      ? item.hashtags.map((h: any) => String(h).replace(/^#/, "").trim()).filter(Boolean).slice(0, 10)
      : [];
    // Hard-enforce the platform length cap even if the model overshot.
    const a = getAdapter(platform);
    const capped = a.maxContentLength > 0 ? content.slice(0, a.maxContentLength) : content;
    drafts.push({ platform, content: capped, hashtags });
  }

  if (!drafts.length) {
    throw Object.assign(new Error("The content generator returned drafts, but none matched the requested platforms."), { statusCode: 502 });
  }

  return { drafts, model };
}
