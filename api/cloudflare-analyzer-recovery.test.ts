import { describe, expect, it, vi, beforeEach } from 'vitest';
import { handleAnalyzeRequest } from '../functions/api/analyze';
import {
  repairTruncatedJsonObject,
  salvagePartialDirectSections,
} from './services/directAnalyzer';

const mockAuthVerification = vi.fn();
vi.mock('../functions/api/_auth-check', () => ({
  verifyFirebaseRequest: (req: Request, env: any) => mockAuthVerification(req, env),
  onRequestGet: vi.fn(),
}));

const SAMPLE_DOC = `IN THE ONTARIO COURT OF JUSTICE
CHILDREN'S AID SOCIETY OF TORONTO (Applicant)
- and -
JANE CLARKE (Respondent)

AFFIDAVIT OF CHILD PROTECTION WORKER
I, Sarah Jenkins, child protection worker, make oath and say as follows:
1. On October 12, 2026, the Society received a referral concerning the respondent parent.
2. An anonymous neighbour reported seeing the parent intoxicated on the front porch.
3. Worker attended the residence on October 14, 2026. The parent refused to discuss the allegations.
4. CAS records indicate prior voluntary involvement in 2024.
Sworn before me on October 15, 2026.`;

const VALID_OVERVIEW_AND_REDFLAGS_TRUNCATED = `
{
  "documentTitle": "Affidavit of Child Protection Worker",
  "documentType": "Affidavit",
  "metadata": {
    "fileNumber": "FC-26-00123",
    "applicantName": "Children's Aid Society",
    "respondentName": "Jane Clarke",
    "childNames": "Child Clarke",
    "hearingDate": "October 20, 2026"
  },
  "disclaimer": "Informational only.",
  "completenessScore": 85,
  "completenessScoreMethod": "Standard evaluation",
  "evidenceStrengthIndex": {
    "score": 60,
    "scale": "0-100",
    "label": "Evidence Strength Index",
    "method": "Calculated from documented evidence.",
    "components": {
      "firsthandKnowledge": { "score": 15, "max": 20, "explanation": "Worker personal observations" },
      "sourceReliability": { "score": 10, "max": 15, "explanation": "Identified sources" },
      "corroboration": { "score": 10, "max": 15, "explanation": "Partial corroboration" },
      "documentarySupport": { "score": 10, "max": 15, "explanation": "Intake notes" },
      "internalConsistency": { "score": 5, "max": 10, "explanation": "Internally consistent" },
      "contradictoryEvidenceHandling": { "score": 5, "max": 10, "explanation": "Parent statements noted" },
      "legalAuthorityVerification": { "score": 3, "max": 10, "explanation": "CYFSA cited" },
      "proceduralDocumentation": { "score": 2, "max": 5, "explanation": "Affidavit sworn" }
    },
    "calculation": "Sum of components",
    "limitations": "Heuristic evaluation only."
  },
  "fileSummary": "This document is an affidavit filed by CAS alleging lack of cooperation and parental intoxication based on an anonymous report. The key evidence is worker attendance notes. The primary weakness is lack of corroboration for the anonymous tip. The parent should seek disclosure of intake logs and 911 calls.",
  "redFlags": [
    {
      "id": "rf1",
      "severity": "Worth Raising With Counsel",
      "category": "Hearsay",
      "evidenceClassification": "HEARSAY",
      "phraseDetected": "An anonymous neighbour reported seeing the parent intoxicated on the front porch.",
      "explanation": "The worker relies upon an anonymous secondhand telephone allegation without independent toxicological or medical corroboration. Under CYFSA s. 74 standards, unverified tips possess minimal probative weight.",
      "verifyRequirement": "Request disclosure of intake screening notes and caller details.",
      "legalReference": "CYFSA s. 74",
      "locationInDocument": "Paragraph 2",
      "parentActionStep": "Consult legal counsel regarding excluding uncorroborated hearsay."
    }
  ],
  "chronology": [
    {
      "date": "October 12, 2026",
      "event": "Society received an anonymous referral alleging parent intoxication.",
      "locationInDocument": "Paragraph 1"
`;

describe('Truncation Recovery & JSON Repair Unit Logic', () => {
  it('repairs truncated JSON objects with dangling fragments and unclosed arrays/objects', () => {
    const brokenJson = '{"a": 1, "b": ["item1", "item2", {"sub": "va';
    const repaired = repairTruncatedJsonObject(brokenJson);
    expect(repaired).not.toBeNull();
    expect(repaired.a).toBe(1);
    expect(Array.isArray(repaired.b)).toBe(true);
  });

  it('salvages valid overview, redFlags and chronology while identifying guidance as missing', () => {
    const salvaged = salvagePartialDirectSections(VALID_OVERVIEW_AND_REDFLAGS_TRUNCATED, 'fast');
    expect(salvaged.completedKeys).toContain('overview');
    expect(salvaged.completedKeys).toContain('redFlags');
    expect(salvaged.completedKeys).toContain('chronology');
    expect(salvaged.missingKeys).toContain('guidance');
    expect(salvaged.salvagedReport.redFlags).toHaveLength(1);
    expect(salvaged.salvagedReport.redFlags[0].id).toBe('rf1');
    expect(salvaged.salvagedReport.chronology).toHaveLength(1);
  });
});

describe('Cloudflare Analyzer Intelligent Truncation Recovery Pipeline', () => {
  const env: any = {
    ANALYZER_ENABLED: 'true',
    FIREBASE_PROJECT_ID: 'test-project',
    ANTHROPIC_API_KEY: 'test-anthropic-key',
  };

  beforeEach(() => {
    mockAuthVerification.mockReset();
  });

  it('recovers missing sections when direct analysis truncates at max_tokens with partial valid sections', async () => {
    mockAuthVerification.mockResolvedValueOnce({ status: 'verified', uid: 'user_recovery_test' });

    const releasedCalls: string[] = [];
    const finalizedCalls: string[] = [];
    const mockRpc = vi.fn(async (name: string) => {
      if (name === 'free_reserve_scan') return { status: 'reserved', reservation_id: 'res_rec_01' };
      if (name === 'free_release_scan') {
        releasedCalls.push(name);
        return { status: 'released' };
      }
      if (name === 'free_finalize_scan') {
        finalizedCalls.push(name);
        return { status: 'consumed' };
      }
      return { status: 'noop' };
    });

    // Mock generate: Call 1 (direct) hits max_tokens with partial JSON
    // Subsequent calls (recovery for chronology & guidance) succeed with valid section payloads
    const mockGenerate = vi.fn()
      .mockResolvedValueOnce({
        text: VALID_OVERVIEW_AND_REDFLAGS_TRUNCATED,
        stopReason: 'max_tokens',
        model: 'claude-sonnet-5',
        durationMs: 4000,
        usage: { input_tokens: 600, output_tokens: 4096 },
      })
      .mockResolvedValueOnce({
        // Section call for chronology
        text: JSON.stringify({
          chronology: [
            {
              date: 'October 12, 2026',
              event: 'Society received an anonymous referral alleging parent intoxication.',
              locationInDocument: 'Paragraph 1',
              evidenceClassification: 'HEARSAY',
            },
          ],
          contradictions: [
            {
              description: 'Worker reported refusal to discuss, but phone record indicates conversation occurred.',
              locations: ['Paragraph 3', 'CAS Intake Note'],
              significance: 'Materially bears upon worker assessment of parental cooperation.',
            },
          ],
        }),
        stopReason: 'end_turn',
        model: 'claude-sonnet-5',
        durationMs: 2000,
        usage: { input_tokens: 700, output_tokens: 400 },
      })
      .mockResolvedValueOnce({
        // Section call for guidance
        text: JSON.stringify({
          whatToVerify: ['Request complete intake audio recording from October 12, 2026.'],
          whatToAskALawyer: [
            'Question: Can the anonymous hearsay report be excluded? | What the uploaded record shows: The worker concedes the caller was unverified | Still unknown: Whether caller identity was confirmed | Source: Paragraph 2.',
          ],
          whatIsMissing: ['Contemporaneous toxicological assessment or officer notes.'],
          lawyerCaseBrief: [
            'ISSUE: Uncorroborated anonymous hearsay — DOCUMENT EVIDENCE: Paragraph 2 allegation — SIGNIFICANCE: Insufficient grounds under CYFSA s. 74 without corroboration — LIMITATION: CAS may investigate — VERIFY: Request caller log disclosure.',
          ],
        }),
        stopReason: 'end_turn',
        model: 'claude-sonnet-5',
        durationMs: 2000,
        usage: { input_tokens: 700, output_tokens: 400 },
      });

    const request = new Request('https://staging.example/api/analyze', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer mock_token',
      },
      body: JSON.stringify({
        documentText: SAMPLE_DOC,
        mode: 'fast',
      }),
    });

    const response = await handleAnalyzeRequest(request, env, { rpc: mockRpc, generate: mockGenerate });
    expect(response.status).toBe(200);
    const json = await response.json() as any;

    // Verify complete report assembly
    expect(json.documentTitle).toBe('Affidavit of Child Protection Worker');
    expect(json.evidenceStrengthIndex.score).toBe(60);
    expect(json.redFlags).toHaveLength(1);
    expect(json.redFlags[0].id).toBe('rf1');
    expect(json.chronology).toHaveLength(1);
    expect(json.whatToAskALawyer).toHaveLength(1);
    expect(json._metadata.analysisMode).toBe('fast');

    // Credit was finalized, never released!
    expect(finalizedCalls).toContain('free_finalize_scan');
    expect(releasedCalls).toHaveLength(0);
    // Direct call + 2 missing sections recovered
    expect(mockGenerate).toHaveBeenCalledTimes(3);
  });
});
