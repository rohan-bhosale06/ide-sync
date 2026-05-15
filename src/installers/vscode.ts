import type { IDEFamily } from '../detectors/types.js';
import { BaseInstaller } from './base.js';

export class VSCodeInstaller extends BaseInstaller {
  readonly family: IDEFamily = 'vscode';
  // VS Code → Microsoft Marketplace is primary (already default in resolver)
}
