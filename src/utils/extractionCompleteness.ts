/** Never reserve an analysis credit for silently incomplete source evidence. */
export function requireCompleteExtraction(result: {
  document?: { complete?: boolean; incomplete?: string[] };
  pages?: Array<{ pageNumber?: number | null; status?: string }>;
}): void {
  const missing = (result.pages ?? []).filter(page => page.status === 'partial' || page.status === 'not_processed');
  const legacyWarning = result.document?.complete === undefined && !!result.document?.incomplete?.length;
  if (result.document?.complete === false || missing.length || legacyWarning) {
    const numbers = missing.map(page => page.pageNumber).filter(page => typeof page === 'number');
    throw new Error(`Text extraction is incomplete${numbers.length ? ` on page(s) ${numbers.join(', ')}` : ''}. Re-upload those pages or split the document before analyzing it. Nothing was charged.`);
  }
}
