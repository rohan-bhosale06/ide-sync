/**
 * Domain registry — create handlers for all domains of a given IDE config path.
 */
import type { IDEFamily } from '../../detectors/types.js';
import type { IDEInstallation } from '../../detectors/types.js';
import { SettingsDomainHandler } from './settings.js';
import { KeybindingsDomainHandler } from './keybindings.js';
import { SnippetsDomainHandler } from './snippets.js';
import { TasksDomainHandler } from './tasks.js';
import { McpDomainHandler } from './mcp.js';
import { UiStateDomainHandler } from './ui-state.js';

export {
  SettingsDomainHandler,
  KeybindingsDomainHandler,
  SnippetsDomainHandler,
  TasksDomainHandler,
  McpDomainHandler,
  UiStateDomainHandler,
};

export interface DomainHandlers {
  settings: SettingsDomainHandler;
  keybindings: KeybindingsDomainHandler;
  snippets: SnippetsDomainHandler;
  tasks: TasksDomainHandler;
  mcp: McpDomainHandler;
  uiState: UiStateDomainHandler;
}

export function createDomainHandlers(
  configPath: string,
  uiStateWhitelistExtra: string[] = [],
): DomainHandlers {
  return {
    settings: new SettingsDomainHandler(configPath),
    keybindings: new KeybindingsDomainHandler(configPath),
    snippets: new SnippetsDomainHandler(configPath),
    tasks: new TasksDomainHandler(configPath),
    mcp: new McpDomainHandler(configPath),
    uiState: new UiStateDomainHandler(configPath, uiStateWhitelistExtra),
  };
}

/** Get config path for an IDE, with per-IDE fallback logic. */
export function getConfigPath(ide: IDEInstallation): string | null {
  return ide.configPath;
}
