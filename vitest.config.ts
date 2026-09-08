import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globalSetup: ['./test/global-setup.ts'],
    include: ['test/**/*.test.ts', 'packages/**/test/**/*.test.ts'],
    // Every suite talks to a real PostgreSQL database (rule 11). Serial execution keeps
    // container load predictable and makes failures reproducible.
    fileParallelism: false,
    testTimeout: 60_000,
    hookTimeout: 180_000,
  },
});
