import { getSupabase } from './access.js';
import { findAccount } from './accounts.js';
import { LifecycleError, requireUuid } from './lifecycleErrors.js';
import { getSource, getSourceVersion, getProvision, verifyLegalContentIntegrity } from './legalSources.js';
import { normalizeProvisionText } from './legalCorpus.js';

export type CitationValidationStatus = 
  | 'VALIDATED' 
  | 'PARTIALLY_VALIDATED' 
  | 'REQUIRES_RESEARCH' 
  | 'UNVERIFIED' 
  | 'INVALID';

export type PinpointStatus = 
  | 'VERIFIED'
  | 'UNVERIFIED'
  | 'NOT_APPLICABLE'
  | 'INVALID';

export type QuoteStatus = 
  | 'VERIFIED'
  | 'ALTERED'
  | 'NOT_PRESENT'
  | 'NOT_CHECKED';

export interface ValidationLimitations {
  legalCorrectness: string;
  caseLawHandling?: string;
}

export interface CitationValidationResult {
  candidateId: string;
  matterId: string;
  legalSourceId: string;
  legalSourceVersionId: string | null;
  provisionId: string | null;
  authorityType: string;
  citationMetadata: Record<string, string | null>;
  sourceProvenance: string;
  effectiveDateContext: string | null;
  pinpointStatus: PinpointStatus;
  exactQuoteStatus: QuoteStatus;
  contentIntegrityStatus: string;
  authorityValidationStatus: CitationValidationStatus;
  validationFindings: string[];
  validatedAt: string;
  limitations: ValidationLimitations;
}

export interface CitationValidationInput {
  matterId: string;
  candidateId: string;
  callerPinpoint?: string | null;
  exactQuoteToVerify?: string | null;
  callerExpectedHash?: string | null;
}

export async function validateCandidateCitation(
  firebaseUid: string,
  input: CitationValidationInput
): Promise<CitationValidationResult> {
  if (!input || typeof input !== 'object') throw new LifecycleError(400, 'INVALID_INPUT', 'Input must be an object.');

  const account = await findAccount(firebaseUid);
  if (!account) throw new LifecycleError(401, 'UNAUTHORIZED', 'Account not found');

  const db = getSupabase();
  const matterId = requireUuid(input.matterId, 'matterId');
  const candidateId = requireUuid(input.candidateId, 'candidateId');

  // Matter authorization & isolation (Cross-matter safety)
  const { data: member, error: memberError } = await db
    .from('navigator_matter_members')
    .select('role')
    .eq('matter_id', matterId)
    .eq('account_id', account.id)
    .single();

  if (memberError || !member) {
    throw new LifecycleError(403, 'UNAUTHORIZED', 'Access denied to this matter.');
  }

  // Retrieve Candidate (bound by matterId)
  const { data: candidate, error: candidateError } = await db
    .from('navigator_matter_legal_research_candidates')
    .select('*')
    .eq('id', candidateId)
    .eq('matter_id', matterId)
    .single();

  if (candidateError || !candidate) {
    throw new LifecycleError(404, 'NOT_FOUND', 'Candidate not found or access denied in this matter.');
  }

  const findings: string[] = [];
  let authorityValidationStatus: CitationValidationStatus = 'VALIDATED';

  // 1. Source Existence
  let source;
  try {
    source = await getSource(candidate.legal_source_id);
  } catch (e: any) {
    throw new LifecycleError(404, 'NOT_FOUND', 'Authoritative legal source record not found');
  }
  if (source.verificationState !== 'VERIFIED') {
    findings.push('Legal source has not been verified against authoritative material.');
    authorityValidationStatus = 'UNVERIFIED';
  }

  // 2. Version Existence & Effective-Date Consistency
  let version = null;
  let effectiveContext = null;
  if (candidate.legal_source_version_id) {
    try {
      version = await getSourceVersion(candidate.legal_source_version_id);
    } catch (e: any) {
      throw new LifecycleError(404, 'NOT_FOUND', 'Authoritative legal source version not found');
    }
    
    if (version.legalSourceId !== source.id) {
      throw new LifecycleError(400, 'INVALID_INPUT', 'Version does not belong to the specified legal source.');
    }
    if (version.verificationState !== 'VERIFIED') {
      findings.push('Legal source version is not verified.');
      authorityValidationStatus = 'UNVERIFIED';
    }
    effectiveContext = `Effective: ${version.effectiveFrom} to ${version.effectiveTo || 'present'}`;
  } else {
    findings.push('No specific legal version bound to this candidate.');
    if (authorityValidationStatus === 'VALIDATED') authorityValidationStatus = 'PARTIALLY_VALIDATED';
  }

  // 3. Provision Existence
  let provision = null;
  let provVersionData = null;
  if (candidate.provision_id) {
    try {
      provision = await getProvision(candidate.provision_id);
    } catch (e: any) {
      throw new LifecycleError(404, 'NOT_FOUND', 'Authoritative legal provision not found');
    }
    
    if (provision.legalSourceId !== source.id) {
      throw new LifecycleError(400, 'INVALID_INPUT', 'Provision does not belong to the specified legal source.');
    }
    if (provision.verificationState !== 'VERIFIED') {
      findings.push('Legal provision is not verified.');
      authorityValidationStatus = 'UNVERIFIED';
    }

    if (version) {
      const { data: provVersion, error: provError } = await db
        .from('navigator_legal_provision_versions')
        .select('id, text_sha256, exact_text')
        .eq('provision_id', provision.id)
        .eq('legal_source_version_id', version.id)
        .maybeSingle();

      if (provError || !provVersion) {
        throw new LifecycleError(400, 'INVALID_INPUT', 'Provision is not linked to the specified legal source version.');
      }
      provVersionData = provVersion;
    }
  }

  // 4. Citation Metadata Validation
  const citationMetadata: Record<string, string | null> = {
    title: source.title,
    jurisdiction: source.jurisdiction,
    sourceType: source.sourceType,
    citation: source.citation,
    officialPublisher: source.officialPublisher,
    sourceUrl: source.sourceUrl
  };

  if (source.sourceType === 'CASE_LAW') {
    citationMetadata.court = source.court || null;
    citationMetadata.decisionDate = source.decisionDate || null;
    citationMetadata.docketNumber = source.docketNumber || null;
  }
  
  if (version) {
    citationMetadata.versionLabel = version.versionLabel;
  }
  if (provision) {
    citationMetadata.provisionCitation = provision.citation;
  }

  // 5. Pinpoint Validation
  let pinpointStatus: PinpointStatus = 'NOT_APPLICABLE';
  if (input.callerPinpoint) {
    // Stage 9A distinguishes verified metadata from caller-supplied pinpoint.
    // Caller pinpoint must NEVER silently become VERIFIED.
    pinpointStatus = 'UNVERIFIED';
    findings.push('Caller-supplied pinpoint is UNVERIFIED. Must be verified against authoritative text.');
    if (authorityValidationStatus === 'VALIDATED') authorityValidationStatus = 'REQUIRES_RESEARCH';
  }

  // 6. Quote Validation
  let exactQuoteStatus: QuoteStatus = 'NOT_CHECKED';
  if (input.exactQuoteToVerify) {
    if (!provVersionData || !provVersionData.exact_text) {
      exactQuoteStatus = 'NOT_PRESENT';
      findings.push('Authoritative text not available to verify quote.');
      authorityValidationStatus = 'UNVERIFIED';
    } else {
      const normalizedQuote = normalizeProvisionText(input.exactQuoteToVerify);
      const normalizedAuthoritative = normalizeProvisionText(provVersionData.exact_text);
      if (normalizedAuthoritative.includes(normalizedQuote)) {
        exactQuoteStatus = 'VERIFIED';
        findings.push('Exact quote verified against authoritative provision text.');
      } else {
        exactQuoteStatus = 'ALTERED';
        findings.push('Quote not found or altered in authoritative text.');
        authorityValidationStatus = 'INVALID';
      }
    }
  }

  // 7. Content Integrity Status
  let contentIntegrityStatus = 'UNVERIFIED';
  if (provVersionData?.exact_text && provVersionData.text_sha256) {
    try {
      verifyLegalContentIntegrity(provVersionData.exact_text, provVersionData.text_sha256);
      contentIntegrityStatus = 'VERIFIED';
    } catch {
      contentIntegrityStatus = 'FAILED';
      findings.push('Authoritative provision text does not match its stored hash.');
      authorityValidationStatus = 'INVALID';
    }
  } else {
    findings.push('Authoritative provision text or hash is unavailable.');
    if (authorityValidationStatus === 'VALIDATED') authorityValidationStatus = 'PARTIALLY_VALIDATED';
  }

  if (candidate.content_integrity_status === 'FAILED') {
    findings.push('Prior candidate content integrity check failed.');
    authorityValidationStatus = 'INVALID';
  }
  if (input.callerExpectedHash && input.callerExpectedHash !== provVersionData?.text_sha256) {
    findings.push('Caller expected hash does not match the authoritative stored hash.');
    authorityValidationStatus = 'INVALID';
  }

  // 8. Limitations & Provenance
  const limitations: ValidationLimitations = {
    legalCorrectness: "Validation confirms structural and textual integrity of the citation against the corpus. It DOES NOT determine that the legal argument is correct, that the authority controls the case, or that a violation occurred."
  };

  if (source.sourceType === 'CASE_LAW') {
    limitations.caseLawHandling = "Case authority metadata is validated, but holdings, ratios, and legal propositions are NOT automatically inferred or validated. If full case text is absent from the corpus, this is a limitation.";
  }

  return {
    candidateId: candidate.id,
    matterId: candidate.matter_id,
    legalSourceId: source.id,
    legalSourceVersionId: version ? version.id : null,
    provisionId: provision ? provision.id : null,
    authorityType: source.sourceType,
    citationMetadata,
    sourceProvenance: source.sourceUrl,
    effectiveDateContext: effectiveContext || candidate.effective_date_context,
    pinpointStatus,
    exactQuoteStatus,
    contentIntegrityStatus,
    authorityValidationStatus,
    validationFindings: findings,
    validatedAt: new Date().toISOString(),
    limitations
  };
}
