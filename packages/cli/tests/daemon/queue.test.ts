import { describe, it, expect } from 'vitest';
import { JobQueue } from '../../src/daemon/queue.js';
import pino from 'pino';

const silentLogger = pino({ level: 'silent' });

function makeQueue(handler: (job: { type: string; ide?: string }) => Promise<void>) {
  return new JobQueue(handler as Parameters<typeof JobQueue>[0], silentLogger);
}

/** Wait for setImmediate to fire (lets the queue drain-start run). */
const tick = () => new Promise<void>((r) => setImmediate(r));

describe('JobQueue', () => {
  it('executes jobs serially (never concurrent)', async () => {
    const order: string[] = [];
    let running = 0;
    let maxConcurrent = 0;

    const q = makeQueue(async (job) => {
      running++;
      maxConcurrent = Math.max(maxConcurrent, running);
      order.push(job.type + (job.ide ? `:${job.ide}` : ''));
      await new Promise((r) => setTimeout(r, 10));
      running--;
    });

    q.enqueue('local-change', 'cursor');
    q.enqueue('local-change', 'vscode');
    q.enqueue('remote-check');

    await new Promise((r) => setTimeout(r, 100));
    expect(maxConcurrent).toBe(1);
    expect(order).toEqual(['local-change:cursor', 'local-change:vscode', 'remote-check']);
  });

  it('deduplicates local-change for same IDE while running', async () => {
    const executed: string[] = [];
    const q = makeQueue(async (job) => {
      executed.push(job.ide ?? job.type);
      await new Promise((r) => setTimeout(r, 30));
    });

    q.enqueue('local-change', 'cursor');
    // Wait two ticks so the drain runs and job1 is _running (not in _pending).
    await tick(); await tick();
    // Now: first is running, pending is empty.
    q.enqueue('local-change', 'cursor'); // queues follow-up
    q.enqueue('local-change', 'cursor'); // collapses into the queued follow-up

    await new Promise((r) => setTimeout(r, 120));
    expect(executed.filter((e) => e === 'cursor')).toHaveLength(2);
  });

  it('does NOT deduplicate local-change for different IDEs', async () => {
    const executed: string[] = [];
    const q = makeQueue(async (job) => {
      executed.push(job.ide ?? job.type);
      await new Promise((r) => setTimeout(r, 10));
    });

    q.enqueue('local-change', 'cursor');
    q.enqueue('local-change', 'vscode');

    await new Promise((r) => setTimeout(r, 60));
    expect(executed).toContain('cursor');
    expect(executed).toContain('vscode');
  });

  it('deduplicates remote-check globally while running', async () => {
    const executed: string[] = [];
    const q = makeQueue(async (job) => {
      executed.push(job.type);
      await new Promise((r) => setTimeout(r, 30));
    });

    q.enqueue('remote-check');
    await tick(); await tick(); // let first start
    q.enqueue('remote-check'); // queues follow-up
    q.enqueue('remote-check'); // collapses

    await new Promise((r) => setTimeout(r, 120));
    expect(executed.filter((e) => e === 'remote-check')).toHaveLength(2);
  });

  it('manual-sync always enqueues (no dedup)', async () => {
    const executed: string[] = [];
    const q = makeQueue(async (job) => {
      executed.push(job.type);
      await new Promise((r) => setTimeout(r, 5));
    });

    q.enqueue('manual-sync');
    q.enqueue('manual-sync');
    q.enqueue('manual-sync');

    await new Promise((r) => setTimeout(r, 50));
    expect(executed.filter((e) => e === 'manual-sync')).toHaveLength(3);
  });

  it('respects FIFO ordering for distinct job types', async () => {
    const order: string[] = [];
    const q = makeQueue(async (job) => {
      order.push(job.type + (job.ide ? `:${job.ide}` : ''));
      await new Promise((r) => setTimeout(r, 5));
    });

    q.enqueue('remote-check');
    await tick(); await tick(); // let first start
    q.enqueue('local-change', 'cursor');
    q.enqueue('manual-sync');

    await new Promise((r) => setTimeout(r, 50));
    expect(order[0]).toBe('remote-check');
    expect(order[1]).toBe('local-change:cursor');
    expect(order[2]).toBe('manual-sync');
  });

  it('pause stops job execution', async () => {
    const executed: string[] = [];
    const q = makeQueue(async (job) => {
      executed.push(job.type);
      await new Promise((r) => setTimeout(r, 5));
    });

    q.pause();
    q.enqueue('remote-check');
    q.enqueue('local-change', 'cursor');

    await new Promise((r) => setTimeout(r, 30));
    expect(executed).toHaveLength(0);
  });

  it('resume after pause drains queued jobs', async () => {
    const executed: string[] = [];
    const q = makeQueue(async (job) => {
      executed.push(job.type);
      await new Promise((r) => setTimeout(r, 5));
    });

    q.pause();
    q.enqueue('remote-check');
    q.enqueue('local-change', 'cursor');
    q.resume();

    await new Promise((r) => setTimeout(r, 50));
    expect(executed).toContain('remote-check');
    expect(executed).toContain('local-change');
  });

  it('status reflects running and pending state', async () => {
    const q = makeQueue(async () => {
      await new Promise((r) => setTimeout(r, 50));
    });

    q.enqueue('remote-check');
    q.enqueue('local-change', 'cursor');
    q.enqueue('manual-sync');

    await tick(); await tick(); // let first job start
    const status = q.status;
    expect(status.running).not.toBeNull();
    expect(status.pending.length).toBe(2);
  });

  it('drainWithTimeout resolves once all jobs complete', async () => {
    const executed: string[] = [];
    const q = makeQueue(async (job) => {
      await new Promise((r) => setTimeout(r, 10));
      executed.push(job.type);
    });

    q.enqueue('local-change', 'cursor');
    q.enqueue('remote-check');
    await q.drainWithTimeout(500);
    expect(executed).toHaveLength(2);
  });
});
