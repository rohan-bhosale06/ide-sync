import { app, shell, BrowserWindow } from 'electron';
import path from 'path';
import { fileURLToPath } from 'url';
import { registerIpcHandlers } from './ipc.js';
import { createTray } from './tray.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

let mainWindow: BrowserWindow | null = null;
let isQuitting = false;

function createWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1100,
    height: 750,
    minWidth: 820,
    minHeight: 560,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.mjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  win.once('ready-to-show', () => win.show());

  win.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url);
    return { action: 'deny' };
  });

  // Closing the window hides it to the tray rather than quitting — background
  // sync (if enabled) keeps running. The tray's "Quit" item exits for real.
  win.on('close', (e) => {
    if (!isQuitting) {
      e.preventDefault();
      win.hide();
    }
  });

  if (process.env.ELECTRON_RENDERER_URL) {
    win.loadURL(process.env.ELECTRON_RENDERER_URL);
  } else {
    win.loadFile(path.join(__dirname, '../renderer/index.html'));
  }

  return win;
}

app.whenReady().then(() => {
  registerIpcHandlers();
  mainWindow = createWindow();

  createTray(
    () => mainWindow,
    () => {
      isQuitting = true;
      app.quit();
    },
  );

  app.on('activate', () => {
    if (mainWindow) mainWindow.show();
    else mainWindow = createWindow();
  });
});

app.on('window-all-closed', () => {
  // Window is hidden, not closed, under normal operation — this only fires
  // after an explicit quit (tray "Quit", or non-macOS app exit).
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', () => {
  isQuitting = true;
});
