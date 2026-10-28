import { useEffect, useState } from 'react';
import {
  DEFAULT_STUDENT,
  STUDENT_PRESETS,
  type AppSettings,
  type ConnectionTest,
  type MentorPreset,
} from '@architect/shared';
import { Button, ErrorState, Skeleton } from '@architect/ui';
import { useOllamaStatus, useSecretsStatus, useSettings } from '../api/hooks';
import { mentorName, shortModelName, studentLabel } from '../lib/names';
import { attempt } from '../lib/notify';
import { navigate, paths } from '../lib/router';
import { DoneStep } from '../onboarding/DoneStep';
import { HostedStep } from '../onboarding/HostedStep';
import { mentorFromPreset } from '../onboarding/mentor';
import { MentorStep } from '../onboarding/MentorStep';
import { ModelStep } from '../onboarding/ModelStep';
import { pullPercent } from '../onboarding/pull';
import { SetupShell, type SetupStep } from '../onboarding/SetupShell';
import { useModelPull } from '../onboarding/useModelPull';

/** First run: get the local model, connect a mentor, then open the workspace. */
export function WelcomeScreen() {
  const settings = useSettings();
  if (settings.status === 'success') {
    return <Setup settings={settings.data} update={settings.update} />;
  }
  return (
    <SetupShell step="Agent's model">
      {settings.status === 'error' ? (
        <ErrorState
          title="Couldn't load your settings"
          message={settings.error.message}
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

function Setup({
  settings,
  update,
}: {
  settings: AppSettings;
  update: (patch: Partial<AppSettings>) => Promise<AppSettings>;
}) {
  const [step, setStep] = useState<SetupStep>("Agent's model");
  const [connection, setConnection] = useState<ConnectionTest | null>(null);
  const [finishing, setFinishing] = useState(false);
  const ollama = useOllamaStatus();
  const secrets = useSecretsStatus();

  // Agents always run on the local copy, even when training uses a hosted one.
  const student =
    settings.defaultStudent.runtime === 'ollama'
      ? settings.defaultStudent
      : { ...settings.defaultStudent, runtime: 'ollama' as const, model: DEFAULT_STUDENT.model };
  const model = student.model;
  const preset = STUDENT_PRESETS.find((p) => p.runtime === 'ollama' && p.model === model);
  const pull = useModelPull(model);
  const downloading = pull.state.phase === 'starting' || pull.state.phase === 'pulling';
  const modelReady =
    pull.state.phase === 'done' || ollama.data?.models.some((m) => m.name === model) === true;

  const { reload: reloadOllama } = ollama;
  useEffect(() => {
    if (pull.state.phase === 'done') reloadOllama();
  }, [pull.state.phase, reloadOllama]);

  const mentor = settings.defaultMentor;
  const keySaved =
    mentor.kind === 'model' &&
    mentor.secretRef !== undefined &&
    secrets.data?.[mentor.secretRef] === true;

  const chooseMentor = (chosen: MentorPreset) =>
    void attempt("Couldn't save that mentor", () =>
      update({ defaultMentor: mentorFromPreset(chosen, mentor) }),
    );

  const finish = async () => {
    setFinishing(true);
    const saved = await attempt("Couldn't finish setup", () => update({ onboarded: true }));
    setFinishing(false);
    if (saved) navigate(paths.home(), { replace: true });
  };

  const spacer = <div className="flex-1" />;

  if (step === "Agent's model") {
    return (
      <SetupShell
        step={step}
        footer={
          <>
            {spacer}
            {!modelReady && !downloading && (
              <Button variant="ghost" onClick={() => setStep('Mentor')}>
                Download later
              </Button>
            )}
            <Button
              variant="primary"
              disabled={!modelReady && !downloading}
              onClick={() => setStep('Mentor')}
            >
              Continue
            </Button>
          </>
        }
      >
        <ModelStep
          label={studentLabel(student)}
          note={preset?.note}
          ollama={ollama}
          pull={pull.state}
          onDownload={() => void pull.start()}
          ready={modelReady}
        />
      </SetupShell>
    );
  }

  if (step === 'Mentor') {
    return (
      <SetupShell
        step={step}
        footer={
          <>
            <Button onClick={() => setStep("Agent's model")}>Back</Button>
            {spacer}
            {!keySaved && (
              <Button variant="ghost" onClick={() => setStep('Faster training')}>
                Skip for now
              </Button>
            )}
            <Button
              variant="primary"
              disabled={!keySaved}
              onClick={() => setStep('Faster training')}
            >
              Continue
            </Button>
          </>
        }
      >
        <MentorStep
          mentor={mentor}
          onChoose={chooseMentor}
          secrets={secrets}
          result={connection}
          onResult={setConnection}
        />
      </SetupShell>
    );
  }

  if (step === 'Faster training') {
    return (
      <SetupShell
        step={step}
        footer={
          <>
            <Button onClick={() => setStep('Mentor')}>Back</Button>
            {spacer}
            <Button variant="ghost" onClick={() => setStep('Done')}>
              Skip
            </Button>
            <Button variant="primary" onClick={() => setStep('Done')}>
              Continue
            </Button>
          </>
        }
      >
        <HostedStep student={shortModelName(studentLabel(student))} />
      </SetupShell>
    );
  }

  return (
    <SetupShell
      step={step}
      footer={
        <>
          <Button onClick={() => setStep('Faster training')}>Back</Button>
          {spacer}
          <Button variant="primary" loading={finishing} onClick={() => void finish()}>
            Get started
          </Button>
        </>
      }
    >
      <DoneStep
        mentor={{
          name: mentorName(mentor),
          label: mentor.label,
          state: connection?.ok ? 'connected' : keySaved ? 'saved' : 'missing',
        }}
        student={{
          name: shortModelName(studentLabel(student)),
          model,
          state: modelReady ? 'ready' : downloading ? 'downloading' : 'missing',
        }}
        percent={pullPercent(pull.state)}
      />
    </SetupShell>
  );
}
