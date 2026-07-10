/**
 * IPC handler registration — main-process side. Each handler calls straight
 * into ide-sync-core (in-process, one-shot) or the daemon's IPC socket
 * (background sync). No business logic lives here.
 */
import { ipcMain, dialog } from 'electron';
import fs from 'fs';
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
  ipcMain.handle('setup:ideStats', () =>
    runDetectors(ALL_FAMILIES).map((inv) => ({
      family: inv.ide.family,
      displayName: inv.ide.displayName,
      installed: inv.ide.installed,
      extensionCount: inv.extensions.length,
    })),
  );
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
  // Detailed dry-run preview for the confirm dialog: which extensions change
  // on which IDE (mirrors runPull's per-family targeting) plus what gets uploaded.
  ipcMain.handle('sync:preview', async (_e, opts: { ide?: string }) => {
    const families: IDEFamily[] = opts?.ide
      ? (opts.ide.split(',').map((s) => s.trim()) as IDEFamily[])
      : [...ALL_FAMILIES];
    const status = await runStatus({ ide: families.join(',') });
    if (!status.remoteReachable) {
      return { ok: false, error: status.error ?? 'Sync store unreachable' };
    }

    const inventories = runDetectors(families);
    const installedByFamily = new Map<IDEFamily, Map<string, string>>();
    const displayNames = new Map<IDEFamily, string>();
    for (const inv of inventories) {
      if (!inv.ide.installed) continue;
      displayNames.set(inv.ide.family, inv.ide.displayName);
      installedByFamily.set(inv.ide.family, new Map(inv.extensions.map((x) => [x.id.toLowerCase(), x.version])));
    }

    const perIde = Array.from(installedByFamily.keys()).map((family) => ({
      family,
      displayName: displayNames.get(family) ?? family,
      installs: [] as { id: string; version?: string }[],
      uninstalls: [] as { id: string }[],
    }));

    for (const action of status.toPull) {
      const candidates = action.families?.filter((f) => installedByFamily.has(f)) ?? Array.from(installedByFamily.keys());
      const extId = action.extensionId.toLowerCase();
      for (const family of candidates) {
        const inv = installedByFamily.get(family)!;
        const target = perIde.find((p) => p.family === family)!;
        if (action.type === 'uninstall-local') {
          if (inv.has(extId)) target.uninstalls.push({ id: action.extensionId });
        } else {
          const current = inv.get(extId);
          if (current === undefined || (action.desiredVersion !== undefined && current !== action.desiredVersion)) {
            target.installs.push({ id: action.extensionId, version: action.desiredVersion });
          }
        }
      }
    }

    const uploads = status.toPush.map((a) => ({
      id: a.extensionId,
      type: a.type === 'push-remove' ? ('remove' as const) : ('add' as const),
    }));

    return { ok: true, uploads, perIde, conflicts: status.conflicts.length };
  });
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
    const currentDir = path.dirname(fileURLToPath(import.meta.url));
    // Packaged app ships daemon.js next to out/ (resources/app/daemon.js);
    // dev falls back to the monorepo's CLI build output.
    const candidates = [
      path.resolve(currentDir, '../../daemon.js'),
      path.resolve(currentDir, '../../../../packages/cli/dist/daemon.js'),
    ];
    const daemonScript = candidates.find((p) => fs.existsSync(p));
    if (!daemonScript) {
      return { ok: false, error: 'Background sync engine not found in this installation.' };
    }
    // process.execPath is Electron here, not Node — ELECTRON_RUN_AS_NODE makes
    // the spawned child behave as a plain Node process running daemon.js.
    spawnDaemon(daemonScript, { ELECTRON_RUN_AS_NODE: '1' });
    return { ok: true };
  });
  ipcMain.handle('daemon:stop', () => ({ ok: stopDaemon() }));
}
