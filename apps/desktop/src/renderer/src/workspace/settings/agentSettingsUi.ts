import { create } from 'zustand';

export type AgentSettingsTab = 'general' | 'permissions' | 'teaching' | 'report' | 'export';

interface AgentSettingsUi {
  /** The agent whose settings show. It stays set while the modal animates closed. */
  graduateId: string | null;
  open: boolean;
  tab: AgentSettingsTab;
  /** The General tab's model picker is open, as a fix that needs another model opens it. */
  choosingModel: boolean;
  /** Opens an agent's settings, on its General tab unless another is named. */
  show: (graduateId: string, tab?: AgentSettingsTab) => void;
  /** Opens an agent's settings on General with its model picker open. */
  chooseModel: (graduateId: string) => void;
  setChoosingModel: (open: boolean) => void;
  close: () => void;
  setTab: (tab: AgentSettingsTab) => void;
}

export const useAgentSettingsUi = create<AgentSettingsUi>()((set) => ({
  graduateId: null,
  open: false,
  tab: 'general',
  choosingModel: false,
  show: (graduateId, tab = 'general') =>
    set({ graduateId, open: true, tab, choosingModel: false }),
  chooseModel: (graduateId) =>
    set({ graduateId, open: true, tab: 'general', choosingModel: true }),
  setChoosingModel: (choosingModel) => set({ choosingModel }),
  close: () => set({ open: false, choosingModel: false }),
  setTab: (tab) => set({ tab, choosingModel: false }),
}));
