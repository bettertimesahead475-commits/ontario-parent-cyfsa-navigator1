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

export interface AiDiagnosticParams {
  requestId: string;
  stage: string;
  mode?: "fast" | "full";
  model: string;
  provider: "claude" | "gemini";
  httpStatus?: number | null;
  errorCode?: string | null;
  errorType?: string | null;
  durationMs: number;
  timeoutOrAbort?: boolean;
  attempt?: number;
  tokens?: { inputTokens: number; outputTokens: number } | null;
  outcome: "success" | "retry" | "failure";
  message?: string;
}

export function logAiDiagnostic(params: AiDiagnosticParams): void {
  const sanitized = {
    tag: "[AI_DIAGNOSTIC_TRACE]",
    requestId: params.requestId,
    stage: params.stage,
    mode: params.mode ?? "fast",
    model: params.model,
    provider: params.provider,
    httpStatus: params.httpStatus ?? null,
    errorCode: params.errorCode ?? null,
    errorType: params.errorType ?? null,
    durationMs: params.durationMs,
    timeoutOrAbort: Boolean(params.timeoutOrAbort),
    attempt: params.attempt ?? 1,
    tokens: params.tokens ?? null,
    outcome: params.outcome,
  };
  console.log(JSON.stringify(sanitized));
}

/**
 * Converts an error thrown by an AI provider SDK (Anthropic or Google GenAI) into an
 * AnalyzerError using the HTTP status the SDK reports. Without this, a provider-side 401/403
 * (bad or revoked API key) fell into the generic "status === 401" branch below and told the
 * parent to sign in, and a 404 (unknown model) surfaced as a generic internal error. Nothing in
 * the returned error contains provider credentials; the provider's own status/type are only
 * logged server-side.
 */
export function providerFailure(
  error: any,
  provider: "claude" | "gemini",
  context?: { requestId?: string; stage?: string; mode?: "fast" | "full"; model?: string; durationMs?: number; attempt?: number }
): AnalyzerError {
  if (error instanceof AnalyzerError) return error;
  const rawStatus = error?.status ?? error?.code;
  const status = typeof rawStatus === "number" ? rawStatus : undefined;
  const msg = String(error?.message || "").toLowerCase();
  const errorName = String(error?.name || "Error");
  const errorType = error?.error?.error?.type || error?.error?.type || "unknown";

  const isTimeout =
    errorName === "APIConnectionTimeoutError" ||
    msg.includes("timed out") ||
    msg.includes("timeout") ||
    error?.code === "ETIMEDOUT";

  const isAbort =
    errorName === "APIUserAbortError" ||
    errorName === "AbortError" ||
    msg.includes("abort");

  const isRateLimit =
    status === 429 ||
    msg.includes("rate limit") ||
    msg.includes("quota") ||
    msg.includes("resource_exhausted");

  const isAuth =
    status === 401 ||
    (status === 403 && (msg.includes("api key") || msg.includes("auth") || msg.includes("permission") || msg.includes("credential")));

  const isCredits =
    status === 402 ||
    msg.includes("credit") ||
    msg.includes("balance") ||
    msg.includes("billing");

  const isNotFound =
    status === 404 ||
    errorType === "not_found_error" ||
    msg.includes("model not found") ||
    msg.includes("unknown model");

  const isBadReq =
    status === 400 ||
    status === 413 ||
    status === 422;

  let classification = "TEMPORARY_UNAVAILABLE";
  if (isTimeout) classification = "REQUEST_TIMEOUT";
  else if (isAbort) classification = "REQUEST_ABORTED";
  else if (isRateLimit) classification = "RATE_LIMIT";
  else if (isAuth) classification = "AUTHENTICATION_FAILURE";
  else if (isCredits) classification = "INSUFFICIENT_CREDITS";
  else if (isNotFound) classification = "INVALID_MODEL";
  else if (isBadReq) classification = "REQUEST_REJECTED";
  else if (status === 503 || status === 529 || msg.includes("overloaded")) classification = "PROVIDER_OUTAGE";

  console.error(
    `[AI Engine] ${provider} request failed: status=${status ?? "none"} name=${errorName} ` +
      `type=${errorType} classification=${classification} timeoutOrAbort=${isTimeout || isAbort}`
  );

  let resultError: AnalyzerError;

  if (isRateLimit) {
    resultError = new AnalyzerError(
      "AI_RATE_LIMITED",
      429,
      "The AI service is experiencing rate limits. Please wait a moment before retrying - your document is safe.",
      true
    );
  } else if (isAuth || isNotFound || isCredits) {
    resultError = new AnalyzerError(
      "AI_PROVIDER_CONFIGURATION_ERROR",
      503,
      "The analysis service is unavailable right now because of a configuration problem on our side. Your document is safe and this attempt was not counted against your analyses.",
      false
    );
  } else if (isBadReq) {
    resultError = new AnalyzerError(
      "AI_REQUEST_REJECTED",
      502,
      "The analysis service could not process this document as submitted. Your document is safe - if it is very long, try a shorter excerpt.",
      false
    );
  } else {
    // Timeout, connection drop, DNS, or 503/529 provider overload
    const userMessage = isTimeout
      ? "The AI analysis engine timed out while processing this document. Please retry — if the file is long, try a shorter excerpt."
      : "The AI analysis engine is temporarily busy or unreachable. Please wait a moment and try again - your document is safe.";

    resultError = new AnalyzerError(
      "AI_PROVIDER_TEMPORARILY_UNAVAILABLE",
      503,
      userMessage,
      true
    );
  }

  if (context?.requestId) {
    logAiDiagnostic({
      requestId: context.requestId,
      stage: context.stage || "ai_analysis",
      mode: context.mode,
      model: context.model || "unknown",
      provider,
      httpStatus: status ?? null,
      errorCode: resultError.code,
      errorType: String(errorType),
      durationMs: context.durationMs ?? 0,
      timeoutOrAbort: isTimeout || isAbort,
      attempt: context.attempt ?? 1,
      outcome: "failure",
      message: resultError.userMessage,
    });
  }

  return resultError;
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

  const isDatabaseError =
    Boolean(error?.supabaseError) ||
    errMsg.includes("supabase") ||
    errMsg.includes("postgrest") ||
    errMsg.includes("pgrst") ||
    errMsg.includes("relation") ||
    errMsg.includes("database");

  if (isDatabaseError) {
    return {
      code: "USAGE_SERVICE_TEMPORARILY_UNAVAILABLE",
      error: "We couldn't verify your analysis access right now. Your document is safe. Please retry in a moment.",
      statusCode: 503,
      retryable: true,
    };
  }

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
      error: "You've used your free analysis limit. Upgrade to Individual Case Access for unlimited document analysis.",
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
