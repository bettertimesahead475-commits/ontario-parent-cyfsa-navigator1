// Stage 10 slice 6: HTTP adapter for the audited access lifecycle
// (api/services/professionalMatterAccess.ts; since slice 7 the recipient-bound contract v4:
// create_recipient_bound_matter_grant / accept_recipient_bound_matter_grant / revoke_matter_grant).
//
// MOUNTED since Stage 10 slice 8 (activation): api/_server.ts registers exactly these three POST
// routes, behind the per-IP /api limiter and a per-account write limiter
// (services/lifecycleWriteLimiter.ts). matterAccessLifecycleRoutes.mounted.test.ts pins the exact
// mounted surface. Every call still requires the v4 contract at runtime (the service refuses before
// any lifecycle RPC otherwise). See STAGE_10_CLOSEOUT.md.
//
// The adapter only authenticates, validates transport input and translates. Every authorization
// decision, state transition and audit event stays in the database functions; nothing here reads
// the access event log, so history can never act as authority.
//
//   POST /api/matters/:matterId/access-grants  owner creates an invitation for one recipient email
//                                              (path matter is authoritative); body { recipientEmail, expiresInDays? }
//   POST /api/access-invitations/accept        body { token }; the token is never accepted from the URL, and the
//                                              acceptor's email comes ONLY from the verified Firebase token
//                                              (Stage 10 slice 7, contract v4)
//   POST /api/access-grants/:grantId/revoke    grant-scoped: revoke_matter_grant does not take a matter id,
//                                              so no matter id is put in the path to imply a check that
//                                              the database does not make

import type { Express, NextFunction, Request, Response } from 'express';
import { verifyFirebaseIdentity } from './services/firebaseAdmin.js';
import { LifecycleError, requireUuid } from './services/lifecycleErrors.js';
import { acceptProfessionalGrant, createProfessionalGrant, revokeProfessionalGrant } from './services/professionalMatterAccess.js';
import { canonicalRecipientEmail } from './services/recipientEmail.js';
import { lifecycleWriteLimiter, type AccountWriteLimiter } from './services/lifecycleWriteLimiter.js';
import {
  LIFECYCLE_HTTP_ERRORS, mapLifecycleError,
  type LifecycleHttpError, type LifecycleOperation,
} from './services/matterAccessLifecycleHttpErrors.js';

export const LIFECYCLE_ROUTE_PATHS = Object.freeze({
  create: '/api/matters/:matterId/access-grants',
  accept: '/api/access-invitations/accept',
  revoke: '/api/access-grants/:grantId/revoke',
});

// The service issues 32 random bytes as base64url: exactly 43 characters.
const INVITATION_TOKEN = /^[A-Za-z0-9_-]{43}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

const invalid = (message: string) => new LifecycleError(400, 'INVALID_REQUEST', message);

function send(res: Response, failure: LifecycleHttpError): void {
  res.status(failure.status).json({ code: failure.code, error: failure.error });
}

function rejectQuery(req: Request): void {
  if (Object.keys(req.query ?? {}).length > 0) throw invalid('Query parameters are not accepted.');
}

/** Only the listed fields may appear; anything else (a matterId, uid, role, ...) is refused, never ignored. */
function bodyFields(req: Request, allowed: readonly string[]): Record<string, unknown> {
  const body: unknown = req.body;
  if (body === undefined || body === null) return {};
  if (typeof body !== 'object' || Array.isArray(body)) throw invalid('Request body must be a JSON object.');
  for (const key of Object.keys(body)) {
    if (!allowed.includes(key)) throw invalid('Unexpected field in request body.');
  }
  return body as Record<string, unknown>;
}

/** Everything here comes from a successfully verified Firebase ID token; nothing from the request. */
type VerifiedIdentity = { uid: string; email: string | null; emailVerified: boolean };

function lifecycleHandler(operation: LifecycleOperation, limiter: AccountWriteLimiter,
  action: (req: Request, res: Response, identity: VerifiedIdentity) => Promise<void>) {
  return async (req: Request, res: Response) => {
    res.set('Cache-Control', 'no-store');
    try {
      const identity = await verifyFirebaseIdentity(req.header('authorization'));
      if (!identity) {
        send(res, LIFECYCLE_HTTP_ERRORS.SIGN_IN_REQUIRED);
        return;
      }
      // Stage 10 slice 8: per-account write budget, spent only by an authenticated caller and keyed
      // only by the verified uid -- never an email, a token or an IP. Every attempt counts, valid or
      // not, so a caller cannot probe tokens for free. The per-IP /api limiter still runs first.
      const decision = limiter.consume(identity.uid);
      if (!decision.allowed) {
        res.set('Retry-After', String(decision.retryAfterSeconds));
        send(res, LIFECYCLE_HTTP_ERRORS.RATE_LIMITED);
        return;
      }
      await action(req, res, identity);
    } catch (error: unknown) {
      const failure = mapLifecycleError(operation, error);
      // Fixed log line only: never the error, the body, the token or the uid.
      if (failure.status >= 500) console.error(`[matterAccessLifecycle] ${operation.toUpperCase()}_FAILED`);
      send(res, failure);
    }
  };
}

// body-parser's own error types (express.json). Anything else, e.g. a CORS refusal, is not ours.
const BODY_PARSER_ERRORS = new Set([
  'entity.parse.failed', 'entity.too.large', 'entity.verify.failed', 'encoding.unsupported',
  'charset.unsupported', 'request.aborted', 'request.size.invalid', 'stream.encoding.set',
]);

// The shared JSON parser runs before routing. Its failures on these paths get the same fixed
// treatment the server already gives /api/account|clients|matters; every other error is passed on.
function lifecycleBodyParseErrors(error: any, _req: Request, res: Response, next: NextFunction): void {
  if (!error || !BODY_PARSER_ERRORS.has(error.type)) {
    next(error);
    return;
  }
  const status = [400, 413, 415].includes(error.status) ? error.status : 400;
  res.set('Cache-Control', 'no-store');
  res.status(status).json({ code: 'INVALID_REQUEST_BODY', error: 'Invalid request body.' });
}

export function registerMatterAccessLifecycleRoutes(app: Express,
  options: { writeLimiter?: AccountWriteLimiter } = {}): void {
  const limiter = options.writeLimiter ?? lifecycleWriteLimiter;
  app.post(LIFECYCLE_ROUTE_PATHS.create, lifecycleHandler('create', limiter, async (req, res, { uid }) => {
    const matterId = requireUuid(req.params.matterId, 'matterId').toLowerCase();
    rejectQuery(req);
    const body = bodyFields(req, ['recipientEmail', 'expiresInDays']);
    // The database canonicalizes again; this only refuses bad input early. The message never echoes it.
    const recipientEmail = canonicalRecipientEmail(body.recipientEmail);
    if (!recipientEmail) throw invalid('recipientEmail must be a valid email address.');
    let expiresInDays: number | undefined;
    if (body.expiresInDays !== undefined) {
      if (typeof body.expiresInDays !== 'number' || !Number.isInteger(body.expiresInDays)
        || body.expiresInDays < 1 || body.expiresInDays > 365) {
        throw invalid('expiresInDays must be an integer from 1 to 365.');
      }
      expiresInDays = body.expiresInDays;
    }
    const { grant, rawToken } = await createProfessionalGrant(uid, matterId,
      expiresInDays === undefined ? { recipientEmail } : { recipientEmail, expiresInDays });
    // Response identity guard: the path matter is the only matter this request may produce.
    if (String(grant.matterId).toLowerCase() !== matterId || grant.status !== 'PENDING'
      || typeof grant.id !== 'string' || !UUID.test(grant.id.toLowerCase()) || !INVITATION_TOKEN.test(rawToken)
      || grant.recipientEmail !== recipientEmail) {
      throw new Error('unexpected create result');
    }
    res.status(201).json({
      matterId,
      grant: {
        id: grant.id.toLowerCase(), status: grant.status, expiresAt: grant.expiresAt, createdAt: grant.createdAt,
        // The canonical form the invitation is bound to; the creating owner already knows the address.
        recipientEmail: grant.recipientEmail,
      },
      // Returned exactly once; only its digest is stored. How it reaches a professional is undecided.
      invitationToken: rawToken,
    });
  }));

  app.post(LIFECYCLE_ROUTE_PATHS.accept, lifecycleHandler('accept', limiter, async (req, res, { uid, email, emailVerified }) => {
    rejectQuery(req);
    const body = bodyFields(req, ['token']);
    if (typeof body.token !== 'string' || !INVITATION_TOKEN.test(body.token)) {
      throw invalid('token must be an invitation token.');
    }
    // Identity claims come only from the verified token; the body may carry nothing but { token }.
    const result = await acceptProfessionalGrant(uid, body.token, { email, emailVerified });
    const matterId = String(result?.matterId ?? '').toLowerCase();
    if (result?.success !== true || !UUID.test(matterId)) throw new Error('unexpected accept result');
    res.json({ matterId, role: 'REVIEWER' });
  }));

  app.post(LIFECYCLE_ROUTE_PATHS.revoke, lifecycleHandler('revoke', limiter, async (req, res, { uid }) => {
    const grantId = requireUuid(req.params.grantId, 'grantId').toLowerCase();
    rejectQuery(req);
    bodyFields(req, []);
    const result = await revokeProfessionalGrant(uid, grantId);
    if (result?.success !== true || typeof result.membershipRemoved !== 'boolean') throw new Error('unexpected revoke result');
    // "Removed by this request" only: a retry, or a reviewer still backed by another accepted
    // grant, reports false. Current access is answered by the access report, not by this response.
    res.json({ grantId, status: 'REVOKED', accessRemovedByThisRequest: result.membershipRemoved });
  }));

  app.use([LIFECYCLE_ROUTE_PATHS.create, LIFECYCLE_ROUTE_PATHS.accept, LIFECYCLE_ROUTE_PATHS.revoke], lifecycleBodyParseErrors);
}
