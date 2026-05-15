import { idePaths } from '../utils/paths.js';
import { detect } from './base.js';
import type { IDEInventory } from './types.js';

export function detectVSCodium(): IDEInventory {
  const { extensions, config } = idePaths('.vscode-oss', 'VSCodium\\User');
  return detect({
    family: 'vscodium',
    displayName: 'VSCodium',
    extensionsPath: extensions,
    configPath: config,
  });
}
