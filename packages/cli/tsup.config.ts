import { defineConfig } from 'tsup';

export default defineConfig([
  {
    entry: { cli: 'src/cli.ts' },
    format: ['esm'],
    target: 'node20',
    outDir: 'dist',
    clean: true,
    // Bundle the core engine into the CLI so the published binary is self-contained.
    noExternal: ['ide-sync-core'],
    banner: { js: '#!/usr/bin/env node' },
  },
  {
    entry: { daemon: 'src/daemon/entry.ts' },
    format: ['esm'],
    target: 'node20',
    outDir: 'dist',
    clean: false,
    noExternal: ['ide-sync-core'],
  },
]);
