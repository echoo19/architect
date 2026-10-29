import { useEffect, useRef, useState } from 'react';
import {
  DEFAULT_STUDENT,
  GLIMMER_BUILDS,
  recommendedBuild,
  type AppSettings,
  type ConnectionTest,
} from '@architect/shared';
import { Button } from '@architect/ui';
import { Download } from 'lucide-react';
import { api } from '../api/client';
import { queryKeys, useLocalRuntimes, useSecretsStatus } from '../api/hooks';
import { fetchQuery } from '../api/query';
import { formatBytes } from '../lib/format';
import { mentorName, studentName } from '../lib/names';
import { attempt } from '../lib/notify';
import { navigate, paths } from '../lib/router';
import { useConnections } from '../settings/models/hooks';
import { isInstalled } from '../settings/models/StudentRows';
import { DoneStep } from './DoneStep';
import { HostedStep } from './HostedStep';
import { routeOf, type MentorRoute } from './mentor';
import { MentorStep } from './MentorStep';
import { ModelStep } from './ModelStep';
import { pullPercent } from './pull';
import { SetupShell, type SetupStep } from './SetupShell';
import { useModelPull } from './useModelPull';

export interface SetupProps {
  settings: AppSettings;
  update: (patch: Partial<AppSettings>) => Promise<AppSettings>;
}

/** First run: the agent's model, a teacher, optionally an online copy, then the workspace. */
export function Setup({ settings, update }: SetupProps) {
  const [step, setStep] = useState<SetupStep>('Model');
  const [connection, setConnection] = useState<ConnectionTest | null>(null);
  const [route, setRoute] = useState<MentorRoute>(() => routeOf(settings.defaultMentor));
  const [finishing, setFinishing] = useState(false);
  const local = useLocalRuntimes();
  const secrets = useSecretsStatus();
  const { connections } = useConnections();

  const student = settings.defaultStudent;
  const ollama = local.data?.ollama;
  const pull = useModelPull(student.model);
  const downloading = pull.state.phase === 'starting' || pull.state.phase === 'pulling';
  // A model on another local server was picked from that server's own list.
  const modelReady =
    pull.state.phase === 'done' ||
    student.runtime !== 'ollama' ||
    isInstalled(ollama, student.model);

  // Until the user picks, the Glimmer build suggested for this computer's GPU is the choice,
  // unless the default build is already downloaded.
  const recommended = useRef(false);
  useEffect(() => {
    if (!local.data || recommended.current) return;
    recommended.current = true;
    const best = recommendedBuild(local.data.gpu);
    const untouched =
      student.model === DEFAULT_STUDENT.model && !isInstalled(local.data.ollama, student.model);
    if (untouched && best.model !== student.model) {
      void attempt("Couldn't choose the agent's model", () =>
        update({ defaultStudent: { ...student, model: best.model } }),
      );
    }
  }, [local.data, student, update]);

  const download = async () => {
    if (await pull.start()) await fetchQuery(queryKeys.local, api.localRuntimes);
  };
  const build = GLIMMER_BUILDS.find((candidate) => candidate.model === student.model);
  const names = { mentor: mentorName(settings.defaultMentor), student: studentName(student) };

  const mentor = settings.defaultMentor;
  const mentorReady =
    mentor.kind === 'model' &&
    (mentor.secretRef === undefined || secrets.data?.[mentor.secretRef] === true);
  // Continue needs a mentor from the way that is selected, not one left from another way.
  const mentorUsable = mentorReady && route === routeOf(mentor);
  const keyless = mentor.kind === 'model' && mentor.secretRef === undefined;

  const finish = async () => {
    setFinishing(true);
    const saved = await attempt("Couldn't finish setup", () => update({ onboarded: true }));
    setFinishing(false);
    if (saved) navigate(paths.home(), { replace: true });
  };

  const spacer = <div className="flex-1" />;
  const hostedConnected = connections.some((connection) => connection.provider === 'openrouter');

  if (step === 'Model') {
    return (
      <SetupShell
        step={step}
        footer={
          <>
            {spacer}
            {modelReady || downloading ? (
              <Button variant="primary" onClick={() => setStep('Teacher')}>
                Continue
              </Button>
            ) : (
              <>
                <Button variant="ghost" onClick={() => setStep('Teacher')}>
                  Download later
                </Button>
                <Button
                  variant="primary"
                  disabled={ollama?.running !== true}
                  onClick={() => void download()}
                >
                  <Download size={15} strokeWidth={1.8} aria-hidden />
                  {pull.state.phase === 'failed'
                    ? 'Try again'
                    : build
                      ? `Download ${names.student} · ${formatBytes(build.downloadBytes)}`
                      : `Download ${names.student}`}
                </Button>
              </>
            )}
          </>
        }
      >
        <ModelStep
          student={student}
          names={names}
          local={local}
          pull={pull.state}
          onChoose={(next) =>
            void attempt("Couldn't choose the agent's model", () =>
              update({ defaultStudent: next }),
            )
          }
        />
      </SetupShell>
    );
  }

  if (step === 'Teacher') {
    return (
      <SetupShell
        step={step}
        footer={
          <>
            <Button onClick={() => setStep('Model')}>Back</Button>
            {spacer}
            {mentorUsable ? (
              <Button variant="primary" onClick={() => setStep('Faster training')}>
                Continue
              </Button>
            ) : (
              <>
                <span className="max-w-[360px] text-right text-sm text-fg-muted text-pretty">
                  You can connect one later in Settings. Until then, Architect can&apos;t train new
                  agents.
                </span>
                <Button onClick={() => setStep('Faster training')}>Skip for now</Button>
              </>
            )}
          </>
        }
      >
        <MentorStep
          mentor={mentor}
          route={route}
          onRoute={setRoute}
          onMentor={(next) =>
            void attempt("Couldn't save that teacher", () => update({ defaultMentor: next }))
          }
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
            <Button onClick={() => setStep('Teacher')}>Back</Button>
            {spacer}
            {hostedConnected ? (
              <Button variant="primary" onClick={() => setStep('Done')}>
                Continue
              </Button>
            ) : (
              <Button onClick={() => setStep('Done')}>Skip</Button>
            )}
          </>
        }
      >
        <HostedStep student={names.student} connected={hostedConnected} />
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
          name: names.mentor,
          state: connection?.ok
            ? 'connected'
            : !mentorReady
              ? 'missing'
              : keyless
                ? 'ready'
                : 'saved',
        }}
        student={{
          name: names.student,
          state: modelReady ? 'ready' : downloading ? 'downloading' : 'missing',
        }}
        percent={pullPercent(pull.state)}
      />
    </SetupShell>
  );
}
