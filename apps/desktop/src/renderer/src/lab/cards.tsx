import { useEffect, type ReactNode } from 'react';
import {
  RunEventSchema,
  type GraduateSummary,
  type JobSummary,
  type ReportCard,
  type Score,
} from '@architect/shared';
import {
  AgentAvatar,
  CapMeter,
  Card,
  CardRow,
  cn,
  IconButton,
  Meter,
  NumberTicker,
  Skeleton,
  Spinner,
  Tooltip,
} from '@architect/ui';
import {
  ChevronRight,
  CircleAlert,
  CircleCheck,
  GraduationCap,
  Library,
  MessageCircleQuestion,
  Pause,
  Plus,
  ShieldCheck,
  ArrowBigUpDash,
} from 'lucide-react';
import { api, architect } from '../api/client';
import { queryKeys, useJob, useReport, useRunDetail } from '../api/hooks';
import { fetchQuery } from '../api/query';
import { useCorrections, useImprovements } from '../api/teaching';
import { ProblemState } from '../components/ProblemState';
import { Counted } from '../flow/counted';
import { formatCost, shortDate } from '../flow/format';
import { certificateFigure, certificateHint } from '../flow/report/certificate-words';
import { formatPercent, percentOf } from '../lib/format';
import { activeVersionName, agentModelName, mentorName, studentName } from '../lib/names';
import { navigate, paths } from '../lib/router';
import { useAgentSettingsUi } from '../workspace/settings/agentSettingsUi';
import { useAgentChats } from '../workspace/store';
import { openAgent } from './open-agent';
import {
  approvalNeeds,
  jobNeeds,
  orgScores,
  runWord,
  teachingNeeds,
  type Need,
  type NeedKind,
  type RunRow,
} from './items';

/** A row's leading mark: an icon on a quiet tile, in the color of who it is about. */
function Tile({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <span
      className={cn(
        'flex size-9 items-center justify-center rounded-control bg-selected [&_svg]:size-4',
        className,
      )}
    >
      {children}
    </span>
  );
}

const NEED_ICONS: Record<NeedKind, { icon: ReactNode; tone: string }> = {
  question: { icon: <MessageCircleQuestion strokeWidth={1.8} aria-hidden />, tone: 'text-mentor' },
  results: { icon: <CircleCheck strokeWidth={1.8} aria-hidden />, tone: 'text-student' },
  approval: { icon: <ShieldCheck strokeWidth={1.8} aria-hidden />, tone: 'text-fg' },
  lessons: { icon: <GraduationCap strokeWidth={1.8} aria-hidden />, tone: 'text-mentor' },
  promote: { icon: <ArrowBigUpDash strokeWidth={1.8} aria-hidden />, tone: 'text-student' },
  failed: { icon: <CircleAlert strokeWidth={1.8} aria-hidden />, tone: 'text-danger' },
};

const chevron = <ChevronRight size={16} strokeWidth={1.8} aria-hidden />;

/** A calm line in an empty card: what is not there, in a few words. */
function Quiet({ children, className }: { children: ReactNode; className?: string }) {
  return <p className={cn('m-0 px-6 pb-6 pt-1 text-ui', className)}>{children}</p>;
}

function NeedRow({ need }: { need: Need }) {
  const showSettings = useAgentSettingsUi((state) => state.show);
  const { icon, tone } = NEED_ICONS[need.kind];
  const target = need.target;
  return (
    <li>
      <CardRow
        icon={<Tile className={tone}>{icon}</Tile>}
        title={need.title}
        detail={need.detail}
        end={chevron}
        onClick={() =>
          'path' in target ? navigate(target.path) : showSettings(target.teaching, 'teaching')
        }
      />
    </li>
  );
}

/** The kinds of what waits, in the order the card groups them. */
const NEED_GROUPS: readonly { label: string; kinds: readonly NeedKind[] }[] = [
  { label: 'Questions', kinds: ['question'] },
  { label: 'Results', kinds: ['results', 'failed'] },
  { label: 'Approvals', kinds: ['approval'] },
  { label: 'Lessons', kinds: ['lessons'] },
  { label: 'Versions', kinds: ['promote'] },
];

/**
 * One agent's approvals, lessons and versions of the given kinds; each read on its own. Only one
 * group shows a failed read, so a problem isn't repeated in every group.
 */
function AgentNeeds({
  graduate,
  kinds,
  problems,
}: {
  graduate: GraduateSummary;
  kinds: readonly NeedKind[];
  problems: boolean;
}) {
  const chats = useAgentChats(graduate.id);
  const corrections = useCorrections(graduate.id);
  const improvements = useImprovements(graduate.id);
  const needs = [
    ...approvalNeeds(graduate, chats.entry.data ?? []),
    ...teachingNeeds(graduate, corrections.data ?? [], improvements.data ?? []),
  ].filter((need) => kinds.includes(need.kind));
  const failed =
    chats.entry.status === 'error'
      ? { error: chats.entry.error, retry: chats.reload }
      : corrections.status === 'error'
        ? { error: corrections.error, retry: corrections.reload }
        : improvements.status === 'error'
          ? { error: improvements.error, retry: improvements.reload }
          : null;
  const loading =
    chats.entry.status === 'loading' ||
    corrections.status === 'loading' ||
    improvements.status === 'loading';
  return (
    <>
      {needs.map((need) => (
        <NeedRow key={need.key} need={need} />
      ))}
      {problems && failed && (
        <li className="border-t border-line px-6 py-3">
          <ProblemState
            layout="inline"
            error={failed.error}
            title={`Couldn't read what ${graduate.name} has waiting`}
            onRetry={failed.retry}
          />
        </li>
      )}
      {loading && <li aria-busy="true" className="sr-only" />}
    </>
  );
}

/** Everything that waits for the person, grouped by kind: the focal card, with Running beside it. */
export function NeedsYouCard({
  jobs,
  graduates,
}: {
  jobs: readonly JobSummary[];
  graduates: readonly GraduateSummary[];
}) {
  const fromJobs = jobNeeds(jobs);
  return (
    <Card title="Needs you" flush>
      {/* Each agent's rows come from reads of their own; a group shows once it holds a row. */}
      <div className="group">
        {NEED_GROUPS.map((group, index) => (
          <section
            key={group.label}
            aria-label={group.label}
            className="hidden has-[li:not([aria-busy])]:block"
          >
            <h3 className="m-0 px-6 pb-2 pt-4 text-small font-medium">{group.label}</h3>
            <ul className="m-0 flex list-none flex-col p-0">
              {fromJobs
                .filter((need) => group.kinds.includes(need.kind))
                .map((need) => (
                  <NeedRow key={need.key} need={need} />
                ))}
              {graduates.map((graduate) => (
                <AgentNeeds
                  key={graduate.id}
                  graduate={graduate}
                  kinds={group.kinds}
                  problems={index === NEED_GROUPS.length - 1}
                />
              ))}
            </ul>
          </section>
        ))}
        <Quiet className="flex items-center gap-2.5 group-has-[li:not([aria-busy])]:hidden">
          <CircleCheck size={16} strokeWidth={1.8} className="text-student" aria-hidden />
          Nothing waits for you
        </Quiet>
      </div>
    </Card>
  );
}

/**
 * Reads a running run's records again as it moves: each change of the run or one of its rounds
 * comes as an event, and the read after it has the new state.
 */
function useLiveRuns(runIds: readonly string[]): void {
  const key = runIds.join(',');
  useEffect(() => {
    const watched = new Set(key.split(',').filter(Boolean));
    if (watched.size === 0) return;
    return architect().runs.onEvent((payload) => {
      const parsed = RunEventSchema.safeParse(payload);
      if (!parsed.success || !watched.has(parsed.data.runId)) return;
      if (parsed.data.type !== 'run.updated' && parsed.data.type !== 'round.updated') return;
      const runId = parsed.data.runId;
      void fetchQuery(queryKeys.run(runId), () => api.run(runId));
    });
  }, [key]);
}

function RunningRow({ row }: { row: RunRow }) {
  const detail = useRunDetail(row.runId);
  const live = detail.data?.run ?? null;
  const rounds = live?.totals.rounds;
  const maxRounds = detail.data?.job.budget.maxRounds;
  const dev = live?.devCurrent ?? row.run.devCurrent;
  const word = runWord(live ?? row.run);
  const paused = (live ?? row.run).status === 'paused';
  return (
    <li>
      <button
        type="button"
        onClick={() => navigate(paths.train(row.runId))}
        className="flex w-full flex-col gap-3 border-t border-line px-6 py-4 text-left text-ui transition-colors duration-150 hover:bg-hover focus-visible:bg-hover"
      >
        <span className="flex w-full items-center gap-3">
          <Tile>
            {paused ? (
              <Pause className="text-mentor" aria-label="Paused" />
            ) : (
              <Spinner tone="mentor" size={16} label="Running" />
            )}
          </Tile>
          <span className="flex min-w-0 flex-1 flex-col">
            <span className="truncate font-medium">{row.jobName}</span>
            <span className="truncate text-small">
              {word}
              {rounds !== undefined && maxRounds !== undefined
                ? `, round ${Math.min(rounds + (paused ? 0 : 1), maxRounds)} of ${maxRounds}`
                : ''}
            </span>
          </span>
          {dev && dev.total > 0 && (
            <Tooltip
              content="Check tasks passed now. Spark sees only this score, never the tasks."
              side="left"
            >
              <span className="font-display text-h2 font-semibold tabular-nums">
                <Counted said={formatPercent(dev)}>
                  <NumberTicker value={percentOf(dev)} kind="percent" />
                </Counted>
              </span>
            </Tooltip>
          )}
        </span>
        {rounds !== undefined && maxRounds !== undefined ? (
          <Meter
            value={maxRounds === 0 ? 0 : rounds / maxRounds}
            tone="student"
            label={`${row.jobName} rounds`}
            valueText={`${rounds} of ${maxRounds} rounds`}
          />
        ) : detail.status === 'error' ? (
          <ProblemState
            layout="inline"
            error={detail.error}
            title="Couldn't read this run"
            onRetry={detail.reload}
          />
        ) : (
          <Skeleton className="h-[3px] w-full" />
        )}
      </button>
    </li>
  );
}

export function RunningCard({ rows }: { rows: readonly RunRow[] }) {
  useLiveRuns(rows.map((row) => row.runId));
  return (
    <Card title="Running" flush>
      {rows.length === 0 ? (
        <Quiet>Nothing is running</Quiet>
      ) : (
        <ul className="m-0 flex list-none flex-col p-0">
          {rows.map((row) => (
            <RunningRow key={row.runId} row={row} />
          ))}
        </ul>
      )}
    </Card>
  );
}

/** One figure of a final test: "Never seen 74%", or a dash when that kind wasn't tested. */
function Figure({ label, score, hint }: { label: string; score: Score | null; hint: string }) {
  return (
    <Labeled label={label} hint={hint}>
      {score ? formatPercent(score) : <span aria-label="not tested">–</span>}
    </Labeled>
  );
}

function Labeled({ label, hint, children }: { label: string; hint: string; children: ReactNode }) {
  return (
    <Tooltip content={hint} side="top">
      <span className="flex flex-col items-end">
        <span className="text-small">{label}</span>
        <span className="font-display text-body font-semibold tabular-nums">{children}</span>
      </span>
    </Tooltip>
  );
}

/** A finished run's certificate (decision 077) as one figure: "Certified ≤ 8%". */
function Certified({ certificate }: { certificate: ReportCard['certificate'] }) {
  const figure = certificateFigure(certificate);
  if (certificate === undefined || figure === null) return null;
  return (
    <Labeled label="Certified" hint={certificateHint(certificate)}>
      {figure}
    </Labeled>
  );
}

function FinishedRow({ row }: { row: RunRow }) {
  const report = useReport(row.runId);
  const card = report.data;
  const perOrg = card?.test.perOrg;
  const scores = perOrg && perOrg.length > 0 ? orgScores(perOrg) : null;
  return (
    <li>
      <CardRow
        icon={
          <Tile className="text-student">
            <CircleCheck strokeWidth={1.8} aria-hidden />
          </Tile>
        }
        title={row.jobName}
        detail={card ? (shortDate(card.createdAt) ?? undefined) : undefined}
        onClick={() => navigate(paths.report(row.runId))}
        end={
          card ? (
            <span className="flex gap-5">
              {scores ? (
                <>
                  <Figure
                    label="Taught on"
                    score={scores.seen}
                    hint="Organizations it was taught on"
                  />
                  <Figure
                    label="Never seen"
                    score={scores.unseen}
                    hint="Generated ones it never saw"
                  />
                  <Figure label="Real" score={scores.real} hint="Real ones it never saw" />
                </>
              ) : (
                <Figure label="Passed" score={card.test.score} hint="Final test" />
              )}
              <Certified certificate={card.certificate} />
            </span>
          ) : report.status === 'error' ? (
            <span className="text-small">Couldn't read the report</span>
          ) : (
            <Skeleton className="h-8 w-24" />
          )
        }
      />
    </li>
  );
}

export function FinishedCard({ rows }: { rows: readonly RunRow[] }) {
  return (
    <Card title="Recently finished" flush>
      {rows.length === 0 ? (
        <Quiet>No finished runs yet</Quiet>
      ) : (
        <ul className="m-0 flex list-none flex-col p-0">
          {rows.map((row) => (
            <FinishedRow key={row.runId} row={row} />
          ))}
        </ul>
      )}
    </Card>
  );
}

/** One run's spending against its caps: the teacher's dollars, and the student's when recorded. */
function SpendRow({ row }: { row: RunRow }) {
  const detail = useRunDetail(row.runId);
  if (!detail.data) {
    return detail.status === 'error' ? (
      <ProblemState
        layout="inline"
        error={detail.error}
        title={`Couldn't read what ${row.jobName} spent`}
        onRetry={detail.reload}
      />
    ) : (
      <Skeleton className="h-10 w-full" />
    );
  }
  const { run, job } = detail.data;
  return (
    <div className="flex flex-col gap-3">
      <span className="truncate font-medium">{row.jobName}</span>
      <CapMeter
        tone="mentor"
        label={mentorName(job.mentor)}
        name={`${row.jobName}, ${mentorName(job.mentor)}`}
        used={run.totals.mentorUsd}
        cap={job.budget.maxMentorUsd}
        format={formatCost}
      />
      {row.run.status === 'finished' && (
        <StudentSpend runId={row.runId} student={studentName(job.student.local)} />
      )}
    </div>
  );
}

/**
 * What a hosted copy of the student cost a finished run, from its report. A student that ran
 * only on this computer cost nothing that was recorded, and shows nothing.
 */
function StudentSpend({ runId, student }: { runId: string; student: string }) {
  const report = useReport(runId);
  const usd = report.data?.cost.studentUsd;
  return usd === undefined ? null : (
    <CapMeter tone="student" label={student} used={usd} format={formatCost} />
  );
}

export function SpendCard({ rows }: { rows: readonly RunRow[] }) {
  return (
    <Card title="Spend">
      {rows.length === 0 ? (
        <p className="m-0 text-ui">Nothing spent yet</p>
      ) : (
        <div className="flex flex-col gap-6">
          {rows.map((row) => (
            <SpendRow key={row.runId} row={row} />
          ))}
        </div>
      )}
    </Card>
  );
}

function FieldRow({ jobId }: { jobId: string }) {
  const job = useJob(jobId);
  const orgs = job.data?.organizations;
  if (!job.data) {
    return job.status === 'error' ? (
      <li className="border-t border-line px-6 py-3">
        <ProblemState
          layout="inline"
          error={job.error}
          title="Couldn't read this job"
          onRetry={job.reload}
        />
      </li>
    ) : (
      <li aria-busy="true" className="sr-only" />
    );
  }
  if (!orgs) return null;
  return (
    <li>
      <CardRow
        icon={
          <Tile>
            <Library strokeWidth={1.8} aria-hidden />
          </Tile>
        }
        title={job.data.name}
        detail={orgs.length === 1 ? 'One organization' : `${orgs.length} organizations`}
        end={chevron}
        onClick={() => navigate(paths.field(jobId))}
      />
    </li>
  );
}

/** The jobs that serve several organizations of one field. */
export function FieldsCard({ jobs }: { jobs: readonly JobSummary[] }) {
  return (
    <Card
      title="Fields"
      flush
      action={
        <Tooltip content="Describe a field" side="left">
          <IconButton label="Describe a field" size="sm" onClick={() => navigate(paths.newAgent())}>
            <Plus size={16} strokeWidth={1.8} aria-hidden />
          </IconButton>
        </Tooltip>
      }
    >
      <div className="group">
        <ul className="m-0 flex list-none flex-col p-0">
          {jobs.map((job) => (
            <FieldRow key={job.id} jobId={job.id} />
          ))}
        </ul>
        <Quiet className="group-has-[li:not([aria-busy])]:hidden">No fields yet</Quiet>
      </div>
    </Card>
  );
}

const STATUS_WORDS: Partial<Record<GraduateSummary['status'], string>> = {
  needs_attention: 'Needs a look',
  blocked: 'Blocked',
};

export function AgentsCard({ graduates }: { graduates: readonly GraduateSummary[] }) {
  return (
    <Card title="Agents" flush>
      {graduates.length === 0 ? (
        <Quiet>No agents yet</Quiet>
      ) : (
        <ul className="m-0 flex list-none flex-col p-0">
          {graduates.map((graduate) => {
            const status = STATUS_WORDS[graduate.status];
            return (
              <li key={graduate.id}>
                <CardRow
                  icon={<AgentAvatar name={graduate.name} />}
                  title={graduate.name}
                  detail={`${activeVersionName(graduate)}, ${agentModelName(graduate.manifest.student)}`}
                  end={
                    status ? (
                      <span className={graduate.status === 'blocked' ? 'text-danger' : ''}>
                        {status}
                      </span>
                    ) : (
                      chevron
                    )
                  }
                  label={`Open ${graduate.name}`}
                  onClick={() => openAgent(graduate)}
                />
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}
