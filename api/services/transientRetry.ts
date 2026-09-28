export function isTransientError(error: any): boolean {
  if (!error) return false;
  const msg = (error.message || String(error)).toLowerCase();
  const code = (error.code || "").toUpperCase();

  if (
    msg.includes("fetch failed") ||
    msg.includes("econnreset") ||
    msg.includes("etimedout") ||
    msg.includes("enotfound") ||
    msg.includes("eai_again") ||
    msg.includes("und_err_connect_timeout") ||
    msg.includes("network error") ||
    msg.includes("network failure") ||
    msg.includes("socket hang up") ||
    msg.includes("connection reset") ||
    msg.includes("connection terminated") ||
    code === "ECONNRESET" ||
    code === "ETIMEDOUT" ||
    code === "ENOTFOUND" ||
    code === "EAI_AGAIN"
  ) {
    return true;
  }

  const statusCode = error.statusCode || error.status;
  if (statusCode === 502 || statusCode === 503 || statusCode === 504) {
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
