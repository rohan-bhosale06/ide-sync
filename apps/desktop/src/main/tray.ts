/**
 * System tray icon + menu. Reflects sync status at a glance and offers
 * quick actions without opening the main window.
 */
import { Tray, Menu, nativeImage, Notification, type BrowserWindow } from 'electron';
import { configExists, runStatus, runPull, runPush, isDaemonAlive, sendIpcCommand } from 'ide-sync-core';

type DotColor = 'gray' | 'green' | 'amber' | 'red';

function createDotIcon(color: DotColor) {
  const size = 16;
  const buf = Buffer.alloc(size * size * 4);
  const colors: Record<DotColor, [number, number, number]> = {
    gray: [150, 150, 150],
    green: [40, 170, 90],
    amber: [220, 160, 30],
    red: [210, 60, 50],
  };
  const [r, g, b] = colors[color];
  const cx = size / 2 - 0.5;
  const cy = size / 2 - 0.5;
  const radius = size / 2 - 1.5;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = x - cx;
      const dy = y - cy;
      const inside = dx * dx + dy * dy <= radius * radius;
      const i = (y * size + x) * 4;
      buf[i] = b;
      buf[i + 1] = g;
      buf[i + 2] = r;
      buf[i + 3] = inside ? 255 : 0;
    }
  }
  return nativeImage.createFromBuffer(buf, { width: size, height: size });
}

let tray: Tray | null = null;
let lastHadConflicts = false;

export function createTray(getWindow: () => BrowserWindow | null, onQuit: () => void): Tray {
  tray = new Tray(createDotIcon('gray'));
  tray.setToolTip('ide-sync');

  const rebuildMenu = async () => {
    if (!tray) return;
    const daemonRunning = isDaemonAlive();
    tray.setContextMenu(
      Menu.buildFromTemplate([
        { label: 'Open ide-sync', click: () => getWindow()?.show() },
        { type: 'separator' },
        { label: 'Sync now', click: () => syncNow() },
        {
          label: daemonRunning ? 'Pause background sync' : 'Background sync is off',
          enabled: daemonRunning,
          click: () => sendIpcCommand({ cmd: 'pause' }).catch(() => {}),
        },
        { type: 'separator' },
        { label: 'Quit', click: onQuit },
      ]),
    );
  };

  const syncNow = async () => {
    if (!configExists()) return;
    await runPull({});
    await runPush({});
    await refresh();
  };

  const refresh = async () => {
    if (!tray || !configExists()) {
      tray?.setImage(createDotIcon('gray'));
      return;
    }
    try {
      const status = await runStatus({});
      if (!status.remoteReachable) {
        tray.setImage(createDotIcon('red'));
        tray.setToolTip("ide-sync — can't reach sync store");
        return;
      }
      const hasConflicts = status.conflicts.length > 0 && status.conflictPolicy === 'manual';
      if (hasConflicts) {
        tray.setImage(createDotIcon('red'));
        tray.setToolTip(`ide-sync — ${status.conflicts.length} conflict(s) need your decision`);
        if (!lastHadConflicts) {
          new Notification({
            title: 'ide-sync',
            body: `${status.conflicts.length} conflict(s) need your decision`,
          }).show();
        }
      } else if (status.toPush.length + status.toPull.length > 0) {
        tray.setImage(createDotIcon('amber'));
        tray.setToolTip('ide-sync — changes pending');
      } else {
        tray.setImage(createDotIcon('green'));
        tray.setToolTip('ide-sync — in sync');
      }
      lastHadConflicts = hasConflicts;
    } catch {
      tray.setImage(createDotIcon('red'));
      tray.setToolTip("ide-sync — can't reach sync store");
    }
    await rebuildMenu();
  };

  tray.on('click', () => getWindow()?.show());

  void rebuildMenu();
  void refresh();
  setInterval(refresh, 60_000);

  return tray;
}
