import { useEffect, useState, type ReactNode } from 'react';
import type {
  AddedQualification,
  Certification,
  Qualification,
  Score,
  VersionEvent,
} from '@architect/shared';
import {
  AgentAvatar,
  Button,
  cn,
  Disclosure,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  IconButton,
  Inspector,
  Skeleton,
  Tooltip,
  VersionTag,
} from '@architect/ui';
import {
  ArrowUpRight,
  BadgeCheck,
  Columns2,
  Cpu,
  FileText,
  FolderTree,
  GitBranch,
  MessageSquare,
  Package,
  Undo2,
  X,
} from 'lucide-react';
import { api } from '../api/client';
import { computeApi } from '../api/compute';
import { graduatesApi } from '../api/graduates';
import { useQuery } from '../api/query';
import { useImprovements } from '../api/teaching';
import { FilePatch } from '../components/FilePatch';
import { HarnessFiles } from '../components/HarnessFiles';
import { ProblemState } from '../components/ProblemState';
import { shortDate } from '../flow/format';
import { certificateFigure, certificateHint } from '../flow/report/certificate-words';
import { openAgent } from '../lab/open-agent';
import { changeSummary } from '../flow/train/diff';
import { sentence } from '../flow/train/evidence-words';
import { formatPercent, formatUsd } from '../lib/format';
import { shortModelName } from '../lib/names';
import { navigate, paths } from '../lib/router';
import { MoveDialog } from '../workspace/settings/MoveDialog';
import { useAgentSettingsUi } from '../workspace/settings/agentSettingsUi';
import { MOVE_WORDS, moveFor, type VersionMove } from '../workspace/settings/versions';
import { CertifyDialog, certificationsKey } from './CertifyDialog';
import {
  baseModelOf,
  CHECK_HINT,
  comparable,
  fieldOf,
  imported,
  rowKey,
  runtimeName,
  scoresOf,
  shortHash,
  statusOf,
  STATUS_WORDS,
  type ModelRow,
} from './registry';

type PanelTab = 'report' | 'lineage' | 'files';

const TABS = [
  { value: 'report', label: 'Report', icon: <FileText aria-hidden /> },
  { value: 'lineage', label: 'Lineage', icon: <GitBranch aria-hidden /> },
  { value: 'files', label: 'Files', icon: <FolderTree aria-hidden /> },
] as const;

/** A model's panel beside the registry: its report, where it came from, and what can be done. */
export function ModelPanel({
  row,
  rows,
  onClose,
  onOpen,
  onCompare,
  onMoved,
}: {
  row: ModelRow;
  rows: readonly ModelRow[];
  onClose: () => void;
  onOpen: (row: ModelRow) => void;
  onCompare: (other: ModelRow) => void;
  onMoved: () => void;
}) {
  useEffect(() => {
    // Escape closes the panel, unless a dialog or a menu above it takes the key first.
    const close = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented) return;
      if (document.querySelector('[role="dialog"], [role="menu"]')) return;
      onClose();
    };
    window.addEventListener('keydown', close);
    return () => window.removeEventListener('keydown', close);
  }, [onClose]);

  return (
    <div className="flex h-full shrink-0 flex-col">
      <div className="app-drag h-12 shrink-0" />
      <Inspector<PanelTab>
        aria-label="Model"
        tabs={TABS}
        rememberAs="models"
        className="min-h-0 flex-1"
        header={
          <PanelHeader
            row={row}
            rows={rows}
            onClose={onClose}
            onCompare={onCompare}
            onMoved={onMoved}
          />
        }
      >
        {(tab) =>
          tab === 'report' ? (
            <ReportTab row={row} />
          ) : tab === 'lineage' ? (
            <LineageTab row={row} rows={rows} onOpen={onOpen} />
          ) : (
            <FilesTab row={row} rows={rows} />
          )
        }
      </Inspector>
    </div>
  );
}

function PanelHeader({
  row,
  rows,
  onClose,
  onCompare,
  onMoved,
}: {
  row: ModelRow;
  rows: readonly ModelRow[];
  onClose: () => void;
  onCompare: (other: ModelRow) => void;
  onMoved: () => void;
}) {
  const { agent, version } = row;
  const active = rows.find((other) => other.agent.id === agent.id && other.version.active);
  const move = moveFor(version, active?.version.version ?? null);
  const [moving, setMoving] = useState<VersionMove | null>(null);
  const [certifying, setCertifying] = useState(false);
  const others = rows.filter((other) => comparable(row, other));

  return (
    <div className="flex flex-col gap-4 border-b border-line px-4 pb-4 pt-4">
      <div className="flex items-start gap-3">
        <AgentAvatar name={agent.name} size="md" />
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <h2 className="m-0 flex items-center gap-2 font-display text-h2 font-semibold">
            <span className="truncate">{agent.name}</span>
            <VersionTag version={version.version} active={version.active} />
            <span className="sr-only">version {version.version}</span>
          </h2>
          <span className="truncate text-small">
            {STATUS_WORDS[statusOf(version)]} · {fieldOf(version)}
          </span>
        </div>
        <OpenLinks row={row} />
        <Tooltip content="Close" side="left">
          <IconButton label="Close" size="md" onClick={onClose}>
            <X size={16} strokeWidth={1.8} aria-hidden />
          </IconButton>
        </Tooltip>
      </div>
      <div className="flex flex-wrap gap-2">
        {move !== null && active && (
          <Button size="sm" onClick={() => setMoving(move)}>
            {move === 'promote' ? (
              <ArrowUpRight size={14} strokeWidth={1.8} aria-hidden />
            ) : (
              <Undo2 size={14} strokeWidth={1.8} aria-hidden />
            )}
            {MOVE_WORDS[move].action}
          </Button>
        )}
        {others.length > 0 && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button size="sm">
                <Columns2 size={14} strokeWidth={1.8} aria-hidden />
                Compare
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start">
              {others.map((other) => (
                <DropdownMenuItem key={other.key} onSelect={() => onCompare(other)}>
                  {other.agent.name} v{other.version.version}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        )}
        {version.runId !== undefined && (
          <Button size="sm" onClick={() => setCertifying(true)}>
            <BadgeCheck size={14} strokeWidth={1.8} aria-hidden />
            Certify
          </Button>
        )}
        {version.active && (
          <Button size="sm" onClick={() => useAgentSettingsUi.getState().show(agent.id, 'export')}>
            <Package size={14} strokeWidth={1.8} aria-hidden />
            Export
          </Button>
        )}
        <Button
          size="sm"
          onClick={() =>
            navigate(
              paths.compute({
                jobId: version.manifest.contract.jobId,
                model: version.manifest.model.base.name,
              }),
            )
          }
        >
          <Cpu size={14} strokeWidth={1.8} aria-hidden />
          Plan cluster training
        </Button>
      </div>
      {certifying && <CertifyDialog row={row} onClose={() => setCertifying(false)} />}
      {moving && active && (
        <MoveDialog
          agent={agent}
          version={version}
          kind={moving}
          active={active.version}
          onClose={() => {
            setMoving(null);
            onMoved();
          }}
        />
      )}
    </div>
  );
}

/**
 * Where a version leads: the chat its agent answers in, for the version chats run on, and the
 * results of the run that made it here, a training run's or an improvement's.
 */
function OpenLinks({ row }: { row: ModelRow }) {
  const { agent, version } = row;
  const improvements = useImprovements(agent.id);
  const runId = imported(version) ? undefined : version.runId;
  const improved = improvements.data?.some((item) => item.runId === runId) === true;
  return (
    <>
      {version.active && (
        <Tooltip content="Open chat" side="bottom">
          <IconButton label="Open chat" size="md" onClick={() => openAgent(agent)}>
            <MessageSquare size={16} strokeWidth={1.8} aria-hidden />
          </IconButton>
        </Tooltip>
      )}
      {runId !== undefined && improvements.data && (
        <Tooltip content="Open results" side="bottom">
          <IconButton
            label="Open results"
            size="md"
            onClick={() => navigate(improved ? paths.improvement(runId) : paths.report(runId))}
          >
            <FileText size={16} strokeWidth={1.8} aria-hidden />
          </IconButton>
        </Tooltip>
      )}
    </>
  );
}

/** One fact of a panel: its name, and its value at the right. */
function Fact({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <div className="flex min-h-10 items-center justify-between gap-4 border-t border-line py-2 first:border-t-0">
      <dt className="text-ui">
        {hint ? (
          <Tooltip content={hint} side="left">
            <span tabIndex={0}>{label}</span>
          </Tooltip>
        ) : (
          label
        )}
      </dt>
      <dd className="m-0 min-w-0 text-right text-ui">{children}</dd>
    </div>
  );
}

function Figure({ label, score }: { label: string; score: Score | null }) {
  const measured = score !== null && score.total > 0;
  return (
    <div className="flex flex-col gap-1">
      <span className="text-small">{label}</span>
      <span className="font-display text-h1 font-semibold tabular-nums">
        {measured ? formatPercent(score) : <span aria-label="not tested">–</span>}
      </span>
      <span className="font-mono text-small tabular-nums">
        {measured ? `${score.pass}/${score.total}` : ' '}
      </span>
    </div>
  );
}

function Heading({ children }: { children: ReactNode }) {
  return <h3 className="m-0 font-display text-body font-semibold">{children}</h3>;
}

function ReportTab({ row }: { row: ModelRow }) {
  const { report, reportError, version } = row;
  const scores = scoresOf(row);
  const { model, harness } = version.manifest;
  return (
    <div className="flex flex-col gap-7">
      <section aria-label="Final test" className="flex flex-col gap-3">
        <Heading>Final test</Heading>
        {reportError ? (
          <ProblemState layout="inline" error={reportError} title="Couldn't read its report card" />
        ) : scores.seen === null && scores.unseen === null && scores.real === null ? (
          <p className="m-0 text-ui">No final test yet</p>
        ) : (
          <div className="grid grid-cols-3 gap-3">
            <Figure label="Taught on" score={scores.seen} />
            <Figure label="Never seen" score={scores.unseen} />
            <Figure label="Real" score={scores.real} />
          </div>
        )}
      </section>
      <Qualified row={row} />
      <dl className="m-0 flex flex-col">
        <Fact label="Check tasks" hint={CHECK_HINT}>
          {scores.check ? (
            <span className="tabular-nums">
              {formatPercent(scores.check)}{' '}
              <span className="font-mono text-small">
                {scores.check.pass}/{scores.check.total}
              </span>
            </span>
          ) : (
            <Absent />
          )}
        </Fact>
        <Fact label="Base model">{baseModelOf(version)}</Fact>
        <Fact label="Runs on">{runtimeName(model.runtime.compatible[0])}</Fact>
        <Fact label="Harness">
          <span className="font-mono text-small">{shortHash(harness.hash)}</span>
        </Fact>
        <Fact label="Adapter">
          {model.adapter ? (
            <span className="font-mono text-small">{shortHash(model.adapter.sha256)}</span>
          ) : (
            <Absent />
          )}
        </Fact>
        {report && (
          <>
            <Fact label="Tested">
              {report.testedOn === 'hosted' ? 'Online copy' : 'This computer'}
            </Fact>
            <Fact label="Taught by">{shortModelName(report.mentor.label)}</Fact>
            <Fact label="Rounds">
              <span className="tabular-nums">{report.cost.rounds}</span>
            </Fact>
            <Fact label={`${shortModelName(report.mentor.label)} spend`}>
              <span className="tabular-nums">{formatUsd(report.cost.mentorUsd)}</span>
            </Fact>
          </>
        )}
        <Fact label="Created">{shortDate(version.createdAt)}</Fact>
      </dl>
    </div>
  );
}

/** "83% · 30 of 36". */
const scoreText = (score: Score) => `${formatPercent(score)} · ${score.pass} of ${score.total}`;

const STATE_WORDS = {
  testing: 'Testing',
  certifying: 'Certifying',
  paused: 'Paused',
  finished: 'Finished',
} as const;

interface Result {
  key: string;
  label: string;
  detail: string | null;
  value: string;
  hint?: string;
}

function certificationResult(item: Certification): Result | null {
  if (item.status === 'planned') return null;
  const figure = certificateFigure(item.certificate);
  return {
    key: `certification:${item.id}`,
    label: 'Certified',
    detail: shortDate(item.endedAt ?? item.createdAt),
    value:
      item.status === 'finished'
        ? (figure ?? 'Not certified')
        : `${STATE_WORDS[item.status]}, ${item.done} of ${item.plan.attempts}`,
    ...(item.certificate ? { hint: certificateHint(item.certificate) } : {}),
  };
}

function addedResult(item: AddedQualification): Result {
  return {
    key: `added:${item.org}`,
    label: `At ${item.org}`,
    detail: shortDate(item.endedAt ?? item.startedAt),
    value:
      item.status === 'finished' && item.score ? scoreText(item.score) : STATE_WORDS[item.status],
  };
}

function trainedResult(item: Qualification): Result {
  return {
    key: `trained:${item.id}`,
    label: item.model,
    detail: ['Trained elsewhere', shortDate(item.endedAt ?? item.startedAt)]
      .filter(Boolean)
      .join(', '),
    value:
      item.status === 'finished' && item.card
        ? scoreText(item.card.test.score)
        : STATE_WORDS[item.status],
  };
}

/**
 * Every result measured on this version after its own final test, wherever it was started:
 * its certifications (Models, Certify, or `architect certify`), its final test at an organization
 * added to the field later (Organizations, Qualify), and models trained elsewhere that took its
 * final test under its harness (Compute, Qualify a trained model).
 */
function Qualified({ row }: { row: ModelRow }) {
  const runId = imported(row.version) ? undefined : row.version.runId;
  return runId === undefined ? null : <QualifiedList row={row} runId={runId} />;
}

function QualifiedList({ row, runId }: { row: ModelRow; runId: string }) {
  const { agent, version } = row;
  const jobId = row.report?.jobId ?? version.manifest.contract.jobId;
  const certifications = useQuery(certificationsKey(row), () =>
    graduatesApi.certifications(agent.id, version.version),
  );
  const field = useQuery(`version-field:${jobId}`, () => api.field(jobId));
  const trained = useQuery(`qualifications:${jobId}`, () => computeApi.qualifications(jobId));
  const reads = [certifications, field, trained];
  const failed = reads.find((query) => query.status === 'error');
  const results = [
    ...(certifications.data ?? []).flatMap((item) => certificationResult(item) ?? []),
    ...(field.data?.qualifications ?? []).filter((item) => item.runId === runId).map(addedResult),
    ...(trained.data ?? []).filter((item) => item.runId === runId).map(trainedResult),
  ];
  return (
    <section aria-label="Qualified" className="flex flex-col gap-1">
      <Heading>Qualified</Heading>
      {failed?.error ? (
        <ProblemState
          layout="inline"
          error={failed.error}
          title="Couldn't read its qualifications"
          onRetry={failed.reload}
        />
      ) : reads.some((query) => query.status === 'loading') ? (
        <Skeleton className="h-10 w-full" />
      ) : results.length === 0 ? (
        <p className="m-0 py-2 text-ui">None yet</p>
      ) : (
        <ul className="m-0 flex list-none flex-col p-0">
          {results.map((result) => (
            <li
              key={result.key}
              className="flex min-h-10 items-center justify-between gap-4 border-t border-line py-2 text-ui first:border-t-0"
            >
              <span className="flex min-w-0 flex-col">
                <span className="truncate">{result.label}</span>
                {result.detail && <span className="text-small">{result.detail}</span>}
              </span>
              {result.hint ? (
                <Tooltip content={result.hint} side="left">
                  <span tabIndex={0} className="shrink-0 tabular-nums">
                    {result.value}
                  </span>
                </Tooltip>
              ) : (
                <span className="shrink-0 tabular-nums">{result.value}</span>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function Absent() {
  return (
    <>
      <span aria-hidden>–</span>
      <span className="sr-only">None</span>
    </>
  );
}

const EVENT_WORDS: Record<VersionEvent['kind'], string> = {
  created: 'Made',
  accepted: 'Accepted',
  rejected: 'Set aside',
  promoted: 'Made active',
  rolled_back: 'Gone back to',
};

function LineageTab({
  row,
  rows,
  onOpen,
}: {
  row: ModelRow;
  rows: readonly ModelRow[];
  onOpen: (row: ModelRow) => void;
}) {
  const { version, report } = row;
  const parent = parentOf(row, rows);
  const changes = report?.topInterventions ?? [];
  return (
    <div className="flex flex-col gap-7">
      <section aria-label="Made from" className="flex flex-col gap-3">
        <Heading>Made from</Heading>
        {parent ? (
          <button
            type="button"
            onClick={() => onOpen(parent)}
            className="-mx-2 flex items-center gap-2.5 rounded-control px-2 py-1.5 text-left text-ui transition-colors duration-150 hover:bg-hover"
          >
            <VersionTag version={parent.version.version} active={parent.version.active} />
            <span className="min-w-0 flex-1 truncate">Version {parent.version.version}</span>
            <span className="text-small">{STATUS_WORDS[statusOf(parent.version)]}</span>
          </button>
        ) : version.origin ? (
          <p className="m-0 text-ui">
            Version {version.origin.version} of{' '}
            <span className="font-mono text-small">{version.origin.agentId}</span>, on another
            computer
          </p>
        ) : (
          <p className="m-0 text-ui">Its first version</p>
        )}
      </section>
      {parent && <ChangedFrom row={row} parent={parent} />}
      {changes.length > 0 && (
        <section aria-label="Kept changes" className="flex flex-col gap-1">
          <Heading>Kept changes</Heading>
          <ul className="m-0 flex list-none flex-col p-0">
            {changes.map((change) => (
              <li
                key={change.round}
                className="flex items-baseline gap-3 border-t border-line py-2.5 text-ui first:border-t-0"
              >
                <span className="w-16 shrink-0 text-small">Round {change.round}</span>
                <span className="min-w-0 flex-1 text-pretty">{change.title}</span>
                <span
                  className={cn(
                    'font-mono text-small tabular-nums',
                    change.delta > 0 && 'text-student',
                  )}
                >
                  {change.delta > 0 ? `+${change.delta}` : change.delta}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}
      <History row={row} />
    </div>
  );
}

const parentOf = (row: ModelRow, rows: readonly ModelRow[]): ModelRow | undefined =>
  row.version.parent === undefined
    ? undefined
    : rows.find((other) => other.key === rowKey(row.agent.id, row.version.parent ?? 0));

/** The version's harness as its folder holds it, and what changed from its parent. */
function FilesTab({ row, rows }: { row: ModelRow; rows: readonly ModelRow[] }) {
  const parent = parentOf(row, rows);
  return (
    <HarnessFiles
      queryKey={`harness-files:${row.key}`}
      load={() => graduatesApi.harnessFiles(row.agent.id, row.version.version)}
      {...(parent ? { changes: <ParentChanges row={row} parent={parent} /> } : {})}
    />
  );
}

function ParentChanges({ row, parent }: { row: ModelRow; parent: ModelRow }) {
  const diff = useHarnessDiff(row, parent);
  if (diff.status === 'loading') return <Skeleton className="h-10 w-full" />;
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
  if (diff.data.length === 0) {
    return (
      <p className="m-0 text-ui">Nothing in its harness changed from v{parent.version.version}</p>
    );
  }
  return (
    <div className="flex flex-col gap-3">
      {diff.data.map((file) => (
        <FilePatch key={file.path} file={file} />
      ))}
    </div>
  );
}

function useHarnessDiff(row: ModelRow, parent: ModelRow) {
  const from = { graduateId: parent.agent.id, version: parent.version.version };
  const to = { graduateId: row.agent.id, version: row.version.version };
  return useQuery(`harness-diff:${parent.key}:${row.key}`, () =>
    graduatesApi.harnessDiff(from, to),
  );
}

/** What changed in the harness from the version it was made from. */
function ChangedFrom({ row, parent }: { row: ModelRow; parent: ModelRow }) {
  const diff = useHarnessDiff(row, parent);
  return (
    <section aria-label="What changed" className="flex flex-col gap-3">
      <Heading>What changed</Heading>
      {diff.status === 'loading' ? (
        <Skeleton className="h-10 w-full" />
      ) : diff.status === 'error' ? (
        <ProblemState
          layout="inline"
          error={diff.error}
          title="Couldn't compare the harnesses"
          onRetry={diff.reload}
        />
      ) : diff.data.length === 0 ? (
        <p className="m-0 text-ui">
          {row.version.manifest.model.adapter?.sha256 !==
          parent.version.manifest.model.adapter?.sha256
            ? 'The same harness, with new trained weights'
            : 'Nothing in its harness'}
        </p>
      ) : (
        <>
          <p className="m-0 text-ui text-pretty">
            {sentence(`changed ${changeSummary(diff.data)}`)}
          </p>
          <Disclosure label="Every line">
            <div className="flex flex-col gap-3">
              {diff.data.map((file) => (
                <FilePatch key={file.path} file={file} />
              ))}
            </div>
          </Disclosure>
        </>
      )}
    </section>
  );
}

function History({ row }: { row: ModelRow }) {
  const history = useQuery(`version-history:${row.agent.id}`, () =>
    graduatesApi.history(row.agent.id),
  );
  const events = history.data?.filter((event) => event.version === row.version.version) ?? [];
  return (
    <section aria-label="History" className="flex flex-col gap-1">
      <Heading>History</Heading>
      {history.status === 'error' ? (
        <ProblemState
          layout="inline"
          error={history.error}
          title="Couldn't read its history"
          onRetry={history.reload}
        />
      ) : !history.data ? (
        <Skeleton className="h-10 w-full" />
      ) : (
        <ol className="m-0 flex list-none flex-col p-0">
          <li className="flex items-baseline justify-between gap-3 py-2.5 text-ui">
            <span>Made</span>
            <span className="text-small">{shortDate(row.version.createdAt)}</span>
          </li>
          {events
            .filter((event) => event.kind !== 'created')
            .map((event) => (
              <li
                key={`${event.kind}:${event.at}`}
                className="flex items-baseline justify-between gap-3 border-t border-line py-2.5 text-ui"
              >
                <span>
                  {EVENT_WORDS[event.kind]}
                  {event.from !== undefined && `, after v${event.from}`}
                </span>
                <span className="text-small">{shortDate(event.at)}</span>
              </li>
            ))}
        </ol>
      )}
    </section>
  );
}
