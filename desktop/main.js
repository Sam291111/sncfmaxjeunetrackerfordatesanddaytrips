import { app, BrowserWindow, dialog, shell } from 'electron';
import { once } from 'node:events';
import { join } from 'node:path';

app.setName('MAX Jeune Planner');

let plannerServer;
let plannerUrl;

async function startPlannerServer() {
  process.env.PORT = '0';
  process.env.MAX_CACHE_DIR = join(app.getPath('userData'), 'cache');

  const { startPlannerServer } = await import('../server.js');
  plannerServer = startPlannerServer(0, '127.0.0.1');
  if (!plannerServer.listening || !plannerServer.address()) await once(plannerServer, 'listening');

  const address = plannerServer.address();
  if (!address || typeof address === 'string') {
    throw new Error('The local planner server did not provide a usable address.');
  }
  plannerUrl = `http://127.0.0.1:${address.port}`;
}

function openExternalLinksInBrowser(window) {
  const isPlannerOrigin = candidate => {
    try {
      return new URL(candidate).origin === new URL(plannerUrl).origin;
    } catch {
      return false;
    }
  };

  window.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://') || url.startsWith('http://')) {
      void shell.openExternal(url);
    }
    return { action: 'deny' };
  });

  window.webContents.on('will-navigate', (event, url) => {
    if (!isPlannerOrigin(url)) {
      event.preventDefault();
      if (url.startsWith('https://') || url.startsWith('http://')) {
        void shell.openExternal(url);
      }
    }
  });
}

async function createWindow() {
  const window = new BrowserWindow({
    width: 1440,
    height: 980,
    minWidth: 900,
    minHeight: 650,
    show: false,
    title: 'MAX Jeune Planner',
    backgroundColor: '#f4f7fa',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  openExternalLinksInBrowser(window);
  window.once('ready-to-show', () => window.show());
  await window.loadURL(plannerUrl);
}

const hasSingleInstanceLock = app.requestSingleInstanceLock();
if (!hasSingleInstanceLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    const window = BrowserWindow.getAllWindows()[0];
    if (window) {
      if (window.isMinimized()) window.restore();
      window.focus();
    }
  });
}

app.whenReady().then(async () => {
  if (!hasSingleInstanceLock) return;
  try {
    await startPlannerServer();
    await createWindow();
  } catch (error) {
    dialog.showErrorBox(
      'MAX Jeune Planner could not start',
      `${error.message}\n\nTry quitting and reopening the app. If the problem continues, contact support with this message.`,
    );
    app.quit();
  }
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0 && plannerUrl) {
    void createWindow();
  }
});

app.on('before-quit', () => {
  if (plannerServer?.listening) plannerServer.close();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
