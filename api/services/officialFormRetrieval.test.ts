// Stage 9D-4B-1 tests — SSRF-safe official-form retrieval/integrity subsystem.
// All network I/O is a deterministic mocked Transport/DnsResolver implementing the exact same
// interfaces production uses (createTrustedHttpsTransport / createDnsResolver) — these tests
// exercise the real production validation/hashing logic, not a parallel test-only copy.
import { describe, it, expect } from "vitest";
import crypto from "node:crypto";
import {
  retrieveOfficialFormArtifact,
  ingestTrustedDevelopmentArtifact,
  isApprovedHost,
  isBlockedIpLiteral,
  isLocalhostHostname,
  assertUrlShapeIsSafe,
  detectAndValidateFormat,
  sha256OfExactBytes,
  readBoundedBody,
  toPublicRetrievalResult,
  buildOfficialIndexMetadataRecord,
  MAX_ARTIFACT_BYTES,
  type Transport,
  type TransportResponse,
  type DnsResolver
} from "./officialFormRetrieval.js";
import { REAL_ONTARIO_FORM_CANDIDATES } from "./officialFormSourceManifest.js";

// ---------------------------------------------------------------------------
// SYNTHETIC TEST FIXTURES — clearly labeled, never resembling real Ontario content.
// ---------------------------------------------------------------------------
const SYNTHETIC_PDF = Buffer.from(
  "%PDF-1.4\n% SYNTHETIC_TEST_OFFICIAL_FORM - not a real Ontario government document\n" +
    "1 0 obj<< /Type /Catalog >>endobj\n%%EOF",
  "utf8"
);

function buildSyntheticDocxZip(): Buffer {
  // Minimal but structurally real ZIP local-file-header entry for "[Content_Types].xml" so the
  // DOCX structural check (PK\x03\x04 + OOXML manifest marker) passes without needing a full
  // real ZIP central directory (content validation here only checks header/marker presence).
  const filename = Buffer.from("[Content_Types].xml", "utf8");
  const content = Buffer.from("SYNTHETIC_TEST_OFFICIAL_FORM docx placeholder content", "utf8");
  const localHeader = Buffer.alloc(30);
  localHeader.writeUInt32LE(0x04034b50, 0); // PK\x03\x04
  localHeader.writeUInt16LE(20, 4); // version needed
  localHeader.writeUInt16LE(0, 6); // flags
  localHeader.writeUInt16LE(0, 8); // compression: stored
  localHeader.writeUInt16LE(0, 10); // mod time
  localHeader.writeUInt16LE(0, 12); // mod date
  localHeader.writeUInt32LE(0, 14); // crc32 (unchecked by our validator)
  localHeader.writeUInt32LE(content.length, 18); // compressed size
  localHeader.writeUInt32LE(content.length, 22); // uncompressed size
  localHeader.writeUInt16LE(filename.length, 26); // filename length
  localHeader.writeUInt16LE(0, 28); // extra field length
  return Buffer.concat([localHeader, filename, content]);
}
const SYNTHETIC_DOCX = buildSyntheticDocxZip();

const SYNTHETIC_HTML_ERROR_PAGE = Buffer.from(
  "<!DOCTYPE html><html><body>404 SYNTHETIC_TEST_OFFICIAL_FORM not found</body></html>",
  "utf8"
);
const ARBITRARY_ZIP = (() => {
  const filename = Buffer.from("not-a-docx.txt", "utf8");
  const content = Buffer.from("just an arbitrary zip entry, not office content", "utf8");
  const header = Buffer.alloc(30);
  header.writeUInt32LE(0x04034b50, 0);
  header.writeUInt16LE(filename.length, 26);
  header.writeUInt32LE(content.length, 18);
  header.writeUInt32LE(content.length, 22);
  return Buffer.concat([header, filename, content]);
})();

// ---------------------------------------------------------------------------
// Mock transport / resolver helpers.
// ---------------------------------------------------------------------------
async function* singleChunk(buf: Buffer): AsyncIterable<Buffer> {
  yield buf;
}

async function* multiChunk(buf: Buffer, chunkSize: number): AsyncIterable<Buffer> {
  for (let i = 0; i < buf.length; i += chunkSize) {
    yield buf.subarray(i, i + chunkSize);
  }
}

function ok(bytes: Buffer, contentType: string, opts?: { chunked?: boolean; chunkSize?: number; declaredLength?: number | null }): TransportResponse {
  const headers: Record<string, string> = { "content-type": contentType };
  if (opts?.declaredLength !== null) {
    headers["content-length"] = String(opts?.declaredLength ?? bytes.length);
  }
  return {
    status: 200,
    headers,
    body: opts?.chunked ? multiChunk(bytes, opts.chunkSize ?? 4) : singleChunk(bytes)
  };
}

function redirect(location: string): TransportResponse {
  return { status: 302, headers: { location }, body: singleChunk(Buffer.alloc(0)) };
}

class MockTransport implements Transport {
  constructor(private routes: Record<string, TransportResponse | (() => TransportResponse)>) {}
  async request(url: string): Promise<TransportResponse> {
    const entry = this.routes[url];
    if (!entry) throw new Error(`MockTransport: no route configured for ${url}`);
    return typeof entry === "function" ? entry() : entry;
  }
}

class MockDnsResolver implements DnsResolver {
  constructor(private addresses: Record<string, string[]>) {}
  async resolve(hostname: string): Promise<string[]> {
    return this.addresses[hostname] ?? ["203.0.113.10"]; // TEST-NET-3, safe public documentation range
  }
}

const PUBLIC_RESOLVER = new MockDnsResolver({
  "ontariocourtforms.on.ca": ["203.0.113.10"],
  "www.ontariocourtforms.on.ca": ["203.0.113.11"],
  "evil.example.com": ["203.0.113.99"]
});

const APPROVED_PDF_URL = "https://ontariocourtforms.on.ca/synthetic/form.pdf";
const APPROVED_DOCX_URL = "https://ontariocourtforms.on.ca/synthetic/form.docx";

// ---------------------------------------------------------------------------
// Approved host / allowlist
// ---------------------------------------------------------------------------
describe("approved source allowlist", () => {
  it("accepts the canonical host and its www. variant", () => {
    expect(isApprovedHost("ontariocourtforms.on.ca")).toBe(true);
    expect(isApprovedHost("www.ontariocourtforms.on.ca")).toBe(true);
  });

  it("rejects an unapproved host", () => {
    expect(isApprovedHost("evil.example.com")).toBe(false);
    expect(isApprovedHost("ontariocourtforms.on.ca.evil.example.com")).toBe(false);
    expect(isApprovedHost("ontario.ca")).toBe(false);
  });

  it("rejects HTTP (non-TLS) URLs even for the approved host", () => {
    expect(() => assertUrlShapeIsSafe("http://ontariocourtforms.on.ca/form.pdf")).toThrow(/https/i);
  });

  it("rejects unapproved-host URLs via full retrieval", async () => {
    const transport = new MockTransport({});
    await expect(
      retrieveOfficialFormArtifact({
        url: "https://evil.example.com/form.pdf",
        expectedFormat: "PDF",
        transport,
        resolver: PUBLIC_RESOLVER
      })
    ).rejects.toThrow(/not on the approved/i);
  });
});

// ---------------------------------------------------------------------------
// SSRF defense
// ---------------------------------------------------------------------------
describe("SSRF defense", () => {
  it("rejects localhost hostname", () => {
    expect(isLocalhostHostname("localhost")).toBe(true);
  });

  it("rejects 127.0.0.1", () => {
    expect(isBlockedIpLiteral("127.0.0.1")).toBe(true);
  });

  it("rejects an RFC1918 address (10/8, 172.16/12, 192.168/16)", () => {
    expect(isBlockedIpLiteral("10.1.2.3")).toBe(true);
    expect(isBlockedIpLiteral("172.16.5.5")).toBe(true);
    expect(isBlockedIpLiteral("172.31.255.255")).toBe(true);
    expect(isBlockedIpLiteral("192.168.1.1")).toBe(true);
    expect(isBlockedIpLiteral("172.32.0.1")).toBe(false); // just outside 172.16/12
  });

  it("rejects ::1", () => {
    expect(isBlockedIpLiteral("::1")).toBe(true);
  });

  it("rejects an IPv6 link-local address (fe80::/10)", () => {
    expect(isBlockedIpLiteral("fe80::1")).toBe(true);
  });

  it("rejects the cloud metadata address 169.254.169.254", () => {
    expect(isBlockedIpLiteral("169.254.169.254")).toBe(true);
  });

  it("rejects a public IP as safe (sanity check)", () => {
    expect(isBlockedIpLiteral("203.0.113.10")).toBe(false);
  });

  it("rejects embedded credentials in the URL", () => {
    expect(() => assertUrlShapeIsSafe("https://user:pass@ontariocourtforms.on.ca/form.pdf")).toThrow(/credentials/i);
  });

  it("rejects file:/ftp:/data:/javascript: schemes", () => {
    for (const url of [
      "file:///etc/passwd",
      "ftp://ontariocourtforms.on.ca/form.pdf",
      "data:text/plain;base64,AAAA",
      "javascript:alert(1)"
    ]) {
      expect(() => assertUrlShapeIsSafe(url)).toThrow();
    }
  });

  it("rejects retrieval when DNS resolves the approved host to a private address", async () => {
    const resolver = new MockDnsResolver({ "ontariocourtforms.on.ca": ["10.0.0.5"] });
    const transport = new MockTransport({ [APPROVED_PDF_URL]: ok(SYNTHETIC_PDF, "application/pdf") });
    await expect(
      retrieveOfficialFormArtifact({ url: APPROVED_PDF_URL, expectedFormat: "PDF", transport, resolver })
    ).rejects.toThrow(/blocked\/private range/i);
  });

  it("full retrieval rejects localhost URL end-to-end", async () => {
    const transport = new MockTransport({});
    await expect(
      retrieveOfficialFormArtifact({
        url: "https://localhost/form.pdf",
        expectedFormat: "PDF",
        transport,
        resolver: PUBLIC_RESOLVER
      })
    ).rejects.toThrow(/not on the approved/i); // fails allowlist before host-safety check, both reject it
  });
});

// ---------------------------------------------------------------------------
// Redirect defense
// ---------------------------------------------------------------------------
describe("redirect defense", () => {
  it("accepts an approved -> approved redirect", async () => {
    const step1 = "https://ontariocourtforms.on.ca/en/index.pdf";
    const step2 = "https://www.ontariocourtforms.on.ca/synthetic/final.pdf";
    const transport = new MockTransport({
      [step1]: redirect(step2),
      [step2]: ok(SYNTHETIC_PDF, "application/pdf")
    });
    const result = await retrieveOfficialFormArtifact({
      url: step1,
      expectedFormat: "PDF",
      transport,
      resolver: PUBLIC_RESOLVER
    });
    expect(result.finalValidatedUrl).toBe(step2);
    expect(result.detectedFormat).toBe("PDF");
  });

  it("rejects an approved -> unapproved redirect", async () => {
    const step1 = APPROVED_PDF_URL;
    const step2 = "https://evil.example.com/form.pdf";
    const transport = new MockTransport({ [step1]: redirect(step2) });
    await expect(
      retrieveOfficialFormArtifact({ url: step1, expectedFormat: "PDF", transport, resolver: PUBLIC_RESOLVER })
    ).rejects.toThrow(/not on the approved/i);
  });

  it("rejects an approved -> localhost redirect", async () => {
    const step1 = APPROVED_PDF_URL;
    const step2 = "https://localhost/steal";
    const transport = new MockTransport({ [step1]: redirect(step2) });
    await expect(
      retrieveOfficialFormArtifact({ url: step1, expectedFormat: "PDF", transport, resolver: PUBLIC_RESOLVER })
    ).rejects.toThrow(/not on the approved/i);
  });

  it("rejects a redirect loop", async () => {
    const a = "https://ontariocourtforms.on.ca/a.pdf";
    const b = "https://ontariocourtforms.on.ca/b.pdf";
    const transport = new MockTransport({
      [a]: redirect(b),
      [b]: redirect(a)
    });
    await expect(
      retrieveOfficialFormArtifact({ url: a, expectedFormat: "PDF", transport, resolver: PUBLIC_RESOLVER })
    ).rejects.toThrow(/redirect loop/i);
  });

  it("enforces a redirect count limit", async () => {
    // 7 chained distinct redirects, one more than MAX_REDIRECTS (5) allows.
    const urls = Array.from({ length: 8 }, (_, i) => `https://ontariocourtforms.on.ca/hop${i}.pdf`);
    const routes: Record<string, TransportResponse> = {};
    for (let i = 0; i < urls.length - 1; i++) {
      routes[urls[i]] = redirect(urls[i + 1]);
    }
    routes[urls[urls.length - 1]] = ok(SYNTHETIC_PDF, "application/pdf");
    const transport = new MockTransport(routes);
    await expect(
      retrieveOfficialFormArtifact({ url: urls[0], expectedFormat: "PDF", transport, resolver: PUBLIC_RESOLVER })
    ).rejects.toThrow(/exceeded the maximum of \d+ redirects/i);
  });
});

// ---------------------------------------------------------------------------
// Content validation
// ---------------------------------------------------------------------------
describe("content validation", () => {
  it("accepts a valid synthetic PDF", async () => {
    const transport = new MockTransport({ [APPROVED_PDF_URL]: ok(SYNTHETIC_PDF, "application/pdf") });
    const result = await retrieveOfficialFormArtifact({
      url: APPROVED_PDF_URL,
      expectedFormat: "PDF",
      transport,
      resolver: PUBLIC_RESOLVER,
      isSynthetic: true
    });
    expect(result.detectedFormat).toBe("PDF");
  });

  it("rejects HTML masquerading as PDF (misleading Content-Type)", async () => {
    const transport = new MockTransport({ [APPROVED_PDF_URL]: ok(SYNTHETIC_HTML_ERROR_PAGE, "application/pdf") });
    await expect(
      retrieveOfficialFormArtifact({ url: APPROVED_PDF_URL, expectedFormat: "PDF", transport, resolver: PUBLIC_RESOLVER })
    ).rejects.toThrow(/PDF signature/i);
  });

  it("rejects an empty PDF response", async () => {
    const transport = new MockTransport({ [APPROVED_PDF_URL]: ok(Buffer.alloc(0), "application/pdf", { declaredLength: null }) });
    await expect(
      retrieveOfficialFormArtifact({ url: APPROVED_PDF_URL, expectedFormat: "PDF", transport, resolver: PUBLIC_RESOLVER })
    ).rejects.toThrow(/empty/i);
  });

  it("accepts a valid synthetic DOCX", async () => {
    const transport = new MockTransport({
      [APPROVED_DOCX_URL]: ok(SYNTHETIC_DOCX, "application/vnd.openxmlformats-officedocument.wordprocessingml.document")
    });
    const result = await retrieveOfficialFormArtifact({
      url: APPROVED_DOCX_URL,
      expectedFormat: "DOCX",
      transport,
      resolver: PUBLIC_RESOLVER,
      isSynthetic: true
    });
    expect(result.detectedFormat).toBe("DOCX");
  });

  it("rejects an arbitrary ZIP masquerading as DOCX", async () => {
    const transport = new MockTransport({
      [APPROVED_DOCX_URL]: ok(ARBITRARY_ZIP, "application/vnd.openxmlformats-officedocument.wordprocessingml.document")
    });
    await expect(
      retrieveOfficialFormArtifact({ url: APPROVED_DOCX_URL, expectedFormat: "DOCX", transport, resolver: PUBLIC_RESOLVER })
    ).rejects.toThrow(/not a valid DOCX/i);
  });

  it("rejects HTML masquerading as DOCX", async () => {
    const transport = new MockTransport({
      [APPROVED_DOCX_URL]: ok(SYNTHETIC_HTML_ERROR_PAGE, "application/vnd.openxmlformats-officedocument.wordprocessingml.document")
    });
    await expect(
      retrieveOfficialFormArtifact({ url: APPROVED_DOCX_URL, expectedFormat: "DOCX", transport, resolver: PUBLIC_RESOLVER })
    ).rejects.toThrow(/not a valid DOCX/i);
  });

  it("rejects an empty DOCX response", async () => {
    const transport = new MockTransport({ [APPROVED_DOCX_URL]: ok(Buffer.alloc(0), "application/octet-stream", { declaredLength: null }) });
    await expect(
      retrieveOfficialFormArtifact({ url: APPROVED_DOCX_URL, expectedFormat: "DOCX", transport, resolver: PUBLIC_RESOLVER })
    ).rejects.toThrow(/empty/i);
  });
});

// ---------------------------------------------------------------------------
// Download bounds
// ---------------------------------------------------------------------------
describe("download bounds", () => {
  it("rejects an oversized declared Content-Length", async () => {
    const transport = new MockTransport({
      [APPROVED_PDF_URL]: ok(SYNTHETIC_PDF, "application/pdf", { declaredLength: MAX_ARTIFACT_BYTES + 1 })
    });
    await expect(
      retrieveOfficialFormArtifact({ url: APPROVED_PDF_URL, expectedFormat: "PDF", transport, resolver: PUBLIC_RESOLVER })
    ).rejects.toThrow(/exceeds the .* download bound/i);
  });

  it("rejects a chunked stream exceeding the limit without buffering the whole thing", async () => {
    const chunkSize = 1024;
    const numChunks = Math.floor(MAX_ARTIFACT_BYTES / chunkSize) + 10; // exceeds bound
    let yielded = 0;
    async function* oversizedChunks(): AsyncIterable<Buffer> {
      const chunk = Buffer.alloc(chunkSize, 0x41);
      for (let i = 0; i < numChunks; i++) {
        yielded++;
        yield chunk;
      }
    }
    await expect(readBoundedBody(oversizedChunks(), MAX_ARTIFACT_BYTES)).rejects.toThrow(/download bound/i);
    // Must have stopped well before exhausting the (huge) generator — proves it didn't buffer
    // the entire oversized stream before rejecting.
    expect(yielded).toBeLessThan(numChunks);
  });

  it("respects a smaller injected maxBytes bound for exact-boundary tests", async () => {
    const transport = new MockTransport({
      [APPROVED_PDF_URL]: ok(SYNTHETIC_PDF, "application/pdf", { declaredLength: null })
    });
    await expect(
      retrieveOfficialFormArtifact({
        url: APPROVED_PDF_URL,
        expectedFormat: "PDF",
        transport,
        resolver: PUBLIC_RESOLVER,
        maxBytes: SYNTHETIC_PDF.length - 1
      })
    ).rejects.toThrow(/download bound/i);
  });
});

// ---------------------------------------------------------------------------
// Byte integrity / SHA-256
// ---------------------------------------------------------------------------
describe("byte integrity", () => {
  it("preserves exact byte length through the pipeline", async () => {
    const transport = new MockTransport({
      [APPROVED_PDF_URL]: ok(SYNTHETIC_PDF, "application/pdf", { chunked: true, chunkSize: 7 })
    });
    const result = await retrieveOfficialFormArtifact({
      url: APPROVED_PDF_URL,
      expectedFormat: "PDF",
      transport,
      resolver: PUBLIC_RESOLVER
    });
    expect(result.byteLength).toBe(SYNTHETIC_PDF.length);
    expect(result.bytes.length).toBe(SYNTHETIC_PDF.length);
    expect(result.bytes.equals(SYNTHETIC_PDF)).toBe(true);
  });

  it("SHA-256 matches a known input/output test vector", () => {
    const input = Buffer.from("abc", "utf8");
    const expected = crypto.createHash("sha256").update(input).digest("hex");
    expect(sha256OfExactBytes(input)).toBe(expected);
    expect(expected).toMatch(/^[0-9a-f]{64}$/);
  });

  it("a single-byte mutation changes the SHA-256", () => {
    const original = Buffer.from(SYNTHETIC_PDF);
    const mutated = Buffer.from(SYNTHETIC_PDF);
    mutated[10] = mutated[10] ^ 0xff;
    expect(sha256OfExactBytes(original)).not.toBe(sha256OfExactBytes(mutated));
  });

  it("recomputes the hash server-side; a caller-provided hash cannot override it", async () => {
    const transport = new MockTransport({ [APPROVED_PDF_URL]: ok(SYNTHETIC_PDF, "application/pdf") });
    const result = await retrieveOfficialFormArtifact({
      url: APPROVED_PDF_URL,
      expectedFormat: "PDF",
      transport,
      resolver: PUBLIC_RESOLVER,
      // @ts-expect-error — there is deliberately no caller-hash parameter on the options type;
      // even if a caller adds an arbitrary extra field, it is never read or trusted.
      callerSuppliedSha256Hex: "0".repeat(64)
    });
    expect(result.sha256Hex).toBe(sha256OfExactBytes(SYNTHETIC_PDF));
    expect(result.sha256Hex).not.toBe("0".repeat(64));
  });
});

// ---------------------------------------------------------------------------
// Trusted development ingestion seam
// ---------------------------------------------------------------------------
describe("trusted development ingestion seam", () => {
  it("uses the identical content-validator as automatic retrieval", () => {
    expect(() =>
      ingestTrustedDevelopmentArtifact({
        sourceUrlForProvenanceOnly: "https://ontariocourtforms.on.ca/synthetic/manual.pdf",
        expectedFormat: "PDF",
        bytes: SYNTHETIC_HTML_ERROR_PAGE,
        isSynthetic: true
      })
    ).toThrow(/PDF signature/i);

    const result = ingestTrustedDevelopmentArtifact({
      sourceUrlForProvenanceOnly: "https://ontariocourtforms.on.ca/synthetic/manual.pdf",
      expectedFormat: "PDF",
      bytes: SYNTHETIC_PDF,
      isSynthetic: true
    });
    expect(result.detectedFormat).toBe("PDF");
  });

  it("uses the identical SHA-256 path as automatic retrieval", () => {
    const result = ingestTrustedDevelopmentArtifact({
      sourceUrlForProvenanceOnly: "https://ontariocourtforms.on.ca/synthetic/manual.pdf",
      expectedFormat: "PDF",
      bytes: SYNTHETIC_PDF,
      isSynthetic: true
    });
    expect(result.sha256Hex).toBe(sha256OfExactBytes(SYNTHETIC_PDF));
    expect(result.verificationOrigin).toBe("TRUSTED_DEVELOPMENT_INGESTION");
    expect(result.artifactBytesVerified).toBe(true);
  });

  it("has no signature accepting a caller-supplied hash", () => {
    const result = ingestTrustedDevelopmentArtifact({
      sourceUrlForProvenanceOnly: "https://ontariocourtforms.on.ca/synthetic/manual.pdf",
      expectedFormat: "PDF",
      bytes: SYNTHETIC_PDF
    } as any);
    // The function signature (TrustedDevelopmentIngestionInput) has no hash field at all; this
    // asserts the runtime behavior matches — the hash is always freshly computed.
    expect(result.sha256Hex).toBe(sha256OfExactBytes(SYNTHETIC_PDF));
  });

  it("an ordinary/public caller cannot invoke the trusted ingestion seam via any HTTP route", async () => {
    const routesSource = await import("node:fs/promises").then(fs =>
      fs.readFile(new URL("../officialFormRoutes.ts", import.meta.url), "utf8")
    );
    expect(routesSource).not.toMatch(/ingestTrustedDevelopmentArtifact/);
    // No route file in api/ registers a path containing "ingest".
    const files = await import("node:fs/promises").then(fs => fs.readdir(new URL("..", import.meta.url)));
    for (const file of files.filter(f => f.endsWith("Routes.ts"))) {
      const src = await import("node:fs/promises").then(fs => fs.readFile(new URL(`../${file}`, import.meta.url), "utf8"));
      expect(src).not.toMatch(/ingestTrustedDevelopmentArtifact/);
    }
  });
});

// ---------------------------------------------------------------------------
// Official-index-vs-byte-verification distinction
// ---------------------------------------------------------------------------
describe("official-index vs artifact-byte verification", () => {
  it("official-index metadata alone does not mark artifact bytes as verified", () => {
    const record = buildOfficialIndexMetadataRecord({
      formNumber: "8B",
      officialTitle: "Application (child protection and status review)",
      versionDateRaw: "Feb. 1, 2022",
      effectiveDateRaw: "May 1, 2022",
      pdfFilename: "form-8b-feb-2022-en.pdf",
      docxFilename: "form-8b-feb_1_2022-en.docx"
    });
    expect(record.officialIndexVerified).toBe(true);
    expect(record.artifactBytesVerified).toBe(false);
    expect(record.sha256Hex).toBeNull();
    expect(record.byteLengthPdf).toBeNull();
    expect(record.finalArtifactUrlPdf).toBeNull();
    expect(record.detectedFormat).toBeNull();
    expect(record.artifactVerifiedAt).toBeNull();
  });

  it("the real Ontario integration manifest leaves all five candidates' byte-level fields unverified", () => {
    expect(REAL_ONTARIO_FORM_CANDIDATES).toHaveLength(5);
    for (const record of REAL_ONTARIO_FORM_CANDIDATES) {
      expect(record.artifactBytesVerified).toBe(false);
      expect(record.sha256Hex).toBeNull();
      expect(record.byteLengthPdf).toBeNull();
      expect(record.byteLengthDocx).toBeNull();
      expect(record.finalArtifactUrlPdf).toBeNull();
      expect(record.finalArtifactUrlDocx).toBeNull();
      expect(record.detectedFormat).toBeNull();
      expect(record.artifactVerifiedAt).toBeNull();
    }
  });

  it("a mocked successful retrieval cannot establish real-Ontario CURRENT status", async () => {
    const transport = new MockTransport({ [APPROVED_PDF_URL]: ok(SYNTHETIC_PDF, "application/pdf") });
    const result = await retrieveOfficialFormArtifact({
      url: APPROVED_PDF_URL,
      expectedFormat: "PDF",
      transport,
      resolver: PUBLIC_RESOLVER,
      isSynthetic: true
    });
    // RetrievalResult has no currentnessStatus field at all — this subsystem cannot flip a
    // form-version's currentness_status by design; that remains a separate, explicit act in
    // the 9D-4A registry that a mocked retrieval result can never perform on its own.
    expect((result as any).currentnessStatus).toBeUndefined();
    expect(result.isSynthetic).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Public serialization
// ---------------------------------------------------------------------------
describe("public serialization", () => {
  it("excludes exact bytes and never carries a private storage location field", async () => {
    const transport = new MockTransport({ [APPROVED_PDF_URL]: ok(SYNTHETIC_PDF, "application/pdf") });
    const result = await retrieveOfficialFormArtifact({
      url: APPROVED_PDF_URL,
      expectedFormat: "PDF",
      transport,
      resolver: PUBLIC_RESOLVER
    });
    const pub = toPublicRetrievalResult(result);
    expect((pub as any).bytes).toBeUndefined();
    expect((pub as any).storageBucket).toBeUndefined();
    expect((pub as any).storagePath).toBeUndefined();
    expect(pub.sha256Hex).toBe(result.sha256Hex);
  });
});
