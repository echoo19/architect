import type { ReactNode } from 'react';
import type { Correction, Improvement, Job, Run, Score } from '@architect/shared';
import { Badge, Heading, Meter, Stat, StatusMark } from '@architect/ui';
import { formatDuration, formatUsd } from '../../lib/format';
import { KindTile } from '../../workspace/teach/kinds';
import { KIND_LABELS, lessonCount } from '../../workspace/teach/lessons';
import { formatRate, percent, rate } from '../format';
import { typeLabel } from '../names';

/** One task type's check-task score before the improvement and with its new version. */
interface TypeChange {
  type: string;
  label: string;
  before: Score;
  after: Score;
}

/** Task types that scored better, and the ones that didn't, from the improvement's own records. */
export function typeChanges(
  improvement: Improvement,
  job: Job,
): { better: TypeChange[]; notBetter: TypeChange[] } {
  const changes = improvement.perType.flatMap(({ type, before, after }) =>
    after === null ? [] : [{ type, label: typeLabel(job, type), before, after }],
  );
  return {
    better: changes.filter((change) => rate(change.after) > rate(change.before)),
    notBetter: changes.filter((change) => rate(change.after) <= rate(change.before)),
  };
}

/** "Up from 85%", "Same as before", "Down from 90%". */
export function fromBefore(before: Score, after: Score): string {
  if (percent(after) > percent(before)) return `Up from ${formatRate(before)}`;
  if (percent(after) < percent(before)) return `Down from ${formatRate(before)}`;
  return 'Same as before';
}

function cents(amount: number): string {
  return formatUsd(Math.round(amount * 100) / 100);
}

interface ImprovementViewProps {
  improvement: Improvement;
  job: Job;
  run: Run;
  /** The lessons it was taught, as far as they are known. */
  lessons: Correction[];
  /** The agent's name. */
  name: string;
  mentor: string;
}

/**
 * What an improvement changed: its new version's score on the check tasks against the version it
 * started from, per task type what got better and what didn't, what it spent, the lessons it was
 * taught, and whether the new version may be used. It never takes the final test, and says so.
 */
export function ImprovementView({
  improvement,
  job,
  run,
  lessons,
  name,
  mentor,
}: ImprovementViewProps) {
  const { dev, candidateVersion, promotion } = improvement;
  const made = candidateVersion !== undefined && dev.after !== null;
  const { better, notBetter } = typeChanges(improvement, job);
  const heading = made
    ? `${name}, version ${candidateVersion}`
    : run.status === 'stopped'
      ? 'Improving stopped'
      : 'No new version';

  return (
    <>
      <div className="flex flex-col gap-3">
        {/* A new version hasn't passed anything yet, so its badge is plain. */}
        <Badge className="self-start">{made ? 'Not in use yet' : 'No new version'}</Badge>
        <Heading as="h1" size="display">
          {heading}
        </Heading>
        <p className="m-0 max-w-[660px] text-body text-fg text-pretty">
          {made
            ? `Scored on the ${job.splits.dev} check tasks against version ${improvement.fromVersion}. It hasn't taken a final test.`
            : `Version ${improvement.fromVersion} stays as it was, and its lessons are back in the queue.`}
        </p>
      </div>

      <div role="status" className="flex items-start gap-3 border-y border-line py-4 text-body">
        <StatusMark state={promotion.allowed ? 'ok' : 'off'} size={18} className="mt-0.5" />
        <div className="flex flex-col gap-0.5">
          <span className="text-fg">
            {promotion.allowed
              ? `You can use version ${candidateVersion}`
              : 'No new version to use'}
          </span>
          <span className="text-fg text-pretty">
            {promotion.allowed
              ? `Version ${improvement.fromVersion} keeps answering until you do, and stays so you can go back to it.`
              : promotion.reason}
          </span>
        </div>
      </div>

      <div className="grid grid-cols-[repeat(auto-fit,minmax(min(180px,100%),1fr))] gap-px overflow-hidden rounded-card bg-line-strong shadow-edge">
        <Stat
          className="bg-card p-[22px]"
          value={dev.after ? formatRate(dev.after) : dev.before ? formatRate(dev.before) : '–'}
          label="right on check tasks"
          note={
            <Lines
              lines={[
                dev.after && `${dev.after.pass} of ${dev.after.total}`,
                dev.before && dev.after && fromBefore(dev.before, dev.after),
                !dev.after && dev.before && `Version ${improvement.fromVersion}'s score`,
              ]}
            />
          }
          noteFont="text"
        />
        <Stat
          className="bg-card p-[22px]"
          value={cents(improvement.spentUsd)}
          label={mentor}
          note={`of ${formatUsd(improvement.budget.maxMentorUsd)}`}
          noteFont="text"
        />
        <Stat
          className="bg-card p-[22px]"
          value={formatDuration(run.totals.wallMs)}
          label="Time"
          note={`of ${formatDuration(job.budget.maxWallMinutes * 60_000)}`}
          noteFont="text"
        />
        <Stat
          className="bg-card p-[22px]"
          value={String(run.totals.rounds)}
          label="Rounds"
          note={`of ${improvement.budget.maxRounds}`}
          noteFont="text"
        />
      </div>

      {made && (
        <div className="grid grid-cols-[repeat(auto-fit,minmax(min(360px,100%),1fr))] gap-x-14 gap-y-10">
          <TypeSection
            title="What improved"
            changes={better}
            empty="No task type scored better."
            tone="student"
          />
          <TypeSection
            title={
              notBetter.every((change) => change.after.pass === change.before.pass)
                ? 'Unchanged'
                : 'Unchanged or worse'
            }
            changes={notBetter}
            empty="Every task type scored better."
            tone="fg"
          />
        </div>
      )}

      {lessons.length > 0 && (
        <section aria-labelledby="lessons" className="flex flex-col gap-3">
          <Heading id="lessons">{lessonCount(lessons.length)} from your flagged answers</Heading>
          <ul className="m-0 flex list-none flex-col p-0">
            {lessons.map((lesson) => (
              <li
                key={lesson.id}
                className="flex min-h-12 items-center gap-3.5 border-t border-line py-2.5 first:border-t-0"
              >
                <KindTile kind={lesson.proposal.kind} />
                <span className="min-w-0 flex-1 text-pretty">{lesson.proposal.lesson}</span>
                <span className="text-small text-fg">{KIND_LABELS[lesson.proposal.kind]}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </>
  );
}

function TypeSection({
  title,
  changes,
  empty,
  tone,
}: {
  title: string;
  changes: TypeChange[];
  empty: string;
  /** Gains in the student's color; what didn't improve in a plain one, so it never reads as a win. */
  tone: 'student' | 'fg';
}) {
  return (
    <section aria-label={title} className="flex flex-col gap-[18px]">
      <Heading>{title}</Heading>
      {changes.length === 0 ? (
        <p className="m-0 text-body text-fg">{empty}</p>
      ) : (
        changes.map((change) => (
          <div key={change.type} className="flex flex-col gap-2">
            <div className="flex items-baseline justify-between gap-3">
              <span>{change.label}</span>
              <span className="font-mono text-fg">
                {formatRate(change.before)} → {formatRate(change.after)}
                <span className="text-fg">
                  {' '}
                  · {change.after.pass} of {change.after.total}
                </span>
              </span>
            </div>
            <Meter
              label={change.label}
              value={percent(change.after) / 100}
              valueText={`${change.after.pass} of ${change.after.total} right`}
              tone={tone}
              thickness={4}
            />
          </div>
        ))
      )}
    </section>
  );
}

/** Short facts stacked one per line under a stat. */
function Lines({ lines }: { lines: readonly (ReactNode | false | null | undefined)[] }) {
  return (
    <span className="flex flex-col">
      {lines.filter(Boolean).map((line, index) => (
        <span key={index}>{line}</span>
      ))}
    </span>
  );
}
