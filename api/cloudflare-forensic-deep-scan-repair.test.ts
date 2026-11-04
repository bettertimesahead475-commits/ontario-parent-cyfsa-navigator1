import { describe, expect, it, vi, beforeEach } from 'vitest';
import { handleDeepScanRequest } from '../functions/api/deep-scan';
import { extractSessionId } from '../functions/api/analyze';
import type { AnalyzerEnv } from '../functions/api/analyze';
import type { GenerateFn } from './services/analyzerSections';
import {
  validateOverview,
  validateGuidance,
  validateThresholds,
  validateTimeline,
} from './services/analyzerSections';

const mockAuthVerification = vi.fn();
const mockSessionRead = vi.fn();

vi.mock('../functions/api/_auth-check', () => ({
  verifyFirebaseRequest: (req: Request, env: any) => mockAuthVerification(req, env),
  onRequestGet: vi.fn(),
}));

vi.mock('../functions/api/_supabase-paid-session', () => ({
  readVerifiedPaidSession: (env: any, uid: string, sessionId: string) => mockSessionRead(env, uid, sessionId),
}));

const SAMPLE_DOC = `
SUPERIOR COURT OF JUSTICE (FAMILY COURT)
CHILDREN'S AID SOCIETY OF TORONTO v. J. DOE
AFFIDAVIT OF INVESTIGATING WORKER
1. On October 12, 2026, the Society initiated an intake investigation under CYFSA s. 81.
2. The Society observed the home environment and spoke with collateral contacts.
3. On October 14, 2026, worker attended the family residence.
4. The Society previously stated in writing: "we did not inform the court of the kinship option within the statutory window."
`;

const COMPLETE_SECTIONS_JSON: Record<string, string> = {
  overview: JSON.stringify({
    documentTitle: "Child Protection Application",
    fileSummary: "This document is a formal Child Protection Application filed under the CYFSA seeking supervision orders. It alleges lack of supervision during a domestic dispute on October 12, 2026. The strongest documented support is the investigating officer's contemporaneous notes.",
    completenessScore: 85,
    evidenceStrengthIndex: {
      score: 65,
      components: {
        firsthandKnowledge: { score: 15, max: 20, explanation: "Worker observations" },
        sourceReliability: { score: 10, max: 15, explanation: "Named sources" },
        corroboration: { score: 10, max: 15, explanation: "Some corroborating notes" },
        documentarySupport: { score: 10, max: 15, explanation: "Police report attached" },
        internalConsistency: { score: 8, max: 10, explanation: "Internally consistent" },
        contradictoryEvidenceHandling: { score: 6, max: 10, explanation: "Acknowledges mother's statement" },
        legalAuthorityVerification: { score: 4, max: 10, explanation: "CYFSA s. 74 cited" },
        proceduralDocumentation: { score: 2, max: 5, explanation: "Service proof noted" },
      },
    },
  }),
  redFlags: JSON.stringify({
    redFlags: [
      {
        id: "rf1",
        severity: "Worth Raising With Counsel",
        category: "Hearsay",
        evidenceClassification: "HEARSAY",
        phraseDetected: "we did not inform the court of the kinship option",
        explanation: "The worker failed to notify family members regarding kinship placement.",
        verifyRequirement: "Request full kinship screening disclosure.",
        legalReference: "CYFSA s. 101",
        locationInDocument: "Page 2, Paragraph 4",
      },
    ],
  }),
  chronology: JSON.stringify({
    chronology: [
      {
        date: "October 12, 2026",
        event: "Society initiated an intake investigation under CYFSA s. 81.",
        locationInDocument: "Page 1, Paragraph 1",
        evidenceClassification: "DOCUMENTARY",
      },
    ],
    contradictions: [],
  }),
  guidance: JSON.stringify({
    whatToVerify: ["Verify worker attendance records from October 14."],
    whatToAskALawyer: ["Question: Can the kinship notification defect be raised at the temporary care hearing?"],
    whatIsMissing: ["Contemporaneous supervision logs from intake."],
    lawyerCaseBrief: ["ISSUE: Failure to explore kinship alternatives under CYFSA s. 101."],
  }),
  thresholds: JSON.stringify({
    thresholdAnalysis: [
      { thresholdChecked: "Physical Harm Risk", isMet: "Not Met", reasoning: "No physical harm." },
      { thresholdChecked: "Emotional Harm Risk", isMet: "Not Met", reasoning: "No emotional impairment." },
      { thresholdChecked: "Medical Neglect Risk", isMet: "Not Met", reasoning: "Attended to." },
      { thresholdChecked: "Abandonment Risk", isMet: "Not Met", reasoning: "Parent present." },
    ],
  }),
  timeline: JSON.stringify({
    proceduralTimelineViolations: [
      {
        timelineRule: "30-Day Adjournment Limit (CYFSA s. 94(1))",
        documentAssertion: "Adjourned within statutory parameters.",
        evaluation: "Compliant.",
      },
    ],
    charterAndHumanRightsIssues: [
      "Section 7 considerations.",
      "Section 15 considerations.",
      "CYFSA Section 2 Indigenous heritage considerations.",
    ],
  }),
};

function makeMockGenerateFn(): GenerateFn {
  return vi.fn(async (params: any) => {
    const stage = params?.stage || '';
    let text = COMPLETE_SECTIONS_JSON.overview;
    if (stage === 'section:redFlags') text = COMPLETE_SECTIONS_JSON.redFlags;
    else if (stage === 'section:chronology') text = COMPLETE_SECTIONS_JSON.chronology;
    else if (stage === 'section:guidance') text = COMPLETE_SECTIONS_JSON.guidance;
    else if (stage === 'section:thresholds') text = COMPLETE_SECTIONS_JSON.thresholds;
    else if (stage === 'section:timeline') text = COMPLETE_SECTIONS_JSON.timeline;
    else if (stage === 'forensic_verification') {
      text = JSON.stringify({
        findings: [{ id: 'rf1', verdict: 'SUPPORTED', recommendedSeverity: 'Worth Raising With Counsel', note: 'Supported.' }],
        thresholds: [],
        overallAssessment: 'Consistent evidence presentation.',
      });
    }

    return Promise.resolve({
      text,
      usage: { input_tokens: 500, output_tokens: 300 },
      model: 'claude-sonnet-5',
      durationMs: 50,
    });
  });
}

const mockEnv: AnalyzerEnv = {
  ANALYZER_ENABLED: 'true',
  FIREBASE_PROJECT_ID: 'test-firebase-proj',
  STAGING_SUPABASE_URL: 'https://test-supabase.supabase.co',
  STAGING_SUPABASE_READ_KEY: 'test-read-key',
  STAGING_SUPABASE_SERVICE_ROLE_KEY: 'test-service-key',
  ANTHROPIC_API_KEY: 'test-anthropic-key',
};

describe('Forensic Deep Scan Root Cause & Repair Verification', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('extractSessionId Unit Tests', () => {
    it('correctly extracts plain 36-character UUID', () => {
      const uuid = '12345678-1234-1234-1234-123456789abc';
      expect(extractSessionId(uuid)).toBe(uuid);
    });

    it('correctly extracts jti UUID from signed session token (payload.sig)', () => {
      const uuid = '98765432-4321-4321-4321-cba987654321';
      const payloadObj = { jti: uuid, exp: Date.now() + 86400000 };
      const base64Url = Buffer.from(JSON.stringify(payloadObj))
        .toString('base64')
        .replace(/\+/g, '-')
        .replace(/\//g, '_')
        .replace(/=+$/, '');
      const fakeToken = `${base64Url}.fake_signature_hash_bytes`;

      expect(extractSessionId(fakeToken)).toBe(uuid);
    });

    it('returns null on invalid or non-UUID inputs', () => {
      expect(extractSessionId(null)).toBeNull();
      expect(extractSessionId(undefined)).toBeNull();
      expect(extractSessionId('')).toBeNull();
      expect(extractSessionId('not-a-uuid')).toBeNull();
      expect(extractSessionId('abc.def')).toBeNull();
    });
  });

  describe('Header-Based Session Resolution & Base64 Guards', () => {
    it('accepts session token from X-PS-Session header without body.sessionId', async () => {
      const sessionId = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
      mockAuthVerification.mockResolvedValueOnce({
        status: 'verified',
        uid: 'user_header_auth',
        email: 'user@example.com',
        emailVerified: true,
      });

      mockSessionRead.mockResolvedValueOnce({
        status: 'verified',
        session: {
          sessionId,
          ownerUid: 'user_header_auth',
          tier: 'Premium',
          issuedAt: new Date().toISOString(),
          expiresAt: new Date(Date.now() + 86400000).toISOString(),
          revokedAt: null,
        },
      });

      const mockCreditRpc = vi.fn().mockImplementation((name: string) => {
        if (name === 'paid_reserve_credit') return Promise.resolve({ status: 'reserved', reservation_id: 'res_paid_123' });
        if (name === 'paid_finalize_credit') return Promise.resolve({ status: 'consumed' });
        return Promise.resolve({ status: 'ok' });
      });

      const request = new Request('https://staging.pages.dev/api/deep-scan', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer fake-firebase-token',
          'X-PS-Session': sessionId,
        },
        body: JSON.stringify({
          documentText: SAMPLE_DOC,
          stream: false,
        }),
      });

      const generate = makeMockGenerateFn();
      const response = await handleDeepScanRequest(request, mockEnv, {
        generate,
        rpc: mockCreditRpc,
      });

      expect(response.status).toBe(200);
      const json = await response.json();
      expect(json).toBeDefined();
      expect(mockSessionRead).toHaveBeenCalledWith(expect.anything(), 'user_header_auth', sessionId);
      expect(json.complianceMatrix).toBeDefined();
      expect(json.complianceMatrix.items.length).toBeGreaterThan(0);
    });

    it('rejects unextracted PDF binary base64 with DOCUMENT_UNEXTRACTED (400)', async () => {
      const request = new Request('https://staging.pages.dev/api/deep-scan', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer fake-firebase-token',
        },
        body: JSON.stringify({
          documentText: 'JVBERi0xLjQKJcTl8uXrp/Og0MTGCjQgMCBvYmoKPDw...',
        }),
      });

      const response = await handleDeepScanRequest(request, mockEnv, {});
      expect(response.status).toBe(400);
      const json = await response.json();
      expect(json.code).toBe('DOCUMENT_UNEXTRACTED');
    });
  });

  describe('Section Validation Resilience', () => {
    it('accepts string lawyerCaseBrief or alternate keys in validateGuidance', () => {
      const guidanceRaw = {
        whatToVerify: ['Verify worker notes.'],
        questionsForCounsel: ['Ask about timeline compliance.'],
        missingEvidence: ['Intake audio recording.'],
        caseBrief: 'ISSUE: CYFSA s. 101 kinship failure.\nIMPACT: Evidentiary weakness.',
      };

      const result = validateGuidance(guidanceRaw);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.lawyerCaseBrief.length).toBeGreaterThan(0);
        expect(result.value.whatToAskALawyer.length).toBeGreaterThan(0);
      }
    });

    it('accepts alternate keys in validateThresholds and always fills canonical thresholds', () => {
      const thresholdRaw = {
        thresholds: [
          { thresholdChecked: 'CYFSA s. 81 Jurisdiction', isMet: 'Yes', reasoning: 'Application filed properly.' },
        ],
      };

      const result = validateThresholds(thresholdRaw);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.thresholdAnalysis.length).toBeGreaterThanOrEqual(4);
      }
    });

    it('accepts alternate keys in validateTimeline and ensures canonical rules are populated', () => {
      const timelineRaw = {
        timeline: [
          { timelineRule: 'Adjournment deadline', evaluation: 'Timely.' },
        ],
      };

      const result = validateTimeline(timelineRaw);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.proceduralTimelineViolations.length).toBeGreaterThanOrEqual(4);
        expect(result.value.charterAndHumanRightsIssues.length).toBe(3);
      }
    });

    it('handles overview gracefully even if evidenceStrengthIndex.components is omitted', () => {
      const overviewRaw = {
        documentTitle: 'Custody Affidavit',
        fileSummary: 'This is a sufficiently long summary of the document that exceeds forty characters easily for the validator check.',
        completenessScore: 80,
        evidenceStrengthIndex: {
          firsthandKnowledge: { score: 10, max: 20, explanation: 'Direct evidence.' },
        },
      };

      const result = validateOverview(overviewRaw);
      expect(result.ok).toBe(true);
    });
  });
});
