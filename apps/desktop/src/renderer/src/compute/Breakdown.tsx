import type { ReactNode } from 'react';
import type { TrainingPlan } from '@architect/shared';
import {
  Badge,
  Card,
  Disclosure,
  Stat,
  TableBody,
  TableCard,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@architect/ui';
import { gbText } from './model';

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
 * The plan's memory on each GPU, term by term with its arithmetic, and the GPUs and nodes it
 * needs. Every figure is an estimate and says so.
 */
export function Breakdown({ plan }: { plan: TrainingPlan }) {
  const { fit } = plan;
  const sharded = plan.terms.filter((term) => term.sharded);
  const whole = plan.terms.filter((term) => !term.sharded);
  return (
    <Card title="Memory on each GPU" action={<Badge>Estimate</Badge>}>
      {fit ? (
        <div className="grid grid-cols-3 gap-6 pb-6 pt-1">
          <Stat size="lg" value={fit.gpus} label={fit.gpus === 1 ? 'GPU' : 'GPUs'} />
          <Stat
            size="lg"
            value={fit.nodes}
            label={fit.nodes === 1 ? 'Node' : `Nodes of ${fit.gpusPerNode}`}
          />
          <Stat
            size="lg"
            value={gbText(fit.perGpuBytes)}
            label={`Of ${gbText(plan.headroom.usableBytes)} usable`}
          />
        </div>
      ) : (
        <div className="flex flex-col gap-2 pb-6 pt-1">
          <p className="m-0 font-display text-h1 font-semibold">Doesn&apos;t fit</p>
          <p className="m-0 max-w-[640px] text-body">{plan.reason}</p>
        </div>
      )}
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
      <Disclosure label="Assumptions" className="pt-4">
        <ul className="m-0 flex list-disc flex-col gap-1.5 pl-5 text-ui">
          {[...plan.assumptions, ...plan.size.notes].map((note) => (
            <li key={note}>{note}</li>
          ))}
        </ul>
      </Disclosure>
    </Card>
  );
}
