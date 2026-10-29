import { useState } from 'react';
import { Button, Tooltip, type ButtonProps } from '@architect/ui';
import { FlaskConical } from 'lucide-react';
import { flowApi } from '../../api/client';
import { queryKeys } from '../../api/hooks';
import { setQueryData } from '../../api/query';
import { attempt } from '../../lib/notify';
import { navigate, paths } from '../../lib/router';

/**
 * The offer to start from the sample job: a small example job Architect trains an agent for, to
 * watch it work. It sits beside the offer of a ready-made agent, so the two read as one choice:
 * watch one being made, or open one that is made.
 */
export function SampleJobButton({ size }: Pick<ButtonProps, 'size'>) {
  const [creating, setCreating] = useState(false);

  const start = async () => {
    setCreating(true);
    const job = await attempt("Couldn't create the sample job", () => flowApi.createSample());
    setCreating(false);
    if (!job) return;
    setQueryData(queryKeys.job(job.id), job);
    navigate(paths.define(job.id));
  };

  return (
    <Tooltip content="Watch Architect train an agent on a small example job" side="bottom">
      <Button size={size} loading={creating} onClick={() => void start()}>
        {!creating && <FlaskConical size={15} strokeWidth={1.7} aria-hidden />}
        Try the sample job
      </Button>
    </Tooltip>
  );
}
