import { describe, expect, it, vi } from "vitest";
import { BUNDLED_STATUTE_ENTRIES } from "../../src/utils/statuteReference";
import {
  runSectionedAnalysis,
  parseJsonObject,
  guardCitation,
  CONFIRMED_SECTION_KEYS,
  verifyQuoteAgainstSource,
  mergeVerification,
  buildSectionPrompt,
  UNVERIFIED_CITATION_NOTE,
  CANONICAL_DISCLAIMER,
  QUICK_SECTIONS,
  FORENSIC_SECTIONS,
  type GenerateFn,
} from "./analyzerSections.js";
import { AnalyzerError, redactDiagnostic } from "./analyzerErrors.js";
import { COMPLETE_ANALYSIS, VERIFICATION_RESULT, isVerificationRequest, requestedSection } from "../analyzerTestFixtures.js";

const DOC = "The worker states that a neighbour told me the child was left alone on March 3, 2026.";

function ok(obj: unknown, stopReason = "end_turn") {
  return { text: JSON.stringify(obj), usage: { input_tokens: 10, output_tokens: 5 }, model: "m", durationMs: 1, stopReason };
}

function responder(report: any = COMPLETE_ANALYSIS, verification: any = VERIFICATION_RESULT): GenerateFn {
  return vi.fn(async (params: any) => ok(isVerificationRequest(params) ? verification : report));
}

const base = (generate: GenerateFn, extra: Partial<Parameters<typeof runSectionedAnalysis>[0]> = {}) => ({
  mode: "fast" as const,
  documentText: DOC,
  primaryModel: "claude-sonnet-5",
  generate,
  deadlineAt: Date.now() + 200_000,
  requestId: "req_test",
  ...extra,
});

describe("runSectionedAnalysis", () => {
  it("assembles a Quick report from four validated sections", async () => {
    const generate = responder();
    const progress: string[] = [];
    const { report, usageByModel } = await runSectionedAnalysis(
      base(generate, { onSectionComplete: (key, _v, done, total) => void progress.push(`${key}:${done}/${total}`) })
    );
    expect(generate).toHaveBeenCalledTimes(QUICK_SECTIONS.length);
    expect(progress).toHaveLength(4);
    expect(progress.map((p) => p.split(":")[1])).toEqual(["1/4", "2/4", "3/4", "4/4"]);
    expect(report.fileSummary).toContain("affidavit");
    expect(report.disclaimer).toBe(CANONICAL_DISCLAIMER); // fixed text, never the model's variant
    expect(report.thresholdAnalysis).toBeUndefined(); // Forensic-only section
    expect(usageByModel["claude-sonnet-5"]).toEqual({ input_tokens: 40, output_tokens: 20 });
  });

  it("recomputes the Evidence Strength Index as the sum of its clamped components", async () => {
    const report = {
      ...COMPLETE_ANALYSIS,
      evidenceStrengthIndex: {
        score: 99,
        components: { ...COMPLETE_ANALYSIS.evidenceStrengthIndex.components, firsthandKnowledge: { score: 500, max: 20 } },
      },
    };
    const { report: out } = await runSectionedAnalysis(base(responder(report)));
    expect(out.evidenceStrengthIndex.components.firsthandKnowledge.score).toBe(20);
    expect(out.evidenceStrengthIndex.score).toBe(20 + 8 + 7 + 8 + 6 + 5 + 4 + 2);
  });

  it("retries a truncated section once with a brevity correction, then succeeds", async () => {
    let redFlagCalls = 0;
    const generate: GenerateFn = vi.fn(async (params: any) => {
      if (requestedSection(params) === "Evidence findings") {
        redFlagCalls++;
        if (redFlagCalls === 1) return ok(COMPLETE_ANALYSIS, "max_tokens");
        expect(JSON.stringify(params.messages)).toContain("cut off because it was too long");
      }
      return ok(COMPLETE_ANALYSIS);
    });
    const { attempts } = await runSectionedAnalysis(base(generate));
    expect(redFlagCalls).toBe(2);
    expect(attempts.redFlags).toBe(2);
  });

  it("fails honestly with AI_RESPONSE_INVALID when a section is still cut off after its retry", async () => {
    const generate: GenerateFn = vi.fn(async (params: any) =>
      requestedSection(params) === "Evidence findings" ? ok(COMPLETE_ANALYSIS, "max_tokens") : ok(COMPLETE_ANALYSIS)
    );
    await expect(runSectionedAnalysis(base(generate))).rejects.toMatchObject({
      code: "AI_RESPONSE_INVALID",
      userMessage: expect.stringMatching(/incomplete/),
    });
  });

  it("retries a section that fails validation, telling the model what was wrong", async () => {
    let guidanceCalls = 0;
    const generate: GenerateFn = vi.fn(async (params: any) => {
      if (requestedSection(params) === "Preparation guidance and questions for counsel") {
        guidanceCalls++;
        if (guidanceCalls === 1) return ok({ ...COMPLETE_ANALYSIS, whatToVerify: [] });
        expect(JSON.stringify(params.messages)).toContain("whatToVerify is empty");
      }
      return ok(COMPLETE_ANALYSIS);
    });
    const { report } = await runSectionedAnalysis(base(generate));
    expect(guidanceCalls).toBe(2);
    expect(report.whatToVerify.length).toBeGreaterThan(0);
  });

  it("does not retry a permanent provider failure and keeps its classification", async () => {
    const permanent = new AnalyzerError("AI_PROVIDER_CONFIGURATION_ERROR", 503, "config", false);
    const generate: GenerateFn = vi.fn(async () => {
      throw permanent;
    });
    await expect(runSectionedAnalysis(base(generate))).rejects.toBe(permanent);
  });

  it("keeps a transient provider failure's classification after the retry is exhausted", async () => {
    const limited = new AnalyzerError("AI_RATE_LIMITED", 429, "rate limited", true);
    const generate: GenerateFn = vi.fn(async (params: any) => {
      if (requestedSection(params) === "Evidence findings") throw limited;
      return ok(COMPLETE_ANALYSIS);
    });
    await expect(runSectionedAnalysis(base(generate))).rejects.toBe(limited);
  });

  it("clamps every attempt's timeout to the analysis deadline and skips retries without budget", async () => {
    const now = 1_000_000;
    const timeouts: number[] = [];
    const generate: GenerateFn = vi.fn(async (params: any) => {
      timeouts.push(params.timeoutMs);
      return ok(COMPLETE_ANALYSIS, "max_tokens"); // force the retry path
    });
    await expect(
      runSectionedAnalysis(base(generate, { deadlineAt: now + 20_000, now: () => now }))
    ).rejects.toMatchObject({ code: "AI_RESPONSE_INVALID" });
    expect(timeouts.every((t) => t <= 17_000)).toBe(true);
    // 20 s left is below the retry budget, so each section ran exactly once.
    expect(generate).toHaveBeenCalledTimes(QUICK_SECTIONS.length);
  });

  it("runs Forensic sections on the primary model and verification on the verification model", async () => {
    const report = {
      ...COMPLETE_ANALYSIS,
      redFlags: [
        {
          id: "rf1",
          severity: "CRITICAL",
          category: "Hearsay",
          evidenceClassification: "HEARSAY",
          phraseDetected: "a neighbour told me",
          explanation: "Secondhand.",
          legalReference: "CYFSA s. 94(5)",
        },
      ],
    };
    const verification = {
      findings: [{ id: "rf1", verdict: "OVERSTATED", recommendedSeverity: "Affects Evidentiary Weight", note: "One hearsay source." }],
      thresholds: [],
      overallAssessment: "Calibrate severity.",
    };
    const generate = responder(report, verification);
    const { report: out, usageByModel } = await runSectionedAnalysis(
      base(generate, { mode: "full", verificationModel: "claude-opus-5" })
    );
    const calls = (generate as any).mock.calls;
    expect(calls).toHaveLength(FORENSIC_SECTIONS.length + 1);
    expect(calls.filter((c: any) => c[1] === "claude-opus-5").every((c: any) => isVerificationRequest(c[0]))).toBe(true);
    expect(out.redFlags[0].severity).toBe("Affects Evidentiary Weight");
    expect(out.redFlags[0].originalSeverity).toBe("CRITICAL");
    expect(out.redFlags[0].forensicVerification.verdict).toBe("OVERSTATED");
    expect(out.redFlags[0].legalReference).toContain(UNVERIFIED_CITATION_NOTE); // s.94(5) is not confirmed
    expect(out.redFlags[0].quoteVerified).toBe(true);
    expect(out.forensicVerification.status).toBe("completed");
    expect(usageByModel["claude-opus-5"]).toBeDefined();
  });

  it("never puts a raw provider error into the customer's second-review reason", async () => {
    const leak = "upstream 500 for key sk-LIVESECRET123456 body: Sam Example was left alone";
    const generate = vi.fn(async (params: any) => {
      if (isVerificationRequest(params)) throw new Error(leak);
      return ok(requestedSection(params) ? COMPLETE_ANALYSIS : COMPLETE_ANALYSIS);
    }) as unknown as GenerateFn;
    const { report } = await runSectionedAnalysis(base(generate, { mode: "full", verificationModel: "claude-opus-5" }));
    expect(report.forensicVerification.status).toBe("incomplete");
    expect(report.forensicVerification.reason).not.toMatch(/sk-LIVESECRET|Sam Example|upstream/);
    expect(JSON.stringify(report)).not.toMatch(/sk-LIVESECRET|Sam Example was left alone/);
  });

  it("never puts a raw section provider error into the customer-facing failure", async () => {
    const leak = "socket hang up while sending sk-LIVESECRET123456 with document text";
    const generate = vi.fn(async () => {
      throw new Error(leak);
    }) as unknown as GenerateFn;
    const err = await runSectionedAnalysis(base(generate)).catch((e) => e);
    expect(err).toBeInstanceOf(AnalyzerError);
    expect(err.userMessage).not.toMatch(/sk-LIVESECRET|socket hang up|document text/);
  });

  it("labels verification incomplete instead of claiming it, when there is no time left for it", async () => {
    let t = 0;
    const generate = responder();
    const { report } = await runSectionedAnalysis(
      base(generate, {
        mode: "full",
        verificationModel: "claude-opus-5",
        deadlineAt: 200_000,
        now: () => t,
        onSectionComplete: () => {
          t = 190_000; // sections finished with only 10 s left
        },
      })
    );
    expect(report.forensicVerification.status).toBe("incomplete");
    expect(report.forensicVerification.reason).toMatch(/not been second-reviewed/);
  });
});

describe("deterministic guards", () => {
  it("parses a JSON object out of fenced or chatty model text, and rejects a cut-off one", () => {
    expect(parseJsonObject('```json\n{"a": {"b": "}"}}\n```')).toEqual({ a: { b: "}" } });
    expect(parseJsonObject('Here you go: {"x": 1} thanks')).toEqual({ x: 1 });
    expect(parseJsonObject('{"redFlags": [{"id": "rf1"')).toBeNull();
    expect(parseJsonObject("no json")).toBeNull();
  });

  it("confirms only the sections whose text is compared against the bundled statute", () => {
    expect([...CONFIRMED_SECTION_KEYS].sort()).toEqual(Object.keys(BUNDLED_STATUTE_ENTRIES).sort());
  });

  it("marks citations outside the confirmed reference as unverified", () => {
    expect(guardCitation("CYFSA 2017, Section 74").status).toBe("UNVERIFIED");
    expect(guardCitation("CYFSA s. 74(2)").status).toBe("CONFIRMED_REFERENCE");
    expect(guardCitation("CYFSA, S.O. 2017, c. 14, s. 94(1)").status).toBe("CONFIRMED_REFERENCE");
    const s81 = guardCitation("CYFSA s. 81(7)");
    expect(s81.status).toBe("CONFIRMED_REFERENCE");
    expect(guardCitation("CYFSA s. 94(5)").status).toBe("UNVERIFIED");
    expect(guardCitation("CYFSA s. 125(1)").status).toBe("UNVERIFIED");
    expect(guardCitation("CYFSA ss. 74(2) and 125(1)").status).toBe("UNVERIFIED");
    expect(guardCitation("CYFSA s. 74(2), 94(5)").status).toBe("UNVERIFIED");
    expect(guardCitation("CYFSA ss. 74(2) and 94(1)").status).toBe("CONFIRMED_REFERENCE");
    expect(guardCitation("CYFSA ss. 94(1) and (5)").status).toBe("UNVERIFIED");
    expect(guardCitation("CYFSA ss. 94(1) and (2)").status).toBe("CONFIRMED_REFERENCE");
    expect(guardCitation("CYFSA s. 94(1) and (2) of the Regulation").status).toBe("UNVERIFIED");
    expect(guardCitation("CYFSA s. 74(2)-(4)").status).toBe("UNVERIFIED");
    expect(guardCitation("CYFSA s. 74(2) and subs. 94(5)").status).toBe("UNVERIFIED");
    expect(guardCitation("CYFSA subsection 94(5)").status).toBe("UNVERIFIED");
    expect(s81.text).not.toContain(UNVERIFIED_CITATION_NOTE);
    expect(guardCitation("CLRA s. 8(1)").status).toBe("UNVERIFIED");
    expect(guardCitation(UNVERIFIED_CITATION_NOTE).text).toBe(UNVERIFIED_CITATION_NOTE); // not doubled
  });

  it("only treats a quotation as verified when it is in the source", () => {
    expect(verifyQuoteAgainstSource(DOC, "a neighbour told me")).toBe("EXACT");
    expect(verifyQuoteAgainstSource(DOC, "a  neighbour\ntold me")).toBe("NORMALIZED_WHITESPACE");
    expect(verifyQuoteAgainstSource("He said “left alone”.", 'He said "left alone".')).toBe("NORMALIZED_PUNCTUATION");
    expect(verifyQuoteAgainstSource(DOC, "the parent admitted neglect")).toBe("ABSENT");
  });

  it("never raises severity through verification", () => {
    const report: any = { redFlags: [{ id: "rf1", severity: "Affects Evidentiary Weight" }] };
    mergeVerification(report, { findings: [{ id: "rf1", verdict: "SUPPORTED", recommendedSeverity: "CRITICAL" }] }, "opus");
    expect(report.redFlags[0].severity).toBe("Affects Evidentiary Weight");
  });

  it("puts only the requested section's keys in the prompt and the document inside delimiters", () => {
    const prompt = buildSectionPrompt("guidance", "fast", DOC);
    expect(prompt).toContain('"whatToVerify"');
    expect(prompt).not.toContain('"redFlags"');
    expect(prompt).toContain(`<document>\nDOCUMENT TEXT CONTENT:\n${DOC}\n</document>`);
  });
});

describe("diagnostic redaction", () => {
  it("removes keys, bearer tokens, and email addresses from log text", () => {
    const out = redactDiagnostic("sk-ABCDEFGH12345 Bearer abc.def token=xyz parent@example.com");
    expect(out).not.toMatch(/sk-ABCDEFGH|abc\.def|xyz|parent@example/);
  });
  it.each([
    ["Stripe live key", "sk_live_51HxAbCdEfGhIj"],
    ["AWS access key", "AKIAIOSFODNN7EXAMPLE"],
    ["GitHub token", "ghp_abcdefghijklmnopqrstuvwxyz0123"],
    ["Slack token", "xoxb-1234567890-abcdefghij"],
    ["bare JWT", "eyJhbGciOiJIUzI1NiJ9.eyJyb2xlIjoic2VydmljZSJ9.abcSIGNATURE"],
    ["quoted apiKey with spaces", '{"apiKey": "abc def ghi"}'],
    ["password value", '{"password":"hunter2"}'],
    ["key in a URL", "https://api.example.test/v1?key=mySecretValue123"],
    ["Basic credential", "Authorization: Basic dXNlcjpwYXNzd29yZA=="],
  ])("removes a %s from log text", (_label, secret) => {
    const out = redactDiagnostic(`upstream said ${secret} here`);
    expect(out).not.toMatch(/sk_live_51|AKIAIOSFODNN7|ghp_abc|xoxb-|eyJhbGci|abc def|hunter2|mySecretValue|dXNlcjpwYXNz/);
  });
});
