/**
 * Headless setup — structured results, no prompts, no process.exit.
 * Backs both the CLI's interactive `init` command and the desktop onboarding wizard.
 */
import { configExists, readConfig, writeConfig } from '../config/config.js';
import { createDevice } from '../config/device.js';
import { createBackend } from '../sync/backends/index.js';
import type { Config, ConflictPolicy } from '../sync/types.js';

export interface TestConnectionOptions {
  backend: 'git' | 'filesystem';
  gitRepoUrl?: string;
  filesystemPath?: string;
}

export interface TestConnectionResult {
  ok: boolean;
  error?: string;
}

/**
 * Probe a backend (clone the git repo / check the folder, then read state) without
 * persisting any config. Used by the onboarding wizard's "Test connection" step.
 */
export async function testBackendConnection(opts: TestConnectionOptions): Promise<TestConnectionResult> {
  try {
    const probeConfig: Config = {
      deviceId: 'probe',
      deviceName: 'probe',
      backend: opts.backend,
      gitRepoUrl: opts.gitRepoUrl,
      filesystemPath: opts.filesystemPath,
      conflictPolicy: 'newest',
      tombstoneGCDays: 90,
    };
    const backendInst = createBackend(probeConfig);
    await backendInst.init();
    await backendInst.readState();
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export interface RunInitOptions {
  backend: 'git' | 'filesystem';
  gitRepoUrl?: string;
  filesystemPath?: string;
  deviceName?: string;
  conflictPolicy?: ConflictPolicy;
  tombstoneGCDays?: number;
}

export interface RunInitResult {
  ok: boolean;
  config?: Config;
  /** True when the remote had no existing state — caller may want to offer a first push. */
  remoteEmpty?: boolean;
  error?: string;
}

/** Headless init — initialises the backend and writes config. No seeding (call runPush separately). */
export async function runInit(opts: RunInitOptions): Promise<RunInitResult> {
  const existing = configExists() ? readConfig() : null;
  const deviceDefaults = createDevice(opts.deviceName);

  const config: Config = {
    deviceId: existing?.deviceId ?? deviceDefaults.id,
    deviceName: opts.deviceName ?? existing?.deviceName ?? deviceDefaults.name,
    backend: opts.backend,
    gitRepoUrl: opts.gitRepoUrl,
    filesystemPath: opts.filesystemPath,
    conflictPolicy: opts.conflictPolicy ?? existing?.conflictPolicy ?? 'newest',
    tombstoneGCDays: opts.tombstoneGCDays ?? existing?.tombstoneGCDays ?? 90,
  };

  try {
    const backendInst = createBackend(config);
    await backendInst.init();
    writeConfig(config);
    const remoteState = await backendInst.readState().catch(() => null);
    return { ok: true, config, remoteEmpty: remoteState === null };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}
