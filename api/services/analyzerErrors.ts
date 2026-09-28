export type AnalyzerErrorCode =
  | "UPLOAD_FAILED"
  | "EXTRACTION_FAILED"
  | "ACCESS_DENIED"
  | "USAGE_SERVICE_TEMPORARILY_UNAVAILABLE"
  | "USAGE_LIMIT_REACHED"
  | "AI_PROVIDER_TEMPORARILY_UNAVAILABLE"
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

export function formatAnalyzerErrorResponse(error: any): {
  code: AnalyzerErrorCode;
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
