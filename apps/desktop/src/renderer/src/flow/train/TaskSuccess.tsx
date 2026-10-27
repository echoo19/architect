import { Fragment } from 'react';
import { cn, Panel } from '@architect/ui';
import { formatRate } from '../format';
import { CURVE_BOX, curveGeometry, describeCurve, PLOT, type CurveInput } from './curve';
import type { LiveRun } from './run-state';

/** The pass rate on tasks the student never practices on, round by round. */
export function TaskSuccess({ live }: { live: LiveRun }) {
  const { run, job, rounds } = live;
  const score = run.devCurrent ?? run.devBaseline;
  const input: CurveInput = {
    baseline: run.devBaseline,
    rounds,
    target: job.requirements.passRate,
    maxRounds: job.budget.maxRounds,
  };
  return (
    <Panel aria-label="Task success" className="min-w-0 flex-[7_1_560px] gap-2.5 px-8 pb-5 pt-7">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <span className="text-hero font-medium leading-none tracking-tightest tabular-nums">
          {score ? formatRate(score) : '–'}
        </span>
        <span className="text-fg-secondary">right on tasks it hasn&apos;t practiced</span>
      </div>
      <CurveChart input={input} />
    </Panel>
  );
}

function CurveChart({ input }: { input: CurveInput }) {
  const { ticks, line, branches, head, targetY } = curveGeometry(input);
  const points = line.map((point) => `${point.x.toFixed(1)},${point.y.toFixed(1)}`).join(' ');
  return (
    <svg
      viewBox={`0 0 ${CURVE_BOX.width} ${CURVE_BOX.height}`}
      width="100%"
      role="img"
      aria-label={describeCurve(input)}
      className="block overflow-visible"
    >
      <line
        x1={PLOT.left}
        x2={PLOT.right}
        y1={targetY}
        y2={targetY}
        className="stroke-fg-faint"
        strokeDasharray="2 4"
      />
      <text x={PLOT.right + 12} y={targetY + 4.4} className="fill-fg-secondary font-mono text-sm">
        Ready
      </text>
      <line
        x1={PLOT.left}
        x2={PLOT.right}
        y1={PLOT.bottom}
        y2={PLOT.bottom}
        className="stroke-line-card"
      />
      {ticks.map((tick) => (
        <Fragment key={tick.round}>
          <line
            x1={tick.x}
            x2={tick.x}
            y1={PLOT.gridTop}
            y2={PLOT.bottom}
            className="stroke-line-row"
          />
          <text
            x={tick.x}
            y={PLOT.labelY}
            textAnchor="middle"
            className={cn(
              'font-mono text-sm',
              tick.reached ? 'fill-fg-secondary' : 'fill-fg-ghost',
            )}
          >
            {tick.round}
          </text>
        </Fragment>
      ))}
      {branches.map((branch) => (
        <Fragment key={branch.round}>
          <polyline
            points={`${branch.from.x},${branch.from.y} ${branch.to.x},${branch.to.y}`}
            fill="none"
            className="stroke-fg-ghost"
            strokeWidth={1.5}
            strokeDasharray="3 4"
          />
          <circle
            cx={branch.to.x}
            cy={branch.to.y}
            r={4}
            className="fill-panel stroke-fg-faint"
            strokeWidth={1.5}
          >
            <title>{`Round ${branch.round} reverted at ${Math.round(branch.to.value)}%`}</title>
          </circle>
        </Fragment>
      ))}
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
          className="fill-fg-muted text-base"
        >
          The curve starts once the first check is scored
        </text>
      )}
    </svg>
  );
}
