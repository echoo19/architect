import type { ReactNode } from 'react';
import type { Score } from '@architect/shared';
import {
  AgentAvatar,
  DataTable,
  defineTerm,
  Tooltip,
  useWindowBelow,
  type DataColumn,
} from '@architect/ui';
import { CircleAlert } from 'lucide-react';
import { SCORE_HINTS } from '../fields/parts';
import { shortDate } from '../flow/format';
import { certificateFigure, certificateHint } from '../flow/report/certificate-words';
import { formatPercent } from '../lib/format';
import {
  agentSortKey,
  baseModelOf,
  CHECK_HINT,
  methodOf,
  runtimeName,
  scoresOf,
  shortHash,
  sortScore,
  statusOf,
  STATUS_HINTS,
  STATUS_WORDS,
  type ModelRow,
  type ModelStatus,
  type RowScores,
} from './registry';

const FINAL_TEST = 'Sealed final test';

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
      <Tooltip content="Its report card couldn't be read" side="bottom">
        <span className="inline-flex text-danger">
          <CircleAlert size={15} strokeWidth={1.8} aria-label="Report unreadable" />
        </span>
      </Tooltip>
    ) : (
      scoreCell(scoresOf(row)[key])
    ),
});

/**
 * A version's status in its word, with what the word means on hover or focus, below it, so it
 * covers neither the name nor the header the word is read with.
 */
export function StatusWord({ status }: { status: ModelStatus }) {
  return (
    <Tooltip content={STATUS_HINTS[status]} side="bottom">
      <span tabIndex={0} className="rounded-mark">
        {STATUS_WORDS[status]}
      </span>
    </Tooltip>
  );
}

const NAME: DataColumn<ModelRow> = {
  key: 'name',
  header: 'Agent',
  sortValue: agentSortKey,
  cell: (row) => (
    <span className="flex items-center gap-3 whitespace-nowrap">
      <AgentAvatar name={row.agent.name} />
      <span className="flex items-center gap-2">
        {row.agent.name}
        <span aria-hidden className="font-mono text-small font-normal">
          v{row.version.version}
        </span>
        <span className="sr-only">version {row.version.version}</span>
      </span>
    </span>
  ),
};

const STATUS: DataColumn<ModelRow> = {
  key: 'status',
  header: 'Status',
  sortValue: (row) => STATUS_WORDS[statusOf(row.version)],
  cell: (row) => <StatusWord status={statusOf(row.version)} />,
};

const SCORES = [
  scoreColumn('seen', 'Taught on', FINAL_TEST, SCORE_HINTS.seen),
  scoreColumn('unseen', 'Never seen', FINAL_TEST, SCORE_HINTS.unseen),
  scoreColumn('real', 'Real', FINAL_TEST, SCORE_HINTS.real),
  scoreColumn('check', 'Held-out checks', undefined, CHECK_HINT),
];

/**
 * The certified bound on its error when it answers (decision 077), lower first; absent for a
 * version without a certificate.
 */
const CERTIFIED: DataColumn<ModelRow> = {
  key: 'certified',
  header: 'Risk bound',
  align: 'end',
  hint: defineTerm('riskCertificate'),
  sortValue: (row) =>
    row.report?.certificate?.issued === true ? row.report.certificate.threshold.bound : null,
  cell: (row) => {
    const certificate = row.report?.certificate;
    const figure = certificateFigure(certificate);
    return certificate === undefined || figure === null ? null : (
      <Tooltip content={certificateHint(certificate)} side="bottom">
        <span tabIndex={0} className="tabular-nums" aria-label={certificateHint(certificate)}>
          {figure}
        </span>
      </Tooltip>
    );
  },
};

const BASE: DataColumn<ModelRow> = {
  key: 'base',
  header: 'Base model',
  sortValue: (row) => baseModelOf(row.version),
  // What it runs on shows on hover and in the panel; a cell's tip opens below, clear of the header.
  cell: (row) => (
    <Tooltip
      content={`Runs on ${runtimeName(row.version.manifest.model.runtime.compatible[0])}`}
      side="bottom"
    >
      <span tabIndex={0} className="whitespace-nowrap">
        {baseModelOf(row.version)}
      </span>
    </Tooltip>
  ),
};

const METHOD: DataColumn<ModelRow> = {
  key: 'method',
  header: 'Method',
  hint: `Harness: ${defineTerm('harness').toLowerCase()} LoRA: ${defineTerm('loraAdapter').toLowerCase()}`,
  sortValue: (row) => methodOf(row.version),
  cell: (row) => {
    // The hashes tell versions apart; they show on hover and in the panel.
    const { model, harness } = row.version.manifest;
    const method = methodOf(row.version);
    const hashes = model.adapter
      ? `adapter ${shortHash(model.adapter.sha256)}, harness ${shortHash(harness.hash)}`
      : `harness ${shortHash(harness.hash)}`;
    return (
      <Tooltip content={<span className="font-mono">{hashes}</span>} side="bottom">
        <span tabIndex={0}>{method}</span>
      </Tooltip>
    );
  },
};

const CREATED: DataColumn<ModelRow> = {
  key: 'created',
  header: 'Created',
  align: 'end',
  sortValue: (row) => row.version.createdAt,
  cell: (row) => (
    <span className="whitespace-nowrap">{shortDate(row.version.createdAt) ?? undefined}</span>
  ),
};

const COLUMNS: DataColumn<ModelRow>[] = [NAME, BASE, METHOD, ...SCORES, STATUS, CREATED];

/** The columns, with Certified beside the scores once any version has a certificate. */
function withCertificates(rows: readonly ModelRow[]): DataColumn<ModelRow>[] {
  if (!rows.some((row) => row.report?.certificate !== undefined)) return COLUMNS;
  const status = COLUMNS.indexOf(STATUS);
  return [...COLUMNS.slice(0, status), CERTIFIED, ...COLUMNS.slice(status)];
}

/**
 * Beside an open panel, which shows the rest, or on a narrow window: the agent, its final test and
 * its status. The check tasks lead the panel, so the table leaves them out and its Status column
 * stays in view. The others are hidden rather than dropped, so the table keeps the order it was
 * sorted in.
 */
const NARROW: ReadonlySet<DataColumn<ModelRow>> = new Set([NAME, ...SCORES.slice(0, 3), STATUS]);

/** On a mid-width window, what the panel also shows makes room for the scores and status. */
const MIDDLE: ReadonlySet<DataColumn<ModelRow>> = new Set([BASE, METHOD, CREATED]);

const shownOnly = (
  columns: DataColumn<ModelRow>[],
  keep: (column: DataColumn<ModelRow>) => boolean,
) => columns.map((column) => (keep(column) ? column : { ...column, hidden: true }));

/** Every agent and version: what it runs on, how it was made, and how its final test went. */
export function RegistryTable({
  rows,
  openKey,
  beside,
  onOpen,
  empty,
}: {
  rows: readonly ModelRow[];
  openKey: string | null;
  /** The open version's panel sits beside the table, taking its room. */
  beside: boolean;
  onOpen: (row: ModelRow) => void;
  empty: string;
}) {
  const narrow = useWindowBelow(1280);
  const middle = useWindowBelow(1440);
  const columns = withCertificates(rows);
  return (
    <DataTable
      aria-label="Models"
      rows={rows}
      rowKey={(row) => row.key}
      columns={
        beside || narrow
          ? shownOnly(columns, (column) => NARROW.has(column))
          : middle
            ? shownOnly(columns, (column) => !MIDDLE.has(column))
            : columns
      }
      onRowClick={onOpen}
      initialSort={{ key: 'name', direction: 'ascending' }}
      empty={empty}
      {...(openKey === null ? {} : { selectedKey: openKey })}
    />
  );
}
