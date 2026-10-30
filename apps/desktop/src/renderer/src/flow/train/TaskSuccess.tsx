import { Fragment } from 'react';
import { cn, EvidenceMark, Panel, Tooltip } from '@architect/ui';
import { formatRate } from '../format';
import {
  CURVE_BOX,
  curveGeometry,
  describeCurve,
  PLOT,
  type CurveGeometry,
  type CurveInput,
} from './curve';
import { draftRoundOf } from './draft';
import type { ModelNames } from './phase';
import { hasEnded, type LiveRun } from './run-state';

/** The share of check tasks right, round by round. The student never practices on them. */
export function TaskSuccess({ live, names }: { live: LiveRun; names: ModelNames }) {
  const { run, job, rounds } = live;
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
  const geometry = curveGeometry(input);
  const ended = hasEnded(run);
  return (
    <Panel
      aria-label="Score on the check tasks"
      className="min-w-0 flex-[7_1_560px] gap-2.5 px-8 pb-5 pt-7"
    >
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <span
          className={cn(
            'font-display text-hero font-semibold leading-none tabular-nums',
            !score && 'text-fg',
          )}
        >
          {score ? formatRate(score) : '–'}
        </span>
        <Tooltip
          content={`${names.mentor} never practices on these. It sees only the score, and a change stays only if the score goes up.`}
        >
          <span className="cursor-help">
            <EvidenceMark kind="check" className="text-body text-fg">
              on check tasks
            </EvidenceMark>
          </span>
        </Tooltip>
        {score && (
          <span className="text-small tabular-nums text-fg">
            {runs > 1
              ? `${Math.round((score.pass / runs) * 10) / 10} of ${job.splits.dev}`
              : `${score.pass} of ${score.total}`}
          </span>
        )}
        {geometry.branches.length > 0 && <Legend />}
      </div>
      <CurveChart input={input} geometry={geometry} ended={ended} />
    </Panel>
  );
}

/** What the two kinds of point mean, once a change that wasn't kept has its own. */
function Legend() {
  return (
    <span aria-hidden className="ml-auto flex items-center gap-4 text-small text-fg">
      <span className="flex items-center gap-1.5">
        <svg width={10} height={10} viewBox="0 0 10 10">
          <circle cx={5} cy={5} r={4} className="fill-student" />
        </svg>
        Score now
      </span>
      <span className="flex items-center gap-1.5">
        <svg width={26} height={10} viewBox="0 0 26 10">
          <line
            x1={1}
            x2={17}
            y1={5}
            y2={5}
            className="stroke-line-strong"
            strokeWidth={1.5}
            strokeDasharray="3 3"
          />
          <circle cx={21} cy={5} r={3.5} className="fill-card stroke-fg" strokeWidth={1.5} />
        </svg>
        Not kept
      </span>
    </span>
  );
}

function CurveChart({
  input,
  geometry,
  ended,
}: {
  input: CurveInput;
  geometry: CurveGeometry;
  /** The run is over, so a curve with no score will never get one. */
  ended: boolean;
}) {
  const { ticks, valueTicks, line, branches, head, pending, targetY } = geometry;
  const points = line.map((point) => `${point.x.toFixed(1)},${point.y.toFixed(1)}`).join(' ');
  const target = Math.round(input.target * 100);
  return (
    <svg
      viewBox={`0 0 ${CURVE_BOX.width} ${CURVE_BOX.height}`}
      width="100%"
      role="img"
      aria-label={describeCurve(input)}
      className="block overflow-visible"
    >
      {valueTicks.map((tick) => (
        <Fragment key={tick.value}>
          <line x1={PLOT.left} x2={PLOT.right} y1={tick.y} y2={tick.y} className="stroke-line" />
          <text
            x={PLOT.left - 10}
            y={tick.y + 4.4}
            textAnchor="end"
            className="fill-fg font-mono text-small"
          >
            {tick.value}%
          </text>
        </Fragment>
      ))}
      <line
        x1={PLOT.left}
        x2={PLOT.right}
        y1={targetY}
        y2={targetY}
        className="stroke-fg/40"
        strokeDasharray="2 4"
      />
      <text x={PLOT.right + 12} y={targetY + 4.4} className="fill-fg font-mono text-small">
        Target {target}%
      </text>
      <line
        x1={PLOT.left}
        x2={PLOT.right}
        y1={PLOT.bottom}
        y2={PLOT.bottom}
        className="stroke-line-strong"
      />
      {ticks.map((tick) => (
        <Fragment key={tick.round}>
          <line
            x1={tick.x}
            x2={tick.x}
            y1={PLOT.gridTop}
            y2={PLOT.bottom}
            className="stroke-line"
          />
          <text
            x={tick.x}
            y={PLOT.labelY}
            textAnchor="middle"
            className={cn(
              'font-mono text-small',
              tick.round === pending?.round && 'fill-mentor',
              tick.round !== pending?.round && 'fill-fg',
              tick.reached && 'font-medium',
            )}
          >
            {tick.round === 0 ? 'Start' : tick.round}
          </text>
        </Fragment>
      ))}
      {branches.map((branch) => (
        <Fragment key={branch.round}>
          <polyline
            points={`${branch.from.x},${branch.from.y} ${branch.to.x},${branch.to.y}`}
            fill="none"
            className="stroke-line-strong"
            strokeWidth={1.5}
            strokeDasharray="3 4"
          />
          <circle
            cx={branch.to.x}
            cy={branch.to.y}
            r={4}
            className="fill-card stroke-fg"
            strokeWidth={1.5}
          >
            <title>{`Round ${branch.round}, not kept: ${Math.round(branch.to.value)}%`}</title>
          </circle>
        </Fragment>
      ))}
      {pending && (
        <>
          <line
            x1={pending.x}
            x2={pending.x}
            y1={PLOT.gridTop}
            y2={PLOT.bottom}
            className="stroke-mentor"
            strokeWidth={1.5}
            strokeDasharray="2 4"
          >
            <title>{`Round ${pending.round} in progress`}</title>
          </line>
        </>
      )}
      {line.length > 1 && (
        <polyline
          points={points}
          fill="none"
          className="stroke-student"
          strokeWidth={2.25}
          strokeLinejoin="round"
          strokeLinecap="round"
        />
      )}
      {head && <circle cx={head.x} cy={head.y} r={4.5} className="fill-student" />}
      {!head && (
        <text
          x={(PLOT.left + PLOT.right) / 2}
          y={(PLOT.gridTop + PLOT.bottom) / 2}
          textAnchor="middle"
          className="fill-fg text-ui"
        >
          {ended ? 'Not scored' : 'Not scored yet'}
        </text>
      )}
    </svg>
  );
}
