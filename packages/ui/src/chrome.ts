/**
 * Colors the main process needs before any CSS loads: the window background (so a new window
 * never flashes white) and the native window controls. They mirror `--ui-ground` and `--ui-fg` in
 * styles/tokens.css; a test keeps the two in step.
 */
export interface WindowChrome {
  background: string;
  symbol: string;
}

export const WINDOW_CHROME: Readonly<WindowChrome> = { background: '#070707', symbol: '#f4f4f2' };
