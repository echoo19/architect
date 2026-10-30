import { WINDOW_CHROME } from '@architect/ui/chrome';
import { BrowserWindow, type BrowserWindowConstructorOptions } from 'electron';
import { HIDDEN_ARGUMENT } from '../../common/runtime';
import type { AppOrigin } from '../security';
import { MIN_WINDOW_SIZE, type WindowState } from './bounds';
import { TITLE_BAR_HEIGHT, usesTitleBarOverlay } from './chrome';

export interface MainWindowOptions {
  state: WindowState;
  origin: AppOrigin;
  preload: string;
  /** Never shown, but still painted, so tests can capture it. */
  hidden: boolean;
}

/** On macOS the traffic lights sit in the sidebar header, level with the logo. */
const TRAFFIC_LIGHTS = { x: 20, y: 27 };

function titleBar(): BrowserWindowConstructorOptions {
  if (!usesTitleBarOverlay()) {
    return { titleBarStyle: 'hiddenInset', trafficLightPosition: TRAFFIC_LIGHTS };
  }
  return {
    titleBarStyle: 'hidden',
    titleBarOverlay: {
      color: WINDOW_CHROME.background,
      symbolColor: WINDOW_CHROME.symbol,
      height: TITLE_BAR_HEIGHT,
    },
  };
}

export function createMainWindow({ state, origin, preload, hidden }: MainWindowOptions) {
  const window = new BrowserWindow({
    ...(state.x !== undefined && state.y !== undefined ? { x: state.x, y: state.y } : {}),
    width: state.width,
    height: state.height,
    useContentSize: true,
    minWidth: MIN_WINDOW_SIZE.width,
    minHeight: MIN_WINDOW_SIZE.height,
    title: 'Architect',
    show: false,
    paintWhenInitiallyHidden: true,
    backgroundColor: WINDOW_CHROME.background,
    ...titleBar(),
    webPreferences: {
      preload,
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      webSecurity: true,
      spellcheck: false,
      // Tells the page it runs for tests and screenshots, so nothing in it animates.
      additionalArguments: hidden ? [HIDDEN_ARGUMENT] : [],
    },
  });

  if (!hidden) {
    window.once('ready-to-show', () => {
      if (state.maximized) window.maximize();
      window.show();
    });
  }

  const loading = origin.devServerUrl
    ? window.loadURL(origin.devServerUrl)
    : window.loadFile(origin.indexFile);
  loading.catch((error: unknown) => console.error('[window] The app page failed to load.', error));
  return window;
}
