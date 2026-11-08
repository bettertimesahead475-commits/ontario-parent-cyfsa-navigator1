import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['api/**/*.test.ts', 'src/**/*.test.tsx', 'tests/cloudflare-pages-api.test.ts'],
    testTimeout: 45000,
    hookTimeout: 45000,
    teardownTimeout: 45000,
    maxWorkers: 2,
  },
});
