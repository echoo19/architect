import {
  AgentAvatar,
  Badge,
  Card,
  cn,
  Disclosure,
  InfoTip,
  IntervalPlot,
  RiskCoveragePlot,
  type IntervalGroup,
} from '@architect/ui';
import type { ReactNode } from 'react';
import {
  CircleCheck,
  CircleX,
  CloudCog,
  Container,
  FlaskConical,
  Layers,
  Network,
  Server,
  SquareStack,
  X,
} from 'lucide-react';
import { ACADEMY, LOCKED } from './data';
import { useLabels } from './labels';
import { PlacePage } from './shell';
import { clamp, inOutCubic, mix, outExpo, outQuart, rise, span, ui } from './time';

/**
 * An experiment read like a paper: its hypothesis, registered before it ran (the Preregistered
 * badge), and each arm's pass rate with its 95% interval on each group, the measured difference
 * on each never-seen group's header (the academy field's first run, academy-desk-1.md).
 */
export function ExperimentPage({
  lt,
  arms = [4.7, 5.5, 6.3],
  placed,
}: {
  lt: number;
  /** When each group's arms land, in seconds from the page's start. */
  arms?: readonly [number, number, number];
  /**
   * Rows, as `group-row` (`1-taught`), whose point appears at its value when it lands instead
   * of travelling there: something else on screen has already brought it to its place.
   */
  placed?: readonly string[];
}) {
  const labels = useLabels();
  const groups: IntervalGroup[] = LOCKED.groups.map((group, g) => ({
    label: group.label,
    // A never-seen group's measured difference sits on its header once its arms have landed.
    ...('difference' in group
      ? {
          end: (
            <span
              className="flex items-center gap-0.5"
              style={{ opacity: ui(lt, arms[g]! + 1.4, 0.4) }}
            >
              {group.difference.text}
              <InfoTip about={`${group.label}, the difference`}>{group.difference.tip}</InfoTip>
            </span>
          ),
        }
      : {}),
    rows: group.rows.map((row, r) => {
      const at = arms[g]! + r * 0.14;
      const dot = outExpo(span(lt, at, 1.0));
      const open = outQuart(span(lt, at + 0.5, 0.8));
      return {
        id: row.id,
        label: labels.arms[row.id],
        estimate:
          dot > 0
            ? placed?.includes(`${g}-${row.id}`)
              ? row.estimate
              : mix(0, row.estimate, dot)
            : null,
        low: mix(row.estimate, row.low, open) * dot,
        high: mix(row.estimate, row.high, open) * dot,
        tone: row.id === 'taught' ? 'student' : 'fg',
      };
    }),
  }));
  // Once the hypothesis is read, the page scrolls until the figure sits whole in the window,
  // centred: it starts 278 px down and is 538 px tall, in a window 640 px tall.
  const scroll = mix(0, 228, inOutCubic(span(lt, 3.0, 1.6)));
  return (
    <div style={{ transform: `translateY(${-scroll}px)` }}>
      <PlacePage
        title="Academy desk, first field run"
        status={
          <span className="flex gap-2">
            <Badge>Finished</Badge>
            <Badge>Preregistered</Badge>
          </span>
        }
      >
        <div style={rise(lt, 0.3, 6)}>
          <Card title="Hypothesis" icon={<FlaskConical strokeWidth={1.8} aria-hidden />}>
            <p className="m-0 max-w-[760px] text-body">
              Spark's teaching passes more of the academies Glimmer never sees than Glimmer alone,
              since its changes come from the failures it found.
            </p>
          </Card>
        </div>
        <section className="rounded-card px-6 py-5 surface-card" style={rise(lt, 0.8, 6)}>
          <IntervalPlot
            aria-label="Pass rate by arm and group"
            groups={groups}
            domain={[0, 1]}
            ticks={[0, 0.25, 0.5, 0.75, 1]}
            format={(value) => `${Math.round(value * 100)}%`}
          />
        </section>
      </PlacePage>
    </div>
  );
}

interface ModelRow {
  name: string;
  version: string;
  /** The base model and its build, on one line. */
  base: string;
  scores: readonly [string, string, string];
  status: string;
}

/**
 * The registry. The academy's hosted and local rows are its first run's (academy-desk-1.md and
 * academy-desk-1-local.md: 44, 43, 12 hosted and 45, 41, 17 local, of 48, 48 and 24).
 */
const MODELS: readonly ModelRow[] = [
  {
    name: ACADEMY,
    version: 'v1',
    base: 'Glimmer · hosted',
    scores: ['92%', '90%', '50%'],
    status: 'Tested',
  },
  {
    name: ACADEMY,
    version: 'v1',
    base: 'Glimmer · 2-bit',
    scores: ['94%', '85%', '71%'],
    status: 'Active',
  },
  {
    name: 'Returns desk',
    version: 'v2',
    base: 'Glimmer · hosted',
    scores: ['97%', '-', '-'],
    status: 'Active',
  },
  {
    name: 'Pricing desk',
    version: 'v1',
    base: 'Glimmer · hosted',
    scores: ['100%', '-', '-'],
    status: 'Active',
  },
  {
    name: 'Service desk',
    version: 'v1',
    base: 'Glimmer · 4-bit',
    scores: ['-', '-', '-'],
    status: 'Candidate',
  },
];

/**
 * The registry's width and columns, in window pixels, from the page alone (`open` 0) to beside
 * the open panel (`open` 1). The panel pushes the table: the base model and the scores give way,
 * as the app's narrow table does, and the agent and its status stay whole.
 */
const REGISTRY = { full: 830, beside: 342, pad: 48 } as const;

function registryColumns(open: number): string {
  const gone = 1 - open;
  const agent = mix(220, 196, open);
  const status = mix(110, 98, open);
  return [agent, 170 * gone, 100 * gone, 100 * gone, 82 * gone, status]
    .map((width) => `${width}px`)
    .join(' ');
}

/** A column that gives way beside the panel: it fades as its track closes. */
function Giving({ open, end, children }: { open: number; end?: boolean; children: ReactNode }) {
  return (
    <span
      className={cn('relative overflow-hidden whitespace-nowrap pl-3', end && 'text-right')}
      style={{ opacity: 1 - clamp(open * 2.5) }}
    >
      {children}
    </span>
  );
}

/** What the version panel's certified answers show: its sentence, its plot and its checks. */
export interface Certificate {
  /** Wrong at most, and handed to staff, as shares. */
  wrong: number;
  handed: number;
  points: readonly { coverage: number; bound: number; risk: number }[];
  checks: readonly { name: string; detail: string; held: boolean }[];
  /** Marked as an example on screen, never as measured, until a run issues one. */
  example: boolean;
}

/** The certificate's form, from the report's stand-in data. Shown as an example, never as measured. */
export const EXAMPLE_CERTIFICATE: Certificate = {
  wrong: 0.08,
  handed: 0.22,
  points: [
    { coverage: 0.58, bound: 0.068, risk: 0 },
    { coverage: 0.79, bound: 0.08, risk: 0.018 },
    { coverage: 0.87, bound: 0.14, risk: 0.04 },
    { coverage: 0.95, bound: 0.17, risk: 0.07 },
    { coverage: 1, bound: 0.21, risk: 0.085 },
  ],
  checks: [
    { name: 'Final test, academies taught on', detail: 'Answered 55 of 72, 2 wrong', held: true },
    { name: 'Harborview Prep, never seen', detail: 'Answered 26 of 36, 1 wrong', held: true },
    { name: 'Real academy, never seen', detail: 'Answered 21 of 30, 3 wrong', held: false },
  ],
  example: true,
};

/**
 * Models: every version with its scores seen, unseen and real. Choosing one opens its panel, here
 * on its certified answers, and the table moves aside for it.
 */
export function ModelsPage({
  lt,
  panelAt,
  certificate = EXAMPLE_CERTIFICATE,
}: {
  lt: number;
  panelAt: number;
  certificate?: Certificate;
}) {
  const labels = useLabels();
  const panel = outExpo(span(lt, panelAt, 0.7));
  const pt = lt - panelAt;
  const selected = ui(lt, panelAt - 0.15, 0.2);
  const columns = registryColumns(panel);
  const row = 'grid items-center px-6';
  return (
    <div className="relative h-full">
      <PlacePage title="Models">
        <section
          className="overflow-hidden rounded-card surface-card"
          style={{ width: mix(REGISTRY.full, REGISTRY.beside, panel) }}
        >
          <div
            className={`${row} h-12 pt-2 text-ui font-medium`}
            style={{ gridTemplateColumns: columns }}
          >
            <span>Agent</span>
            <Giving open={panel}>Base model</Giving>
            <Giving open={panel} end>
              Taught on
            </Giving>
            <Giving open={panel} end>
              Never seen
            </Giving>
            <Giving open={panel} end>
              Real
            </Giving>
            <span className="whitespace-nowrap pl-3 text-right">Status</span>
          </div>
          {MODELS.map((model, index) => (
            <div
              key={`${model.name}-${model.base}`}
              data-click={index === 1 ? 'academy-model' : undefined}
              className={`${row} relative h-[60px] border-t border-line text-ui tabular-nums`}
              style={{ ...rise(lt, 0.35 + index * 0.07, 6), gridTemplateColumns: columns }}
            >
              {index === 1 && (
                <span
                  aria-hidden
                  className="absolute inset-0 bg-selected"
                  style={{ opacity: selected }}
                />
              )}
              <span className="relative flex items-center gap-3 whitespace-nowrap">
                <AgentAvatar name={model.name} />
                <span className="font-medium">
                  {model.name} <span className="font-mono text-small">{model.version}</span>
                </span>
              </span>
              <Giving open={panel}>{model.base}</Giving>
              {model.scores.map((score, column) => (
                <Giving key={column} open={panel} end>
                  {score}
                </Giving>
              ))}
              <span className="relative whitespace-nowrap pl-3 text-right">{model.status}</span>
            </div>
          ))}
        </section>
      </PlacePage>
      <aside
        className="absolute inset-y-3 right-3 flex w-[500px] flex-col rounded-card bg-raised shadow-float"
        style={{ transform: `translateX(${(1 - panel) * 540}px)`, opacity: clamp(panel * 3) }}
      >
        <div className="flex items-center gap-3 border-b border-line px-6 py-4">
          <AgentAvatar name={ACADEMY} size="md" />
          <span className="flex flex-1 flex-col">
            <span className="font-display text-h2 font-semibold">{ACADEMY} v1</span>
            <span className="text-small">Glimmer · 2-bit</span>
          </span>
          <X size={18} strokeWidth={1.8} aria-hidden />
        </div>
        <div className="flex flex-col gap-3 px-6 pt-4">
          <span className="flex items-center gap-3" style={rise(pt, 0.4, 6)}>
            <span className="font-display text-h2 font-semibold">{labels.certificate}</span>
            {certificate.example && <Badge tone="emphasis">Example</Badge>}
          </span>
          <p className="m-0 text-body" style={rise(pt, 0.7, 6)}>
            When {ACADEMY} answers, it is wrong on at most {Math.round(certificate.wrong * 100)}% of
            requests like these, with 95% confidence. It handed{' '}
            {Math.round(certificate.handed * 100)}% to staff.
          </p>
          <div style={rise(pt, 1.0, 6)}>
            <Disclosure label="How this is measured">
              5 attempts at each calibration task; it answers when 4 of 5 agree.
            </Disclosure>
          </div>
          <div
            className="[&_figcaption]:hidden"
            style={{
              zoom: 0.78,
              marginTop: 4,
              clipPath: `inset(-16px ${(1 - outQuart(span(pt, 1.6, 2.2))) * 100}% 0 -12px)`,
            }}
          >
            <RiskCoveragePlot
              aria-label="Wrong at most, by share answered"
              points={certificate.points}
              chosen={1}
              target={0.1}
            />
          </div>
          <div className="flex flex-col">
            {certificate.checks.map((check, index) => (
              <div
                key={check.name}
                className="flex items-center gap-3 border-t border-line py-2 text-ui"
                style={rise(pt, 4.2 + index * 0.45, 6)}
              >
                {check.held ? (
                  <CircleCheck
                    size={16}
                    strokeWidth={1.8}
                    className="shrink-0 text-student"
                    aria-hidden
                  />
                ) : (
                  <CircleX
                    size={16}
                    strokeWidth={1.8}
                    className="shrink-0 text-danger"
                    aria-hidden
                  />
                )}
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="truncate">{check.name}</span>
                  <span className="text-small">{check.detail}</span>
                </span>
                <span className="font-medium">{check.held ? 'Held' : 'Not held'}</span>
              </div>
            ))}
          </div>
        </div>
      </aside>
    </div>
  );
}

const METHODS = [
  { label: 'LoRA', Icon: Layers },
  { label: 'QLoRA', Icon: SquareStack },
  { label: 'Full', Icon: Network },
] as const;

/** The bundle's targets, as the app's Compute lists them (compute/Targets.tsx). */
const TARGETS = [
  { label: 'Slurm', Icon: Server },
  { label: 'Kubernetes', Icon: Container },
  { label: 'SkyPilot', Icon: CloudCog },
] as const;

/** The command a Slurm bundle is submitted with, typed out in turn. */
const SUBMIT = 'sbatch submit.sbatch';

/**
 * Compute: a training plan for a large open model, sized from its own configuration, and a launch
 * bundle for a cluster. Both are labeled for what they are: an estimate, and experimental, with
 * what the bundle is and isn't in the badge's tip (compute/BundleCard.tsx CLUSTER_NOTE;
 * docs/SCALE.md; the figures are the plan's own arithmetic, as in compute-plan-dark.png).
 */
export function ComputePage({ lt }: { lt: number }) {
  const method = ui(lt, 1.6, 0.25);
  const target = ui(lt, 5.0, 0.25);
  const typed = Math.round(mix(0, SUBMIT.length, clamp((lt - 6.0) / 1.2)));
  return (
    <PlacePage title="Compute">
      <div className="grid grid-cols-[1fr_1fr] items-start gap-4">
        <Card title="Training plan">
          <div className="flex flex-col gap-5">
            <div className="flex items-center gap-3 rounded-control px-4 py-3 font-mono text-ui shadow-edge-strong">
              lab/moe-235b
            </div>
            <div className="grid grid-cols-2 gap-y-4" style={rise(lt, 0.4, 6)}>
              {[
                ['235.1B', 'Parameters'],
                ['22.2B', 'Active per token'],
                ['94', 'Layers'],
                ['128', 'Experts, 8 per token'],
              ].map(([value, label]) => (
                <span key={label} className="flex flex-col">
                  <span className="font-display text-h1 font-semibold tabular-nums">{value}</span>
                  <span className="text-ui">{label}</span>
                </span>
              ))}
            </div>
            <div className="grid grid-cols-3 gap-2">
              {METHODS.map(({ label, Icon }, index) => (
                <span
                  key={label}
                  className="relative flex flex-col gap-3 rounded-control px-4 py-3 shadow-edge"
                >
                  {index === 0 && (
                    <span
                      aria-hidden
                      className="absolute inset-0 rounded-control bg-selected shadow-edge-strong"
                      style={{ opacity: method }}
                    />
                  )}
                  <Icon size={16} strokeWidth={1.8} className="relative" aria-hidden />
                  <span className="relative font-medium">{label}</span>
                </span>
              ))}
            </div>
          </div>
        </Card>
        <div className="flex flex-col gap-4">
          <Card title="Memory on each GPU" action={<Badge>Estimate</Badge>}>
            <div className="flex flex-col gap-2">
              <span className="font-display text-h2 font-semibold" style={rise(lt, 2.3, 6)}>
                Fits on 16 GPUs in 2 nodes, 52.1 GB each of 72.0 GB usable
              </span>
              <span className="text-ui" style={rise(lt, 2.6, 6)}>
                Sized for H100 80GB, 8 per node, bf16
              </span>
            </div>
          </Card>
          <Card
            title="Bundle"
            action={
              <span className="flex items-center gap-0.5">
                <Badge tone="emphasis">Experimental</Badge>
                <InfoTip about="Experimental">
                  Architect writes this bundle and never submits it. It is checked against simulated
                  schedulers only; GPU runs, large models and training gains are unverified.
                </InfoTip>
              </span>
            }
          >
            <div className="flex flex-col gap-4">
              <div className="grid grid-cols-3 gap-2">
                {TARGETS.map(({ label, Icon }, index) => (
                  <span
                    key={label}
                    className="relative flex flex-col gap-3 rounded-control px-4 py-3 shadow-edge"
                  >
                    {index === 0 && (
                      <span
                        aria-hidden
                        className="absolute inset-0 rounded-control bg-selected shadow-edge-strong"
                        style={{ opacity: target }}
                      />
                    )}
                    <Icon size={16} strokeWidth={1.8} className="relative" aria-hidden />
                    <span className="relative font-medium">{label}</span>
                  </span>
                ))}
              </div>
              <div
                className="flex h-11 items-center rounded-control bg-field px-4 font-mono text-ui"
                style={{ opacity: ui(lt, 5.6, 0.3) }}
              >
                <span className="mr-3">$</span>
                {SUBMIT.slice(0, typed)}
              </div>
            </div>
          </Card>
        </div>
      </div>
    </PlacePage>
  );
}
