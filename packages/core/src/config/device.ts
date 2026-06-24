import os from 'os';
import { randomUUID } from 'crypto';
import type { Device } from '../sync/types.js';

/** Generate a new device identity record (id is stable — stored in config). */
export function createDevice(name?: string): Pick<Device, 'id' | 'name' | 'platform'> {
  return {
    id: randomUUID(),
    name: name ?? os.hostname(),
    platform: process.platform,
  };
}
