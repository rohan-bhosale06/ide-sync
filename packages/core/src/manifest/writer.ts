import fs from 'fs';
import type { UnifiedManifest } from '../detectors/types.js';

export function writeManifest(manifest: UnifiedManifest, outputPath: string): void {
  fs.writeFileSync(outputPath, JSON.stringify(manifest, null, 2), 'utf8');
}
