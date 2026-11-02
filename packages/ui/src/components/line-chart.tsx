import { useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { motion } from 'motion/react';
import { cn } from '../lib/cn';
import { springs } from '../motion/springs';

export type ChartTone = 'student' | 'mentor' | 'fg';

export interface ChartPoint {
  x: number;
  y: number;
}

export interface LineSeries {
  id: string;
  tone: ChartTone;
  points: readonly ChartPoint[];
  /**
   * The series the chart is about: a thicker line with a flat fill under it, drawn as steps that
   * hold each value until the next point. Other series are thin straight lines with small dots.
   */
  main?: boolean;
}

/** A value marked on the chart: a dot for one that counts, a ring tied by a dashed stem for one that didn't. */
export interface ChartMark {
  key: string;
  x: number;
  y: number;
  kind: 'dot' | 'ring';
  /** Where a ring's stem starts: the value it was measured against. */
  from?: number;
  tone: ChartTone;
  title: string;
}

export interface ChartTick {
  value: number;
  label: string;
  /** Data reaches this far; labels up to it are set heavier. */
  reached?: boolean;
}

export interface LegendItem {
  label: string;
  tone: ChartTone;
  kind: 'main' | 'line' | 'ring' | 'reference';
}

export interface LineChartProps {
  /** The chart in words, which is also its accessible name. */
  label: string;
  /** The x axis runs from 0 to `xMax`. */
  xMax: number;
  xTicks: readonly ChartTick[];
  yRange: readonly [number, number];
  yTicks: readonly ChartTick[];
  series: readonly LineSeries[];
  marks?: readonly ChartMark[];
  /** A level to reach, drawn as a dashed line with its label above its right end. */
  reference?: { y: number; label: string };
  /** The point the main series ends on now, drawn larger. */
  head?: ChartPoint | null;
  /** The x being worked on: a band in the mentor's amber, the main series carried to it dashed. */
  live?: { x: number; title: string } | null;
  /** Said in the plot when there is nothing to draw. */
  empty?: string | undefined;
  legend?: readonly LegendItem[];
  /** What to show while the pointer is over a whole x value. */
  readout?: (x: number) => ReactNode;
  /** A whole x value was clicked. */
  onPick?: (x: number) => void;
  height?: number;
  className?: string;
}

const PAD = { left: 48, right: 12, top: 24, bottom: 38 };
/** Before the first measurement, so the first frame isn't empty. */
const FALLBACK_WIDTH = 640;
/** x labels closer together than this would collide. */
const MIN_LABEL_GAP = 28;

const STROKE: Record<ChartTone, string> = {
  student: 'stroke-student',
  mentor: 'stroke-mentor',
  fg: 'stroke-fg',
};
const FILL: Record<ChartTone, string> = {
  student: 'fill-student',
  mentor: 'fill-mentor',
  fg: 'fill-fg',
};
const AREA: Record<ChartTone, string> = {
  student: 'fill-student/10',
  mentor: 'fill-mentor/10',
  fg: 'fill-fg/10',
};

function useWidth() {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(FALLBACK_WIDTH);
  useLayoutEffect(() => {
    const node = ref.current;
    if (!node) return;
    const measure = () => setWidth(Math.max(240, Math.round(node.clientWidth)));
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    return () => observer.disconnect();
  }, []);
  return { ref, width };
}

/** A path through points in steps: each value holds until the next point, which it rises or falls to. */
export function stepPath(points: readonly ChartPoint[]): string {
  return points
    .map((point, index) => (index === 0 ? `M${point.x},${point.y}` : `H${point.x}V${point.y}`))
    .join('');
}

/** Labels far enough apart to read: every few, and always the last. */
export function spacedTicks(ticks: readonly ChartTick[], pxPerUnit: number): ChartTick[] {
  const every = Math.max(1, Math.ceil(MIN_LABEL_GAP / Math.max(pxPerUnit, 1)));
  const last = ticks.at(-1);
  return ticks.filter(
    (tick) =>
      tick === last || (tick.value % every === 0 && (last?.value ?? 0) - tick.value >= every),
  );
}

/**
 * A line chart drawn at its real size: a main series in steps with a flat fill under it, quieter
 * series beside it, marks for values that were or weren't kept, a reference level, and the x
 * being worked on. Pointing at the plot reads out a whole x value; clicking picks it.
 */
export function LineChart({
  label,
  xMax,
  xTicks,
  yRange,
  yTicks,
  series,
  marks = [],
  reference,
  head,
  live,
  empty,
  legend,
  readout,
  onPick,
  height = 280,
  className,
}: LineChartProps) {
  const { ref, width } = useWidth();
  const [hover, setHover] = useState<number | null>(null);
  const plotW = width - PAD.left - PAD.right;
  const bottom = height - PAD.bottom;
  const [low, high] = yRange;
  const span = Math.max(xMax, 1);
  const unit = plotW / span;
  const px = (x: number) => PAD.left + x * unit;
  const py = (y: number) => bottom - ((y - low) / Math.max(high - low, 1)) * (bottom - PAD.top);
  const at = (point: ChartPoint): ChartPoint => ({ x: px(point.x), y: py(point.y) });

  const main = series.find((item) => item.main);
  const mainPoints = (main?.points ?? []).map(at);
  const reach = Math.max(
    0,
    ...series.flatMap((item) => item.points.map((point) => point.x)),
    live?.x ?? 0,
  );
  const last = mainPoints.at(-1);
  const band = live ? Math.min(unit, 40) : 0;
  // The pointer's layer starts half a step before x = 0, so each whole x owns the step around it.
  const pointAt = (clientX: number, layer: DOMRect) =>
    Math.min(reach, Math.max(0, Math.round((clientX - layer.left - unit / 2) / unit)));

  return (
    <figure className={cn('m-0 flex min-w-0 flex-col gap-3', className)}>
      <div ref={ref} className="relative w-full" style={{ height }}>
        <svg
          width={width}
          height={height}
          viewBox={`0 0 ${width} ${height}`}
          role="img"
          aria-label={label}
          className="block overflow-visible"
        >
          {yTicks.map((tick) => (
            <g key={tick.value}>
              <line
                x1={PAD.left}
                x2={width - PAD.right}
                y1={py(tick.value)}
                y2={py(tick.value)}
                className="stroke-line"
              />
              <text
                x={PAD.left - 12}
                y={py(tick.value) + 4.5}
                textAnchor="end"
                className="fill-fg text-small tabular-nums"
              >
                {tick.label}
              </text>
            </g>
          ))}
          <line
            x1={PAD.left}
            x2={width - PAD.right}
            y1={bottom}
            y2={bottom}
            className="stroke-line-strong"
          />
          {spacedTicks(xTicks, unit).map((tick) => (
            <g key={tick.value}>
              <line
                x1={px(tick.value)}
                x2={px(tick.value)}
                y1={bottom}
                y2={bottom + 4}
                className="stroke-line-strong"
              />
              <text
                x={px(tick.value)}
                y={bottom + 25}
                textAnchor="middle"
                className={cn(
                  'text-small tabular-nums',
                  live?.x === tick.value ? 'fill-mentor font-medium' : 'fill-fg',
                  tick.reached && 'font-medium',
                )}
              >
                {tick.label}
              </text>
            </g>
          ))}
          {live && (
            <rect
              x={px(live.x) - band / 2}
              y={PAD.top}
              width={band}
              height={bottom - PAD.top}
              rx={8}
              className="fill-mentor/10"
            >
              <title>{live.title}</title>
            </rect>
          )}
          {reference && (
            <g>
              <line
                x1={PAD.left}
                x2={width - PAD.right}
                y1={py(reference.y)}
                y2={py(reference.y)}
                className="stroke-fg/50"
                strokeDasharray="3 5"
              />
              <text
                x={width - PAD.right}
                y={py(reference.y) - 8}
                textAnchor="end"
                className="fill-fg text-small font-medium tabular-nums"
              >
                {reference.label}
              </text>
            </g>
          )}
          {main && mainPoints.length > 1 && (
            <motion.path
              d={`${stepPath(mainPoints)}V${bottom}H${mainPoints[0]?.x ?? PAD.left}Z`}
              className={AREA[main.tone]}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={springs.smooth}
            />
          )}
          {live && last && (
            <line
              x1={last.x}
              x2={px(live.x)}
              y1={last.y}
              y2={last.y}
              className={STROKE.mentor}
              strokeWidth={1.75}
              strokeDasharray="2 5"
              strokeLinecap="round"
            />
          )}
          {series
            .filter((item) => !item.main && item.points.length > 0)
            .map((item) => {
              const points = item.points.map(at);
              return (
                <g key={item.id}>
                  {points.length > 1 && (
                    <polyline
                      points={points.map((point) => `${point.x},${point.y}`).join(' ')}
                      fill="none"
                      className={cn(STROKE[item.tone], 'opacity-55')}
                      strokeWidth={1.5}
                      strokeLinejoin="round"
                    />
                  )}
                  {points.map((point, index) => (
                    <circle
                      key={index}
                      cx={point.x}
                      cy={point.y}
                      r={2.75}
                      className={cn(FILL[item.tone], 'opacity-80')}
                    />
                  ))}
                </g>
              );
            })}
          {main && mainPoints.length > 1 && (
            <motion.path
              d={stepPath(mainPoints)}
              fill="none"
              className={STROKE[main.tone]}
              strokeWidth={2.5}
              strokeLinejoin="round"
              strokeLinecap="round"
              initial={{ pathLength: 0 }}
              animate={{ pathLength: 1 }}
              transition={{ ...springs.smooth, duration: 0.9 }}
            />
          )}
          {marks.map((mark) => {
            const point = at(mark);
            return (
              <g key={mark.key}>
                {mark.kind === 'ring' && mark.from !== undefined && (
                  <line
                    x1={point.x}
                    x2={point.x}
                    y1={py(mark.from)}
                    y2={point.y}
                    className="stroke-fg/60"
                    strokeWidth={1.5}
                    strokeDasharray="2 3"
                  />
                )}
                <motion.circle
                  cx={point.x}
                  cy={point.y}
                  r={mark.kind === 'ring' ? 4.5 : 4}
                  strokeWidth={mark.kind === 'ring' ? 1.75 : 2}
                  className={
                    mark.kind === 'ring'
                      ? cn('fill-ground', STROKE[mark.tone])
                      : cn(FILL[mark.tone], 'stroke-ground')
                  }
                  style={{ transformBox: 'fill-box', transformOrigin: 'center' }}
                  initial={{ scale: 0 }}
                  animate={{ scale: 1 }}
                  transition={springs.smooth}
                >
                  <title>{mark.title}</title>
                </motion.circle>
              </g>
            );
          })}
          {head && main && (
            <g>
              <circle
                cx={px(head.x)}
                cy={py(head.y)}
                r={10}
                fill="none"
                className={cn(STROKE[main.tone], 'opacity-35')}
                strokeWidth={1.5}
              />
              <circle cx={px(head.x)} cy={py(head.y)} r={5.5} className={FILL[main.tone]} />
            </g>
          )}
          {hover !== null && (
            <line
              x1={px(hover)}
              x2={px(hover)}
              y1={PAD.top}
              y2={bottom}
              className="stroke-fg/40"
              strokeWidth={1}
            />
          )}
          {empty && (
            <text
              x={PAD.left + plotW / 2}
              y={(PAD.top + bottom) / 2}
              textAnchor="middle"
              className="fill-fg stroke-ground text-ui"
              strokeWidth={10}
              paintOrder="stroke"
            >
              {empty}
            </text>
          )}
        </svg>
        {readout && reach > 0 && (
          <div
            aria-hidden
            className={cn('absolute', onPick && 'cursor-pointer')}
            style={{ left: PAD.left - unit / 2, top: 0, width: plotW + unit, height: bottom }}
            onPointerMove={(event) =>
              setHover(pointAt(event.clientX, event.currentTarget.getBoundingClientRect()))
            }
            onPointerLeave={() => setHover(null)}
            onClick={(event) =>
              onPick?.(pointAt(event.clientX, event.currentTarget.getBoundingClientRect()))
            }
          />
        )}
        {readout && hover !== null && (
          <div
            aria-hidden
            className="pointer-events-none absolute surface-float rounded-control px-3 py-2.5 text-small"
            style={{
              top: PAD.top,
              ...(px(hover) > width * 0.6
                ? { right: width - px(hover) + 12 }
                : { left: px(hover) + 12 }),
            }}
          >
            {readout(hover)}
          </div>
        )}
      </div>
      {legend && legend.length > 0 && (
        <ul
          aria-hidden
          className="m-0 flex list-none flex-wrap items-center gap-x-6 gap-y-2 p-0 pl-12 text-small"
        >
          {legend.map((item) => (
            <li key={item.label} className="flex items-center gap-2">
              <Swatch item={item} />
              {item.label}
            </li>
          ))}
        </ul>
      )}
    </figure>
  );
}

function Swatch({ item }: { item: LegendItem }) {
  return (
    <svg width={18} height={10} viewBox="0 0 18 10" aria-hidden className="shrink-0">
      {item.kind === 'main' && (
        <line
          x1={1}
          x2={17}
          y1={5}
          y2={5}
          strokeWidth={2.5}
          strokeLinecap="round"
          className={STROKE[item.tone]}
        />
      )}
      {item.kind === 'line' && (
        <>
          <line
            x1={1}
            x2={17}
            y1={5}
            y2={5}
            strokeWidth={1.5}
            className={cn(STROKE[item.tone], 'opacity-55')}
          />
          <circle cx={9} cy={5} r={2.75} className={cn(FILL[item.tone], 'opacity-80')} />
        </>
      )}
      {item.kind === 'ring' && (
        <circle
          cx={9}
          cy={5}
          r={3.75}
          strokeWidth={1.5}
          className={cn('fill-ground', STROKE[item.tone])}
        />
      )}
      {item.kind === 'reference' && (
        <line x1={1} x2={17} y1={5} y2={5} strokeDasharray="3 3" className="stroke-fg/50" />
      )}
    </svg>
  );
}
