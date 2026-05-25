import path from 'path';
import chokidar, { type FSWatcher } from 'chokidar';
import { runDetectors } from '../detectors/index.js';
import type { IDEFamily } from '../detectors/types.js';
import type { Logger } from './logger.js';

// Matches publisher.name-semver directory names.
const EXT_DIR_RE = /^[a-z0-9_-]+\.[a-z0-9_-]+-\d+\.\d+\.\d+$/i;

interface WatchedIDE {
  family: IDEFamily;
  extensionsPath: string;
  watcher: FSWatcher;
  eventCount: number;
  lastEventAt: number | null;
}

export class IDEWatcher {
  private watched = new Map<IDEFamily, WatchedIDE>();
  private redetectInterval: ReturnType<typeof setInterval> | null = null;
  private stopped = false;

  constructor(
    private readonly onEvent: (ide: IDEFamily) => void,
    private readonly logger: Logger,
  ) {}

  start(): void {
    this._detectAndWatch();
    // Re-detect every 60 s so newly installed IDEs get picked up automatically.
    this.redetectInterval = setInterval(() => this._detectAndWatch(), 60_000);
  }

  async stop(): Promise<void> {
    this.stopped = true;
    if (this.redetectInterval !== null) {
      clearInterval(this.redetectInterval);
      this.redetectInterval = null;
    }
    await Promise.all([...this.watched.values()].map((w) => w.watcher.close()));
    this.watched.clear();
  }

  getWatchedIDEs(): Array<{ family: IDEFamily; extensionsPath: string; eventCount: number; lastEventAt: number | null }> {
    return [...this.watched.values()].map(({ family, extensionsPath, eventCount, lastEventAt }) => ({
      family,
      extensionsPath,
      eventCount,
      lastEventAt,
    }));
  }

  private _detectAndWatch(): void {
    if (this.stopped) return;
    const inventories = runDetectors();
    for (const inv of inventories) {
      if (!inv.ide.installed || !inv.ide.extensionsPath) continue;
      if (this.watched.has(inv.ide.family)) continue;
      this._addWatcher(inv.ide.family, inv.ide.extensionsPath);
    }
  }

  private _addWatcher(family: IDEFamily, extensionsPath: string): void {
    // Watch parent dir so chokidar reattaches if extensions/ is recreated.
    const watchDir = path.dirname(extensionsPath);

    const watcher = chokidar.watch(watchDir, {
      ignoreInitial: true,
      depth: 1,
      awaitWriteFinish: { stabilityThreshold: 2000, pollInterval: 100 },
      ignored: /(^|[/\\])\../,
    });

    const record: WatchedIDE = {
      family,
      extensionsPath,
      watcher,
      eventCount: 0,
      lastEventAt: null,
    };

    const onDirEvent = (eventPath: string) => {
      // Only fire on directories that look like extension dirs.
      const base = path.basename(eventPath);
      if (!EXT_DIR_RE.test(base)) return;
      record.eventCount++;
      record.lastEventAt = Date.now();
      this.logger.debug({ family, path: eventPath }, 'extension directory event');
      this.onEvent(family);
    };

    watcher.on('addDir', onDirEvent);
    watcher.on('unlinkDir', onDirEvent);
    watcher.on('error', (err) => {
      this.logger.warn({ family, err }, 'watcher error');
    });

    this.watched.set(family, record);
    this.logger.info({ family, watchDir }, 'watching IDE');
  }
}
