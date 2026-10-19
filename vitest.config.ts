import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.{ts,tsx}'],
    testTimeout: 30_000,

    coverage: {
      provider: 'istanbul',
      include: ['src/**/*.{ts,tsx}'],
      reporter: ['text', 'lcov'],
      reportsDirectory: 'coverage',

      /**
       * Just under today's coverage, so it cannot slip. Raise these as
       * tests are added; the libraries hold 100%.
       */
      thresholds: {
        statements: 80,
        branches: 69,
        functions: 82,
        lines: 82,
      },
    },
  },
});
