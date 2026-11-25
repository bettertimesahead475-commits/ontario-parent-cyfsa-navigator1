import { beforeEach } from 'vitest';
import { resetRateLimitsForTests } from '../../functions/api/_rate-limit';

// Each test starts with fresh per-isolate rate-limit counters, so unrelated tests that call the same
// endpoint many times as one synthetic user are not throttled by earlier tests. The limiter itself stays on.
beforeEach(() => resetRateLimitsForTests());
