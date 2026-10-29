import { useState } from 'react';
import { Button, Tooltip, type ButtonProps } from '@architect/ui';
import { FileUp } from 'lucide-react';
import { flowApi } from '../../api/client';
import { queryKeys } from '../../api/hooks';
import { setQueryData } from '../../api/query';
import { attempt } from '../../lib/notify';
import { navigate, paths } from '../../lib/router';

/**
 * The offer to start from a job file: a job someone made, with its tasks and data beside it. It
 * sits with the sample job and the ready-made agent, as a third way into a new agent that needs
 * no description. A file that isn't one says what a job folder holds.
 */
export function ImportJobButton({ size }: Pick<ButtonProps, 'size'>) {
  const [importing, setImporting] = useState(false);

  const start = async () => {
    const picked = await attempt("Couldn't open the file picker", () =>
      flowApi.pickFiles({
        title: 'Import a job file',
        filters: [{ name: 'Job file', extensions: ['json'] }],
      }),
    );
    const file = picked?.[0];
    if (!file) return;
    setImporting(true);
    const job = await attempt("Couldn't import the job file", () => flowApi.importJob(file));
    setImporting(false);
    if (!job) return;
    setQueryData(queryKeys.job(job.id), job);
    navigate(paths.define(job.id));
  };

  return (
    <Tooltip content="Start from a job file, with its tasks and data beside it" side="bottom">
      <Button size={size} loading={importing} onClick={() => void start()}>
        {!importing && <FileUp size={15} strokeWidth={1.7} aria-hidden />}
        Import a job file
      </Button>
    </Tooltip>
  );
}
