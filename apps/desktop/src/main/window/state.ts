import { screen, type BrowserWindow } from 'electron';
import { readJsonFile, writeJsonFile } from '../storage/json-file';
import { resolveWindowState, WindowStateSchema, type WindowState } from './bounds';

const SAVE_DELAY_MS = 400;

/** Loads the saved window size and position, fitted to the displays connected now. */
export async function loadWindowState(file: string): Promise<WindowState> {
  let saved: WindowState | null = null;
  try {
    const parsed = WindowStateSchema.safeParse(await readJsonFile(file));
    if (parsed.success) saved = parsed.data;
  } catch (error) {
    console.warn(`[window] ${file} could not be read; using the default size.`, error);
  }
  return resolveWindowState(
    saved,
    screen.getAllDisplays().map((display) => display.workArea),
  );
}

/** Saves the window's size and position as it moves, and once more when it closes. */
export function trackWindowState(window: BrowserWindow, file: string): void {
  let timer: NodeJS.Timeout | undefined;

  const snapshot = (): WindowState => ({
    ...window.getNormalBounds(),
    maximized: window.isMaximized(),
  });

  const save = (state: WindowState) => {
    writeJsonFile(file, state).catch((error: unknown) => {
      console.warn('[window] Could not save the window position.', error);
    });
  };

  const schedule = () => {
    clearTimeout(timer);
    timer = setTimeout(() => save(snapshot()), SAVE_DELAY_MS);
  };

  window.on('resize', schedule);
  window.on('move', schedule);
  window.on('maximize', schedule);
  window.on('unmaximize', schedule);
  window.on('close', () => {
    clearTimeout(timer);
    save(snapshot());
  });
}
