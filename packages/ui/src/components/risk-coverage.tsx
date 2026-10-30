import { motion } from 'motion/react';
import { cn } from '../lib/cn';
import { springs } from '../motion/springs';

export interface RiskCoveragePoint {
  /** Share of requests answered, 0 to 1. */
  coverage: number;
  /** The upper bound on the error among answered requests, 0 to 1. */
  bound: number;
  /** The error observed among answered requests; null when none were answered. */
  risk: number | null;
}

export interface RiskCoveragePlotProps {
  'aria-label': string;
  /** One point per threshold, in any order. */
  points: readonly RiskCoveragePoint[];
  /** The point that was certified, by its index in `points`. */
  chosen?: number;
  /** The error the bound had to stay under. */
  target: number;
  className?: string;
}

const percent = (value: number) => `${Math.round(value * 100)}%`;

/** The plot's top: room above the target for the bound to rise, never past 100%. */
export function riskTop(target: number): number {
  return Math.min(1, Math.ceil(target * 25) / 10);
}

/** Where a value sits from the bottom, 0 to 100, held inside the plot. */
function heightOf(value: number, top: number): number {
  return Math.min(100, Math.max(0, (value / top) * 100));
}

/**
 * How often a graduate is wrong when it answers, against how much it answers: for each agreement
 * threshold, the bound on its error (a line) and the error seen (a dot), with the target and the
 * certified point marked. Bounds above the plot's top sit on its edge.
 */
export function RiskCoveragePlot({
  points,
  chosen,
  target,
  className,
  ...props
}: RiskCoveragePlotProps) {
  const top = riskTop(target);
  const ordered = [...points].sort((a, b) => a.coverage - b.coverage);
  const line = ordered
    .map((point) => `${point.coverage * 100},${100 - heightOf(point.bound, top)}`)
    .join(' ');
  const certified = chosen === undefined ? undefined : points[chosen];
  const guides = [0, target, top];
  return (
    <figure
      aria-label={props['aria-label']}
      className={cn('m-0 grid grid-cols-[48px_1fr] gap-x-3 gap-y-2 text-small', className)}
    >
      <span aria-hidden className="relative h-48 tabular-nums">
        {guides.map((guide) => (
          <span
            key={guide}
            className="absolute right-0 translate-y-1/2"
            style={{ bottom: `${heightOf(guide, top)}%` }}
          >
            {percent(guide)}
          </span>
        ))}
      </span>
      <span className="relative h-48">
        <svg
          aria-hidden
          viewBox="0 0 100 100"
          preserveAspectRatio="none"
          className="absolute inset-0 size-full overflow-visible"
        >
          {guides.map((guide) => (
            <line
              key={guide}
              x1={0}
              x2={100}
              y1={100 - heightOf(guide, top)}
              y2={100 - heightOf(guide, top)}
              vectorEffect="non-scaling-stroke"
              className={guide === target ? 'stroke-line-strong' : 'stroke-line'}
              strokeWidth={1}
            />
          ))}
          <polyline
            points={line}
            fill="none"
            vectorEffect="non-scaling-stroke"
            className="stroke-fg"
            strokeWidth={1.5}
            strokeLinejoin="round"
          />
        </svg>
        {ordered.map((point) =>
          point.risk === null ? null : (
            <span
              key={`${point.coverage}-${point.bound}`}
              aria-hidden
              className="absolute size-1.5 -translate-x-1/2 translate-y-1/2 rounded-full bg-fg"
              style={{ left: `${point.coverage * 100}%`, bottom: `${heightOf(point.risk, top)}%` }}
            />
          ),
        )}
        {certified && (
          <motion.span
            aria-hidden
            initial={{ scale: 0 }}
            animate={{ scale: 1 }}
            transition={springs.snappy}
            className="absolute size-3 -translate-x-1/2 translate-y-1/2 rounded-full bg-student"
            style={{
              left: `${certified.coverage * 100}%`,
              bottom: `${heightOf(certified.bound, top)}%`,
            }}
          />
        )}
        <span
          aria-hidden
          className="absolute left-1 pb-1"
          style={{ bottom: `${heightOf(target, top)}%` }}
        >
          Target
        </span>
      </span>
      <span />
      <span aria-hidden className="relative flex justify-between tabular-nums">
        <span>0%</span>
        <span>Answered</span>
        <span>100%</span>
      </span>
      <span />
      <figcaption className="flex flex-wrap gap-x-5 gap-y-1 pt-2">
        <span className="flex items-center gap-2">
          <span aria-hidden className="h-0.5 w-4 rounded-full bg-fg" />
          Wrong at most
        </span>
        <span className="flex items-center gap-2">
          <span aria-hidden className="size-1.5 rounded-full bg-fg" />
          Wrong, as measured
        </span>
        {certified && (
          <span className="flex items-center gap-2">
            <span aria-hidden className="size-3 rounded-full bg-student" />
            Certified
          </span>
        )}
      </figcaption>
    </figure>
  );
}
