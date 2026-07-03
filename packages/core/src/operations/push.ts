/**
 * Headless push — structured result, no process.exit, no interactive prompts.
 * Used directly by the CLI's interactive pushCommand and (later) the desktop IPC layer.
 */
import { readConfig, readLastSyncedState, writeLastSyncedState, readConfigSyncConfig } from '../config/config.js';
import { runDetectors, ALL_FAMILIES } from '../detectors/index.js';
import type { IDEFamily } from '../detectors/types.js';
import { buildInstalledSet, hashState } from '../sync/state.js';
import { threeWayMerge, applyRemotePlan, stampDevice } from '../sync/engine.js';
import { hasUnresolvedConflicts } from '../sync/conflict.js';
import { createBackend, PushConflictError } from '../sync/backends/index.js';
import { acquireLock } from '../utils/lock.js';
import type { MergePlan, ConflictPolicy } from '../sync/types.js';
import { configPush } from '../config-sync/engine.js';
import { resolveProfileIds } from '../config/profiles.js';

export interface PushOptions {
  ide?: string;
  dryRun?: boolean;
  yes?: boolean;
  conflict?: string;
  silent?: boolean;
  largeChangeThresholdPercent?: number;
  autoApplyLargeChanges?: boolean;
  /** Scope sync to a named extension profile (see `config/profiles.ts`). */
  profile?: string;
  /** Per-extension manual conflict decisions; only consulted when conflict policy is 'manual'. */
  manualResolutions?: Record<string, 'keep-local' | 'keep-remote'>;
}

export interface PushResult {
  ok: boolean;
  pushed: number;
  conflicts: number;
  error?: string;
  skipped?: 'up-to-date' | 'dry-run' | 'large-change' | 'unresolved-conflicts';
  plan?: MergePlan;
}

/** Headless push — returns structured result, no process.exit, no interactive prompts. */
export async function runPush(opts: PushOptions = {}): Promise<PushResult> {
  const config = readConfig();
  const conflictPolicy = (opts.conflict ?? config.conflictPolicy) as ConflictPolicy;

  const families: IDEFamily[] =
    opts.ide
      ? opts.ide.split(',').map((s) => s.trim() as IDEFamily)
      : ALL_FAMILIES;

  const releaseLock = acquireLock();

  try {
    const inventories = runDetectors(families);
    const installed = buildInstalledSet(inventories);

    const backend = createBackend(config);
    const remote = await backend.readState();
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
      return { ok: false, pushed: 0, conflicts: plan.conflicts.length, skipped: 'unresolved-conflicts', plan };
    }

    const pushActions = plan.remoteActions;

    if (pushActions.length === 0 && plan.tombstonesToGC.length === 0) {
      return { ok: true, pushed: 0, conflicts: plan.conflicts.length, skipped: 'up-to-date', plan };
    }

    // Large-change gate.
    if (opts.largeChangeThresholdPercent !== undefined && !opts.autoApplyLargeChanges) {
      const totalRemote = remote ? Object.keys(remote.extensions).length : 0;
      const changed = plan.localActions.length + plan.remoteActions.length;
      const pct = totalRemote > 0 ? (changed / totalRemote) * 100 : 0;
      if (pct >= opts.largeChangeThresholdPercent) {
        return { ok: false, pushed: 0, conflicts: plan.conflicts.length, skipped: 'large-change', plan };
      }
    }

    if (opts.dryRun) {
      return { ok: true, pushed: 0, conflicts: plan.conflicts.length, skipped: 'dry-run', plan };
    }

    let newState = applyRemotePlan(remote, plan, config.deviceId, config.deviceName);

    // Phase 5: config-domain push (if any domains enabled).
    const configSyncCfg = readConfigSyncConfig();
    if (configSyncCfg.enabledDomains.length > 0) {
      const inventoriesForConfig = runDetectors(families);
      const sourceIDE = inventoriesForConfig.find((inv) => inv.ide.installed && inv.ide.configPath)?.ide;
      if (sourceIDE) {
        const configResult = await configPush({
          sourceIDE,
          cfg: configSyncCfg,
          baseState: base,
          remoteState: newState,
          deviceId: config.deviceId,
          policy: conflictPolicy,
        });
        newState = { ...newState, configs: configResult.updatedConfigs, domainOptOuts: configResult.updatedDomainOptOuts };
      }
    }

    const newHash = hashState(newState);
    const stampedState = stampDevice(newState, config.deviceId, config.deviceName, newHash);

    const adds = pushActions.filter((a) => a.type === 'push-add').length;
    const removes = pushActions.filter((a) => a.type === 'push-remove').length;
    const updates = pushActions.filter((a) => a.type === 'push-version-update').length;
    const msgParts: string[] = [];
    if (adds) msgParts.push(`+${adds}`);
    if (removes) msgParts.push(`-${removes}`);
    if (updates) msgParts.push(`~${updates}`);
    const commitMsg = `sync: ${config.deviceName} ${msgParts.join(' ')} @ ${new Date().toISOString()}`;

    try {
      await backend.writeState(stampedState, commitMsg);
    } catch (err) {
      if (err instanceof PushConflictError) {
        // Re-pull and retry once.
        const freshRemote = await backend.readState();
        const retryPlan = threeWayMerge({
          base,
          installed,
          remote: freshRemote,
          deviceId: config.deviceId,
          deviceName: config.deviceName,
          policy: conflictPolicy,
          tombstoneGCDays: config.tombstoneGCDays,
          profileIds: opts.profile ? resolveProfileIds(opts.profile) : undefined,
          manualResolutions: opts.manualResolutions,
        });
        const retryState = applyRemotePlan(freshRemote, retryPlan, config.deviceId, config.deviceName);
        const retryHash = hashState(retryState);
        const retryStamped = stampDevice(retryState, config.deviceId, config.deviceName, retryHash);
        await backend.writeState(retryStamped, commitMsg);
        writeLastSyncedState(retryStamped);
        return { ok: true, pushed: pushActions.length, conflicts: plan.conflicts.length, plan };
      }
      const msg = err instanceof Error ? err.message : String(err);
      return { ok: false, pushed: 0, conflicts: plan.conflicts.length, error: msg, plan };
    }

    writeLastSyncedState(stampedState);
    return { ok: true, pushed: pushActions.length, conflicts: plan.conflicts.length, plan };
  } finally {
    releaseLock();
  }
}
