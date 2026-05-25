import { execa } from 'execa';
import type { ServiceInstaller } from './service.js';

const TASK_NAME = 'ide-sync-daemon';

/**
 * Windows Task Scheduler service installer.
 *
 * Creates a task that runs at logon for the current user (no elevation required).
 * The task runs: node <daemonScriptPath>
 *
 * NSSM alternative: if you want a proper Windows service with restart-on-failure,
 * install NSSM (https://nssm.cc) and run: nssm install ide-sync node <daemonScriptPath>
 */
export class WindowsServiceInstaller implements ServiceInstaller {
  async install(daemonScriptPath: string): Promise<void> {
    const nodePath = process.execPath;

    // Delete any existing task first (idempotent).
    try {
      await execa('schtasks', ['/Delete', '/TN', TASK_NAME, '/F']);
    } catch {
      // Task didn't exist — that's fine.
    }

    // Create task: run at logon, user-level (no SYSTEM, no elevation).
    await execa('schtasks', [
      '/Create',
      '/TN', TASK_NAME,
      '/TR', `"${nodePath}" "${daemonScriptPath}"`,
      '/SC', 'ONLOGON',
      '/RU', process.env.USERNAME ?? process.env.USER ?? 'CURRENTUSER',
      '/F',
    ]);

    console.log(`\n  Task Scheduler entry created: ${TASK_NAME}`);
    console.log(`  Command: "${nodePath}" "${daemonScriptPath}"`);
    console.log(`  Trigger: at logon`);
    console.log(`\n  To verify: schtasks /Query /TN ${TASK_NAME}`);
    console.log(`  To remove: ide-sync daemon uninstall\n`);
  }

  async uninstall(): Promise<void> {
    try {
      await execa('schtasks', ['/Delete', '/TN', TASK_NAME, '/F']);
      console.log(`\n  Task Scheduler entry removed: ${TASK_NAME}\n`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes('cannot find')) {
        console.log(`\n  No Task Scheduler entry found for ${TASK_NAME} (already removed).\n`);
      } else {
        throw err;
      }
    }
  }
}
