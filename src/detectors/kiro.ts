import { idePaths } from '../utils/paths.js';
import { detect } from './base.js';
import type { IDEInventory } from './types.js';

export function detectKiro(): IDEInventory {
  const { extensions, config } = idePaths('.kiro', 'Kiro\\User');
  return detect({
    family: 'kiro',
    displayName: 'Kiro',
    extensionsPath: extensions,
    configPath: config,
  });
}
