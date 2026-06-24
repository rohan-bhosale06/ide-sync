/**
 * Config-sync engine: push, pull, diff, and replicate for config domains.
 *
 * Canonical format = VS Code-family.
 *   Push from IDE X: translate(local, X, 'vscode') → store in SyncState.configs
 *   Pull to IDE X:   translate(canonical, 'vscode', X) → write to IDE X config files
 *
 * 3-way merge base = SyncState.configs as it was at last-synced time (from last-synced-state.json).
 */
import type { IDEFamily, IDEInstallation } from '../detectors/types.js';
import type { SyncState } from '../sync/types.js';
import type { ConflictPolicy } from '../sync/types.js';
import type {
  ConfigDomain, ConfigSyncState, ConfigSyncConfig,
  StoredDomainEntry, StoredUiStateEntry,
} from './types.js';
import { emptyConfigSyncState } from './types.js';
import { readConfigSnapshot, snapshotSnippetsRaw } from './reader.js';
import { applyConfigWritePlan, type ConfigWritePlan } from './writer.js';
import { mergeJsoncSettings, type ConfigKeyChange } from './merger/jsonc.js';
import { mergeKeybindings } from './merger/keybindings.js';
import { mergeSnippetDirectory } from './merger/snippets.js';
import { translateSettings } from './translator/index.js';
import { pruneBackups } from './backup.js';

// ─────────────────────────── types ────────────────────────────────

export interface DomainConflict {
  domain: ConfigDomain;
  conflictKeys: string[];
}

export interface ConfigPushResult {
  updatedConfigs: ConfigSyncState;
  updatedDomainOptOuts: Partial<Record<IDEFamily, ConfigDomain[]>>;
  changedDomains: ConfigDomain[];
  conflicts: DomainConflict[];
}

export interface ConfigPullResult {
  appliedDomains: ConfigDomain[];
  skippedDomains: ConfigDomain[];
  conflicts: DomainConflict[];
}

export interface ConfigDiffEntry {
  domain: ConfigDomain;
  addedKeys: string[];
  removedKeys: string[];
  modifiedKeys: string[];
}

// ─────────────────────────── helpers ──────────────────────────────

function isDomainEnabled(
  domain: ConfigDomain,
  ide: IDEFamily,
  cfg: ConfigSyncConfig,
): boolean {
  if (!cfg.enabledDomains.includes(domain)) return false;
  const optOuts = cfg.domainOptOuts[ide] ?? [];
  return !optOuts.includes(domain);
}

function stored(raw: string, deviceId: string, now: Date): StoredDomainEntry {
  return { raw, updatedBy: deviceId, updatedAt: now.toISOString() };
}

// ─────────────────────────── push ─────────────────────────────────

/**
 * Compute updated SyncState.configs by merging local IDE config files into
 * the remote canonical.  Called during `ide-sync push` / `ide-sync sync`.
 *
 * @param sourceIDE   The IDE whose config files we read (typically the first detected one).
 */
export async function configPush(opts: {
  sourceIDE: IDEInstallation;
  cfg: ConfigSyncConfig;
  baseState: SyncState | null;
  remoteState: SyncState | null;
  deviceId: string;
  policy: ConflictPolicy;
  now?: Date;
}): Promise<ConfigPushResult> {
  const { sourceIDE, cfg, baseState, remoteState, deviceId, policy } = opts;
  const now = opts.now ?? new Date();

  if (!sourceIDE.configPath) {
    return {
      updatedConfigs: remoteState?.configs ?? emptyConfigSyncState(),
      updatedDomainOptOuts: remoteState?.domainOptOuts ?? {},
      changedDomains: [],
      conflicts: [],
    };
  }

  const snapshot = readConfigSnapshot(
    sourceIDE.family,
    sourceIDE.configPath,
    cfg.enabledDomains,
    cfg.uiStateWhitelistExtra,
  );

  const baseConfigs: ConfigSyncState = baseState?.configs ?? emptyConfigSyncState();
  const remoteConfigs: ConfigSyncState = remoteState?.configs ?? emptyConfigSyncState();
  const newConfigs: ConfigSyncState = { ...remoteConfigs };
  const changedDomains: ConfigDomain[] = [];
  const conflicts: DomainConflict[] = [];

  // ── settings ──────────────────────────────────────────────────────
  if (isDomainEnabled('settings', sourceIDE.family, cfg) && snapshot.domains.settings) {
    const { translated } = await translateSettings(
      snapshot.domains.settings.parsed,
      sourceIDE.family,
      'vscode',
      cfg.translationOverrides,
    );
    const localCanonicalRaw = JSON.stringify(translated, null, 2);
    const result = mergeJsoncSettings(
      baseConfigs.settings?.raw ?? null,
      localCanonicalRaw,
      remoteConfigs.settings?.raw ?? null,
      policy,
    );
    if (result.newRemoteRaw !== (remoteConfigs.settings?.raw ?? '')) {
      newConfigs.settings = stored(result.newRemoteRaw, deviceId, now);
      changedDomains.push('settings');
    }
    if (result.conflictKeys.length > 0) {
      conflicts.push({ domain: 'settings', conflictKeys: result.conflictKeys });
    }
  }

  // ── keybindings ───────────────────────────────────────────────────
  if (isDomainEnabled('keybindings', sourceIDE.family, cfg) && snapshot.domains.keybindings) {
    const result = mergeKeybindings(
      baseConfigs.keybindings?.raw ?? null,
      snapshot.domains.keybindings.raw,
      remoteConfigs.keybindings?.raw ?? null,
      policy,
    );
    if (result.newRemoteRaw !== (remoteConfigs.keybindings?.raw ?? '')) {
      newConfigs.keybindings = stored(result.newRemoteRaw, deviceId, now);
      changedDomains.push('keybindings');
    }
    if (result.conflictKeys.length > 0) {
      conflicts.push({ domain: 'keybindings', conflictKeys: result.conflictKeys });
    }
  }

  // ── snippets ──────────────────────────────────────────────────────
  if (isDomainEnabled('snippets', sourceIDE.family, cfg)) {
    const localRaw = snapshotSnippetsRaw(snapshot);
    const baseRaw: Record<string, string> = {};
    for (const [k, v] of Object.entries(baseConfigs.snippets)) baseRaw[k] = v.raw;
    const remoteRaw: Record<string, string> = {};
    for (const [k, v] of Object.entries(remoteConfigs.snippets)) remoteRaw[k] = v.raw;

    const result = mergeSnippetDirectory(baseRaw, localRaw, remoteRaw, policy);
    const newSnippets: ConfigSyncState['snippets'] = {};
    for (const [filename, raw] of Object.entries(result.remoteSnippets)) {
      newSnippets[filename] = stored(raw, deviceId, now);
    }

    const remoteSnippetsChanged = JSON.stringify(newSnippets) !== JSON.stringify(remoteConfigs.snippets);
    if (remoteSnippetsChanged) {
      newConfigs.snippets = newSnippets;
      changedDomains.push('snippets');
    }
    if (result.conflictFiles.length > 0) {
      for (const cf of result.conflictFiles) {
        conflicts.push({ domain: 'snippets', conflictKeys: cf.conflictKeys.map((k) => `${cf.filename}:${k}`) });
      }
    }
  }

  // ── tasks ─────────────────────────────────────────────────────────
  if (isDomainEnabled('tasks', sourceIDE.family, cfg) && snapshot.domains.tasks) {
    const result = mergeJsoncSettings(
      baseConfigs.tasks?.raw ?? null,
      snapshot.domains.tasks.raw,
      remoteConfigs.tasks?.raw ?? null,
      policy,
    );
    if (result.newRemoteRaw !== (remoteConfigs.tasks?.raw ?? '')) {
      newConfigs.tasks = stored(result.newRemoteRaw, deviceId, now);
      changedDomains.push('tasks');
    }
    if (result.conflictKeys.length > 0) {
      conflicts.push({ domain: 'tasks', conflictKeys: result.conflictKeys });
    }
  }

  // ── mcp ───────────────────────────────────────────────────────────
  if (isDomainEnabled('mcp', sourceIDE.family, cfg) && snapshot.domains.mcp) {
    const result = mergeJsoncSettings(
      baseConfigs.mcp?.raw ?? null,
      snapshot.domains.mcp.raw,
      remoteConfigs.mcp?.raw ?? null,
      policy,
    );
    if (result.newRemoteRaw !== (remoteConfigs.mcp?.raw ?? '')) {
      newConfigs.mcp = stored(result.newRemoteRaw, deviceId, now);
      changedDomains.push('mcp');
    }
    if (result.conflictKeys.length > 0) {
      conflicts.push({ domain: 'mcp', conflictKeys: result.conflictKeys });
    }
  }

  // ── ui-state ──────────────────────────────────────────────────────
  if (isDomainEnabled('ui-state', sourceIDE.family, cfg) && snapshot.domains.uiState) {
    const remoteUi = remoteConfigs.uiState?.whitelistedKeys ?? {};
    const merged = { ...remoteUi, ...snapshot.domains.uiState }; // last-write-wins
    const newEntry: StoredUiStateEntry = {
      whitelistedKeys: merged,
      updatedBy: deviceId,
      updatedAt: now.toISOString(),
    };
    if (JSON.stringify(merged) !== JSON.stringify(remoteUi)) {
      newConfigs.uiState = newEntry;
      changedDomains.push('ui-state');
    }
  }

  pruneBackups();

  return {
    updatedConfigs: newConfigs,
    updatedDomainOptOuts: remoteState?.domainOptOuts ?? {},
    changedDomains,
    conflicts,
  };
}

// ─────────────────────────── pull ─────────────────────────────────

/**
 * Pull remote config changes into local IDE config files.
 * Called during `ide-sync pull` / `ide-sync sync`.
 *
 * @param targetIDEs  IDEs to write to.  Configs are translated per-IDE before writing.
 */
export async function configPull(opts: {
  targetIDEs: IDEInstallation[];
  cfg: ConfigSyncConfig;
  baseState: SyncState | null;
  remoteState: SyncState;
  policy: ConflictPolicy;
  dryRun?: boolean;
}): Promise<ConfigPullResult> {
  const { targetIDEs, cfg, baseState, remoteState, policy, dryRun } = opts;

  const remoteConfigs = remoteState.configs ?? emptyConfigSyncState();
  const baseConfigs = baseState?.configs ?? emptyConfigSyncState();

  const appliedDomains: ConfigDomain[] = [];
  const skippedDomains: ConfigDomain[] = [];
  const conflicts: DomainConflict[] = [];

  for (const ide of targetIDEs) {
    if (!ide.configPath || !ide.installed) continue;

    const writePlan: ConfigWritePlan = {};
    const localSnapshot = readConfigSnapshot(
      ide.family,
      ide.configPath,
      cfg.enabledDomains,
      cfg.uiStateWhitelistExtra,
    );

    // ── settings ────────────────────────────────────────────────────
    if (isDomainEnabled('settings', ide.family, cfg) && remoteConfigs.settings) {
      const { translated } = await translateSettings(
        JSON.parse(remoteConfigs.settings.raw) as Record<string, unknown>,
        'vscode',
        ide.family,
        cfg.translationOverrides,
      );
      const translatedRaw = JSON.stringify(translated, null, 2);

      const result = mergeJsoncSettings(
        baseConfigs.settings?.raw ?? null,
        localSnapshot.domains.settings?.raw ?? '{}',
        translatedRaw,
        policy,
      );
      writePlan.settings = result.newLocalText;
      if (!appliedDomains.includes('settings')) appliedDomains.push('settings');
      if (result.conflictKeys.length > 0) {
        conflicts.push({ domain: 'settings', conflictKeys: result.conflictKeys });
      }
    } else if (cfg.enabledDomains.includes('settings')) {
      skippedDomains.push('settings');
    }

    // ── keybindings ──────────────────────────────────────────────────
    if (isDomainEnabled('keybindings', ide.family, cfg) && remoteConfigs.keybindings) {
      const result = mergeKeybindings(
        baseConfigs.keybindings?.raw ?? null,
        localSnapshot.domains.keybindings?.raw ?? '[]',
        remoteConfigs.keybindings.raw,
        policy,
      );
      writePlan.keybindings = result.newLocalText;
      if (!appliedDomains.includes('keybindings')) appliedDomains.push('keybindings');
    } else if (cfg.enabledDomains.includes('keybindings')) {
      skippedDomains.push('keybindings');
    }

    // ── snippets ─────────────────────────────────────────────────────
    if (isDomainEnabled('snippets', ide.family, cfg)) {
      const localRaw = snapshotSnippetsRaw(localSnapshot);
      const baseRaw: Record<string, string> = {};
      for (const [k, v] of Object.entries(baseConfigs.snippets)) baseRaw[k] = v.raw;
      const remoteRaw: Record<string, string> = {};
      for (const [k, v] of Object.entries(remoteConfigs.snippets)) remoteRaw[k] = v.raw;

      const result = mergeSnippetDirectory(baseRaw, localRaw, remoteRaw, policy);
      writePlan.snippets = { writes: result.localWrites, deletes: result.localDeletes };
      if (!appliedDomains.includes('snippets')) appliedDomains.push('snippets');
      if (result.conflictFiles.length > 0) {
        for (const cf of result.conflictFiles) {
          conflicts.push({ domain: 'snippets', conflictKeys: cf.conflictKeys.map((k) => `${cf.filename}:${k}`) });
        }
      }
    } else if (cfg.enabledDomains.includes('snippets')) {
      skippedDomains.push('snippets');
    }

    // ── tasks ────────────────────────────────────────────────────────
    if (isDomainEnabled('tasks', ide.family, cfg) && remoteConfigs.tasks) {
      const result = mergeJsoncSettings(
        baseConfigs.tasks?.raw ?? null,
        localSnapshot.domains.tasks?.raw ?? '{}',
        remoteConfigs.tasks.raw,
        policy,
      );
      writePlan.tasks = result.newLocalText;
      if (!appliedDomains.includes('tasks')) appliedDomains.push('tasks');
    } else if (cfg.enabledDomains.includes('tasks')) {
      skippedDomains.push('tasks');
    }

    // ── mcp ──────────────────────────────────────────────────────────
    if (isDomainEnabled('mcp', ide.family, cfg) && remoteConfigs.mcp) {
      const result = mergeJsoncSettings(
        baseConfigs.mcp?.raw ?? null,
        localSnapshot.domains.mcp?.raw ?? '{}',
        remoteConfigs.mcp.raw,
        policy,
      );
      writePlan.mcp = result.newLocalText;
      if (!appliedDomains.includes('mcp')) appliedDomains.push('mcp');
    } else if (cfg.enabledDomains.includes('mcp')) {
      skippedDomains.push('mcp');
    }

    // ── ui-state ─────────────────────────────────────────────────────
    if (isDomainEnabled('ui-state', ide.family, cfg) && remoteConfigs.uiState) {
      writePlan.uiState = remoteConfigs.uiState.whitelistedKeys;
      if (!appliedDomains.includes('ui-state')) appliedDomains.push('ui-state');
    } else if (cfg.enabledDomains.includes('ui-state')) {
      skippedDomains.push('ui-state');
    }

    if (!dryRun) {
      applyConfigWritePlan(ide.family, ide.configPath, writePlan, cfg.uiStateWhitelistExtra);
    }
  }

  return { appliedDomains, skippedDomains, conflicts };
}

// ─────────────────────────── diff ─────────────────────────────────

/**
 * Compute what would change if we synced from sourceIDE to targetIDE locally
 * (without involving the remote backend). Used by `ide-sync config diff`.
 */
export async function configDiff(opts: {
  sourceIDE: IDEInstallation;
  targetIDE: IDEInstallation;
  cfg: ConfigSyncConfig;
}): Promise<ConfigDiffEntry[]> {
  const { sourceIDE, targetIDE, cfg } = opts;
  if (!sourceIDE.configPath || !targetIDE.configPath) return [];

  const sourceSnap = readConfigSnapshot(sourceIDE.family, sourceIDE.configPath, cfg.enabledDomains);
  const targetSnap = readConfigSnapshot(targetIDE.family, targetIDE.configPath, cfg.enabledDomains);
  const result: ConfigDiffEntry[] = [];

  if (sourceSnap.domains.settings && cfg.enabledDomains.includes('settings')) {
    const { translated } = await translateSettings(
      sourceSnap.domains.settings.parsed,
      sourceIDE.family,
      targetIDE.family,
      cfg.translationOverrides,
    );
    const targetSettings = targetSnap.domains.settings?.parsed ?? {};
    const diff = diffObjects(translated, targetSettings);
    if (diff.addedKeys.length + diff.removedKeys.length + diff.modifiedKeys.length > 0) {
      result.push({ domain: 'settings', ...diff });
    }
  }

  if (sourceSnap.domains.keybindings && cfg.enabledDomains.includes('keybindings')) {
    const srcCount = sourceSnap.domains.keybindings.parsed.length;
    const dstCount = targetSnap.domains.keybindings?.parsed.length ?? 0;
    if (srcCount !== dstCount) {
      result.push({ domain: 'keybindings', addedKeys: [], removedKeys: [], modifiedKeys: [`${Math.abs(srcCount - dstCount)} entries differ`] });
    }
  }

  return result;
}

function diffObjects(
  source: Record<string, unknown>,
  target: Record<string, unknown>,
): { addedKeys: string[]; removedKeys: string[]; modifiedKeys: string[] } {
  const allKeys = new Set([...Object.keys(source), ...Object.keys(target)]);
  const addedKeys: string[] = [];
  const removedKeys: string[] = [];
  const modifiedKeys: string[] = [];

  for (const key of allKeys) {
    const inSrc = key in source;
    const inDst = key in target;
    if (inSrc && !inDst) addedKeys.push(key);
    else if (!inSrc && inDst) removedKeys.push(key);
    else if (JSON.stringify(source[key]) !== JSON.stringify(target[key])) modifiedKeys.push(key);
  }

  return { addedKeys, removedKeys, modifiedKeys };
}

/**
 * Read-only preview of the value-level 3-way diff (base/local/remote) for one IDE,
 * without writing anything to disk. Reuses the same per-domain merger calls as
 * `configPull` — mergers are already side-effect-free; this just discards the
 * write step and surfaces the `changes`/`fileChanges` arrays for a diff-viewer UI.
 */
export async function previewConfigChanges(opts: {
  targetIDE: IDEInstallation;
  cfg: ConfigSyncConfig;
  baseState: SyncState | null;
  remoteState: SyncState | null;
  policy: ConflictPolicy;
}): Promise<Partial<Record<ConfigDomain, ConfigKeyChange[]>>> {
  const { targetIDE, cfg, baseState, remoteState, policy } = opts;
  const result: Partial<Record<ConfigDomain, ConfigKeyChange[]>> = {};
  if (!targetIDE.configPath || !targetIDE.installed) return result;

  const baseConfigs = baseState?.configs ?? emptyConfigSyncState();
  const remoteConfigs = remoteState?.configs ?? emptyConfigSyncState();
  const localSnapshot = readConfigSnapshot(
    targetIDE.family,
    targetIDE.configPath,
    cfg.enabledDomains,
    cfg.uiStateWhitelistExtra,
  );

  if (isDomainEnabled('settings', targetIDE.family, cfg)) {
    const merged = mergeJsoncSettings(
      baseConfigs.settings?.raw ?? null,
      localSnapshot.domains.settings?.raw ?? '{}',
      remoteConfigs.settings?.raw ?? null,
      policy,
    );
    result.settings = merged.changes;
  }

  if (isDomainEnabled('keybindings', targetIDE.family, cfg)) {
    const merged = mergeKeybindings(
      baseConfigs.keybindings?.raw ?? null,
      localSnapshot.domains.keybindings?.raw ?? '[]',
      remoteConfigs.keybindings?.raw ?? null,
      policy,
    );
    result.keybindings = merged.changes;
  }

  if (isDomainEnabled('snippets', targetIDE.family, cfg)) {
    const localRaw = snapshotSnippetsRaw(localSnapshot);
    const baseRaw: Record<string, string> = {};
    for (const [k, v] of Object.entries(baseConfigs.snippets)) baseRaw[k] = v.raw;
    const remoteRaw: Record<string, string> = {};
    for (const [k, v] of Object.entries(remoteConfigs.snippets)) remoteRaw[k] = v.raw;
    const merged = mergeSnippetDirectory(baseRaw, localRaw, remoteRaw, policy);
    result.snippets = merged.fileChanges.flatMap((fc) =>
      fc.keyChanges ?? [{ key: fc.filename, baseValue: null, localValue: null, remoteValue: null, status: fc.status }],
    );
  }

  if (isDomainEnabled('tasks', targetIDE.family, cfg)) {
    const merged = mergeJsoncSettings(
      baseConfigs.tasks?.raw ?? null,
      localSnapshot.domains.tasks?.raw ?? '{}',
      remoteConfigs.tasks?.raw ?? null,
      policy,
    );
    result.tasks = merged.changes;
  }

  if (isDomainEnabled('mcp', targetIDE.family, cfg)) {
    const merged = mergeJsoncSettings(
      baseConfigs.mcp?.raw ?? null,
      localSnapshot.domains.mcp?.raw ?? '{}',
      remoteConfigs.mcp?.raw ?? null,
      policy,
    );
    result.mcp = merged.changes;
  }

  return result;
}

// ─────────────────────────── replicate ────────────────────────────

/**
 * One-shot local replication: copy config files from sourceIDE to targetIDEs.
 * No remote backend involved; no base state. Used by `ide-sync config replicate`.
 */
export async function configReplicate(opts: {
  sourceIDE: IDEInstallation;
  targetIDEs: IDEInstallation[];
  domains: ConfigDomain[];
  cfg: ConfigSyncConfig;
  dryRun?: boolean;
}): Promise<{ appliedDomains: ConfigDomain[] }> {
  const { sourceIDE, targetIDEs, domains, cfg, dryRun } = opts;
  if (!sourceIDE.configPath) return { appliedDomains: [] };

  const sourceSnap = readConfigSnapshot(sourceIDE.family, sourceIDE.configPath, domains);
  const appliedDomains: ConfigDomain[] = [];

  for (const targetIDE of targetIDEs) {
    if (!targetIDE.configPath || !targetIDE.installed || targetIDE.family === sourceIDE.family) continue;

    const writePlan: ConfigWritePlan = {};

    if (domains.includes('settings') && sourceSnap.domains.settings) {
      const { translated } = await translateSettings(
        sourceSnap.domains.settings.parsed,
        sourceIDE.family,
        targetIDE.family,
        cfg.translationOverrides,
      );
      writePlan.settings = JSON.stringify(translated, null, 2);
      if (!appliedDomains.includes('settings')) appliedDomains.push('settings');
    }

    if (domains.includes('keybindings') && sourceSnap.domains.keybindings) {
      writePlan.keybindings = sourceSnap.domains.keybindings.raw;
      if (!appliedDomains.includes('keybindings')) appliedDomains.push('keybindings');
    }

    if (domains.includes('snippets')) {
      const writes: Record<string, string> = {};
      for (const [fn, entry] of Object.entries(sourceSnap.domains.snippets)) {
        writes[fn] = entry.raw;
      }
      writePlan.snippets = { writes, deletes: [] };
      if (!appliedDomains.includes('snippets')) appliedDomains.push('snippets');
    }

    if (domains.includes('tasks') && sourceSnap.domains.tasks) {
      writePlan.tasks = sourceSnap.domains.tasks.raw;
      if (!appliedDomains.includes('tasks')) appliedDomains.push('tasks');
    }

    if (domains.includes('mcp') && sourceSnap.domains.mcp) {
      writePlan.mcp = sourceSnap.domains.mcp.raw;
      if (!appliedDomains.includes('mcp')) appliedDomains.push('mcp');
    }

    if (!dryRun) {
      applyConfigWritePlan(targetIDE.family, targetIDE.configPath, writePlan, cfg.uiStateWhitelistExtra);
    }
  }

  return { appliedDomains };
}
