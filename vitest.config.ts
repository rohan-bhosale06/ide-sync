import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

// Consume packages/core as TypeScript source during tests (no build step needed).
const coreSrc = fileURLToPath(new URL('./packages/core/src/index.ts', import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      'ide-sync-core': coreSrc,
    },
  },
  test: {
    include: ['packages/*/tests/**/*.test.ts'],
  },
});
