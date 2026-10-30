import type { Capability, Installation, ReferenceRecord, Score } from '@architect/shared';
import {
  Disclosure,
  EvidenceMark,
  EvidenceMeter,
  Skeleton,
  StatusMark,
  Tooltip,
  type EvidenceKind,
} from '@architect/ui';
import type { QueryState } from '../../api/query';
import { ProblemState } from '../../components/ProblemState';
import { CheckRows } from '../../install/InstallChecks';
import { STATUS_LABELS, statusMark, WORKS_HERE_TITLE } from '../../install/labels';
import { rate } from '../format';
import { Section } from '../ledger';
import type { ModelNames } from '../train/phase';
import type { CapabilityEvidence } from './evidence';

/** The kinds of result a capability shows, in the order a row reads them. */
const COLUMNS: {
  kind: Exclude<EvidenceKind, 'install'>;
  label: string;
  /** What the column's tasks are, said when its name is hovered or focused. */
  what: (mentor: string) => string;
  pick: (c: Capability) => Score | null;
}[] = [
  // The engine counts the latest round that practiced each type.
  {
    kind: 'practice',
    label: 'Practice tasks',
    what: (mentor) => `${mentor} teaches from these`,
    pick: (capability) => capability.practice,
  },
  {
    kind: 'check',
    label: 'Check tasks',
    what: (mentor) => `${mentor} sees only the score`,
    pick: (capability) => capability.check,
  },
  {
    kind: 'final',
    label: 'Final test',
    what: () => 'Opened once, at the end',
    pick: (capability) => capability.finalTest,
  },
];

/** A category's line under its task type, said only where teaching gave up on it. */
function stoppedLine(category: Capability['categories'][number], mentor: string): string | null {
  return category.stopped ? `${mentor} stopped teaching ${category.label}: no gain` : null;
}

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
 * its own kind of bar: practice tasks Spark teaches from, check tasks it sees only the score of,
 * and the final test. Spark's own score stands beside a bar's, and its tick marks the bar, only
 * where Spark was measured on the same tasks. This computer's checks belong to the agent, not to a
 * task type, and close the section on their own line.
 */
export function Capabilities({
  evidence,
  installation,
  names,
}: {
  evidence: QueryState<CapabilityEvidence>;
  installation: Installation | null;
  names: ModelNames;
}) {
  const breakdown = evidence.data?.capabilities;
  const references = evidence.data?.references ?? [];
  // A kind of result no task type has is left out, rather than a column of blanks.
  const columns = COLUMNS.filter((column) =>
    breakdown?.capabilities.some((capability) => column.pick(capability) !== null),
  );
  return (
    <Section title="By task type" id="capabilities">
      {evidence.status === 'loading' && breakdown === undefined && (
        <div aria-busy="true" aria-label="Loading the results by task type">
          <Skeleton className="h-40 w-full rounded-control" />
        </div>
      )}
      {evidence.status === 'error' && (
        <ProblemState
          layout="inline"
          error={evidence.error}
          title="Couldn't load the results by task type"
          onRetry={evidence.reload}
        />
      )}
      {breakdown && columns.length === 0 && (
        <p className="m-0 border-y border-line py-3.5">No task type has a result yet.</p>
      )}
      {breakdown && columns.length > 0 && (
        <div className="overflow-x-auto border-b border-line">
          <table
            aria-label="Results by task type"
            className="w-full min-w-[640px] border-collapse text-left"
          >
            <thead>
              <tr>
                <th className="w-[26%] pb-3" />
                {columns.map((column) => (
                  <th key={column.kind} scope="col" className="pb-3 pl-8 font-normal">
                    <Tooltip content={column.what(names.mentor)}>
                      <span tabIndex={0} className="inline-flex cursor-help rounded-mark">
                        <EvidenceMark kind={column.kind}>{column.label}</EvidenceMark>
                      </span>
                    </Tooltip>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {breakdown.capabilities.map((capability) => (
                <tr key={capability.type} className="border-t border-line">
                  <th scope="row" className="py-3.5 pr-4 align-middle font-normal">
                    <span className="flex flex-col gap-1">
                      <span>{capability.label}</span>
                      {capability.categories.map((category) => {
                        const line = stoppedLine(category, names.mentor);
                        return (
                          line && (
                            <span key={category.id} className="text-small text-pretty">
                              {line}
                            </span>
                          )
                        );
                      })}
                    </span>
                  </th>
                  {columns.map((column) => (
                    <td key={column.kind} className="py-3.5 pl-8 align-middle">
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
        <div className="border-b border-line py-2">
          {installation.checks.length > 0 ? (
            <Disclosure label={<InstallLine installation={installation} />}>
              <CheckRows installation={installation} />
            </Disclosure>
          ) : (
            <div className="flex h-8 items-center pl-0.5">
              <InstallLine installation={installation} />
            </div>
          )}
        </div>
      )}
    </Section>
  );
}

/** This computer's checks of the agent in one line: that it works here, and how the checks came out. */
function InstallLine({ installation }: { installation: Installation }) {
  return (
    <span className="flex items-center gap-4">
      <EvidenceMark kind="install">{WORKS_HERE_TITLE}</EvidenceMark>
      <span className="flex items-center gap-2 font-normal">
        <StatusMark state={statusMark(installation.status)} size={14} />
        {STATUS_LABELS[installation.status]}
      </span>
    </span>
  );
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
    return <span className="text-small">Not measured</span>;
  }
  const sparkText = spark ? `; ${mentor} ${spark.pass} of ${spark.total} passed` : '';
  return (
    <span className="flex items-center gap-4">
      <EvidenceMeter
        kind={kind}
        value={score.total === 0 ? 0 : rate(score) / 100}
        label={label}
        valueText={`${score.pass} of ${score.total} passed${sparkText}`}
        className="min-w-16 flex-1"
        {...(spark ? { marker: spark.total === 0 ? 0 : rate(spark) / 100 } : {})}
      />
      <span className="shrink-0 whitespace-nowrap font-mono text-small tabular-nums">
        {score.pass} of {score.total}
        {spark && (
          <span className="font-sans text-mentor">
            {' · '}
            {mentor} {spark.pass} of {spark.total}
          </span>
        )}
      </span>
    </span>
  );
}
