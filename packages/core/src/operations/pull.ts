/**
 * Headless pull — structured result, no process.exit, no interactive prompts.
 * Used directly by the CLI's interactive pullCommand and (later) the desktop IPC layer.
 */
import pLimit from 'p-limit';
import { readConfig, readLastSyncedState, writeLastSyncedState, readConfigSyncConfig } from '../config/config.js';
import { runDetectors, ALL_FAMILIES } from '../detectors/index.js';
import type { IDEFamily } from '../detectors/types.js';
import { buildInstalledSet, hashState } from '../sync/state.js';
import { threeWayMerge, applyRemotePlan, stampDevice } from '../sync/engine.js';
import { hasUnresolvedConflicts } from '../sync/conflict.js';
import { createBackend } from '../sync/backends/index.js';
import { getInstaller } from '../installers/index.js';
import { acquireLock } from '../utils/lock.js';
import type { LocalAction, MergePlan, ConflictPolicy } from '../sync/types.js';
import { configPull } from '../config-sync/engine.js';
import { resolveProfileIds } from '../config/profiles.js';

export interface PullOptions {
  ide?: string;
  dryRun?: boolean;
  yes?: boolean;
  conflict?: string;
  keepLocalExtensions?: boolean;
  /** When true, suppress all console output (for daemon use). */
  silent?: boolean;
  /** If set and !autoApplyLargeChanges, abort when changed% exceeds this. */
  largeChangeThresholdPercent?: number;
  autoApplyLargeChanges?: boolean;
  /** Scope sync to a named extension profile (see `config/profiles.ts`). */
  profile?: string;
  /** Per-extension manual conflict decisions; only consulted when conflict policy is 'manual'. */
  manualResolutions?: Record<string, 'keep-local' | 'keep-remote'>;
}

export interface PullResult {
  ok: boolean;
  pulled: number;
  conflicts: number;
  error?: string;
  skipped?: 'up-to-date' | 'remote-empty' | 'dry-run' | 'aborted' | 'large-change' | 'unresolved-conflicts';
  plan?: MergePlan;
}

/** Headless pull — returns structured result, no process.exit, no interactive prompts. */
export async function runPull(opts: PullOptions = {}): Promise<PullResult> {
  const config = readConfig();
  const conflictPolicy = (opts.conflict ?? config.conflictPolicy) as ConflictPolicy;

  const families: IDEFamily[] =
    opts.ide
      ? opts.ide.split(',').map((s) => s.trim() as IDEFamily)
      : ALL_FAMILIES;

  const releaseLock = acquireLock();

  try {
    const backend = createBackend(config);
    const remote = await backend.readState();

    if (remote === null) {
      return { ok: true, pulled: 0, conflicts: 0, skipped: 'remote-empty' };
    }

    const inventories = runDetectors(families);
    const installed = buildInstalledSet(inventories);
    const base = readLastSyncedState();

    const plan = threeWayMerge({
      base,
      installed,
      remote,
      deviceId: config.deviceId,
      deviceName: config.deviceName,
      policy: conflictPolicy,
      tombstoneGCDays: config.tombstoneGCDays,
      profileIds: opts.profile ? resolveProfileIds(opts.profile) : undefined,
      manualResolutions: opts.manualResolutions,
    });

    if (hasUnresolvedConflicts(plan.conflicts)) {
      return { ok: false, pulled: 0, conflicts: plan.conflicts.length, skipped: 'unresolved-conflicts', plan };
    }

    const localActions = opts.keepLocalExtensions
      ? plan.localActions.filter((a) => a.type !== 'uninstall-local')
      : plan.localActions;

    if (localActions.length === 0) {
      return { ok: true, pulled: 0, conflicts: plan.conflicts.length, skipped: 'up-to-date', plan };
    }

    // Large-change gate (daemon safety check).
    if (opts.largeChangeThresholdPercent !== undefined && !opts.autoApplyLargeChanges) {
      const totalRemote = Object.keys(remote.extensions).length;
      const changed = plan.localActions.length + plan.remoteActions.length;
      const pct = totalRemote > 0 ? (changed / totalRemote) * 100 : 0;
      if (pct >= opts.largeChangeThresholdPercent) {
        return { ok: false, pulled: 0, conflicts: plan.conflicts.length, skipped: 'large-change', plan };
      }
    }

    if (opts.dryRun) {
      return { ok: true, pulled: 0, conflicts: plan.conflicts.length, skipped: 'dry-run', plan };
    }

    // Per-family view of what's actually installed, so actions only target
    // IDEs where they change something: no uninstalls where the extension is
    // absent, no reinstalls where the desired version is already present.
    const installedByFamily = new Map<IDEFamily, Map<string, string>>();
    for (const inv of inventories) {
      if (!inv.ide.installed) continue;
      installedByFamily.set(inv.ide.family, new Map(inv.extensions.map((e) => [e.id.toLowerCase(), e.version])));
    }

    const limit = pLimit(1);
    type Result = { action: LocalAction; success: boolean; error?: string };
    const results: Result[] = [];

    await Promise.all(
      localActions.map((action) =>
        limit(async () => {
          const candidates =
            action.families?.filter((f) => families.includes(f)) ?? families;
          const extId = action.extensionId.toLowerCase();

          const targetFamilies = candidates.filter((f) => {
            const inv = installedByFamily.get(f);
            if (!inv) return false; // IDE not installed on this machine
            if (action.type === 'uninstall-local') return inv.has(extId);
            const current = inv.get(extId);
            return current === undefined || (action.desiredVersion !== undefined && current !== action.desiredVersion);
          });

          if (targetFamilies.length === 0) {
            results.push({ action, success: true });
            return;
          }

          for (const family of targetFamilies) {
            const installer = getInstaller(family);
            if (!(await installer.isAvailable())) continue;

            try {
              let result;
              if (action.type === 'install-local') {
                result = await installer.install(action.extensionId, action.desiredVersion);
              } else {
                result = await installer.uninstall(action.extensionId);
              }
              results.push({ action, success: result.success, error: result.error });
            } catch (err) {
              results.push({ action, success: false, error: err instanceof Error ? err.message : String(err) });
            }
          }
        }),
      ),
    );

    const anyFailed = results.some((r) => !r.success);
    if (!anyFailed) {
      let newState = applyRemotePlan(remote, plan, config.deviceId, config.deviceName);

      // Phase 5: config-domain pull (if any domains enabled).
      const configSyncCfg = readConfigSyncConfig();
      if (configSyncCfg.enabledDomains.length > 0) {
        const inventoriesForConfig = runDetectors(families);
        const targetIDEs = inventoriesForConfig
          .filter((inv) => inv.ide.installed && inv.ide.configPath)
          .map((inv) => inv.ide);
        if (targetIDEs.length > 0) {
          await configPull({
            targetIDEs,
            cfg: configSyncCfg,
            baseState: base,
            remoteState: newState,
            policy: conflictPolicy,
          });
        }
      }

      const hash = hashState(newState);
      const stamped = stampDevice(newState, config.deviceId, config.deviceName, hash);
      writeLastSyncedState(stamped);
      return { ok: true, pulled: localActions.length, conflicts: plan.conflicts.length, plan };
    } else {
      const errors = results.filter((r) => !r.success).map((r) => r.error).filter(Boolean).join('; ');
      return { ok: false, pulled: 0, conflicts: plan.conflicts.length, error: errors || 'some actions failed', plan };
    }
  } finally {
    releaseLock();
  }
}
