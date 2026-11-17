/**
 * Case Workspace ingestion manifest helpers.
 * No network writes, credit consumption or browser storage migration.
 * Documents are keyed by account + matter + immutable content hash, never filename.
 */
export interface CaseDocumentManifest {
  accountId: string;
  matterId: string;
  documentId: string;
  versionId: string;
  sha256: string;
  filename: string;
  mimeType: string;
  uploadedAt: string;
  extractionStatus: "pending" | "ready" | "failed";
  pageCount?: number;
}
export interface CaseAnalysisSelection {
  matterId: string;
  documentVersionIds: string[];
}
const SHA256 = /^[a-f0-9]{64}$/i;
export function validateCaseDocumentManifest(value: CaseDocumentManifest): void {
  if (!value.accountId || !value.matterId || !value.documentId || !value.versionId)
    throw new Error("A case document must belong to an authenticated account, matter and version.");
  if (!SHA256.test(value.sha256)) throw new Error("A valid SHA-256 content digest is required.");
  if (!value.filename.trim() || !value.mimeType.trim()) throw new Error("Document metadata is incomplete.");
}
export function selectCaseDocuments(
  matterId: string,
  accountId: string,
  documents: readonly CaseDocumentManifest[],
): CaseAnalysisSelection {
  if (!matterId || !accountId) throw new Error("Select an authenticated case.");
  const seen = new Set<string>();
  const ids: string[] = [];
  for (const doc of documents) {
    validateCaseDocumentManifest(doc);
    if (doc.matterId !== matterId || doc.accountId !== accountId || doc.extractionStatus !== "ready") continue;
    const dedupeKey = doc.sha256;
    if (seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);
    ids.push(doc.versionId);
  }
  return { matterId, documentVersionIds: ids };
}
