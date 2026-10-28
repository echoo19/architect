import type { ComponentType } from 'react';
import type { GraduateSummary } from '@architect/shared';
import { AgentAvatar, SettingsDialog, type SettingsTab } from '@architect/ui';
import { useShallow } from 'zustand/react/shallow';
import { useGraduates } from '../../api/hooks';
import type { Route } from '../../lib/router';
import { useAgentSettingsUi, type AgentSettingsTab } from './agentSettingsUi';
import { ExportTab } from './ExportTab';
import { ReportTab } from './ReportTab';
import { GeneralTab, PermissionsTab } from './tabs';
import { TeachingTab } from './TeachingTab';

interface TabPanelProps {
  agent: GraduateSummary;
  route: Route;
}

/** The tabs in order, each with what it shows. A new tab is one more entry here. */
const TABS: readonly (SettingsTab<AgentSettingsTab> & { Panel: ComponentType<TabPanelProps> })[] = [
  { value: 'general', label: 'General', Panel: GeneralTab },
  { value: 'permissions', label: 'Permissions', Panel: PermissionsTab },
  { value: 'teaching', label: 'Teaching', Panel: TeachingTab },
  { value: 'report', label: 'Report', Panel: ReportTab },
  { value: 'export', label: 'Export', Panel: ExportTab },
];

/** One agent's settings, opened from its row in the sidebar. */
export function AgentSettingsModal({ route }: { route: Route }) {
  const { graduateId, open, tab, close, setTab } = useAgentSettingsUi(
    useShallow((state) => ({
      graduateId: state.graduateId,
      open: state.open,
      tab: state.tab,
      close: state.close,
      setTab: state.setTab,
    })),
  );
  const graduates = useGraduates();
  const agent = graduates.data?.find((graduate) => graduate.id === graduateId);
  const Panel = (TABS.find((entry) => entry.value === tab) ?? TABS[0])?.Panel;

  return (
    <SettingsDialog
      open={open && agent !== undefined}
      onOpenChange={(next) => {
        if (!next) close();
      }}
      title={agent?.name ?? 'Agent'}
      icon={agent && <AgentAvatar name={agent.name} size="md" />}
      tabs={TABS}
      tab={tab}
      onTabChange={setTab}
    >
      {agent && Panel && <Panel key={agent.id} agent={agent} route={route} />}
    </SettingsDialog>
  );
}
