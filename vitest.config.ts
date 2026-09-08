import { defineConfig } from 'vitest/config';

export default defineConfig({
  // The console is React, and its components are rendered to a string in tests so that
  // the interface rules in CLAUDE.md can be asserted rather than eyeballed.
  esbuild: { jsx: 'automatic' },
  test: {
    globalSetup: ['./test/global-setup.ts'],
    include: [
      'test/**/*.test.ts',
      'packages/**/test/**/*.test.ts',
      'apps/**/test/**/*.test.ts',
      'apps/**/test/**/*.test.tsx',
    ],
    // Every suite talks to a real PostgreSQL database (rule 11). Serial execution keeps
    // container load predictable and makes failures reproducible.
    fileParallelism: false,
    testTimeout: 60_000,
    hookTimeout: 180_000,
  },
});
