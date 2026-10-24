import { createHash } from "node:crypto";

/**
 * What counts as "the same Forensic analysis" for billing: the same paid session, the same document and the same
 * client id. A client id alone is not enough. Reusing an id for a different document, or from another account, is a
 * new analysis that is checked against the package limit and charged, while a genuine retry of the same document with
 * the same id still reuses its reservation and is not charged twice.
 *
 * The result is fixed length and carries no session id or document text. Returns null when the client sent no id,
 * so such requests are never treated as a retry of anything.
 */
export function forensicBillingKey(sessionId: string, documentText: string, clientKey: string | null | undefined): string | null {
  if (!clientKey) return null;
  const digest = createHash("sha256")
    .update(`${sessionId}\u0000${documentText}\u0000${clientKey}`)
    .digest("hex");
  return `forensic:${digest}`;
}
