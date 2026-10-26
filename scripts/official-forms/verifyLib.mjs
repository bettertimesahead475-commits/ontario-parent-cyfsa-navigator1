// Verifies official court-form files against the hash-pinned manifest. Reads file bytes only to hash them.
// It never prints file contents, never downloads, and never modifies a file.
import { createHash } from "node:crypto";
import { existsSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

export function sha256Of(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

/** Returns one result per manifest entry: status is PASS, MISSING, SIZE_MISMATCH, or HASH_MISMATCH. */
export function verifyDirectory(manifest, dir) {
  return manifest.files.map((entry) => {
    const path = join(dir, entry.fileName);
    const base = { fileName: entry.fileName, expectedBytes: entry.byteLength, expectedSha256: entry.sha256, path };
    if (!existsSync(path)) return { ...base, status: "MISSING" };
    const bytes = statSync(path).size;
    if (bytes !== entry.byteLength) return { ...base, status: "SIZE_MISMATCH", actualBytes: bytes };
    const actual = sha256Of(path);
    if (actual !== entry.sha256) return { ...base, status: "HASH_MISMATCH", actualSha256: actual };
    return { ...base, status: "PASS", actualBytes: bytes, actualSha256: actual };
  });
}

export function summarize(results) {
  const pass = results.filter((r) => r.status === "PASS").length;
  return { total: results.length, pass, failed: results.length - pass };
}
