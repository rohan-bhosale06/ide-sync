// ide-sync-core — public engine API.
// Consumed by packages/cli and apps/desktop. No CLI/stdio concerns live here.

// ── detection ──
export * from './detectors/index.js';
export * from './detectors/types.js';

// ── installers ──
export * from './installers/index.js';
export * from './installers/types.js';

// ── config (paths, main config, profiles, device identity) ──
export * from './config/config.js';
export * from './config/profiles.js';
export * from './config/device.js';

// ── sync engine ──
export * from './sync/engine.js';
export * from './sync/conflict.js';
export * from './sync/state.js';
export * from './sync/types.js';
export * from './sync/backends/index.js';

// ── config-sync (settings/keybindings/snippets/etc.) ──
export * from './config-sync/engine.js';
export * from './config-sync/backup.js';
export * from './config-sync/reader.js';
export * from './config-sync/types.js';

// ── marketplace ──
export * from './marketplace/resolver.js';
export * from './marketplace/types.js';

// ── reconcile (replicate planner/differ) ──
export * from './reconcile/planner.js';
export * from './reconcile/differ.js';

// ── manifest ──
export * from './manifest/builder.js';
export * from './manifest/writer.js';

// ── platform (OS service install: launchd/systemd/windows) ──
export * from './platform/service.js';
export * from './platform/launchd.js';
export * from './platform/systemd.js';
export * from './platform/windows.js';

// ── utils ──
export * from './utils/paths.js';
export * from './utils/fs.js';
export * from './utils/lock.js';
export * from './utils/cli-detect.js';
export * from './utils/cache.js';
