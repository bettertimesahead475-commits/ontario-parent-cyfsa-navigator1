// AUDIT-ONLY regression (independent security auditor, Stage 9D-4B-1 review).
// Not part of the candidate's 42 claimed tests. Proves, structurally, that the DNS-resolved IP
// address used for the pre-connect SSRF check is never threaded through to the actual transport
// connection: `transport.request(normalized)` in officialFormRetrieval.ts is called with the
// *hostname URL*, not with a validated IP literal or a resolver-pinned socket. In production,
// createTrustedHttpsTransport() calls Node's fetch(url), which performs its own, independent DNS
// resolution at connect time. This is a classic TOCTOU / DNS-rebinding gap: if an attacker
// controls DNS answers for an approved hostname and can flip the answer between the resolver
// check and the transport's own lookup (e.g. a very short TTL, or race conditions on records
// with multiple answers), the bytes could be fetched from a different, unvalidated IP than the
// one this module actually checked.
//
// This test does not fix production code. It documents the gap so it cannot regress silently and
// so severity can be assessed explicitly rather than asserted away.
import { describe, it, expect } from "vitest";
import type { DnsResolver, Transport, TransportResponse } from "./officialFormRetrieval.js";
import { retrieveOfficialFormArtifact } from "./officialFormRetrieval.js";

describe("AUDIT: DNS validate-then-connect TOCTOU gap (informational, not a production fix)", () => {
  it("the transport is invoked with the hostname URL, never with the resolver's validated IP", async () => {
    let resolverWasCalled = false;
    let transportSawIpLiteral = false;

    const resolver: DnsResolver = {
      async resolve(hostname: string) {
        resolverWasCalled = true;
        // Simulate a benign answer at validation time.
        return ["93.184.216.34"];
      }
    };

    const pdfBytes = Buffer.from("%PDF-1.4\nAUDIT_SYNTHETIC_TEST_OFFICIAL_FORM\n%%EOF", "utf8");

    const transport: Transport = {
      async request(url: string): Promise<TransportResponse> {
        // If the retrieval pipeline pinned the connection to the validated IP, `url` (or some
        // side-channel) would carry that IP here. It does not: it is handed the original
        // hostname-based URL string, unchanged, and nothing about the resolver's answer is
        // passed to the transport at all.
        transportSawIpLiteral = /^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}/.test(new URL(url).hostname);
        async function* body() {
          yield pdfBytes;
        }
        return { status: 200, headers: { "content-type": "application/pdf" }, body: body() };
      }
    };

    const result = await retrieveOfficialFormArtifact({
      url: "https://ontariocourtforms.on.ca/synthetic/audit.pdf",
      expectedFormat: "PDF",
      transport,
      resolver
    });

    expect(resolverWasCalled).toBe(true);
    // This is the gap: the transport never receives an IP-pinned target. In production, the real
    // transport (fetch) will therefore re-resolve DNS independently at connect time, meaning the
    // hop that was actually range-checked is not provably the hop that is actually connected to.
    expect(transportSawIpLiteral).toBe(false);
    expect(result.detectedFormat).toBe("PDF");
  });
});
