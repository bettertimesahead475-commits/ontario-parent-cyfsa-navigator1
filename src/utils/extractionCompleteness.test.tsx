import { expect, it } from 'vitest';
import { requireCompleteExtraction } from './extractionCompleteness';

it('refuses incomplete evidence even when readable text exists', () => {
  expect(() => requireCompleteExtraction({ document: { complete: false }, pages: [{ pageNumber: 2, status: 'not_processed' }] })).toThrow('page(s) 2');
  expect(() => requireCompleteExtraction({ pages: [{ pageNumber: 1, status: 'partial' }] })).toThrow('Nothing was charged');
  expect(() => requireCompleteExtraction({ document: { incomplete: ['OCR limit reached'] } })).toThrow('incomplete');
});
it('permits completely processed documents, including confirmed blank pages', () => {
  expect(() => requireCompleteExtraction({ document: { complete: true, incomplete: ['No text was found on page(s) 2.'] }, pages: [{ pageNumber: 1, status: 'ok' }, { pageNumber: 2, status: 'empty' }] })).not.toThrow();
  expect(() => requireCompleteExtraction({ pages: [] })).not.toThrow();
});
