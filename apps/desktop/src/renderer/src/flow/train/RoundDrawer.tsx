import type { ReactNode } from 'react';
import type {
  Category,
  Experiment,
  ExperimentDisposition,
  FileDiff,
  Finding,
  Intervention,
  Job,
  LineageEntry,
  ListedLesson,
  Round,
  Score,
} from '@architect/shared';
import {
  cn,
  Disclosure,
  DrawerContent,
  DrawerSection,
  ErrorState,
  Skeleton,
  Spinner,
} from '@architect/ui';
import { FilePen } from 'lucide-react';
import { flowApi } from '../../api/client';
import { useQuery } from '../../api/query';
import { ProblemState } from '../../components/ProblemState';
import { formatRange, formatRate, signed } from '../format';
import { modelNames, typeLabel } from '../names';
import { decisionSentence, harmSentence, predictionCheck, refusalSentence } from './decision';
import { PatchLines } from '../../components/PatchLines';
import { changeSummary, countChanges, parseUnifiedDiff } from './diff';
import {
  checkMeasurements,
  DISPOSITIONS,
  FIRST_DRAFT,
  INTERVENTIONS,
  sentence,
} from './evidence-words';
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
import { answerEffect } from './questions';

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
  runEnded,
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
  /** The run is over, so a question it never had answered stays unanswered. */
  runEnded: boolean;
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
  // A question tries no change, so there is nothing to measure, no file to show and no gate to pass.
  const question = intervention?.type === 'clarification' ? intervention : undefined;
  return (
    <DrawerContent
      title={title}
      onBack={onBack}
      subtitle={subtitleOf(names.mentor, lineage, intervention, draft)}
    >
      <div className="flex flex-col gap-7">
        {draft ? (
          <DraftDecision round={round} names={names} />
        ) : question && experiment === undefined && round.status !== 'failed' ? (
          <QuestionDecision round={round} question={question} names={names} runEnded={runEnded} />
        ) : (
          <Decision
            round={round}
            job={job}
            lineage={lineage}
            experiment={experiment}
            intervention={intervention}
          />
        )}
        {round.error && experiment === undefined && (
          <ErrorState layout="inline" title="This round failed" message={round.error} />
        )}

        {question === undefined && (
          <DrawerSection title="Gain on check tasks">
            <dl className="m-0 grid grid-flow-col auto-cols-fr divide-x divide-line">
              <Effect
                label={`${names.mentor} expected`}
                note={
                  predicted && firstMeasured !== null && !unmeasured
                    ? predictionCheck(predicted, firstMeasured)
                    : undefined
                }
              >
                {predicted ? formatRange(predicted.devDeltaMin, predicted.devDeltaMax) : '–'}
              </Effect>
              <Effect
                label={first ? 'First measurement' : 'Measured'}
                note={rateChange(first ?? round)}
              >
                {unmeasured ? (
                  <span className="font-sans text-body">Not measured</span>
                ) : firstMeasured === null ? (
                  '–'
                ) : (
                  signed(firstMeasured)
                )}
              </Effect>
              {second && (
                <Effect label="Measured again" note={rateChange(second)}>
                  {signed(second.devAfter.pass - second.devBefore.pass)}
                </Effect>
              )}
            </dl>
          </DrawerSection>
        )}

        {(round.diagnosis || intervention) && (
          <DrawerSection
            title={draft ? `What ${names.mentor} set out to do` : `${names.mentor}'s diagnosis`}
            tone="mentor"
          >
            {round.diagnosis && (
              <p className="m-0 whitespace-pre-wrap text-body text-fg text-pretty">
                {round.diagnosis}
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
          <ProblemState
            layout="inline"
            error={evidence.error}
            title="Couldn't load this round's findings, examples, check tasks and costs"
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
        {experiment && checkMeasurements(experiment).length > 0 ? (
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

        {question === undefined && (
          <DrawerSection title={filesTitle(draft, experiment?.disposition)}>
            <RoundFiles
              runId={runId}
              round={round}
              // Trained weights change no files, so only a change to the setup says why it has none.
              disposition={intervention?.type === 'weights' ? undefined : experiment?.disposition}
            />
          </DrawerSection>
        )}
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
            className="flex items-baseline justify-between border-t border-line py-2 first:border-t-0"
          >
            <span>{typeLabel(job, type.type)}</span>
            <span className="text-small text-fg">
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
      <div className="flex items-center gap-3 rounded-control bg-field px-4 py-3.5 shadow-edge">
        {round.status !== 'failed' && <Spinner tone="mentor" size={16} />}
        <span className="font-display text-h2 font-semibold">
          {round.status === 'evaluating'
            ? 'Scoring the first draft on the check tasks'
            : 'Writing the first draft'}
        </span>
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-1.5 rounded-control bg-student-soft px-4 py-3.5">
      <span className="flex items-center gap-2.5 font-display text-h2 font-semibold text-student">
        <FilePen size={20} strokeWidth={2} aria-hidden />
        First draft
      </span>
      <p className="m-0 text-body text-fg text-pretty">
        {names.mentor} wrote it from the job and its example tasks, before watching {names.student}{' '}
        work. It is the starting point; later rounds keep only measured gains.
      </p>
    </div>
  );
}

/**
 * A round that asked a question: waiting for the person's answer, or answered, with what the
 * mentor did with it. A question tries no change, so it is neither kept nor undone.
 */
function QuestionDecision({
  round,
  question,
  names,
  runEnded,
}: {
  round: Round;
  question: Intervention;
  names: ModelNames;
  runEnded: boolean;
}) {
  const { icon: Icon } = INTERVENTIONS.clarification;
  const { answer } = question;
  const waiting = round.status === 'clarifying' && !runEnded;
  return (
    <div className="flex flex-col gap-1.5 rounded-control bg-field px-4 py-3.5 shadow-edge">
      <span className="flex items-center gap-2.5 font-display text-h2 font-semibold text-fg">
        <Icon size={20} strokeWidth={2} aria-hidden />
        {answer ? 'Answered' : waiting ? 'Waiting for your answer' : 'Not answered'}
      </span>
      {answer ? (
        <p className="m-0 text-body text-fg text-pretty">
          You answered: {answer.text} {answerEffect(question, names)}
        </p>
      ) : (
        <p className="m-0 text-body text-fg text-pretty">
          {names.mentor} asked: {question.question}{' '}
          {waiting
            ? 'Close this and answer it in the current round.'
            : 'Training ended before you answered.'}
        </p>
      )}
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
  intervention: Intervention | undefined,
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
    case 'invalid': {
      // A kind of change the person turned off is theirs to be told of, whatever else refused it.
      const theirs = refusalSentence(intervention, job);
      if (theirs !== null) return theirs;
      // Retraining the model is the one change a run can ask for that this computer can't make.
      const { mentor, student } = modelNames(job);
      return experiment.kind === 'weights'
        ? `${mentor} wanted to retrain ${student}'s model, which this computer can't do. Nothing changed.`
        : `${sentence(experiment.reason)} Nothing changed.`;
    }
    case 'stopped':
      return `${sentence(experiment.reason)} It isn't in the agent.`;
  }
}

function Decision({
  round,
  job,
  lineage,
  experiment,
  intervention,
}: {
  round: Round;
  job: Job;
  lineage: LineageEntry | undefined;
  experiment: Experiment | undefined;
  intervention: Intervention | undefined;
}) {
  const disposition = experiment?.disposition ?? round.decision;
  const reason = dispositionReason(experiment, intervention, round, lineage, job);
  if (!disposition || !reason) {
    return (
      <div className="flex items-center gap-3 rounded-control bg-field px-4 py-3.5 shadow-edge">
        {round.status !== 'failed' && <Spinner tone="mentor" size={16} />}
        <span className="font-display text-h2 font-semibold">{STATUS_TEXT[round.status]}</span>
      </div>
    );
  }
  const { headline, icon: Icon, tone } = DISPOSITIONS[disposition];
  return (
    <div
      className={cn(
        'flex flex-col gap-1.5 rounded-control px-4 py-3.5',
        disposition === 'kept'
          ? 'bg-student-soft'
          : disposition === 'rejected'
            ? 'bg-danger-soft'
            : 'bg-field',
      )}
    >
      <span
        className={cn(
          'flex items-center gap-2.5 font-display text-h2 font-semibold',
          disposition === 'kept' || disposition === 'rejected' ? tone : 'text-fg',
        )}
      >
        <Icon size={20} strokeWidth={2} aria-hidden />
        {headline}
      </span>
      <p className="m-0 text-body text-fg text-pretty">{reason}</p>
    </div>
  );
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

function Effect({
  label,
  note,
  children,
}: {
  label: string;
  note?: string | undefined;
  children: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1 px-4 first:pl-0">
      <dt>{label}</dt>
      <dd className="m-0 font-display text-h2 font-semibold tabular-nums">{children}</dd>
      {note && <dd className="m-0 text-small">{note}</dd>}
    </div>
  );
}

/** A change that was undone took its files with it, so its heading says so. */
function filesTitle(draft: boolean, disposition: ExperimentDisposition | undefined): string {
  if (draft) return 'What was written';
  return disposition === 'reverted' || disposition === 'rejected'
    ? 'What changed, then was undone'
    : 'What changed';
}

/** Why a round that ended before its change was made has no files to show. */
const NO_FILES: Partial<Record<ExperimentDisposition, string>> = {
  invalid: 'Nothing changed: the change was refused before it was made.',
  stopped: 'Nothing changed: training stopped before the change was written.',
};

function RoundFiles({
  runId,
  round,
  disposition,
}: {
  runId: string;
  round: Round;
  disposition: ExperimentDisposition | undefined;
}) {
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
      <ProblemState
        layout="inline"
        error={diff.error}
        title="Couldn't load the changes"
        onRetry={diff.reload}
      />
    );
  }
  if (diff.data.length === 0) {
    return (
      <p className="m-0 text-fg">
        {(disposition && NO_FILES[disposition]) ?? 'Nothing changed in this round.'}
      </p>
    );
  }
  // The patches are for whoever wants every line; the summary says what was touched.
  return (
    <div className="flex flex-col gap-2">
      <p className="m-0 text-body text-fg text-pretty">{sentence(changeSummary(diff.data))}</p>
      <Disclosure label="Details">
        <div className="flex flex-col gap-3">
          {diff.data.map((file) => (
            <FilePatch key={file.path} file={file} />
          ))}
        </div>
      </Disclosure>
    </div>
  );
}

/** One file's change: its name and what happened to it, then every line, with + and − marks. */
function FilePatch({ file }: { file: FileDiff }) {
  const { added, removed } = countChanges(parseUnifiedDiff(file.patch));
  return (
    <article
      aria-label={`${file.path}, ${FILE_STATUS[file.status]}`}
      className="overflow-hidden rounded-control shadow-edge"
    >
      <header className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5 border-b border-line bg-field px-3.5 py-2.5">
        <span className="min-w-0 break-all font-mono text-small">{file.path}</span>
        <span className="text-small text-fg">{FILE_STATUS[file.status]}</span>
        <span className="ml-auto text-small text-fg">
          <span className="text-student">{lines(added)} added</span>,{' '}
          <span className="text-danger">{removed} removed</span>
        </span>
      </header>
      <PatchLines patch={file.patch} />
    </article>
  );
}
