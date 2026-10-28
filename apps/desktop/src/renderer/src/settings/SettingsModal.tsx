import type { AppSettings } from '@architect/shared';
import { ErrorState, SettingsDialog, Skeleton, type SettingsTab } from '@architect/ui';
import { useShallow } from 'zustand/react/shallow';
import { useSettings } from '../api/hooks';
import { attempt } from '../lib/notify';
import { useUi, type SettingsTabId } from '../state/ui';
import { ModelsTab } from './models/ModelsTab';
import { AboutTab, GeneralTab, PrivacyTab, StorageTab, TrainingTab } from './tabs';

const TABS: readonly SettingsTab<SettingsTabId>[] = [
  { value: 'general', label: 'General' },
  { value: 'models', label: 'Models' },
  { value: 'training', label: 'Training' },
  { value: 'privacy', label: 'Privacy' },
  { value: 'storage', label: 'Storage' },
  { value: 'about', label: 'About' },
];

export function SettingsModal() {
  const { open, tab, setOpen, setTab } = useUi(
    useShallow((state) => ({
      open: state.settingsOpen,
      tab: state.settingsTab,
      setOpen: state.setSettingsOpen,
      setTab: state.setSettingsTab,
    })),
  );
  return (
    <SettingsDialog
      open={open}
      onOpenChange={setOpen}
      title="Settings"
      tabs={TABS}
      tab={tab}
      onTabChange={setTab}
    >
      <TabContent tab={tab} />
    </SettingsDialog>
  );
}

export interface TabProps {
  settings: AppSettings;
  update: (patch: Partial<AppSettings>) => void;
}

function TabContent({ tab }: { tab: SettingsTabId }) {
  const settings = useSettings();
  if (settings.status === 'loading') {
    return (
      <div aria-busy="true" aria-label="Loading settings">
        {[0, 1, 2].map((row) => (
          <div
            key={row}
            className="flex min-h-[60px] items-center justify-between border-t border-line"
          >
            <Skeleton className="h-3.5 w-36" />
            <Skeleton shape="pill" className="h-[30px] w-40" />
          </div>
        ))}
      </div>
    );
  }
  if (settings.status === 'error') {
    return (
      <ErrorState
        title="Couldn't load your settings"
        message={settings.error.message}
        onRetry={settings.reload}
        className="py-16"
      />
    );
  }

  const props: TabProps = {
    settings: settings.data,
    update: (patch) => void attempt("Couldn't save that setting", () => settings.update(patch)),
  };
  switch (tab) {
    case 'general':
      return <GeneralTab {...props} />;
    case 'models':
      return <ModelsTab {...props} />;
    case 'training':
      return <TrainingTab {...props} />;
    case 'privacy':
      return <PrivacyTab {...props} />;
    case 'storage':
      return <StorageTab />;
    case 'about':
      return <AboutTab />;
  }
}
