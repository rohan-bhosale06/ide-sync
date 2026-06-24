import type { IDEFamily } from '../detectors/types.js';
import { BaseInstaller } from './base.js';

export class VSCodiumInstaller extends BaseInstaller {
  readonly family: IDEFamily = 'vscodium';
}
