import { describe, it, expect } from 'vitest';
import type { Extension } from '../../src/detectors/types.js';
import { diffExtensions } from '../../src/reconcile/differ.js';
import { buildPlan, summarizePlan } from '../../src/reconcile/planner.js';

function ext(id: string, version = '1.0.0'): Extension {
  const [publisher, name] = id.split('.');
  return { id, publisher, name, version, path: `/fake/${id}` };
}

describe('diffExtensions', () => {
  it('returns empty diff for empty sets', () => {
    const d = diffExtensions([], []);
    expect(d.toInstall).toHaveLength(0);
    expect(d.toUpgrade).toHaveLength(0);
    expect(d.same).toHaveLength(0);
    expect(d.targetOnly).toHaveLength(0);
  });

  it('marks extensions in source but not target as toInstall', () => {
    const d = diffExtensions([ext('pub.a')], []);
    expect(d.toInstall).toHaveLength(1);
    expect(d.toInstall[0].id).toBe('pub.a');
  });

  it('marks extensions in both with same version as same', () => {
    const d = diffExtensions([ext('pub.a', '2.0.0')], [ext('pub.a', '2.0.0')]);
    expect(d.same).toHaveLength(1);
    expect(d.toInstall).toHaveLength(0);
    expect(d.toUpgrade).toHaveLength(0);
  });

  it('marks version mismatch as toUpgrade, preserving from/to correctly', () => {
    const d = diffExtensions([ext('pub.a', '2.0.0')], [ext('pub.a', '1.0.0')]);
    expect(d.toUpgrade).toHaveLength(1);
    const { from, to } = d.toUpgrade[0];
    expect(from.version).toBe('1.0.0'); // current target
    expect(to.version).toBe('2.0.0');   // desired source
  });

  it('marks extensions in target but not source as targetOnly', () => {
    const d = diffExtensions([], [ext('pub.b')]);
    expect(d.targetOnly).toHaveLength(1);
    expect(d.targetOnly[0].id).toBe('pub.b');
  });

  it('handles mixed sets correctly', () => {
    const source = [ext('pub.a'), ext('pub.b', '2.0.0'), ext('pub.c')];
    const target = [ext('pub.a'), ext('pub.b', '1.0.0'), ext('pub.d')];
    const d = diffExtensions(source, target);
    expect(d.toInstall.map((e) => e.id)).toEqual(['pub.c']);
    expect(d.toUpgrade).toHaveLength(1);
    expect(d.same.map((e) => e.id)).toEqual(['pub.a']);
    expect(d.targetOnly.map((e) => e.id)).toEqual(['pub.d']);
  });

  it('compares IDs case-insensitively', () => {
    const d = diffExtensions([ext('Pub.A', '1.0.0')], [ext('pub.a', '1.0.0')]);
    expect(d.same).toHaveLength(1);
    expect(d.toInstall).toHaveLength(0);
  });
});

describe('buildPlan', () => {
  it('creates install action for missing extensions', () => {
    const diff = diffExtensions([ext('pub.a')], []);
    const plan = buildPlan('vscode', 'cursor', diff);
    expect(plan.actions).toHaveLength(1);
    expect(plan.actions[0]).toMatchObject({ type: 'install', extensionId: 'pub.a' });
  });

  it('creates upgrade action for version mismatches', () => {
    const diff = diffExtensions([ext('pub.a', '2.0.0')], [ext('pub.a', '1.0.0')]);
    const plan = buildPlan('vscode', 'cursor', diff);
    expect(plan.actions[0]).toMatchObject({
      type: 'upgrade',
      extensionId: 'pub.a',
      fromVersion: '1.0.0',
      toVersion: '2.0.0',
    });
  });

  it('skips excluded extensions', () => {
    const diff = diffExtensions([ext('pub.a'), ext('pub.b')], []);
    const plan = buildPlan('vscode', 'cursor', diff, { exclude: ['pub.a'] });
    const types = plan.actions.map((a) => `${a.type}:${a.extensionId}`);
    expect(types).toContain('skip:pub.a');
    expect(types).toContain('install:pub.b');
  });

  it('respects case-insensitive exclude', () => {
    const diff = diffExtensions([ext('PUB.A')], []);
    const plan = buildPlan('vscode', 'cursor', diff, { exclude: ['pub.a'] });
    expect(plan.actions[0].type).toBe('skip');
  });

  it('skips upgrades when --only-missing is set', () => {
    const diff = diffExtensions([ext('pub.a', '2.0.0')], [ext('pub.a', '1.0.0')]);
    const plan = buildPlan('vscode', 'cursor', diff, { onlyMissing: true });
    expect(plan.actions[0].type).toBe('skip');
    expect((plan.actions[0] as { reason: string }).reason).toMatch(/only-missing/);
  });

  it('does not uninstall targetOnly without --prune', () => {
    const diff = diffExtensions([], [ext('pub.d')]);
    const plan = buildPlan('vscode', 'cursor', diff);
    expect(plan.actions).toHaveLength(0);
  });

  it('uninstalls targetOnly when --prune is set', () => {
    const diff = diffExtensions([], [ext('pub.d')]);
    const plan = buildPlan('vscode', 'cursor', diff, { prune: true });
    expect(plan.actions[0]).toMatchObject({ type: 'uninstall', extensionId: 'pub.d' });
  });

  it('does not prune excluded targetOnly extensions', () => {
    const diff = diffExtensions([], [ext('pub.d')]);
    const plan = buildPlan('vscode', 'cursor', diff, { prune: true, exclude: ['pub.d'] });
    expect(plan.actions).toHaveLength(0);
  });

  it('sets source and target on the plan', () => {
    const diff = diffExtensions([], []);
    const plan = buildPlan('vscode', 'cursor', diff);
    expect(plan.source).toBe('vscode');
    expect(plan.target).toBe('cursor');
  });
});

describe('summarizePlan', () => {
  it('counts actions by type', () => {
    const diff = diffExtensions(
      [ext('pub.a'), ext('pub.b', '2.0.0'), ext('pub.c')],
      [ext('pub.b', '1.0.0')],
    );
    const plan = buildPlan('vscode', 'cursor', diff, { exclude: ['pub.c'] });
    const s = summarizePlan(plan);
    expect(s.installs).toBe(1);
    expect(s.upgrades).toBe(1);
    expect(s.skips).toBe(1);
    expect(s.uninstalls).toBe(0);
  });
});
