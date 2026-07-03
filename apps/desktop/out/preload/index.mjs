import { contextBridge, ipcRenderer } from "electron";
const ideSync = {
  setup: {
    exists: () => ipcRenderer.invoke("setup:exists"),
    test: (opts) => ipcRenderer.invoke("setup:test", opts),
    init: (opts) => ipcRenderer.invoke("setup:init", opts),
    detectIdes: () => ipcRenderer.invoke("setup:detectIdes"),
    pickFolder: () => ipcRenderer.invoke("setup:pickFolder"),
    hostname: () => ipcRenderer.invoke("setup:hostname"),
    installedExtensions: () => ipcRenderer.invoke("setup:installedExtensions")
  },
  sync: {
    status: (opts) => ipcRenderer.invoke("sync:status", opts),
    pull: (opts) => ipcRenderer.invoke("sync:pull", opts),
    push: (opts) => ipcRenderer.invoke("sync:push", opts),
    sync: (opts) => ipcRenderer.invoke("sync:sync", opts)
  },
  profiles: {
    list: () => ipcRenderer.invoke("profiles:list"),
    create: (name, ids) => ipcRenderer.invoke("profiles:create", name, ids),
    update: (name, ids) => ipcRenderer.invoke("profiles:update", name, ids),
    delete: (name) => ipcRenderer.invoke("profiles:delete", name)
  },
  search: {
    search: (query, family) => ipcRenderer.invoke("search:search", query, family),
    install: (ids, opts) => ipcRenderer.invoke("search:install", ids, opts),
    uninstall: (id, opts) => ipcRenderer.invoke("search:uninstall", id, opts)
  },
  config: {
    readConfig: () => ipcRenderer.invoke("config:readConfig"),
    writeConfig: (cfg) => ipcRenderer.invoke("config:writeConfig", cfg),
    readConfigSyncConfig: () => ipcRenderer.invoke("config:readConfigSyncConfig"),
    enableDomain: (domain, ide) => ipcRenderer.invoke("config:enableDomain", domain, ide),
    disableDomain: (domain, ide) => ipcRenderer.invoke("config:disableDomain", domain, ide),
    listBackups: () => ipcRenderer.invoke("config:listBackups"),
    restoreBackup: (backupId, ide, targetConfigPath) => ipcRenderer.invoke("config:restoreBackup", backupId, ide, targetConfigPath),
    diff: (family) => ipcRenderer.invoke("config:diff", family)
  },
  daemon: {
    status: () => ipcRenderer.invoke("daemon:status"),
    syncNow: () => ipcRenderer.invoke("daemon:syncNow"),
    pause: () => ipcRenderer.invoke("daemon:pause"),
    resume: () => ipcRenderer.invoke("daemon:resume"),
    start: () => ipcRenderer.invoke("daemon:start"),
    stop: () => ipcRenderer.invoke("daemon:stop")
  }
};
contextBridge.exposeInMainWorld("ideSync", ideSync);
