import { defineConfig } from 'tsup';

export default defineConfig([
  {
    entry: { cli: 'src/cli.ts' },
    format: ['esm'],
    target: 'node20',
    outDir: 'dist',
    clean: true,
    banner: { js: '#!/usr/bin/env node' },
  },
  {
    entry: { daemon: 'src/daemon/entry.ts' },
    format: ['esm'],
    target: 'node20',
    outDir: 'dist',
    clean: false,
  },
]);
