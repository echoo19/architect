import { useState } from 'react';
import { Button, toast, Tooltip, type ButtonProps } from '@architect/ui';
import { FileUp } from 'lucide-react';
import { architect, flowApi } from '../../api/client';
import { queryKeys } from '../../api/hooks';
import { setQueryData, toError } from '../../api/query';
import { attempt } from '../../lib/notify';
import { problemOf } from '../../lib/problems';
import { navigate, paths } from '../../lib/router';

/** The job folder's format, with a worked example. */
const JOB_FORMAT = 'https://github.com/echoo19/architect/blob/main/docs/JOB_FORMAT.md';

const openFormat = () =>
  void attempt("Couldn't open the page", () => architect().app.openLink(JOB_FORMAT));

/**
 * The offer to start from a job file: a job someone made, with its tasks and data beside it. It
 * sits with the sample job and the ready-made agent, as a third way into a new agent that needs
 * no description. A file that isn't one says what a job folder holds, and opens its format.
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
    let job;
    try {
      job = await flowApi.importJob(file);
    } catch (error) {
      const failure = toError(error);
      const problem = problemOf(failure);
      toast({
        tone: 'danger',
        title: "Couldn't import the job file",
        description: problem
          ? [problem.cause, problem.next].filter(Boolean).join(' ')
          : failure.message,
        action: { label: 'Job folder format', onClick: openFormat },
      });
      return;
    } finally {
      setImporting(false);
    }
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
