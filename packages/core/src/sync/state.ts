import { z } from 'zod';
import { createHash } from 'crypto';
import type { IDEInventory } from '../detectors/types.js';
import type { InstalledExtension, SyncState } from './types.js';
import { emptyConfigSyncState } from '../config-sync/types.js';

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

const StoredDomainEntrySchema = z.object({
  raw: z.string(),
  updatedBy: z.string(),
  updatedAt: z.string(),
});

const ConfigSyncStateSchema = z.object({
  settings: StoredDomainEntrySchema.nullable(),
  keybindings: StoredDomainEntrySchema.nullable(),
  snippets: z.record(z.string(), StoredDomainEntrySchema),
  tasks: StoredDomainEntrySchema.nullable(),
  mcp: StoredDomainEntrySchema.nullable(),
  uiState: z.object({
    whitelistedKeys: z.record(z.string(), z.unknown()),
    updatedBy: z.string(),
    updatedAt: z.string(),
  }).nullable(),
}).passthrough();

export const SyncStateSchema = z.object({
  schemaVersion: z.union([z.literal(1), z.literal(2)]),
  updatedAt: z.string(),
  updatedByDevice: z.string(),
  extensions: z.record(z.string(), SyncStateExtensionSchema),
  removed: z.record(z.string(), TombstoneSchema),
  devices: z.record(z.string(), DeviceSchema),
  configs: ConfigSyncStateSchema.optional(),
  domainOptOuts: z.record(z.string(), z.array(z.string())).optional(),
});

// ─────────────────────────── parse / migrate ─────────────────────

export function parseSyncState(raw: unknown): SyncState {
  return SyncStateSchema.parse(raw) as SyncState;
}

/** Migration hook — handles v1→v2 and passes v2 through as-is. */
export function migrateSyncState(raw: unknown): SyncState {
  if (typeof raw !== 'object' || raw === null) {
    throw new Error('Invalid sync state: expected a JSON object');
  }
  const obj = raw as Record<string, unknown>;
  const version = obj['schemaVersion'];

  if (version === 1) {
    // Parse as v1 (the new optional fields will be absent), then add v2 defaults.
    const state = parseSyncState(raw);
    return migrateV1ToV2(state);
  }

  if (version === 2) {
    return parseSyncState(raw);
  }

  throw new Error(
    `Unsupported schemaVersion ${String(version)}. ` +
    `Please upgrade ide-sync to read this state file.`,
  );
}

function migrateV1ToV2(state: SyncState): SyncState {
  return {
    ...state,
    schemaVersion: 2,
    configs: state.configs ?? emptyConfigSyncState(),
    domainOptOuts: state.domainOptOuts ?? {},
  };
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

/** Build an empty, valid SyncState (v2) used to seed a fresh remote. */
export function emptyState(deviceId: string, deviceName: string): SyncState {
  return {
    schemaVersion: 2,
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
    configs: emptyConfigSyncState(),
    domainOptOuts: {},
  };
}
