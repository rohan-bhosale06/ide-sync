/**
 * Read all enabled config domains for an IDE into a ConfigSnapshot.
 */
import type { IDEFamily } from '../detectors/types.js';
import type { ConfigSnapshot, ConfigDomain } from './types.js';
import { createDomainHandlers } from './domains/index.js';

export function readConfigSnapshot(
  ide: IDEFamily,
  configPath: string,
  domains: ConfigDomain[],
  uiStateWhitelistExtra: string[] = [],
): ConfigSnapshot {
  const handlers = createDomainHandlers(configPath, uiStateWhitelistExtra);

  return {
    ide,
    capturedAt: new Date().toISOString(),
    configPath,
    domains: {
      settings: domains.includes('settings') ? handlers.settings.read() : null,
      keybindings: domains.includes('keybindings') ? handlers.keybindings.read() : null,
      snippets: domains.includes('snippets') ? handlers.snippets.read() : {},
      tasks: domains.includes('tasks') ? handlers.tasks.read() : null,
      mcp: domains.includes('mcp') ? handlers.mcp.read() : null,
      uiState: domains.includes('ui-state') ? handlers.uiState.read() : null,
    },
  };
}

/** Collect raw snippet content (filename → raw text) from a snapshot. */
export function snapshotSnippetsRaw(snapshot: ConfigSnapshot): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [filename, entry] of Object.entries(snapshot.domains.snippets)) {
    result[filename] = entry.raw;
  }
  return result;
}
