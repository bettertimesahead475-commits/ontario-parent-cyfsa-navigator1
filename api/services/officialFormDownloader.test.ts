// Tests for scripts/official-forms/fetch-official.mjs. No test touches the network: every request goes through a fake fetch.
// Writes go only to temporary folders.
import { describe, it, expect } from "vitest";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { downloadEntry, fetchRetrievable, validateUrl, SETS } from "../../scripts/official-forms/fetch-official.mjs";

const sha = (b: Buffer) => createHash("sha256").update(b).digest("hex");
const HOST = "https://ontariocourtforms.on.ca/static/media/uploads/courtforms/family/test/sample.pdf";
const noSleep = async () => undefined;
const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

/** A synthetic retrievable entry whose pin matches `bytes`. */
function entryFor(bytes: Buffer, over: Record<string, unknown> = {}) {
  return { fileName: "sample.pdf", sha256: sha(bytes), byteLength: bytes.length, sourceUrl: HOST, retrievable: true, ...over };
}

/** Fake fetch: `steps` returns the result for call n (1-based). A function value is invoked; an Error value is thrown. */
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

describe("validateUrl: only exact HTTPS URLs on the allowlist", () => {
  it("accepts the official host over https", () => {
    expect(validateUrl(HOST)).toBe(HOST);
  });
  it("refuses an unapproved host", () => {
    expect(() => validateUrl("https://example.com/x.pdf")).toThrow(/UNAPPROVED_HOST|host not on the allowlist/);
  });
  it("refuses a look-alike host that merely contains the allowed name", () => {
    expect(() => validateUrl("https://ontariocourtforms.on.ca.evil.example/x.pdf")).toThrow(/host not on the allowlist/);
    expect(() => validateUrl("https://evil.example/ontariocourtforms.on.ca/x.pdf")).toThrow(/host not on the allowlist/);
  });
  it("refuses plain http", () => {
    expect(() => validateUrl(HOST.replace("https:", "http:"))).toThrow(/only https/);
  });
  it("refuses credentials and a non-default port", () => {
    expect(() => validateUrl("https://user:pw@ontariocourtforms.on.ca/x.pdf")).toThrow(/credentials/);
    expect(() => validateUrl("https://ontariocourtforms.on.ca:8443/x.pdf")).toThrow(/non-default port/);
  });
  it("refuses a malformed URL", () => {
    expect(() => validateUrl("not a url")).toThrow(/malformed/);
  });
});

describe("downloadEntry: unapproved hosts never produce a request", () => {
  it("does not call fetch for an unapproved host", async () => {
    const bytes = Buffer.from("%PDF-1.4 sample");
    const f = fakeFetch([ok(bytes)]);
    const r = await downloadEntry(entryFor(bytes, { sourceUrl: "https://example.com/sample.pdf" }), { fetchImpl: f.fn, sleep: noSleep });
    expect(r.status).toBe("UNAPPROVED_HOST");
    expect(f.calls.length).toBe(0);
  });
});

describe("downloadEntry: redirects are refused, not followed", () => {
  it("refuses a same-host redirect after one request", async () => {
    const bytes = Buffer.from("%PDF-1.4 sample");
    const f = fakeFetch([new Response(null, { status: 302, headers: { location: HOST } })]);
    const r = await downloadEntry(entryFor(bytes), { fetchImpl: f.fn, sleep: noSleep });
    expect(r.status).toBe("UNEXPECTED_REDIRECT");
    expect(f.calls.length).toBe(1);
    expect(f.calls[0].init.redirect).toBe("manual");
  });
  it("refuses a redirect to another host and never requests that host", async () => {
    const bytes = Buffer.from("%PDF-1.4 sample");
    const f = fakeFetch([new Response(null, { status: 301, headers: { location: "https://evil.example/sample.pdf" } })]);
    const r = await downloadEntry(entryFor(bytes), { fetchImpl: f.fn, sleep: noSleep });
    expect(r.status).toBe("UNEXPECTED_REDIRECT");
    expect(f.calls.map(c => c.url)).toEqual([HOST]);
  });
});

describe("downloadEntry: a complete response with different bytes is flagged, not retried", () => {
  it("reports CHANGED_UPSTREAM for wrong bytes of the same length and does not keep them", async () => {
    const pinned = Buffer.from("PINNED-CONTENT-AAAA");
    const served = Buffer.from("SERVED--CONTENT-BBBB");
    const f = fakeFetch([ok(served)]);
    const r = await downloadEntry(entryFor(pinned), { fetchImpl: f.fn, sleep: noSleep });
    expect(r.status).toBe("CHANGED_UPSTREAM");
    expect(r.observedSha256).toBe(sha(served));
    expect(r.bytes).toBeUndefined();
    expect(f.calls.length).toBe(1);
  });
  it("reports CHANGED_UPSTREAM for a different length", async () => {
    const pinned = Buffer.from("short");
    const f = fakeFetch([ok(Buffer.from("much longer content"))]);
    const r = await downloadEntry(entryFor(pinned), { fetchImpl: f.fn, sleep: noSleep });
    expect(r.status).toBe("CHANGED_UPSTREAM");
    expect(f.calls.length).toBe(1);
  });
});

describe("downloadEntry: HTTP status handling", () => {
  it("treats a 404 (file gone from the official site) as final, with one request", async () => {
    const f = fakeFetch([new Response("nope", { status: 404 })]);
    const r = await downloadEntry(entryFor(Buffer.from("x")), { fetchImpl: f.fn, sleep: noSleep });
    expect(r.status).toBe("HTTP_ERROR");
    expect(f.calls.length).toBe(1);
  });
  it("retries a 500 and succeeds on the next attempt", async () => {
    const bytes = Buffer.from("%PDF-1.4 retry ok");
    const f = fakeFetch([new Response("err", { status: 500 }), ok(bytes)]);
    const r = await downloadEntry(entryFor(bytes), { fetchImpl: f.fn, sleep: noSleep });
    expect(r.status).toBe("PASS");
    expect(r.attempts).toBe(2);
  });
  it("gives up after the bounded number of attempts on a persistent 503", async () => {
    const f = fakeFetch([new Response("busy", { status: 503 })]);
    const r = await downloadEntry(entryFor(Buffer.from("x")), { fetchImpl: f.fn, sleep: noSleep, attempts: 3 });
    expect(r.status).toBe("HTTP_RETRYABLE");
    expect(f.calls.length).toBe(3);
  });
});

describe("downloadEntry: network failures", () => {
  it("retries a network error and reports NETWORK_ERROR after the bounded attempts", async () => {
    const f = fakeFetch([new TypeError("fetch failed")]);
    const r = await downloadEntry(entryFor(Buffer.from("x")), { fetchImpl: f.fn, sleep: noSleep, attempts: 3 });
    expect(r.status).toBe("NETWORK_ERROR");
    expect(f.calls.length).toBe(3);
  });
  it("reports TIMEOUT for an aborted request and retries it", async () => {
    const abort = Object.assign(new Error("aborted"), { name: "TimeoutError" });
    const f = fakeFetch([abort]);
    const r = await downloadEntry(entryFor(Buffer.from("x")), { fetchImpl: f.fn, sleep: noSleep, attempts: 2 });
    expect(r.status).toBe("TIMEOUT");
    expect(f.calls.length).toBe(2);
  });
});

describe("downloadEntry: partial downloads", () => {
  it("reports PARTIAL_DOWNLOAD when the body is shorter than the declared length, after retries", async () => {
    const bytes = Buffer.from("%PDF-1.4 full length body");
    const truncated = new Response(bytes.subarray(0, 8), { status: 200, headers: { "content-length": String(bytes.length) } });
    const f = fakeFetch([truncated, () => new Response(bytes.subarray(0, 8), { status: 200, headers: { "content-length": String(bytes.length) } })]);
    const r = await downloadEntry(entryFor(bytes), { fetchImpl: f.fn, sleep: noSleep, attempts: 2 });
    expect(r.status).toBe("PARTIAL_DOWNLOAD");
    expect(f.calls.length).toBe(2);
  });
  it("passes when a retry completes a previously truncated download", async () => {
    const bytes = Buffer.from("%PDF-1.4 completes on retry");
    const truncated = () => new Response(bytes.subarray(0, 5), { status: 200, headers: { "content-length": String(bytes.length) } });
    const f = fakeFetch([truncated, ok(bytes)]);
    const r = await downloadEntry(entryFor(bytes), { fetchImpl: f.fn, sleep: noSleep });
    expect(r.status).toBe("PASS");
    expect(r.attempts).toBe(2);
  });
});

describe("downloadEntry: size limits", () => {
  it("refuses a declared length over the limit with a single request", async () => {
    const f = fakeFetch([new Response(null, { status: 200, headers: { "content-length": "99999999" } })]);
    const r = await downloadEntry(entryFor(Buffer.from("x")), { fetchImpl: f.fn, sleep: noSleep, maxBytes: 1024 });
    expect(r.status).toBe("SIZE_LIMIT");
    expect(f.calls.length).toBe(1);
  });
  it("refuses an undeclared body that grows past the limit while it is read", async () => {
    const big = new Response(new Uint8Array(4096), { status: 200 });
    const f = fakeFetch([big]);
    const r = await downloadEntry(entryFor(Buffer.from("x")), { fetchImpl: f.fn, sleep: noSleep, maxBytes: 1024 });
    expect(r.status).toBe("SIZE_LIMIT");
  });
});

describe("downloadEntry: entries that are not retrievable", () => {
  it("does not request an entry marked retrievable: false", async () => {
    const f = fakeFetch([ok(Buffer.from("x"))]);
    const r = await downloadEntry({ ...entryFor(Buffer.from("x")), retrievable: false }, { fetchImpl: f.fn, sleep: noSleep });
    expect(r.status).toBe("NOT_RETRIEVABLE");
    expect(f.calls.length).toBe(0);
  });
  it("refuses a retrievable entry that has no source URL", async () => {
    const f = fakeFetch([ok(Buffer.from("x"))]);
    const r = await downloadEntry({ ...entryFor(Buffer.from("x")), sourceUrl: undefined }, { fetchImpl: f.fn, sleep: noSleep });
    expect(r.status).toBe("NO_SOURCE_URL");
    expect(f.calls.length).toBe(0);
  });
});

describe("fetchRetrievable: all-or-nothing writes that never delete existing files", () => {
  function sets(root: string, one: { set: string; entries: unknown[] }[]) {
    return one.map(s => ({ name: s.set, manifest: "", target: path.join(root, s.set), entries: s.entries }));
  }
  /** Runs fetchRetrievable with in-memory manifests so the pins are exactly the ones we construct. */
  async function run(entries: Array<{ fileName: string; sha256: string; byteLength: number; sourceUrl?: string; retrievable: boolean }>, root: string, fake: ReturnType<typeof fakeFetch>) {
    const tmpManifest = path.join(root, "manifest.json");
    fs.writeFileSync(tmpManifest, JSON.stringify({ files: entries }));
    const set = { name: "historical", manifest: tmpManifest, target: path.join(root, "target") };
    return fetchRetrievable({ sets: [set], options: { fetchImpl: fake.fn, sleep: noSleep } });
  }

  it("writes nothing when one of two retrievable files fails, and keeps existing files", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "oforms-dl-"));
    fs.mkdirSync(path.join(root, "target"));
    fs.writeFileSync(path.join(root, "target", "existing.pdf"), "keep");
    const a = Buffer.from("aaaa"), b = Buffer.from("bbbbbb");
    const entries = [
      { fileName: "a.pdf", sha256: sha(a), byteLength: a.length, sourceUrl: HOST, retrievable: true },
      { fileName: "b.pdf", sha256: sha(b), byteLength: b.length, sourceUrl: HOST, retrievable: true },
    ];
    const fake = fakeFetch([ok(a), ok(Buffer.from("WRONG!"))]);
    const r = await run(entries, root, fake);
    expect(r.ok).toBe(false);
    expect(r.changed).toBe(true);
    expect(fs.readdirSync(path.join(root, "target")).sort()).toEqual(["existing.pdf"]);
  });

  it("writes every retrievable file when all pass, and leaves a non-retrievable existing file alone", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "oforms-dl-"));
    fs.mkdirSync(path.join(root, "target"));
    fs.writeFileSync(path.join(root, "target", "superseded-historical.pdf"), "keep me");
    const a = Buffer.from("aaaa");
    const entries = [
      { fileName: "a.pdf", sha256: sha(a), byteLength: a.length, sourceUrl: HOST, retrievable: true },
      { fileName: "superseded-historical.pdf", sha256: "0".repeat(64), byteLength: 5, retrievable: false },
    ];
    const fake = fakeFetch([ok(a)]);
    const r = await run(entries, root, fake);
    expect(r.ok).toBe(true);
    expect(r.written).toBe(1);
    expect(fs.readdirSync(path.join(root, "target")).sort()).toEqual(["a.pdf", "superseded-historical.pdf"]);
    expect(fs.readFileSync(path.join(root, "target", "superseded-historical.pdf"), "utf8")).toBe("keep me");
  });

  it("writes nothing and reports NETWORK_ERROR when the network is down", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "oforms-dl-"));
    const a = Buffer.from("aaaa");
    const entries = [{ fileName: "a.pdf", sha256: sha(a), byteLength: a.length, sourceUrl: HOST, retrievable: true }];
    const r = await run(entries, root, fakeFetch([new TypeError("offline")]));
    expect(r.ok).toBe(false);
    expect(r.changed).toBe(false);
    expect(r.report[0].status).toBe("NETWORK_ERROR");
    expect(fs.existsSync(path.join(root, "target"))).toBe(false);
  });
});

const haveFixtures = fs.existsSync(path.join(repo, "fixtures", "official-forms")) && fs.existsSync(path.join(repo, "fixtures", "official-forms-current"));
describe.skipIf(!haveFixtures)("fetchRetrievable against the real pins (fake network serving the verified local bytes)", () => {
  it("verifies the 11 retrievable pins, writes exactly those, and leaves the six historical PDFs untouched", async () => {
    const roots = { historical: fs.mkdtempSync(path.join(os.tmpdir(), "oforms-real-h-")), current: fs.mkdtempSync(path.join(os.tmpdir(), "oforms-real-c-")) };
    // The historical PDFs are not retrievable; put a sentinel where they would sit, to prove they are not touched.
    fs.writeFileSync(path.join(roots.historical, "33f4ddb3-form-35-1a-en-dec20.pdf"), "superseded sentinel");
    const byUrl = new Map<string, Buffer>();
    for (const set of SETS) {
      const manifest = JSON.parse(fs.readFileSync(set.manifest, "utf8"));
      const srcDir = set.name === "historical" ? path.join(repo, "fixtures", "official-forms") : path.join(repo, "fixtures", "official-forms-current");
      for (const f of manifest.files.filter((x: any) => x.retrievable)) byUrl.set(f.sourceUrl, fs.readFileSync(path.join(srcDir, f.fileName)));
    }
    const fake = { fn: (async (url: string) => {
      const b = byUrl.get(url);
      return b ? ok(b) : new Response("nope", { status: 404 });
    }) as unknown as typeof fetch };
    const r = await fetchRetrievable({
      sets: SETS.map(s => ({ ...s, target: roots[s.name as "historical" | "current"] })),
      options: { fetchImpl: fake.fn, sleep: noSleep },
    });
    expect(r.ok, JSON.stringify(r.report.filter(x => x.status !== "PASS"))).toBe(true);
    expect(r.written).toBe(11);
    expect(r.report.every(x => x.status === "PASS")).toBe(true);
    expect(fs.readFileSync(path.join(roots.historical, "33f4ddb3-form-35-1a-en-dec20.pdf"), "utf8")).toBe("superseded sentinel");
    expect(fs.readdirSync(roots.historical).sort()).toEqual(["33f4ddb3-form-35-1a-en-dec20.pdf", "3bf6f793-form_33c_2018.docx", "48d81005-form-35-1a-en-dec20.docx", "c01f056a-flr_14a_sept105_en_fil.docx", "d39f83dd-form-8b-feb_1_2022-en.docx", "df0e02ef-form-33b-1-en-dec20.docx"].sort());
    expect(fs.readdirSync(roots.current).length).toBe(6);
  });
});
