import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'happy-dom',
    include: ['test/unit/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      include: ['src/shared/**/*.ts', 'src/background/**/*.ts', 'src/content/**/*.ts'],
      // Entry points and browser glue are exercised by the e2e suite instead.
      exclude: [
        'src/content/index.ts',
        'src/background/service-worker.ts',
        'src/shared/types.ts',
        'src/background/chrome-tab-gateway.ts',
      ],
      thresholds: { lines: 80, functions: 80, statements: 80, branches: 70 },
    },
  },
});
