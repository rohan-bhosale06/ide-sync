import type { DaemonNotificationConfig } from '../sync/types.js';

// Lazy-import node-notifier to avoid hard crash on headless environments.
let _notifier: typeof import('node-notifier') | null = null;

async function getNotifier(): Promise<typeof import('node-notifier') | null> {
  if (_notifier) return _notifier;
  try {
    const mod = await import('node-notifier');
    _notifier = mod.default ?? (mod as unknown as typeof import('node-notifier'));
    return _notifier;
  } catch {
    return null;
  }
}

export type NotifyEvent = 'sync' | 'conflict' | 'error';

export async function notify(
  config: DaemonNotificationConfig,
  event: NotifyEvent,
  title: string,
  message: string,
): Promise<void> {
  if (!config.enabled) return;
  if (event === 'sync' && !config.onSync) return;
  if (event === 'conflict' && !config.onConflict) return;
  if (event === 'error' && !config.onError) return;

  const notifier = await getNotifier();
  if (!notifier) return;

  try {
    notifier.notify({ title: `ide-sync: ${title}`, message, sound: event === 'error' });
  } catch {
    // Notifications are best-effort; never crash the daemon.
  }
}
