// @vitest-environment jsdom
/** Sign-out ends the Google session, drops the active analyzer job pointer and keeps uid-namespaced data. */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const signOut = vi.hoisted(() => vi.fn(async () => {}));
vi.mock('firebase/auth', async (orig) => ({ ...(await orig<typeof import('firebase/auth')>()), signOut }));

import { ACTIVE_ANALYZER_JOB_KEY, auth, signOutOfAccount } from '../../src/utils/firebase';

beforeEach(() => { localStorage.clear(); signOut.mockClear(); });

describe('signOutOfAccount', () => {
  it('ends the Firebase session for this app', async () => {
    await signOutOfAccount();
    expect(signOut).toHaveBeenCalledWith(auth);
  });

  it('removes the active analyzer job pointer so the next account cannot recover it', async () => {
    localStorage.setItem(ACTIVE_ANALYZER_JOB_KEY, 'job_previous_account');
    await signOutOfAccount();
    expect(localStorage.getItem(ACTIVE_ANALYZER_JOB_KEY)).toBeNull();
  });

  it('keeps per-account data locked under its owner uid', async () => {
    localStorage.setItem('OPA_USER_PROFILE_synthetic-uid', '{"fullName":"QA Synthetic"}');
    await signOutOfAccount();
    expect(localStorage.getItem('OPA_USER_PROFILE_synthetic-uid')).toBe('{"fullName":"QA Synthetic"}');
  });

  it('notifies the header and assistants that the profile changed', async () => {
    const seen = vi.fn();
    window.addEventListener('opa-user-profile-updated', seen);
    await signOutOfAccount();
    window.removeEventListener('opa-user-profile-updated', seen);
    expect(seen).toHaveBeenCalledTimes(1);
  });

  it('still signs out when localStorage throws (private mode)', async () => {
    const spy = vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => { throw new Error('denied'); });
    await signOutOfAccount();
    spy.mockRestore();
    expect(signOut).toHaveBeenCalledTimes(1);
  });
});
