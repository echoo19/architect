import { useEffect } from 'react';
import type { AppSettings } from '@architect/shared';
import { queryKeys } from '../api/hooks';
import { peekQuery } from '../api/query';
import { isMac } from '../lib/platform';
import { navigate, paths } from '../lib/router';
import { matchShortcut } from '../lib/shortcuts';
import { useUi } from '../state/ui';

/**
 * Ctrl/Cmd+K for the palette, Ctrl/Cmd+N for a new agent (a new experiment in Architect WSP),
 * Ctrl/Cmd+, for settings.
 */
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
        const settings = peekQuery(queryKeys.settings)?.data as AppSettings | undefined;
        navigate(settings?.edition === 'wsp' ? paths.wspNew() : paths.newAgent());
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);
}
