import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
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
