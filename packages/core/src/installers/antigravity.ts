import type { IDEFamily } from '../detectors/types.js';
import { BaseInstaller } from './base.js';

// NOTE: The Antigravity CLI binary name is assumed to be 'antigravity'.
// If that turns out to be wrong on your system, update cli-detect.ts CLI_CANDIDATES.
export class AntigravityInstaller extends BaseInstaller {
  readonly family: IDEFamily = 'antigravity';
}
