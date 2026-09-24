// Stage 10 slice 6: the ONE place where failures of the frozen lifecycle service
// (api/services/professionalMatterAccess.ts) become HTTP responses.
//
// The service throws plain Errors whose messages were written for server-side use. They are
// matched here by EXACT string, never by substring, and every unrecognized failure (database
// errors, contract mismatch, anything new) becomes a fixed "unavailable" response. No raw
// message, stack, SQL text, identifier or uid can pass through: every response body below is a
// constant. professionalMatterAccessLifecycleHttpErrors.test.ts fails if the service gains a
// message this table does not classify.
//
// Non-enumeration: for each operation, every refusal that could reveal whether a matter or a
// grant exists, or whether the caller's account exists, maps to ONE response.

import { LifecycleError } from './lifecycleErrors.js';

export type LifecycleOperation = 'create' | 'accept' | 'revoke';

export interface LifecycleHttpError {
  readonly status: number;
  readonly code: string;
  readonly error: string;
}

const e = (status: number, code: string, error: string): LifecycleHttpError => Object.freeze({ status, code, error });

export const LIFECYCLE_HTTP_ERRORS = Object.freeze({
  SIGN_IN_REQUIRED: e(401, 'SIGN_IN_REQUIRED', 'Authentication required.'),
  CREATE_FORBIDDEN: e(403, 'FORBIDDEN', 'You cannot invite a professional to this matter.'),
  CREATE_UNAVAILABLE: e(503, 'ACCESS_LIFECYCLE_UNAVAILABLE', 'Invitations are unavailable right now.'),
  INVITATION_UNAVAILABLE: e(410, 'INVITATION_UNAVAILABLE', 'This invitation cannot be used. Ask the matter owner for a new invitation.'),
  OWNER_CANNOT_ACCEPT: e(409, 'OWNER_CANNOT_ACCEPT', 'A matter owner cannot accept a professional invitation to their own matter.'),
  ACCEPT_FORBIDDEN: e(403, 'FORBIDDEN', 'Your account cannot accept invitations right now.'),
  ACCEPT_UNAVAILABLE: e(503, 'ACCESS_LIFECYCLE_UNAVAILABLE', 'Invitation acceptance is unavailable right now.'),
  GRANT_NOT_FOUND: e(404, 'ACCESS_GRANT_NOT_FOUND', 'Access grant not found.'),
  // Fail closed and say so: the caller must not assume access was removed.
  REVOKE_UNCONFIRMED: e(503, 'ACCESS_REVOCATION_UNCONFIRMED', 'Revocation could not be confirmed. Access may not have been removed.'),
});

/** Exact messages thrown by the frozen service, classified per operation. */
export const SERVICE_MESSAGE_CLASSIFICATION: Readonly<Record<LifecycleOperation, Readonly<Record<string, LifecycleHttpError>>>> = Object.freeze({
  create: Object.freeze({
    // A missing account, a non-owner, a non-member and a nonexistent matter are one refusal.
    'Account not found': LIFECYCLE_HTTP_ERRORS.CREATE_FORBIDDEN,
    'UNAUTHORIZED: Only OWNER can grant access.': LIFECYCLE_HTTP_ERRORS.CREATE_FORBIDDEN,
    'Failed to create grant.': LIFECYCLE_HTTP_ERRORS.CREATE_UNAVAILABLE,
  }),
  accept: Object.freeze({
    // Unknown, used, revoked and expired tokens are one answer: nothing about the owner's
    // actions or the grant's history is revealed to the token holder.
    'Invalid token.': LIFECYCLE_HTTP_ERRORS.INVITATION_UNAVAILABLE,
    'Invitation is no longer pending.': LIFECYCLE_HTTP_ERRORS.INVITATION_UNAVAILABLE,
    'Invitation has expired.': LIFECYCLE_HTTP_ERRORS.INVITATION_UNAVAILABLE,
    'A matter owner cannot accept a professional invitation to their own matter.': LIFECYCLE_HTTP_ERRORS.OWNER_CANNOT_ACCEPT,
    'Account is unavailable.': LIFECYCLE_HTTP_ERRORS.ACCEPT_FORBIDDEN,
    'Acceptance failed.': LIFECYCLE_HTTP_ERRORS.ACCEPT_UNAVAILABLE,
  }),
  revoke: Object.freeze({
    // A missing account, a non-owner and an unknown grant are one refusal.
    'Account not found': LIFECYCLE_HTTP_ERRORS.GRANT_NOT_FOUND,
    'Grant not found': LIFECYCLE_HTTP_ERRORS.GRANT_NOT_FOUND,
    'UNAUTHORIZED: Only OWNER can revoke access.': LIFECYCLE_HTTP_ERRORS.GRANT_NOT_FOUND,
    'Revocation failed. Access may not have been removed.': LIFECYCLE_HTTP_ERRORS.REVOKE_UNCONFIRMED,
  }),
});

const UNAVAILABLE: Readonly<Record<LifecycleOperation, LifecycleHttpError>> = Object.freeze({
  create: LIFECYCLE_HTTP_ERRORS.CREATE_UNAVAILABLE,
  accept: LIFECYCLE_HTTP_ERRORS.ACCEPT_UNAVAILABLE,
  revoke: LIFECYCLE_HTTP_ERRORS.REVOKE_UNCONFIRMED,
});

// accounts.findAccount throws this for a suspended/deleted account; it is a refusal like any other.
const ACCOUNT_REFUSAL: Readonly<Record<LifecycleOperation, LifecycleHttpError>> = Object.freeze({
  create: LIFECYCLE_HTTP_ERRORS.CREATE_FORBIDDEN,
  accept: LIFECYCLE_HTTP_ERRORS.ACCEPT_FORBIDDEN,
  revoke: LIFECYCLE_HTTP_ERRORS.GRANT_NOT_FOUND,
});

export function unavailableFor(operation: LifecycleOperation): LifecycleHttpError {
  return UNAVAILABLE[operation];
}

/**
 * Maps any thrown value to a fixed response. Only 400 INVALID_REQUEST errors raised by the adapter's
 * own input validation (or the service's requireUuid) keep their message: those are constant strings
 * describing the caller's own input.
 */
export function mapLifecycleError(operation: LifecycleOperation, error: unknown): LifecycleHttpError {
  if (error instanceof LifecycleError) {
    if (error.statusCode === 400 && error.code === 'INVALID_REQUEST') return e(400, 'INVALID_REQUEST', error.message);
    if (error.code === 'ACCOUNT_UNAVAILABLE') return ACCOUNT_REFUSAL[operation];
    return UNAVAILABLE[operation];
  }
  if (error instanceof Error && Object.prototype.hasOwnProperty.call(SERVICE_MESSAGE_CLASSIFICATION[operation], error.message)) {
    return SERVICE_MESSAGE_CLASSIFICATION[operation][error.message];
  }
  return UNAVAILABLE[operation];
}
