import type { ReactNode } from 'react';
import {
  AgentAvatar,
  Button,
  Card,
  cn,
  IconButton,
  Select,
  Skeleton,
  Tooltip,
} from '@architect/ui';
import { ArrowLeftRight } from 'lucide-react';
import { graduatesApi } from '../api/graduates';
import { useQuery } from '../api/query';
import { FilePatch } from '../components/FilePatch';
import { ProblemState } from '../components/ProblemState';
import { shortDate } from '../flow/format';
import { changeSummary } from '../flow/train/diff';
import { sentence } from '../flow/train/evidence-words';
import { formatPercent } from '../lib/format';
import { PlacePage } from '../shell/PlacePage';
import {
  baseModelOf,
  comparable,
  compareScores,
  formatPoints,
  scoresOf,
  shortHash,
  statusOf,
  STATUS_WORDS,
  type DeltaCell,
  type ModelRow,
  type ScoreComparison,
} from './registry';

const nameOf = (row: ModelRow) => `${row.agent.name} v${row.version.version}`;

/**
 * Two versions side by side: of one agent, or of two agents made for one job. What each is, how
 * their final tests differ wherever both took the same tasks, and what changed in the harness.
 */
export function CompareView({
  pair,
  rows,
  onChange,
  onBack,
}: {
  pair: readonly [ModelRow, ModelRow];
  rows: readonly ModelRow[];
  onChange: (pair: [ModelRow, ModelRow]) => void;
  onBack: () => void;
}) {
  const [before, after] = pair;
  return (
    <PlacePage
      title="Compare"
      action={
        <Button size="md" onClick={onBack}>
          All models
        </Button>
      }
    >
      <Pickers pair={pair} rows={rows} onChange={onChange} />
      <FinalTest before={before} after={after} />
      <Versions pair={pair} />
      <HarnessChanges before={before} after={after} />
    </PlacePage>
  );
}

/** Which two versions: each one's picker, among the versions it can be compared with. */
function Pickers({
  pair,
  rows,
  onChange,
}: {
  pair: readonly [ModelRow, ModelRow];
  rows: readonly ModelRow[];
  onChange: (pair: [ModelRow, ModelRow]) => void;
}) {
  const [before, after] = pair;
  const options = (other: ModelRow) =>
    rows
      .filter((row) => comparable(row, other))
      .map((row) => ({ value: row.key, label: nameOf(row) }));
  const pick = (side: 0 | 1, key: string) => {
    const chosen = rows.find((row) => row.key === key);
    if (!chosen) return;
    onChange(side === 0 ? [chosen, after] : [before, chosen]);
  };
  const picker = (side: 0 | 1) => {
    const row = pair[side];
    return (
      <div className="flex items-center gap-3">
        <AgentAvatar name={row.agent.name} />
        <Select
          aria-label={side === 0 ? 'Before' : 'After'}
          value={row.key}
          options={options(pair[side === 0 ? 1 : 0])}
          onValueChange={(key) => pick(side, key)}
          className="w-56"
        />
      </div>
    );
  };
  return (
    <div className="-mt-2 flex flex-wrap items-center gap-3">
      {picker(0)}
      <Tooltip content="Swap" side="bottom">
        <IconButton label="Swap" size="md" onClick={() => onChange([after, before])}>
          <ArrowLeftRight size={16} strokeWidth={1.8} aria-hidden />
        </IconButton>
      </Tooltip>
      {picker(1)}
    </div>
  );
}

const FACTS: { label: string; value: (row: ModelRow) => ReactNode }[] = [
  { label: 'Base model', value: (row) => baseModelOf(row.version) },
  {
    label: 'Method',
    value: (row) => (row.version.manifest.model.adapter ? 'Adapter' : 'Harness'),
  },
  {
    label: 'Harness',
    value: (row) => (
      <span className="font-mono text-small">{shortHash(row.version.manifest.harness.hash)}</span>
    ),
  },
  {
    label: 'Adapter',
    value: (row) => {
      const adapter = row.version.manifest.model.adapter;
      return adapter ? (
        <span className="font-mono text-small">{shortHash(adapter.sha256)}</span>
      ) : (
        <span aria-label="None">–</span>
      );
    },
  },
  {
    label: 'Check tasks',
    value: (row) => {
      const check = scoresOf(row).check;
      return check ? (
        <span className="tabular-nums">
          {formatPercent(check)}{' '}
          <span className="font-mono text-small">
            {check.pass}/{check.total}
          </span>
        </span>
      ) : (
        <span aria-label="None">–</span>
      );
    },
  },
  { label: 'Status', value: (row) => STATUS_WORDS[statusOf(row.version)] },
  { label: 'Created', value: (row) => shortDate(row.version.createdAt) },
];

/** What each version is: its model, how it was made, its harness and weights, and its standing. */
function Versions({ pair }: { pair: readonly [ModelRow, ModelRow] }) {
  return (
    <Card title="Versions" flush>
      <table aria-label="Versions" className="w-full table-fixed border-collapse text-ui">
        <thead>
          <tr>
            <th className="w-[24%]" />
            {pair.map((row) => (
              <th key={row.key} scope="col" className="pb-3 pl-6 text-left font-medium">
                {nameOf(row)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {FACTS.map((fact) => (
            <tr key={fact.label} className="border-t border-line">
              <th scope="row" className="py-3 pl-6 text-left font-normal">
                {fact.label}
              </th>
              {pair.map((row) => (
                <td key={row.key} className="py-3 pl-6">
                  {fact.value(row)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </Card>
  );
}

function Delta({
  cell,
  label,
  strong,
}: {
  cell: DeltaCell | null;
  label: string;
  strong?: boolean;
}) {
  if (cell === null) {
    return <span aria-label={`${label}, not measured on the same tasks`}>–</span>;
  }
  const { before, after, points } = cell;
  return (
    <span
      aria-label={`${label}, ${before.pass} of ${before.total} then ${after.pass} of ${after.total}, ${formatPoints(points)} points`}
      className="flex flex-col"
    >
      <span
        className={cn(
          'font-display text-body font-semibold tabular-nums',
          points === 0 && 'font-normal',
          points > 0 && 'text-student',
          points < 0 && 'text-danger',
          strong && 'text-h2',
        )}
      >
        {formatPoints(points)}
        <span className="font-sans text-small font-normal">
          {Math.abs(points) === 1 ? ' point' : ' points'}
        </span>
      </span>
      <span className="font-mono text-small tabular-nums">
        {before.pass}/{before.total} → {after.pass}/{after.total}
      </span>
    </span>
  );
}

/** The first column of each group after the first, which a hairline sets apart. */
function opensGroup(scores: ScoreComparison, index: number): boolean {
  let start = 0;
  for (const group of scores.groups) {
    if (index === start) return start > 0;
    start += group.columns.length;
  }
  return false;
}

function FinalTest({ before, after }: { before: ModelRow; after: ModelRow }) {
  const comparison = compareScores(before, after);
  return (
    <Card title="Final test" flush>
      {comparison.kind === 'apart' ? (
        <p className="m-0 px-6 pb-6 text-ui">{comparison.reason}</p>
      ) : (
        <DeltaGrid scores={comparison.scores} />
      )}
    </Card>
  );
}

function DeltaGrid({ scores }: { scores: ScoreComparison }) {
  const columns = scores.groups.flatMap((group) => group.columns);
  const edge = (index: number) => (opensGroup(scores, index) ? 'border-l border-line' : '');
  return (
    <div className="overflow-x-auto">
      <table
        aria-label="Final test by skill and organization"
        className="w-full min-w-[640px] table-fixed border-collapse text-ui"
      >
        <thead>
          <tr>
            <th className="w-[24%]" />
            {scores.groups.map((group, index) => (
              <th
                key={group.group}
                scope="colgroup"
                colSpan={group.columns.length}
                className={cn(
                  'pb-2 pl-6 text-left text-small font-normal',
                  index > 0 && 'border-l border-line',
                )}
              >
                {group.label}
              </th>
            ))}
          </tr>
          <tr>
            <th className="pb-3" />
            {columns.map((column, index) => (
              <th
                key={column.org}
                scope="col"
                className={cn('pb-3 pl-6 text-left font-medium', edge(index))}
              >
                {column.name}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {scores.rows.map((row) => (
            <tr key={row.type} className="border-t border-line">
              <th scope="row" className="py-3 pl-6 pr-4 text-left font-normal">
                {row.label}
              </th>
              {row.cells.map((cell, index) => {
                const column = columns[index];
                return (
                  <td key={column?.org ?? index} className={cn('py-3 pl-6', edge(index))}>
                    <Delta cell={cell} label={`${row.label} at ${column?.name ?? ''}`} />
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr className="border-t border-line">
            <th scope="row" className="py-3 pl-6 pr-4 text-left font-medium">
              All skills
            </th>
            {scores.totals.map((cell, index) => {
              const column = columns[index];
              return (
                <td key={column?.org ?? index} className={cn('py-3 pl-6', edge(index))}>
                  <Delta cell={cell} label={`All skills at ${column?.name ?? ''}`} strong />
                </td>
              );
            })}
          </tr>
        </tfoot>
      </table>
    </div>
  );
}

function HarnessChanges({ before, after }: { before: ModelRow; after: ModelRow }) {
  const same = before.version.manifest.harness.hash === after.version.manifest.harness.hash;
  return (
    <Card title="Harness" flush>
      <div className="px-6 pb-6">
        {same ? (
          <p className="m-0 text-ui">The same harness</p>
        ) : (
          <HarnessDiff before={before} after={after} />
        )}
      </div>
    </Card>
  );
}

function HarnessDiff({ before, after }: { before: ModelRow; after: ModelRow }) {
  const from = { graduateId: before.agent.id, version: before.version.version };
  const to = { graduateId: after.agent.id, version: after.version.version };
  const diff = useQuery(`harness-diff:${before.key}:${after.key}`, () =>
    graduatesApi.harnessDiff(from, to),
  );
  if (diff.status === 'loading') return <Skeleton className="h-28 w-full" />;
  if (diff.status === 'error') {
    return (
      <ProblemState
        layout="inline"
        error={diff.error}
        title="Couldn't compare the harnesses"
        onRetry={diff.reload}
      />
    );
  }
  if (diff.data.length === 0) return <p className="m-0 text-ui">The same harness</p>;
  return (
    <div className="flex flex-col gap-4">
      <p className="m-0 text-ui text-pretty">{sentence(`changed ${changeSummary(diff.data)}`)}</p>
      {diff.data.map((file) => (
        <FilePatch key={file.path} file={file} />
      ))}
    </div>
  );
}
