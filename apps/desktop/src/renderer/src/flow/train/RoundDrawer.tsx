import type { ReactNode } from 'react';
import type { FileDiff, Job, LineageEntry, Round, Score } from '@architect/shared';
import { cn, DrawerContent, ErrorState, Skeleton, Spinner } from '@architect/ui';
import { Check, FilePen, Undo2 } from 'lucide-react';
import { flowApi } from '../../api/client';
import { useQuery } from '../../api/query';
import { formatRange, formatRate, signed } from '../format';
import { typeLabel } from '../names';
import { decisionSentence, predictionCheck } from './decision';
import { countChanges, parseUnifiedDiff, type DiffLine } from './diff';
import type { ModelNames } from './phase';

const STATUS_TEXT: Record<Round['status'], string> = {
  attempting: 'Working through practice tasks',
  diagnosing: 'Waiting for the diagnosis',
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

/** What the drawer is about: the mentor's one change, and how many files it touched. */
function changeSummary(mentor: string, lineage: LineageEntry | undefined): string {
  const count = lineage?.files.length ?? 0;
  if (count === 0) return `${mentor}'s change to the agent's instructions`;
  const files = count === 1 ? 'one file' : `${count} files`;
  return `${mentor} changed ${files} of the agent's instructions`;
}

/** One round in full: the decision, the diagnosis, and the files the change touched. */
export function RoundDrawerContent({
  runId,
  round,
  draft,
  job,
  lineage,
  names,
}: {
  runId: string;
  round: Round;
  /** The round wrote the first full draft rather than one watched change. */
  draft: boolean;
  job: Job;
  lineage: LineageEntry | undefined;
  names: ModelNames;
}) {
  const title = `Round ${round.index}${round.title ? `: ${round.title}` : ''}`;
  const measured =
    round.devBefore && round.devAfter ? round.devAfter.pass - round.devBefore.pass : null;
  // The prediction is for one check, so a change checked twice is set beside its first check.
  const first = round.firstMeasurement;
  const firstMeasured = first ? first.devAfter.pass - first.devBefore.pass : measured;
  const second = first && round.devBefore && round.devAfter ? secondCheck(first, round) : null;
  const checkSize = first?.devAfter.total ?? job.splits.dev;
  return (
    <DrawerContent
      title={title}
      subtitle={
        draft
          ? `${names.mentor}'s first full draft of the agent's instructions`
          : changeSummary(names.mentor, lineage)
      }
    >
      <div className="flex flex-col gap-7">
        {draft ? (
          <DraftDecision round={round} names={names} />
        ) : (
          <Decision round={round} job={job} lineage={lineage} />
        )}
        {round.error && (
          <ErrorState layout="inline" title="This round failed" message={round.error} />
        )}

        <dl className="m-0 grid grid-cols-2 gap-px overflow-hidden rounded-xl border border-line-card bg-line-card">
          <Effect label={`${names.mentor} expected`}>
            {round.predicted ? (
              <>
                {formatRange(round.predicted.devDeltaMin, round.predicted.devDeltaMax)}
                <Unit>check tasks</Unit>
              </>
            ) : (
              '–'
            )}
          </Effect>
          <Effect
            label={first ? `First check, ${checkSize} tasks` : 'Measured'}
            note={rateChange(first ?? round)}
          >
            <TaskCount delta={firstMeasured} />
          </Effect>
          {second && (
            <>
              <Effect label={`Second check, the same ${checkSize} again`} note={rateChange(second)}>
                <TaskCount delta={second.devAfter.pass - second.devBefore.pass} />
              </Effect>
              <Effect label="Average of the two checks" note={rateChange(round)}>
                <TaskCount delta={measured === null ? null : measured / 2} />
              </Effect>
            </>
          )}
        </dl>
        {round.predicted && firstMeasured !== null && (
          <p className="-mt-4 text-sm text-fg-muted">
            {predictionCheck(
              round.predicted,
              firstMeasured,
              names.mentor,
              first ? 'The first check' : 'The result',
            )}
            {first &&
              ` ${names.student}'s answers vary from run to run, so a promising change is checked twice before it stays.`}
          </p>
        )}

        {round.diagnosis && (
          <Block
            title={draft ? `What ${names.mentor} set out to do` : `${names.mentor}'s diagnosis`}
            tone="mentor"
          >
            <p className="m-0 whitespace-pre-wrap text-md text-fg-soft text-pretty">
              {round.diagnosis}
            </p>
            {round.predicted?.rationale && (
              <p className="m-0 text-fg-secondary text-pretty">
                Why it expected that: {round.predicted.rationale}
              </p>
            )}
          </Block>
        )}

        {lineage && lineage.measured.perType.length > 0 && (
          <Block
            title={
              first
                ? 'Change in check tasks right, by task type, over both checks'
                : 'Change in check tasks right, by task type'
            }
          >
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
          </Block>
        )}

        <Block
          title={
            draft
              ? `The first draft of ${job.name}'s instructions`
              : `What changed in ${job.name}'s instructions`
          }
        >
          <RoundFiles runId={runId} round={round} />
        </Block>
      </div>
    </DrawerContent>
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
        {names.mentor} wrote the agent&apos;s first full setup from the job and its example tasks,
        before watching it work. It is kept as the starting point; later rounds keep only measured
        gains.
      </p>
    </div>
  );
}

/** The keep-or-revert decision, big and plain, with the reason in one sentence. */
function Decision({
  round,
  job,
  lineage,
}: {
  round: Round;
  job: Job;
  lineage: LineageEntry | undefined;
}) {
  const sentence = decisionSentence(round, lineage, job);
  if (!round.decision || !sentence) {
    return (
      <div className="flex items-center gap-3 rounded-xl border border-line-card bg-well px-4 py-3.5">
        {round.status !== 'failed' && <Spinner tone="mentor" size={16} />}
        <span className="text-xl font-medium">{STATUS_TEXT[round.status]}</span>
      </div>
    );
  }
  const kept = round.decision === 'kept';
  return (
    <div
      className={cn(
        'flex flex-col gap-1.5 rounded-xl border px-4 py-3.5',
        kept ? 'border-student-tile-line bg-student-tile' : 'border-line-card bg-well',
      )}
    >
      <span
        className={cn(
          'flex items-center gap-2.5 text-2xl font-medium',
          kept ? 'text-student' : 'text-fg-secondary',
        )}
      >
        {kept ? (
          <Check size={20} strokeWidth={2.2} aria-hidden />
        ) : (
          <Undo2 size={20} strokeWidth={2} aria-hidden />
        )}
        {kept ? 'Kept' : 'Reverted'}
      </span>
      <p className="m-0 text-md text-fg-soft text-pretty">{sentence}</p>
    </div>
  );
}

function Unit({ children }: { children: ReactNode }) {
  return <span className="ml-2 font-sans text-md text-fg-secondary">{children}</span>;
}

/** The second check alone: both checks added up, less the first. */
function secondCheck(
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

/** "58% to 78% of check tasks right": rates, since one check and two add up to different totals. */
function rateChange({ devBefore, devAfter }: { devBefore?: Score; devAfter?: Score }) {
  if (!devBefore || !devAfter) return undefined;
  return `${formatRate(devBefore)} to ${formatRate(devAfter)} of check tasks right`;
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
  children,
}: {
  label: string;
  note?: string | undefined;
  children: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1 bg-modal px-4 py-3.5">
      <dt className="text-fg-secondary">{label}</dt>
      <dd className="m-0 font-mono text-2xl tabular-nums">{children}</dd>
      {note && <dd className="m-0 text-sm text-fg-muted">{note}</dd>}
    </div>
  );
}

function Block({ title, tone, children }: { title: string; tone?: 'mentor'; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-3">
      <h3
        className={cn(
          'm-0 text-sm font-medium',
          tone === 'mentor' ? 'text-mentor' : 'text-fg-secondary',
        )}
      >
        {title}
      </h3>
      {children}
    </section>
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
    return <p className="m-0 text-fg-secondary">No files changed in this round yet.</p>;
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
  const parsed = parseUnifiedDiff(file.patch);
  const { added, removed } = countChanges(parsed);
  // The first hunk starts the file's excerpt; later ones mark lines left out between them.
  const first = parsed.findIndex((line) => line.kind === 'hunk');
  const shown = parsed.filter((_, index) => index !== first);
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
      <table className="w-full border-collapse font-mono text-xs leading-5">
        <tbody>
          {shown.map((line, index) => (
            <DiffRow key={index} line={line} />
          ))}
        </tbody>
      </table>
    </article>
  );
}

const LINE_TONE: Record<DiffLine['kind'], string> = {
  added: 'bg-student-tint',
  removed: 'bg-danger-tint',
  context: '',
  hunk: '',
  note: 'text-fg-muted italic',
};

const MARK: Record<DiffLine['kind'], string> = {
  added: '+',
  removed: '−',
  context: '',
  hunk: '',
  note: '',
};

function DiffRow({ line }: { line: DiffLine }) {
  if (line.kind === 'hunk') {
    return (
      <tr>
        <td
          colSpan={3}
          className="px-3 py-0.5 text-center text-fg-ghost"
          aria-label="Lines skipped"
        >
          ⋯
        </td>
      </tr>
    );
  }
  const number = line.kind === 'removed' ? line.oldLine : line.newLine;
  return (
    <tr className={LINE_TONE[line.kind]}>
      <td className="w-10 select-none px-2 text-right align-top text-fg-ghost">
        {line.kind === 'note' ? '' : (number ?? '')}
      </td>
      <td
        className={cn(
          'w-4 select-none text-center align-top',
          line.kind === 'added' ? 'text-student' : 'text-danger',
        )}
        aria-hidden
      >
        {MARK[line.kind]}
      </td>
      <td className="whitespace-pre-wrap break-words py-px pr-3 align-top">
        {line.kind === 'added' && <span className="sr-only">Added: </span>}
        {line.kind === 'removed' && <span className="sr-only">Removed: </span>}
        {line.text}
      </td>
    </tr>
  );
}
