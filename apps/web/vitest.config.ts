import path from 'node:path';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [react()],
  resolve: { alias: { '@': path.resolve(import.meta.dirname, 'src') } },
  test: {
    environment: 'jsdom',
    include: ['src/**/*.test.{ts,tsx}'],
    setupFiles: ['./src/test-setup.ts'],
    coverage: {
      provider: 'v8',
      include: ['src/**/*.{ts,tsx}'],
      // shadcn/ui primitives are vendored third-party code; main.tsx/router are covered by E2E.
      exclude: ['src/**/*.test.{ts,tsx}', 'src/test-setup.ts', 'src/components/ui/**', 'src/main.tsx'],
      reporter: ['text-summary', 'json-summary', 'html', 'lcov'],
      // Unit baseline only: UI flows are verified by Playwright E2E, which is not instrumented.
      thresholds: { lines: 7, statements: 7, functions: 4, branches: 5 },
    },
  },
});
