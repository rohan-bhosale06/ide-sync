import type { IDEFamily } from '../detectors/types.js';
import type { Logger } from './logger.js';

export type JobType = 'local-change' | 'remote-check' | 'manual-sync';

export interface Job {
  type: JobType;
  ide?: IDEFamily;
  enqueuedAt: number;
  id: string;
}

export interface QueueStatus {
  running: Job | null;
  pending: Job[];
  completedCount: number;
  failedCount: number;
}

let _jobCounter = 0;
function nextId(): string {
  return `job-${Date.now()}-${++_jobCounter}`;
}

export class JobQueue {
  private _pending: Job[] = [];
  private _running: Job | null = null;
  private _completedCount = 0;
  private _failedCount = 0;
  private _paused = false;

  constructor(
    private readonly onJob: (job: Job) => Promise<void>,
    private readonly logger: Logger,
  ) {}

  /** Returns true if the job was queued, false if it was collapsed/deduped. */
  enqueue(type: JobType, ide?: IDEFamily): boolean {
    // Dedup: local-change for same IDE collapses if already pending.
    if (type === 'local-change') {
      const exists = this._pending.some((j) => j.type === 'local-change' && j.ide === ide);
      if (exists) {
        this.logger.debug({ type, ide }, 'job collapsed (already pending)');
        return false;
      }
    }

    // Dedup: remote-check globally dedupes.
    if (type === 'remote-check') {
      const exists = this._pending.some((j) => j.type === 'remote-check');
      if (exists) {
        this.logger.debug({ type }, 'remote-check collapsed (already pending)');
        return false;
      }
    }

    const job: Job = { type, ide, enqueuedAt: Date.now(), id: nextId() };
    this._pending.push(job);
    this.logger.debug({ job }, 'job enqueued');

    setImmediate(() => this._drain());
    return true;
  }

  pause(): void {
    this._paused = true;
    this.logger.info('job queue paused');
  }

  resume(): void {
    this._paused = false;
    this.logger.info('job queue resumed');
    setImmediate(() => this._drain());
  }

  get isPaused(): boolean {
    return this._paused;
  }

  get status(): QueueStatus {
    return {
      running: this._running,
      pending: [...this._pending],
      completedCount: this._completedCount,
      failedCount: this._failedCount,
    };
  }

  private async _drain(): Promise<void> {
    if (this._running !== null || this._paused) return;

    const job = this._pending.shift();
    if (!job) return;

    this._running = job;
    this.logger.info({ job }, 'job started');

    const start = Date.now();
    try {
      await this.onJob(job);
      this._completedCount++;
      this.logger.info({ job, durationMs: Date.now() - start }, 'job completed');
    } catch (err) {
      this._failedCount++;
      this.logger.error({ job, err, durationMs: Date.now() - start }, 'job failed');
    } finally {
      this._running = null;
      if (this._pending.length > 0 && !this._paused) {
        setImmediate(() => this._drain());
      }
    }
  }

  /** Drain remaining jobs with a timeout cap (for graceful shutdown). */
  async drainWithTimeout(timeoutMs: number): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    while ((this._running !== null || this._pending.length > 0) && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 200));
    }
  }
}
