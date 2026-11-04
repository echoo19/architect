import { useId, type ReactNode } from 'react';
import { Button, Heading } from '@architect/ui';
import { Cloud, Laptop, Network, Server, Ship, type LucideIcon } from 'lucide-react';
import type { WspComputeId } from '@architect/shared';

/** The steps of a new experiment, as the flow's header shows them. */
export const WSP_STEPS = ['Model', 'Goal', 'Compute', 'Brief'] as const;
export type WspStep = (typeof WSP_STEPS)[number];

export const COMPUTE_ICONS: Record<WspComputeId, LucideIcon> = {
  'local-cpu': Laptop,
  'hf-jobs': Cloud,
  slurm: Server,
  kubernetes: Network,
  skypilot: Ship,
};

/** A step's column, at the width a form reads well in. */
export function StepBody({
  title,
  end,
  children,
}: {
  title: string;
  end?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="mx-auto box-content flex max-w-[880px] flex-col gap-8 px-8 pb-12 pt-12">
      <div className="flex min-h-10 flex-wrap items-center justify-between gap-4">
        <Heading as="h1" size="display-sm">
          {title}
        </Heading>
        {end}
      </div>
      {children}
    </div>
  );
}

/** The bar under a step: the way back at the left, the way on at the right. */
export function StepFooter({ back, children }: { back?: () => void; children: ReactNode }) {
  return (
    <div className="mx-auto box-content flex max-w-[880px] items-center justify-between gap-3 px-8">
      {back ? (
        <Button size="lg" onClick={back}>
          Back
        </Button>
      ) : (
        <span />
      )}
      {children}
    </div>
  );
}

/**
 * The way on, with why it is held in a short line beside it that also describes the button. A
 * held button can't be pressed; the line says what to do.
 */
export function GoOn({
  label,
  held,
  loading,
  onClick,
}: {
  label: string;
  /** Why it can't be pressed yet; null when it can. */
  held: string | null;
  loading?: boolean;
  onClick: () => void;
}) {
  const id = useId();
  return (
    <div className="flex items-center gap-4">
      {held !== null && (
        <span id={id} className="text-small">
          {held}
        </span>
      )}
      <Button
        variant="primary"
        size="lg"
        disabled={held !== null}
        loading={loading}
        aria-describedby={held === null ? undefined : id}
        onClick={onClick}
      >
        {label}
      </Button>
    </div>
  );
}
