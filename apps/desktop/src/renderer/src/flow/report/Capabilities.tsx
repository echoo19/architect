import type { Capability, Installation, ReferenceRecord, Score } from '@architect/shared';
import {
  ErrorState,
  EvidenceMark,
  EvidenceMeter,
  Heading,
  Skeleton,
  StatusMark,
  type EvidenceKind,
} from '@architect/ui';
import type { QueryState } from '../../api/query';
import { INSTALL_CHECKS_TITLE, STATUS_LABELS, statusMark } from '../../install/labels';
import { rate } from '../format';
import type { ModelNames } from '../train/phase';
import type { ReportEvidence } from './evidence';

/** The kinds of result a capability shows, in the order a row reads them. */
const COLUMNS: {
  kind: Exclude<EvidenceKind, 'install'>;
  label: string;
  pick: (c: Capability) => Score | null;
}[] = [
  { kind: 'practice', label: 'Practice', pick: (capability) => capability.practice },
  { kind: 'check', label: 'Check tasks', pick: (capability) => capability.check },
  { kind: 'final', label: 'Final test', pick: (capability) => capability.finalTest },
];

/** Spark's own score on a type, only from a reference measured on that same split. */
function sparkScore(
  references: readonly ReferenceRecord[],
  kind: EvidenceKind,
  type: string,
): Score | null {
  const split = kind === 'check' ? 'dev' : kind === 'final' ? 'test' : null;
  if (split === null) return null;
  const record = references.find((item) => item.split === split && item.status === 'finished');
  const score = record?.perType.find((item) => item.type === type);
  return score ? { pass: score.pass, total: score.total } : null;
}

/**
 * What the agent can do, task type by task type, with each kind of result in its own column and
 * its own kind of bar: practice on training tasks Spark saw, check tasks hidden from Spark, and
 * the locked final test. Spark's tick marks a bar only where Spark was measured on the same tasks.
 * Install checks belong to this computer, not to a task type, and close the section on their own.
 */
export function Capabilities({
  evidence,
  installation,
  names,
}: {
  evidence: QueryState<ReportEvidence>;
  installation: Installation | null;
  names: ModelNames;
}) {
  const breakdown = evidence.data?.capabilities;
  const references = evidence.data?.references ?? [];
  const marked =
    breakdown?.capabilities.some((capability) =>
      COLUMNS.some((column) => sparkScore(references, column.kind, capability.type) !== null),
    ) ?? false;
  return (
    <section aria-labelledby="capabilities" className="flex flex-col gap-[18px]">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <Heading id="capabilities">Capabilities</Heading>
        {marked && (
          <span className="flex items-center gap-2 text-sm text-mentor">
            <span aria-hidden className="h-3 w-0.5 rounded-sm bg-mentor" />
            {names.mentor}
          </span>
        )}
      </div>
      {evidence.status === 'loading' && breakdown === undefined && (
        <div aria-busy="true" aria-label="Loading the capabilities">
          <Skeleton className="h-40 w-full rounded-xl" />
        </div>
      )}
      {evidence.status === 'error' && (
        <ErrorState
          layout="inline"
          title="Couldn't load the capabilities"
          message={evidence.error.message}
          onRetry={evidence.reload}
        />
      )}
      {breakdown && (
        <div className="overflow-x-auto">
          <table
            aria-label="Capabilities by task type"
            className="w-full min-w-[640px] border-collapse text-left"
          >
            <thead>
              <tr>
                <th className="w-[28%] pb-3 font-normal" />
                {COLUMNS.map((column) => (
                  <th key={column.kind} scope="col" className="pb-3 pl-6 font-normal">
                    <EvidenceMark kind={column.kind}>{column.label}</EvidenceMark>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {breakdown.capabilities.map((capability) => (
                <tr key={capability.type} className="border-t border-line-card align-top">
                  <th scope="row" className="py-3.5 pr-4 font-normal">
                    <span className="flex flex-col gap-1">
                      <span>{capability.label}</span>
                      {capability.categories.length > 0 && (
                        <span className="flex flex-col gap-0.5 text-sm text-fg-muted">
                          {capability.categories.map((category) => (
                            <span key={category.id}>
                              {category.label}
                              <span aria-hidden> · </span>
                              {category.stopped
                                ? 'teaching stopped'
                                : `${category.verifiedLessons} ${category.verifiedLessons === 1 ? 'example' : 'examples'}`}
                            </span>
                          ))}
                        </span>
                      )}
                    </span>
                  </th>
                  {COLUMNS.map((column) => (
                    <td key={column.kind} className="py-3.5 pl-6">
                      <ScoreBar
                        kind={column.kind}
                        label={`${capability.label}, ${column.label.toLowerCase()}`}
                        score={column.pick(capability)}
                        spark={sparkScore(references, column.kind, capability.type)}
                        mentor={names.mentor}
                      />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {installation && (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-line-card pt-3.5">
          <EvidenceMark kind="install">{INSTALL_CHECKS_TITLE}</EvidenceMark>
          <span className="flex items-center gap-2 text-sm text-fg-secondary">
            <StatusMark state={statusMark(installation.status)} size={14} />
            {STATUS_LABELS[installation.status]}
            {installation.checks.length > 0 && (
              <span className="text-fg-muted">· {checkCounts(installation)}</span>
            )}
          </span>
        </div>
      )}
    </section>
  );
}

/** "6 passed", "5 passed, 1 skipped", "4 passed, 1 failed": the checks' outcomes by kind. */
function checkCounts(installation: Installation): string {
  const count = (status: string) =>
    installation.checks.filter((check) => check.status === status).length;
  return [
    `${count('passed')} passed`,
    count('failed') > 0 && `${count('failed')} failed`,
    count('skipped') > 0 && `${count('skipped')} skipped`,
  ]
    .filter(Boolean)
    .join(', ');
}

function ScoreBar({
  kind,
  label,
  score,
  spark,
  mentor,
}: {
  kind: EvidenceKind;
  label: string;
  score: Score | null;
  spark: Score | null;
  mentor: string;
}) {
  if (score === null) {
    return <span className="text-sm text-fg-faint">Not measured</span>;
  }
  const sparkText = spark ? `; ${mentor} ${spark.pass} of ${spark.total} passed` : '';
  return (
    <span className="flex flex-col gap-2">
      <span className="font-mono text-sm tabular-nums text-fg-secondary">
        <span className="text-fg">{score.pass}</span> of {score.total}
      </span>
      <EvidenceMeter
        kind={kind}
        value={score.total === 0 ? 0 : rate(score) / 100}
        label={label}
        valueText={`${score.pass} of ${score.total} passed${sparkText}`}
        {...(spark ? { marker: spark.total === 0 ? 0 : rate(spark) / 100 } : {})}
      />
    </span>
  );
}
