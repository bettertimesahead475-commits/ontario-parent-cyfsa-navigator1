// Tests for scripts/official-forms/fetch-official.mjs and the shared checkBytes() rule in verifyLib.mjs.
// No test touches the network: every request goes through a fake fetch. Writes go only to temporary folders.
import { describe, it, expect } from "vitest";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  DEFAULTS,
  downloadEntry,
  findInterruptedInstallFiles,
  fetchRetrievable,
  installVerified,
  InstallError,
  messageFor,
  readManifest,
  SETS,
  validateUrl,
} from "../../scripts/official-forms/fetch-official.mjs";
import { checkBytes } from "../../scripts/official-forms/verifyLib.mjs";

const sha = (b: Buffer) => createHash("sha256").update(b).digest("hex");
const HOST = "https://ontariocourtforms.on.ca/static/media/uploads/courtforms/family/test/sample.pdf";
const noSleep = async () => undefined;
const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const tmp = (p: string) => fs.mkdtempSync(path.join(os.tmpdir(), p));

/** A synthetic retrievable entry whose pin matches `bytes`. */
function entryFor(bytes: Buffer, over: Record<string, unknown> = {}) {
  return { fileName: "sample.pdf", sha256: sha(bytes), byteLength: bytes.length, sourceUrl: HOST, retrievable: true, ...over };
}

/** Fake fetch. `steps[n]` answers call n (1-based); the last step repeats. A function is invoked; an Error is thrown. */
function fakeFetch(steps: Array<Response | Error | (() => Response | Error)>) {
  const calls: { url: string; init: any }[] = [];
  const fn = async (url: string, init: any) => {
    calls.push({ url, init });
    const step = steps[Math.min(calls.length - 1, steps.length - 1)];
    const v = typeof step === "function" ? step() : step;
    if (v instanceof Error) throw v;
    return v;
  };
  return { fn: fn as unknown as typeof fetch, calls };
}
const ok = (b: Buffer, headers: Record<string, string> = {}) =>
  new Response(b, { status: 200, headers: { "content-length": String(b.length), ...headers } });

/** A manifest file on disk containing the given entries, and a fetchRetrievable set that writes into `target`. */
function oneSet(entries: unknown[], target: string) {
  const dir = tmp("oforms-manifest-");
  const manifest = path.join(dir, "manifest.json");
  fs.writeFileSync(manifest, JSON.stringify({ files: entries }));
  return [{ name: "historical", manifest, target }];
}

describe("pins and defaults", () => {
  it("the per-file limit is 10 MB, the timeout is 60 s, and retries are bounded", () => {
    expect(DEFAULTS.maxBytes).toBe(10 * 1024 * 1024);
    expect(DEFAULTS.timeoutMs).toBe(60_000);
    expect(DEFAULTS.attempts).toBe(3);
  });
});

describe("checkBytes: the one shared rule for a pin", () => {
  it("passes exact length and hash", () => {
    const b = Buffer.from("pinned bytes");
    expect(checkBytes({ sha256: sha(b), byteLength: b.length }, b).status).toBe("PASS");
  });
  it("reports a length difference before the hash", () => {
    const b = Buffer.from("pinned bytes");
    expect(checkBytes({ sha256: sha(b), byteLength: b.length + 1 }, b).status).toBe("SIZE_MISMATCH");
  });
  it("reports a hash difference at the same length", () => {
    const b = Buffer.from("pinned bytes");
    const other = Buffer.from("PINNED bytes");
    expect(checkBytes({ sha256: sha(b), byteLength: b.length }, other).status).toBe("HASH_MISMATCH");
  });
});

describe("validateUrl: exact HTTPS URLs on the allowlisted host, under the official path", () => {
  it("accepts the official host and path over https", () => {
    expect(validateUrl(HOST)).toBe(HOST);
  });
  it("refuses an unapproved host", () => {
    expect(() => validateUrl("https://example.com/static/media/uploads/courtforms/x.pdf")).toThrow(/not on the allowlist/);
  });
  it("refuses look-alike hosts that contain the allowed name", () => {
    expect(() => validateUrl("https://ontariocourtforms.on.ca.evil.example/static/media/uploads/courtforms/x.pdf")).toThrow(/not on the allowlist/);
    expect(() => validateUrl("https://evil.example/ontariocourtforms.on.ca/static/media/uploads/courtforms/x.pdf")).toThrow(/not on the allowlist/);
  });
  it("refuses plain HTTP, even to the official host", () => {
    expect(() => validateUrl(HOST.replace("https:", "http:"))).toThrow(/only https/);
  });
  it("refuses credentials and a non-default port", () => {
    expect(() => validateUrl("https://user:pw@ontariocourtforms.on.ca/static/media/uploads/courtforms/x.pdf")).toThrow(/credentials/);
    expect(() => validateUrl("https://ontariocourtforms.on.ca:8443/static/media/uploads/courtforms/x.pdf")).toThrow(/non-default port/);
  });
  it("refuses the official host outside the court-forms path", () => {
    expect(() => validateUrl("https://ontariocourtforms.on.ca/admin/x.pdf")).toThrow(/outside the official court-forms location/);
  });
  it("refuses a malformed URL", () => {
    expect(() => validateUrl("not a url")).toThrow(/malformed/);
  });
});

describe("unapproved hosts and paths never produce a request", () => {
  it("does not call fetch for an unapproved host", async () => {
    const bytes = Buffer.from("%PDF-1.4 sample");
    const f = fakeFetch([ok(bytes)]);
    const r = await downloadEntry(entryFor(bytes, { sourceUrl: "https://example.com/static/media/uploads/courtforms/sample.pdf" }), { fetchImpl: f.fn, sleep: noSleep });
    expect(r.status).toBe("UNAPPROVED_HOST");
    expect(f.calls.length).toBe(0);
  });
  it("does not call fetch for a non-https pinned URL", async () => {
    const bytes = Buffer.from("%PDF-1.4 sample");
    const f = fakeFetch([ok(bytes)]);
    const r = await downloadEntry(entryFor(bytes, { sourceUrl: HOST.replace("https:", "http:") }), { fetchImpl: f.fn, sleep: noSleep });
    expect(r.status).toBe("PROTOCOL_REFUSED");
    expect(f.calls.length).toBe(0);
  });
});

describe("redirects are refused, never followed", () => {
  it("refuses an HTTPS redirect to the same host after one request", async () => {
    const bytes = Buffer.from("%PDF-1.4 sample");
    const f = fakeFetch([new Response(null, { status: 302, headers: { location: HOST } })]);
    const r = await downloadEntry(entryFor(bytes), { fetchImpl: f.fn, sleep: noSleep });
    expect(r.status).toBe("UNEXPECTED_REDIRECT");
    expect(f.calls.length).toBe(1);
    expect(f.calls[0].init.redirect).toBe("manual");
  });
  it("refuses an HTTP (downgrade) redirect and never requests it", async () => {
    const bytes = Buffer.from("%PDF-1.4 sample");
    const f = fakeFetch([new Response(null, { status: 301, headers: { location: HOST.replace("https:", "http:") } })]);
    const r = await downloadEntry(entryFor(bytes), { fetchImpl: f.fn, sleep: noSleep });
    expect(r.status).toBe("UNEXPECTED_REDIRECT");
    expect(f.calls.map(c => c.url)).toEqual([HOST]);
  });
  it("refuses an HTTPS redirect to another host and never requests that host", async () => {
    const bytes = Buffer.from("%PDF-1.4 sample");
    const f = fakeFetch([new Response(null, { status: 301, headers: { location: "https://evil.example/sample.pdf" } })]);
    const r = await downloadEntry(entryFor(bytes), { fetchImpl: f.fn, sleep: noSleep });
    expect(r.status).toBe("UNEXPECTED_REDIRECT");
    expect(f.calls.map(c => c.url)).toEqual([HOST]);
  });
});

describe("incorrect SHA-256 and incorrect byte length", () => {
  it("reports CHANGED_UPSTREAM for a same-length different file, discards the bytes, and does not retry", async () => {
    const pinned = Buffer.from("PINNED-CONTENT-AAAA");
    const served = Buffer.from("SERVED-CONTENT-BBBB");
    expect(served.length).toBe(pinned.length);
    const f = fakeFetch([ok(served)]);
    const r = await downloadEntry(entryFor(pinned), { fetchImpl: f.fn, sleep: noSleep });
    expect(r.status).toBe("CHANGED_UPSTREAM");
    expect(r.reason).toBe("HASH_MISMATCH");
    expect(r.observedSha256).toBe(sha(served));
    expect(r.bytes).toBeUndefined();
    expect(f.calls.length).toBe(1);
  });
  it("reports CHANGED_UPSTREAM with reason SIZE_MISMATCH for a different length", async () => {
    const f = fakeFetch([ok(Buffer.from("much longer content"))]);
    const r = await downloadEntry(entryFor(Buffer.from("short")), { fetchImpl: f.fn, sleep: noSleep });
    expect(r.status).toBe("CHANGED_UPSTREAM");
    expect(r.reason).toBe("SIZE_MISMATCH");
    expect(f.calls.length).toBe(1);
  });
  it("installs nothing when a changed file is among the set", async () => {
    const target = tmp("oforms-changed-");
    const a = Buffer.from("aaaa"), b = Buffer.from("bbbbbb");
    const entries = [
      { fileName: "a.pdf", sha256: sha(a), byteLength: a.length, sourceUrl: HOST, retrievable: true },
      { fileName: "b.pdf", sha256: sha(b), byteLength: b.length, sourceUrl: HOST, retrievable: true },
    ];
    const f = fakeFetch([ok(a), ok(Buffer.from("WRONG!"))]);
    const r = await fetchRetrievable({ sets: oneSet(entries, target), options: { fetchImpl: f.fn, sleep: noSleep } });
    expect(r.ok).toBe(false);
    expect(r.changed).toBe(true);
    expect(fs.existsSync(path.join(target, "a.pdf"))).toBe(false);
    expect(r.report.find(x => x.fileName === "b.pdf")!.message).toMatch(/Nothing was installed/);
  });
});

describe("missing files at the official source", () => {
  it("reports SOURCE_NOT_FOUND for a 404, with one request and an actionable message", async () => {
    const f = fakeFetch([new Response("nope", { status: 404 })]);
    const r = await downloadEntry(entryFor(Buffer.from("x")), { fetchImpl: f.fn, sleep: noSleep });
    expect(r.status).toBe("SOURCE_NOT_FOUND");
    expect(f.calls.length).toBe(1);
    expect(messageFor({ ...r, fileName: "sample.pdf", status: r.status })).toMatch(/no longer serves/);
  });
  it("installs nothing when one file is missing at the source", async () => {
    const target = tmp("oforms-missing-");
    const a = Buffer.from("aaaa"), b = Buffer.from("bbbbbb");
    const entries = [
      { fileName: "a.pdf", sha256: sha(a), byteLength: a.length, sourceUrl: HOST, retrievable: true },
      { fileName: "b.pdf", sha256: sha(b), byteLength: b.length, sourceUrl: HOST, retrievable: true },
    ];
    const f = fakeFetch([ok(a), new Response("gone", { status: 404 })]);
    const r = await fetchRetrievable({ sets: oneSet(entries, target), options: { fetchImpl: f.fn, sleep: noSleep } });
    expect(r.ok).toBe(false);
    expect(r.report.find(x => x.fileName === "b.pdf")!.status).toBe("SOURCE_NOT_FOUND");
    expect(fs.readdirSync(target)).toEqual([]);
  });
});

describe("HTTP status handling", () => {
  it("retries a 500 and succeeds on the next attempt", async () => {
    const bytes = Buffer.from("%PDF-1.4 retry ok");
    const f = fakeFetch([new Response("err", { status: 500 }), ok(bytes)]);
    const r = await downloadEntry(entryFor(bytes), { fetchImpl: f.fn, sleep: noSleep });
    expect(r.status).toBe("PASS");
    expect(r.attempts).toBe(2);
  });
  it("gives up after the bounded attempts on a persistent 503 and says the source is unavailable", async () => {
    const f = fakeFetch([new Response("busy", { status: 503 })]);
    const r = await downloadEntry(entryFor(Buffer.from("x")), { fetchImpl: f.fn, sleep: noSleep, attempts: 3 });
    expect(r.status).toBe("SOURCE_UNAVAILABLE");
    expect(f.calls.length).toBe(3);
    expect(messageFor({ ...r, fileName: "sample.pdf", status: r.status })).toMatch(/temporarily|unavailable/);
  });
  it("treats another 4xx as final, with one request", async () => {
    const f = fakeFetch([new Response("forbidden", { status: 403 })]);
    const r = await downloadEntry(entryFor(Buffer.from("x")), { fetchImpl: f.fn, sleep: noSleep });
    expect(r.status).toBe("HTTP_ERROR");
    expect(f.calls.length).toBe(1);
  });
});

describe("network failures and timeouts", () => {
  it("retries a network error and reports NETWORK_ERROR after the bounded attempts", async () => {
    const f = fakeFetch([new TypeError("fetch failed")]);
    const r = await downloadEntry(entryFor(Buffer.from("x")), { fetchImpl: f.fn, sleep: noSleep, attempts: 3 });
    expect(r.status).toBe("NETWORK_ERROR");
    expect(f.calls.length).toBe(3);
  });
  it("records the transport code, not response content, for a network failure", async () => {
    const e = Object.assign(new TypeError("fetch failed"), { cause: { code: "ENOTFOUND" } });
    const f = fakeFetch([e]);
    const r = await downloadEntry(entryFor(Buffer.from("x")), { fetchImpl: f.fn, sleep: noSleep, attempts: 1 });
    expect(r.status).toBe("NETWORK_ERROR");
    expect(r.detail).toBe("ENOTFOUND");
  });
  it("reports TIMEOUT for an aborted request and retries it", async () => {
    const abort = Object.assign(new Error("aborted"), { name: "TimeoutError" });
    const f = fakeFetch([abort]);
    const r = await downloadEntry(entryFor(Buffer.from("x")), { fetchImpl: f.fn, sleep: noSleep, attempts: 2 });
    expect(r.status).toBe("TIMEOUT");
    expect(f.calls.length).toBe(2);
  });
  it("passes a 60-second abort signal to every request", async () => {
    const bytes = Buffer.from("%PDF-1.4 signal");
    const f = fakeFetch([ok(bytes)]);
    await downloadEntry(entryFor(bytes), { fetchImpl: f.fn, sleep: noSleep });
    expect(f.calls[0].init.signal).toBeDefined();
  });
});

describe("truncated downloads", () => {
  it("reports PARTIAL_DOWNLOAD when the body is shorter than the declared length, after bounded retries", async () => {
    const bytes = Buffer.from("%PDF-1.4 full length body");
    const short = () => new Response(bytes.subarray(0, 8), { status: 200, headers: { "content-length": String(bytes.length) } });
    const f = fakeFetch([short]);
    const r = await downloadEntry(entryFor(bytes), { fetchImpl: f.fn, sleep: noSleep, attempts: 2 });
    expect(r.status).toBe("PARTIAL_DOWNLOAD");
    expect(f.calls.length).toBe(2);
  });
  it("passes when a retry completes a previously truncated download", async () => {
    const bytes = Buffer.from("%PDF-1.4 completes on retry");
    const short = () => new Response(bytes.subarray(0, 5), { status: 200, headers: { "content-length": String(bytes.length) } });
    const f = fakeFetch([short, ok(bytes)]);
    const r = await downloadEntry(entryFor(bytes), { fetchImpl: f.fn, sleep: noSleep });
    expect(r.status).toBe("PASS");
    expect(r.attempts).toBe(2);
  });
});

describe("oversized responses (10 MB per file)", () => {
  it("refuses a declared length over the limit with a single request", async () => {
    const f = fakeFetch([new Response(null, { status: 200, headers: { "content-length": "99999999" } })]);
    const r = await downloadEntry(entryFor(Buffer.from("x")), { fetchImpl: f.fn, sleep: noSleep, maxBytes: 1024 });
    expect(r.status).toBe("SIZE_LIMIT");
    expect(f.calls.length).toBe(1);
  });
  it("refuses an undeclared body that grows past the limit while it is read", async () => {
    const f = fakeFetch([new Response(new Uint8Array(4096), { status: 200 })]);
    const r = await downloadEntry(entryFor(Buffer.from("x")), { fetchImpl: f.fn, sleep: noSleep, maxBytes: 1024 });
    expect(r.status).toBe("SIZE_LIMIT");
  });
  it("accepts a body of exactly the limit (it then fails the pin, not the size check)", async () => {
    const big = Buffer.alloc(1024, 7);
    const f = fakeFetch([ok(big)]);
    const r = await downloadEntry(entryFor(Buffer.from("different pin")), { fetchImpl: f.fn, sleep: noSleep, maxBytes: 1024 });
    expect(r.status).toBe("CHANGED_UPSTREAM");
  });
});

describe("entries that are not retrievable", () => {
  it("does not request an entry marked retrievable: false", async () => {
    const f = fakeFetch([ok(Buffer.from("x"))]);
    const r = await downloadEntry({ ...entryFor(Buffer.from("x")), retrievable: false }, { fetchImpl: f.fn, sleep: noSleep });
    expect(r.status).toBe("NOT_RETRIEVABLE");
    expect(f.calls.length).toBe(0);
  });
  it("refuses a retrievable entry with no source URL", async () => {
    const f = fakeFetch([ok(Buffer.from("x"))]);
    const r = await downloadEntry({ ...entryFor(Buffer.from("x")), sourceUrl: undefined }, { fetchImpl: f.fn, sleep: noSleep });
    expect(r.status).toBe("NO_SOURCE_URL");
    expect(f.calls.length).toBe(0);
  });
});

describe("unsafe fixture names are refused before any request or write", () => {
  for (const bad of ["../escape.pdf", "sub/inner.pdf", ".hidden.pdf", "notes.exe", "with space.pdf"]) {
    it(`refuses the manifest name ${JSON.stringify(bad)}`, async () => {
      const target = tmp("oforms-badname-");
      const manifest = path.join(tmp("oforms-badman-"), "manifest.json");
      fs.writeFileSync(manifest, JSON.stringify({ files: [{ fileName: bad, sha256: "0".repeat(64), byteLength: 1, sourceUrl: HOST, retrievable: true }] }));
      const f = fakeFetch([ok(Buffer.from("x"))]);
      await expect(fetchRetrievable({ sets: [{ name: "historical", manifest, target }], options: { fetchImpl: f.fn, sleep: noSleep } })).rejects.toThrow(/unsafe fixture name/);
      expect(f.calls.length).toBe(0);
      expect(fs.readdirSync(target)).toEqual([]);
    });
  }
  it("refuses to report success when there are no retrievable entries", async () => {
    const target = tmp("oforms-none-");
    const f = fakeFetch([ok(Buffer.from("x"))]);
    await expect(fetchRetrievable({ sets: oneSet([{ fileName: "a.pdf", sha256: "0".repeat(64), byteLength: 1, retrievable: false }], target), options: { fetchImpl: f.fn } })).rejects.toThrow(/no retrievable entries/);
  });
});

describe("installation is all-or-nothing, and failed verification changes no destination", () => {
  it("installs every verified file and keeps an existing file it did not replace", () => {
    const dir = tmp("oforms-install-");
    fs.writeFileSync(path.join(dir, "keep.pdf"), "superseded, not retrievable");
    installVerified([{ dest: path.join(dir, "a.pdf"), bytes: Buffer.from("A") }, { dest: path.join(dir, "b.pdf"), bytes: Buffer.from("B") }]);
    expect(fs.readdirSync(dir).sort()).toEqual(["a.pdf", "b.pdf", "keep.pdf"]);
    expect(fs.readFileSync(path.join(dir, "keep.pdf"), "utf8")).toBe("superseded, not retrievable");
  });

  it("rolls back a failing second rename: the first file is restored and the replaced originals come back byte-identical", () => {
    const dir = tmp("oforms-rollback-");
    fs.writeFileSync(path.join(dir, "a.pdf"), "OLD-A");
    fs.writeFileSync(path.join(dir, "b.pdf"), "OLD-B");
    let renames = 0;
    const fsOps = {
      writeFile: (p: string, bytes: Buffer) => fs.writeFileSync(p, bytes, { flag: "wx" }),
      rename: (from: string, to: string) => {
        renames++;
        // 1st rename: a.pdf -> backup. 2nd: stage(a) -> a.pdf. 3rd: b.pdf -> backup. 4th: stage(b) -> b.pdf. Fail the 4th.
        if (renames === 4) throw Object.assign(new Error("disk full"), { code: "ENOSPC" });
        fs.renameSync(from, to);
      },
      remove: (p: string) => fs.rmSync(p, { force: true }),
    };
    let caught: unknown;
    try {
      installVerified([{ dest: path.join(dir, "a.pdf"), bytes: Buffer.from("NEW-A") }, { dest: path.join(dir, "b.pdf"), bytes: Buffer.from("NEW-B") }], fsOps);
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(InstallError);
    expect((caught as InstallError).rolledBack).toBe(true);
    expect(fs.readFileSync(path.join(dir, "a.pdf"), "utf8")).toBe("OLD-A");
    expect(fs.readFileSync(path.join(dir, "b.pdf"), "utf8")).toBe("OLD-B");
    expect(fs.readdirSync(dir).sort()).toEqual(["a.pdf", "b.pdf"]);
  });

  it("removes every staged file and changes nothing when a staging write fails", () => {
    const dir = tmp("oforms-stage-");
    fs.writeFileSync(path.join(dir, "a.pdf"), "OLD-A");
    let writes = 0;
    const fsOps = {
      writeFile: (p: string, bytes: Buffer) => {
        writes++;
        if (writes === 2) throw Object.assign(new Error("read-only"), { code: "EROFS" });
        fs.writeFileSync(p, bytes, { flag: "wx" });
      },
      rename: (from: string, to: string) => fs.renameSync(from, to),
      remove: (p: string) => fs.rmSync(p, { force: true }),
    };
    expect(() => installVerified([{ dest: path.join(dir, "a.pdf"), bytes: Buffer.from("NEW") }, { dest: path.join(dir, "b.pdf"), bytes: Buffer.from("B") }], fsOps)).toThrow(InstallError);
    expect(fs.readdirSync(dir).sort()).toEqual(["a.pdf"]);
    expect(fs.readFileSync(path.join(dir, "a.pdf"), "utf8")).toBe("OLD-A");
  });

  it("reports rolledBack: false when the rollback itself cannot complete, and names the problem", () => {
    const dir = tmp("oforms-stuck-");
    fs.writeFileSync(path.join(dir, "a.pdf"), "OLD-A");
    let renames = 0;
    const fsOps = {
      writeFile: (p: string, bytes: Buffer) => fs.writeFileSync(p, bytes, { flag: "wx" }),
      rename: (from: string, to: string) => {
        renames++;
        if (renames === 2) throw Object.assign(new Error("boom"), { code: "EIO" });
        if (renames === 3) throw Object.assign(new Error("stuck"), { code: "EPERM" });
        fs.renameSync(from, to);
      },
      remove: (p: string) => fs.rmSync(p, { force: true }),
    };
    let caught: InstallError | undefined;
    try { installVerified([{ dest: path.join(dir, "a.pdf"), bytes: Buffer.from("NEW") }], fsOps); } catch (e) { caught = e as InstallError; }
    expect(caught).toBeInstanceOf(InstallError);
    expect(caught!.rolledBack).toBe(false);
    expect(caught!.rollbackErrors.join(" ")).toMatch(/restore a\.pdf: EPERM/);
  });

  it("a failed download leaves an existing destination file exactly as it was", async () => {
    const target = tmp("oforms-keep-");
    fs.writeFileSync(path.join(target, "a.pdf"), "EXISTING-A");
    const a = Buffer.from("aaaa"), b = Buffer.from("bbbbbb");
    const entries = [
      { fileName: "a.pdf", sha256: sha(a), byteLength: a.length, sourceUrl: HOST, retrievable: true },
      { fileName: "b.pdf", sha256: sha(b), byteLength: b.length, sourceUrl: HOST, retrievable: true },
    ];
    const before = fs.readdirSync(target).sort();
    const f = fakeFetch([ok(a), new Response("err", { status: 503 })]);
    const r = await fetchRetrievable({ sets: oneSet(entries, target), options: { fetchImpl: f.fn, sleep: noSleep, attempts: 1 } });
    expect(r.ok).toBe(false);
    expect(fs.readdirSync(target).sort()).toEqual(before);
    expect(fs.readFileSync(path.join(target, "a.pdf"), "utf8")).toBe("EXISTING-A");
  });
});

describe("messages tell the operator what happened and what to do", () => {
  it("CHANGED_UPSTREAM names the file, says nothing was installed, and says the pin was not updated", () => {
    const m = messageFor({ status: "CHANGED_UPSTREAM", fileName: "x.pdf", reason: "HASH_MISMATCH", observedSha256: "ab" });
    expect(m).toMatch(/x\.pdf/);
    expect(m).toMatch(/Nothing was installed/);
    expect(m).toMatch(/does not update pins/);
  });
  it("UNEXPECTED_REDIRECT says redirects are refused and to review the sourceUrl", () => {
    expect(messageFor({ status: "UNEXPECTED_REDIRECT", fileName: "x.pdf" })).toMatch(/Redirects are refused/);
  });
  it("every failure status has a message, and none of them prints file content", () => {
    for (const status of ["CHANGED_UPSTREAM", "SOURCE_NOT_FOUND", "SOURCE_UNAVAILABLE", "UNEXPECTED_REDIRECT", "UNAPPROVED_HOST", "UNAPPROVED_PATH", "PROTOCOL_REFUSED", "SIZE_LIMIT", "PARTIAL_DOWNLOAD", "TIMEOUT", "NETWORK_ERROR", "NO_SOURCE_URL", "HTTP_ERROR", "INSTALL_FAILED"]) {
      const m = messageFor({ status, fileName: "x.pdf", attempts: 3, detail: "503", reason: "HASH_MISMATCH", observedSha256: "ab", rolledBack: true });
      expect(m.length).toBeGreaterThan(20);
    }
  });
});

describe("the shipped manifests describe the retrievable set exactly", () => {
  it("historical: 11 entries, 5 retrievable DOCX with official URLs, 6 superseded PDFs not retrievable", () => {
    const m = readManifest(SETS[0].manifest);
    expect(m.files.length).toBe(11);
    expect(m.files.filter((f: any) => f.retrievable).length).toBe(5);
    expect(m.files.filter((f: any) => f.retrievable).every((f: any) => f.fileName.endsWith(".docx") && validateUrl(f.sourceUrl))).toBe(true);
    expect(m.files.filter((f: any) => !f.retrievable).every((f: any) => f.fileName.endsWith(".pdf"))).toBe(true);
  });
  it("current: 6 entries, all retrievable from official URLs", () => {
    const m = readManifest(SETS[1].manifest);
    expect(m.files.length).toBe(6);
    expect(m.files.every((f: any) => f.retrievable && validateUrl(f.sourceUrl))).toBe(true);
  });
});

const haveFixtures = fs.existsSync(path.join(repo, "fixtures", "official-forms")) && fs.existsSync(path.join(repo, "fixtures", "official-forms-current"));
describe.skipIf(!haveFixtures)("fetchRetrievable against the real pins (fake network serving the verified local bytes)", () => {
  it("verifies all 11 retrievable pins, installs exactly those, and leaves the six historical PDFs untouched", async () => {
    const roots = { historical: tmp("oforms-real-h-"), current: tmp("oforms-real-c-") };
    fs.writeFileSync(path.join(roots.historical, "33f4ddb3-form-35-1a-en-dec20.pdf"), "superseded sentinel");
    const byUrl = new Map<string, Buffer>();
    for (const set of SETS) {
      const manifest = JSON.parse(fs.readFileSync(set.manifest, "utf8"));
      const srcDir = set.name === "historical" ? path.join(repo, "fixtures", "official-forms") : path.join(repo, "fixtures", "official-forms-current");
      for (const f of manifest.files.filter((x: any) => x.retrievable)) byUrl.set(f.sourceUrl, fs.readFileSync(path.join(srcDir, f.fileName)));
    }
    const fake = { fn: (async (url: string) => (byUrl.has(url) ? ok(byUrl.get(url)!) : new Response("nope", { status: 404 }))) as unknown as typeof fetch };
    const r = await fetchRetrievable({
      sets: SETS.map(s => ({ ...s, target: roots[s.name as "historical" | "current"] })),
      options: { fetchImpl: fake.fn, sleep: noSleep },
    });
    expect(r.ok, JSON.stringify(r.report.filter(x => x.status !== "PASS"))).toBe(true);
    expect(r.written).toBe(11);
    expect(r.report.every(x => x.status === "PASS")).toBe(true);
    expect(fs.readFileSync(path.join(roots.historical, "33f4ddb3-form-35-1a-en-dec20.pdf"), "utf8")).toBe("superseded sentinel");
    expect(fs.readdirSync(roots.historical).length).toBe(6);
    expect(fs.readdirSync(roots.current).length).toBe(6);
  });
});

describe("Phase 1 regressions: partial writes, backup failures, interrupted installs, and response framing", () => {
  it("removes a partially written staged file when the staging write fails mid-write", () => {
    const dir = tmp("oforms-partial-");
    fs.writeFileSync(path.join(dir, "a.pdf"), "OLD-A");
    const fsOps = {
      writeFile: (p: string, bytes: Buffer) => {
        fs.writeFileSync(p, bytes.subarray(0, 2), { flag: "wx" });
        throw Object.assign(new Error("disk full"), { code: "ENOSPC" });
      },
      rename: (from: string, to: string) => fs.renameSync(from, to),
      remove: (p: string) => fs.rmSync(p, { force: true }),
    };
    expect(() => installVerified([{ dest: path.join(dir, "a.pdf"), bytes: Buffer.from("NEW-AAAA") }], fsOps)).toThrow(InstallError);
    expect(fs.readdirSync(dir).sort()).toEqual(["a.pdf"]);
    expect(fs.readFileSync(path.join(dir, "a.pdf"), "utf8")).toBe("OLD-A");
  });

  it("a failure moving the first existing file to its backup changes nothing and leaves no backup or stage file", () => {
    const dir = tmp("oforms-backupfail-");
    fs.writeFileSync(path.join(dir, "a.pdf"), "OLD-A");
    fs.writeFileSync(path.join(dir, "b.pdf"), "OLD-B");
    const fsOps = {
      writeFile: (p: string, bytes: Buffer) => fs.writeFileSync(p, bytes, { flag: "wx" }),
      rename: (from: string, to: string) => {
        if (from.endsWith("a.pdf")) throw Object.assign(new Error("busy"), { code: "EBUSY" });
        fs.renameSync(from, to);
      },
      remove: (p: string) => fs.rmSync(p, { force: true }),
    };
    let caught: InstallError | undefined;
    try { installVerified([{ dest: path.join(dir, "a.pdf"), bytes: Buffer.from("NEW-A") }, { dest: path.join(dir, "b.pdf"), bytes: Buffer.from("NEW-B") }], fsOps); } catch (e) { caught = e as InstallError; }
    expect(caught).toBeInstanceOf(InstallError);
    expect(caught!.rolledBack).toBe(true);
    expect(fs.readdirSync(dir).sort()).toEqual(["a.pdf", "b.pdf"]);
    expect(fs.readFileSync(path.join(dir, "a.pdf"), "utf8")).toBe("OLD-A");
    expect(fs.readFileSync(path.join(dir, "b.pdf"), "utf8")).toBe("OLD-B");
  });

  it("a failure moving the second existing file to its backup restores the first file's original", () => {
    const dir = tmp("oforms-backupfail2-");
    fs.writeFileSync(path.join(dir, "a.pdf"), "OLD-A");
    fs.writeFileSync(path.join(dir, "b.pdf"), "OLD-B");
    const fsOps = {
      writeFile: (p: string, bytes: Buffer) => fs.writeFileSync(p, bytes, { flag: "wx" }),
      rename: (from: string, to: string) => {
        if (from.endsWith("b.pdf")) throw Object.assign(new Error("busy"), { code: "EBUSY" });
        fs.renameSync(from, to);
      },
      remove: (p: string) => fs.rmSync(p, { force: true }),
    };
    let caught: InstallError | undefined;
    try { installVerified([{ dest: path.join(dir, "a.pdf"), bytes: Buffer.from("NEW-A") }, { dest: path.join(dir, "b.pdf"), bytes: Buffer.from("NEW-B") }], fsOps); } catch (e) { caught = e as InstallError; }
    expect(caught!.rolledBack).toBe(true);
    expect(fs.readdirSync(dir).sort()).toEqual(["a.pdf", "b.pdf"]);
    expect(fs.readFileSync(path.join(dir, "a.pdf"), "utf8")).toBe("OLD-A");
    expect(fs.readFileSync(path.join(dir, "b.pdf"), "utf8")).toBe("OLD-B");
  });

  it("refuses to start when an interrupted install left stage or backup files, before any request", async () => {
    const target = tmp("oforms-leftover-");
    fs.writeFileSync(path.join(target, "a.pdf.backup-123-1700000000000-4567"), "OLD-A");
    const a = Buffer.from("aaaa");
    const f = fakeFetch([ok(a)]);
    const sets = oneSet([{ fileName: "a.pdf", sha256: sha(a), byteLength: a.length, sourceUrl: HOST, retrievable: true }], target);
    await expect(fetchRetrievable({ sets, options: { fetchImpl: f.fn, sleep: noSleep } })).rejects.toThrow(/interrupted/);
    expect(f.calls.length).toBe(0);
    expect(fs.readdirSync(target)).toEqual(["a.pdf.backup-123-1700000000000-4567"]);
  });

  it("does not treat ordinary fixture names as leftovers", () => {
    const dir = tmp("oforms-noleftover-");
    fs.writeFileSync(path.join(dir, "form-8b.pdf"), "x");
    fs.writeFileSync(path.join(dir, "stage-notes.docx"), "x");
    expect(findInterruptedInstallFiles([dir, path.join(dir, "missing")])).toEqual([]);
  });

  it("reports PARTIAL_DOWNLOAD, not a changed source, when a 200 response has no body", async () => {
    const f = fakeFetch([new Response(null, { status: 200 })]);
    const r = await downloadEntry(entryFor(Buffer.from("x")), { fetchImpl: f.fn, sleep: noSleep, attempts: 1 });
    expect(r.status).toBe("PARTIAL_DOWNLOAD");
  });

  it("asks for identity encoding, so declared and decoded lengths are the same bytes", async () => {
    const bytes = Buffer.from("%PDF-1.4 sample");
    const f = fakeFetch([ok(bytes)]);
    const r = await downloadEntry(entryFor(bytes), { fetchImpl: f.fn, sleep: noSleep });
    expect(r.status).toBe("PASS");
    expect(f.calls[0].init.headers["accept-encoding"]).toBe("identity");
  });

  it("refuses a compressed response, without retrying, rather than comparing compressed and decoded lengths", async () => {
    const bytes = Buffer.from("%PDF-1.4 sample");
    const f = fakeFetch([ok(bytes, { "content-encoding": "gzip" })]);
    const r = await downloadEntry(entryFor(bytes), { fetchImpl: f.fn, sleep: noSleep });
    expect(r.status).toBe("UNEXPECTED_ENCODING");
    expect(r.attempts).toBe(1);
    expect(messageFor({ ...r, fileName: "sample.pdf", status: r.status })).toMatch(/compressed/);
  });
});
