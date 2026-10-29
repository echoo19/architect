import { Skeleton } from '@architect/ui';
import { useSettings } from '../api/hooks';
import { ProblemState } from '../components/ProblemState';
import { Setup } from '../onboarding/Setup';
import { SetupShell } from '../onboarding/SetupShell';

/** First run: get the local model, connect a teacher, then open the workspace. */
export function WelcomeScreen() {
  const settings = useSettings();
  if (settings.status === 'success') {
    return <Setup settings={settings.data} update={settings.update} />;
  }
  return (
    <SetupShell step="Model">
      {settings.status === 'error' ? (
        <ProblemState
          error={settings.error}
          title="Couldn't load your settings"
          onRetry={settings.reload}
        />
      ) : (
        <div
          aria-busy="true"
          aria-label="Loading"
          className="flex w-full max-w-[620px] flex-col items-center gap-4"
        >
          <Skeleton className="h-10 w-80" />
          <Skeleton className="h-4 w-[460px] max-w-full" />
          <Skeleton className="mt-5 h-[124px] w-full rounded-6xl" />
        </div>
      )}
    </SetupShell>
  );
}
