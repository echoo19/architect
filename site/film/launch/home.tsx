import type { ReactNode } from 'react';
import { Card, InfoTip, Meter, RowIcon } from '@architect/ui';
import { CircleCheck, Cpu, HardDrive, MemoryStick, Wifi, WifiOff } from 'lucide-react';
import { outQuart, span } from '../lab/time';
import { ON_PREMISE } from './data';
import { T } from './timeline';

/**
 * Academy desk's On-premise card, rebuilt from the app's agent home (agent/cards.tsx): where it
 * runs, this computer's GPU, the model build, the memory it took at its peak, and the guard that
 * keeps it offline. The network goes as it is framed.
 */

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
              {ON_PREMISE.peak.gb} GB of {ON_PREMISE.peak.of}
            </span>
          </span>
          <Meter
            value={ON_PREMISE.peak.share}
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
              from={<>The network is up; it reaches only this computer</>}
              to={<>Reaches only this computer; no call has left it since Architect started</>}
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

/**
 * Academy desk's home as the film shows it: its On-premise card alone, centered in the page, so
 * the camera frames it centered and whole with nothing else beside it.
 */
export function OnPremisePage({ t }: { t: number }) {
  return (
    <div className="flex h-full items-center justify-center">
      <div className="w-[366px]" data-frame="home-premise">
        <OnPremise t={t} />
      </div>
    </div>
  );
}
