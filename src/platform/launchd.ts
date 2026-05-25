import { NotImplementedInstaller } from './service.js';

/**
 * macOS launchd service installer.
 *
 * Not yet tested on macOS. When implemented, this will:
 *   - Write ~/Library/LaunchAgents/com.user.ide-sync.plist
 *   - Run: launchctl bootstrap gui/$(id -u) <plist>
 *   - Use KeepAlive: { SuccessfulExit: false } so it restarts on crash but not clean stop
 *   - Log to ~/.ide-sync/logs/daemon.log via StandardOutPath/StandardErrorPath
 *
 * To uninstall manually:
 *   launchctl bootout gui/$(id -u) ~/Library/LaunchAgents/com.user.ide-sync.plist
 *   rm ~/Library/LaunchAgents/com.user.ide-sync.plist
 */
export class LaunchdServiceInstaller extends NotImplementedInstaller {
  constructor() {
    super('macOS (launchd)');
  }
}
