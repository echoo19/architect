import { useEffect } from 'react';
import { Toaster, TooltipProvider } from '@architect/ui';
import { useSettings } from '../api/hooks';
import { ImportScreen } from '../import/ImportScreen';
import { navigate, paths, useRoute, type Route } from '../lib/router';
import { ChatScreen } from '../screens/ChatScreen';
import { DefineScreen } from '../screens/DefineScreen';
import { DescribeScreen } from '../screens/DescribeScreen';
import { HomeScreen } from '../screens/HomeScreen';
import { ImprovementScreen } from '../screens/ImprovementScreen';
import { NotFoundScreen } from '../screens/NotFoundScreen';
import { ReportScreen } from '../screens/ReportScreen';
import { TrainScreen } from '../screens/TrainScreen';
import { WelcomeScreen } from '../screens/WelcomeScreen';
import { SettingsModal } from '../settings/SettingsModal';
import { CommandMenu } from '../shell/CommandMenu';
import { WorkspaceShell } from '../shell/WorkspaceShell';
import { ErrorBoundary } from './ErrorBoundary';
import { useThemeSync } from './theme';
import { useGlobalShortcuts } from './useGlobalShortcuts';

function Screen({ route }: { route: Route }) {
  switch (route.name) {
    case 'home':
      return (
        <WorkspaceShell route={route}>
          <HomeScreen />
        </WorkspaceShell>
      );
    case 'chat':
      return (
        <WorkspaceShell route={route}>
          <ChatScreen key={route.chatId} graduateId={route.graduateId} chatId={route.chatId} />
        </WorkspaceShell>
      );
    case 'welcome':
      return <WelcomeScreen />;
    case 'new':
      return <DescribeScreen />;
    case 'import':
      return <ImportScreen />;
    case 'define':
      return <DefineScreen key={route.jobId} jobId={route.jobId} />;
    case 'train':
      return <TrainScreen key={route.runId} runId={route.runId} />;
    case 'report':
      return <ReportScreen key={route.runId} runId={route.runId} />;
    case 'improvement':
      return <ImprovementScreen key={route.runId} runId={route.runId} />;
    case 'not-found':
      return <NotFoundScreen path={route.path} />;
  }
}

/** Sends a first run to the welcome screen until setup is finished. */
function useFirstRunRedirect(route: Route): void {
  const settings = useSettings();
  const needsSetup = settings.status === 'success' && !settings.data.onboarded;
  useEffect(() => {
    if (needsSetup && route.name === 'home') navigate(paths.welcome(), { replace: true });
  }, [needsSetup, route.name]);
}

export function App() {
  const route = useRoute();
  useThemeSync();
  useGlobalShortcuts();
  useFirstRunRedirect(route);

  return (
    <TooltipProvider>
      <ErrorBoundary>
        <Screen route={route} />
        <SettingsModal />
        <CommandMenu />
      </ErrorBoundary>
      <Toaster />
    </TooltipProvider>
  );
}
