import { z } from 'zod';
import { createHash } from 'crypto';
import type { IDEInventory } from '../detectors/types.js';
import type { InstalledExtension, SyncState } from './types.js';

// ─────────────────────────── zod schema ──────────────────────────

const IDEFamilySchema = z.enum(['vscode', 'cursor', 'windsurf', 'antigravity', 'vscodium']);

const SyncStateExtensionSchema = z.object({
  desiredVersion: z.string(),
  families: z.array(IDEFamilySchema),
  addedBy: z.string(),
  addedAt: z.string(),
});

const TombstoneSchema = z.object({
  removedBy: z.string(),
  removedAt: z.string(),
});

const DeviceSchema = z.object({
  id: z.string(),
  name: z.string(),
  platform: z.string(),
  lastSyncedAt: z.string().nullable(),
  lastSyncedStateHash: z.string().nullable(),
});

export const SyncStateSchema = z.object({
  schemaVersion: z.literal(1),
  updatedAt: z.string(),
  updatedByDevice: z.string(),
  extensions: z.record(z.string(), SyncStateExtensionSchema),
  removed: z.record(z.string(), TombstoneSchema),
  devices: z.record(z.string(), DeviceSchema),
});

// ─────────────────────────── parse / migrate ─────────────────────

export function parseSyncState(raw: unknown): SyncState {
  return SyncStateSchema.parse(raw) as SyncState;
}

/** Migration hook — add a version → version branch here when schemaVersion bumps. */
export function migrateSyncState(raw: unknown): SyncState {
  if (typeof raw !== 'object' || raw === null) {
    throw new Error('Invalid sync state: expected a JSON object');
  }
  const obj = raw as Record<string, unknown>;
  const version = obj['schemaVersion'];
  if (version === 1) {
    return parseSyncState(raw);
  }
  throw new Error(
    `Unsupported schemaVersion ${String(version)}. ` +
    `Please upgrade ide-sync to read this state file.`,
  );
}

// ─────────────────────────── helpers ─────────────────────────────

function sortedKeys<T>(obj: Record<string, T>): Record<string, T> {
  return Object.fromEntries(
    Object.entries(obj).sort(([a], [b]) => a.localeCompare(b)),
  ) as Record<string, T>;
}

/** Deterministic SHA-256 hash of the extension + tombstone data (not metadata). */
export function hashState(state: SyncState): string {
  const canonical = JSON.stringify({
    extensions: sortedKeys(state.extensions),
    removed: sortedKeys(state.removed),
  });
  return createHash('sha256').update(canonical).digest('hex').slice(0, 16);
}

/**
 * Convert Phase-1 scan results into a flat list of installed extensions.
 * Deduplicates by id (lower-cased), merges families.
 */
export function buildInstalledSet(inventories: IDEInventory[]): InstalledExtension[] {
  const map = new Map<string, InstalledExtension>();

  for (const inv of inventories) {
    if (!inv.ide.installed) continue;

    for (const ext of inv.extensions) {
      const key = ext.id.toLowerCase();
      const existing = map.get(key);

      if (existing) {
        if (!existing.families.includes(inv.ide.family)) {
          existing.families.push(inv.ide.family);
        }
      } else {
        map.set(key, {
          id: ext.id,
          version: ext.version,
          families: [inv.ide.family],
        });
      }
    }
  }

  return Array.from(map.values());
}

/** Build an empty, valid SyncState (used to seed a fresh remote). */
export function emptyState(deviceId: string, deviceName: string): SyncState {
  return {
    schemaVersion: 1,
    updatedAt: new Date().toISOString(),
    updatedByDevice: deviceId,
    extensions: {},
    removed: {},
    devices: {
      [deviceId]: {
        id: deviceId,
        name: deviceName,
        platform: process.platform,
        lastSyncedAt: null,
        lastSyncedStateHash: null,
      },
    },
  };
}
