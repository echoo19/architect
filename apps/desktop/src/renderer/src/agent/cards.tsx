import { useEffect, useRef, useState, type ReactNode } from 'react';
import {
  gpuFit,
  reportScores,
  RunEventSchema,
  type GraduateSummary,
  type OrgScores,
  type ReportCard,
  type Score,
  type WorkspaceMessage,
} from '@architect/shared';
import {
  BarChart,
  Button,
  Card,
  CardRow,
  defineTerm,
  InfoTip,
  Meter,
  RowIcon,
  Skeleton,
  Spinner,
  Tooltip,
  type BarDatum,
} from '@architect/ui';
import {
  ChevronRight,
  CircleAlert,
  CircleCheck,
  Cpu,
  Equal,
  FlaskConical,
  Gauge,
  HardDrive,
  MemoryStick,
  MessageSquare,
  MessageSquareDashed,
  ShieldCheck,
  Square,
  TrendingDown,
  TrendingUp,
  Users,
  WifiOff,
} from 'lucide-react';
import { api, architect } from '../api/client';
import { useInstallation } from '../api/graduates';
import { useLocalRuntimes, useReport } from '../api/hooks';
import { mentoringApi } from '../api/mentoring';
import { useQuery } from '../api/query';
import { ProblemState } from '../components/ProblemState';
import { formatAnswerTime, shortDate } from '../flow/format';
import {
  certificateFigure,
  certificateHint,
  certificateSentence,
  notHeldLine,
} from '../flow/report/certificate-words';
import { runtimeFigures } from '../flow/report/evidence';
import { formatBytes, formatPercent, percentOf } from '../lib/format';
import { agentModelName, quantizationLabel } from '../lib/names';
import { chatPath, navigate } from '../lib/router';
import { runtimeName } from '../models/registry';
import { useWords } from '../shell/edition';
import { onWorkspaceEvent } from '../workspace/api';
import {
  activitySpan,
  answerTimes,
  oversight,
  requestsByDay,
  tokensPerSecond,
  toolUse,
  type SessionRow,
  type SessionState,
} from './activity';

const chevron = <ChevronRight size={16} strokeWidth={1.8} aria-hidden />;

/** "2:14 PM" for today, "Oct 28" before. */
function whenText(iso: string, now: Date): string {
  const at = new Date(iso);
  return at.toDateString() === now.toDateString()
    ? at.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
    : (shortDate(iso) ?? iso);
}

const plural = (count: number, one: string, many = `${one}s`) =>
  `${count} ${count === 1 ? one : many}`;

/** A quiet line in place of a card's rows. */
function Quiet({ children }: { children: ReactNode }) {
  return <p className="m-0 border-t border-line px-6 py-4 text-ui">{children}</p>;
}

/* Sessions */

const STATE_WORDS: Record<SessionState, string> = {
  working: 'Working',
  waiting: 'Waiting for your approval',
  failed: 'Stopped on an error',
  stopped: 'Stopped',
  answered: 'Answered',
  new: 'Not started',
};

function StateIcon({ state, team }: { state: SessionState; team: boolean }) {
  const label = STATE_WORDS[state];
  const icon = (() => {
    switch (state) {
      case 'working':
        return <Spinner tone="student" label={label} />;
      case 'waiting':
        return <ShieldCheck strokeWidth={1.8} role="img" aria-label={label} />;
      case 'failed':
        return (
          <CircleAlert strokeWidth={1.8} role="img" aria-label={label} className="text-danger" />
        );
      case 'stopped':
        return <Square strokeWidth={1.8} role="img" aria-label={label} />;
      case 'new':
        return <MessageSquareDashed strokeWidth={1.8} role="img" aria-label={label} />;
      case 'answered':
        return team ? (
          <Users strokeWidth={1.8} role="img" aria-label={`${label} with its team`} />
        ) : (
          <MessageSquare strokeWidth={1.8} role="img" aria-label={label} />
        );
    }
  })();
  return (
    <Tooltip content={team ? `${label}, team chat` : label} side="right">
      <span className="inline-flex">
        <RowIcon>{icon}</RowIcon>
      </span>
    </Tooltip>
  );
}

/** How many sessions show before the rest are asked for. */
const FIRST_SESSIONS = 6;

/**
 * The agent's sessions, the most recent first: how each stands, what its last reply came to, and
 * when. Each opens its chat; a team's opens under the team.
 */
export function SessionsCard({ rows, now }: { rows: readonly SessionRow[]; now: Date }) {
  const [all, setAll] = useState(false);
  const shown = all ? rows : rows.slice(0, FIRST_SESSIONS);
  return (
    <Card
      title="Sessions"
      icon={<MessageSquare strokeWidth={1.8} aria-hidden />}
      flush
      action={
        rows.length > FIRST_SESSIONS ? (
          <Button size="xs" variant="ghost" onClick={() => setAll((open) => !open)}>
            {all ? 'Fewer' : `All ${rows.length}`}
          </Button>
        ) : undefined
      }
    >
      {rows.length === 0 ? (
        <Quiet>No sessions yet</Quiet>
      ) : (
        <ul className="m-0 list-none p-0">
          {shown.map((row) => (
            <li key={row.chat.id}>
              <CardRow
                icon={<StateIcon state={row.state} team={row.chat.teamId !== undefined} />}
                title={row.chat.title}
                detail={row.outcome ?? plural(row.requests, 'request')}
                end={
                  <>
                    <span>{whenText(row.chat.updatedAt, now)}</span>
                    {chevron}
                  </>
                }
                onClick={() => navigate(chatPath(row.chat))}
              />
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

/* Activity */

const DAY_WORDS: Intl.DateTimeFormatOptions = { weekday: 'long', month: 'long', day: 'numeric' };

/**
 * Requests per day over the last two weeks, with the replies that stopped on an error in red, and
 * above them the figures that say how the agent keeps up: requests, answer time and speed.
 */
export function ActivityCard({
  messages,
  end,
  acceptedAt,
}: {
  messages: readonly WorkspaceMessage[];
  end: Date;
  /** When the version answering was accepted: the chart starts no earlier than that day. */
  acceptedAt: string;
}) {
  const span = activitySpan(acceptedAt, end);
  const days = requestsByDay(messages, end, span.days);
  const first = days[0]?.day;
  const countLabel =
    span.fromAcceptance && first
      ? `Requests since ${shortDate(`${first}T12:00:00`) ?? first}`
      : `Requests, ${span.days} days`;
  const requests = days.reduce((sum, day) => sum + day.requests, 0);
  const times = answerTimes(messages);
  const speed = tokensPerSecond(messages);
  const data: BarDatum[] = days.map((day) => {
    const date = new Date(`${day.day}T12:00:00`);
    const failed = day.errors > 0 ? `, ${day.errors} failed` : '';
    return {
      key: day.day,
      label: String(date.getDate()),
      description: `${date.toLocaleDateString('en-US', DAY_WORDS)}: ${plural(day.requests, 'request')}${failed}`,
      value: day.requests,
      alert: day.errors,
    };
  });
  const figure = (ms: number | null) => (ms === null ? '–' : formatAnswerTime(ms));
  return (
    <Card title="Activity" icon={<Gauge strokeWidth={1.8} aria-hidden />}>
      <div className="@container flex flex-col gap-7">
        <dl className="m-0 grid grid-cols-2 gap-x-6 gap-y-5 @xl:grid-cols-4">
          <Figure label={countLabel} value={String(requests)} />
          <Figure label="Median answer in use" value={figure(times.median)} />
          <Figure label="95th percentile" value={figure(times.p95)} />
          <Figure
            label="Tokens per second"
            value={speed === null ? '–' : String(Math.round(speed))}
          />
        </dl>
        <BarChart aria-label="Requests per day" data={data} />
      </div>
    </Card>
  );
}

function Figure({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex min-w-0 flex-col justify-between gap-1">
      <dt className="text-ui">{label}</dt>
      <dd className="m-0 font-display text-h1 font-semibold tabular-nums">{value}</dd>
    </div>
  );
}

/* Tools and decisions */

/**
 * What the replies did: each tool by how often it was called, then what the person was asked to
 * decide and what went wrong.
 */
export function WorkCard({ messages }: { messages: readonly WorkspaceMessage[] }) {
  const tools = toolUse(messages);
  const most = tools[0]?.count ?? 0;
  const counts = oversight(messages);
  const decisions = [
    { label: 'Writes you allowed', value: counts.approved },
    { label: 'Writes waiting for you', value: counts.waiting },
    { label: 'Writes you declined', value: counts.denied },
    { label: 'Left to a person', value: counts.refusals },
    { label: 'Stopped on an error', value: counts.errors + counts.failed, danger: true },
  ];
  return (
    <Card title="Tools and decisions" icon={<FlaskConical strokeWidth={1.8} aria-hidden />}>
      <div className="flex flex-col gap-6">
        <section aria-label="Tools" className="flex flex-col gap-2">
          {tools.length === 0 ? (
            <p className="m-0 text-ui">No tools used yet</p>
          ) : (
            <ul className="m-0 flex list-none flex-col gap-2.5 p-0">
              {tools.slice(0, 6).map((tool) => (
                <li key={tool.name} className="flex flex-col gap-1.5">
                  <span className="flex items-baseline justify-between gap-3 text-ui">
                    <span className="truncate font-mono text-small">{tool.name}</span>
                    <span className="tabular-nums">{tool.count}</span>
                  </span>
                  <Meter
                    value={most === 0 ? 0 : tool.count / most}
                    label={tool.name}
                    valueText={plural(tool.count, 'call')}
                    tone="student"
                  />
                </li>
              ))}
            </ul>
          )}
        </section>
        <dl aria-label="Decisions" className="m-0 flex flex-col border-t border-line pt-3">
          {decisions.map((item) => (
            <div key={item.label} className="flex h-9 items-center justify-between gap-3 text-ui">
              <dt>{item.label}</dt>
              <dd
                className={
                  item.danger && item.value > 0
                    ? 'm-0 tabular-nums text-danger'
                    : 'm-0 tabular-nums'
                }
              >
                {item.value}
              </dd>
            </div>
          ))}
        </dl>
      </div>
    </Card>
  );
}

/* On this computer */

/** How often the home reads the runtime and the guard again while it is in view. */
const POLL_MS = 15_000;

/** Calls `then` each time a test of the run finishes, on this computer or on a hosted copy. */
function useTestFinished(runId: string | undefined, then: () => void): void {
  const latest = useRef(then);
  useEffect(() => {
    latest.current = then;
  });
  useEffect(() => {
    if (runId === undefined) return;
    return architect().runs.onEvent((payload) => {
      const event = RunEventSchema.safeParse(payload);
      if (!event.success || event.data.runId !== runId) return;
      if (event.data.type === 'eval.finished' && event.data.split === 'test') latest.current();
    });
  }, [runId]);
}

function Fact({
  icon,
  label,
  detail,
  children,
}: {
  icon: ReactNode;
  label: ReactNode;
  detail?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <li className="flex min-h-14 items-center gap-3 border-t border-line px-6 py-2.5 text-ui">
      <RowIcon>{icon}</RowIcon>
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="font-medium">{label}</span>
        {detail && <span className="text-small text-pretty">{detail}</span>}
      </span>
      {children && <span className="shrink-0 text-right tabular-nums">{children}</span>}
    </li>
  );
}

const CHECK_WORDS = {
  ready: 'Ready',
  needs_attention: 'Needs attention',
  blocked: "Can't run",
  unchecked: 'Not checked',
} as const;

/** The host and port a local address names, as the guard sees it: `127.0.0.1:11434`. */
function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

/**
 * Where the agent runs: this computer's GPU, the model build and its size, the memory it took
 * when its sealed test ran here, whether it is loaded now, its installation checks, and the
 * network guard that keeps it on this computer.
 */
export function DeploymentCard({
  agent,
  report,
}: {
  agent: GraduateSummary;
  report: ReportCard | undefined;
}) {
  const words = useWords();
  const installation = useInstallation(agent.id);
  const local = useLocalRuntimes();
  const runId = report?.runId;
  const measurements = useQuery(
    `runtime-measurements:${runId ?? ''}`,
    () => (runId === undefined ? Promise.resolve([]) : api.runtimeMeasurements(runId)),
    { refreshOnMount: true },
  );
  const blocked = useQuery('blocked-connections', api.blockedConnections, {
    refreshOnMount: true,
  });
  const title = words.lab ? 'On-premise' : 'On this computer';
  // The model loads and unloads, and the guard can stop a call, while the home is open: both are
  // read again when it opens, as each reply settles, and now and then while it is in view.
  const { reload: reloadLocal } = local;
  const { reload: reloadBlocked } = blocked;
  useEffect(() => {
    reloadLocal();
    const refresh = () => {
      reloadLocal();
      reloadBlocked();
    };
    const timer = setInterval(() => {
      if (document.visibilityState === 'visible') refresh();
    }, POLL_MS);
    const stop = onWorkspaceEvent((event) => {
      if (event.type === 'message.updated' && event.message.status !== 'streaming') refresh();
    });
    return () => {
      clearInterval(timer);
      stop();
    };
  }, [reloadLocal, reloadBlocked]);
  useTestFinished(runId, measurements.reload);

  if (installation.status === 'error') {
    return (
      <Card title={title} icon={<Cpu strokeWidth={1.8} aria-hidden />}>
        <ProblemState
          layout="inline"
          error={installation.error}
          title="Couldn't read its installation"
          onRetry={installation.reload}
        />
      </Card>
    );
  }
  if (!installation.data) {
    return (
      <Card title={title} icon={<Cpu strokeWidth={1.8} aria-hidden />}>
        <div aria-busy="true" aria-label="Loading" className="flex flex-col gap-3">
          <Skeleton className="h-4 w-2/3" />
          <Skeleton className="h-4 w-1/2" />
          <Skeleton className="h-4 w-3/5" />
        </div>
      </Card>
    );
  }
  const { student } = agent.manifest;
  const binding = installation.data.model;
  const gpu = local.data?.gpu ?? null;
  const served = local.data?.ollama.models.find((model) => model.id === binding.model);
  const figures =
    report && measurements.data
      ? runtimeFigures(measurements.data, { ...report, testedOn: 'local' })
      : null;
  const checks = installation.data.checks;
  const passed = checks.filter((check) => check.status === 'passed').length;
  const skipped = checks.filter((check) => check.status === 'skipped').length;
  const failed = checks.length - passed - skipped;
  const firstReply = figures?.coldStartMs ?? installation.data.measurements.firstReplyMs ?? null;
  const build = [
    agentModelName(student),
    student.quantization && quantizationLabel(student.quantization),
    student.adapter && 'LoRA adapter',
  ]
    .filter(Boolean)
    .join(', ');
  const runtime = student.adapter ? 'llama.cpp' : runtimeName(binding.runtime);
  const fit = served?.inMemory ? gpuFit(served, gpu) : null;
  const blockedCount = blocked.data?.length;

  return (
    <Card title={title} icon={<Cpu strokeWidth={1.8} aria-hidden />} flush>
      <ul className="m-0 list-none p-0">
        <Fact
          icon={<Cpu strokeWidth={1.8} aria-hidden />}
          label={gpu ? gpu.name : 'No GPU found'}
          detail={
            gpu
              ? `${formatBytes(gpu.memoryBytes)} ${gpu.shared ? 'shared memory' : 'of GPU memory'}`
              : 'Replies run on the CPU'
          }
        />
        <Fact
          icon={<HardDrive strokeWidth={1.8} aria-hidden />}
          label={build}
          detail={
            <span className="font-mono">
              {binding.model}, {Math.round(student.contextLength / 1024)}K context
              {runtime ? `, ${runtime}` : ''}
            </span>
          }
        >
          {student.sizeBytes !== undefined && formatBytes(student.sizeBytes)}
        </Fact>
        {figures && (figures.peakGpuBytes !== null || figures.peakProcessBytes !== null) && (
          <li className="flex flex-col gap-2 border-t border-line px-6 py-3 text-ui">
            <span className="flex items-center gap-3">
              <RowIcon>
                <MemoryStick strokeWidth={1.8} aria-hidden />
              </RowIcon>
              <span className="flex flex-1 items-center gap-1.5 font-medium">
                Memory at its peak
                <InfoTip about="Memory at its peak">
                  {`The most the runtime held while the ${words.finalTest} ran on this computer.`}
                </InfoTip>
              </span>
              <span className="tabular-nums">
                {figures.peakGpuBytes !== null && gpu
                  ? `${formatBytes(figures.peakGpuBytes)} of ${formatBytes(gpu.memoryBytes)}`
                  : formatBytes(figures.peakProcessBytes ?? figures.peakGpuBytes ?? 0)}
              </span>
            </span>
            {figures.peakGpuBytes !== null && gpu && (
              <Meter
                value={figures.peakGpuBytes / gpu.memoryBytes}
                label="GPU memory at its peak"
                valueText={`${formatBytes(figures.peakGpuBytes)} of ${formatBytes(gpu.memoryBytes)}`}
                tone="student"
                className="ml-9 w-auto"
              />
            )}
          </li>
        )}
        {!student.adapter && (
          <Fact
            icon={<MemoryStick strokeWidth={1.8} aria-hidden />}
            label={served?.inMemory ? 'Loaded' : 'Not loaded'}
            detail={
              served?.inMemory
                ? `${formatBytes(served.inMemory.gpuBytes)} on the GPU${
                    fit === 'partial'
                      ? `, ${formatBytes(served.inMemory.totalBytes - served.inMemory.gpuBytes)} on the CPU`
                      : ''
                  }`
                : 'It loads with the first request'
            }
          />
        )}
        {firstReply !== null && (
          <Fact icon={<Gauge strokeWidth={1.8} aria-hidden />} label="Cold start">
            {formatAnswerTime(firstReply)}
          </Fact>
        )}
        <Fact
          icon={
            installation.data.status === 'ready' ? (
              <CircleCheck strokeWidth={1.8} aria-hidden className="text-student" />
            ) : (
              <CircleAlert strokeWidth={1.8} aria-hidden />
            )
          }
          label={CHECK_WORDS[installation.data.status]}
          detail={
            checks.length > 0
              ? [
                  `${plural(passed, 'installation check')} passed`,
                  skipped > 0 && `${skipped} skipped`,
                  failed > 0 && `${failed} failed`,
                  installation.data.checkedAt && shortDate(installation.data.checkedAt),
                ]
                  .filter(Boolean)
                  .join(', ')
              : 'Its installation checks haven’t run'
          }
        />
        <Fact
          icon={<WifiOff strokeWidth={1.8} aria-hidden />}
          label="Offline"
          detail={
            <>
              Reaches only <span className="font-mono">{hostOf(binding.baseUrl)}</span>
              {blockedCount !== undefined &&
                `; ${blockedCount === 0 ? 'no call' : plural(blockedCount, 'call')} stopped since Architect started`}
            </>
          }
        >
          <InfoTip about="Offline" side="left">
            The agent host refuses every address but this computer before a byte leaves, so the
            agent reaches its model runtime and nothing else.
          </InfoTip>
        </Fact>
      </ul>
    </Card>
  );
}

/* Sealed final test */

interface TestRow {
  key: string;
  label: string;
  card: ReportCard;
}

const cell = (score: Score | null) => (score ? formatPercent(score) : null);

type Column = { key: keyof OrgScores; label: string };

/** Where a test ran, in a sentence. */
const PLACE_WORDS = { hosted: 'the hosted copy', local: 'this computer' } as const;

interface Drift {
  points: number;
  /** The kind of organization it moved on, with its score at graduation and in the latest test. */
  moved: { column: Column; before: Score; after: Score } | null;
  /** Where the test at graduation and the latest one ran, in a sentence. */
  from: string;
  to: string;
}

/**
 * How far the latest test moved from the one at graduation, in points, on the first kind of
 * organization where it moved at all; null with no test since.
 */
function driftOf(rows: readonly TestRow[], columns: readonly Column[]): Drift | null {
  const first = rows[0];
  const latest = rows.at(-1);
  if (rows.length < 2 || !first || !latest) return null;
  const places = { from: PLACE_WORDS[first.card.testedOn], to: PLACE_WORDS[latest.card.testedOn] };
  const [before, after] = [reportScores(first.card), reportScores(latest.card)];
  for (const column of columns) {
    const was = before[column.key];
    const is = after[column.key];
    if (!was || !is) continue;
    const points = percentOf(is) - percentOf(was);
    if (points !== 0) return { points, moved: { column, before: was, after: is }, ...places };
  }
  return { points: 0, moved: null, ...places };
}

/**
 * The drift as a row: how many points the latest test moved and on what, with both scores and
 * where each ran, so the figure explains itself; a drop is in red.
 */
function DriftFact({ drift, lab }: { drift: Drift; lab: boolean }) {
  const { moved } = drift;
  if (!moved) {
    return (
      <Fact
        icon={<Equal strokeWidth={1.8} aria-hidden />}
        label="No drift"
        detail={`The same on ${drift.to} as on ${drift.from}`}
      />
    );
  }
  const down = drift.points < 0;
  // The personal edition's one column is the score itself, so it isn't named.
  const on = lab || moved.column.key !== 'seen' ? `, ${moved.column.label.toLowerCase()}` : '';
  return (
    <Fact
      icon={
        down ? (
          <TrendingDown strokeWidth={1.8} aria-hidden className="text-danger" />
        ) : (
          <TrendingUp strokeWidth={1.8} aria-hidden />
        )
      }
      label={
        <span className={down ? 'text-danger' : undefined}>
          {`${down ? '−' : '+'}${Math.abs(drift.points)} points${on}`}
        </span>
      }
      detail={`${formatPercent(moved.after)} on ${drift.to}, against ${formatPercent(moved.before)} on ${drift.from}`}
    />
  );
}

/**
 * Its sealed final test when it graduated, and every retest since on another endpoint, so a drift
 * shows; then its risk certificate and its regression suite.
 */
export function EvidenceCard({ agent, report }: { agent: GraduateSummary; report: ReportCard }) {
  const words = useWords();
  // A retest can finish while the home is closed or open: what was tested is read again on both.
  const targets = useQuery(
    `report-targets:${report.runId}`,
    () => api.reportTargets(report.runId),
    { refreshOnMount: true },
  );
  const retargets = (targets.data ?? []).filter((target) => target !== report.testedOn);
  const retests = useQuery(
    `retests:${report.runId}:${retargets.join(',')}`,
    () => Promise.all(retargets.map((target) => api.report(report.runId, target))),
    { refreshOnMount: true },
  );
  const suite = useQuery(`fieldCounterexamples:${agent.manifest.jobId}`, () =>
    mentoringApi.fieldCounterexamples(agent.manifest.jobId),
  );
  // The run's own card carries what was measured on it since, such as its certificate.
  const own = useReport(report.runId);
  const graduated = own.data ?? report;
  useTestFinished(report.runId, () => {
    targets.reload();
    retests.reload();
    own.reload();
  });
  // A retest is another endpoint's card; one that is the graduation's own again isn't.
  const since = (retests.data ?? []).filter((card) => card.testedOn !== graduated.testedOn);
  const rows: TestRow[] = [graduated, ...since].map((card) => ({
    key: card.testedOn,
    label: card.testedOn === 'hosted' ? 'Hosted copy' : 'This computer',
    card,
  }));
  const scored = rows.map((row) => ({ ...row, scores: reportScores(row.card) }));
  const columns = (
    [
      { key: 'seen', label: words.lab ? 'Taught on' : 'Score' },
      { key: 'unseen', label: 'Never seen' },
      { key: 'real', label: 'Real' },
    ] as const
  ).filter(
    (column) => column.key === 'seen' || scored.some((row) => row.scores[column.key] !== null),
  );
  const drift = driftOf(rows, columns);
  const certificate = graduated.certificate;
  const notHeld = notHeldLine(certificate, words.finalTest);
  const figure = certificateFigure(certificate);
  const { passRate } = agent.manifest.requirements;
  const { score } = agent.manifest.test;

  return (
    <Card title={words.FinalTest} icon={<ShieldCheck strokeWidth={1.8} aria-hidden />} flush>
      <div
        role="table"
        aria-label={`${words.FinalTest} at graduation and since`}
        className="grid px-6 pb-3 text-ui tabular-nums"
        style={{
          gridTemplateColumns: `minmax(0,1fr) repeat(${columns.length}, minmax(56px, auto))`,
        }}
      >
        <div role="row" className="contents">
          <span role="columnheader" className="py-2 text-small font-medium">
            Where
          </span>
          {columns.map((column) => (
            <span
              key={column.key}
              role="columnheader"
              className="self-end py-2 pl-3 text-right text-small font-medium"
            >
              {column.label}
            </span>
          ))}
        </div>
        {scored.map((row) => (
          <div key={row.key} role="row" className="contents">
            <span role="cell" className="flex h-14 flex-col justify-center border-t border-line">
              <span>{row.label}</span>
              <span className="text-small">{shortDate(row.card.createdAt)}</span>
            </span>
            {columns.map((column) => (
              <span
                key={column.key}
                role="cell"
                className="flex h-14 items-center justify-end border-t border-line pl-3 font-display text-body font-semibold"
              >
                {cell(row.scores[column.key]) ?? '–'}
              </span>
            ))}
          </div>
        ))}
      </div>
      <ul className="m-0 list-none p-0">
        {drift && <DriftFact drift={drift} lab={words.lab} />}
        {!passRate.met && (
          <Fact
            icon={<CircleAlert strokeWidth={1.8} aria-hidden />}
            label={`Needs ${Math.round(passRate.target * 100)}%`}
            detail={`It passed ${score.pass} of ${score.total}; check its answers before relying on them.`}
          />
        )}
        <Fact
          icon={<ShieldCheck strokeWidth={1.8} aria-hidden />}
          label={words.lab ? 'Risk certificate' : 'Certified answers'}
          detail={
            certificate?.issued
              ? `${certificateSentence(certificate, agent.name)}${notHeld ? ` ${notHeld}.` : ''}`
              : certificate
                ? certificateHint(certificate)
                : `None; ${agent.name} answers every request it takes.`
          }
        >
          {figure}
        </Fact>
        <Fact
          icon={<FlaskConical strokeWidth={1.8} aria-hidden />}
          label={
            <span className="flex items-center gap-1.5">
              {words.lab ? 'Regression suite' : 'Counterexamples'}
              <InfoTip about={words.lab ? 'Regression suite' : 'Counterexamples'}>
                {defineTerm('regressionSuite')}
              </InfoTip>
            </span>
          }
        >
          {suite.data ? plural(suite.data.length, 'counterexample') : null}
        </Fact>
      </ul>
    </Card>
  );
}
