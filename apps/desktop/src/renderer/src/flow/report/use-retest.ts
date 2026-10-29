import { useEffect, useState } from 'react';
import { RunEventSchema, type ReportCard } from '@architect/shared';
import { api, architect, flowApi } from '../../api/client';
import { queryKeys, useRunDetail } from '../../api/hooks';
import { fetchQuery, useQuery, type QueryState } from '../../api/query';
import { attempt } from '../../lib/notify';
import { retestView, type RetestProgress } from './retest';

/**
 * The run's own final test on this computer, once its card is filed: for a run whose own test
 * ran online and has been taken here since. Null before then, and for a run tested here.
 */
export function useLocalCard(report: ReportCard): QueryState<ReportCard | null> {
  const detail = useRunDetail(report.runId);
  const filed =
    report.testedOn === 'hosted' && retestView(detail.data?.retests, null).phase === 'finished';
  return useQuery(`${queryKeys.report(report.runId)}:local:${filed ? 'filed' : 'none'}`, () =>
    filed ? api.report(report.runId, 'local') : Promise.resolve(null),
  );
}

/**
 * The test on this computer of a run whose own ran online: where it stands, how far it has got,
 * and a way to start it or to ask again after an error stopped it. The run's record says where it
 * stands; the engine's events say how far, and when to read the record again.
 */
export function useRetest(report: ReportCard) {
  const { runId } = report;
  const detail = useRunDetail(runId);
  const [progress, setProgress] = useState<RetestProgress | null>(null);
  const [starting, setStarting] = useState(false);
  const { reload } = detail;

  useEffect(
    () =>
      architect().runs.onEvent((payload) => {
        const parsed = RunEventSchema.safeParse(payload);
        if (!parsed.success) {
          console.error('[report] A run event did not match the contract.', parsed.error);
          return;
        }
        const event = parsed.data;
        if (event.runId !== runId) return;
        if (event.type === 'eval.progress' && event.split === 'test') {
          setProgress({ done: event.done, total: event.total });
        } else if (
          (event.type === 'eval.finished' && event.split === 'test') ||
          (event.type === 'log' && event.level === 'error')
        ) {
          reload();
        }
      }),
    [runId, reload],
  );

  const start = async () => {
    setStarting(true);
    const started = await attempt("Couldn't start the test on this computer", async () => {
      await flowApi.retest(runId, 'local');
      return true;
    });
    if (started) {
      setProgress(null);
      await fetchQuery(queryKeys.run(runId), () => api.run(runId));
    }
    setStarting(false);
  };

  return { detail, view: retestView(detail.data?.retests, progress), starting, start };
}
