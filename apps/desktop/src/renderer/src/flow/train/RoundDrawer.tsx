import type { ReactNode } from 'react';
import type { FileDiff, Job, LineageEntry, Round } from '@architect/shared';
import { cn, DrawerContent, ErrorState, Skeleton } from '@architect/ui';
import { flowApi } from '../../api/client';
import { useQuery } from '../../api/query';
import { formatRange, formatRate, signed } from '../format';
import { typeLabel } from '../names';
import { countChanges, parseUnifiedDiff, type DiffLine } from './diff';
import type { ModelNames } from './phase';

const STATUS_TEXT: Record<Round['status'], string> = {
  attempting: 'Working through practice tasks',
  diagnosing: 'Being diagnosed',
  evaluating: 'Being checked',
  decided: 'Decided',
  failed: 'Failed',
};

const FILE_STATUS: Record<FileDiff['status'], string> = {
  added: 'New',
  modified: 'Changed',
  deleted: 'Removed',
};

function decisionText(round: Round): string {
  if (round.decision === 'kept') return 'Kept';
  if (round.decision === 'reverted') return 'Reverted';
  return STATUS_TEXT[round.status];
}

/** One round in full: the diagnosis, the files it changed, and what the change did. */
export function RoundDrawerContent({
  runId,
  round,
  job,
  lineage,
  names,
}: {
  runId: string;
  round: Round;
  job: Job;
  lineage: LineageEntry | undefined;
  names: ModelNames;
}) {
  const title = `Round ${round.index}${round.title ? `: ${round.title}` : ''}`;
  const measured =
    round.devBefore && round.devAfter ? round.devAfter.pass - round.devBefore.pass : null;
  return (
    <DrawerContent title={title} subtitle={decisionText(round)}>
      <div className="flex flex-col gap-7">
        {round.decisionReason && (
          <div
            className={cn(
              'rounded-xl border px-4 py-3.5 text-pretty',
              round.decision === 'kept'
                ? 'border-student-tile-line bg-student-tile'
                : 'border-line-card bg-well text-fg-secondary',
            )}
          >
            {round.decisionReason}
          </div>
        )}
        {round.error && (
          <ErrorState layout="inline" title="This round failed" message={round.error} />
        )}

        <dl className="m-0 grid grid-cols-2 gap-px overflow-hidden rounded-xl border border-line-card bg-line-card">
          <Effect label="Expected">
            {round.predicted
              ? formatRange(round.predicted.devDeltaMin, round.predicted.devDeltaMax)
              : '–'}
          </Effect>
          <Effect
            label="Measured"
            note={
              round.devBefore && round.devAfter
                ? `${formatRate(round.devBefore)} → ${formatRate(round.devAfter)}`
                : undefined
            }
          >
            {measured === null ? '–' : signed(measured)}
          </Effect>
        </dl>
        <p className="-mt-4 text-sm text-fg-muted">
          Change in check tasks right, out of {round.devAfter?.total ?? job.splits.dev}.
        </p>

        {round.diagnosis && (
          <Block title={`${names.mentor}'s diagnosis`} tone="mentor">
            <p className="m-0 whitespace-pre-wrap text-md text-fg-soft text-pretty">
              {round.diagnosis}
            </p>
            {round.predicted?.rationale && (
              <p className="m-0 text-fg-secondary text-pretty">{round.predicted.rationale}</p>
            )}
          </Block>
        )}

        {lineage && lineage.measured.perType.length > 0 && (
          <Block title="By task type">
            <ul className="m-0 flex list-none flex-col p-0">
              {lineage.measured.perType.map((type) => (
                <li
                  key={type.type}
                  className="flex items-baseline justify-between border-t border-line-row py-2 first:border-t-0"
                >
                  <span>{typeLabel(job, type.type)}</span>
                  <span className="font-mono text-sm tabular-nums">
                    {type.before} → {type.after}
                  </span>
                </li>
              ))}
            </ul>
          </Block>
        )}

        <Block title="Files changed">
          <RoundFiles runId={runId} round={round} />
        </Block>
      </div>
    </DrawerContent>
  );
}

function Effect({ label, note, children }: { label: string; note?: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1 bg-modal px-4 py-3.5">
      <dt className="text-fg-secondary">{label}</dt>
      <dd className="m-0 font-mono text-2xl tabular-nums">{children}</dd>
      {note && <dd className="m-0 font-mono text-sm text-fg-muted">{note}</dd>}
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

function FilePatch({ file }: { file: FileDiff }) {
  const lines = parseUnifiedDiff(file.patch);
  const { added, removed } = countChanges(lines);
  return (
    <article
      aria-label={`${FILE_STATUS[file.status]} ${file.path}`}
      className="overflow-hidden rounded-xl border border-line-card"
    >
      <header className="flex items-center gap-3 border-b border-line-card bg-well px-3.5 py-2.5">
        <span className="min-w-0 flex-1 truncate font-mono text-sm">{file.path}</span>
        <span className="shrink-0 text-xs text-fg-muted">{FILE_STATUS[file.status]}</span>
        <span className="shrink-0 font-mono text-xs tabular-nums">
          <span className="text-student">+{added}</span>{' '}
          <span className="text-danger">{signed(-removed)}</span>
        </span>
      </header>
      <div className="max-h-80 overflow-auto">
        <table className="w-full border-collapse font-mono text-xs leading-5">
          <tbody>
            {lines.map((line, index) => (
              <DiffRow key={index} line={line} />
            ))}
          </tbody>
        </table>
      </div>
    </article>
  );
}

const LINE_TONE: Record<DiffLine['kind'], string> = {
  added: 'bg-student-tint',
  removed: 'bg-danger-tint',
  context: '',
  hunk: 'bg-well text-fg-muted',
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
  const numbered = line.kind !== 'hunk' && line.kind !== 'note';
  return (
    <tr className={LINE_TONE[line.kind]}>
      <td className="w-10 select-none px-2 text-right align-top text-fg-ghost">
        {numbered ? (line.oldLine ?? '') : ''}
      </td>
      <td className="w-10 select-none px-2 text-right align-top text-fg-ghost">
        {numbered ? (line.newLine ?? '') : ''}
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
      <td className="whitespace-pre-wrap break-words pr-3 align-top">
        {line.kind === 'added' && <span className="sr-only">Added: </span>}
        {line.kind === 'removed' && <span className="sr-only">Removed: </span>}
        {line.text}
      </td>
    </tr>
  );
}
