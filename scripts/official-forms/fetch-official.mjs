#!/usr/bin/env node
// Downloads the retrievable official court-form fixtures from their official Ontario URLs and verifies each one.
//
// Usage: node scripts/official-forms/fetch-official.mjs [--historical-target <dir>] [--current-target <dir>] [--report <file>]
//
// Safety rules (each one has a test in api/services/officialFormDownloader.test.ts):
//   - HTTPS only, to an exact allowlisted host, with no credentials and no non-default port.
//   - Redirects are refused. A redirect means the pinned URL is stale, and a person must review it.
//   - Size limit per file. The limit is applied to the declared length and again while reading the body.
//   - Retries only for transport failures: network errors, timeouts, truncated bodies, 429, and 5xx. Bounded attempts.
//   - A complete download whose SHA-256 or length differs from the pin is reported as CHANGED_UPSTREAM. It is never
//     retried, never written, and never used to update a pin. The bytes are not kept.
//   - All-or-nothing. If any retrievable file fails, nothing is written. Writes never delete other files, so the six
//     historical PDF fixtures (which have no official source) are never touched.
//   - Output names come only from the manifests. Reports contain statuses and hashes, never file contents.
// Exit: 0 = every retrievable file verified and written; 2 = at least one CHANGED_UPSTREAM, review required;
//       1 = any other failure (nothing written).
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, renameSync, rmSync, existsSync, writeFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "..", "..");

export const ALLOWED_HOSTS = Object.freeze(["ontariocourtforms.on.ca"]);
export const DEFAULTS = Object.freeze({
  maxBytes: 5 * 1024 * 1024,
  timeoutMs: 60_000,
  attempts: 3,
  backoffMs: [1_000, 3_000],
});

/** Statuses a retry can fix. Everything else is final. */
const RETRYABLE = new Set(["NETWORK_ERROR", "TIMEOUT", "PARTIAL_DOWNLOAD", "HTTP_RETRYABLE"]);

export class DownloadError extends Error {
  constructor(code, message, detail) {
    super(message ?? code);
    this.code = code;
    // A transport error code such as ENOTFOUND or ECONNRESET. Never response content.
    this.detail = detail ?? null;
  }
}

export const SETS = [
  { name: "historical", manifest: join(here, "manifest.json"), target: join(repoRoot, "fixtures", "official-forms") },
  { name: "current", manifest: join(here, "current-manifest.json"), target: join(repoRoot, "fixtures", "official-forms-current") },
];

/** Refuses anything that is not an exact, plain HTTPS URL on an allowlisted host. Throws DownloadError. */
export function validateUrl(urlString, allowedHosts = ALLOWED_HOSTS) {
  let u;
  try {
    u = new URL(urlString);
  } catch {
    throw new DownloadError("PROTOCOL_REFUSED", "malformed URL");
  }
  if (u.protocol !== "https:") throw new DownloadError("PROTOCOL_REFUSED", "only https is allowed");
  if (u.username || u.password) throw new DownloadError("PROTOCOL_REFUSED", "credentials in URL are not allowed");
  if (u.port !== "") throw new DownloadError("PROTOCOL_REFUSED", "non-default port is not allowed");
  if (!allowedHosts.includes(u.hostname.toLowerCase())) throw new DownloadError("UNAPPROVED_HOST", `host not on the allowlist`);
  return u.toString();
}

const sha256 = buf => createHash("sha256").update(buf).digest("hex");

/** One request. Throws DownloadError with a status code. Never follows a redirect. */
async function fetchOnce(url, deps) {
  validateUrl(url, deps.allowedHosts);
  let res;
  try {
    res = await deps.fetchImpl(url, {
      redirect: "manual",
      signal: AbortSignal.timeout(deps.timeoutMs),
      headers: { accept: "application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,*/*;q=0.1" },
    });
  } catch (e) {
    if (e?.name === "TimeoutError" || e?.name === "AbortError") throw new DownloadError("TIMEOUT", "request timed out");
    throw new DownloadError("NETWORK_ERROR", "network request failed", typeof e?.cause?.code === "string" ? e.cause.code : (typeof e?.code === "string" ? e.code : null));
  }
  if (res.status >= 300 && res.status < 400) {
    throw new DownloadError("UNEXPECTED_REDIRECT", `redirect status ${res.status}; the pinned URL needs review`);
  }
  if (res.status === 429 || res.status >= 500) throw new DownloadError("HTTP_RETRYABLE", `http ${res.status}`);
  if (res.status !== 200) throw new DownloadError("HTTP_ERROR", `http ${res.status}`);

  const declared = res.headers.get("content-length");
  if (declared !== null && Number(declared) > deps.maxBytes) throw new DownloadError("SIZE_LIMIT", "declared size over limit");

  const chunks = [];
  let total = 0;
  if (res.body) {
    const reader = res.body.getReader();
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        total += value.byteLength;
        if (total > deps.maxBytes) {
          await reader.cancel();
          throw new DownloadError("SIZE_LIMIT", "body over limit");
        }
        chunks.push(Buffer.from(value));
      }
    } catch (e) {
      if (e instanceof DownloadError) throw e;
      throw new DownloadError("PARTIAL_DOWNLOAD", "body stream failed");
    }
  }
  const body = Buffer.concat(chunks);
  if (declared !== null && body.length !== Number(declared)) throw new DownloadError("PARTIAL_DOWNLOAD", "body shorter than declared");
  return body;
}

/** Downloads one manifest entry with bounded retries. Returns { status, bytes?, observedSha256?, observedBytes? }. */
export async function downloadEntry(entry, options = {}) {
  const deps = { ...DEFAULTS, allowedHosts: ALLOWED_HOSTS, fetchImpl: globalThis.fetch, sleep: ms => new Promise(r => setTimeout(r, ms)), ...options };
  if (!entry.retrievable) return { status: "NOT_RETRIEVABLE" };
  if (typeof entry.sourceUrl !== "string") return { status: "NO_SOURCE_URL" };

  let last = "NETWORK_ERROR";
  let lastDetail = null;
  for (let attempt = 1; attempt <= deps.attempts; attempt++) {
    try {
      const bytes = await fetchOnce(entry.sourceUrl, deps);
      const observedSha256 = sha256(bytes);
      if (bytes.length !== entry.byteLength || observedSha256 !== entry.sha256) {
        // A complete response with different bytes is a change to review, not a transient fault.
        return { status: "CHANGED_UPSTREAM", observedSha256, observedBytes: bytes.length, attempts: attempt };
      }
      return { status: "PASS", bytes, observedSha256, observedBytes: bytes.length, attempts: attempt };
    } catch (e) {
      const code = e instanceof DownloadError ? e.code : "NETWORK_ERROR";
      const detail = e instanceof DownloadError ? e.detail : null;
      if (!RETRYABLE.has(code)) return { status: code, attempts: attempt, detail };
      last = code;
      lastDetail = detail;
      if (attempt < deps.attempts) await deps.sleep(deps.backoffMs[Math.min(attempt - 1, deps.backoffMs.length - 1)]);
    }
  }
  return { status: last, attempts: deps.attempts, detail: lastDetail };
}

function readManifest(path) {
  const m = JSON.parse(readFileSync(path, "utf8"));
  for (const f of m.files) {
    if (typeof f.fileName !== "string" || basename(f.fileName) !== f.fileName || f.fileName.startsWith(".")) {
      throw new Error(`unsafe fixture name in ${basename(path)}`);
    }
  }
  return m;
}

/**
 * Downloads every retrievable entry of every set. Writes only when all of them pass.
 * Returns { ok, report, changed } where report has one row per retrievable entry (no contents).
 */
export async function fetchRetrievable({ sets = SETS, options = {} } = {}) {
  const report = [];
  const pending = [];
  for (const set of sets) {
    const manifest = readManifest(set.manifest);
    for (const entry of manifest.files.filter(f => f.retrievable)) {
      const r = await downloadEntry(entry, options);
      report.push({
        set: set.name,
        fileName: entry.fileName,
        status: r.status,
        attempts: r.attempts,
        observedSha256: r.observedSha256 ?? null,
        observedBytes: r.observedBytes ?? null,
        detail: r.detail ?? null,
      });
      pending.push({ set, entry, r });
    }
  }
  const changed = report.some(x => x.status === "CHANGED_UPSTREAM");
  const ok = report.length > 0 && report.every(x => x.status === "PASS");
  if (!ok) return { ok: false, changed, report, written: 0 };

  // Phase 2: write. Each file goes to a .part name first, then renames into place. Existing files are not removed.
  let written = 0;
  for (const { set, entry, r } of pending) {
    mkdirSync(set.target, { recursive: true });
    const dest = join(set.target, entry.fileName);
    const part = `${dest}.part-${process.pid}`;
    try {
      writeFileSync(part, r.bytes);
      renameSync(part, dest);
    } finally {
      rmSync(part, { force: true });
    }
    written++;
  }
  return { ok: true, changed: false, report, written };
}

function main(argv) {
  const get = flag => {
    const i = argv.indexOf(flag);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  const sets = SETS.map(s => ({
    ...s,
    target: resolve(get(s.name === "historical" ? "--historical-target" : "--current-target") ?? s.target),
  }));
  return fetchRetrievable({ sets }).then(result => {
    const reportPath = get("--report");
    if (reportPath) writeFileSync(reportPath, JSON.stringify({ generatedBy: "fetch-official.mjs", rows: result.report }, null, 2) + "\n");
    for (const row of result.report) {
      console.log(`${row.status.padEnd(18)} ${row.set.padEnd(10)} ${row.fileName}${row.attempts > 1 ? ` (attempts ${row.attempts})` : ""}`);
    }
    if (result.ok) {
      console.log(`${result.written} retrievable fixtures verified and written.`);
      return 0;
    }
    console.error(result.changed
      ? "NOT WRITTEN. Official source differs from a pin. Review the change; do not update the pin automatically."
      : "NOT WRITTEN. At least one retrievable file could not be verified.");
    return result.changed ? 2 : 1;
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main(process.argv.slice(2)).then(code => {
    process.exitCode = code;
  });
}
