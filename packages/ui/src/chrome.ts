/**
 * Colors the main process needs before any CSS loads: the window background (so a new window
 * never flashes white) and the native window controls. They mirror `--ui-ground` and
 * `--ui-fg-secondary` in styles/tokens.css; a test keeps the two in step.
 */
export interface WindowChrome {
  background: string;
  symbol: string;
}

export const WINDOW_CHROME: Readonly<Record<'dark' | 'light', WindowChrome>> = {
  dark: { background: '#0c0c0e', symbol: '#9a9aa2' },
  light: { background: '#fbfbf9', symbol: '#5e5e66' },
};
