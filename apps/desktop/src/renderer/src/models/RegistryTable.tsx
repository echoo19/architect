import type { ReactNode } from 'react';
import type { Score } from '@architect/shared';
import { AgentAvatar, DataTable, Tooltip, type DataColumn } from '@architect/ui';
import { CircleAlert } from 'lucide-react';
import { shortDate } from '../flow/format';
import { formatPercent } from '../lib/format';
import {
  baseModelOf,
  CHECK_HINT,
  fieldOf,
  runtimeName,
  scoresOf,
  shortHash,
  sortScore,
  statusOf,
  STATUS_WORDS,
  type ModelRow,
  type RowScores,
} from './registry';

const FINAL_TEST = 'Final test';

/** A score as its share passed; null, which the table shows as absent, when it wasn't measured. */
function scoreCell(score: Score | null): ReactNode {
  return score === null || score.total === 0 ? null : (
    <span aria-label={`${formatPercent(score)}, ${score.pass} of ${score.total}`}>
      {formatPercent(score)}
    </span>
  );
}

const scoreColumn = (
  key: keyof RowScores,
  header: string,
  group?: string,
  hint?: string,
): DataColumn<ModelRow> => ({
  key,
  header,
  align: 'end',
  ...(group === undefined ? {} : { group }),
  ...(hint === undefined ? {} : { hint }),
  sortValue: (row) => sortScore(scoresOf(row)[key]),
  cell: (row) =>
    key === 'seen' && row.reportError ? (
      <Tooltip content="Its report card couldn't be read" side="top">
        <span className="inline-flex text-danger">
          <CircleAlert size={15} strokeWidth={1.8} aria-label="Report unreadable" />
        </span>
      </Tooltip>
    ) : (
      scoreCell(scoresOf(row)[key])
    ),
});

/** A cell of two lines: the value, and a small line under it. */
function TwoLines({ top, under }: { top: ReactNode; under: ReactNode }) {
  return (
    <span className="flex flex-col whitespace-nowrap leading-5">
      {top}
      <span className="text-small">{under}</span>
    </span>
  );
}

const NAME: DataColumn<ModelRow> = {
  key: 'name',
  header: 'Agent',
  sortValue: (row) => `${row.agent.name}\u0000${String(row.version.version).padStart(5, '0')}`,
  cell: (row) => (
    <span className="flex items-center gap-3 whitespace-nowrap">
      <AgentAvatar name={row.agent.name} />
      <TwoLines
        top={
          <span className="flex items-center gap-2">
            {row.agent.name}
            <span aria-hidden className="font-mono text-small font-normal">
              v{row.version.version}
            </span>
            <span className="sr-only">version {row.version.version}</span>
          </span>
        }
        under={<span className="font-normal">{fieldOf(row.version)}</span>}
      />
    </span>
  ),
};

const STATUS: DataColumn<ModelRow> = {
  key: 'status',
  header: 'Status',
  sortValue: (row) => STATUS_WORDS[statusOf(row.version)],
  cell: (row) => STATUS_WORDS[statusOf(row.version)],
};

const SCORES = [
  scoreColumn('seen', 'Taught on', FINAL_TEST, 'Organizations it was taught on'),
  scoreColumn('unseen', 'Never seen', FINAL_TEST, 'Generated organizations it never saw'),
  scoreColumn('real', 'Real', FINAL_TEST, 'Real organizations it never saw'),
  scoreColumn('check', 'Check tasks', undefined, CHECK_HINT),
];

const COLUMNS: DataColumn<ModelRow>[] = [
  NAME,
  {
    key: 'base',
    header: 'Base model',
    sortValue: (row) => baseModelOf(row.version),
    cell: (row) => (
      <TwoLines
        top={baseModelOf(row.version)}
        under={runtimeName(row.version.manifest.model.runtime.compatible[0])}
      />
    ),
  },
  {
    key: 'method',
    header: 'Method',
    sortValue: (row) => (row.version.manifest.model.adapter ? 1 : 0),
    cell: (row) => {
      // The hashes tell versions apart; they show on hover and in the panel.
      const { model, harness } = row.version.manifest;
      const method = model.adapter ? 'Adapter' : 'Harness';
      const hashes = model.adapter
        ? `adapter ${shortHash(model.adapter.sha256)}, harness ${shortHash(harness.hash)}`
        : `harness ${shortHash(harness.hash)}`;
      return (
        <Tooltip content={<span className="font-mono">{hashes}</span>} side="top">
          <span tabIndex={0}>{method}</span>
        </Tooltip>
      );
    },
  },
  ...SCORES,
  STATUS,
  {
    key: 'created',
    header: 'Created',
    align: 'end',
    sortValue: (row) => row.version.createdAt,
    cell: (row) => (
      <span className="whitespace-nowrap">{shortDate(row.version.createdAt) ?? undefined}</span>
    ),
  },
];

/** Beside an open panel, which shows the rest: the agent, its scores and its status. */
const NARROW: DataColumn<ModelRow>[] = [NAME, ...SCORES, STATUS];

/** Every agent and version: what it runs on, how it was made, and how its final test went. */
export function RegistryTable({
  rows,
  openKey,
  onOpen,
  empty,
}: {
  rows: readonly ModelRow[];
  openKey: string | null;
  onOpen: (row: ModelRow) => void;
  empty: string;
}) {
  return (
    <DataTable
      aria-label="Models"
      rows={rows}
      rowKey={(row) => row.key}
      columns={openKey === null ? COLUMNS : NARROW}
      onRowClick={onOpen}
      initialSort={{ key: 'name', direction: 'ascending' }}
      empty={empty}
      {...(openKey === null ? {} : { selectedKey: openKey })}
    />
  );
}
