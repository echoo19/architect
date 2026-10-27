import { z } from 'zod';

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface Size {
  width: number;
  height: number;
}

export const WindowStateSchema = z.object({
  x: z.number().int().optional(),
  y: z.number().int().optional(),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  maximized: z.boolean(),
});
export type WindowState = z.infer<typeof WindowStateSchema>;

export const MIN_WINDOW_SIZE: Size = { width: 960, height: 640 };
export const DEFAULT_WINDOW_SIZE: Size = { width: 1440, height: 900 };

/** How much of a saved window must still be on a display for its position to be reused. */
const MIN_VISIBLE: Size = { width: 120, height: 80 };

function overlap(a: Rect, b: Rect): Size {
  return {
    width: Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x)),
    height: Math.max(0, Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y)),
  };
}

function largest(areas: readonly Rect[]): Rect | undefined {
  return [...areas].sort((a, b) => b.width * b.height - a.width * a.height)[0];
}

/**
 * Where the window opens. Reuses the saved size and position when they still fit the current
 * displays; otherwise falls back to a size that fits and lets the window center itself.
 */
export function resolveWindowState(
  saved: WindowState | null,
  workAreas: readonly Rect[],
): WindowState {
  const area = largest(workAreas);
  const fit = (size: Size): Size => ({
    width: Math.max(MIN_WINDOW_SIZE.width, Math.min(size.width, area?.width ?? size.width)),
    height: Math.max(MIN_WINDOW_SIZE.height, Math.min(size.height, area?.height ?? size.height)),
  });

  if (!saved) return { ...fit(DEFAULT_WINDOW_SIZE), maximized: false };

  const size = fit(saved);
  if (saved.x === undefined || saved.y === undefined) {
    return { ...size, maximized: saved.maximized };
  }
  const rect = { x: saved.x, y: saved.y, ...size };
  const visible = workAreas.some((work) => {
    const seen = overlap(rect, work);
    return seen.width >= MIN_VISIBLE.width && seen.height >= MIN_VISIBLE.height;
  });
  return visible
    ? { ...rect, maximized: saved.maximized }
    : { ...size, maximized: saved.maximized };
}
