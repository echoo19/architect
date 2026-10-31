import { useState } from 'react';
import type { SampleJob } from '@architect/shared';
import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  Tooltip,
  type ButtonProps,
} from '@architect/ui';
import { ChartLine, FlaskConical, GraduationCap, Microscope, TestTubes } from 'lucide-react';
import { flowApi } from '../../api/client';
import { queryKeys } from '../../api/hooks';
import { setQueryData } from '../../api/query';
import { attempt } from '../../lib/notify';
import { navigate, paths } from '../../lib/router';

const OFFERS = {
  'home-services': {
    label: 'Try the sample job',
    says: 'Watch Architect train an agent on a small example job',
    Icon: FlaskConical,
  },
  academy: {
    label: 'Try the Academy desk',
    says: 'Academy desk, for the staff of test-prep academies: taught at three, tested at one it never saw',
    Icon: GraduationCap,
  },
} as const;

/** The science lab's specialists, each taught at three organizations and tested at one more. */
const SCIENCE_LAB = [
  {
    sample: 'sweep-desk',
    name: 'Sweep desk',
    says: "Reads a research group's training runs",
    Icon: ChartLine,
  },
  {
    sample: 'assay-desk',
    name: 'Assay desk',
    says: "Reads screening labs' plate-reader exports",
    Icon: TestTubes,
  },
] as const;

/** Makes a sample job and opens its Define, saying so if it can't. */
function useStartSample() {
  const [creating, setCreating] = useState(false);
  const start = async (sample: SampleJob) => {
    setCreating(true);
    const job = await attempt("Couldn't create the sample job", () => flowApi.createSample(sample));
    setCreating(false);
    if (!job) return;
    setQueryData(queryKeys.job(job.id), job);
    navigate(paths.define(job.id));
  };
  return { creating, start };
}

/**
 * The offer to start from a sample job Architect trains an agent for, to watch it work: the small
 * service desk, or Academy desk, the staff-facing agent for test-prep academies. It sits beside
 * the offer of a ready-made agent, so they read as one choice: watch one being made, or open one
 * that is made.
 */
export function SampleJobButton({
  size,
  sample = 'home-services',
}: Pick<ButtonProps, 'size'> & { sample?: keyof typeof OFFERS }) {
  const { creating, start } = useStartSample();
  const { label, says, Icon } = OFFERS[sample];
  return (
    <Tooltip content={says} side="bottom">
      <Button size={size} loading={creating} onClick={() => void start(sample)}>
        {!creating && <Icon size={15} strokeWidth={1.7} aria-hidden />}
        {label}
      </Button>
    </Tooltip>
  );
}

/**
 * One offer for the science lab's samples: it opens a choice of its specialists, Sweep desk and
 * Assay desk, and starts the one picked like any other sample job.
 */
export function ScienceLabButton({ size }: Pick<ButtonProps, 'size'>) {
  const { creating, start } = useStartSample();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button size={size} loading={creating}>
          {!creating && <Microscope size={15} strokeWidth={1.7} aria-hidden />}
          Try a science lab
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent>
        {SCIENCE_LAB.map(({ sample, name, says, Icon }) => (
          <DropdownMenuItem
            key={sample}
            icon={<Icon strokeWidth={1.7} aria-hidden />}
            description={says}
            onSelect={() => void start(sample)}
          >
            {name}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
