import { defineConfig } from 'vitest/config';

// Coverage gate S001-AC-14: >= 80% on src/sim and src/input (per-glob thresholds).
const AC14 = { lines: 80, functions: 80, branches: 80, statements: 80 };

export default defineConfig({
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
