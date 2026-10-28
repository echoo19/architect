import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { EngineClient } from '@architect/engine';
import type { AgentHostClient } from '@architect/engine/agent-host';
import { app, BrowserWindow, ipcMain, session, shell } from 'electron';
import engineEntry from '../utility/engine?modulePath';
import { launchEngineProcess, type EngineProcess } from './engine/process';
import { PickedPaths } from './files/picked';
import { registerAppHandlers } from './handlers/app';
import { registerConnectionHandlers } from './handlers/connections';
import { registerEngineHandlers } from './handlers/engine';
import { registerFilesHandlers } from './handlers/files';
import { registerGraduateHandlers } from './handlers/graduates';
import { registerOllamaHandlers } from './handlers/ollama';
import { registerSecretsHandlers } from './handlers/secrets';
import { registerSettingsHandlers } from './handlers/settings';
import { registerWorkspaceHandlers } from './handlers/workspace';
import { IpcRouter } from './ipc/router';
import { readLaunchOptions } from './launch';
import { detectGpu } from './gpu';
import { createLinkOpener } from './links';
import { signInWithOpenRouter } from './oauth/openrouter';
import { SignIns } from './oauth/sign-ins';
import { ModelPulls } from './ollama/pulls';
import { processResources } from './processes/resources';
import { Supervisor } from './processes/supervisor';
import { safeStorageCipher } from './secrets/cipher';
import { SecretStore } from './secrets/store';
import { hardenContents, hardenSession, isAppUrl, type AppOrigin } from './security';
import { quietCooldown, quietThreads } from './settings/quiet';
import { SettingsStore } from './settings/store';
import { applyTheme } from './window/chrome';
import { createMainWindow } from './window/main-window';
import { loadWindowState, trackWindowState } from './window/state';
import { agentHostEnvironment } from './workspace/environment';
import { WorkspaceGraduates } from './workspace/graduates';
import { launchAgentHostProcess } from './workspace/process';

const launch = readLaunchOptions(process.env);
if (launch.userDataDir) app.setPath('userData', launch.userDataDir);

const origin: AppOrigin = {
  indexFile: fileURLToPath(new URL('../renderer/index.html', import.meta.url)),
  ...(launch.devServerUrl ? { devServerUrl: launch.devServerUrl } : {}),
};
const preload = fileURLToPath(new URL('../preload/index.cjs', import.meta.url));
const resources = processResources({
  outDir: fileURLToPath(new URL('.', import.meta.url)),
  packaged: app.isPackaged,
  appPath: app.getAppPath(),
  resourcesPath: process.resourcesPath,
});

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

/** Closes the background processes before the app exits, so a run in progress resumes later. */
function stopOnQuit(processes: readonly { stop(): Promise<void> }[]): void {
  let stopped = false;
  app.on('before-quit', (event) => {
    if (stopped) return;
    event.preventDefault();
    Promise.all(processes.map((child) => child.stop()))
      .catch((error: unknown) => console.error('[app] A process did not stop cleanly.', error))
      .finally(() => {
        stopped = true;
        app.quit();
      });
  });
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
  const openLink = createLinkOpener((url) => shell.openExternal(url), launch.hidden);
  const signIns = new SignIns((signal) => signInWithOpenRouter({ openBrowser: openLink, signal }));
  registerAppHandlers(router, openLink);
  registerSettingsHandlers(router, settings);
  registerSecretsHandlers(router, secrets);
  // The GPU doesn't change while the app is open, so it is looked for once, when first asked.
  let gpuProbe: ReturnType<typeof detectGpu> | null = null;
  const gpu = () => (gpuProbe ??= detectGpu());
  registerConnectionHandlers(router, { keys, secrets, settings, signIns, gpu });
  registerOllamaHandlers(router, settings, pulls);
  registerFilesHandlers(router, picked);
  settings.onChange((next) => router.emit('settings', 'onChange', next));

  const localThreads = () => quietThreads(settings.get());
  const quiet = () => ({
    localThreads: localThreads(),
    localCooldown: quietCooldown(settings.get()),
  });
  let engineProcess: EngineProcess | null = null;
  settings.onChange(() => engineProcess?.applySettings(quiet()));
  const engine: Supervisor<EngineClient> = new Supervisor({
    name: 'The engine',
    launch: () =>
      (engineProcess = launchEngineProcess(
        engineEntry,
        {
          dataDir,
          sandboxEntryPath: resources.sandboxEntry,
          sampleJobFile: resources.sampleJobFile,
          ...quiet(),
        },
        keys,
      )),
    onConnect: (client) => {
      client.runs.onEvent((event) => router.emit('runs', 'onEvent', event));
    },
    // The agent host opens the engine's database, so it starts once the engine has created it.
    onReady: () => agentHost.start(),
  });
  const agentHost: Supervisor<AgentHostClient> = new Supervisor({
    name: 'The workspace',
    launch: () =>
      launchAgentHostProcess({
        entryPath: resources.agentHostEntry,
        dataDir,
        sandboxEntryPath: resources.sandboxEntry,
        env: agentHostEnvironment(process.env),
      }),
    onConnect: (client) => {
      client.onEvent((event) => router.emit('workspace', 'onEvent', event));
      graduates.openAll();
    },
  });
  const graduates = new WorkspaceGraduates({
    listGraduates: () => engine.call((api) => api.graduates.list()),
    call: (request) => agentHost.call(request),
    localThreads,
  });
  registerEngineHandlers(router, (request) => engine.call(request), picked);
  registerGraduateHandlers(router, (request) => engine.call(request), graduates, picked);
  registerWorkspaceHandlers(router, (request) => agentHost.call(request), graduates);
  engine.start();
  stopOnQuit([agentHost, engine]);

  // Closing the window stops a download and a sign-in that would have nowhere to report.
  const cancelPending = () => {
    pulls.cancel();
    signIns.cancel();
  };
  let main = await openMainWindow(cancelPending);

  app.on('second-instance', () => {
    if (main.isDestroyed()) return;
    if (main.isMinimized()) main.restore();
    if (!launch.hidden) main.show();
    main.focus();
  });

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length > 0) return;
    openMainWindow(cancelPending)
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
