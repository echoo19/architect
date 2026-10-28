import { create } from 'zustand';

export type AgentSettingsTab = 'general' | 'permissions' | 'teaching' | 'report' | 'export';

interface AgentSettingsUi {
  /** The agent whose settings show. It stays set while the modal animates closed. */
  graduateId: string | null;
  open: boolean;
  tab: AgentSettingsTab;
  /** Opens an agent's settings, on its General tab unless another is named. */
  show: (graduateId: string, tab?: AgentSettingsTab) => void;
  close: () => void;
  setTab: (tab: AgentSettingsTab) => void;
}

export const useAgentSettingsUi = create<AgentSettingsUi>()((set) => ({
  graduateId: null,
  open: false,
  tab: 'general',
  show: (graduateId, tab = 'general') => set({ graduateId, open: true, tab }),
  close: () => set({ open: false }),
  setTab: (tab) => set({ tab }),
}));
