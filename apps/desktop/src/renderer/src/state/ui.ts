import { create } from 'zustand';

export type SettingsTabId = 'general' | 'models' | 'training' | 'privacy' | 'storage' | 'about';

/** A row that settings open on, when the person was sent there to deal with it. */
export type SettingsFocus = 'huggingface';

interface UiState {
  settingsOpen: boolean;
  settingsTab: SettingsTabId;
  /** The row the open settings bring up, so a person sent for it doesn't have to look. */
  settingsFocus: SettingsFocus | null;
  paletteOpen: boolean;
  openSettings: (tab?: SettingsTabId, focus?: SettingsFocus) => void;
  setSettingsOpen: (open: boolean) => void;
  setSettingsTab: (tab: SettingsTabId) => void;
  setPaletteOpen: (open: boolean) => void;
}

/** Window-level UI state: which overlays are open. Data lives in the query cache. */
export const useUi = create<UiState>()((set) => ({
  settingsOpen: false,
  settingsTab: 'general',
  settingsFocus: null,
  paletteOpen: false,
  openSettings: (tab, focus) =>
    set((state) => ({
      settingsOpen: true,
      paletteOpen: false,
      settingsTab: tab ?? state.settingsTab,
      settingsFocus: focus ?? null,
    })),
  setSettingsOpen: (open) =>
    set(open ? { settingsOpen: true } : { settingsOpen: false, settingsFocus: null }),
  setSettingsTab: (tab) => set({ settingsTab: tab, settingsFocus: null }),
  setPaletteOpen: (open) => set({ paletteOpen: open }),
}));
