import { ipcMain, dialog, Tray, nativeImage, Menu, Notification, app, BrowserWindow, shell } from "electron";
import path from "path";
import { fileURLToPath } from "url";
import os from "os";
import { configExists, testBackendConnection, runInit, runDetectors, ALL_FAMILIES, runStatus, runPull, runPush, listProfiles, createProfile, updateProfile, deleteProfile, searchMarketplaces, runInstall, runUninstall, readConfig, writeConfig, readConfigSyncConfig, enableConfigDomain, disableConfigDomain, listBackups, restoreBackup, readLastSyncedState, createBackend, previewConfigChanges, isDaemonAlive, sendIpcCommand, spawnDaemon, stopDaemon } from "ide-sync-core";
import __cjs_mod__ from "node:module";
const __filename = import.meta.filename;
const __dirname = import.meta.dirname;
const require2 = __cjs_mod__.createRequire(import.meta.url);
function registerIpcHandlers() {
  ipcMain.handle("setup:exists", () => configExists());
  ipcMain.handle("setup:test", (_e, opts) => testBackendConnection(opts));
  ipcMain.handle("setup:init", (_e, opts) => runInit(opts));
  ipcMain.handle("setup:detectIdes", () => runDetectors(ALL_FAMILIES).map((inv) => inv.ide));
  ipcMain.handle("setup:hostname", () => os.hostname());
  ipcMain.handle("setup:installedExtensions", () => {
    const seen = /* @__PURE__ */ new Map();
    for (const inv of runDetectors(ALL_FAMILIES)) {
      for (const ext of inv.extensions) {
        if (!seen.has(ext.id)) {
          seen.set(ext.id, { id: ext.id, displayName: ext.displayName ?? ext.name, publisher: ext.publisher });
        }
      }
    }
    return Array.from(seen.values()).sort((a, b) => a.displayName.localeCompare(b.displayName));
  });
  ipcMain.handle("setup:pickFolder", async () => {
    const result = await dialog.showOpenDialog({ properties: ["openDirectory", "createDirectory"] });
    return result.canceled ? null : result.filePaths[0];
  });
  ipcMain.handle("sync:status", (_e, opts) => runStatus(opts));
  ipcMain.handle("sync:pull", (_e, opts) => runPull(opts));
  ipcMain.handle("sync:push", (_e, opts) => runPush(opts));
  ipcMain.handle("sync:sync", async (_e, opts) => {
    const pullResult = await runPull(opts);
    if (!pullResult.ok) return { pull: pullResult, push: null };
    const pushResult = await runPush(opts);
    return { pull: pullResult, push: pushResult };
  });
  ipcMain.handle("profiles:list", () => listProfiles());
  ipcMain.handle("profiles:create", (_e, name, ids) => createProfile(name, ids));
  ipcMain.handle("profiles:update", (_e, name, ids) => updateProfile(name, ids));
  ipcMain.handle("profiles:delete", (_e, name) => deleteProfile(name));
  ipcMain.handle("search:search", (_e, query, family) => searchMarketplaces(query, family));
  ipcMain.handle("search:install", (_e, ids, opts) => runInstall(ids, opts));
  ipcMain.handle("search:uninstall", (_e, id, opts) => runUninstall(id, opts));
  ipcMain.handle("config:readConfig", () => readConfig());
  ipcMain.handle("config:writeConfig", (_e, cfg) => writeConfig(cfg));
  ipcMain.handle("config:readConfigSyncConfig", () => readConfigSyncConfig());
  ipcMain.handle("config:enableDomain", (_e, domain, ide) => enableConfigDomain(domain, ide));
  ipcMain.handle("config:disableDomain", (_e, domain, ide) => disableConfigDomain(domain, ide));
  ipcMain.handle("config:listBackups", () => listBackups());
  ipcMain.handle(
    "config:restoreBackup",
    (_e, backupId, ide, targetConfigPath) => restoreBackup(backupId, ide, targetConfigPath)
  );
  ipcMain.handle("config:diff", async (_e, family) => {
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
  ipcMain.handle("daemon:status", async () => {
    if (!isDaemonAlive()) return { running: false };
    try {
      const resp = await sendIpcCommand({ cmd: "status" }, 5e3);
      return { running: true, ...resp };
    } catch {
      return { running: true, ok: false };
    }
  });
  ipcMain.handle("daemon:syncNow", () => sendIpcCommand({ cmd: "sync-now" }));
  ipcMain.handle("daemon:pause", () => sendIpcCommand({ cmd: "pause" }));
  ipcMain.handle("daemon:resume", () => sendIpcCommand({ cmd: "resume" }));
  ipcMain.handle("daemon:start", () => {
    if (isDaemonAlive()) return { ok: true };
    const currentDir = path.dirname(fileURLToPath(import.meta.url));
    const daemonScript = path.resolve(currentDir, "../../../../packages/cli/dist/daemon.js");
    spawnDaemon(daemonScript);
    return { ok: true };
  });
  ipcMain.handle("daemon:stop", () => ({ ok: stopDaemon() }));
}
function createDotIcon(color) {
  const size = 16;
  const buf = Buffer.alloc(size * size * 4);
  const colors = {
    gray: [150, 150, 150],
    green: [40, 170, 90],
    amber: [220, 160, 30],
    red: [210, 60, 50]
  };
  const [r, g, b] = colors[color];
  const cx = size / 2 - 0.5;
  const cy = size / 2 - 0.5;
  const radius = size / 2 - 1.5;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = x - cx;
      const dy = y - cy;
      const inside = dx * dx + dy * dy <= radius * radius;
      const i = (y * size + x) * 4;
      buf[i] = b;
      buf[i + 1] = g;
      buf[i + 2] = r;
      buf[i + 3] = inside ? 255 : 0;
    }
  }
  return nativeImage.createFromBuffer(buf, { width: size, height: size });
}
let tray = null;
let lastHadConflicts = false;
function createTray(getWindow, onQuit) {
  tray = new Tray(createDotIcon("gray"));
  tray.setToolTip("ide-sync");
  const rebuildMenu = async () => {
    if (!tray) return;
    const daemonRunning = isDaemonAlive();
    tray.setContextMenu(
      Menu.buildFromTemplate([
        { label: "Open ide-sync", click: () => getWindow()?.show() },
        { type: "separator" },
        { label: "Sync now", click: () => syncNow() },
        {
          label: daemonRunning ? "Pause background sync" : "Background sync is off",
          enabled: daemonRunning,
          click: () => sendIpcCommand({ cmd: "pause" }).catch(() => {
          })
        },
        { type: "separator" },
        { label: "Quit", click: onQuit }
      ])
    );
  };
  const syncNow = async () => {
    if (!configExists()) return;
    await runPull({});
    await runPush({});
    await refresh();
  };
  const refresh = async () => {
    if (!tray || !configExists()) {
      tray?.setImage(createDotIcon("gray"));
      return;
    }
    try {
      const status = await runStatus({});
      if (!status.remoteReachable) {
        tray.setImage(createDotIcon("red"));
        tray.setToolTip("ide-sync — can't reach sync store");
        return;
      }
      const hasConflicts = status.conflicts.length > 0 && status.conflictPolicy === "manual";
      if (hasConflicts) {
        tray.setImage(createDotIcon("red"));
        tray.setToolTip(`ide-sync — ${status.conflicts.length} conflict(s) need your decision`);
        if (!lastHadConflicts) {
          new Notification({
            title: "ide-sync",
            body: `${status.conflicts.length} conflict(s) need your decision`
          }).show();
        }
      } else if (status.toPush.length + status.toPull.length > 0) {
        tray.setImage(createDotIcon("amber"));
        tray.setToolTip("ide-sync — changes pending");
      } else {
        tray.setImage(createDotIcon("green"));
        tray.setToolTip("ide-sync — in sync");
      }
      lastHadConflicts = hasConflicts;
    } catch {
      tray.setImage(createDotIcon("red"));
      tray.setToolTip("ide-sync — can't reach sync store");
    }
    await rebuildMenu();
  };
  tray.on("click", () => getWindow()?.show());
  void rebuildMenu();
  void refresh();
  setInterval(refresh, 6e4);
  return tray;
}
const __dirname$1 = path.dirname(fileURLToPath(import.meta.url));
let mainWindow = null;
let isQuitting = false;
function createWindow() {
  const win = new BrowserWindow({
    width: 1100,
    height: 750,
    minWidth: 820,
    minHeight: 560,
    show: false,
    webPreferences: {
      preload: path.join(__dirname$1, "../preload/index.mjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });
  win.once("ready-to-show", () => win.show());
  win.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url);
    return { action: "deny" };
  });
  win.on("close", (e) => {
    if (!isQuitting) {
      e.preventDefault();
      win.hide();
    }
  });
  if (process.env.ELECTRON_RENDERER_URL) {
    win.loadURL(process.env.ELECTRON_RENDERER_URL);
  } else {
    win.loadFile(path.join(__dirname$1, "../renderer/index.html"));
  }
  return win;
}
app.whenReady().then(() => {
  registerIpcHandlers();
  mainWindow = createWindow();
  createTray(
    () => mainWindow,
    () => {
      isQuitting = true;
      app.quit();
    }
  );
  app.on("activate", () => {
    if (mainWindow) mainWindow.show();
    else mainWindow = createWindow();
  });
});
app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
app.on("before-quit", () => {
  isQuitting = true;
});
