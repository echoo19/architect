import type { ReactNode } from 'react';
import type { TrainingPlan } from '@architect/shared';
import {
  Badge,
  Button,
  Card,
  Disclosure,
  TableBody,
  TableCard,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@architect/ui';
import { gbText, gpuName, type PlanSettings } from './model';

/** A row of the breakdown: what it is, how it was worked out, where it sits, how much. */
function Term({
  label,
  arithmetic,
  held,
  bytes,
  strong,
}: {
  label: string;
  arithmetic: string;
  held: ReactNode;
  bytes: ReactNode;
  strong?: boolean;
}) {
  return (
    <TableRow>
      <TableCell className="align-top">
        <span className={strong ? 'font-semibold' : 'font-medium'}>{label}</span>
        <span className="mt-1 block select-text break-words font-mono text-small font-normal leading-5">
          {arithmetic}
        </span>
      </TableCell>
      <TableCell className="w-28 whitespace-nowrap align-top">{held}</TableCell>
      <TableCell
        className={`w-28 whitespace-nowrap text-right align-top ${strong ? 'font-semibold' : ''}`}
      >
        {bytes}
      </TableCell>
    </TableRow>
  );
}

/**
 * The plan's answer first: how many GPUs in how many nodes, and the memory on each against what is
 * usable, then the hardware it was sized for with a way to change it. The memory term by term,
 * with its arithmetic, is a click away. Every figure is an estimate and says so once.
 */
export function Breakdown({
  plan,
  settings,
  onChangeHardware,
}: {
  plan: TrainingPlan;
  settings: PlanSettings;
  onChangeHardware: () => void;
}) {
  const { fit } = plan;
  const sharded = plan.terms.filter((term) => term.sharded);
  const whole = plan.terms.filter((term) => !term.sharded);
  return (
    <Card title="Memory on each GPU" action={<Badge>Estimate</Badge>}>
      <div className="flex flex-col gap-2 pb-4 pt-1">
        {fit ? (
          <p className="m-0 font-display text-h2 font-semibold tabular-nums text-pretty">
            Fits on <span>{fit.gpus}</span> {fit.gpus === 1 ? 'GPU' : 'GPUs'}
            {fit.nodes > 1 ? ` in ${fit.nodes} nodes` : ''}, {gbText(fit.perGpuBytes)}{' '}
            {fit.gpus === 1 ? '' : 'each '}of {gbText(plan.headroom.usableBytes)} usable
          </p>
        ) : (
          <>
            <p className="m-0 font-display text-h2 font-semibold">Doesn&apos;t fit</p>
            <p className="m-0 max-w-[640px] text-body">{plan.reason}</p>
          </>
        )}
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-ui">
          <span>
            Sized for {gpuName(settings.gpu)}, {settings.gpusPerNode} per node, {settings.precision}
          </span>
          <Button variant="ghost" size="xs" className="-ml-1.5" onClick={onChangeHardware}>
            Change hardware
          </Button>
        </div>
      </div>
      <Disclosure label="How this is worked out">
        <TableCard aria-label="Memory terms">
          <TableHeader>
            <TableRow>
              <TableHead>Term</TableHead>
              <TableHead>Held</TableHead>
              <TableHead className="text-right">Memory</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {[...sharded, ...whole].map((term) => (
              <Term
                key={term.key}
                label={term.label}
                arithmetic={term.arithmetic}
                held={term.sharded ? 'Sharded' : 'Each GPU'}
                bytes={gbText(term.bytes)}
              />
            ))}
            <Term
              label="Usable per GPU"
              arithmetic={plan.headroom.arithmetic}
              held="Each GPU"
              bytes={gbText(plan.headroom.usableBytes)}
            />
            {fit && (
              <Term
                strong
                label={`${fit.gpus} ${fit.gpus === 1 ? 'GPU' : 'GPUs'}`}
                arithmetic={fit.arithmetic}
                held="Each GPU"
                bytes={gbText(fit.perGpuBytes)}
              />
            )}
          </TableBody>
        </TableCard>
        <ul className="m-0 flex list-disc flex-col gap-1.5 pl-5 pt-4 text-ui">
          {[...plan.assumptions, ...plan.size.notes].map((note) => (
            <li key={note}>{note}</li>
          ))}
        </ul>
      </Disclosure>
    </Card>
  );
}
