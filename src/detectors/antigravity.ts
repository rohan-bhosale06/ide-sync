import { idePaths } from '../utils/paths.js';
import { detect } from './base.js';
import type { IDEInventory } from './types.js';

export function detectAntigravity(): IDEInventory {
  // Confirmed on-disk: ~/.antigravity/extensions exists
  const { extensions, config } = idePaths('.antigravity', 'Antigravity\\User');
  return detect({
    family: 'antigravity',
    displayName: 'Antigravity',
    extensionsPath: extensions,
    configPath: config,
  });
}
