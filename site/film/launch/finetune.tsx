import { Badge, Button, Card } from '@architect/ui';
import { CloudCog, Container, Layers, Network, Server, SquareStack } from 'lucide-react';
import { PlacePage } from '../lab/shell';
import { clamp, inOutCubic, mix, rise, span, ui } from '../lab/time';
import { PLAN } from './data';
import { T } from './timeline';

/**
 * Compute on the fine-tune, rebuilt from the app's Compute page (compute/, the plan in
 * docs/screenshots/compute-plan-dark.png): the fine-tuning plan read from a 235B model's own
 * config, LoRA chosen, the memory it needs on each GPU across the nodes, and the cluster launch
 * bundle for Slurm or Kubernetes with the command that submits it.
 */

/** Its moments, in seconds from the page's start. */
export const FINE_TUNE_AT = {
  read: T.readConfig - T.compute,
  config: T.readConfig - T.compute + 0.2,
  figures: T.weights - T.compute,
  lora: T.lora - T.compute,
  fit: T.fit - T.compute,
  toFit: T.gpuResolve - T.compute - 0.4,
  toBundle: T.slurm - T.compute - 0.5,
  slurm: T.slurm - T.compute,
  kubernetes: T.kubernetes - T.compute,
} as const;

/** How far the page has scrolled at each stop: the plan, the memory card, the bundle. */
export const FINE_TUNE_SCROLL = { fit: 250, bundle: 402 } as const;

export function fineTuneScroll(lt: number): number {
  return (
    mix(0, FINE_TUNE_SCROLL.fit, inOutCubic(span(lt, FINE_TUNE_AT.toFit, 0.9))) +
    mix(
      0,
      FINE_TUNE_SCROLL.bundle - FINE_TUNE_SCROLL.fit,
      inOutCubic(span(lt, FINE_TUNE_AT.toBundle, 0.8)),
    )
  );
}

const METHODS = [
  { label: 'LoRA', Icon: Layers },
  { label: 'QLoRA', Icon: SquareStack },
  { label: 'Full', Icon: Network },
] as const;

const TARGETS = [
  { label: 'Slurm', Icon: Server },
  { label: 'Kubernetes', Icon: Container },
  { label: 'SkyPilot', Icon: CloudCog },
] as const;

function Tile({
  label,
  Icon,
  chosen,
  click,
}: {
  label: string;
  Icon: typeof Layers;
  chosen: number;
  click?: string;
}) {
  return (
    <span
      data-click={click}
      className="relative flex flex-col gap-3 rounded-control px-4 py-3 shadow-edge"
    >
      <span
        aria-hidden
        className="absolute inset-0 rounded-control bg-selected shadow-edge-strong"
        style={{ opacity: chosen }}
      />
      <Icon size={16} strokeWidth={1.8} className="relative" aria-hidden />
      <span className="relative font-medium">{label}</span>
    </span>
  );
}

export function FineTunePage({ lt, still }: { lt: number; still?: boolean }) {
  const read = ui(lt, FINE_TUNE_AT.read, 0.2);
  const lora = ui(lt, FINE_TUNE_AT.lora, 0.25);
  const slurm = ui(lt, FINE_TUNE_AT.slurm, 0.25) - ui(lt, FINE_TUNE_AT.kubernetes, 0.25);
  const kubernetes = ui(lt, FINE_TUNE_AT.kubernetes, 0.25);
  // Each target's command, whole, as its tab is chosen: the one before goes up as it comes in.
  const commands = [
    {
      text: PLAN.commands.slurm,
      shown: ui(lt, FINE_TUNE_AT.slurm + 0.1, 0.25) - ui(lt, FINE_TUNE_AT.kubernetes, 0.15),
    },
    { text: PLAN.commands.kubernetes, shown: ui(lt, FINE_TUNE_AT.kubernetes + 0.12, 0.25) },
  ];
  return (
    <div style={{ transform: `translateY(${still ? 0 : -fineTuneScroll(lt)}px)` }}>
      <PlacePage title="Compute">
        <div className="flex flex-col gap-4">
          <div data-frame="ft-plan">
            <Card
              title="Fine-tuning plan"
              action={
                <span className="flex h-9 items-center gap-1 rounded-full p-1 text-ui shadow-edge">
                  <span className="flex h-7 items-center rounded-full bg-selected px-3">
                    Hugging Face
                  </span>
                  <span className="flex h-7 items-center px-3">config.json</span>
                </span>
              }
            >
              <div className="flex flex-col gap-4">
                <div className="grid grid-cols-[1fr_160px_auto] items-end gap-3">
                  <span className="flex flex-col gap-2">
                    <span className="text-ui font-medium">Model</span>
                    <span className="flex h-10 items-center rounded-control bg-field px-3.5 font-mono text-ui shadow-edge-strong">
                      {PLAN.model}
                    </span>
                  </span>
                  <span className="flex flex-col gap-2">
                    <span className="text-ui font-medium">Revision</span>
                    <span className="flex h-10 items-center rounded-control bg-field px-3.5 font-mono text-ui shadow-edge-strong">
                      main
                    </span>
                  </span>
                  <span data-click="ft-read" className="relative">
                    <Button size="md">Read config</Button>
                    <span
                      aria-hidden
                      className="absolute inset-0 rounded-control bg-selected"
                      style={{ opacity: Math.sin(Math.PI * clamp(read)) * 0.8 }}
                    />
                  </span>
                </div>
                <div
                  data-frame="ft-model"
                  className="flex flex-col gap-4 border-t border-line pt-4"
                >
                  <span className="font-mono text-ui" style={rise(lt, FINE_TUNE_AT.config, 6)}>
                    {PLAN.config}
                  </span>
                  <div data-frame="ft-figures" className="grid grid-cols-4">
                    {PLAN.figures.map(([value, label], index) => (
                      <span
                        key={label}
                        className="flex flex-col gap-1"
                        style={rise(lt, FINE_TUNE_AT.figures + index * 0.15, 10)}
                      >
                        <span className="font-display text-[34px] font-semibold leading-none tracking-[-0.02em] tabular-nums">
                          {value}
                        </span>
                        <span className="text-ui">{label}</span>
                      </span>
                    ))}
                  </div>
                  <div data-frame="ft-methods" className="grid grid-cols-3 gap-2">
                    {METHODS.map(({ label, Icon }, index) => (
                      <Tile
                        key={label}
                        label={label}
                        Icon={Icon}
                        chosen={index === 0 ? lora : 0}
                        click={index === 0 ? 'ft-lora' : undefined}
                      />
                    ))}
                  </div>
                </div>
              </div>
            </Card>
          </div>
          <div data-frame="ft-memory">
            <Card title="Memory on each GPU" action={<Badge>Estimate</Badge>}>
              <div className="flex flex-col gap-2" data-frame="ft-fit">
                <span
                  className="font-display text-h2 font-semibold tabular-nums"
                  style={rise(lt, FINE_TUNE_AT.fit, 8)}
                >
                  Fits on {PLAN.fit.gpus} GPUs in {PLAN.fit.nodes} nodes, {PLAN.fit.each} each of{' '}
                  {PLAN.fit.usable} usable
                </span>
                <span className="text-ui" style={rise(lt, FINE_TUNE_AT.fit + 0.25, 6)}>
                  {PLAN.sized}
                </span>
              </div>
            </Card>
          </div>
          <div data-frame="ft-bundle">
            <Card title="Cluster launch bundle">
              <div className="flex flex-col gap-4">
                <div className="grid grid-cols-3 gap-2">
                  {TARGETS.map(({ label, Icon }, index) => (
                    <Tile
                      key={label}
                      label={label}
                      Icon={Icon}
                      chosen={index === 0 ? slurm : index === 1 ? kubernetes : 0}
                      click={index === 0 ? 'ft-slurm' : index === 1 ? 'ft-kubernetes' : undefined}
                    />
                  ))}
                </div>
                <div className="flex h-11 items-center rounded-control bg-field px-4 font-mono text-ui">
                  <span className="mr-3">$</span>
                  <span className="grid">
                    {commands.map(({ text, shown }) => (
                      <span
                        key={text}
                        className="[grid-area:1/1]"
                        style={{ opacity: shown, transform: `translateY(${(1 - shown) * 6}px)` }}
                      >
                        {text}
                      </span>
                    ))}
                  </span>
                </div>
              </div>
            </Card>
          </div>
        </div>
      </PlacePage>
    </div>
  );
}
