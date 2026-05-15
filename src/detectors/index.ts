import { detectVSCode } from './vscode.js';
import { detectCursor } from './cursor.js';
import { detectWindsurf } from './windsurf.js';
import { detectAntigravity } from './antigravity.js';
import { detectVSCodium } from './vscodium.js';
import type { IDEFamily, IDEInventory } from './types.js';

export type { IDEFamily, IDEInventory };
export type { Extension, IDEInstallation, UnifiedManifest } from './types.js';

type DetectorFn = () => IDEInventory;

const DETECTORS: Record<IDEFamily, DetectorFn> = {
  vscode: detectVSCode,
  cursor: detectCursor,
  windsurf: detectWindsurf,
  antigravity: detectAntigravity,
  vscodium: detectVSCodium,
};

export const ALL_FAMILIES: IDEFamily[] = ['vscode', 'cursor', 'windsurf', 'antigravity', 'vscodium'];

export function runDetectors(families: IDEFamily[] = ALL_FAMILIES): IDEInventory[] {
  return families.map((family) => DETECTORS[family]());
}
