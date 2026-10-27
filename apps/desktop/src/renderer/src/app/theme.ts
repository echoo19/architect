import { useEffect } from 'react';

/*
 * The main process sets Electron's nativeTheme from the user's choice (dark, light or system),
 * which drives `prefers-color-scheme`. The page only mirrors the resolved result onto
 * <html data-theme>, so there is one source of truth and no flash on startup.
 */

const query = () => window.matchMedia('(prefers-color-scheme: dark)');

export function applyResolvedTheme(): void {
  document.documentElement.dataset.theme = query().matches ? 'dark' : 'light';
}

export function useThemeSync(): void {
  useEffect(() => {
    const media = query();
    applyResolvedTheme();
    media.addEventListener('change', applyResolvedTheme);
    return () => media.removeEventListener('change', applyResolvedTheme);
  }, []);
}
