import { nativeTheme } from 'electron';

/** Height of the native window controls on Windows and Linux, level with the app's header. */
export const TITLE_BAR_HEIGHT = 56;

/**
 * Architect has one theme, dark, whatever the system's setting is. This also makes the native
 * parts of every window dark (menus, scrollbars, form controls) and sets `prefers-color-scheme`
 * in every page.
 */
export function forceDarkTheme(): void {
  nativeTheme.themeSource = 'dark';
}

export function usesTitleBarOverlay(): boolean {
  return process.platform !== 'darwin';
}
