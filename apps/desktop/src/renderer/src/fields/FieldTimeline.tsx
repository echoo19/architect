import type { ReactNode } from 'react';
import type { StudyState } from '@architect/shared';
import { Card, CardRow, Skeleton } from '@architect/ui';
import {
  ArrowRight,
  BookOpen,
  ChevronRight,
  ClipboardCheck,
  FlaskConical,
  FolderOutput,
  GitFork,
  GraduationCap,
  History,
  ShieldCheck,
} from 'lucide-react';
import { api } from '../api/client';
import { computeApi } from '../api/compute';
import { experimentsApi } from '../api/experiments';
import { graduatesApi } from '../api/graduates';
import { mentoringApi } from '../api/mentoring';
import { useQuery } from '../api/query';
import { ProblemState } from '../components/ProblemState';
import { shortDate } from '../flow/format';
import { navigate } from '../lib/router';
import { loadRegistry } from '../models/load';
import { useFieldExports } from './exports';
import type { FieldSummary } from './model';
import { Tile } from './parts';
import {
  fieldTimeline,
  STAGE_WORDS,
  type HeldVersion,
  type Link,
  type Stage,
  type TimelineRecords,
} from './timeline';

export type FieldTabTarget = 'organizations' | 'assets';

const STAGE_ICONS: Record<Stage, ReactNode> = {
  learned: <GitFork strokeWidth={1.8} aria-hidden />,
  studied: <BookOpen strokeWidth={1.8} aria-hidden />,
  taught: <GraduationCap strokeWidth={1.8} aria-hidden />,
  tested: <ClipboardCheck strokeWidth={1.8} aria-hidden />,
  certified: <ShieldCheck strokeWidth={1.8} aria-hidden />,
  compared: <FlaskConical strokeWidth={1.8} aria-hidden />,
  exported: <FolderOutput strokeWidth={1.8} aria-hidden />,
};

/** The records the field's own reads don't carry: its counterexamples, versions and the rest. */
async function readRecords(
  field: FieldSummary,
): Promise<Omit<TimelineRecords, 'study' | 'exported'>> {
  const jobId = field.job.id;
  const runIds = new Set(field.runs.map((run) => run.id));
  const taught = field.view.sealed.flatMap((org) =>
    org.taughtIn ? [{ ...org.taughtIn, org: org.name }] : [],
  );
  const [counterexamples, qualifications, experiments, registry, laterVersions] = await Promise.all(
    [
      mentoringApi.fieldCounterexamples(jobId),
      computeApi.qualifications(jobId),
      experimentsApi.list(),
      loadRegistry(),
      Promise.all(
        taught.map(async (later) => ({ ...later, at: (await api.job(later.jobId)).createdAt })),
      ),
    ],
  );
  const rows = registry.filter(
    (row) => row.version.runId !== undefined && runIds.has(row.version.runId),
  );
  const certifications = await Promise.all(
    rows.map((row) => graduatesApi.certifications(row.agent.id, row.version.version)),
  );
  const versions: HeldVersion[] = rows.map((row) => ({
    key: row.key,
    name: `${row.agent.name} v${row.version.version}`,
    runId: row.version.runId ?? '',
  }));
  return {
    counterexamples,
    qualifications,
    experiments: experiments.filter((item) => item.input.jobId === jobId),
    versions,
    certifications: certifications.flat(),
    laterVersions,
  };
}

const chevron = <ChevronRight size={16} strokeWidth={1.8} aria-hidden />;

/** A row's lead: its date in a column of its own, then its stage's icon. */
function Lead({ at, icon }: { at: string | null; icon: ReactNode }) {
  return (
    <span className="flex items-center gap-4">
      <span className="w-12 text-ui tabular-nums">{at}</span>
      <Tile>{icon}</Tile>
    </span>
  );
}

/**
 * The field's life, oldest first: learned from, studied, taught, tested, certified, compared and
 * exported, each entry a stored record with the place that holds it, then one next step when
 * something is missing.
 */
export function Timeline({
  field,
  study,
  openTab,
}: {
  field: FieldSummary;
  study: StudyState | undefined;
  openTab: (tab: FieldTabTarget) => void;
}) {
  const read = useQuery(`fieldTimeline:${field.job.id}`, () => readRecords(field), {
    refreshOnMount: true,
  });
  const latest = useFieldExports((state) => state.latest[field.job.id]);
  if (!read.data) {
    return read.status === 'error' ? (
      <ProblemState
        error={read.error}
        title="Couldn't read this field's history"
        onRetry={read.reload}
      />
    ) : (
      <Skeleton aria-busy="true" className="h-64 rounded-card" />
    );
  }
  const exported = latest && { dir: latest.dir, at: new Date(latest.at).toISOString() };
  const { entries, next } = fieldTimeline(field, { ...read.data, study, exported });
  const follow = (link: Link) => ('tab' in link.to ? openTab(link.to.tab) : navigate(link.to.path));
  const end = (link: Link) => (
    <>
      {link.place}
      {chevron}
    </>
  );
  return (
    <Card title="Timeline" icon={<History strokeWidth={1.8} aria-hidden />} flush>
      <ol aria-label="Timeline" className="m-0 flex list-none flex-col p-0">
        {entries.map((entry) => (
          <li key={entry.key}>
            <CardRow
              icon={<Lead at={shortDate(entry.at)} icon={STAGE_ICONS[entry.stage]} />}
              title={entry.sentence}
              detail={STAGE_WORDS[entry.stage]}
              end={end(entry.link)}
              onClick={() => follow(entry.link)}
            />
          </li>
        ))}
        {next && (
          <li>
            <CardRow
              icon={<Lead at={null} icon={<ArrowRight strokeWidth={1.8} aria-hidden />} />}
              title={next.sentence}
              detail="Next step"
              end={end(next.link)}
              onClick={() => follow(next.link)}
            />
          </li>
        )}
      </ol>
    </Card>
  );
}
