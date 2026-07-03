import { contextBridge, ipcRenderer } from 'electron';

const ideSync = {
  setup: {
    exists: () => ipcRenderer.invoke('setup:exists'),
    test: (opts: unknown) => ipcRenderer.invoke('setup:test', opts),
    init: (opts: unknown) => ipcRenderer.invoke('setup:init', opts),
    detectIdes: () => ipcRenderer.invoke('setup:detectIdes'),
    pickFolder: () => ipcRenderer.invoke('setup:pickFolder'),
    hostname: () => ipcRenderer.invoke('setup:hostname'),
    installedExtensions: () => ipcRenderer.invoke('setup:installedExtensions'),
  },
  sync: {
    status: (opts?: unknown) => ipcRenderer.invoke('sync:status', opts),
    pull: (opts?: unknown) => ipcRenderer.invoke('sync:pull', opts),
    push: (opts?: unknown) => ipcRenderer.invoke('sync:push', opts),
    sync: (opts?: unknown) => ipcRenderer.invoke('sync:sync', opts),
  },
  profiles: {
    list: () => ipcRenderer.invoke('profiles:list'),
    create: (name: string, ids: string[]) => ipcRenderer.invoke('profiles:create', name, ids),
    update: (name: string, ids: string[]) => ipcRenderer.invoke('profiles:update', name, ids),
    delete: (name: string) => ipcRenderer.invoke('profiles:delete', name),
  },
  search: {
    search: (query: string, family: string) => ipcRenderer.invoke('search:search', query, family),
    install: (ids: string[], opts: unknown) => ipcRenderer.invoke('search:install', ids, opts),
    uninstall: (id: string, opts: unknown) => ipcRenderer.invoke('search:uninstall', id, opts),
  },
  config: {
    readConfig: () => ipcRenderer.invoke('config:readConfig'),
    writeConfig: (cfg: unknown) => ipcRenderer.invoke('config:writeConfig', cfg),
    readConfigSyncConfig: () => ipcRenderer.invoke('config:readConfigSyncConfig'),
    enableDomain: (domain: string, ide?: string) => ipcRenderer.invoke('config:enableDomain', domain, ide),
    disableDomain: (domain: string, ide?: string) => ipcRenderer.invoke('config:disableDomain', domain, ide),
    listBackups: () => ipcRenderer.invoke('config:listBackups'),
    restoreBackup: (backupId: string, ide: string, targetConfigPath: string) =>
      ipcRenderer.invoke('config:restoreBackup', backupId, ide, targetConfigPath),
    diff: (family: string) => ipcRenderer.invoke('config:diff', family),
  },
  daemon: {
    status: () => ipcRenderer.invoke('daemon:status'),
    syncNow: () => ipcRenderer.invoke('daemon:syncNow'),
    pause: () => ipcRenderer.invoke('daemon:pause'),
    resume: () => ipcRenderer.invoke('daemon:resume'),
    start: () => ipcRenderer.invoke('daemon:start'),
    stop: () => ipcRenderer.invoke('daemon:stop'),
  },
};

contextBridge.exposeInMainWorld('ideSync', ideSync);

export type IdeSyncApi = typeof ideSync;
