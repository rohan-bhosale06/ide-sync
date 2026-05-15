import os from 'os';
import type { IDEInventory, UnifiedManifest } from '../detectors/types.js';

export function buildManifest(inventories: IDEInventory[]): UnifiedManifest {
  return {
    generatedAt: new Date().toISOString(),
    hostname: os.hostname(),
    platform: process.platform,
    inventories,
  };
}
