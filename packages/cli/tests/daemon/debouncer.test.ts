import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { PerIDEDebouncer, DebouncerRegistry } from '../../src/daemon/debouncer.js';

describe('PerIDEDebouncer', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('fires after quiet period with no events', () => {
    const fired: string[] = [];
    const d = new PerIDEDebouncer('cursor', 1000, 5000, (ide) => fired.push(ide));

    d.event();
    expect(fired).toHaveLength(0);

    vi.advanceTimersByTime(1000);
    expect(fired).toEqual(['cursor']);
  });

  it('resets quiet timer on subsequent events', () => {
    const fired: string[] = [];
    const d = new PerIDEDebouncer('cursor', 1000, 10_000, (ide) => fired.push(ide));

    d.event();
    vi.advanceTimersByTime(500);
    d.event(); // reset
    vi.advanceTimersByTime(500);
    expect(fired).toHaveLength(0); // not yet — quiet period reset

    vi.advanceTimersByTime(500);
    expect(fired).toEqual(['cursor']); // now fires
  });

  it('burst of many events coalesces into one fire', () => {
    const fired: string[] = [];
    const d = new PerIDEDebouncer('vscode', 1000, 10_000, (ide) => fired.push(ide));

    for (let i = 0; i < 50; i++) {
      d.event();
      vi.advanceTimersByTime(100); // 100 ms between events
    }
    // After 50 events × 100 ms = 5 s, still within maxDebounce (10 s)
    expect(fired).toHaveLength(0); // debounce keeps resetting

    vi.advanceTimersByTime(1000); // quiet period expires
    expect(fired).toHaveLength(1);
    expect(fired[0]).toBe('vscode');
  });

  it('fires immediately when maxDebounceMs is reached during trickle', () => {
    const fired: string[] = [];
    const d = new PerIDEDebouncer('cursor', 2000, 3000, (ide) => fired.push(ide));

    d.event();
    vi.advanceTimersByTime(2500); // within debounce, so timer resets
    d.event(); // elapsed = 2500ms, remaining = 500ms < debounceMs(2000)
    // Timer is now set to min(2000, 500) = 500ms
    vi.advanceTimersByTime(500);
    expect(fired).toHaveLength(1);
  });

  it('fires immediately when maxDebounceMs elapsed at event time', () => {
    const fired: string[] = [];
    const d = new PerIDEDebouncer('cursor', 1000, 2000, (ide) => fired.push(ide));

    d.event();
    vi.advanceTimersByTime(2100); // past max — but timer already fired after 1000ms
    expect(fired).toHaveLength(1);

    // Second burst starts fresh
    d.event();
    vi.advanceTimersByTime(1000);
    expect(fired).toHaveLength(2);
  });

  it('cancel stops pending fire', () => {
    const fired: string[] = [];
    const d = new PerIDEDebouncer('windsurf', 1000, 5000, (ide) => fired.push(ide));

    d.event();
    vi.advanceTimersByTime(500);
    d.cancel();
    vi.advanceTimersByTime(1000);
    expect(fired).toHaveLength(0);
  });

  it('isPending is true while timer is active', () => {
    const d = new PerIDEDebouncer('vscode', 1000, 5000, () => {});
    expect(d.isPending).toBe(false);
    d.event();
    expect(d.isPending).toBe(true);
    vi.advanceTimersByTime(1000);
    expect(d.isPending).toBe(false);
  });

  it('per-IDE debouncers are independent', () => {
    const fired: string[] = [];
    const reg = new DebouncerRegistry(1000, 10_000, (ide) => fired.push(ide));

    reg.event('cursor');
    vi.advanceTimersByTime(500);
    reg.event('vscode'); // cursor timer keeps running; vscode timer starts fresh

    vi.advanceTimersByTime(500); // cursor quiet period expires (1000ms total)
    expect(fired).toEqual(['cursor']);

    vi.advanceTimersByTime(500); // vscode quiet period expires (1000ms from its event)
    expect(fired).toEqual(['cursor', 'vscode']);
  });
});

describe('DebouncerRegistry', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('creates per-IDE debouncers on demand', () => {
    const fired: string[] = [];
    const reg = new DebouncerRegistry(500, 5000, (ide) => fired.push(ide));

    reg.event('cursor');
    reg.event('vscode');
    vi.advanceTimersByTime(500);

    expect(fired).toContain('cursor');
    expect(fired).toContain('vscode');
    expect(fired).toHaveLength(2);
  });

  it('cancelAll stops all pending fires', () => {
    const fired: string[] = [];
    const reg = new DebouncerRegistry(1000, 5000, (ide) => fired.push(ide));

    reg.event('cursor');
    reg.event('vscode');
    reg.cancelAll();
    vi.advanceTimersByTime(2000);
    expect(fired).toHaveLength(0);
  });
});
