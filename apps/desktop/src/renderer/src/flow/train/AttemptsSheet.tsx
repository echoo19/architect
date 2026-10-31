import { useState } from 'react';
import type { AttemptQuery, BrowsedAttempt, Job, Round } from '@architect/shared';
import { Button, DrawerContent, Select, Skeleton } from '@architect/ui';
import { create } from 'zustand';
import { api } from '../../api/client';
import { useQuery } from '../../api/query';
import { ProblemState } from '../../components/ProblemState';
import { attempt as tryTo } from '../../lib/notify';
import { typeLabel } from '../names';
import { AttemptRow } from './LatestAttempts';

/*
 * Every practice and check attempt of a run (decision 084), newest first, a page at a time,
 * filtered by round, type, organization and verdict. A row opens its trace. The final test's
 * attempts are never among them: the engine reads only the practice and check splits.
 */

const ALL = 'all';

type Verdict = typeof ALL | 'passed' | 'failed';

interface Filters {
  round: string;
  type: string;
  org: string;
  verdict: Verdict;
}

const NO_FILTERS: Filters = { round: ALL, type: ALL, org: ALL, verdict: ALL };

/** The pages read past the first, for the query they belong to. */
interface More {
  key: string;
  attempts: BrowsedAttempt[];
  next: string | null;
}

/**
 * What the sheet shows of each run, kept while an attempt opened from it is read, so Back returns
 * to the same filters and pages.
 */
const useBrowsing = create<Record<string, { filters: Filters; more: More | null }>>(() => ({}));

function queryOf(filters: Filters): AttemptQuery {
  return {
    ...(filters.round === ALL ? {} : { round: Number(filters.round) }),
    ...(filters.type === ALL ? {} : { type: filters.type }),
    ...(filters.org === ALL ? {} : { org: filters.org }),
    ...(filters.verdict === ALL ? {} : { passed: filters.verdict === 'passed' }),
  };
}

export function AttemptsSheet({
  runId,
  job,
  rounds,
  mentor,
  onOpen,
  onBack,
}: {
  runId: string;
  job: Job;
  rounds: readonly Round[];
  mentor: string;
  onOpen: (attempt: BrowsedAttempt) => void;
  onBack?: (() => void) | undefined;
}) {
  const browsing = useBrowsing((state) => state[runId]);
  const filters = browsing?.filters ?? NO_FILTERS;
  const more = browsing?.more ?? null;
  const keep = (next: { filters?: Filters; more?: More | null }) =>
    useBrowsing.setState((state) => ({
      [runId]: { filters, more, ...state[runId], ...next },
    }));
  const set = (patch: Partial<Filters>) => keep({ filters: { ...filters, ...patch } });
  const orgs = (job.organizations ?? []).filter((org) => org.role === 'train');
  const query = queryOf(filters);
  const key = `attempts:${runId}:${JSON.stringify(query)}`;
  const first = useQuery(key, () => api.attempts(runId, query));
  const [loading, setLoading] = useState(false);
  const extra = more?.key === key ? more : null;
  const next = extra ? extra.next : (first.data?.next ?? null);
  const attempts = [...(first.data?.attempts ?? []), ...(extra?.attempts ?? [])];

  const loadMore = async () => {
    if (next === null) return;
    setLoading(true);
    const page = await tryTo("Couldn't load more attempts", () =>
      api.attempts(runId, { ...query, cursor: next }),
    );
    setLoading(false);
    if (!page) return;
    keep({
      more: { key, attempts: [...(extra?.attempts ?? []), ...page.attempts], next: page.next },
    });
  };

  return (
    <DrawerContent
      title="Attempts"
      onBack={onBack}
      subtitle={
        first.data
          ? `${first.data.total.toLocaleString('en-US')} practice and check ${first.data.total === 1 ? 'attempt' : 'attempts'}`
          : undefined
      }
    >
      <div className="flex flex-col gap-5">
        <div className="grid grid-cols-2 gap-2">
          <Select
            aria-label="Round"
            value={filters.round}
            onValueChange={(round) => set({ round })}
            options={[
              { value: ALL, label: 'Every round' },
              ...rounds.map((round) => ({
                value: String(round.index),
                label: `Round ${round.index}`,
              })),
            ]}
          />
          <Select
            aria-label="Type"
            value={filters.type}
            onValueChange={(type) => set({ type })}
            options={[
              { value: ALL, label: 'Every type' },
              ...job.taskTypes.map((type) => ({ value: type.id, label: type.label })),
            ]}
          />
          {orgs.length > 0 && (
            <Select
              aria-label="Organization"
              value={filters.org}
              onValueChange={(org) => set({ org })}
              options={[
                { value: ALL, label: 'Every organization' },
                ...orgs.map((org) => ({ value: org.id, label: org.name })),
              ]}
            />
          )}
          <Select<Verdict>
            aria-label="Verdict"
            value={filters.verdict}
            onValueChange={(verdict) => set({ verdict })}
            options={[
              { value: ALL, label: 'Passed or failed' },
              { value: 'passed', label: 'Passed' },
              { value: 'failed', label: 'Failed' },
            ]}
          />
        </div>
        {first.status === 'error' ? (
          <ProblemState
            layout="inline"
            error={first.error}
            title="Couldn't load the attempts"
            onRetry={first.reload}
          />
        ) : !first.data ? (
          <div aria-busy="true" aria-label="Loading the attempts" className="flex flex-col gap-2">
            <Skeleton className="h-12 w-full" />
            <Skeleton className="h-12 w-full" />
            <Skeleton className="h-12 w-full" />
          </div>
        ) : attempts.length === 0 ? (
          <p className="m-0 border-y border-line py-3.5">No attempts match</p>
        ) : (
          <ul aria-label="Attempts" className="m-0 list-none border-b border-line p-0">
            {attempts.map((item) => (
              <li key={item.id} className="border-t border-line">
                <AttemptRow
                  attempt={item}
                  type={typeLabel(job, item.taskType)}
                  mentor={mentor}
                  onOpen={() => onOpen(item)}
                />
              </li>
            ))}
          </ul>
        )}
        {next !== null && first.data && (
          <Button
            size="sm"
            className="self-center"
            loading={loading}
            onClick={() => void loadMore()}
          >
            Show more
          </Button>
        )}
      </div>
    </DrawerContent>
  );
}
