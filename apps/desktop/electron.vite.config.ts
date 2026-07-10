import { defineConfig, externalizeDepsPlugin } from 'electron-vite';
import react from '@vitejs/plugin-react';
import { builtinModules } from 'module';

// Main process: bundle ide-sync-core and its pure-JS deps into a single file.
// Only Node built-ins and 'electron' itself remain external — they are always
// available inside Electron without being shipped in the package.
const nodeExternals = [
  'electron',
  ...builtinModules,
  ...builtinModules.map((m) => `node:${m}`),
];

export default defineConfig({
  main: {
    build: {
      rollupOptions: {
        external: nodeExternals,
      },
    },
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
  },
  renderer: {
    root: 'src/renderer',
    build: {
      outDir: 'out/renderer',
    },
    plugins: [react()],
  },
});
