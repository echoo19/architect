import type { ReactNode } from 'react';
import {
  BarChart,
  Card,
  Composer,
  IconButton,
  InfoTip,
  Meter,
  RowIcon,
  VersionTag,
} from '@architect/ui';
import {
  CircleCheck,
  Cpu,
  Ellipsis,
  Gauge,
  HardDrive,
  MemoryStick,
  MessageSquare,
  Plus,
  Wifi,
  WifiOff,
} from 'lucide-react';
import { ACADEMY } from '../lab/data';
import { PlacePage } from '../lab/shell';
import { inOutCubic, outQuart, span } from '../lab/time';
import { ON_PREMISE } from './data';
import { T } from './timeline';

/**
 * Academy desk's home, rebuilt from the app's agent home (screens/AgentScreen.tsx and
 * agent/cards.tsx): the box that starts a session with its starter requests, its activity, and
 * where it runs: this computer's GPU, the model build, the memory it took at its peak, and the
 * guard that keeps it offline. The network goes as it is framed, and the memory meter fills as
 * the camera reaches it.
 */

const noop = () => undefined;

/** A row of the On-premise card, as agent/cards.tsx sets its facts. */
function Fact({
  icon,
  label,
  detail,
  frame,
  children,
}: {
  icon: ReactNode;
  label: ReactNode;
  detail?: ReactNode;
  frame?: string;
  children?: ReactNode;
}) {
  return (
    <li
      className="flex min-h-14 items-center gap-3 border-t border-line px-6 py-2.5 text-ui"
      data-frame={frame}
    >
      <RowIcon>{icon}</RowIcon>
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="font-medium">{label}</span>
        {detail && <span className="text-small text-pretty">{detail}</span>}
      </span>
      {children && <span className="shrink-0 text-right tabular-nums">{children}</span>}
    </li>
  );
}

/** Two states in one place, from `at`: the first goes up and out, then the second rises in. */
function Turn({ t, at, from, to }: { t: number; at: number; from: ReactNode; to: ReactNode }) {
  const gone = outQuart(span(t, at, 0.12));
  const p = outQuart(span(t, at + 0.1, 0.3));
  return (
    <span className="grid">
      {gone < 1 && (
        <span
          className="[grid-area:1/1]"
          style={{ opacity: 1 - gone, transform: `translateY(${-gone * 6}px)` }}
        >
          {from}
        </span>
      )}
      {p > 0 && (
        <span
          className="[grid-area:1/1]"
          style={{ opacity: p, transform: `translateY(${(1 - p) * 6}px)` }}
        >
          {to}
        </span>
      )}
    </span>
  );
}

function OnPremise({ t }: { t: number }) {
  const memory = inOutCubic(span(t, T.memory, 1.3));
  const host = <span className="font-mono">{ON_PREMISE.host}</span>;
  return (
    <Card title="On-premise" icon={<Cpu strokeWidth={1.8} aria-hidden />} flush>
      <ul className="m-0 list-none p-0">
        <Fact
          frame="home-gpu"
          icon={<Cpu strokeWidth={1.8} aria-hidden />}
          label={ON_PREMISE.gpu}
          detail={ON_PREMISE.gpuMemory}
        />
        <Fact
          icon={<HardDrive strokeWidth={1.8} aria-hidden />}
          label={ON_PREMISE.build}
          detail={<span className="font-mono">{ON_PREMISE.model}</span>}
        >
          {ON_PREMISE.size}
        </Fact>
        <li
          className="flex flex-col gap-2 border-t border-line px-6 py-3 text-ui"
          data-frame="home-memory"
        >
          <span className="flex items-center gap-3">
            <RowIcon>
              <MemoryStick strokeWidth={1.8} aria-hidden />
            </RowIcon>
            <span className="flex flex-1 items-center gap-1.5 font-medium">
              Memory at its peak
              <InfoTip about="Memory at its peak">
                The most the runtime held while the sealed final test ran on this computer.
              </InfoTip>
            </span>
            <span className="tabular-nums">
              {Math.round(ON_PREMISE.peak.gb * memory)} GB of {ON_PREMISE.peak.of}
            </span>
          </span>
          <Meter
            value={ON_PREMISE.peak.share * memory}
            label="GPU memory at its peak"
            tone="student"
            className="ml-9 w-auto"
          />
        </li>
        <Fact
          frame="home-loaded"
          icon={<MemoryStick strokeWidth={1.8} aria-hidden />}
          label="Loaded"
          detail={ON_PREMISE.loaded}
        />
        <Fact
          icon={<CircleCheck strokeWidth={1.8} aria-hidden className="text-student" />}
          label="Ready"
          detail={ON_PREMISE.checks}
        />
        <Fact
          frame="home-offline"
          icon={
            <Turn
              t={t}
              at={T.offline}
              from={<Wifi size={16} strokeWidth={1.8} aria-hidden />}
              to={<WifiOff size={16} strokeWidth={1.8} aria-hidden />}
            />
          }
          label={<Turn t={t} at={T.offline} from="Online" to="Offline" />}
          detail={
            <Turn
              t={t}
              at={T.offline}
              from={<>The network is up; it reaches only {host}</>}
              to={<>Reaches only {host}; no call stopped since Architect started</>}
            />
          }
        >
          <InfoTip about="Offline" side="left">
            The agent host refuses every address but this computer before a byte leaves, so the
            agent reaches its model runtime and nothing else.
          </InfoTip>
        </Fact>
      </ul>
    </Card>
  );
}

function Activity() {
  const { figures, days } = ON_PREMISE.activity;
  return (
    <Card title="Activity" icon={<Gauge strokeWidth={1.8} aria-hidden />}>
      <div className="flex flex-col gap-7">
        <dl className="m-0 grid grid-cols-2 gap-x-6 gap-y-5">
          {figures.map(([label, value]) => (
            <div key={label} className="flex min-w-0 flex-col gap-1">
              <dt className="text-ui">{label}</dt>
              <dd className="m-0 font-display text-h1 font-semibold tabular-nums">{value}</dd>
            </div>
          ))}
        </dl>
        <BarChart
          aria-label="Requests per day"
          data={days.map(([label, value]) => ({
            key: label,
            label,
            description: `November ${label}: ${value} requests`,
            value,
          }))}
        />
      </div>
    </Card>
  );
}

/** The agent's home at a moment of the film. */
export function AgentHomePage({ t }: { t: number }) {
  return (
    <PlacePage
      title={ACADEMY}
      status={<VersionTag version={1} active />}
      action={
        <div className="flex items-center gap-1">
          <span data-click="open-session">
            <IconButton label="Open the last session">
              <MessageSquare size={16} strokeWidth={1.8} aria-hidden />
            </IconButton>
          </span>
          <IconButton label={`${ACADEMY} settings`}>
            <Ellipsis size={16} strokeWidth={1.8} aria-hidden />
          </IconButton>
        </div>
      }
    >
      <div className="grid grid-cols-[minmax(0,1fr)_366px] items-start gap-4">
        <div className="flex min-w-0 flex-col gap-4">
          <section className="flex flex-col gap-3">
            <Composer
              size="hero"
              className="max-w-none"
              label={`New session with ${ACADEMY}`}
              placeholder={`Ask ${ACADEMY}`}
              value=""
              onValueChange={noop}
              onSubmit={noop}
              leading={
                <span className="flex items-center gap-1.5 pl-1 text-small">
                  <Plus size={14} strokeWidth={1.8} aria-hidden />
                  New session
                </span>
              }
            />
            <div className="flex flex-wrap gap-2 text-ui">
              {ON_PREMISE.starters.map((starter) => (
                <span
                  key={starter}
                  className="flex h-9 items-center rounded-full px-3.5 shadow-edge-strong"
                >
                  {starter}
                </span>
              ))}
            </div>
          </section>
          <Activity />
        </div>
        <div className="min-w-0" data-frame="home-premise">
          <OnPremise t={t} />
        </div>
      </div>
    </PlacePage>
  );
}
