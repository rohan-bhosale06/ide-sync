import type { IDEFamily } from '../detectors/types.js';
import { BaseInstaller } from './base.js';

export class WindsurfInstaller extends BaseInstaller {
  readonly family: IDEFamily = 'windsurf';
}
