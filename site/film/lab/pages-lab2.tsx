import {
  AgentAvatar,
  Badge,
  IntervalPlot,
  RiskCoveragePlot,
  type IntervalGroup,
} from '@architect/ui';
import {
  CircleCheck,
  CircleX,
  Cpu,
  FlaskConical,
  Layers,
  Network,
  Server,
  SquareStack,
  X,
} from 'lucide-react';
import { ACADEMY, LOCKED } from './data';
import { Panel, PlacePage } from './shell';
import { clamp, inOutCubic, mix, outExpo, outQuart, rise, span, ui } from './time';

/**
 * An experiment read like a paper: what was registered before it ran, what was measured, and
 * each arm's pass rate with its 95% interval on each group (the academy field's first run,
 * tutor-1.md).
 */
export function ExperimentPage({ lt }: { lt: number }) {
  const groups: IntervalGroup[] = LOCKED.groups.map((group, g) => ({
    label: group.label,
    rows: group.rows.map((row, r) => {
      const at = 4.7 + g * 0.8 + r * 0.14;
      const dot = outExpo(span(lt, at, 1.0));
      const open = outQuart(span(lt, at + 0.5, 0.8));
      return {
        id: row.id,
        label: row.label,
        estimate: dot > 0 ? mix(0, row.estimate, dot) : null,
        low: mix(row.estimate, row.low, open) * dot,
        high: mix(row.estimate, row.high, open) * dot,
        tone: row.id === 'taught' ? 'student' : 'fg',
      };
    }),
  }));
  // Once the hypothesis is read, the page scrolls until the figure sits whole in the window.
  const scroll = mix(0, 318, inOutCubic(span(lt, 3.0, 1.6)));
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
        <section
          className="rounded-card bg-card px-6 py-5 shadow-edge"
          data-frame="hypothesis"
          style={rise(lt, 0.3, 6)}
        >
          <span className="flex items-center gap-2.5 font-display font-semibold">
            <FlaskConical size={16} strokeWidth={1.8} aria-hidden />
            Hypothesis
          </span>
          <p className="mb-4 mt-3 max-w-[760px] text-body">
            Spark's teaching passes more of the academies Glimmer never sees than Glimmer alone,
            since its changes come from the failures it found.
          </p>
          <div className="grid grid-cols-[170px_1fr] gap-y-1.5 text-ui">
            <span className="font-medium">Primary comparison</span>
            <span>Taught minus Glimmer alone, on each academy it never saw, task by task</span>
            <span className="font-medium">Registered</span>
            <span>Before any arm ran; no rerun or tuning after a locked result</span>
          </div>
        </section>
        <section
          className="rounded-card bg-card px-6 py-5 shadow-edge"
          data-frame="plot"
          style={rise(lt, 0.8, 6)}
        >
          <IntervalPlot
            aria-label="Pass rate by arm and group"
            groups={groups}
            domain={[0, 1]}
            ticks={[0, 0.25, 0.5, 0.75, 1]}
            format={(value) => `${Math.round(value * 100)}%`}
          />
          <div
            className="mt-4 grid grid-cols-[110px_1fr] gap-y-1.5 border-t border-line pt-4 text-ui"
            style={{ opacity: ui(lt, 8.4, 0.5) }}
          >
            <span className="font-medium">Measured</span>
            <span>
              Harborview Prep: +39.6 points (+22.9 to +53.7), a gain. Real academy: +12.5 (-17.9 to
              +40.2), no gain shown.
            </span>
          </div>
        </section>
      </PlacePage>
    </div>
  );
}

interface ModelRow {
  name: string;
  version: string;
  base: string;
  runtime: string;
  scores: readonly [string, string, string];
  status: string;
}

/**
 * The registry. The academy's hosted and local rows are its first run's (tutor-1.md and
 * tutor-1-local.md: 44, 43, 12 hosted and 45, 41, 17 local, of 48, 48 and 24).
 */
const MODELS: readonly ModelRow[] = [
  {
    name: ACADEMY,
    version: 'v1',
    base: 'Glimmer, hosted',
    runtime: 'OpenRouter',
    scores: ['92%', '90%', '50%'],
    status: 'Tested',
  },
  {
    name: ACADEMY,
    version: 'v1',
    base: 'Glimmer, 2-bit',
    runtime: 'Ollama',
    scores: ['94%', '85%', '71%'],
    status: 'Active',
  },
  {
    name: 'Returns desk',
    version: 'v2',
    base: 'Glimmer, hosted',
    runtime: 'OpenRouter',
    scores: ['97%', '-', '-'],
    status: 'Active',
  },
  {
    name: 'Pricing desk',
    version: 'v1',
    base: 'Glimmer, hosted',
    runtime: 'OpenRouter',
    scores: ['100%', '-', '-'],
    status: 'Active',
  },
  {
    name: 'Service desk',
    version: 'v1',
    base: 'Glimmer, 4-bit',
    runtime: 'Ollama',
    scores: ['-', '-', '-'],
    status: 'Candidate',
  },
];

const modelGrid = 'grid grid-cols-[1.7fr_1.3fr_0.75fr_0.75fr_0.6fr_0.8fr] items-center gap-3 px-6';

/** The certificate's form, from the report's stand-in data. Shown as an example, never as measured. */
const RISK = [
  { coverage: 0.58, bound: 0.068, risk: 0 },
  { coverage: 0.79, bound: 0.08, risk: 0.018 },
  { coverage: 0.87, bound: 0.14, risk: 0.04 },
  { coverage: 0.95, bound: 0.17, risk: 0.07 },
  { coverage: 1, bound: 0.21, risk: 0.085 },
] as const;

/**
 * Models: every version with its scores seen, unseen and real. Choosing one opens its panel, here
 * on its certified answers.
 */
export function ModelsPage({ lt, panelAt }: { lt: number; panelAt: number }) {
  const panel = outExpo(span(lt, panelAt, 0.7));
  const pt = lt - panelAt;
  const selected = ui(lt, panelAt - 0.15, 0.2);
  return (
    <div className="relative h-full">
      <PlacePage title="Models">
        <section className="rounded-card bg-card shadow-edge" data-frame="registry">
          <div className={`${modelGrid} h-12 pt-2 text-ui font-medium`}>
            <span>Agent</span>
            <span>Base model</span>
            <span className="text-right">Taught on</span>
            <span className="text-right">Never seen</span>
            <span className="text-right">Real</span>
            <span className="text-right">Status</span>
          </div>
          {MODELS.map((model, index) => (
            <div
              key={`${model.name}-${model.base}`}
              data-click={index === 1 ? 'academy-model' : undefined}
              className={`${modelGrid} relative h-[60px] border-t border-line text-ui tabular-nums`}
              style={rise(lt, 0.35 + index * 0.07, 6)}
            >
              {index === 1 && (
                <span
                  aria-hidden
                  className="absolute inset-0 bg-selected"
                  style={{ opacity: selected }}
                />
              )}
              <span className="relative flex items-center gap-3">
                <AgentAvatar name={model.name} />
                <span className="flex flex-col">
                  <span className="font-medium">
                    {model.name} <span className="font-mono text-small">{model.version}</span>
                  </span>
                </span>
              </span>
              <span className="relative flex flex-col">
                <span>{model.base}</span>
                <span className="text-small">{model.runtime}</span>
              </span>
              {model.scores.map((score, column) => (
                <span key={column} className="relative text-right">
                  {score}
                </span>
              ))}
              <span className="relative text-right">{model.status}</span>
            </div>
          ))}
        </section>
      </PlacePage>
      <aside
        className="absolute inset-y-3 right-3 flex w-[500px] flex-col rounded-card bg-raised shadow-float"
        style={{ transform: `translateX(${(1 - panel) * 540}px)`, opacity: clamp(panel * 3) }}
        data-frame="certificate"
      >
        <div className="flex items-center gap-3 border-b border-line px-6 py-4">
          <AgentAvatar name={ACADEMY} size="md" />
          <span className="flex flex-1 flex-col">
            <span className="font-display text-h2 font-semibold">{ACADEMY} v1</span>
            <span className="text-small">Glimmer, 2-bit</span>
          </span>
          <X size={18} strokeWidth={1.8} aria-hidden />
        </div>
        <div className="flex flex-col gap-3 px-6 pt-4">
          <span className="flex items-center gap-3" style={rise(pt, 0.4, 6)}>
            <span className="font-display text-h2 font-semibold">Certified answers</span>
            <Badge tone="emphasis">Example</Badge>
          </span>
          <p className="m-0 text-body" style={rise(pt, 0.7, 6)}>
            When {ACADEMY} answers, it is wrong on at most 8% of requests like these, with 95%
            confidence. It handed 22% to staff.
          </p>
          <p className="m-0 text-small" style={rise(pt, 1.0, 6)}>
            5 attempts at each calibration task; it answers when 4 of 5 agree.
          </p>
          <div
            className="[&_figcaption]:hidden"
            style={{
              zoom: 0.78,
              marginTop: 10,
              clipPath: `inset(-16px ${(1 - outQuart(span(pt, 1.6, 2.2))) * 100}% 0 -12px)`,
            }}
          >
            <RiskCoveragePlot
              aria-label="Wrong at most, by share answered"
              points={RISK}
              chosen={1}
              target={0.1}
            />
          </div>
          <div className="flex flex-col">
            {[
              {
                name: 'Final test, academies taught on',
                detail: 'Answered 55 of 72, 2 wrong',
                held: true,
              },
              {
                name: 'Harborview Prep, never seen',
                detail: 'Answered 26 of 36, 1 wrong',
                held: true,
              },
              {
                name: 'Real academy, never seen',
                detail: 'Answered 21 of 30, 3 wrong',
                held: false,
              },
            ].map((row, index) => (
              <div
                key={row.name}
                className="flex items-center gap-3 border-t border-line py-2 text-ui"
                style={rise(pt, 4.2 + index * 0.45, 6)}
              >
                {row.held ? (
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
                  <span className="truncate">{row.name}</span>
                  <span className="text-small">{row.detail}</span>
                </span>
                <span className="font-medium">{row.held ? 'Held' : 'Not held'}</span>
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

const TARGETS = [
  { label: 'Slurm', Icon: Server },
  { label: 'Kubernetes', Icon: Cpu },
] as const;

/** The command a Slurm bundle is submitted with, typed out in turn. */
const SUBMIT = 'sbatch train.sbatch';

/**
 * Compute: a training plan for a large open model, sized from its own configuration, and a launch
 * bundle for a cluster. Both are labeled for what they are: an estimate, and experimental
 * (docs/SCALE.md; the figures are the plan's own arithmetic, as in compute-plan-dark.png).
 */
export function ComputePage({ lt }: { lt: number }) {
  const method = ui(lt, 1.6, 0.25);
  const target = ui(lt, 5.0, 0.25);
  const typed = Math.round(mix(0, SUBMIT.length, clamp((lt - 6.0) / 1.2)));
  return (
    <PlacePage title="Compute">
      <div className="grid grid-cols-[1fr_1fr] items-start gap-4">
        <Panel title="Training plan" bodyClass="gap-5 px-6 pb-6" frame="plan">
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
        </Panel>
        <div className="flex flex-col gap-4" data-frame="bundle-col">
          <Panel
            title="Memory on each GPU"
            action={<Badge>Estimate</Badge>}
            bodyClass="gap-2 px-6 pb-6"
            frame="memory"
          >
            <span className="font-display text-h2 font-semibold" style={rise(lt, 2.3, 6)}>
              Fits on 16 GPUs in 2 nodes, 52.1 GB each of 72.0 GB usable
            </span>
            <span className="text-ui" style={rise(lt, 2.6, 6)}>
              Sized for H100 80GB, 8 per node, bf16
            </span>
          </Panel>
          <Panel
            title="Bundle"
            action={<Badge tone="emphasis">Experimental</Badge>}
            bodyClass="gap-4 px-6 pb-6"
            frame="bundle"
          >
            <div className="grid grid-cols-2 gap-2">
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
            <span className="text-ui" style={{ opacity: ui(lt, 7.4, 0.4) }}>
              Run it with your own scheduler. Architect never holds cluster credentials.
            </span>
          </Panel>
        </div>
      </div>
    </PlacePage>
  );
}
