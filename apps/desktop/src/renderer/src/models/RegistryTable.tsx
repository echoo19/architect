import type { ReactNode } from 'react';
import type { Score } from '@architect/shared';
import { AgentAvatar, DataTable, defineTerm, Tooltip, type DataColumn } from '@architect/ui';
import { CircleAlert } from 'lucide-react';
import { SCORE_HINTS } from '../fields/parts';
import { shortDate } from '../flow/format';
import { certificateFigure, certificateHint } from '../flow/report/certificate-words';
import { formatPercent } from '../lib/format';
import {
  baseModelOf,
  CHECK_HINT,
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
      <Tooltip content="Its report card couldn't be read" side="top">
        <span className="inline-flex text-danger">
          <CircleAlert size={15} strokeWidth={1.8} aria-label="Report unreadable" />
        </span>
      </Tooltip>
    ) : (
      scoreCell(scoresOf(row)[key])
    ),
});

/** A version's status in its word, with what the word means on hover or focus. */
export function StatusWord({ status }: { status: ModelStatus }) {
  return (
    <Tooltip content={STATUS_HINTS[status]} side="top">
      <span tabIndex={0} className="rounded-mark">
        {STATUS_WORDS[status]}
      </span>
    </Tooltip>
  );
}

const NAME: DataColumn<ModelRow> = {
  key: 'name',
  header: 'Agent',
  sortValue: (row) => `${row.agent.name}\u0000${String(row.version.version).padStart(5, '0')}`,
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
      <Tooltip content={certificateHint(certificate)} side="top">
        <span tabIndex={0} className="tabular-nums" aria-label={certificateHint(certificate)}>
          {figure}
        </span>
      </Tooltip>
    );
  },
};

const COLUMNS: DataColumn<ModelRow>[] = [
  NAME,
  {
    key: 'base',
    header: 'Base model',
    sortValue: (row) => baseModelOf(row.version),
    // What it runs on shows on hover and in the panel.
    cell: (row) => (
      <Tooltip
        content={`Runs on ${runtimeName(row.version.manifest.model.runtime.compatible[0])}`}
        side="top"
      >
        <span tabIndex={0} className="whitespace-nowrap">
          {baseModelOf(row.version)}
        </span>
      </Tooltip>
    ),
  },
  {
    key: 'method',
    header: 'Method',
    hint: `Harness: ${defineTerm('harness').toLowerCase()} LoRA: ${defineTerm('loraAdapter').toLowerCase()}`,
    sortValue: (row) => (row.version.manifest.model.adapter ? 1 : 0),
    cell: (row) => {
      // The hashes tell versions apart; they show on hover and in the panel.
      const { model, harness } = row.version.manifest;
      const method = model.adapter ? 'LoRA' : 'Harness';
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

/** The columns, with Certified beside the scores once any version has a certificate. */
function withCertificates(rows: readonly ModelRow[]): DataColumn<ModelRow>[] {
  if (!rows.some((row) => row.report?.certificate !== undefined)) return COLUMNS;
  const status = COLUMNS.indexOf(STATUS);
  return [...COLUMNS.slice(0, status), CERTIFIED, ...COLUMNS.slice(status)];
}

/**
 * Beside an open panel, which shows the rest: the agent, its final test and its status. The check
 * tasks lead the panel, so the table leaves them out and its Status column stays in view.
 */
const NARROW: DataColumn<ModelRow>[] = [NAME, ...SCORES.slice(0, 3), STATUS];

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
      columns={openKey === null ? withCertificates(rows) : NARROW}
      onRowClick={onOpen}
      initialSort={{ key: 'name', direction: 'ascending' }}
      empty={empty}
      {...(openKey === null ? {} : { selectedKey: openKey })}
    />
  );
}
