import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { redactDiagnostic } from "./analyzerErrors.js";
import {
  providerErrorClass,
  isProviderConnectionFailure,
  providerNetworkCause,
  providerFailure,
  AnalyzerError,
} from "./analyzerErrors.js";

// The Anthropic SDK never assigns `name` on its error subclasses, so these mirror that shape:
// `name` stays "Error" and only the constructor name identifies the class.
class AnthropicError extends Error {}
class APIError extends AnthropicError {
  status: number | undefined;
  error: any;
  constructor(status: number | undefined, message: string, error?: any) {
    super(message);
    this.status = status;
    this.error = error;
  }
}
class APIConnectionError extends APIError {
  constructor(message = "Connection error.", cause?: Error) {
    super(undefined, message);
    if (cause) (this as any).cause = cause;
  }
}
class APIConnectionTimeoutError extends APIConnectionError {
  constructor() {
    super("Request timed out.");
  }
}

describe("provider error classification (SDK error shape)", () => {
  beforeEach(() => {
    vi.spyOn(console, "error").mockImplementation(() => {});
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("reads the constructor name because SDK errors keep name === 'Error'", () => {
    const err = new APIConnectionTimeoutError();
    expect(err.name).toBe("Error");
    expect(providerErrorClass(err)).toBe("APIConnectionTimeoutError");
    expect(isProviderConnectionFailure(err)).toBe(true);
    expect(isProviderConnectionFailure(new APIError(500, "boom"))).toBe(false);
  });

  it("exposes the Node network cause code without leaking anything else", () => {
    const err = new APIConnectionError("Connection error.", Object.assign(new Error("reset"), { code: "ECONNRESET" }));
    expect(providerNetworkCause(err)).toBe("ECONNRESET");
    expect(providerNetworkCause(new APIConnectionError())).toBeNull();
  });

  it("classifies a connection drop with no HTTP status as retryable, not a generic failure", () => {
    const result = providerFailure(new APIConnectionError(), "claude", { requestId: "req_test", model: "claude-sonnet-5" });
    expect(result).toBeInstanceOf(AnalyzerError);
    expect(result.code).toBe("AI_PROVIDER_TEMPORARILY_UNAVAILABLE");
    expect(result.statusCode).toBe(503);
    expect(result.retryable).toBe(true);
    expect(result.userMessage).toMatch(/connection .* interrupted/i);
  });

  it("classifies a request timeout as a timeout message", () => {
    const result = providerFailure(new APIConnectionTimeoutError(), "claude");
    expect(result.code).toBe("AI_PROVIDER_TEMPORARILY_UNAVAILABLE");
    expect(result.userMessage).toMatch(/timed out/i);
    expect(result.retryable).toBe(true);
  });

  it("does not mark invalid credentials or unknown models as retryable", () => {
    const auth = providerFailure(new APIError(401, "invalid x-api-key"), "claude");
    expect(auth.code).toBe("AI_PROVIDER_CONFIGURATION_ERROR");
    expect(auth.retryable).toBe(false);

    const missingModel = providerFailure(new APIError(404, "model: claude-x", { type: "not_found_error" }), "claude");
    expect(missingModel.code).toBe("AI_PROVIDER_CONFIGURATION_ERROR");
    expect(missingModel.retryable).toBe(false);
  });

  it("classifies insufficient credits and rate limits distinctly", () => {
    const credits = providerFailure(new APIError(400, "Your credit balance is too low to access the API."), "claude");
    expect(credits.code).toBe("AI_PROVIDER_CONFIGURATION_ERROR");

    const limited = providerFailure(new APIError(429, "rate limited"), "claude");
    expect(limited.code).toBe("AI_RATE_LIMITED");
    expect(limited.retryable).toBe(true);
  });

  it("keeps an existing AnalyzerError unchanged", () => {
    const original = new AnalyzerError("AI_RESPONSE_INVALID", 422, "bad json", true);
    expect(providerFailure(original, "claude")).toBe(original);
  });
});

// SonarCloud S8786: the labelled-value patterns lost their leading [A-Za-z_]* (it only re-emitted its own text via $1)
// and the email pattern became shared replaceEmailAddresses. The former list is the reference.
describe("redactDiagnostic (S8786 linear rewrite)", () => {
  const FORMER: Array<[RegExp, string]> = [
    [/\b(?:sk|pk|rk)_(?:live|test)_[A-Za-z0-9]{8,}/g, "[redacted]"],
    [/\bAKIA[0-9A-Z]{16}\b/g, "[redacted]"],
    [/\bgh[pousr]_[A-Za-z0-9]{20,}/g, "[redacted]"],
    [/\bxox[abprs]-[A-Za-z0-9-]{10,}/g, "[redacted]"],
    [/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g, "[redacted]"],
    [/\bsk-[A-Za-z0-9_-]{8,}/g, "[redacted]"],
    [/AIza[0-9A-Za-z_-]{20,}/g, "[redacted]"],
    [/\bBearer\s+\S+/gi, "Bearer [redacted]"],
    [/\bBasic\s+[A-Za-z0-9+/=]+/gi, "Basic [redacted]"],
    [/([A-Za-z_]*(?:api[_-]?key|apikey|token|secret|password|passwd|authorization|key)["']?\s*[:=]\s*)"[^"]*"/gi, '$1"[redacted]"'],
    [/([A-Za-z_]*(?:api[_-]?key|apikey|token|secret|password|passwd|authorization|key)["']?\s*[:=]\s*)[^\s"',;&]+/gi, "$1[redacted]"],
    [/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, "[redacted]"],
  ];
  const former = (input: string, maxLength = 100_000) => {
    let text = input;
    for (const [pattern, replacement] of FORMER) text = text.replace(pattern, replacement);
    return text.length > maxLength ? `${text.slice(0, maxLength)}...` : text;
  };

  it("redacts exactly as the former pattern list did", () => {
    const samples = [
      'request failed: {"apiKey": "abc def", "my_api_key":"x", "x-api-key": "y"} token=xyz password: hunter2 ?key=abc&other=1',
      "MY_SECRET_TOKEN=s3cr3t, passwordless=ok, keyboard: qwerty, monkey=banana",
      "authorization: Bearer abc.def and Basic dXNlcjpwYXNz from ops@example.org",
      "x@y.comz@w.org",
    ];
    for (const s of samples) expect(redactDiagnostic(s, 100_000), s).toBe(former(s));
    const alphabet = ["my_", "api", "_", "-", "key", "Key", "token", "secret", "pass", "wd", "=", ":", " ", '"', "'", "abc", "a@b.co", ",", "&"];
    let seed = 17;
    for (let i = 0; i < 20_000; i++) {
      let s = "";
      for (let j = 0; j < 10; j++) { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; s += alphabet[seed % alphabet.length]; }
      expect(redactDiagnostic(s, 100_000), JSON.stringify(s)).toBe(former(s));
    }
  });

  it("is linear on 50,000 letters (quadratic for the former patterns)", () => {
    const t0 = performance.now();
    expect(redactDiagnostic("a".repeat(50_000) + "!", 10)).toBe("aaaaaaaaaa...");
    expect(performance.now() - t0).toBeLessThan(100);
  });
});
