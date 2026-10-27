import { Fragment, type ReactNode } from 'react';
import { cn, Panel } from '@architect/ui';
import { formatRate } from '../format';
import { modelNames } from '../names';
import { CURVE_BOX, curveGeometry, describeCurve, PLOT, type CurveInput } from './curve';
import type { LiveRun } from './run-state';

/** The share of check tasks right, round by round. The student never practices on them. */
export function TaskSuccess({ live }: { live: LiveRun }) {
  const { run, job, rounds } = live;
  const { student } = modelNames(job);
  const score = run.devCurrent ?? run.devBaseline;
  const input: CurveInput = {
    baseline: run.devBaseline,
    rounds,
    target: job.requirements.passRate,
    maxRounds: job.budget.maxRounds,
  };
  return (
    <Panel
      aria-label="Check tasks right"
      className="min-w-0 flex-[7_1_560px] gap-2.5 px-8 pb-5 pt-7"
    >
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <span className="text-hero font-medium leading-none tracking-tightest tabular-nums">
          {score ? formatRate(score) : '–'}
        </span>
        <span className="text-fg-secondary">of check tasks right with the best version so far</span>
        {score && (
          <span className="font-mono text-sm text-fg-muted">
            {score.pass} of {score.total}
          </span>
        )}
      </div>
      <p className="m-0 text-fg-secondary text-pretty">
        {student} never practices on the check tasks. A change stays only if more of them come out
        right, and training ends when they reach the {Math.round(input.target * 100)}% target.
      </p>
      <Legend />
      <CurveChart input={input} />
    </Panel>
  );
}

function LegendItem({ swatch, children }: { swatch: ReactNode; children: ReactNode }) {
  return (
    <li className="flex items-center gap-2">
      <svg width={26} height={12} viewBox="0 0 26 12" aria-hidden className="shrink-0">
        {swatch}
      </svg>
      {children}
    </li>
  );
}

/** What the chart's marks mean: kept changes, reverted ones, and the round still running. */
function Legend() {
  return (
    <ul
      aria-label="Legend"
      className="m-0 flex list-none flex-wrap gap-x-5 gap-y-1 p-0 text-sm text-fg-secondary"
    >
      <LegendItem
        swatch={
          <>
            <line x1={1} x2={20} y1={6} y2={6} className="stroke-student" strokeWidth={2.25} />
            <circle cx={20} cy={6} r={3.5} className="fill-student" />
          </>
        }
      >
        Kept change
      </LegendItem>
      <LegendItem
        swatch={
          <>
            <line
              x1={1}
              x2={18}
              y1={6}
              y2={6}
              className="stroke-fg-ghost"
              strokeWidth={1.5}
              strokeDasharray="3 3"
            />
            <circle
              cx={20}
              cy={6}
              r={3.5}
              className="fill-panel stroke-fg-faint"
              strokeWidth={1.5}
            />
          </>
        }
      >
        Reverted change
      </LegendItem>
      <LegendItem
        swatch={
          <>
            <line
              x1={1}
              x2={18}
              y1={6}
              y2={6}
              className="stroke-mentor"
              strokeWidth={1.5}
              strokeDasharray="2 3"
            />
            <circle cx={20} cy={6} r={3.5} className="fill-panel stroke-mentor" strokeWidth={1.5} />
          </>
        }
      >
        Round in progress
      </LegendItem>
    </ul>
  );
}

function CurveChart({ input }: { input: CurveInput }) {
  const { ticks, valueTicks, line, branches, head, pending, targetY } = curveGeometry(input);
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
      <text x={0} y={PLOT.top - 18} className="fill-fg-muted text-sm">
        Check tasks right
      </text>
      {valueTicks.map((tick) => (
        <Fragment key={tick.value}>
          <line
            x1={PLOT.left}
            x2={PLOT.right}
            y1={tick.y}
            y2={tick.y}
            className="stroke-line-row"
          />
          <text
            x={PLOT.left - 10}
            y={tick.y + 4.4}
            textAnchor="end"
            className="fill-fg-muted font-mono text-sm"
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
        className="stroke-fg-faint"
        strokeDasharray="2 4"
      />
      <text x={PLOT.right + 12} y={targetY + 4.4} className="fill-fg-secondary font-mono text-sm">
        Target {target}%
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
            {tick.round === 0 ? 'Start' : tick.round}
          </text>
        </Fragment>
      ))}
      <text x={PLOT.right + 12} y={PLOT.labelY} className="fill-fg-muted text-sm">
        Round
      </text>
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
      {pending && (
        <>
          <polyline
            points={`${pending.from.x},${pending.from.y} ${pending.to.x},${pending.to.y}`}
            fill="none"
            className="stroke-mentor"
            strokeWidth={1.5}
            strokeDasharray="2 4"
          />
          <circle
            cx={pending.to.x}
            cy={pending.to.y}
            r={4}
            className="fill-panel stroke-mentor"
            strokeWidth={1.5}
          >
            <title>{`Round ${pending.round} in progress`}</title>
          </circle>
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
          className="fill-fg-muted text-base"
        >
          The line starts once the check tasks are first scored
        </text>
      )}
    </svg>
  );
}
