import { create } from 'zustand';

export type SettingsTabId = 'general' | 'models' | 'training' | 'privacy' | 'storage' | 'about';

interface UiState {
  settingsOpen: boolean;
  settingsTab: SettingsTabId;
  paletteOpen: boolean;
  openSettings: (tab?: SettingsTabId) => void;
  setSettingsOpen: (open: boolean) => void;
  setSettingsTab: (tab: SettingsTabId) => void;
  setPaletteOpen: (open: boolean) => void;
}

/** Window-level UI state: which overlays are open. Data lives in the query cache. */
export const useUi = create<UiState>()((set) => ({
  settingsOpen: false,
  settingsTab: 'general',
  paletteOpen: false,
  openSettings: (tab) =>
    set((state) => ({
      settingsOpen: true,
      paletteOpen: false,
      settingsTab: tab ?? state.settingsTab,
    })),
  setSettingsOpen: (open) => set({ settingsOpen: open }),
  setSettingsTab: (tab) => set({ settingsTab: tab }),
  setPaletteOpen: (open) => set({ paletteOpen: open }),
}));
