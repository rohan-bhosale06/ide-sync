import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execa } from 'execa';
import type { ServiceInstaller } from './service.js';

const SERVICE_NAME = 'ide-sync.service';
const SERVICE_DIR = path.join(os.homedir(), '.config', 'systemd', 'user');
const SERVICE_PATH = path.join(SERVICE_DIR, SERVICE_NAME);
const LOG_PATH = path.join(os.homedir(), '.ide-sync', 'logs', 'daemon.log');

function buildUnit(nodePath: string, daemonScriptPath: string): string {
  return `[Unit]
Description=ide-sync background daemon
After=network.target

[Service]
Type=simple
ExecStart=${nodePath} ${daemonScriptPath}
Restart=on-failure
RestartSec=10
StandardOutput=append:${LOG_PATH}
StandardError=append:${LOG_PATH}
Environment=HOME=${os.homedir()}

[Install]
WantedBy=default.target
`;
}

export class SystemdServiceInstaller implements ServiceInstaller {
  async install(daemonScriptPath: string): Promise<void> {
    const nodePath = process.execPath;

    fs.mkdirSync(SERVICE_DIR, { recursive: true });
    fs.mkdirSync(path.dirname(LOG_PATH), { recursive: true });
    fs.writeFileSync(SERVICE_PATH, buildUnit(nodePath, daemonScriptPath), 'utf8');

    await execa('systemctl', ['--user', 'daemon-reload']);
    await execa('systemctl', ['--user', 'enable', '--now', SERVICE_NAME]);

    console.log(`\n  systemd user unit installed: ${SERVICE_NAME}`);
    console.log(`  Unit file: ${SERVICE_PATH}`);
    console.log(`  Logs:      ${LOG_PATH}`);
    console.log(`  Trigger:   enabled for current user session`);
    console.log(`\n  NOTE: To run the daemon without an active login session (headless),`);
    console.log(`  run separately: loginctl enable-linger $USER`);
    console.log(`\n  To verify: systemctl --user status ${SERVICE_NAME}`);
    console.log(`  To remove: ide-sync daemon uninstall\n`);
  }

  async uninstall(): Promise<void> {
    try {
      await execa('systemctl', ['--user', 'disable', '--now', SERVICE_NAME]);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      // Tolerate "not loaded" — unit was already stopped/disabled.
      if (!msg.includes('not loaded') && !msg.includes('not found')) {
        throw err;
      }
    }

    if (fs.existsSync(SERVICE_PATH)) {
      fs.unlinkSync(SERVICE_PATH);
    }

    try {
      await execa('systemctl', ['--user', 'daemon-reload']);
    } catch {
      // Best-effort reload.
    }

    console.log(`\n  systemd user unit removed: ${SERVICE_NAME}\n`);
  }
}
