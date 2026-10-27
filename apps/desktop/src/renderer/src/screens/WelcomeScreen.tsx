import { useState } from 'react';
import type { AppSettings } from '@architect/shared';
import { Button, ErrorState, Heading, LogoMark, Panel, SettingsRow, Skeleton } from '@architect/ui';
import { useOllamaStatus, useSecretsStatus, useSettings } from '../api/hooks';
import { errorOf, QueryValue } from '../components/QueryValue';
import { mentorName, studentLabel, studentName } from '../lib/names';
import { attempt } from '../lib/notify';
import { currentPlatform, deviceInSentence } from '../lib/platform';
import { navigate, paths } from '../lib/router';
import { useUi } from '../state/ui';

/** First run: what Architect does, and whether this machine is ready for it. */
export function WelcomeScreen() {
  const settings = useSettings();
  return (
    <div className="flex h-full flex-col bg-ground-flow bg-dot-grid">
      <div className="app-drag h-14 shrink-0" />
      <main className="flex min-h-0 flex-1 flex-col items-center overflow-y-auto px-6 pb-16">
        <div className="my-auto flex w-full max-w-[560px] flex-col items-center gap-10 py-6">
          {settings.status === 'loading' && <WelcomeSkeleton />}
          {settings.status === 'error' && (
            <ErrorState
              title="Couldn't load your settings"
              message={settings.error.message}
              onRetry={settings.reload}
            />
          )}
          {settings.status === 'success' && (
            <Welcome settings={settings.data} update={settings.update} />
          )}
        </div>
      </main>
    </div>
  );
}

function WelcomeSkeleton() {
  return (
    <div aria-busy="true" aria-label="Loading" className="flex w-full flex-col items-center gap-5">
      <Skeleton className="size-[52px] rounded-2xl" />
      <Skeleton className="h-12 w-72" />
      <Skeleton className="h-4 w-96" />
      <Skeleton className="mt-6 h-56 w-full rounded-6xl" />
    </div>
  );
}

function Welcome({
  settings,
  update,
}: {
  settings: AppSettings;
  update: (patch: Partial<AppSettings>) => Promise<AppSettings>;
}) {
  const ollama = useOllamaStatus();
  const secrets = useSecretsStatus();
  const openSettings = useUi((state) => state.openSettings);
  const [finishing, setFinishing] = useState(false);
  const mentor = settings.defaultMentor;
  const student = settings.defaultStudent;

  const finish = async () => {
    setFinishing(true);
    const saved = await attempt("Couldn't finish setup", () => update({ onboarded: true }));
    setFinishing(false);
    if (saved) navigate(paths.home(), { replace: true });
  };

  return (
    <>
      <div className="flex flex-col items-center gap-5 text-center">
        <LogoMark size={52} />
        <Heading as="h1" size="hero">
          Architect
        </Heading>
        <p className="m-0 max-w-[440px] text-xl text-fg-secondary text-balance">
          Describe a job. {mentorName(mentor)} teaches {studentName(student)} to do it. The agent
          runs on {deviceInSentence(currentPlatform())}.
        </p>
      </div>

      <Panel aria-label="Setup" className="w-full px-7 py-1 [&>*:first-child]:border-t-0">
        <SettingsRow label="Local model runtime" meta="Ollama" error={errorOf(ollama)}>
          <QueryValue query={ollama}>
            {(status) => (status.running ? 'Running' : 'Not running')}
          </QueryValue>
        </SettingsRow>
        <SettingsRow label={studentLabel(student)} meta={student.model} error={errorOf(ollama)}>
          <QueryValue query={ollama}>
            {(status) =>
              status.models.some((model) => model.name === student.model)
                ? 'Downloaded'
                : 'Not downloaded'
            }
          </QueryValue>
        </SettingsRow>
        {mentor.kind === 'model' && (
          <SettingsRow label={`${mentor.label} key`} meta={mentor.baseUrl} error={errorOf(secrets)}>
            <QueryValue query={secrets}>
              {(stored) => (stored[mentor.secretRef] ? 'Saved' : 'Not set')}
            </QueryValue>
          </SettingsRow>
        )}
      </Panel>

      <div className="flex gap-2">
        <Button onClick={() => openSettings('models')}>Settings</Button>
        <Button variant="primary" loading={finishing} onClick={finish}>
          Get started
        </Button>
      </div>
    </>
  );
}
