#!/usr/bin/env node
// Downloads the officially retrievable court-form fixtures from their official Ontario URLs, verifies each one against
// its pinned SHA-256 and byte length, and installs them only when every file has verified.
//
// Usage: node scripts/official-forms/fetch-official.mjs [--historical-target <dir>] [--current-target <dir>] [--report <file>]
//
// Rules (each has a test in api/services/officialFormDownloader.test.ts):
//   - HTTPS only, to the exact allowlisted host, under the official court-forms path, with no credentials and no
//     non-default port.
//   - No redirects, of any kind. A redirect means the pinned URL is stale. The file is reported for review.
//   - A 10 MB limit per file, checked on the declared length and again while the body streams.
//   - A 60 s timeout per request. Retries (3 attempts, bounded backoff) apply only to transport failures: network
//     errors, timeouts, truncated bodies, 429, and 5xx.
//   - Every downloaded file is checked with checkBytes() (scripts/official-forms/verifyLib.mjs): exact length, then
//     SHA-256. A complete response that differs is CHANGED_UPSTREAM. It is never retried, never installed, and its bytes
//     are discarded. No pin is ever updated by this script.
//   - All 11 files are downloaded and verified before any destination file is touched.
//   - Installation is staged, then applied file by file with backups. If any step fails, every change is rolled back, so
//     the destination is restored to its prior state. Installation never deletes a file it did not replace.
//   - Requests ask for identity encoding. A compressed response is refused, so declared and decoded lengths always agree.
//   - Before any request, the script refuses to run if an earlier install left .stage or .backup files behind.
//   - Limits, stated plainly: a crash or power loss between the backup step and the swap can leave a destination missing,
//     with its original in a .backup file. Nothing is journaled, so the restore is manual. Rollback covers failures the
//     process can observe (write, rename, and remove errors), not a process that dies mid-install. The run also has no
//     upper bound on total time beyond its per-request timeout (up to 3 attempts per file, 60 s each).
//   - The six superseded historical PDFs have no official source. They are not in the retrievable set and are never touched.
//   - Output names come only from the manifests and must match a strict pattern. Reports hold statuses and hashes only.
// Exit codes: 0 = all retrievable files verified and installed. 2 = at least one CHANGED_UPSTREAM (review required).
//             1 = any other failure. In every non-zero case nothing was installed.
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { checkBytes } from "./verifyLib.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "..", "..");

export const ALLOWED_HOSTS = Object.freeze(["ontariocourtforms.on.ca"]);
export const ALLOWED_PATH_PREFIX = "/static/media/uploads/courtforms/";
export const DEFAULTS = Object.freeze({
  maxBytes: 10 * 1024 * 1024,
  timeoutMs: 60_000,
  attempts: 3,
  backoffMs: [1_000, 3_000],
});
const FILE_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,200}\.(pdf|docx)$/;

/** Retryable transport failures. Anything else is final on the first attempt. */
const RETRYABLE = new Set(["NETWORK_ERROR", "TIMEOUT", "PARTIAL_DOWNLOAD", "SOURCE_UNAVAILABLE"]);

export class DownloadError extends Error {
  constructor(code, message, detail) {
    super(message ?? code);
    this.code = code;
    // A transport error code such as ENOTFOUND or ECONNRESET, or an HTTP status number. Never response content.
    this.detail = detail ?? null;
  }
}

export class InstallError extends Error {
  constructor(message, rolledBack, rollbackErrors) {
    super(message);
    this.name = "InstallError";
    this.rolledBack = rolledBack;
    this.rollbackErrors = rollbackErrors;
  }
}

export const SETS = [
  { name: "historical", manifest: join(here, "manifest.json"), target: join(repoRoot, "fixtures", "official-forms") },
  { name: "current", manifest: join(here, "current-manifest.json"), target: join(repoRoot, "fixtures", "official-forms-current") },
];

/** Refuses anything that is not an exact HTTPS URL on an allowlisted host under the official path. Throws DownloadError. */
export function validateUrl(urlString, allowedHosts = ALLOWED_HOSTS) {
  let u;
  try {
    u = new URL(urlString);
  } catch {
    throw new DownloadError("PROTOCOL_REFUSED", "the pinned URL is malformed");
  }
  if (u.protocol !== "https:") throw new DownloadError("PROTOCOL_REFUSED", "only https is allowed");
  if (u.username || u.password) throw new DownloadError("PROTOCOL_REFUSED", "credentials in a URL are not allowed");
  if (u.port !== "") throw new DownloadError("PROTOCOL_REFUSED", "a non-default port is not allowed");
  if (!allowedHosts.includes(u.hostname.toLowerCase())) throw new DownloadError("UNAPPROVED_HOST", "host is not on the allowlist");
  if (!u.pathname.startsWith(ALLOWED_PATH_PREFIX)) throw new DownloadError("UNAPPROVED_PATH", "path is outside the official court-forms location");
  return u.toString();
}

/** Validates a manifest and returns it. Throws on any unsafe file name, so nothing is requested or written. */
export function readManifest(path) {
  const m = JSON.parse(readFileSync(path, "utf8"));
  for (const f of m.files) {
    if (typeof f.fileName !== "string" || basename(f.fileName) !== f.fileName || !FILE_NAME.test(f.fileName)) {
      throw new Error(`unsafe fixture name in ${basename(path)}`);
    }
  }
  return m;
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
      // Identity encoding keeps the declared Content-Length equal to the bytes read. A compressed body is refused below.
      headers: {
        accept: "application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,*/*;q=0.1",
        "accept-encoding": "identity",
      },
    });
  } catch (e) {
    if (e?.name === "TimeoutError" || e?.name === "AbortError") throw new DownloadError("TIMEOUT", "the request timed out");
    const code = typeof e?.cause?.code === "string" ? e.cause.code : typeof e?.code === "string" ? e.code : null;
    throw new DownloadError("NETWORK_ERROR", "the request failed before a response", code);
  }
  if (res.status >= 300 && res.status < 400) {
    throw new DownloadError("UNEXPECTED_REDIRECT", "the official source redirected this URL; the pinned URL needs review", String(res.status));
  }
  if (res.status === 404 || res.status === 410) {
    throw new DownloadError("SOURCE_NOT_FOUND", "the official source no longer serves this URL", String(res.status));
  }
  if (res.status === 429 || res.status >= 500) {
    throw new DownloadError("SOURCE_UNAVAILABLE", "the official source is temporarily unavailable", String(res.status));
  }
  if (res.status !== 200) throw new DownloadError("HTTP_ERROR", "the official source returned an unexpected status", String(res.status));

  const encoding = res.headers.get("content-encoding");
  if (encoding && encoding.trim().toLowerCase() !== "identity") {
    throw new DownloadError("UNEXPECTED_ENCODING", "the official source sent a compressed body; only identity encoding is accepted", encoding.slice(0, 32));
  }
  const declared = res.headers.get("content-length");
  if (declared !== null && Number(declared) > deps.maxBytes) {
    throw new DownloadError("SIZE_LIMIT", "the declared size is over the 10 MB limit", declared);
  }
  if (!res.body) throw new DownloadError("PARTIAL_DOWNLOAD", "the response had no body");

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
          throw new DownloadError("SIZE_LIMIT", "the body is over the 10 MB limit");
        }
        chunks.push(Buffer.from(value));
      }
    } catch (e) {
      if (e instanceof DownloadError) throw e;
      if (e?.name === "TimeoutError" || e?.name === "AbortError") throw new DownloadError("TIMEOUT", "the body read timed out");
      throw new DownloadError("PARTIAL_DOWNLOAD", "the body stream failed before it completed");
    }
  }
  const body = Buffer.concat(chunks);
  if (declared !== null && body.length !== Number(declared)) {
    throw new DownloadError("PARTIAL_DOWNLOAD", `the body is ${body.length} bytes; ${declared} were declared`);
  }
  return body;
}

/**
 * Downloads one manifest entry with bounded retries. Resolves to:
 *   { status: "PASS", bytes, observedSha256, observedBytes, attempts }
 *   { status: "CHANGED_UPSTREAM", observedSha256, observedBytes, attempts }   (bytes discarded)
 *   { status: <failure code>, detail, attempts }
 */
export async function downloadEntry(entry, options = {}) {
  const deps = {
    ...DEFAULTS,
    allowedHosts: ALLOWED_HOSTS,
    fetchImpl: globalThis.fetch,
    sleep: ms => new Promise(r => setTimeout(r, ms)),
    ...options,
  };
  if (!entry.retrievable) return { status: "NOT_RETRIEVABLE", attempts: 0 };
  if (typeof entry.sourceUrl !== "string") return { status: "NO_SOURCE_URL", attempts: 0 };

  let last = "SOURCE_UNAVAILABLE";
  let lastDetail = null;
  for (let attempt = 1; attempt <= deps.attempts; attempt++) {
    try {
      const bytes = await fetchOnce(entry.sourceUrl, deps);
      const check = checkBytes(entry, bytes);
      if (check.status !== "PASS") {
        // A complete response with different bytes is a change to review, not a transient fault.
        return { status: "CHANGED_UPSTREAM", reason: check.status, observedSha256: check.actualSha256, observedBytes: bytes.length, attempts: attempt };
      }
      return { status: "PASS", bytes, observedSha256: check.actualSha256, observedBytes: bytes.length, attempts: attempt };
    } catch (e) {
      // Only DownloadError is a download outcome. Anything else is a programming error and must not be reported as a network fault.
      if (!(e instanceof DownloadError)) throw e;
      const code = e.code;
      const detail = e.detail;
      if (!RETRYABLE.has(code)) return { status: code, detail, attempts: attempt };
      last = code;
      lastDetail = detail;
      if (attempt < deps.attempts) await deps.sleep(deps.backoffMs[Math.min(attempt - 1, deps.backoffMs.length - 1)]);
    }
  }
  return { status: last, detail: lastDetail, attempts: deps.attempts };
}

/** Plain-language message for one report row. Says what happened and what the operator should do. */
export function messageFor(row) {
  switch (row.status) {
    case "PASS":
      return "verified";
    case "CHANGED_UPSTREAM":
      return `the official source serves different bytes for ${row.fileName} (${row.reason}; observed SHA-256 ${row.observedSha256}). ` +
        "Nothing was installed. Review the change at the official source, then update the pin in a reviewed commit. The script does not update pins.";
    case "SOURCE_NOT_FOUND":
      return `the official source no longer serves ${row.fileName} (HTTP ${row.detail}). The official page may have moved the file. Review the sourceUrl in the manifest. Nothing was installed.`;
    case "SOURCE_UNAVAILABLE":
      return `the official source is unavailable for ${row.fileName} (last HTTP ${row.detail ?? "error"} after ${row.attempts} attempts). Retry later. Nothing was installed.`;
    case "UNEXPECTED_REDIRECT":
      return `the official source redirected ${row.fileName}. Redirects are refused. Review the sourceUrl. Nothing was installed.`;
    case "UNAPPROVED_HOST":
    case "UNAPPROVED_PATH":
    case "PROTOCOL_REFUSED":
      return `the pinned URL for ${row.fileName} is not an approved official URL (${row.status}). Fix the manifest entry. Nothing was requested beyond the refusal.`;
    case "SIZE_LIMIT":
      return `${row.fileName} is over the 10 MB limit. Nothing was installed.`;
    case "PARTIAL_DOWNLOAD":
      return `${row.fileName} arrived incomplete after ${row.attempts} attempts. Retry later. Nothing was installed.`;
    case "TIMEOUT":
      return `${row.fileName} timed out after ${row.attempts} attempts (60 s each). Retry later. Nothing was installed.`;
    case "NETWORK_ERROR":
      return `could not reach the official source for ${row.fileName}${row.detail ? ` (${row.detail})` : ""}. Check connectivity. Nothing was installed.`;
    case "UNEXPECTED_ENCODING":
      return `the official source sent ${row.fileName} compressed (${row.detail ?? "unknown encoding"}). The downloader accepts identity encoding only, so the bytes cannot be checked. Nothing was installed.`;
    case "NO_SOURCE_URL":
      return `${row.fileName} has no sourceUrl in its manifest entry. Nothing was installed.`;
    case "HTTP_ERROR":
      return `the official source returned an unexpected status for ${row.fileName} (HTTP ${row.detail}). Nothing was installed.`;
    case "INSTALL_FAILED":
      return `installation failed for ${row.fileName}; ${row.rolledBack ? "every change was rolled back" : "ROLLBACK INCOMPLETE, check the destination folder"}.`;
    default:
      return `unexpected status ${row.status}. Nothing was installed.`;
  }
}

/** Default file operations. Tests inject replacements to simulate failures. */
export const defaultFsOps = {
  writeFile: (p, bytes) => writeFileSync(p, bytes, { flag: "wx" }),
  rename: (from, to) => renameSync(from, to),
  remove: p => rmSync(p, { force: true }),
};

/**
 * Installs verified bytes into their destinations. `installs` is [{ dest, bytes }], already verified by the caller.
 * Stage all files, then move each into place, keeping a backup of any file it replaces. On any failure, undo every
 * completed step in reverse order. Throws InstallError describing whether the rollback completed.
 */
export function installVerified(installs, fsOps = defaultFsOps) {
  const stamp = `${process.pid}-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
  const staged = [];
  const placed = [];
  const backed = [];
  try {
    for (const { dest, bytes } of installs) {
      mkdirSync(dirname(dest), { recursive: true });
      const stage = `${dest}.stage-${stamp}`;
      // Recorded before the write, so a partially written stage is removed by the rollback too.
      staged.push({ dest, stage });
      fsOps.writeFile(stage, bytes);
    }
    for (const s of staged) {
      if (existsSync(s.dest)) {
        const backup = `${s.dest}.backup-${stamp}`;
        fsOps.rename(s.dest, backup);
        backed.push({ dest: s.dest, backup });
      }
      fsOps.rename(s.stage, s.dest);
      placed.push(s.dest);
    }
  } catch (cause) {
    const rollbackErrors = [];
    for (const dest of [...placed].reverse()) {
      try { fsOps.remove(dest); } catch (e) { rollbackErrors.push(`remove ${basename(dest)}: ${e.code ?? e.name}`); }
    }
    for (const b of [...backed].reverse()) {
      try { fsOps.rename(b.backup, b.dest); } catch (e) { rollbackErrors.push(`restore ${basename(b.dest)}: ${e.code ?? e.name}`); }
    }
    for (const s of staged) {
      try { fsOps.remove(s.stage); } catch (e) { rollbackErrors.push(`unstage ${basename(s.stage)}: ${e.code ?? e.name}`); }
    }
    throw new InstallError(`installation failed (${cause.code ?? cause.name ?? "error"})`, rollbackErrors.length === 0, rollbackErrors);
  }
  // Success: the backups are no longer needed.
  for (const b of backed) {
    try { fsOps.remove(b.backup); } catch { /* a leftover backup is harmless; it is not a fixture */ }
  }
}

const INTERRUPTED = /\.(stage|backup)-\d+-\d+-\d+$/;

/**
 * Returns the stage and backup files left behind by an install that was interrupted (for example, by a crash or a power
 * loss between the backup step and the swap). A destination can be missing while its backup exists, so the operator must
 * restore it by hand. The downloader refuses to run while any such file is present.
 */
export function findInterruptedInstallFiles(dirs) {
  const found = [];
  for (const dir of dirs) {
    if (!existsSync(dir)) continue;
    for (const name of readdirSync(dir)) if (INTERRUPTED.test(name)) found.push(join(dir, name));
  }
  return found;
}

/**
 * Downloads every retrievable entry of every set, verifies each, and installs all of them or none.
 * Returns { ok, changed, report, written }. The report has one row per retrievable entry; it holds no file content.
 */
export async function fetchRetrievable({ sets = SETS, options = {} } = {}) {
  const pending = [];
  for (const set of sets) {
    const manifest = readManifest(set.manifest);
    for (const entry of manifest.files.filter(f => f.retrievable)) pending.push({ set, entry });
  }
  if (pending.length === 0) throw new Error("no retrievable entries; refusing to report success");
  const interrupted = findInterruptedInstallFiles(sets.map(set => set.target));
  if (interrupted.length) {
    throw new Error(
      `an earlier install was interrupted and left ${interrupted.map(p => basename(p)).join(", ")}. ` +
      "Restore each destination from its .backup file by hand, remove the leftovers, and run again. Nothing was downloaded or changed."
    );
  }

  const report = [];
  const downloads = [];
  for (const { set, entry } of pending) {
    const r = await downloadEntry(entry, options);
    const row = {
      set: set.name,
      fileName: entry.fileName,
      status: r.status,
      reason: r.reason ?? null,
      attempts: r.attempts ?? null,
      detail: r.detail ?? null,
      observedSha256: r.observedSha256 ?? null,
      observedBytes: r.observedBytes ?? null,
    };
    row.message = messageFor(row);
    report.push(row);
    downloads.push({ set, entry, r, row });
  }

  const changed = report.some(x => x.status === "CHANGED_UPSTREAM");
  if (!report.every(x => x.status === "PASS")) return { ok: false, changed, report, written: 0 };

  // Every file verified. Only now is any destination touched.
  const installs = downloads.map(({ set, entry, r }) => ({ dest: join(set.target, entry.fileName), bytes: r.bytes }));
  try {
    installVerified(installs, options.fsOps ?? defaultFsOps);
  } catch (e) {
    if (!(e instanceof InstallError)) throw e;
    for (const row of report) {
      row.status = "INSTALL_FAILED";
      row.rolledBack = e.rolledBack;
      row.message = messageFor(row) + (e.rollbackErrors.length ? ` Rollback problems: ${e.rollbackErrors.join("; ")}.` : "");
    }
    return { ok: false, changed: false, report, written: 0, installError: e.message, rolledBack: e.rolledBack };
  }
  return { ok: true, changed: false, report, written: installs.length };
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
    if (reportPath) {
      writeFileSync(reportPath, JSON.stringify({ generatedBy: "fetch-official.mjs", ok: result.ok, written: result.written, rows: result.report }, null, 2) + "\n");
    }
    for (const row of result.report) console.log(`${row.status.padEnd(20)} ${row.set.padEnd(10)} ${row.fileName}`);
    if (result.ok) {
      console.log(`${result.written} retrievable fixtures verified and installed.`);
      return 0;
    }
    for (const row of result.report.filter(x => x.status !== "PASS")) console.error(`  ${row.fileName}: ${row.message}`);
    console.error(result.changed
      ? "NOT INSTALLED. The official source changed for at least one file. Review it; the pin was not updated."
      : "NOT INSTALLED. At least one retrievable file could not be verified. Nothing was changed.");
    return result.changed ? 2 : 1;
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main(process.argv.slice(2)).then(code => {
    process.exitCode = code;
  }, e => {
    console.error(`error: ${e.message}`);
    process.exitCode = 1;
  });
}
