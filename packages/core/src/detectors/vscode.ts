import { idePaths } from '../utils/paths.js';
import { detect } from './base.js';
import type { IDEInventory } from './types.js';

export function detectVSCode(): IDEInventory {
  const { extensions, config } = idePaths('.vscode', 'Code\\User');
  return detect({
    family: 'vscode',
    displayName: 'VS Code',
    extensionsPath: extensions,
    configPath: config,
  });
}
