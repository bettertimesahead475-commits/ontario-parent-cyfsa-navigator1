/**
 * Deterministic grounding for Forensic Engine findings. Model output is untrusted input: this module coerces it,
 * re-locates every quotation in the source, and applies evidence rules that no model can override.
 *
 * Rules (each one is tested in grounding.test.ts):
 * 1. A finding needs at least one verified supporting quotation, except class B (not recorded), which needs a stated
 *    missing item instead. Otherwise it is UNSUPPORTED and goes to the appendix.
 * 2. A finding the adversarial reviewer REJECTED goes to the appendix. QUALIFIED takes the reviewer's revised wording.
 * 3. Class E (confirmed noncompliance) needs a verified supporting quotation AND an UPHELD review. Otherwise it is D.
 * 4. Class A (confirmed fact) needs a word-for-word quotation. A quotation found only after case or punctuation changes
 *    makes it C.
 * 5. Class B never asserts breach. Breach language in a B finding is flagged and its uncertainty set HIGH.
 * 6. A finding that depends on a page image is uncertain until the image confirms it; a contradicting image sends it
 *    to the appendix.
 * 7. Low OCR confidence on a supporting page raises uncertainty.
 * 8. Citations are classified by shared/citationVerification; nothing here marks a citation verified.
 * 9. Duplicates are merged into the strongest finding, which keeps every supporting reference.
 */

import { classifyCitation } from "../../../shared/citationVerification.js";
import {
  resolveEvidenceRef,
  type CaseDocument,
  type EvidenceClass,
  type EvidenceRef,
  type Finding,
  type LegalIssue,
  type ReviewVerdict,
} from "./caseModel.js";

const str = (v: unknown): string => (typeof v === "string" ? v.trim() : typeof v === "number" ? String(v) : "");
const arr = (v: unknown): any[] => (Array.isArray(v) ? v : []);
const strs = (v: unknown): string[] => arr(v).map(str).filter(Boolean);
const oneOf = <T extends string>(v: unknown, allowed: readonly T[], fallback: T): T =>
  (allowed as readonly string[]).includes(str(v).toUpperCase()) ? (str(v).toUpperCase() as T) : fallback;

const BREACH_LANGUAGE = /\b(?:violat\w*|breach\w*|contraven\w*|non-?complian\w*|failed to comply|unlawful\w*)\b/i;
const LOW_OCR_CONFIDENCE = 0.8;
const UNCERTAINTY_RANK = { LOW: 0, MEDIUM: 1, HIGH: 2 } as const;
const raise = (current: Finding["uncertainty"], to: Finding["uncertainty"]) =>
  UNCERTAINTY_RANK[to] > UNCERTAINTY_RANK[current] ? to : current;

function refs(docs: CaseDocument[], v: unknown): EvidenceRef[] {
  return arr(v)
    .map((r) => resolveEvidenceRef(docs, str(r?.documentId), str(r?.quote)))
    .filter((r) => r.quote.length > 0);
}

/** Coerces the investigator's findings into Finding records with deterministically located evidence. */
export function parseFindingCandidates(raw: unknown, docs: CaseDocument[]): Finding[] {
  return arr(raw).map((f, i): Finding => {
    const legalIssues: LegalIssue[] = arr(f?.legalIssues).map((l) => {
      const citation = str(l?.citation);
      const c = classifyCitation(citation);
      return {
        citation,
        nature: oneOf(l?.nature, ["LEGAL_RULE", "LEGAL_ARGUMENT", "QUESTION_FOR_COUNSEL"] as const, "QUESTION_FOR_COUNSEL"),
        explanation: str(l?.explanation),
        citationStatus: c.status,
        citationReason: c.reason,
      };
    });
    return {
      id: str(f?.id) || `F${i + 1}`,
      hypothesisId: str(f?.hypothesisId) || null,
      title: str(f?.title),
      statement: str(f?.statement),
      evidenceClass: oneOf(f?.evidenceClass, ["A", "B", "C", "D", "E"] as const, "C"),
      significance: oneOf(f?.significance, ["HIGH", "MEDIUM", "LOW"] as const, "MEDIUM"),
      supporting: refs(docs, f?.supporting),
      contradicting: refs(docs, f?.contradicting),
      alternativeExplanations: strs(f?.alternativeExplanations),
      missingInformation: strs(f?.missingInformation),
      legalIssues,
      dependsOnVisual: f?.dependsOnVisual === true,
      visualVerification: f?.dependsOnVisual === true ? "NOT_AVAILABLE" : "NOT_REQUIRED",
      visualNote: "",
      uncertainty: oneOf(f?.uncertainty, ["LOW", "MEDIUM", "HIGH"] as const, "MEDIUM"),
      review: { verdict: "NOT_REVIEWED", reasons: [], revisedStatement: null },
      grounding: { status: "MATERIAL", notes: [] },
    };
  });
}

/** Applies the adversarial reviewer's verdicts. A finding the reviewer did not address stays NOT_REVIEWED. */
export function applyReview(findings: Finding[], raw: unknown, docs: CaseDocument[]): Finding[] {
  const byId = new Map<string, any>(arr(raw).map((r) => [str(r?.findingId), r]));
  return findings.map((f) => {
    const r = byId.get(f.id);
    if (!r) return f;
    const verdict = oneOf<ReviewVerdict>(r.verdict, ["UPHELD", "QUALIFIED", "REJECTED"] as const, "NOT_REVIEWED");
    const counter = refs(docs, r.counterEvidence);
    return {
      ...f,
      contradicting: [...f.contradicting, ...counter],
      alternativeExplanations: [...f.alternativeExplanations, ...strs(r.alternativeExplanations)],
      review: { verdict, reasons: strs(r.reasons), revisedStatement: str(r.revisedStatement) || null },
    };
  });
}

/** Applies rules 1 to 8. Returns new objects; inputs are not mutated. */
export function groundFinding(input: Finding): Finding {
  const f: Finding = { ...input, grounding: { status: "MATERIAL", notes: [...input.grounding.notes] } };
  const note = (n: string) => f.grounding.notes.push(n);
  const verifiedSupport = f.supporting.filter((r) => r.verified);
  const located = f.supporting.filter((r) => r.matchStatus !== "ABSENT" && r.matchStatus !== "UNKNOWN_DOCUMENT" && r.matchStatus !== "AMBIGUOUS");
  const unlocated = f.supporting.length - located.length;
  if (unlocated > 0) note(`${unlocated} supporting quotation(s) could not be located uniquely in the source and carry no weight.`);

  // Rule 2
  if (f.review.verdict === "REJECTED") {
    f.grounding.status = "REJECTED_BY_REVIEW";
    note("The adversarial review rejected this finding.");
    return f;
  }
  if (f.review.verdict === "QUALIFIED") {
    if (f.review.revisedStatement) f.statement = f.review.revisedStatement;
    f.uncertainty = raise(f.uncertainty, "MEDIUM");
    note("Qualified by the adversarial review.");
  }

  // Rule 1
  if (f.evidenceClass === "B") {
    if (f.missingInformation.length === 0) {
      f.grounding.status = "UNSUPPORTED";
      note("A not-recorded finding must name what is missing.");
      return f;
    }
  } else if (located.length === 0) {
    f.grounding.status = "UNSUPPORTED";
    note("No supporting quotation was found in the source.");
    return f;
  }

  // Rule 3
  if (f.evidenceClass === "E" && (verifiedSupport.length === 0 || f.review.verdict !== "UPHELD")) {
    f.evidenceClass = "D";
    note("Downgraded from confirmed noncompliance (E) to potential legal issue (D): E needs a word-for-word source quotation and an upheld adversarial review.");
  }
  // Rule 4
  if (f.evidenceClass === "A" && verifiedSupport.length === 0) {
    f.evidenceClass = "C";
    note("Downgraded from confirmed fact (A) to inference (C): the quotation matches the source only after case or punctuation changes.");
  }
  // Rule 5
  if (f.evidenceClass === "B" && BREACH_LANGUAGE.test(f.statement)) {
    f.uncertainty = "HIGH";
    note("Information not recorded in the source is not proof that an obligation was breached.");
  }
  // Rule 6
  if (f.dependsOnVisual) {
    if (f.visualVerification === "CONTRADICTED") {
      f.grounding.status = "UNSUPPORTED";
      note("The page image contradicts this finding.");
      return f;
    }
    if (f.visualVerification !== "CONFIRMED") {
      f.uncertainty = "HIGH";
      note("Depends on a visual element (check box, handwriting, stamp) that has not been confirmed against the page image.");
    }
  }
  // Rule 7
  if (f.supporting.some((r) => r.ocrConfidence !== null && r.ocrConfidence < LOW_OCR_CONFIDENCE)) {
    f.uncertainty = raise(f.uncertainty, "MEDIUM");
    note("A supporting page has low OCR confidence; check the original page.");
  }
  // Rule 8: citation status already computed at parse time. Unverified citations are noted, never upgraded.
  if (f.legalIssues.some((l) => l.citation && l.citationStatus !== "INTERNAL_REFERENCE_MATCH")) {
    note("At least one citation is not on the bundled verified list; confirm with counsel.");
  }
  return f;
}

const tokens = (s: string) => new Set(s.toLowerCase().replace(/[^a-z0-9\s]/g, " ").split(/\s+/).filter((t) => t.length > 2));
function jaccard(a: string, b: string): number {
  const x = tokens(a);
  const y = tokens(b);
  if (x.size === 0 || y.size === 0) return 0;
  let inter = 0;
  for (const t of x) if (y.has(t)) inter++;
  return inter / (x.size + y.size - inter);
}
const spanKey = (r: EvidenceRef) => (r.verified && r.startOffset !== null ? `${r.documentId}:${r.startOffset}` : null);
const SIGNIFICANCE_RANK = { HIGH: 2, MEDIUM: 1, LOW: 0 } as const;

/** Rule 9. Two material findings are duplicates when they share a supporting span and say substantially the same thing. */
export function dedupeFindings(findings: Finding[]): Finding[] {
  const out = findings.map((f) => ({ ...f, supporting: [...f.supporting], grounding: { ...f.grounding, notes: [...f.grounding.notes] } }));
  for (let i = 0; i < out.length; i++) {
    const a = out[i];
    if (a.grounding.status !== "MATERIAL") continue;
    for (let j = i + 1; j < out.length; j++) {
      const b = out[j];
      if (b.grounding.status !== "MATERIAL") continue;
      const aSpans = new Set(a.supporting.map(spanKey).filter(Boolean));
      const shared = b.supporting.some((r) => {
        const k = spanKey(r);
        return k !== null && aSpans.has(k);
      });
      const similar = jaccard(`${a.title} ${a.statement}`, `${b.title} ${b.statement}`);
      if ((shared && similar >= 0.35) || similar >= 0.8) {
        const [keep, drop] = SIGNIFICANCE_RANK[b.significance] > SIGNIFICANCE_RANK[a.significance] ? [b, a] : [a, b];
        for (const r of drop.supporting) {
          if (!keep.supporting.some((k) => k.documentId === r.documentId && k.quote === r.quote)) keep.supporting.push(r);
        }
        drop.grounding.status = "DUPLICATE";
        drop.grounding.notes.push(`Merged into finding ${keep.id}.`);
        if (drop === a) break;
      }
    }
  }
  return out;
}

export function isMaterial(f: Finding): boolean {
  return f.grounding.status === "MATERIAL";
}

export type { EvidenceClass };
