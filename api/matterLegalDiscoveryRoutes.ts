// Stage 9D-2b — authenticated, matter-authorized API surface over the frozen Stage 9D-2a
// discovery service (api/services/matterLegalDiscovery.ts) and the frozen Stage 9D-1
// persistence service (api/services/matterResearchRuns.ts).
//
// SCOPE: authentication/authorization/request-response wiring ONLY. No discovery, ranking or
// eligibility logic lives here -- every trust-sensitive value (authority verification state,
// canonical version identity, content-integrity status, ranking score/factors, candidate
// identity) is produced exclusively by the frozen services this file calls and is never
// accepted from the request body/query. This file does not implement professional review
// mutation (9D-3) or work-product integration (9D-4). No schema change.
//
// AUTHENTICATION: identity is resolved only from the verified Firebase bearer token, exactly as
// every other authenticated route in this repo (see lifecycleRoutes.ts). uid is never read from
// the request body or query string.
//
// AUTHORIZATION: every handler delegates matter-access verification to the underlying service
// function (runMatterLegalDiscovery / listMatterResearchRuns / listMatterResearchRunResults),
// which independently re-verifies navigator_matter_members on every call -- this route layer
// adds no separate, possibly-divergent authorization path. Route params are additionally
// UUID-validated (via the services' own requireUuid, surfaced as LifecycleError) before any
// query executes.
//
// IDOR DEFENSE: the results endpoint is compound-scoped by (matterId, runId) exactly as
// matterResearchRuns.ts's own listMatterResearchRunResults already enforces (both columns are in
// the WHERE clause), and this route additionally verifies the run itself belongs to the
// authorized matter (via listMatterResearchRuns, which is itself matter-scoped) before returning
// results, so a Matter-B run id supplied under Matter A's path fails closed with the same 404
// shape as a run that does not exist at all -- no existence signal is leaked either way.
// Candidate/authority/provision UUID knowledge alone grants nothing: no route here accepts those
// as a lookup key at all, only matterId + runId (and matterId + runId + implicit matter scoping
// for results), matching the compound-scoping pattern matterResearchRuns.ts already established.
//
// REQUEST VALIDATION / TRUST-INPUT DEFENSE: the start-discovery body is narrowly allowlisted to
// {triggerType, maxResults} only. Any other field in the request body (including
// verificationState, contentIntegrityStatus, approved, validated, sourceVersionId,
// provisionVersionId, rankingScore, rankingFactors, authority/candidate IDs, etc.) is silently
// ignored -- it is never read, never forwarded to the discovery service, and can never influence
// the resulting trust state, which the service derives exclusively from server-side Stage 9A/9B
// data (see matterLegalDiscovery.ts).
//
// RESPONSE SHAPING: only the frozen services' own mapped return shapes are serialized. Raw DB
// errors, stack traces and internal secrets never reach the response body (mirrors the
// `authenticated()` failure-handling convention in lifecycleRoutes.ts/evidenceReviewRoutes.ts).
//
// FAILED/PARTIAL RUNS: run status is always the live, server-derived value from
// navigator_matter_research_runs.status (PENDING/RUNNING/COMPLETED/FAILED) -- never hidden or
// remapped. The results endpoint always returns the run object (carrying its real status)
// alongside whatever results are persisted, so a FAILED run with partially-persisted results can
// never be mistaken for a COMPLETED one.

import type { Express, Request, Response } from 'express';
import { verifyFirebaseToken } from './services/firebaseAdmin.js';
import { LifecycleError, requireUuid } from './services/lifecycleErrors.js';
import { runMatterLegalDiscovery, type RunMatterLegalDiscoveryOptions } from './services/matterLegalDiscovery.js';
import { listMatterResearchRuns, listMatterResearchRunResults } from './services/matterResearchRuns.js';

type Identity = { uid: string; email: string | null };

const VALID_TRIGGER_TYPES = ['MANUAL', 'SCHEDULED', 'SYSTEM'] as const;

function authenticated(failureCode: string, failureMessage: string,
  action: (req: Request, res: Response, identity: Identity) => Promise<void>) {
  return async (req: Request, res: Response) => {
    res.set('Cache-Control', 'no-store');
    try {
      const identity = await verifyFirebaseToken(req.header('authorization'));
      if (!identity) {
        res.status(401).json({ code: 'SIGN_IN_REQUIRED', error: 'Authentication required.' });
        return;
      }
      await action(req, res, identity);
    } catch (error: unknown) {
      if (error instanceof LifecycleError) {
        res.status(error.statusCode).json({ code: error.code, error: error.message });
        return;
      }
      // Never serialize database errors, credentials, request bodies or bearer tokens.
      console.error(`[matterLegalDiscovery] ${failureCode}`);
      res.status(500).json({ code: failureCode, error: failureMessage });
    }
  };
}

// Narrow allowlist for the start-discovery body. Every other field the caller sends (trust-
// sensitive or not) is silently dropped here -- it never reaches runMatterLegalDiscovery.
function parseStartDiscoveryOptions(body: unknown): RunMatterLegalDiscoveryOptions {
  if (body === undefined || body === null) return {};
  if (typeof body !== 'object' || Array.isArray(body)) {
    throw new LifecycleError(400, 'INVALID_REQUEST', 'Request body must be an object.');
  }
  const raw = body as Record<string, unknown>;
  const options: RunMatterLegalDiscoveryOptions = {};

  if (raw.triggerType !== undefined) {
    if (typeof raw.triggerType !== 'string' || !VALID_TRIGGER_TYPES.includes(raw.triggerType as any)) {
      throw new LifecycleError(400, 'INVALID_REQUEST', 'triggerType must be one of MANUAL, SCHEDULED, SYSTEM.');
    }
    options.triggerType = raw.triggerType as RunMatterLegalDiscoveryOptions['triggerType'];
  }

  if (raw.maxResults !== undefined) {
    if (typeof raw.maxResults !== 'number' || !Number.isFinite(raw.maxResults) ||
        !Number.isInteger(raw.maxResults) || raw.maxResults <= 0 || raw.maxResults > 100) {
      throw new LifecycleError(400, 'INVALID_REQUEST', 'maxResults must be an integer between 1 and 100.');
    }
    options.maxResults = raw.maxResults;
  }

  return options;
}

// Mounted on the existing app, after its shared CORS, rate and payload middleware.
export function registerMatterLegalDiscoveryRoutes(app: Express): void {
  // 1. START DISCOVERY -- uid resolved only from the verified token; matter access re-verified
  // inside runMatterLegalDiscovery; no authority/ranking/trust field is ever accepted here.
  app.post('/api/matters/:matterId/legal-discovery/runs',
    authenticated('LEGAL_DISCOVERY_START_FAILED', 'Failed to start legal discovery.',
      async (req, res, identity) => {
        const matterId = requireUuid(req.params.matterId, 'matterId');
        const options = parseStartDiscoveryOptions(req.body);
        const outcome = await runMatterLegalDiscovery(identity.uid, matterId, options);
        res.status(201).json({
          run: outcome.run,
          resultCount: outcome.results.length,
          results: outcome.results
        });
      }));

  // 2. LIST RESEARCH RUNS for a matter the caller is authorized for -- real lifecycle status
  // (including FAILED) is always exposed, never hidden or remapped.
  app.get('/api/matters/:matterId/legal-discovery/runs',
    authenticated('LEGAL_DISCOVERY_LIST_RUNS_FAILED', 'Failed to list legal discovery runs.',
      async (req, res, identity) => {
        const matterId = requireUuid(req.params.matterId, 'matterId');
        const runs = await listMatterResearchRuns(identity.uid, matterId);
        res.json({ runs });
      }));

  // 3. RETRIEVE DISCOVERY RESULTS for an authorized matter/run. Compound-scoped: the run must
  // belong to THIS matter (re-verified below, on top of the matter-access check already inside
  // listMatterResearchRuns/listMatterResearchRunResults) before any result row is returned. A
  // Matter-B run id under Matter A's path, or a nonexistent run id, both yield the identical
  // 404 shape -- no existence signal is leaked. The run's real status (including FAILED) is
  // always returned alongside whatever results exist, so a partially-failed run can never be
  // mistaken for a completed one.
  app.get('/api/matters/:matterId/legal-discovery/runs/:runId/results',
    authenticated('LEGAL_DISCOVERY_RESULTS_FAILED', 'Failed to load legal discovery results.',
      async (req, res, identity) => {
        const matterId = requireUuid(req.params.matterId, 'matterId');
        const runId = requireUuid(req.params.runId, 'runId');

        // Re-derive the run set for THIS caller/matter server-side -- never trust the path
        // parameter alone as proof the run belongs to this matter.
        const runs = await listMatterResearchRuns(identity.uid, matterId);
        const run = runs.find((r) => r.id === runId);
        if (!run) {
          // Same shape whether the run does not exist at all, belongs to another matter, or the
          // caller lacks access -- avoids leaking existence information across matters.
          throw new LifecycleError(404, 'RESEARCH_RUN_NOT_FOUND', 'Research run not found in this matter.');
        }

        const results = await listMatterResearchRunResults(identity.uid, matterId, runId);
        res.json({ run, results });
      }));
}
