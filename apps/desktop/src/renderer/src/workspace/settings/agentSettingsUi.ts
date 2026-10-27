import { create } from 'zustand';

export type AgentSettingsTab = 'general' | 'permissions' | 'report' | 'export';

interface AgentSettingsUi {
  /** The agent whose settings show. It stays set while the modal animates closed. */
  graduateId: string | null;
  open: boolean;
  tab: AgentSettingsTab;
  show: (graduateId: string) => void;
  close: () => void;
  setTab: (tab: AgentSettingsTab) => void;
}

export const useAgentSettingsUi = create<AgentSettingsUi>()((set) => ({
  graduateId: null,
  open: false,
  tab: 'general',
  show: (graduateId) => set({ graduateId, open: true, tab: 'general' }),
  close: () => set({ open: false }),
  setTab: (tab) => set({ tab }),
}));
