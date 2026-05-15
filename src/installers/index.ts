import type { IDEFamily } from '../detectors/types.js';
import type { Installer } from './types.js';
import { VSCodeInstaller } from './vscode.js';
import { CursorInstaller } from './cursor.js';
import { WindsurfInstaller } from './windsurf.js';
import { AntigravityInstaller } from './antigravity.js';
import { VSCodiumInstaller } from './vscodium.js';

export type { InstallResult, Installer } from './types.js';

const REGISTRY: Record<IDEFamily, () => Installer> = {
  vscode: () => new VSCodeInstaller(),
  cursor: () => new CursorInstaller(),
  windsurf: () => new WindsurfInstaller(),
  antigravity: () => new AntigravityInstaller(),
  vscodium: () => new VSCodiumInstaller(),
};

export function getInstaller(family: IDEFamily): Installer {
  return REGISTRY[family]();
}
