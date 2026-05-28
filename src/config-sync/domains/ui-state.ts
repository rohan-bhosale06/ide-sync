/**
 * UI-state domain handler.
 * Only a conservative whitelist of keys is synced — most of globalStorage/storage.json
 * is per-machine state (window positions, recent files, view state) that you do NOT
 * want to sync across machines.
 *
 * Strategy: last-write-wins on the whitelisted keys. No 3-way merge.
 */
import path from 'path';
import fs from 'fs';
import { parse, ParseError } from 'jsonc-parser';
import { BaseDomainHandler } from './base.js';
import type { DomainData } from '../types.js';
import { UI_STATE_WHITELIST_BASE } from '../types.js';

/** Candidate paths for the globalStorage file, relative to configPath. */
const STORAGE_CANDIDATES = [
  'globalStorage/storage.json',
  'globalStorage/global.json',
  'storage.json',
];

export class UiStateDomainHandler extends BaseDomainHandler {
  private whitelist: string[];

  constructor(configPath: string, extraWhitelist: string[] = []) {
    super(configPath);
    this.whitelist = [...UI_STATE_WHITELIST_BASE, ...extraWhitelist];
  }

  private get storagePath(): string | null {
    for (const candidate of STORAGE_CANDIDATES) {
      const p = path.join(this.configPath, candidate);
      if (fs.existsSync(p)) return p;
    }
    return null;
  }

  read(): DomainData['uiState'] {
    const storagePath = this.storagePath;
    if (!storagePath) return null;

    const raw = fs.readFileSync(storagePath, 'utf8');
    const errors: ParseError[] = [];
    const parsed = parse(raw, errors, { allowTrailingComma: true });

    if (typeof parsed !== 'object' || parsed === null) return null;
    const obj = parsed as Record<string, unknown>;

    // Extract only whitelisted keys.
    const result: Record<string, unknown> = {};
    for (const key of this.whitelist) {
      if (Object.prototype.hasOwnProperty.call(obj, key)) {
        result[key] = obj[key];
      }
    }

    return Object.keys(result).length > 0 ? result : null;
  }

  /**
   * Apply whitelisted keys from remote into the local storage file.
   * Last-write-wins: remote keys overwrite local values.
   * Keys not in the whitelist are never touched.
   */
  apply(remoteKeys: Record<string, unknown>): void {
    const storagePath = this.storagePath;
    if (!storagePath) return; // Can't apply if there's no storage file.

    const raw = fs.readFileSync(storagePath, 'utf8');
    const errors: ParseError[] = [];
    const obj = parse(raw, errors, { allowTrailingComma: true }) as Record<string, unknown> ?? {};

    let changed = false;
    for (const key of this.whitelist) {
      if (Object.prototype.hasOwnProperty.call(remoteKeys, key)) {
        obj[key] = remoteKeys[key];
        changed = true;
      }
    }

    if (changed) {
      this.atomicWrite(storagePath, JSON.stringify(obj, null, 2));
    }
  }
}
