export type AnalyzerErrorCode =
  | "UPLOAD_FAILED"
  | "EXTRACTION_FAILED"
  | "ACCESS_DENIED"
  | "USAGE_SERVICE_TEMPORARILY_UNAVAILABLE"
  | "USAGE_LIMIT_REACHED"
  | "AI_PROVIDER_TEMPORARILY_UNAVAILABLE"
  | "AI_PROVIDER_CONFIGURATION_ERROR"
  | "AI_REQUEST_REJECTED"
  | "AI_RATE_LIMITED"
  | "AI_RESPONSE_INVALID"
  | "ANALYSIS_PERSISTENCE_FAILED"
  | "INTERNAL_ANALYSIS_ERROR";

export class AnalyzerError extends Error {
  public readonly statusCode: number;
  public readonly code: AnalyzerErrorCode;
  public readonly userMessage: string;
  public readonly retryable: boolean;

  constructor(code: AnalyzerErrorCode, statusCode: number, userMessage: string, retryable = false) {
    super(userMessage);
    this.name = "AnalyzerError";
    this.code = code;
    this.statusCode = statusCode;
    this.userMessage = userMessage;
    this.retryable = retryable;
  }
}

/**
 * Converts an error thrown by an AI provider SDK (Anthropic or Google GenAI) into an
 * AnalyzerError using the HTTP status the SDK reports. Without this, a provider-side 401/403
 * (bad or revoked API key) fell into the generic "status === 401" branch below and told the
 * parent to sign in, and a 404 (unknown model) surfaced as a generic internal error. Nothing in
 * the returned error contains provider credentials; the provider's own status/type are only
 * logged server-side.
 */
export function providerFailure(error: any, provider: "claude" | "gemini"): AnalyzerError {
  if (error instanceof AnalyzerError) return error;
  const rawStatus = error?.status ?? error?.code;
  const status = typeof rawStatus === "number" ? rawStatus : undefined;
  const msg = String(error?.message || "").toLowerCase();
  console.error(
    `[AI Engine] ${provider} request failed: status=${status ?? "none"} name=${error?.name || "Error"} ` +
      `type=${error?.error?.error?.type || error?.error?.type || "unknown"}`
  );

  if (status === 429 || msg.includes("rate limit") || msg.includes("quota") || msg.includes("resource_exhausted")) {
    return new AnalyzerError(
      "AI_RATE_LIMITED",
      429,
      "The AI service is experiencing rate limits. Please wait a moment before retrying - your document is safe.",
      true
    );
  }
  if (status === 401 || status === 403 || status === 404) {
    return new AnalyzerError(
      "AI_PROVIDER_CONFIGURATION_ERROR",
      503,
      "The analysis service is unavailable right now because of a configuration problem on our side. Your document is safe and this attempt was not counted against your analyses.",
      false
    );
  }
  if (status === 400 || status === 413 || status === 422) {
    return new AnalyzerError(
      "AI_REQUEST_REJECTED",
      502,
      "The analysis service could not process this document as submitted. Your document is safe - if it is very long, try a shorter excerpt.",
      false
    );
  }
  // No status (connection reset, DNS, timeout) or 408/409/5xx/529 overloaded.
  return new AnalyzerError(
    "AI_PROVIDER_TEMPORARILY_UNAVAILABLE",
    503,
    "The AI analysis engine is temporarily busy or unreachable. Please wait a moment and try again - your document is safe.",
    true
  );
}

export function formatAnalyzerErrorResponse(error: any): {
  code: AnalyzerErrorCode | string;
  error: string;
  statusCode: number;
  retryable: boolean;
} {
  if (error instanceof AnalyzerError) {
    return {
      code: error.code,
      error: error.userMessage,
      statusCode: error.statusCode,
      retryable: error.retryable,
    };
  }

  // Explicitly constructed lifecycle errors (e.g. INVALID_SOURCE, EMPTY_SOURCE) already carry a
  // safe status/code/message - keep them instead of relabelling every one as a usage outage.
  if (error?.name === "LifecycleError" && error?.code && error.code !== "USAGE_SERVICE_TEMPORARILY_UNAVAILABLE") {
    const lifecycleStatus = typeof error.statusCode === "number" ? error.statusCode : 400;
    return {
      code: error.code,
      error: error.message,
      statusCode: lifecycleStatus,
      retryable: lifecycleStatus >= 500,
    };
  }

  if (error?.name === "LifecycleError" || error?.code === "USAGE_SERVICE_TEMPORARILY_UNAVAILABLE") {
    return {
      code: "USAGE_SERVICE_TEMPORARILY_UNAVAILABLE",
      error: error.message || "We couldn't verify your analysis access right now. Your document is safe. Please retry in a moment.",
      statusCode: error.statusCode || 503,
      retryable: true,
    };
  }

  const errMsg = (error?.message || String(error)).toLowerCase();
  const status = error?.statusCode || error?.status || 500;

  if (status === 401 || status === 403 || errMsg.includes("sign in") || errMsg.includes("unauthorized")) {
    return {
      code: "ACCESS_DENIED",
      error: "Please sign in to access document analysis features.",
      statusCode: status === 403 ? 403 : 401,
      retryable: false,
    };
  }

  if (
    status === 429 ||
    errMsg.includes("429") ||
    errMsg.includes("rate limit") ||
    errMsg.includes("quota")
  ) {
    return {
      code: "AI_RATE_LIMITED",
      error: "The AI service is experiencing rate limits. Please wait a moment before retrying - your document is safe.",
      statusCode: 429,
      retryable: true,
    };
  }

  if (status === 402 || errMsg.includes("free limit") || errMsg.includes("free analysis") || errMsg.includes("usage limit")) {
    return {
      code: "USAGE_LIMIT_REACHED",
      error: "You've used your free analysis limit. Upgrade to Pro or Premium for unlimited document analysis.",
      statusCode: 402,
      retryable: false,
    };
  }

  if (
    status === 503 ||
    errMsg.includes("503") ||
    errMsg.includes("overloaded") ||
    errMsg.includes("high demand") ||
    errMsg.includes("unavailable")
  ) {
    return {
      code: "AI_PROVIDER_TEMPORARILY_UNAVAILABLE",
      error: "The AI analysis engine is temporarily busy. Please wait a moment and try again.",
      statusCode: 503,
      retryable: true,
    };
  }

  if (errMsg.includes("json") || errMsg.includes("parsed") || errMsg.includes("parse")) {
    return {
      code: "AI_RESPONSE_INVALID",
      error: "The AI analysis response could not be formatted cleanly. Please retry analysis.",
      statusCode: 422,
      retryable: true,
    };
  }

  return {
    code: "INTERNAL_ANALYSIS_ERROR",
    error: "Something went wrong during document analysis. Your document is safe — please click Retry Analysis.",
    statusCode: status >= 400 && status < 600 ? status : 500,
    retryable: true,
  };
}
