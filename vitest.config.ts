import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['api/**/*.test.ts', 'src/**/*.test.ts', 'src/**/*.test.tsx', 'eval/**/*.test.ts', 'tests/cloudflare-pages-api.test.ts', 'tests/devin/**/*.test.ts'],
    testTimeout: 45000,
    hookTimeout: 45000,
    teardownTimeout: 45000,
    maxWorkers: 2,
    setupFiles: ['tests/setup/reset-rate-limits.ts', 'tests/setup/no-external-network.ts'],
    // Measure every application source file, including ones no test loads, so untested code counts as 0% instead of disappearing.
    coverage: {
      provider: 'v8',
      include: ['src/**/*.{ts,tsx}', 'shared/**/*.ts', 'functions/**/*.ts', 'api/**/*.ts', 'workers/**/*.ts'],
      exclude: ['**/*.test.{ts,tsx}', '**/*.d.ts', 'src/main.tsx', 'api/testSupport/**'],
      reporter: ['text-summary', 'lcov', 'json-summary'],
    },
  },
});
