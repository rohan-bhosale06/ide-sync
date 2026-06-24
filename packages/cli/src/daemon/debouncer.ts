import type { IDEFamily } from 'ide-sync-core';

export class PerIDEDebouncer {
  private pendingTimer: ReturnType<typeof setTimeout> | null = null;
  private firstEventAt: number | null = null;

  constructor(
    readonly ide: IDEFamily,
    private readonly debounceMs: number,
    private readonly maxDebounceMs: number,
    private readonly onFire: (ide: IDEFamily) => void,
  ) {}

  event(): void {
    const now = Date.now();

    if (this.firstEventAt === null) {
      this.firstEventAt = now;
    }

    const elapsed = now - this.firstEventAt;
    const remaining = this.maxDebounceMs - elapsed;

    if (remaining <= 0) {
      // Hard cap reached — fire immediately.
      this.clearTimer();
      this.fire();
      return;
    }

    // Trailing debounce: reset quiet-period timer, but cap at remaining max.
    this.clearTimer();
    this.pendingTimer = setTimeout(() => this.fire(), Math.min(this.debounceMs, remaining));
  }

  private fire(): void {
    this.firstEventAt = null;
    this.pendingTimer = null;
    this.onFire(this.ide);
  }

  private clearTimer(): void {
    if (this.pendingTimer !== null) {
      clearTimeout(this.pendingTimer);
      this.pendingTimer = null;
    }
  }

  cancel(): void {
    this.clearTimer();
    this.firstEventAt = null;
  }

  get isPending(): boolean {
    return this.pendingTimer !== null;
  }

  /** Milliseconds until fire (null if not pending). */
  get msUntilFire(): number | null {
    if (!this.isPending || this.firstEventAt === null) return null;
    const elapsed = Date.now() - this.firstEventAt;
    const remaining = this.maxDebounceMs - elapsed;
    return Math.max(0, Math.min(this.debounceMs, remaining));
  }
}

export class DebouncerRegistry {
  private debouncers = new Map<IDEFamily, PerIDEDebouncer>();

  constructor(
    private readonly debounceMs: number,
    private readonly maxDebounceMs: number,
    private readonly onFire: (ide: IDEFamily) => void,
  ) {}

  event(ide: IDEFamily): void {
    let d = this.debouncers.get(ide);
    if (!d) {
      d = new PerIDEDebouncer(ide, this.debounceMs, this.maxDebounceMs, this.onFire);
      this.debouncers.set(ide, d);
    }
    d.event();
  }

  cancelAll(): void {
    for (const d of this.debouncers.values()) d.cancel();
  }

  getDebouncer(ide: IDEFamily): PerIDEDebouncer | undefined {
    return this.debouncers.get(ide);
  }

  all(): PerIDEDebouncer[] {
    return [...this.debouncers.values()];
  }
}
