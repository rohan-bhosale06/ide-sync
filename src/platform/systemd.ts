import { NotImplementedInstaller } from './service.js';

/**
 * Linux systemd user-unit service installer.
 *
 * Not yet tested on Linux. When implemented, this will:
 *   - Write ~/.config/systemd/user/ide-sync.service
 *   - Run: systemctl --user enable --now ide-sync.service
 *   - Use Type=simple, Restart=on-failure, RestartSec=10
 *
 * NOTE: To run the daemon without an active login session (e.g. headless server),
 * you must also run: loginctl enable-linger $USER
 * This is NOT done automatically — it affects system behaviour and requires your consent.
 *
 * To uninstall manually:
 *   systemctl --user disable --now ide-sync.service
 *   rm ~/.config/systemd/user/ide-sync.service
 */
export class SystemdServiceInstaller extends NotImplementedInstaller {
  constructor() {
    super('Linux (systemd)');
  }
}
