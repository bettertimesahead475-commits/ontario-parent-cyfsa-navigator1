import { beforeEach } from 'vitest';
import { resetRateLimitsForTests } from '../../functions/api/_rate-limit';
import { resetJwksCacheForTests } from '../../functions/api/_auth-check';

// Each test starts with fresh per-isolate rate-limit counters, so unrelated tests that call the same
// endpoint many times as one synthetic user are not throttled by earlier tests. The limiter itself stays on.
// The Google signing-key cache is per isolate too; each test starts without cached keys.
beforeEach(() => {
  resetRateLimitsForTests();
  resetJwksCacheForTests();
});
