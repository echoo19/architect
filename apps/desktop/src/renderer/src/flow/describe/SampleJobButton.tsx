import { useState } from 'react';
import type { SampleJob } from '@architect/shared';
import { Button, Tooltip, type ButtonProps } from '@architect/ui';
import { FlaskConical, GraduationCap, Microscope } from 'lucide-react';
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
  'assay-desk': {
    label: 'Try a science lab',
    says: 'Assay desk reads plate-reader exports for screening labs: taught at three, tested at one it never saw',
    Icon: Microscope,
  },
} as const;

/**
 * The offer to start from a sample job Architect trains an agent for, to watch it work: the small
 * service desk, the Academy desk (a staff-facing agent for test-prep academies), or the Assay
 * desk, a science lab sample. It sits beside the offer of a ready-made agent, so they read as one
 * choice: watch one being made, or open one that is made.
 */
export function SampleJobButton({
  size,
  sample = 'home-services',
}: Pick<ButtonProps, 'size'> & { sample?: SampleJob }) {
  const [creating, setCreating] = useState(false);
  const { label, says, Icon } = OFFERS[sample];

  const start = async () => {
    setCreating(true);
    const job = await attempt("Couldn't create the sample job", () => flowApi.createSample(sample));
    setCreating(false);
    if (!job) return;
    setQueryData(queryKeys.job(job.id), job);
    navigate(paths.define(job.id));
  };

  return (
    <Tooltip content={says} side="bottom">
      <Button size={size} loading={creating} onClick={() => void start()}>
        {!creating && <Icon size={15} strokeWidth={1.7} aria-hidden />}
        {label}
      </Button>
    </Tooltip>
  );
}
