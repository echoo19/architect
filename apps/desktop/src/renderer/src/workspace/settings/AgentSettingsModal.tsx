import { AgentAvatar, SettingsDialog, type SettingsTab } from '@architect/ui';
import { useShallow } from 'zustand/react/shallow';
import { useGraduates } from '../../api/hooks';
import type { Route } from '../../lib/router';
import { useAgentSettingsUi, type AgentSettingsTab } from './agentSettingsUi';
import { ReportTab } from './ReportTab';
import { ExportTab, GeneralTab, PermissionsTab } from './tabs';

const TABS: readonly SettingsTab<AgentSettingsTab>[] = [
  { value: 'general', label: 'General' },
  { value: 'permissions', label: 'Permissions' },
  { value: 'report', label: 'Report' },
  { value: 'export', label: 'Export' },
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
      {agent && tab === 'general' && <GeneralTab agent={agent} route={route} />}
      {agent && tab === 'permissions' && <PermissionsTab agent={agent} />}
      {agent && tab === 'report' && <ReportTab agent={agent} />}
      {agent && tab === 'export' && <ExportTab agent={agent} />}
    </SettingsDialog>
  );
}
