import type { IDEFamily } from '../detectors/types.js';
import { BaseInstaller } from './base.js';

export class CursorInstaller extends BaseInstaller {
  readonly family: IDEFamily = 'cursor';
  // Cursor → Open VSX first (default for non-MS forks)
}
