// Stage 10 slice 6: the lifecycle error mapper is total, constant and non-enumerating.
import { describe, expect, it } from 'vitest';
import fs from 'fs';
import path from 'path';
import { LifecycleError } from './lifecycleErrors';
import {
  LIFECYCLE_HTTP_ERRORS, SERVICE_MESSAGE_CLASSIFICATION, mapLifecycleError, unavailableFor,
  type LifecycleOperation,
} from './matterAccessLifecycleHttpErrors';

const OPS: LifecycleOperation[] = ['create', 'accept', 'revoke'];
const SERVICE_SOURCE = fs.readFileSync(path.join(__dirname, 'professionalMatterAccess.ts'), 'utf8');
const ALL_BODIES = new Set(Object.values(LIFECYCLE_HTTP_ERRORS).map(x => JSON.stringify(x)));

// Which operation each `throw new Error('...')` in the service belongs to.
function thrownMessagesByOperation(): Record<LifecycleOperation, string[]> {
  const fn = (name: string) => {
    const start = SERVICE_SOURCE.indexOf(`export async function ${name}(`);
    const next = SERVICE_SOURCE.indexOf('\nexport ', start + 1);
    const body = SERVICE_SOURCE.slice(start, next < 0 ? undefined : next);
    return [...body.matchAll(/throw new Error\((['"])(.*?)\1\)/g)].map(m => m[2]);
  };
  const contract = [...SERVICE_SOURCE.slice(0, SERVICE_SOURCE.indexOf('export type GrantStatus'))
    .matchAll(/throw new Error\((['"])(.*?)\1\)/g)].map(m => m[2]);
  return {
    create: [...fn('createProfessionalGrant'), ...contract],
    accept: [...fn('acceptProfessionalGrant'), ...contract],
    revoke: [...fn('revokeProfessionalGrant'), ...contract],
  };
}

describe('Stage 10 slice 6: lifecycle HTTP error mapper', () => {
  it('knows every message the frozen service can throw (fails on service drift)', () => {
    const thrown = thrownMessagesByOperation();
    for (const op of OPS) {
      expect(thrown[op].length).toBeGreaterThan(0);
      for (const message of thrown[op]) {
        const mapped = mapLifecycleError(op, new Error(message));
        const classified = Object.prototype.hasOwnProperty.call(SERVICE_MESSAGE_CLASSIFICATION[op], message);
        // Either explicitly classified, or deliberately "unavailable" (contract mismatch, internal validation).
        expect(classified || mapped === unavailableFor(op)).toBe(true);
      }
      // Nothing in the table is stale: every classified message really is thrown by that operation.
      for (const message of Object.keys(SERVICE_MESSAGE_CLASSIFICATION[op])) expect(thrown[op]).toContain(message);
    }
  });

  it('maps each classified service message to the documented response', () => {
    expect(mapLifecycleError('create', new Error('UNAUTHORIZED: Only OWNER can grant access.'))).toBe(LIFECYCLE_HTTP_ERRORS.CREATE_FORBIDDEN);
    expect(mapLifecycleError('create', new Error('Account not found'))).toBe(LIFECYCLE_HTTP_ERRORS.CREATE_FORBIDDEN);
    expect(mapLifecycleError('create', new Error('Failed to create grant.'))).toBe(LIFECYCLE_HTTP_ERRORS.CREATE_UNAVAILABLE);
    for (const m of ['Invalid token.', 'Invitation is no longer pending.', 'Invitation has expired.']) {
      expect(mapLifecycleError('accept', new Error(m))).toBe(LIFECYCLE_HTTP_ERRORS.INVITATION_UNAVAILABLE);
    }
    expect(mapLifecycleError('accept', new Error('A matter owner cannot accept a professional invitation to their own matter.')))
      .toBe(LIFECYCLE_HTTP_ERRORS.OWNER_CANNOT_ACCEPT);
    expect(mapLifecycleError('accept', new Error('Account is unavailable.'))).toBe(LIFECYCLE_HTTP_ERRORS.ACCEPT_FORBIDDEN);
    for (const m of ['Grant not found', 'UNAUTHORIZED: Only OWNER can revoke access.', 'Account not found']) {
      expect(mapLifecycleError('revoke', new Error(m))).toBe(LIFECYCLE_HTTP_ERRORS.GRANT_NOT_FOUND);
    }
    expect(mapLifecycleError('revoke', new Error('Revocation failed. Access may not have been removed.'))).toBe(LIFECYCLE_HTTP_ERRORS.REVOKE_UNCONFIRMED);
  });

  it('non-enumeration: every refusal of one operation is one body', () => {
    const refusals = {
      create: ['Account not found', 'UNAUTHORIZED: Only OWNER can grant access.'],
      accept: ['Invalid token.', 'Invitation is no longer pending.', 'Invitation has expired.'],
      revoke: ['Account not found', 'Grant not found', 'UNAUTHORIZED: Only OWNER can revoke access.'],
    } as const;
    for (const op of OPS) {
      const bodies = new Set(refusals[op].map(m => JSON.stringify(mapLifecycleError(op, new Error(m)))));
      bodies.add(JSON.stringify(mapLifecycleError(op, new LifecycleError(403, 'ACCOUNT_UNAVAILABLE', 'Account is unavailable.'))));
      if (op === 'accept') bodies.delete(JSON.stringify(LIFECYCLE_HTTP_ERRORS.ACCEPT_FORBIDDEN));
      expect(bodies.size).toBe(1);
    }
  });

  it.each([
    ['a database error', new Error('duplicate key value violates unique constraint "navigator_matter_access_grants_token_digest_key"')],
    ['a substring of a known message', new Error('prefix Invalid token. suffix')],
    ['the contract error', new Error('Professional access is unavailable: the required access lifecycle contract is not installed.')],
    ['a non-Error value', 'NOT_OWNER'],
    ['null', null],
    ['an unexpected LifecycleError', new LifecycleError(409, 'SOMETHING_ELSE', 'secret detail uid-123')],
    ['a LifecycleError 400 with another code', new LifecycleError(400, 'OTHER', 'secret detail')],
  ])('maps %s to the fixed unavailable response for every operation', (_label, err) => {
    for (const op of OPS) expect(mapLifecycleError(op, err)).toBe(unavailableFor(op));
  });

  it('every response is one of the constant bodies, except the caller\'s own 400 validation message', () => {
    for (const op of OPS) {
      for (const message of Object.keys(SERVICE_MESSAGE_CLASSIFICATION[op])) {
        expect(ALL_BODIES.has(JSON.stringify(mapLifecycleError(op, new Error(message))))).toBe(true);
      }
    }
    expect(mapLifecycleError('revoke', new LifecycleError(400, 'INVALID_REQUEST', 'grantId must be a UUID.')))
      .toEqual({ status: 400, code: 'INVALID_REQUEST', error: 'grantId must be a UUID.' });
  });

  it('response bodies never contain database, uid, token or internal-code vocabulary', () => {
    const text = JSON.stringify(LIFECYCLE_HTTP_ERRORS);
    expect(text).not.toMatch(/NOT_OWNER|INVALID_TOKEN|INVALID_STATE|EXPIRED_TOKEN|GRANT_NOT_FOUND:|digest|sql|relation|uid|firebase|supabase|service_role|contract/i);
  });

  it('the table is immutable', () => {
    expect(Object.isFrozen(LIFECYCLE_HTTP_ERRORS)).toBe(true);
    expect(Object.isFrozen(LIFECYCLE_HTTP_ERRORS.GRANT_NOT_FOUND)).toBe(true);
    for (const op of OPS) expect(Object.isFrozen(SERVICE_MESSAGE_CLASSIFICATION[op])).toBe(true);
  });
});
