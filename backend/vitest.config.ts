import { defineConfig } from 'vitest/config';

// Unit tests run on the TS sources directly (Vitest transpiles via esbuild, so
// no separate build step). We test pure logic only — no DB, network, or Redis —
// so no global setup is needed. `@shared` imports in the sources are type-only
// and are erased during transpile, so no path alias is required here.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});
