import { useEffect, type ReactNode } from 'react';
import {
  type WspComputeId,
  type WspComputeTarget,
  type WspLimits,
  type WspMentorStatus,
  type WspWorkerStatus,
} from '@architect/shared';
import {
  Button,
  ChoiceTiles,
  DetailList,
  Disclosure,
  Heading,
  Panel,
  Segmented,
  Skeleton,
  Spinner,
  StatusMark,
} from '@architect/ui';
import { Bot } from 'lucide-react';
import { useSecretsStatus } from '../api/hooks';
import { useWspComputeTargets, useWspMentor, useWspWorker, wspApi, wspKeys } from '../api/wsp';
import { setQueryData } from '../api/query';
import { ProblemState } from '../components/ProblemState';
import { NumberRow } from '../experiments/NumberRow';
import { formatCost } from '../flow/format';
import { attempt } from '../lib/notify';
import { useUi } from '../state/ui';
import { mentorName, minutesText } from './model';
import { COMPUTE_ICONS, StepBody } from './parts';

export type Effort = WspMentorStatus['mentor']['reasoningEffort'];

/** The efforts the mentor's adapter can send. */
const EFFORTS = [
  { value: 'low', label: 'Low' },
  { value: 'medium', label: 'Medium' },
  { value: 'high', label: 'High' },
] as const satisfies readonly { value: Effort; label: string }[];

/** One line of a status card: a mark, what it is, its state, and the one thing to do about it. */
function StatusLine({
  icon,
  title,
  state,
  detail,
  action,
}: {
  icon: ReactNode;
  title: string;
  state: ReactNode;
  detail?: string | undefined;
  action?: ReactNode;
}) {
  return (
    <div className="flex min-h-14 flex-wrap items-center gap-3 border-t border-line px-6 py-2.5 text-ui first:border-t-0">
      <span className="flex size-6 shrink-0 items-center justify-center">{icon}</span>
      <span className="flex min-w-32 flex-1 flex-col gap-0.5">
        <span className="font-medium">{title}</span>
        {detail && <span className="text-small">{detail}</span>}
      </span>
      <span className="ml-auto flex items-center gap-3">
        {state}
        {action}
      </span>
    </div>
  );
}

function WorkerLine({ worker }: { worker: WspWorkerStatus }) {
  const setUp = async () => {
    const next = await attempt("Couldn't set up the worker", wspApi.setupWorker);
    if (next) setQueryData(wspKeys.worker, next);
  };
  const words = {
    ready: 'Ready',
    'needs-setup': 'Needs setup',
    'setting-up': 'Setting up',
    unavailable: 'Unavailable',
  } as const;
  return (
    <StatusLine
      icon={
        worker.status === 'setting-up' ? (
          <Spinner size={16} label="Setting up" />
        ) : (
          <StatusMark
            state={
              worker.status === 'ready'
                ? 'ok'
                : worker.status === 'unavailable'
                  ? 'blocked'
                  : 'attention'
            }
          />
        )
      }
      title="Worker"
      detail={worker.reason ?? (worker.python ? `Python ${worker.python}` : undefined)}
      state={words[worker.status]}
      action={
        worker.status === 'needs-setup' && (
          <Button size="sm" onClick={() => void setUp()}>
            Set up
          </Button>
        )
      }
    />
  );
}

function MentorLine({ mentor }: { mentor: WspMentorStatus }) {
  const openSettings = useUi((state) => state.openSettings);
  return (
    <StatusLine
      icon={
        mentor.status === 'ready' ? (
          <Bot size={16} strokeWidth={1.8} aria-hidden className="text-mentor" />
        ) : (
          <StatusMark state="attention" />
        )
      }
      title={mentorName(mentor.mentor)}
      detail={
        mentor.mentor.standIn
          ? 'A scripted mentor for trying the app: nothing it finds is a result'
          : mentor.reason
      }
      state={mentor.status === 'ready' ? 'Ready' : 'Needs a key'}
      action={
        mentor.status === 'missing-key' && (
          <Button size="sm" onClick={() => openSettings('models')}>
            Add a key
          </Button>
        )
      }
    />
  );
}

/** "16 threads, 32 GB", for this computer. */
function machine(target: WspComputeTarget): string | undefined {
  const parts = [
    target.threads === undefined ? null : `${target.threads} threads`,
    target.memoryGb === undefined ? null : `${Math.round(target.memoryGb)} GB`,
  ].filter((part): part is string => part !== null);
  if (target.status === 'needs-setup') return 'Needs setup';
  return parts.length > 0 ? parts.join(', ') : undefined;
}

export interface ComputeForm {
  compute: WspComputeId;
  limits: WspLimits;
  /** Null until the person picks one: the mentor's own. */
  effort: Effort | null;
}

/**
 * Step three: where it runs, the worker there, the mentor, and the hard caps. The caps take their
 * defaults; every one is under Advanced.
 */
export function ComputeStep({
  form,
  onChange,
  onProblem,
}: {
  form: ComputeForm;
  onChange: (form: ComputeForm) => void;
  onProblem: (row: string, problem: string | null) => void;
}) {
  const targets = useWspComputeTargets();
  const worker = useWspWorker();
  const mentor = useWspMentor();
  const secrets = useSecretsStatus();
  // A key saved in Settings reaches the mentor's status at once.
  const { reload: reloadMentor } = mentor;
  useEffect(() => {
    if (secrets.data) reloadMentor();
  }, [secrets.data, reloadMentor]);

  const limits = form.limits;
  const setLimit = <K extends keyof WspLimits>(key: K, value: WspLimits[K] | undefined) => {
    if (value !== undefined) onChange({ ...form, limits: { ...limits, [key]: value } });
  };

  return (
    <StepBody title="Where it runs, and its limits">
      <section aria-label="Compute" className="flex flex-col gap-3">
        <Heading as="h2" size="title">
          Compute
        </Heading>
        {targets.data ? (
          <ChoiceTiles
            aria-label="Compute"
            columns={3}
            value={form.compute}
            onValueChange={(compute) => onChange({ ...form, compute })}
            options={targets.data.map((target) => {
              const Icon = COMPUTE_ICONS[target.id];
              const description = machine(target);
              return {
                value: target.id,
                label: target.label,
                icon: <Icon size={16} strokeWidth={1.8} aria-hidden />,
                ...(description === undefined ? {} : { description }),
                ...(target.status === 'unsupported'
                  ? { disabled: true, tip: target.reason ?? 'Not supported yet' }
                  : {}),
              };
            })}
          />
        ) : targets.status === 'error' ? (
          <ProblemState
            error={targets.error}
            title="Couldn't read where experiments can run"
            onRetry={targets.reload}
          />
        ) : (
          <Skeleton className="h-40 rounded-card" />
        )}
      </section>

      <Panel aria-label="Readiness">
        {worker.data ? (
          <WorkerLine worker={worker.data} />
        ) : worker.status === 'error' ? (
          <ProblemState
            layout="inline"
            error={worker.error}
            title="Couldn't check the worker"
            onRetry={worker.reload}
            className="px-6 py-4"
          />
        ) : (
          <Skeleton className="m-6 h-5 w-64" />
        )}
        {mentor.data ? (
          <MentorLine mentor={mentor.data} />
        ) : mentor.status === 'error' ? (
          <ProblemState
            layout="inline"
            error={mentor.error}
            title="Couldn't check the mentor"
            onRetry={mentor.reload}
            className="border-t border-line px-6 py-4"
          />
        ) : (
          <Skeleton className="m-6 h-5 w-64" />
        )}
      </Panel>

      <section aria-label="Limits" className="flex flex-col gap-3">
        <Heading as="h2" size="title">
          Limits
        </Heading>
        <Panel padded className="gap-4">
          <DetailList
            valueFont="text"
            items={[
              { label: 'Programs', value: limits.programs },
              { label: 'Forward passes', value: limits.forwardPasses },
              { label: 'Wall time', value: minutesText(limits.wallMinutes) },
              { label: 'Mentor spend', value: `Up to ${formatCost(limits.mentorUsd)}` },
            ]}
          />
          <Disclosure label="Advanced">
            <div className="flex max-w-[480px] flex-col">
              <NumberRow
                label="Programs"
                value={limits.programs}
                integer
                min={1}
                max={60}
                onChange={(value) => setLimit('programs', value)}
                onProblem={onProblem}
              />
              <NumberRow
                label="Forward passes"
                value={limits.forwardPasses}
                integer
                min={2}
                max={400}
                onChange={(value) => setLimit('forwardPasses', value)}
                onProblem={onProblem}
              />
              <NumberRow
                label="Wall time"
                unit="min"
                value={limits.wallMinutes}
                min={1}
                max={1440}
                onChange={(value) => setLimit('wallMinutes', value)}
                onProblem={onProblem}
              />
              <NumberRow
                label="Mentor spend"
                unit="USD"
                value={limits.mentorUsd}
                max={500}
                onChange={(value) => setLimit('mentorUsd', value)}
                onProblem={onProblem}
              />
              <NumberRow
                label="Seconds per program"
                unit="s"
                value={limits.programSeconds}
                integer
                min={5}
                max={3600}
                onChange={(value) => setLimit('programSeconds', value)}
                onProblem={onProblem}
              />
              <NumberRow
                label="Most of the weights changed"
                unit="%"
                value={Number((limits.maxChangedFraction * 100).toPrecision(6))}
                min={0.001}
                max={10}
                onChange={(value) =>
                  setLimit('maxChangedFraction', value === undefined ? undefined : value / 100)
                }
                onProblem={onProblem}
              />
              <NumberRow
                label="Worker memory"
                unit="GB"
                value={limits.memoryGb}
                min={1}
                max={512}
                onChange={(value) => setLimit('memoryGb', value)}
                onProblem={onProblem}
              />
              <div className="flex min-h-11 items-center gap-3 text-ui">
                <span className="min-w-0 flex-1 truncate font-medium">Reasoning effort</span>
                <Segmented
                  aria-label="Reasoning effort"
                  options={EFFORTS}
                  value={form.effort ?? 'high'}
                  onValueChange={(effort) => onChange({ ...form, effort })}
                />
              </div>
            </div>
          </Disclosure>
        </Panel>
      </section>
    </StepBody>
  );
}

/** Why the brief can't be drafted yet, or null when it can. */
export function computeHeld(
  target: WspComputeTarget | undefined,
  worker: WspWorkerStatus | undefined,
  mentor: WspMentorStatus | undefined,
  limitsBroken: boolean,
): string | null {
  if (!target || !worker || !mentor) return 'Checking this computer';
  if (target.status !== 'ready' && target.status !== 'needs-setup') return 'Choose where it runs';
  if (worker.status === 'setting-up') return 'The worker is being set up';
  if (worker.status !== 'ready') return 'Set up the worker first';
  if (mentor.status !== 'ready') return `Add a key for ${mentorName(mentor.mentor)}`;
  if (limitsBroken) return 'Fix the limits under Advanced';
  return null;
}
