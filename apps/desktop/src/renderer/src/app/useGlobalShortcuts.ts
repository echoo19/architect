import { useEffect } from 'react';
import { isMac } from '../lib/platform';
import { navigate, paths } from '../lib/router';
import { matchShortcut } from '../lib/shortcuts';
import { useUi } from '../state/ui';

/** Ctrl/Cmd+K for the palette, Ctrl/Cmd+N for a new agent, Ctrl/Cmd+, for settings. */
export function useGlobalShortcuts(): void {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const action = matchShortcut(event, isMac());
      if (!action) return;
      event.preventDefault();
      const ui = useUi.getState();
      if (action === 'palette') {
        ui.setPaletteOpen(!ui.paletteOpen);
      } else if (action === 'settings') {
        ui.openSettings();
      } else {
        ui.setPaletteOpen(false);
        ui.setSettingsOpen(false);
        navigate(paths.newAgent());
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);
}
