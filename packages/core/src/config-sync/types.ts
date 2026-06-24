import type { IDEFamily } from '../detectors/types.js';

export type ConfigDomain = 'settings' | 'keybindings' | 'snippets' | 'tasks' | 'mcp' | 'ui-state';

export const ALL_CONFIG_DOMAINS: ConfigDomain[] = [
  'settings', 'keybindings', 'snippets', 'tasks', 'mcp', 'ui-state',
];

/** Canonical form stored in SyncState.configs — VS Code-family format. */
export interface StoredDomainEntry {
  raw: string;       // JSONC text
  updatedBy: string; // device id
  updatedAt: string; // ISO
}

export interface StoredUiStateEntry {
  whitelistedKeys: Record<string, unknown>;
  updatedBy: string;
  updatedAt: string;
}

export interface ConfigSyncState {
  settings: StoredDomainEntry | null;
  keybindings: StoredDomainEntry | null;
  snippets: Record<string, StoredDomainEntry>; // keyed by filename (no path)
  tasks: StoredDomainEntry | null;
  mcp: StoredDomainEntry | null;
  uiState: StoredUiStateEntry | null;
}

export function emptyConfigSyncState(): ConfigSyncState {
  return { settings: null, keybindings: null, snippets: {}, tasks: null, mcp: null, uiState: null };
}

// ─────────────────────────── snapshot ───────────────────────────────

export interface Keybinding {
  key: string;
  command: string;
  when?: string;
  args?: unknown;
}

export type SnippetFile = Record<string, {
  prefix: string | string[];
  body: string | string[];
  description?: string;
  scope?: string;
}>;

export interface DomainData {
  settings: { raw: string; parsed: Record<string, unknown> } | null;
  keybindings: { raw: string; parsed: Keybinding[] } | null;
  snippets: Record<string, { raw: string; parsed: SnippetFile }>;
  tasks: { raw: string; parsed: unknown } | null;
  mcp: { raw: string; parsed: Record<string, unknown> } | null;
  uiState: Record<string, unknown> | null;
}

export interface ConfigSnapshot {
  ide: IDEFamily;
  capturedAt: string;
  configPath: string;
  domains: DomainData;
}

// ─────────────────────────── translation ────────────────────────────

export type TranslationAction = 'map' | 'quarantine' | 'passthrough';

export interface TranslationRule {
  match: string | RegExp;
  action: TranslationAction;
  /** Only for action === 'map': rename to this key */
  targetKey?: string;
}

// ─────────────────────────── config-sync config ─────────────────────

export interface ConfigSyncConfig {
  /** Domains opted in globally. Default: [] (all disabled). */
  enabledDomains: ConfigDomain[];
  /** Per-IDE opt-outs. A domain listed here is skipped for that IDE even if globally enabled. */
  domainOptOuts: Partial<Record<IDEFamily, ConfigDomain[]>>;
  /** Debounce before auto-syncing config file changes. Longer than extensions default. */
  configDebounceMs: number;
  maxConfigDebounceMs: number;
  /** Key-renaming overrides: { "source.key": "target.key" } or null to quarantine. */
  translationOverrides: Record<string, string | null>;
  /** Extra keys to include in ui-state sync beyond the built-in whitelist. */
  uiStateWhitelistExtra: string[];
}

export const DEFAULT_CONFIG_SYNC_CONFIG: ConfigSyncConfig = {
  enabledDomains: [],
  domainOptOuts: {},
  configDebounceMs: 30_000,
  maxConfigDebounceMs: 120_000,
  translationOverrides: {},
  uiStateWhitelistExtra: [],
};

/** Keys always whitelisted for ui-state sync. */
export const UI_STATE_WHITELIST_BASE: string[] = [
  'workbench.activityBar.pinnedViewlets',
  'workbench.welcome.experimental.hidden',
  'workbench.colorTheme',
  'workbench.iconTheme',
  'workbench.productIconTheme',
];
