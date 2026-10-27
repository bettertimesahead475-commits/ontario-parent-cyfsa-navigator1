// Verifies official court-form files against the hash-pinned manifest. Reads file bytes only to hash them.
// It never prints file contents, never downloads, and never modifies a file.
import { createHash } from "node:crypto";
import { existsSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

export function sha256Of(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

/**
 * The single rule for "matches its pin": exact byte length first, then SHA-256. Used by verifyDirectory and by the
 * official-source downloader, so both apply identical checks. Returns PASS, SIZE_MISMATCH, or HASH_MISMATCH.
 */
export function checkBytes(entry, bytes) {
  const actualSha256 = createHash("sha256").update(bytes).digest("hex");
  if (bytes.length !== entry.byteLength) return { status: "SIZE_MISMATCH", actualBytes: bytes.length, actualSha256 };
  if (actualSha256 !== entry.sha256) return { status: "HASH_MISMATCH", actualBytes: bytes.length, actualSha256 };
  return { status: "PASS", actualBytes: bytes.length, actualSha256 };
}

/** Returns one result per manifest entry: status is PASS, MISSING, SIZE_MISMATCH, or HASH_MISMATCH. */
export function verifyDirectory(manifest, dir) {
  return manifest.files.map((entry) => {
    const path = join(dir, entry.fileName);
    const base = { fileName: entry.fileName, expectedBytes: entry.byteLength, expectedSha256: entry.sha256, path };
    if (!existsSync(path)) return { ...base, status: "MISSING" };
    const size = statSync(path).size;
    if (size !== entry.byteLength) return { ...base, status: "SIZE_MISMATCH", actualBytes: size };
    const r = checkBytes(entry, readFileSync(path));
    return { ...base, status: r.status, actualBytes: r.actualBytes, actualSha256: r.actualSha256 };
  });
}

export function summarize(results) {
  const pass = results.filter((r) => r.status === "PASS").length;
  return { total: results.length, pass, failed: results.length - pass };
}
