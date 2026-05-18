import fs from 'fs';
import path from 'path';
import { migrateSyncState } from '../state.js';
import type { SyncBackend, SyncState } from '../types.js';

const STATE_FILE = 'sync-state.json';

/**
 * Filesystem backend — stores state as a single JSON file in a local directory.
 *
 * Pointed at a Dropbox / iCloud / Syncthing folder this gives real multi-machine
 * sync with zero backend setup.  Also used as the integration test double.
 */
export class FilesystemBackend implements SyncBackend {
  constructor(private readonly dirPath: string) {}

  private get stateFile(): string {
    return path.join(this.dirPath, STATE_FILE);
  }

  async init(): Promise<void> {
    fs.mkdirSync(this.dirPath, { recursive: true });
  }

  async isInitialized(): Promise<boolean> {
    return fs.existsSync(this.dirPath);
  }

  async readState(): Promise<SyncState | null> {
    if (!fs.existsSync(this.stateFile)) return null;
    const raw = JSON.parse(fs.readFileSync(this.stateFile, 'utf8')) as unknown;
    return migrateSyncState(raw);
  }

  async writeState(state: SyncState, _message: string): Promise<void> {
    fs.mkdirSync(this.dirPath, { recursive: true });
    fs.writeFileSync(this.stateFile, JSON.stringify(state, null, 2), 'utf8');
  }
}
