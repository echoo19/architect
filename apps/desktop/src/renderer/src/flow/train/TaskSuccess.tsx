import type { ReactNode } from 'react';
import type { Job, Round } from '@architect/shared';
import {
  cn,
  EvidenceMark,
  LineChart,
  NumberTicker,
  Tooltip,
  type ChartMark,
  type LegendItem,
} from '@architect/ui';
import { TrendingDown, TrendingUp } from 'lucide-react';
import { formatUsd } from '../../lib/format';
import { useWords } from '../../shell/edition';
import { Counted } from '../counted';
import { percent, signed } from '../format';
import { curveData, describeCurve, type CurveData, type CurveInput } from './curve';
import { roundShortfall } from './decision';
import { draftRoundOf } from './draft';
import { DISPOSITIONS, FIRST_DRAFT } from './evidence-words';
import type { ModelNames } from './phase';
import { hasEnded, type LiveRun } from './run-state';

/**
 * The share of check tasks right, round by round, against the target: the number the run is
 * working toward, with the practice tasks beside it. The student never practices on check tasks.
 */
export function TaskSuccess({
  live,
  names,
  onOpenRound,
  aside,
}: {
  live: LiveRun;
  names: ModelNames;
  onOpenRound: (round: Round) => void;
  /** What goes under the score: the budget. */
  aside?: ReactNode;
}) {
  const { run, job, rounds } = live;
  const w = useWords();
  const score = run.devCurrent ?? run.devBaseline;
  // A change measured twice is kept on both measurements added up, so the count can span two.
  const runs = score && job.splits.dev > 0 ? Math.round(score.total / job.splits.dev) : 1;
  const input: CurveInput = {
    baseline: run.devBaseline,
    rounds,
    target: job.requirements.passRate,
    maxRounds: job.budget.maxRounds,
    draftRound: draftRoundOf(live),
  };
  // Two runs are counted as they were run, "62 of 80, 2 runs", never as an average of one.
  const repeated = runs > 1 ? `, ${runs} runs` : '';
  const gain =
    run.devCurrent && run.devBaseline ? percent(run.devCurrent) - percent(run.devBaseline) : 0;
  const Trend = gain < 0 ? TrendingDown : TrendingUp;
  return (
    <section
      aria-label={`Score on the ${w.checks}`}
      className="grid grid-cols-1 items-start gap-x-14 gap-y-8 lg:grid-cols-[264px_minmax(0,1fr)]"
    >
      <div className="flex flex-col gap-6">
        <span
          className={cn(
            'font-display text-hero font-semibold leading-none tabular-nums',
            !score && 'text-fg-dim',
          )}
        >
          {score ? (
            <Counted said={`${percent(score)}%`}>
              <NumberTicker value={percent(score)} kind="percent" />
            </Counted>
          ) : (
            '–'
          )}
        </span>
        <div className="flex flex-col gap-2">
          <Tooltip
            content={`${names.mentor} never teaches from these. It sees only the score, and a change stays only if the score goes up.`}
          >
            <span tabIndex={0} className="w-fit cursor-help rounded-mark">
              <EvidenceMark kind="check" className="text-ui font-medium">
                {w.Checks}
              </EvidenceMark>
            </span>
          </Tooltip>
          {score && (
            <span className="text-ui tabular-nums">
              <Counted said={`${score.pass} of ${score.total}${repeated}`}>
                <NumberTicker value={score.pass} /> of <NumberTicker value={score.total} />
                {repeated}
              </Counted>
            </span>
          )}
          {gain !== 0 && run.devBaseline && (
            <span className="flex items-center gap-2 text-ui tabular-nums">
              <Trend
                size={16}
                strokeWidth={1.8}
                aria-hidden
                className={gain > 0 ? 'text-student' : 'text-danger'}
              />
              {signed(gain)} points from {percent(run.devBaseline)}%
            </span>
          )}
        </div>
        <ByOrganization live={live} />
        {aside}
      </div>
      <ProgressCurve
        job={job}
        input={input}
        rounds={rounds}
        ended={hasEnded(run)}
        mentor={names.mentor}
        onOpenRound={onOpenRound}
      />
    </section>
  );
}

/**
 * The check score at each organization a field is taught on (decision 085), so it shows where
 * the number comes from, counted over every run of the check tasks as the score above is.
 * Nothing for a job of one organization.
 */
function ByOrganization({ live }: { live: LiveRun }) {
  const w = useWords();
  const { run, job } = live;
  const rows = (job.organizations ?? []).flatMap((org) => {
    const score = run.devByOrg?.find((entry) => entry.org === org.id);
    return score === undefined || score.total === 0 ? [] : [{ org, score }];
  });
  if (rows.length === 0) return null;
  return (
    <ul aria-label={`${w.Checks} by organization`} className="m-0 flex list-none flex-col p-0">
      {rows.map(({ org, score }) => (
        <li
          key={org.id}
          aria-label={`${org.name}: ${score.pass} of ${score.total}`}
          className="flex items-baseline justify-between gap-6 border-t border-line py-2 text-ui"
        >
          <span className="truncate">{org.name}</span>
          <span className="shrink-0 tabular-nums">
            {percent(score)}% ({score.pass} of {score.total})
          </span>
        </li>
      ))}
    </ul>
  );
}

/** The curve's marks: a dot where the kept harness was measured, a ring for a change undone. */
function marksOf(data: CurveData): ChartMark[] {
  return [
    ...data.kept.map((point): ChartMark => ({
      key: `kept-${point.round}`,
      x: point.round,
      y: point.value,
      kind: 'dot',
      tone: 'student',
      title:
        point.round === 0
          ? `Start: ${Math.round(point.value)}%`
          : `Round ${point.round}, kept: ${Math.round(point.value)}%`,
    })),
    ...data.branches.map((branch): ChartMark => ({
      key: `undone-${branch.round}`,
      x: branch.round,
      y: branch.to,
      from: branch.from,
      kind: 'ring',
      tone: 'fg',
      title: `Round ${branch.round}, not kept: ${Math.round(branch.to)}%`,
    })),
  ];
}

function ProgressCurve({
  job,
  input,
  rounds,
  ended,
  mentor,
  onOpenRound,
}: {
  job: Job;
  input: CurveInput;
  rounds: readonly Round[];
  /** The run is over, so a curve with no score will never get one. */
  ended: boolean;
  mentor: string;
  onOpenRound: (round: Round) => void;
}) {
  const w = useWords();
  const data = curveData(input);
  const legend: LegendItem[] = [
    { label: w.Checks, tone: 'student', kind: 'main' },
    ...(data.practice.length > 0
      ? [{ label: 'Practice tasks', tone: 'fg' as const, kind: 'line' as const }]
      : []),
    ...(data.branches.length > 0
      ? [{ label: 'Not kept', tone: 'fg' as const, kind: 'ring' as const }]
      : []),
  ];
  const roundAt = (x: number) => rounds.find((round) => round.index === x);
  return (
    <LineChart
      label={describeCurve(input, w.checks)}
      xMax={data.span}
      xTicks={data.ticks.map((tick) => ({
        value: tick.round,
        label: tick.round === 0 ? 'Start' : String(tick.round),
        reached: tick.reached,
      }))}
      yRange={data.range}
      yTicks={data.valueTicks.map((value) => ({ value, label: `${value}%` }))}
      series={[
        {
          id: 'checks',
          tone: 'student',
          main: true,
          points: data.line.map((point) => ({ x: point.round, y: point.value })),
        },
        {
          id: 'practice',
          tone: 'fg',
          points: data.practice.map((point) => ({ x: point.round, y: point.value })),
        },
      ]}
      marks={marksOf(data)}
      reference={{ y: data.target, label: `Target ${Math.round(data.target)}%` }}
      head={data.head && { x: data.head.round, y: data.head.value }}
      live={
        data.pending === null
          ? null
          : { x: data.pending, title: `Round ${data.pending} in progress` }
      }
      empty={data.head ? undefined : ended ? 'Not scored' : 'Not scored yet'}
      legend={legend}
      readout={(x) => (
        <Readout
          x={x}
          data={data}
          round={roundAt(x)}
          job={job}
          input={input}
          mentor={mentor}
        />
      )}
      onPick={(x) => {
        const round = roundAt(x);
        if (round) onOpenRound(round);
      }}
      height={300}
    />
  );
}

/** What the chart says about one round while the pointer is over it. */
function Readout({
  x,
  data,
  round,
  job,
  input,
  mentor,
}: {
  x: number;
  data: CurveData;
  round: Round | undefined;
  job: Job;
  input: CurveInput;
  mentor: string;
}) {
  const w = useWords();
  if (x === 0 || !round) {
    const start = data.line[0];
    return (
      <div className="flex flex-col gap-0.5">
        <span className="font-medium">Start</span>
        {start && (
          <span className="tabular-nums">
            {Math.round(start.value)}% {w.checks}
          </span>
        )}
      </div>
    );
  }
  const draft = round.index === input.draftRound;
  const shortfall = draft ? null : roundShortfall(round, job, w);
  const outcome = round.decision
    ? draft
      ? FIRST_DRAFT.label
      : DISPOSITIONS[round.decision].label
    : round.status === 'failed'
      ? 'Failed'
      : 'In progress';
  return (
    <div className="flex max-w-72 flex-col gap-0.5">
      <span className="truncate font-medium">
        Round {round.index}
        {round.title ? `, ${round.title}` : ''}
      </span>
      <span className="tabular-nums">
        {round.devBefore && round.devAfter
          ? `${percent(round.devBefore)}% → ${percent(round.devAfter)}%, ${outcome}`
          : outcome}
      </span>
      {shortfall && <span className="tabular-nums">{shortfall}</span>}
      {round.train.total > 0 && (
        <span className="tabular-nums">
          Practice {round.train.pass} of {round.train.total}
        </span>
      )}
      {round.costUsd > 0 && (
        <span className="tabular-nums">
          {mentor} {formatUsd(round.costUsd)}
        </span>
      )}
    </div>
  );
}
