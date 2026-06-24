import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execa } from 'execa';
import type { ServiceInstaller } from './service.js';

const PLIST_LABEL = 'com.user.ide-sync';
const PLIST_PATH = path.join(os.homedir(), 'Library', 'LaunchAgents', `${PLIST_LABEL}.plist`);
const LOG_PATH = path.join(os.homedir(), '.ide-sync', 'logs', 'daemon.log');

function buildPlist(nodePath: string, daemonScriptPath: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${PLIST_LABEL}</string>

  <key>ProgramArguments</key>
  <array>
    <string>${nodePath}</string>
    <string>${daemonScriptPath}</string>
  </array>

  <key>RunAtLoad</key>
  <true/>

  <key>KeepAlive</key>
  <dict>
    <key>SuccessfulExit</key>
    <false/>
  </dict>

  <key>StandardOutPath</key>
  <string>${LOG_PATH}</string>

  <key>StandardErrorPath</key>
  <string>${LOG_PATH}</string>

  <key>EnvironmentVariables</key>
  <dict>
    <key>HOME</key>
    <string>${os.homedir()}</string>
  </dict>
</dict>
</plist>
`;
}

export class LaunchdServiceInstaller implements ServiceInstaller {
  async install(daemonScriptPath: string): Promise<void> {
    const nodePath = process.execPath;

    fs.mkdirSync(path.dirname(PLIST_PATH), { recursive: true });
    fs.mkdirSync(path.dirname(LOG_PATH), { recursive: true });
    fs.writeFileSync(PLIST_PATH, buildPlist(nodePath, daemonScriptPath), 'utf8');

    // Get the current user's UID for the launchctl GUI session target.
    const { stdout: uidStr } = await execa('id', ['-u']);
    const uid = uidStr.trim();

    // Unload any existing agent first (idempotent).
    try {
      await execa('launchctl', ['bootout', `gui/${uid}`, PLIST_PATH]);
    } catch {
      // Not loaded — that's fine.
    }

    await execa('launchctl', ['bootstrap', `gui/${uid}`, PLIST_PATH]);

    console.log(`\n  launchd agent installed: ${PLIST_LABEL}`);
    console.log(`  Plist: ${PLIST_PATH}`);
    console.log(`  Logs:  ${LOG_PATH}`);
    console.log(`  Trigger: at login (RunAtLoad + KeepAlive on crash)`);
    console.log(`\n  To verify: launchctl print gui/${uid}/${PLIST_LABEL}`);
    console.log(`  To remove: ide-sync daemon uninstall\n`);
  }

  async uninstall(): Promise<void> {
    const { stdout: uidStr } = await execa('id', ['-u']);
    const uid = uidStr.trim();

    try {
      await execa('launchctl', ['bootout', `gui/${uid}`, PLIST_PATH]);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      // Tolerate "No such process" — agent was already unloaded.
      if (!msg.includes('No such process') && !msg.includes('Could not find')) {
        throw err;
      }
    }

    if (fs.existsSync(PLIST_PATH)) {
      fs.unlinkSync(PLIST_PATH);
    }

    console.log(`\n  launchd agent removed: ${PLIST_LABEL}\n`);
  }
}
