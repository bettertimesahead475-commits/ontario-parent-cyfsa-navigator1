/**
 * Records real retrieval checks for the legal authority registry.
 *
 *   npm run verify:authorities            fetch every authority, write api/services/legalAuthorityVerification.ts
 *   npm run verify:authorities -- --dry   fetch and report, write nothing
 *
 * Run it somewhere that can reach the publishers (Ontario e-Laws, laws-lois.justice.gc.ca, CanLII).
 * For each registry entry that has a link it fetches the page and confirms that (1) the response is
 * successful and (2) the page text contains every string in the entry's `verifyText`. The outcome,
 * including failures, is written to legalAuthorityVerification.ts, which is what lets the analyzer
 * show VERIFIED. Nothing here is guessed: an entry with no link is not checkable and stays CANDIDATE.
 *
 * Outcomes:
 *   ok            fetched, 2xx, every verifyText string found        -> VERIFIED, link shown
 *   definite miss 404/410, or fetched but a string was not found     -> link withheld, still CANDIDATE
 *   inconclusive  blocked (401/403/429), 5xx, timeout, network error -> nothing learned, link unchecked
 */

import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { LEGAL_AUTHORITY_REGISTRY, entryFingerprint, type RegistryEntry } from "../api/services/legalAuthorityRegistry.js";
import type { AuthorityVerificationFile, AuthorityVerificationRecord } from "../api/services/legalAuthorityVerification.js";

export type Fetcher = (url: string, init?: { signal?: AbortSignal; headers?: Record<string, string> }) => Promise<{
  status: number;
  url?: string;
  text: () => Promise<string>;
}>;

const ENTITIES: Record<string, string> = { "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": '"', "&#39;": "'", "&apos;": "'", "&nbsp;": " ", "&rsquo;": "'", "&lsquo;": "'", "&ldquo;": '"', "&rdquo;": '"' };

export function pageText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&(?:amp|lt|gt|quot|apos|nbsp|rsquo|lsquo|ldquo|rdquo|#39);/g, (m) => ENTITIES[m] ?? m)
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/\s+/g, " ")
    .toLowerCase();
}

const needle = (s: string) => s.replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/\s+/g, " ").toLowerCase().trim();

export async function verifyEntry(entry: RegistryEntry, fetcher: Fetcher, now: () => Date = () => new Date()): Promise<AuthorityVerificationRecord | null> {
  const url = entry.officialUrl;
  if (!url) return null; // no link to check; the entry stays a candidate
  const base = { checkedAt: now().toISOString(), fingerprint: entryFingerprint(entry), httpStatus: null as number | null };
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20_000);
  try {
    const res = await fetcher(url, {
      signal: controller.signal,
      headers: { "User-Agent": "CYFSA-Navigator-authority-check/1.0 (+https://cyfsanavigator.com)", Accept: "text/html" },
    });
    const status = res.status;
    if (status === 404 || status === 410) {
      return { ...base, ok: false, httpStatus: status, finalUrl: res.url, matched: [], missing: entry.verifyText, error: `HTTP ${status}` };
    }
    if (status === 401 || status === 403 || status === 429 || status >= 500 || status < 200 || status >= 300) {
      return { ...base, ok: false, inconclusive: true, httpStatus: status, finalUrl: res.url, matched: [], missing: [], error: `HTTP ${status}: the publisher did not return the page, so nothing was learned` };
    }
    const text = pageText(await res.text());
    const matched = entry.verifyText.filter((v) => text.includes(needle(v)));
    const missing = entry.verifyText.filter((v) => !text.includes(needle(v)));
    // A page that loads but contains none of the expected text is usually a bot wall or a script
    // shell, not evidence the authority is wrong: inconclusive, unless some text matched.
    if (matched.length === 0 && text.length < 2000) {
      return { ...base, ok: false, inconclusive: true, httpStatus: status, finalUrl: res.url, matched, missing, error: "The page returned almost no text (possibly script-rendered or blocked)." };
    }
    return { ...base, ok: missing.length === 0, httpStatus: status, finalUrl: res.url, matched, missing };
  } catch (err: any) {
    return { ...base, ok: false, inconclusive: true, httpStatus: null, matched: [], missing: [], error: String(err?.name === "AbortError" ? "timed out" : err?.message || err).slice(0, 200) };
  } finally {
    clearTimeout(timer);
  }
}

export async function runVerification(
  fetcher: Fetcher,
  entries: RegistryEntry[] = LEGAL_AUTHORITY_REGISTRY,
  now: () => Date = () => new Date()
): Promise<AuthorityVerificationFile> {
  // Entries share publisher pages (the Charter, the CYFSA): fetch each distinct URL once per entry
  // but never hammer a publisher; run sequentially.
  const out: AuthorityVerificationFile = { schemaVersion: 1, generatedAt: now().toISOString(), entries: {} };
  for (const e of entries) {
    const rec = await verifyEntry(e, fetcher, now);
    if (rec) out.entries[e.key] = rec;
  }
  return out;
}

export function renderVerificationFile(file: AuthorityVerificationFile): string {
  return `/**
 * Recorded retrieval checks for the legal authority registry.
 *
 * GENERATED by \`npm run verify:authorities\` (scripts/verifyLegalAuthorities.ts). Do not edit by
 * hand: a hand-written record would be exactly the unverified claim of verification this file
 * exists to prevent.
 */

export interface AuthorityVerificationRecord {
  /** ISO time of the check. */
  checkedAt: string;
  /** Matches entryFingerprint(entry) at check time; a changed entry invalidates the record. */
  fingerprint: string;
  ok: boolean;
  /**
   * True when the check could not reach a conclusion (the publisher blocked the request, rate-limited
   * it, errored, or the network failed). An inconclusive check never marks a link broken and never
   * marks an authority verified.
   */
  inconclusive?: boolean;
  httpStatus: number | null;
  finalUrl?: string;
  /** Strings from the entry's verifyText that were found on the fetched page. */
  matched: string[];
  /** Strings that were required but not found. */
  missing: string[];
  error?: string;
}

export interface AuthorityVerificationFile {
  schemaVersion: 1;
  /** ISO time of the most recent run, or null if the script has never been run. */
  generatedAt: string | null;
  entries: Record<string, AuthorityVerificationRecord>;
}

export const LEGAL_AUTHORITY_VERIFICATION: AuthorityVerificationFile = ${JSON.stringify(file, null, 2)};
`;
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) {
  const dry = process.argv.includes("--dry");
  const file = await runVerification((url, init) => fetch(url, { ...init, redirect: "follow" }));
  const recs = Object.entries(file.entries);
  const ok = recs.filter(([, r]) => r.ok).length;
  const inconclusive = recs.filter(([, r]) => r.inconclusive).length;
  const failed = recs.length - ok - inconclusive;
  for (const [key, r] of recs) {
    console.log(`${r.ok ? "VERIFIED    " : r.inconclusive ? "INCONCLUSIVE" : "FAILED      "} ${key}  ${r.error ?? ""}${r.missing.length ? "  missing: " + r.missing.join(" | ") : ""}`);
  }
  console.log(`\n${ok} verified, ${failed} failed, ${inconclusive} inconclusive, ${LEGAL_AUTHORITY_REGISTRY.length - recs.length} without a link to check.`);
  if (dry) console.log("Dry run: nothing written.");
  else {
    writeFileSync(new URL("../api/services/legalAuthorityVerification.ts", import.meta.url), renderVerificationFile(file));
    console.log("Wrote api/services/legalAuthorityVerification.ts. Review the diff and commit it.");
  }
}
