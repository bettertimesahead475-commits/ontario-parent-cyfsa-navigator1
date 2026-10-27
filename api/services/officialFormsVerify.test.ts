import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
// The verifier's logic only. These bytes are throwaway fixtures for exercising the comparison; they are not the
// official forms, and no result here is evidence that an official form is present.
import { summarize, verifyDirectory } from "../../scripts/official-forms/verifyLib.mjs";

const sha = (b: Buffer) => createHash("sha256").update(b).digest("hex");
let dir: string;
const bytesA = Buffer.from("throwaway-A");
const bytesB = Buffer.from("throwaway-B-longer");

function manifestFor(entries: Array<{ fileName: string; byteLength: number; sha256: string }>) {
  return { files: entries };
}

describe("official-form verifier logic", () => {
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), "forms-verify-")); });
  afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

  it("reports MISSING when a file is absent", () => {
    const r = verifyDirectory(manifestFor([{ fileName: "a.pdf", byteLength: 3, sha256: sha(bytesA) }]), dir);
    expect(r[0].status).toBe("MISSING");
  });

  it("reports SIZE_MISMATCH before hashing when the byte length differs", () => {
    writeFileSync(join(dir, "a.pdf"), bytesB);
    const r = verifyDirectory(manifestFor([{ fileName: "a.pdf", byteLength: bytesA.length, sha256: sha(bytesA) }]), dir);
    expect(r[0].status).toBe("SIZE_MISMATCH");
  });

  it("reports HASH_MISMATCH when the size matches but the content does not", () => {
    writeFileSync(join(dir, "a.pdf"), Buffer.from("throwaway-X"));
    const r = verifyDirectory(manifestFor([{ fileName: "a.pdf", byteLength: bytesA.length, sha256: sha(bytesA) }]), dir);
    expect(r[0].status).toBe("HASH_MISMATCH");
  });

  it("reports PASS only when size and SHA-256 both match, and summarizes the count", () => {
    writeFileSync(join(dir, "a.pdf"), bytesA);
    writeFileSync(join(dir, "b.docx"), bytesB);
    const r = verifyDirectory(
      manifestFor([
        { fileName: "a.pdf", byteLength: bytesA.length, sha256: sha(bytesA) },
        { fileName: "b.docx", byteLength: bytesB.length, sha256: sha(Buffer.from("other")) },
      ]),
      dir
    );
    expect(r.map((x) => x.status)).toEqual(["PASS", "HASH_MISMATCH"]);
    expect(summarize(r)).toEqual({ total: 2, pass: 1, failed: 1 });
  });
});
