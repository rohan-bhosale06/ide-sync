/**
 * IPC handler registration — main-process side. Each handler calls straight
 * into ide-sync-core (in-process, one-shot) or the daemon's IPC socket
 * (background sync). No business logic lives here.
 */
import { ipcMain, dialog } from 'electron';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';
import {
  configExists,
  readConfig,
  writeConfig,
  readConfigSyncConfig,
  enableConfigDomain,
  disableConfigDomain,
  runDetectors,
  ALL_FAMILIES,
  testBackendConnection,
  runInit,
  runStatus,
  runPush,
  runPull,
  runInstall,
  runUninstall,
  listProfiles,
  createProfile,
  updateProfile,
  deleteProfile,
  searchMarketplaces,
  listBackups,
  restoreBackup,
  previewConfigChanges,
  createBackend,
  readLastSyncedState,
  sendIpcCommand,
  isDaemonAlive,
  spawnDaemon,
  stopDaemon,
} from 'ide-sync-core';
import type { TestConnectionOptions, RunInitOptions, PushOptions, PullOptions, ConfigDomain, IDEFamily } from 'ide-sync-core';

export function registerIpcHandlers(): void {
  // ── setup ──────────────────────────────────────────────────────────
  ipcMain.handle('setup:exists', () => configExists());
  ipcMain.handle('setup:test', (_e, opts: TestConnectionOptions) => testBackendConnection(opts));
  ipcMain.handle('setup:init', (_e, opts: RunInitOptions) => runInit(opts));
  ipcMain.handle('setup:detectIdes', () => runDetectors(ALL_FAMILIES).map((inv) => inv.ide));
  ipcMain.handle('setup:hostname', () => os.hostname());
  ipcMain.handle('setup:installedExtensions', () => {
    const seen = new Map<string, { id: string; displayName: string; publisher: string }>();
    for (const inv of runDetectors(ALL_FAMILIES)) {
      for (const ext of inv.extensions) {
        if (!seen.has(ext.id)) {
          seen.set(ext.id, { id: ext.id, displayName: ext.displayName ?? ext.name, publisher: ext.publisher });
        }
      }
    }
    return Array.from(seen.values()).sort((a, b) => a.displayName.localeCompare(b.displayName));
  });
  ipcMain.handle('setup:pickFolder', async () => {
    const result = await dialog.showOpenDialog({ properties: ['openDirectory', 'createDirectory'] });
    return result.canceled ? null : result.filePaths[0];
  });

  // ── sync ───────────────────────────────────────────────────────────
  ipcMain.handle('sync:status', (_e, opts) => runStatus(opts));
  ipcMain.handle('sync:pull', (_e, opts: PullOptions) => runPull(opts));
  ipcMain.handle('sync:push', (_e, opts: PushOptions) => runPush(opts));
  ipcMain.handle('sync:sync', async (_e, opts: PushOptions & PullOptions) => {
    const pullResult = await runPull(opts);
    if (!pullResult.ok) return { pull: pullResult, push: null };
    const pushResult = await runPush(opts);
    return { pull: pullResult, push: pushResult };
  });

  // ── profiles ───────────────────────────────────────────────────────
  ipcMain.handle('profiles:list', () => listProfiles());
  ipcMain.handle('profiles:create', (_e, name: string, ids: string[]) => createProfile(name, ids));
  ipcMain.handle('profiles:update', (_e, name: string, ids: string[]) => updateProfile(name, ids));
  ipcMain.handle('profiles:delete', (_e, name: string) => deleteProfile(name));

  // ── search / install ──────────────────────────────────────────────
  ipcMain.handle('search:search', (_e, query: string, family: IDEFamily) => searchMarketplaces(query, family));
  ipcMain.handle('search:install', (_e, ids: string[], opts) => runInstall(ids, opts));
  ipcMain.handle('search:uninstall', (_e, id: string, opts) => runUninstall(id, opts));

  // ── config ─────────────────────────────────────────────────────────
  ipcMain.handle('config:readConfig', () => readConfig());
  ipcMain.handle('config:writeConfig', (_e, cfg) => writeConfig(cfg));
  ipcMain.handle('config:readConfigSyncConfig', () => readConfigSyncConfig());
  ipcMain.handle('config:enableDomain', (_e, domain: ConfigDomain, ide?: IDEFamily) => enableConfigDomain(domain, ide));
  ipcMain.handle('config:disableDomain', (_e, domain: ConfigDomain, ide?: IDEFamily) => disableConfigDomain(domain, ide));
  ipcMain.handle('config:listBackups', () => listBackups());
  ipcMain.handle('config:restoreBackup', (_e, backupId: string, ide: IDEFamily, targetConfigPath: string) =>
    restoreBackup(backupId, ide, targetConfigPath),
  );
  ipcMain.handle('config:diff', async (_e, family: IDEFamily) => {
    const config = readConfig();
    const cfg = readConfigSyncConfig();
    const inventories = runDetectors([family]);
    const targetIDE = inventories.find((inv) => inv.ide.family === family)?.ide;
    if (!targetIDE) return {};
    const base = readLastSyncedState();
    const backend = createBackend(config);
    const remote = await backend.readState();
    return previewConfigChanges({ targetIDE, cfg, baseState: base, remoteState: remote, policy: config.conflictPolicy });
  });

  // ── daemon ─────────────────────────────────────────────────────────
  ipcMain.handle('daemon:status', async () => {
    if (!isDaemonAlive()) return { running: false };
    try {
      const resp = await sendIpcCommand({ cmd: 'status' }, 5000);
      return { running: true, ...resp };
    } catch {
      return { running: true, ok: false };
    }
  });
  ipcMain.handle('daemon:syncNow', () => sendIpcCommand({ cmd: 'sync-now' }));
  ipcMain.handle('daemon:pause', () => sendIpcCommand({ cmd: 'pause' }));
  ipcMain.handle('daemon:resume', () => sendIpcCommand({ cmd: 'resume' }));
  ipcMain.handle('daemon:start', () => {
    if (isDaemonAlive()) return { ok: true };
    // Dev-time monorepo layout: apps/desktop/out/main -> packages/cli/dist/daemon.js.
    // TODO: resolve via the packaged ide-sync-cli location once electron-builder packaging lands.
    const currentDir = path.dirname(fileURLToPath(import.meta.url));
    const daemonScript = path.resolve(currentDir, '../../../../packages/cli/dist/daemon.js');
    spawnDaemon(daemonScript);
    return { ok: true };
  });
  ipcMain.handle('daemon:stop', () => ({ ok: stopDaemon() }));
}
