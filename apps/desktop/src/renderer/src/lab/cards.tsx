import { Fragment, useEffect, type ReactNode } from 'react';
import {
  orgCounts,
  RunEventSchema,
  type ExperimentRecord,
  type GraduateSummary,
  type JobSummary,
  type ReportCard,
  type Score,
  type Team,
} from '@architect/shared';
import {
  Button,
  CapMeter,
  Card,
  CardRow,
  defineTerm,
  IconButton,
  InfoTip,
  Meter,
  NumberTicker,
  RowIcon,
  Skeleton,
  Spinner,
  Tooltip,
  type LabTerm,
} from '@architect/ui';
import {
  ChevronRight,
  CircleAlert,
  CircleCheck,
  FlaskConical,
  GraduationCap,
  Library,
  MessageCircleQuestion,
  Pause,
  Plus,
  ShieldCheck,
  TriangleAlert,
  ArrowBigUpDash,
} from 'lucide-react';
import { api, architect } from '../api/client';
import { queryKeys, useJob, useReport, useRunDetail } from '../api/hooks';
import { fetchQuery, useQuery } from '../api/query';
import { useCorrections, useImprovements } from '../api/teaching';
import { ProblemState } from '../components/ProblemState';
import { minutesText, STATUS_WORDS as EXPERIMENT_WORDS } from '../experiments/model';
import { newField } from '../fields/new-field';
import { orgCountText } from '../fields/parts';
import { Counted } from '../flow/counted';
import { formatCost, shortDate } from '../flow/format';
import {
  certificateFigure,
  certificateHint,
  notHeldLine,
  riskCertificateFigures,
} from '../flow/report/certificate-words';
import { formatPercent, percentOf } from '../lib/format';
import { mentorName, studentName } from '../lib/names';
import { navigate, paths } from '../lib/router';
import { useAgentSettingsUi } from '../workspace/settings/agentSettingsUi';
import { useAgentChats, useTeamChats } from '../workspace/store';
import { EmptyRow } from '../fields/parts';
import {
  approvalNeeds,
  experimentNeeds,
  jobNeeds,
  orgScores,
  runWord,
  teamApprovalNeeds,
  teachingNeeds,
  type Need,
  type NeedKind,
  type RunRow,
} from './items';

const NEED_ICONS: Record<NeedKind, ReactNode> = {
  question: <MessageCircleQuestion strokeWidth={1.8} aria-hidden />,
  results: <CircleCheck strokeWidth={1.8} aria-hidden />,
  approval: <ShieldCheck strokeWidth={1.8} aria-hidden />,
  lessons: <GraduationCap strokeWidth={1.8} aria-hidden />,
  promote: <ArrowBigUpDash strokeWidth={1.8} aria-hidden />,
  failed: <CircleAlert strokeWidth={1.8} aria-hidden />,
  experiment: <FlaskConical strokeWidth={1.8} aria-hidden />,
};

const chevron = <ChevronRight size={16} strokeWidth={1.8} aria-hidden />;

function NeedRow({ need }: { need: Need }) {
  const showSettings = useAgentSettingsUi((state) => state.show);
  const icon = NEED_ICONS[need.kind];
  const target = need.target;
  return (
    <li>
      <CardRow
        icon={<RowIcon>{icon}</RowIcon>}
        title={need.title}
        detail={need.detail}
        end={
          <>
            {need.end}
            {chevron}
          </>
        }
        onClick={() =>
          'path' in target ? navigate(target.path) : showSettings(target.teaching, 'teaching')
        }
      />
    </li>
  );
}

/** The kinds of what waits, in the order the card lists them; each row's icon names its kind. */
const NEED_ORDER: readonly (readonly NeedKind[])[] = [
  ['question'],
  ['results', 'failed'],
  ['approval'],
  ['lessons'],
  ['promote'],
  ['experiment'],
];

/**
 * One agent's approvals, lessons and versions of the given kinds; each read on its own. Only the
 * last kinds show a failed read, so a problem isn't repeated for every kind.
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

/** A team's chats that wait for an approval, read on their own like an agent's. */
function TeamNeeds({ team, kinds }: { team: Team; kinds: readonly NeedKind[] }) {
  const chats = useTeamChats(team.id);
  if (!kinds.includes('approval')) return null;
  return (
    <>
      {teamApprovalNeeds(team, chats.entry.data ?? []).map((need) => (
        <NeedRow key={need.key} need={need} />
      ))}
      {chats.entry.status === 'error' && (
        <li className="border-t border-line px-6 py-3">
          <ProblemState
            layout="inline"
            error={chats.entry.error}
            title={`Couldn't read what ${team.name} has waiting`}
            onRetry={chats.reload}
          />
        </li>
      )}
      {chats.entry.status === 'loading' && <li aria-busy="true" className="sr-only" />}
    </>
  );
}

/** Everything that waits for the person, in order of kind: the focal card, with Running beside it. */
export function NeedsYouCard({
  jobs,
  graduates,
  teams,
  experiments,
}: {
  jobs: readonly JobSummary[];
  graduates: readonly GraduateSummary[];
  teams: readonly Team[];
  experiments: readonly ExperimentRecord[];
}) {
  const fromJobs = [...jobNeeds(jobs), ...experimentNeeds(experiments)];
  return (
    <Card title="Needs you" flush>
      {/* Each agent's rows come from reads of their own, in one list ordered by kind. */}
      <div className="group">
        <ul className="m-0 flex list-none flex-col p-0">
          {NEED_ORDER.map((kinds, index) => (
            <Fragment key={kinds.join()}>
              {fromJobs
                .filter((need) => kinds.includes(need.kind))
                .map((need) => (
                  <NeedRow key={need.key} need={need} />
                ))}
              {graduates.map((graduate) => (
                <AgentNeeds
                  key={graduate.id}
                  graduate={graduate}
                  kinds={kinds}
                  problems={index === NEED_ORDER.length - 1}
                />
              ))}
              {teams.map((team) => (
                <TeamNeeds key={team.id} team={team} kinds={kinds} />
              ))}
            </Fragment>
          ))}
        </ul>
        <CardRow
          icon={
            <RowIcon>
              <CircleCheck strokeWidth={1.8} className="text-student" aria-hidden />
            </RowIcon>
          }
          title="Nothing waits for you"
          className="group-has-[li:not([aria-busy])]:hidden"
        />
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
          <RowIcon>
            {paused ? (
              <Pause className="text-mentor" aria-label="Paused" />
            ) : (
              <Spinner tone="mentor" size={16} label="Running" />
            )}
          </RowIcon>
          <span className="flex min-w-0 flex-1 flex-col">
            <span className="truncate font-medium">{row.jobName}</span>
            <span className="truncate text-small">
              {word}
              {rounds !== undefined && maxRounds !== undefined && rounds > 0
                ? `, round ${Math.min(rounds, maxRounds)} of ${maxRounds}`
                : ''}
            </span>
          </span>
          {dev && dev.total > 0 && (
            <Tooltip
              content="Held-out checks passed now. Spark sees only this score, never the tasks."
              side="left"
            >
              <span className="flex flex-col items-end">
                <span className="text-small">Held-out checks</span>
                <span className="font-display text-h2 font-semibold tabular-nums">
                  <Counted said={formatPercent(dev)}>
                    <NumberTicker value={percentOf(dev)} kind="percent" />
                  </Counted>
                </span>
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

/** An experiment under way: its name, its field, and the wall clock it has used. */
function RunningExperiment({ experiment }: { experiment: ExperimentRecord }) {
  return (
    <li>
      <CardRow
        icon={
          <RowIcon>
            <Spinner tone="mentor" size={16} label={EXPERIMENT_WORDS[experiment.status]} />
          </RowIcon>
        }
        title={experiment.input.name}
        detail={`${EXPERIMENT_WORDS[experiment.status]}, ${experiment.job.name}`}
        end={
          experiment.runningMs > 0 ? (
            <span className="tabular-nums">{minutesText(experiment.runningMs / 60_000)}</span>
          ) : (
            chevron
          )
        }
        onClick={() => navigate(paths.experiment(experiment.id))}
      />
    </li>
  );
}

export function RunningCard({
  rows,
  experiments,
}: {
  rows: readonly RunRow[];
  experiments: readonly ExperimentRecord[];
}) {
  useLiveRuns(rows.map((row) => row.runId));
  return (
    <Card title="Running" flush>
      {rows.length === 0 && experiments.length === 0 ? (
        <EmptyRow title="Nothing is running" />
      ) : (
        <ul className="m-0 flex list-none flex-col p-0">
          {rows.map((row) => (
            <RunningRow key={row.runId} row={row} />
          ))}
          {experiments.map((experiment) => (
            <RunningExperiment key={experiment.id} experiment={experiment} />
          ))}
        </ul>
      )}
    </Card>
  );
}

/** The newest experiments, each with its field and its state in a word. */
export function ExperimentsCard({
  experiments,
  error,
  onRetry,
}: {
  experiments: readonly ExperimentRecord[] | undefined;
  error: Error | null;
  onRetry: () => void;
}) {
  return (
    <Card
      title="Experiments"
      flush
      action={
        <Tooltip content="New experiment" side="left">
          <IconButton
            label="New experiment"
            size="sm"
            onClick={() => navigate(paths.newExperiment())}
          >
            <Plus size={16} strokeWidth={1.8} aria-hidden />
          </IconButton>
        </Tooltip>
      }
    >
      {error ? (
        <div className="px-6 pb-5">
          <ProblemState
            layout="inline"
            error={error}
            title="Couldn't read your experiments"
            onRetry={onRetry}
          />
        </div>
      ) : !experiments ? (
        <Skeleton aria-busy="true" className="mx-6 mb-5 h-10" />
      ) : experiments.length === 0 ? (
        <EmptyRow title="No experiments yet" />
      ) : (
        <ul className="m-0 flex list-none flex-col p-0">
          {experiments.slice(0, 4).map((experiment) => (
            <li key={experiment.id}>
              <CardRow
                icon={
                  <RowIcon>
                    <FlaskConical strokeWidth={1.8} aria-hidden />
                  </RowIcon>
                }
                title={experiment.input.name}
                detail={experiment.job.name}
                end={EXPERIMENT_WORDS[experiment.status]}
                onClick={() => navigate(paths.experiment(experiment.id))}
              />
            </li>
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
    <Labeled label="Risk bound" hint={certificateHint(certificate)}>
      {figure}
    </Labeled>
  );
}

interface HeroFigure {
  label: string;
  term: LabTerm;
  value: string;
  /** What the figure rests on: "55 of 66", "95% confidence". */
  note: string;
  /** Where the claim failed, said beside it: "Not held at Real academy". */
  caveat?: string;
}

/**
 * The figures that make the claim, in the order it is made: the generated organizations it never
 * saw, the real one beside them, and the risk bound with where it didn't hold; a job of one
 * organization has its sealed final test instead.
 */
function heroFigures(card: ReportCard): HeroFigure[] {
  const scores = card.test.perOrg?.length ? orgScores(card.test.perOrg) : null;
  const scored = (label: string, term: LabTerm, score: Score): HeroFigure => ({
    label,
    term,
    value: formatPercent(score),
    note: `${score.pass} of ${score.total}`,
  });
  const figures: HeroFigure[] = [];
  if (scores?.unseen) figures.push(scored('Never seen', 'neverSeen', scores.unseen));
  if (scores?.real) figures.push(scored('Real', 'realOrganization', scores.real));
  if (figures.length === 0)
    figures.push(scored('Sealed final test', 'sealedFinalTest', card.test.score));
  const bound = certificateFigure(card.certificate);
  if (card.certificate?.issued === true && bound !== null) {
    const [, confidence] = riskCertificateFigures(card.certificate);
    const notHeld = notHeldLine(card.certificate, 'sealed final test');
    figures.push({
      label: 'Risk bound',
      term: 'riskBound',
      value: bound,
      note: `${confidence?.value ?? ''} confidence`,
      ...(notHeld === null ? {} : { caveat: notHeld }),
    });
  }
  return figures;
}

/**
 * The newest finished result, leading the Lab: how the specialist did on organizations it never
 * saw, the real one beside them and its risk bound, each term explained behind its info icon, with
 * the organizations it was taught on beside them.
 */
export function HeroResultCard({ row, mentor }: { row: RunRow; mentor?: string | undefined }) {
  const report = useReport(row.runId);
  const card = report.data;
  const taught = card?.test.perOrg?.length ? orgScores(card.test.perOrg).seen : null;
  return (
    <Card
      title={card ? `${row.jobName}, ${shortDate(card.createdAt) ?? 'finished'}` : row.jobName}
      icon={<CircleCheck strokeWidth={1.8} aria-hidden />}
      action={
        <Button variant="ghost" size="sm" onClick={() => navigate(paths.report(row.runId))}>
          Open report
          {chevron}
        </Button>
      }
    >
      {card ? (
        <div className="flex flex-wrap items-end gap-x-14 gap-y-6 pt-2">
          {heroFigures(card).map((figure) => (
            <HeroNumber key={figure.label} figure={figure} mentor={mentor} />
          ))}
          {taught && (
            <span className="ml-auto self-end">
              <HeroNumber
                figure={{
                  label: 'Taught on',
                  term: 'taughtOn',
                  value: formatPercent(taught),
                  note: `${taught.pass} of ${taught.total}`,
                }}
                mentor={mentor}
                quiet
              />
            </span>
          )}
        </div>
      ) : report.status === 'error' ? (
        <ProblemState
          layout="inline"
          error={report.error}
          title="Couldn't read this report"
          onRetry={report.reload}
        />
      ) : (
        <Skeleton className="h-24 w-full" />
      )}
    </Card>
  );
}

function HeroNumber({
  figure,
  mentor,
  quiet = false,
}: {
  figure: HeroFigure;
  mentor: string | undefined;
  /** The figure beside the claim, a step smaller. */
  quiet?: boolean;
}) {
  return (
    <div className="flex flex-col gap-1">
      <span
        className={`font-display font-semibold tabular-nums ${quiet ? 'text-h1' : 'text-title'}`}
      >
        {figure.value}
      </span>
      <span className="flex items-center gap-1 font-medium">
        {figure.label}
        <InfoTip about={figure.label}>{defineTerm(figure.term, mentor)}</InfoTip>
      </span>
      <span className="text-small tabular-nums">{figure.note}</span>
      {figure.caveat && (
        <span className="flex items-center gap-1.5 text-small font-medium">
          <TriangleAlert size={13} strokeWidth={1.8} className="text-danger" aria-hidden />
          {figure.caveat}
        </span>
      )}
    </div>
  );
}

function FinishedRow({ row }: { row: RunRow }) {
  const report = useReport(row.runId);
  const card = report.data;
  const perOrg = card?.test.perOrg;
  const scores = perOrg && perOrg.length > 0 ? orgScores(perOrg) : null;
  // A field with no real organization has no Real figure at all, rather than a dash.
  const hasReal = perOrg?.some((result) => !result.seen && !result.synthetic) ?? false;
  return (
    <li>
      <CardRow
        icon={
          <RowIcon>
            <CircleCheck strokeWidth={1.8} aria-hidden />
          </RowIcon>
        }
        title={row.jobName}
        detail={card ? (shortDate(card.createdAt) ?? undefined) : undefined}
        onClick={() => navigate(paths.report(row.runId))}
        end={
          card ? (
            <span className="flex gap-5">
              {scores ? (
                <>
                  <Figure label="Taught on" score={scores.seen} hint={defineTerm('taughtOn')} />
                  <Figure label="Never seen" score={scores.unseen} hint={defineTerm('neverSeen')} />
                  {hasReal && (
                    <Figure
                      label="Real"
                      score={scores.real}
                      hint={defineTerm('realOrganization')}
                    />
                  )}
                </>
              ) : (
                <Figure
                  label="Passed"
                  score={card.test.score}
                  hint={defineTerm('sealedFinalTest')}
                />
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
        <EmptyRow title="No finished runs yet" />
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
    <div className="flex flex-col gap-2">
      <span className="truncate text-small font-medium">{row.jobName}</span>
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
  return job.data.organizations ? <FieldCounts jobId={jobId} name={job.data.name} /> : null;
}

/** A field's row, with its organizations counted as the Fields table counts them. */
function FieldCounts({ jobId, name }: { jobId: string; name: string }) {
  const view = useQuery(`field-view:${jobId}`, () => api.field(jobId));
  if (view.status === 'error') {
    return (
      <li className="border-t border-line px-6 py-3">
        <ProblemState
          layout="inline"
          error={view.error}
          title="Couldn't read this field"
          onRetry={view.reload}
        />
      </li>
    );
  }
  return (
    <li>
      <CardRow
        icon={
          <RowIcon>
            <Library strokeWidth={1.8} aria-hidden />
          </RowIcon>
        }
        title={name}
        detail={view.data ? orgCountText(orgCounts(view.data)) : undefined}
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
          <IconButton label="Describe a field" size="sm" onClick={newField}>
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
        <EmptyRow title="No fields yet" className="group-has-[li:not([aria-busy])]:hidden" />
      </div>
    </Card>
  );
}
