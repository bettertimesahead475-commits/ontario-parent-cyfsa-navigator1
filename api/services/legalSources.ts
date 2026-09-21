import { getSupabase } from './access.js';
import { LifecycleError, requireUuid } from './lifecycleErrors.js';
import { CaseDate, resolveApplicableVersion, LegalSource, LegalSourceVersion, LegalProvision } from './legalAuthority.js';
import { normalizeProvisionText, sha256Hex } from './legalCorpus.js';

export interface AuthorityCitation {
  legalSourceId: string;
  legalSourceVersionId?: string;
  provisionId?: string;
  unverifiedCallerPinpoint?: string;
  sourceUrl: string;
  effectiveDateContext?: string;
  retrievedAt: string;
  title: string;
  officialPublisher: string;
}

const notFound = (msg: string) => new LifecycleError(404, 'NOT_FOUND', msg);
const invalid = (msg: string) => new LifecycleError(400, 'INVALID_INPUT', msg);

export async function getSource(sourceId: string): Promise<LegalSource> {
  const db = getSupabase();
  const { data, error } = await db
    .from('navigator_legal_sources')
    .select('*')
    .eq('id', requireUuid(sourceId, 'sourceId'))
    .single();

  if (error || !data) throw notFound('Legal source not found.');
  return {
    id: data.id,
    jurisdiction: data.jurisdiction,
    title: data.title,
    sourceType: data.source_type,
    citation: data.citation,
    officialPublisher: data.official_publisher,
    sourceUrl: data.source_url,
    verificationState: data.verification_state,
    retrievedAt: data.retrieved_at,
    court: data.court,
    decisionDate: data.decision_date,
    docketNumber: data.docket_number
  } as LegalSource & { court?: string; decisionDate?: string; docketNumber?: string };
}

export async function getSourceVersion(versionId: string): Promise<LegalSourceVersion> {
  const db = getSupabase();
  const { data, error } = await db
    .from('navigator_legal_source_versions')
    .select('*')
    .eq('id', requireUuid(versionId, 'versionId'))
    .single();

  if (error || !data) throw notFound('Legal source version not found.');
  return {
    id: data.id,
    legalSourceId: data.legal_source_id,
    versionLabel: data.version_label,
    effectiveFrom: data.effective_from,
    effectiveTo: data.effective_to,
    status: data.status,
    verificationState: data.verification_state,
    retrievedAt: data.retrieved_at,
    supersedesVersionId: data.supersedes_version_id || null
  };
}

export async function getProvision(provisionId: string): Promise<LegalProvision> {
  const db = getSupabase();
  const { data, error } = await db
    .from('navigator_legal_provisions')
    .select('*')
    .eq('id', requireUuid(provisionId, 'provisionId'))
    .single();

  if (error || !data) throw notFound('Legal provision not found.');
  return {
    id: data.id,
    legalSourceId: data.legal_source_id,
    citation: data.citation,
    label: data.label,
    verificationState: data.verification_state
  };
}

export async function resolveVersionForDate(sourceId: string, caseDate: CaseDate) {
  const db = getSupabase();
  const { data, error } = await db
    .from('navigator_legal_source_versions')
    .select('*')
    .eq('legal_source_id', requireUuid(sourceId, 'sourceId'));

  if (error || !data || data.length === 0) throw notFound('No versions found for legal source.');

  const versions: LegalSourceVersion[] = data.map(v => ({
    id: v.id,
    legalSourceId: v.legal_source_id,
    versionLabel: v.version_label,
    effectiveFrom: v.effective_from,
    effectiveTo: v.effective_to,
    status: v.status,
    verificationState: v.verification_state,
    retrievedAt: v.retrieved_at,
    supersedesVersionId: v.supersedes_version_id || null
  }));

  return resolveApplicableVersion(versions, caseDate);
}

export function computeLegalContentHash(content: string): string {
  if (typeof content !== 'string' || !content.trim()) throw invalid('Content is required for hashing.');
  const normalized = normalizeProvisionText(content);
  return sha256Hex(normalized);
}

export function verifyLegalContentIntegrity(content: string, expectedHash: string): void {
  if (!expectedHash) throw invalid('Expected hash is required.');
  let actualHash: string;
  try {
    actualHash = computeLegalContentHash(content);
  } catch (e) {
    throw new LifecycleError(400, 'INTEGRITY_FAILURE', 'Content could not be hashed.');
  }
  if (actualHash !== expectedHash) {
    throw new LifecycleError(409, 'INTEGRITY_FAILURE', 'Content integrity verification failed: hash mismatch.');
  }
}

export async function getAuthorityCitation(
  sourceId: string,
  versionId?: string,
  provisionId?: string,
  pinpoint?: string
): Promise<AuthorityCitation> {
  const source = await getSource(sourceId);
  if (source.verificationState !== 'VERIFIED') {
    throw invalid('Legal source is not verified authoritative material.');
  }
  let retrievedAt = source.retrievedAt;
  let effectiveContext = undefined;

  if (versionId) {
    const version = await getSourceVersion(versionId);
    if (version.legalSourceId !== sourceId) {
      throw invalid('Version does not belong to the specified source.');
    }
    if (version.verificationState !== 'VERIFIED') {
      throw invalid('Legal source version is not verified.');
    }
    retrievedAt = version.retrievedAt;
    effectiveContext = `Effective: ${version.effectiveFrom} to ${version.effectiveTo || 'present'}`;
  }

  if (provisionId) {
    const provision = await getProvision(provisionId);
    if (provision.legalSourceId !== sourceId) {
      throw invalid('Provision does not belong to the specified source.');
    }
    if (provision.verificationState !== 'VERIFIED') {
      throw invalid('Legal provision is not verified.');
    }
  }

  if (versionId && provisionId) {
    const db = getSupabase();
    const { data, error } = await db
      .from('navigator_legal_provision_versions')
      .select('id')
      .eq('provision_id', requireUuid(provisionId, 'provisionId'))
      .eq('legal_source_version_id', requireUuid(versionId, 'versionId'))
      .maybeSingle();

    if (error || !data) {
      throw notFound('Requested provision does not exist in the requested source version.');
    }
  }

  let unverifiedCallerPinpoint = undefined;
  if (pinpoint) {
    if (typeof pinpoint !== 'string' || pinpoint.length > 200) {
      throw invalid('Invalid pinpoint format.');
    }
    unverifiedCallerPinpoint = pinpoint;
  }

  return {
    legalSourceId: source.id,
    legalSourceVersionId: versionId,
    provisionId: provisionId,
    unverifiedCallerPinpoint,
    sourceUrl: source.sourceUrl,
    effectiveDateContext: effectiveContext,
    retrievedAt,
    title: source.title,
    officialPublisher: source.officialPublisher
  };
}
