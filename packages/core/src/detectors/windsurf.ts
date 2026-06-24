import path from 'path';
import os from 'os';
import { resolveAppData } from '../utils/paths.js';
import { detect } from './base.js';
import type { IDEInventory } from './types.js';

function windsurfExtensionsPath(): string {
  // Windsurf stores extensions under ~/.codeium/windsurf/extensions on all platforms
  return path.join(os.homedir(), '.codeium', 'windsurf', 'extensions');
}

export function detectWindsurf(): IDEInventory {
  const extensionsPath = windsurfExtensionsPath();
  const configPath = resolveAppData('Windsurf\\User');
  return detect({
    family: 'windsurf',
    displayName: 'Windsurf',
    extensionsPath,
    configPath,
  });
}
