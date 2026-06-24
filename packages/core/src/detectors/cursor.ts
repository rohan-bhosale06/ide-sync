import { idePaths } from '../utils/paths.js';
import { detect } from './base.js';
import type { IDEInventory } from './types.js';

export function detectCursor(): IDEInventory {
  const { extensions, config } = idePaths('.cursor', 'Cursor\\User');
  return detect({
    family: 'cursor',
    displayName: 'Cursor',
    extensionsPath: extensions,
    configPath: config,
  });
}
