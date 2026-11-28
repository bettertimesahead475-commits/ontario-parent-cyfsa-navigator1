import { describe, expect, it } from 'vitest';
import { loadFoundationBlock, persistFoundation, type FoundationStore } from '../../functions/api/analyze';
import { documentFingerprint } from '../../functions/api/_report-cache';
import { buildConsolidatedPrompt } from '../../api/services/consolidatedForensic';
import { FOUNDATION_SCHEMA_VERSION, type AnalyticalFoundation } from '../../shared/analyticalFoundation';

const SECRET = 'synthetic-report-cache-secret-for-tests-only-0123456789';
const ENV = { REPORT_CACHE_SECRET: SECRET } as any;
const OWNER = 'owner-a';
const DOC = 'On March 3, 2026 Jane Example wrote that the child was left alone at home.';

const report = {
  metadata: { applicantName: 'Jane Example' },
  redFlags: [
    { phraseDetected: 'the child was left alone at home', quoteVerified: true, evidenceClassification: 'DIRECT', locationInDocument: 'Page 1', explanation: 'INTERPRETATION_MARKER', severity: 'CRITICAL' },
  ],
  chronology: [
    { date: 'March 3, 2026', event: 'Note written.', locationInDocument: 'Page 1', dateGrounding: { status: 'GROUNDED', isoDate: '2026-03-03', note: '' } },
  ],
  fileSummary: 'SUMMARY_MARKER',
};

function memoryStore(initial: AnalyticalFoundation | null = null) {
  const writes: Array<{ ownerUid: string; foundation: AnalyticalFoundation }> = [];
  let stored = initial;
  const store: FoundationStore = {
    async read() {
      return stored;
    },
    async write(ownerUid, foundation) {
      writes.push({ ownerUid, foundation });
      stored = foundation;
    },
  };
  return { store, writes };
}

describe('foundation wiring: persist then load', () => {
  it('persists verified facts keyed to the document fingerprint, without interpretations', async () => {
    const { store, writes } = memoryStore();
    await persistFoundation({ env: ENV, store, ownerUid: OWNER, documentText: DOC, report, sourceJobId: 'req_1', sourceMode: 'fast' });
    expect(writes).toHaveLength(1);
    const serialised = JSON.stringify(writes[0].foundation);
    expect(serialised).not.toContain('INTERPRETATION_MARKER');
    expect(serialised).not.toContain('SUMMARY_MARKER');
    expect(writes[0].foundation.documentFingerprint).toBe(await documentFingerprint(SECRET, OWNER, DOC));
    expect(writes[0].ownerUid).toBe(OWNER);
  });

  it('loads a stored foundation as prompt text for the same document and owner', async () => {
    const { store, writes } = memoryStore();
    await persistFoundation({ env: ENV, store, ownerUid: OWNER, documentText: DOC, report, sourceJobId: 'req_1', sourceMode: 'fast' });
    const block = await loadFoundationBlock({ env: ENV, store: memoryStore(writes[0].foundation).store, ownerUid: OWNER, documentText: DOC });
    expect(block).toContain('the child was left alone at home');
    expect(block).toMatch(/challenge or extend/);
  });
});

describe('foundation wiring: isolation and safety', () => {
  it('returns nothing when no store is configured (production default)', async () => {
    expect(await loadFoundationBlock({ env: ENV, store: undefined, ownerUid: OWNER, documentText: DOC })).toBeUndefined();
  });

  it('returns nothing when no cache secret is configured', async () => {
    const { store } = memoryStore();
    expect(await loadFoundationBlock({ env: {} as any, store, ownerUid: OWNER, documentText: DOC })).toBeUndefined();
  });

  it('ignores a stored foundation whose fingerprint does not match the current document', async () => {
    const { store, writes } = memoryStore();
    await persistFoundation({ env: ENV, store, ownerUid: OWNER, documentText: DOC, report, sourceJobId: 'req_1', sourceMode: 'fast' });
    const tampered = { ...writes[0].foundation, documentFingerprint: 'f'.repeat(64) };
    expect(await loadFoundationBlock({ env: ENV, store: memoryStore(tampered).store, ownerUid: OWNER, documentText: DOC })).toBeUndefined();
  });

  it('ignores a foundation written under a different schema version', async () => {
    const { store, writes } = memoryStore();
    await persistFoundation({ env: ENV, store, ownerUid: OWNER, documentText: DOC, report, sourceJobId: 'req_1', sourceMode: 'fast' });
    const old = { ...writes[0].foundation, schemaVersion: FOUNDATION_SCHEMA_VERSION + 1 };
    expect(await loadFoundationBlock({ env: ENV, store: memoryStore(old).store, ownerUid: OWNER, documentText: DOC })).toBeUndefined();
  });

  it('keys by owner: another account gets a different fingerprint and no block', async () => {
    expect(await documentFingerprint(SECRET, 'owner-b', DOC)).not.toBe(await documentFingerprint(SECRET, OWNER, DOC));
  });

  it('a failing read never throws; the run proceeds without the foundation', async () => {
    const failing: FoundationStore = {
      async read() {
        throw new Error('store unavailable');
      },
      async write() {},
    };
    await expect(loadFoundationBlock({ env: ENV, store: failing, ownerUid: OWNER, documentText: DOC })).resolves.toBeUndefined();
  });

  it('a failing write rejects so the caller can treat it as non-fatal', async () => {
    const failing: FoundationStore = {
      async read() {
        return null;
      },
      async write() {
        throw new Error('store unavailable');
      },
    };
    await expect(
      persistFoundation({ env: ENV, store: failing, ownerUid: OWNER, documentText: DOC, report, sourceJobId: 'req_1', sourceMode: 'fast' })
    ).rejects.toThrow('store unavailable');
  });
});

describe('foundation wiring: consolidated prompt placement', () => {
  it('places the foundation block after the document, never inside it', () => {
    const block = 'SOURCE FOUNDATION (test block)';
    const prompt = buildConsolidatedPrompt(['overview'] as any, DOC, undefined, block);
    expect(prompt.indexOf(block)).toBeGreaterThan(prompt.indexOf('</document>'));
  });

  it('omits the block entirely when none is supplied', () => {
    const prompt = buildConsolidatedPrompt(['overview'] as any, DOC);
    expect(prompt).not.toContain('SOURCE FOUNDATION');
  });
});
