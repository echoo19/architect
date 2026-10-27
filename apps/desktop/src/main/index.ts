import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { app, BrowserWindow, ipcMain, session } from 'electron';
import { PickedPaths } from './files/picked';
import { registerAppHandlers } from './handlers/app';
import { registerConnectionHandlers } from './handlers/connections';
import { registerFilesHandlers } from './handlers/files';
import { registerOllamaHandlers } from './handlers/ollama';
import { registerSecretsHandlers } from './handlers/secrets';
import { registerSettingsHandlers } from './handlers/settings';
import { IpcRouter } from './ipc/router';
import { readLaunchOptions } from './launch';
import { ModelPulls } from './ollama/pulls';
import { safeStorageCipher } from './secrets/cipher';
import { SecretStore } from './secrets/store';
import { hardenContents, hardenSession, isAppUrl, type AppOrigin } from './security';
import { SettingsStore } from './settings/store';
import { applyTheme } from './window/chrome';
import { createMainWindow } from './window/main-window';
import { loadWindowState, trackWindowState } from './window/state';

const launch = readLaunchOptions(process.env);
if (launch.userDataDir) app.setPath('userData', launch.userDataDir);

const origin: AppOrigin = {
  indexFile: fileURLToPath(new URL('../renderer/index.html', import.meta.url)),
  ...(launch.devServerUrl ? { devServerUrl: launch.devServerUrl } : {}),
};
const preload = fileURLToPath(new URL('../preload/index.cjs', import.meta.url));

app.on('web-contents-created', (_event, contents) => hardenContents(contents, origin));

async function openMainWindow(onClosed: () => void): Promise<BrowserWindow> {
  const stateFile = join(app.getPath('userData'), 'window-state.json');
  const window = createMainWindow({
    state: await loadWindowState(stateFile),
    origin,
    preload,
    hidden: launch.hidden,
  });
  trackWindowState(window, stateFile);
  window.once('closed', onClosed);
  return window;
}

async function start(): Promise<void> {
  await app.whenReady();
  hardenSession(session.defaultSession);

  const dataDir = app.getPath('userData');
  const settings = await SettingsStore.open(join(dataDir, 'settings.json'));
  const secrets = await SecretStore.open(join(dataDir, 'secrets.json'), safeStorageCipher);
  applyTheme(settings.get().theme);
  settings.onChange((next) => applyTheme(next.theme));

  const router = new IpcRouter({
    ipcMain,
    isTrustedSender: (url) => isAppUrl(url, origin),
    targets: () => BrowserWindow.getAllWindows().map((window) => window.webContents),
  });
  const picked = new PickedPaths();
  const pulls = new ModelPulls((progress) => router.emit('ollama', 'onPullProgress', progress));
  const keys = (ref: string) => secrets.get(ref);
  registerAppHandlers(router);
  registerSettingsHandlers(router, settings);
  registerSecretsHandlers(router, secrets);
  registerConnectionHandlers(router, keys);
  registerOllamaHandlers(router, settings, pulls);
  registerFilesHandlers(router, picked);
  settings.onChange((next) => router.emit('settings', 'onChange', next));

  const cancelPull = () => pulls.cancel();
  let main = await openMainWindow(cancelPull);

  app.on('second-instance', () => {
    if (main.isDestroyed()) return;
    if (main.isMinimized()) main.restore();
    if (!launch.hidden) main.show();
    main.focus();
  });

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length > 0) return;
    openMainWindow(cancelPull)
      .then((window) => {
        main = window;
      })
      .catch((error: unknown) => console.error('[app] Could not reopen the window.', error));
  });
}

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

if (app.requestSingleInstanceLock()) {
  start().catch((error: unknown) => {
    console.error('[app] Architect failed to start.', error);
    app.exit(1);
  });
} else {
  app.quit();
}
