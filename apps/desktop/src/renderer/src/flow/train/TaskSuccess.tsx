import { Fragment } from 'react';
import { cn, EvidenceMark, NumberTicker, Tooltip } from '@architect/ui';
import { Counted } from '../counted';
import { percent } from '../format';
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

/**
 * The share of check tasks right, round by round, against the target: the number the run is
 * working toward. The student never practices on these tasks.
 */
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
  const pass = score ? (runs > 1 ? Math.round((score.pass / runs) * 10) / 10 : score.pass) : null;
  const total = runs > 1 ? job.splits.dev : (score?.total ?? 0);
  return (
    <section
      aria-label="Score on the check tasks"
      className="grid grid-cols-1 items-center gap-x-12 gap-y-8 lg:grid-cols-[minmax(0,1fr)_700px]"
    >
      <div className="flex flex-col gap-4">
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
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
          <Tooltip
            content={`${names.mentor} never practices on these. It sees only the score, and a change stays only if the score goes up.`}
          >
            <span tabIndex={0} className="cursor-help rounded-mark">
              <EvidenceMark kind="check" className="text-ui">
                check tasks
              </EvidenceMark>
            </span>
          </Tooltip>
          {pass !== null && (
            <span className="text-ui tabular-nums">
              <Counted said={`${pass} of ${total}`}>
                {Number.isInteger(pass) ? <NumberTicker value={pass} /> : pass} of{' '}
                <NumberTicker value={total} />
              </Counted>
            </span>
          )}
        </div>
        <ByOrganization live={live} runs={runs} />
      </div>
      <CurveChart input={input} geometry={geometry} ended={ended} />
    </section>
  );
}

/**
 * The check score at each organization a field is taught on (decision 085), so it shows where
 * the number comes from, counted per run of the check tasks as the score above is. Nothing for a
 * job of one organization.
 */
function ByOrganization({ live, runs }: { live: LiveRun; runs: number }) {
  const { run, job } = live;
  const perRun = (value: number) => (runs > 1 ? Math.round((value / runs) * 10) / 10 : value);
  const rows = (job.organizations ?? []).flatMap((org) => {
    const score = run.devByOrg?.find((entry) => entry.org === org.id);
    return score === undefined || score.total === 0 ? [] : [{ org, score }];
  });
  if (rows.length === 0) return null;
  return (
    <ul aria-label="Check tasks by organization" className="m-0 flex list-none flex-col p-0">
      {rows.map(({ org, score }) => (
        <li
          key={org.id}
          aria-label={`${org.name}: ${perRun(score.pass)} of ${perRun(score.total)}`}
          className="flex max-w-80 items-baseline justify-between gap-6 border-t border-line py-1.5 text-ui first:border-t-0"
        >
          <span className="truncate">{org.name}</span>
          <span className="tabular-nums">
            {percent(score)}% · {perRun(score.pass)}/{perRun(score.total)}
          </span>
        </li>
      ))}
    </ul>
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
      <text
        x={CURVE_BOX.width}
        y={targetY + 4.4}
        textAnchor="end"
        className="fill-fg font-mono text-small"
      >
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
