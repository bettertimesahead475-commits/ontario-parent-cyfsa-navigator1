// Only explicitly constructed application errors may reach lifecycle API callers.
export class LifecycleError extends Error {
  constructor(public readonly statusCode: number, public readonly code: string, message: string) {
    super(message);
    this.name = "LifecycleError";
  }
}

export function requireUuid(value: unknown, field: string): string {
  if (typeof value !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value.trim())) {
    throw new LifecycleError(400, "INVALID_REQUEST", `${field} must be a UUID.`);
  }
  return value.trim();
}

export function requireText(value: unknown, field: string, max: number): string {
  if (typeof value !== "string" || !value.trim() || value.trim().length > max) {
    throw new LifecycleError(400, "INVALID_REQUEST", `${field} must contain 1–${max} characters.`);
  }
  return value.trim();
}
