import { useSyncExternalStore } from 'react';

function onResize(change: () => void): () => void {
  window.addEventListener('resize', change);
  return () => window.removeEventListener('resize', change);
}

/**
 * Whether the window is narrower than `width` pixels, kept current as it is resized: for a layout
 * that changes on a narrow window, such as a panel that floats over the page instead of beside it.
 */
export function useWindowBelow(width: number): boolean {
  return useSyncExternalStore(
    onResize,
    () => window.innerWidth < width,
    () => false,
  );
}
