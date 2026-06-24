/**
 * Named extension profiles — a way to scope sync to a subset of extensions
 * (e.g. "work" vs "personal") instead of syncing everything.
 */
import fs from 'fs';
import { resolveHome } from '../utils/paths.js';

const PROFILES_FILE = resolveHome('.ide-sync', 'profiles.json');

export interface ExtensionProfile {
  name: string;
  extensionIds: string[];
  createdAt: string;
}

export function readProfiles(): Record<string, ExtensionProfile> {
  if (!fs.existsSync(PROFILES_FILE)) return {};
  try {
    return JSON.parse(fs.readFileSync(PROFILES_FILE, 'utf8')) as Record<string, ExtensionProfile>;
  } catch {
    return {};
  }
}

export function writeProfiles(profiles: Record<string, ExtensionProfile>): void {
  fs.mkdirSync(resolveHome('.ide-sync'), { recursive: true });
  fs.writeFileSync(PROFILES_FILE, JSON.stringify(profiles, null, 2), 'utf8');
}

export function listProfiles(): ExtensionProfile[] {
  return Object.values(readProfiles());
}

export function createProfile(name: string, extensionIds: string[]): ExtensionProfile {
  const profiles = readProfiles();
  if (profiles[name]) {
    throw new Error(`Profile '${name}' already exists. Use updateProfile to modify it.`);
  }
  const profile: ExtensionProfile = {
    name,
    extensionIds: extensionIds.map((id) => id.toLowerCase()),
    createdAt: new Date().toISOString(),
  };
  profiles[name] = profile;
  writeProfiles(profiles);
  return profile;
}

export function updateProfile(name: string, extensionIds: string[]): ExtensionProfile {
  const profiles = readProfiles();
  const existing = profiles[name];
  if (!existing) {
    throw new Error(`Profile '${name}' does not exist.`);
  }
  const profile: ExtensionProfile = {
    ...existing,
    extensionIds: extensionIds.map((id) => id.toLowerCase()),
  };
  profiles[name] = profile;
  writeProfiles(profiles);
  return profile;
}

export function deleteProfile(name: string): void {
  const profiles = readProfiles();
  if (!profiles[name]) {
    throw new Error(`Profile '${name}' does not exist.`);
  }
  delete profiles[name];
  writeProfiles(profiles);
}

/** Resolve a profile name to its set of lowercased extension IDs. Throws if not found. */
export function resolveProfileIds(name: string): Set<string> {
  const profiles = readProfiles();
  const profile = profiles[name];
  if (!profile) {
    throw new Error(`Profile '${name}' does not exist. Use \`ide-sync profile list\` to see available profiles.`);
  }
  return new Set(profile.extensionIds.map((id) => id.toLowerCase()));
}
