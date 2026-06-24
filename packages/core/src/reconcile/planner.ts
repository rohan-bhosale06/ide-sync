import type { IDEFamily } from '../detectors/types.js';
import type { DiffResult } from './differ.js';

export type PlanAction =
  | { type: 'install'; extensionId: string; version?: string }
  | { type: 'uninstall'; extensionId: string }
  | { type: 'upgrade'; extensionId: string; fromVersion: string; toVersion: string }
  | { type: 'skip'; extensionId: string; reason: string };

export interface Plan {
  source: IDEFamily;
  target: IDEFamily;
  actions: PlanAction[];
}

export interface PlanOptions {
  /** Extension IDs to skip, exact match (case-insensitive) */
  exclude?: string[];
  /** Only install missing extensions; skip version changes */
  onlyMissing?: boolean;
  /** Uninstall extensions that exist in target but not in source */
  prune?: boolean;
}

export function buildPlan(
  source: IDEFamily,
  target: IDEFamily,
  diff: DiffResult,
  opts: PlanOptions = {},
): Plan {
  const actions: PlanAction[] = [];
  const excludeSet = new Set((opts.exclude ?? []).map((e) => e.toLowerCase()));

  for (const ext of diff.toInstall) {
    if (excludeSet.has(ext.id.toLowerCase())) {
      actions.push({ type: 'skip', extensionId: ext.id, reason: 'excluded' });
      continue;
    }
    actions.push({ type: 'install', extensionId: ext.id, version: ext.version });
  }

  for (const { from, to } of diff.toUpgrade) {
    if (excludeSet.has(to.id.toLowerCase())) {
      actions.push({ type: 'skip', extensionId: to.id, reason: 'excluded' });
      continue;
    }
    if (opts.onlyMissing) {
      actions.push({
        type: 'skip',
        extensionId: to.id,
        reason: `already installed @ ${from.version} (--only-missing)`,
      });
      continue;
    }
    actions.push({
      type: 'upgrade',
      extensionId: to.id,
      fromVersion: from.version,
      toVersion: to.version,
    });
  }

  if (opts.prune) {
    for (const ext of diff.targetOnly) {
      if (excludeSet.has(ext.id.toLowerCase())) continue;
      actions.push({ type: 'uninstall', extensionId: ext.id });
    }
  }

  return { source, target, actions };
}

export function summarizePlan(plan: Plan): {
  installs: number;
  upgrades: number;
  uninstalls: number;
  skips: number;
} {
  let installs = 0;
  let upgrades = 0;
  let uninstalls = 0;
  let skips = 0;

  for (const a of plan.actions) {
    if (a.type === 'install') installs++;
    else if (a.type === 'upgrade') upgrades++;
    else if (a.type === 'uninstall') uninstalls++;
    else if (a.type === 'skip') skips++;
  }

  return { installs, upgrades, uninstalls, skips };
}
