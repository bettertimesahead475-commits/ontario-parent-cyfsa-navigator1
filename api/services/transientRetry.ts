export function isTransientError(error: any): boolean {
  if (!error) return false;

  // 1. Check HTTP status code / postgrest status
  const statusCode = error.statusCode || error.status;
  if (statusCode !== undefined && statusCode !== null) {
    const num = Number(statusCode);
    if (!isNaN(num)) {
      if (num >= 400 && num < 500) {
        return false;
      }
      if (num === 502 || num === 503 || num === 504) {
        return true;
      }
    }
  }

  // 2. Check Postgres / PostgREST error codes
  const code = (error.code || "").toString().toUpperCase();
  if (code) {
    if (
      code.startsWith("42") ||
      code.startsWith("23") ||
      code.startsWith("22") ||
      code.startsWith("28") ||
      code.startsWith("3F") ||
      code.startsWith("PGRST")
    ) {
      return false;
    }
  }

  const msg = (error.message || String(error)).toLowerCase();
  const details = (error.details || "").toLowerCase();
  const hint = (error.hint || "").toLowerCase();
  const combinedText = `${msg} ${details} ${hint}`;

  // 3. Explicit non-retryable message patterns
  if (
    combinedText.includes("permission denied") ||
    combinedText.includes("row-level security") ||
    combinedText.includes("rls") ||
    combinedText.includes("jwt") ||
    combinedText.includes("unauthorized") ||
    combinedText.includes("forbidden") ||
    combinedText.includes("invalid input") ||
    combinedText.includes("syntax error") ||
    (combinedText.includes("relation") && combinedText.includes("does not exist")) ||
    (combinedText.includes("column") && combinedText.includes("does not exist")) ||
    combinedText.includes("sign_in_required")
  ) {
    return false;
  }

  // 4. Retryable transport/network error patterns
  if (
    combinedText.includes("fetch failed") ||
    combinedText.includes("econnreset") ||
    combinedText.includes("etimedout") ||
    combinedText.includes("enotfound") ||
    combinedText.includes("eai_again") ||
    combinedText.includes("und_err_connect_timeout") ||
    combinedText.includes("network error") ||
    combinedText.includes("network failure") ||
    combinedText.includes("socket hang up") ||
    combinedText.includes("socket interruption") ||
    combinedText.includes("connection reset") ||
    combinedText.includes("connection terminated") ||
    code === "ECONNRESET" ||
    code === "ETIMEDOUT" ||
    code === "ENOTFOUND" ||
    code === "EAI_AGAIN"
  ) {
    return true;
  }

  return false;
}

export async function withTransientRetry<T>(
  fn: () => Promise<T>,
  options: { maxAttempts?: number; initialDelayMs?: number } = {}
): Promise<T> {
  const maxAttempts = options.maxAttempts ?? 3;
  let delay = options.initialDelayMs ?? 200;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (err: any) {
      if (!isTransientError(err) || attempt === maxAttempts) {
        throw err;
      }
      await new Promise((resolve) => setTimeout(resolve, delay));
      delay *= 2;
    }
  }
  throw new Error("Retry attempts exhausted");
}
