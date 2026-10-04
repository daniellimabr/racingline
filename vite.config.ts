import { defineConfig } from 'vitest/config';

// Hard rule 6 (local-first): dev and preview servers bind to 127.0.0.1 only.
const LOCAL_ONLY = { host: '127.0.0.1', strictPort: true } as const;

// Coverage gate S001-AC-14: >= 80% on src/sim and src/input (per-glob thresholds).
const AC14 = { lines: 80, functions: 80, branches: 80, statements: 80 };

export default defineConfig({
  server: { ...LOCAL_ONLY, port: 5173 },
  preview: { ...LOCAL_ONLY, port: 4173 },
  test: {
    include: ['test/**/*.test.ts', 'src/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      include: ['src/sim/**/*.ts', 'src/input/**/*.ts'],
      exclude: ['**/*.test.ts', '**/*.d.ts'],
      thresholds: { 'src/sim/**/*.ts': AC14, 'src/input/**/*.ts': AC14 },
    },
  },
});
