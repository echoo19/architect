import type { Theme } from '@architect/shared';
import { WINDOW_CHROME, type WindowChrome } from '@architect/ui/chrome';
import { nativeTheme, type BrowserWindow } from 'electron';

/** Height of the native window controls on Windows and Linux, level with the app's header. */
export const TITLE_BAR_HEIGHT = 56;

/**
 * Follows the user's theme choice. Setting `themeSource` also flips `prefers-color-scheme` in
 * every page, which is how the renderer learns the resolved theme.
 */
export function applyTheme(theme: Theme): void {
  nativeTheme.themeSource = theme;
}

export function currentChrome(): WindowChrome {
  return WINDOW_CHROME[nativeTheme.shouldUseDarkColors ? 'dark' : 'light'];
}

export function usesTitleBarOverlay(): boolean {
  return process.platform !== 'darwin';
}

/** Repaints the window background and native controls whenever the resolved theme changes. */
export function syncWindowChrome(window: BrowserWindow): void {
  const update = () => {
    if (window.isDestroyed()) return;
    const chrome = currentChrome();
    window.setBackgroundColor(chrome.background);
    if (usesTitleBarOverlay()) {
      window.setTitleBarOverlay({
        color: chrome.background,
        symbolColor: chrome.symbol,
        height: TITLE_BAR_HEIGHT,
      });
    }
  };
  nativeTheme.on('updated', update);
  window.once('closed', () => nativeTheme.off('updated', update));
}
