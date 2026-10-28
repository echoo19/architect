import type { ReactNode } from 'react';
import type {
  Category,
  Experiment,
  FileDiff,
  Finding,
  Intervention,
  Job,
  LineageEntry,
  ListedLesson,
  Round,
  Score,
} from '@architect/shared';
import { cn, DrawerContent, DrawerSection, ErrorState, Skeleton, Spinner } from '@architect/ui';
import { FilePen } from 'lucide-react';
import { flowApi } from '../../api/client';
import { useQuery } from '../../api/query';
import { formatRange, formatRate, signed } from '../format';
import { typeLabel } from '../names';
import { decisionSentence, harmSentence, predictionCheck } from './decision';
import { PatchLines } from '../../components/PatchLines';
import { countChanges, parseUnifiedDiff } from './diff';
import { DISPOSITIONS, FIRST_DRAFT, INTERVENTIONS, sentence } from './evidence-words';
import {
  CheckTasks,
  ExperimentDetails,
  Findings,
  Gates,
  InterventionLine,
  RoundCost,
  RoundExamples,
} from './ExperimentSections';
import type { ModelNames } from './phase';

const STATUS_TEXT: Record<Round['status'], string> = {
  attempting: 'Working through practice tasks',
  diagnosing: 'Waiting for the diagnosis',
  teaching: 'Checking corrections of the failures',
  training: 'Training weights on the corrections',
  clarifying: 'Waiting for your answer',
  evaluating: 'Scoring the change on the check tasks',
  decided: 'Decided',
  failed: 'Failed',
};

const FILE_STATUS: Record<FileDiff['status'], string> = {
  added: 'added',
  modified: 'changed',
  deleted: 'removed',
};

function lines(count: number): string {
  return `${count} ${count === 1 ? 'line' : 'lines'}`;
}

/** What the drawer is about: the intervention's type, and how many files the change touched. */
function subtitleOf(
  mentor: string,
  lineage: LineageEntry | undefined,
  intervention: Intervention | undefined,
  draft: boolean,
): ReactNode {
  const { label, icon: Icon } = draft
    ? FIRST_DRAFT
    : intervention
      ? INTERVENTIONS[intervention.type]
      : FIRST_DRAFT;
  const count = lineage?.files.length ?? 0;
  const files =
    count === 0 ? null : `${mentor} changed ${count === 1 ? 'one file' : `${count} files`}`;
  if (!draft && !intervention) return files ?? `${mentor}'s change`;
  return (
    <span className="inline-flex flex-wrap items-center gap-x-2">
      <span className="inline-flex items-center gap-1.5">
        <Icon size={13} strokeWidth={1.8} aria-hidden className="text-mentor" />
        {label}
      </span>
      {files && (
        <>
          <span aria-hidden>·</span>
          <span>{files}</span>
        </>
      )}
    </span>
  );
}

/** A round's records from mentoring, as the drawer reads them. */
export interface RoundEvidence {
  experiment: Experiment | undefined;
  intervention: Intervention | undefined;
  lessons: readonly ListedLesson[];
  categories: readonly Category[];
}

/**
 * One round in full: how it ended and why, what Spark found and chose, the examples it verified,
 * the check tasks the change was measured on, the gates, what it cost, and the files it changed.
 */
export function RoundDrawerContent({
  runId,
  round,
  draft,
  job,
  lineage,
  names,
  evidence,
  onOpenLesson,
  onOpenFinding,
  onBack,
}: {
  runId: string;
  round: Round;
  /** The round wrote the first full draft rather than one watched change. */
  draft: boolean;
  job: Job;
  lineage: LineageEntry | undefined;
  names: ModelNames;
  /** The round's mentoring records; an error when they couldn't be read. */
  evidence:
    | { status: 'loading' }
    | { status: 'error'; error: Error; reload: () => void }
    | {
        status: 'success';
        data: RoundEvidence;
      };
  onOpenLesson: (lesson: ListedLesson) => void;
  onOpenFinding: (finding: Finding) => void;
  onBack?: (() => void) | undefined;
}) {
  const title = `Round ${round.index}${round.title ? `: ${round.title}` : ''}`;
  const records = evidence.status === 'success' ? evidence.data : null;
  const experiment = records?.experiment;
  const intervention = records?.intervention;
  const measured =
    round.devBefore && round.devAfter ? round.devAfter.pass - round.devBefore.pass : null;
  // The prediction is for one measurement, so a change measured twice is set beside its first.
  const first = round.firstMeasurement;
  const firstMeasured = first ? first.devAfter.pass - first.devBefore.pass : measured;
  const second =
    first && round.devBefore && round.devAfter ? secondMeasurement(first, round) : null;
  // A round refused or cut short keeps its prediction on the intervention alone.
  const predicted = round.predicted ?? intervention?.predicted;
  const unmeasured = experiment?.disposition === 'invalid' || experiment?.disposition === 'stopped';
  return (
    <DrawerContent
      title={title}
      onBack={onBack}
      subtitle={subtitleOf(names.mentor, lineage, intervention, draft)}
    >
      <div className="flex flex-col gap-7">
        {draft ? (
          <DraftDecision round={round} names={names} />
        ) : (
          <Decision round={round} job={job} lineage={lineage} experiment={experiment} />
        )}
        {round.error && experiment === undefined && (
          <ErrorState layout="inline" title="This round failed" message={round.error} />
        )}

        <dl className="m-0 grid grid-cols-2 gap-px overflow-hidden rounded-xl border border-line-card bg-line-card">
          <Effect
            label={`${names.mentor} expected`}
            note={
              predicted && firstMeasured !== null && !unmeasured
                ? predictionCheck(predicted, firstMeasured)
                : undefined
            }
            /* Measured twice, the prediction heads both measurements on a row of its own. */
            wide={second !== null}
          >
            {predicted ? (
              <>
                {formatRange(predicted.devDeltaMin, predicted.devDeltaMax)}
                <Unit>check tasks</Unit>
              </>
            ) : (
              '–'
            )}
          </Effect>
          <Effect
            label={first ? 'First measurement' : 'Measured'}
            note={rateChange(first ?? round)}
          >
            {unmeasured ? (
              <span className="font-sans text-md text-fg-muted">Not measured</span>
            ) : (
              <TaskCount delta={firstMeasured} />
            )}
          </Effect>
          {second && (
            <Effect label="Measured again" note={rateChange(second)}>
              <TaskCount delta={second.devAfter.pass - second.devBefore.pass} />
            </Effect>
          )}
        </dl>

        {(round.diagnosis || intervention) && (
          <DrawerSection
            title={draft ? `What ${names.mentor} set out to do` : `${names.mentor}'s diagnosis`}
            tone="mentor"
          >
            {round.diagnosis && (
              <p className="m-0 whitespace-pre-wrap text-md text-fg-soft text-pretty">
                {round.diagnosis}
              </p>
            )}
            {predicted?.rationale && (
              <p className="m-0 text-fg-secondary text-pretty">
                Why it expected that: {predicted.rationale}
              </p>
            )}
            {intervention && !draft && <InterventionLine intervention={intervention} />}
          </DrawerSection>
        )}

        {evidence.status === 'loading' && (
          <div
            aria-busy="true"
            aria-label="Loading the round's records"
            className="flex flex-col gap-2"
          >
            <Skeleton className="h-4 w-32" />
            <Skeleton className="h-24 w-full" />
          </div>
        )}
        {evidence.status === 'error' && (
          <ErrorState
            layout="inline"
            title="Couldn't load the rest of this round"
            message={evidence.error.message}
            onRetry={evidence.reload}
          />
        )}
        {records && intervention && (
          <Findings
            intervention={intervention}
            job={job}
            categories={records.categories}
            names={names}
            onOpenAttempt={onOpenFinding}
          />
        )}
        {records && (
          <RoundExamples
            lessons={records.lessons}
            intervention={intervention}
            job={job}
            onOpen={onOpenLesson}
          />
        )}
        {experiment && experiment.measurements.length > 0 ? (
          <CheckTasks experiment={experiment} job={job} names={names} />
        ) : (
          // A round from before experiments has only its lineage; one whose records failed to
          // load shows the error above, not a coarser table in their place.
          records &&
          lineage &&
          lineage.measured.perType.length > 0 && (
            <ByTaskType lineage={lineage} job={job} twice={first !== undefined} />
          )
        )}
        {experiment && <Gates experiment={experiment} />}
        {experiment && <RoundCost experiment={experiment} names={names} />}

        <DrawerSection title={draft ? 'Files written' : 'Files changed'}>
          <RoundFiles runId={runId} round={round} />
        </DrawerSection>
        {experiment && <ExperimentDetails experiment={experiment} intervention={intervention} />}
      </div>
    </DrawerContent>
  );
}

/** Per task type, the change in check-task passes, for a round recorded before experiments. */
function ByTaskType({ lineage, job, twice }: { lineage: LineageEntry; job: Job; twice: boolean }) {
  return (
    <DrawerSection title={twice ? 'By task type, over both measurements' : 'By task type'}>
      <ul className="m-0 flex list-none flex-col p-0">
        {lineage.measured.perType.map((type) => (
          <li
            key={type.type}
            className="flex items-baseline justify-between border-t border-line-row py-2 first:border-t-0"
          >
            <span>{typeLabel(job, type.type)}</span>
            <span className="text-sm text-fg-secondary">
              <span className="font-mono tabular-nums text-fg">
                {signed(type.after - type.before)}
              </span>{' '}
              {Math.abs(type.after - type.before) === 1 ? 'task' : 'tasks'}
            </span>
          </li>
        ))}
      </ul>
    </DrawerSection>
  );
}

/** A first draft is kept as the starting point, without a keep check (decision 026). */
function DraftDecision({ round, names }: { round: Round; names: ModelNames }) {
  if (!round.decision) {
    return (
      <div className="flex items-center gap-3 rounded-xl border border-line-card bg-well px-4 py-3.5">
        {round.status !== 'failed' && <Spinner tone="mentor" size={16} />}
        <span className="text-xl font-medium">
          {round.status === 'evaluating'
            ? 'Scoring the first draft on the check tasks'
            : 'Writing the first draft'}
        </span>
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-1.5 rounded-xl border border-student-tile-line bg-student-tile px-4 py-3.5">
      <span className="flex items-center gap-2.5 text-2xl font-medium text-student">
        <FilePen size={20} strokeWidth={2} aria-hidden />
        First draft
      </span>
      <p className="m-0 text-md text-fg-soft text-pretty">
        {names.mentor} wrote it from the job and its example tasks, before watching {names.student}{' '}
        work. It is the starting point; later rounds keep only measured gains.
      </p>
    </div>
  );
}

/**
 * How the round ended, big and plain, with the reason in a sentence: kept or reverted on the
 * scores and the job's rules; rejected for harm or a failed gate; invalid or stopped with the
 * runner's own reason.
 */
function dispositionReason(
  experiment: Experiment | undefined,
  round: Round,
  lineage: LineageEntry | undefined,
  job: Job,
): string | null {
  const scores = decisionSentence(round, lineage, job);
  if (!experiment) return scores;
  switch (experiment.disposition) {
    case 'kept':
    case 'reverted':
      return scores ?? sentence(experiment.reason);
    case 'rejected': {
      const failed = experiment.gates.find((gate) => !gate.passed);
      if (!failed) return harmSentence(experiment, job) ?? sentence(experiment.reason);
      const gate = sentence(failed.detail);
      return scores ? `${scores} But ${gate.charAt(0).toLowerCase()}${gate.slice(1)}` : gate;
    }
    // Neither kind was measured: an invalid change was never made, a stopped one never taken.
    case 'invalid':
      return `${sentence(experiment.reason)} Nothing changed.`;
    case 'stopped':
      return `${sentence(experiment.reason)} It isn't in the agent.`;
  }
}

function Decision({
  round,
  job,
  lineage,
  experiment,
}: {
  round: Round;
  job: Job;
  lineage: LineageEntry | undefined;
  experiment: Experiment | undefined;
}) {
  const disposition = experiment?.disposition ?? round.decision;
  const reason = dispositionReason(experiment, round, lineage, job);
  if (!disposition || !reason) {
    return (
      <div className="flex items-center gap-3 rounded-xl border border-line-card bg-well px-4 py-3.5">
        {round.status !== 'failed' && <Spinner tone="mentor" size={16} />}
        <span className="text-xl font-medium">{STATUS_TEXT[round.status]}</span>
      </div>
    );
  }
  const { label, icon: Icon, tone } = DISPOSITIONS[disposition];
  return (
    <div
      className={cn(
        'flex flex-col gap-1.5 rounded-xl border px-4 py-3.5',
        disposition === 'kept'
          ? 'border-student-tile-line bg-student-tile'
          : disposition === 'rejected'
            ? 'border-danger-line bg-danger-tint'
            : 'border-line-card bg-well',
      )}
    >
      <span
        className={cn(
          'flex items-center gap-2.5 text-2xl font-medium',
          disposition === 'kept' || disposition === 'rejected' ? tone : 'text-fg-secondary',
        )}
      >
        <Icon size={20} strokeWidth={2} aria-hidden />
        {label}
      </span>
      <p className="m-0 text-md text-fg-soft text-pretty">{reason}</p>
    </div>
  );
}

function Unit({ children }: { children: ReactNode }) {
  return <span className="ml-2 font-sans text-md text-fg-secondary">{children}</span>;
}

/** The second measurement alone: both measurements added up, less the first. */
function secondMeasurement(
  first: NonNullable<Round['firstMeasurement']>,
  both: { devBefore?: Score; devAfter?: Score },
): { devBefore: Score; devAfter: Score } | null {
  if (!both.devBefore || !both.devAfter) return null;
  const less = (total: Score, part: Score) => ({
    pass: total.pass - part.pass,
    total: total.total - part.total,
  });
  return {
    devBefore: less(both.devBefore, first.devBefore),
    devAfter: less(both.devAfter, first.devAfter),
  };
}

/** "58% → 78%": rates, since one measurement and two add up to different totals. */
function rateChange({ devBefore, devAfter }: { devBefore?: Score; devAfter?: Score }) {
  if (!devBefore || !devAfter) return undefined;
  return `${formatRate(devBefore)} → ${formatRate(devAfter)}`;
}

/** "+8 check tasks", or a dash before there is a measurement. */
function TaskCount({ delta }: { delta: number | null }) {
  if (delta === null) return <>–</>;
  return (
    <>
      {signed(delta)}
      <Unit>check {Math.abs(delta) === 1 ? 'task' : 'tasks'}</Unit>
    </>
  );
}

function Effect({
  label,
  note,
  wide = false,
  children,
}: {
  label: string;
  note?: string | undefined;
  /** Spans the grid's row. */
  wide?: boolean;
  children: ReactNode;
}) {
  return (
    <div className={cn('flex flex-col gap-1 bg-modal px-4 py-3.5', wide && 'col-span-2')}>
      <dt className="text-fg-secondary">{label}</dt>
      <dd className="m-0 font-mono text-2xl tabular-nums">{children}</dd>
      {note && <dd className="m-0 text-sm text-fg-muted">{note}</dd>}
    </div>
  );
}

function RoundFiles({ runId, round }: { runId: string; round: Round }) {
  // A round's change can still be written while it runs, so its status is part of the key.
  const diff = useQuery(`round-diff:${runId}:${round.index}:${round.status}`, () =>
    flowApi.roundDiff(runId, round.index),
  );
  if (diff.status === 'loading') {
    return (
      <div aria-busy="true" aria-label="Loading the changes" className="flex flex-col gap-2">
        <Skeleton className="h-9 w-full" />
        <Skeleton className="h-28 w-full" />
      </div>
    );
  }
  if (diff.status === 'error') {
    return (
      <ErrorState
        layout="inline"
        title="Couldn't load the changes"
        message={diff.error.message}
        onRetry={diff.reload}
      />
    );
  }
  if (diff.data.length === 0) {
    return <p className="m-0 text-fg-secondary">No files changed in this round.</p>;
  }
  return (
    <div className="flex flex-col gap-3">
      {diff.data.map((file) => (
        <FilePatch key={file.path} file={file} />
      ))}
    </div>
  );
}

/** One file's change: its name and what happened to it, then every line, with + and − marks. */
function FilePatch({ file }: { file: FileDiff }) {
  const { added, removed } = countChanges(parseUnifiedDiff(file.patch));
  return (
    <article
      aria-label={`${file.path}, ${FILE_STATUS[file.status]}`}
      className="overflow-hidden rounded-xl border border-line-card"
    >
      <header className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5 border-b border-line-card bg-well px-3.5 py-2.5">
        <span className="min-w-0 break-all font-mono text-sm">{file.path}</span>
        <span className="text-sm text-fg-secondary">{FILE_STATUS[file.status]}</span>
        <span className="ml-auto text-sm text-fg-muted">
          <span className="text-student">{lines(added)} added</span>,{' '}
          <span className="text-danger">{removed} removed</span>
        </span>
      </header>
      <PatchLines patch={file.patch} />
    </article>
  );
}
