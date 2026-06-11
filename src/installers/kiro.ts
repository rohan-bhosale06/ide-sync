import type { IDEFamily } from '../detectors/types.js';
import { BaseInstaller } from './base.js';

export class KiroInstaller extends BaseInstaller {
  readonly family: IDEFamily = 'kiro';
  // Kiro → Open VSX first (non-Microsoft fork)
}
