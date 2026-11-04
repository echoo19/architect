import { useState } from 'react';
import type { WspExperiment, WspIteration, WspMeasurement } from '@architect/shared';
import {
  Badge,
  Button,
  CapMeter,
  Card,
  DataTable,
  Drawer,
  ErrorState,
  ProgressStepper,
  Spinner,
} from '@architect/ui';
import { FolderOutput, Lightbulb, Play, ShieldCheck, Square } from 'lucide-react';
import { flowApi } from '../api/client';
import { keepExperiment, wspApi } from '../api/wsp';
import { formatCost } from '../flow/format';
import { attempt, toastWritten } from '../lib/notify';
import { navigate, paths } from '../lib/router';
import { PlacePage } from '../shell/PlacePage';
import {
  ARM_WORDS,
  devChange,
  latest,
  mentorName,
  metricOf,
  minutesText,
  OUTCOME_WORDS,
  pointsText,
  STAGE_WORDS,
  STAGES,
  stageStates,
  STATUS_WORDS,
} from './model';
import { ProgramDrawer } from './ProgramDrawer';
import { CaveatCards, ResultCard } from './Results';
import { StandInNote } from './StandInNote';

const ARMS: readonly WspMeasurement['arm'][] = ['base', 'decoding', 'instructions', 'candidate'];

/** States in which the run is under way and its activity is worth a spinner. */
const WORKING = new Set<WspExperiment['status']>(['running', 'cancelling', 'qualifying']);

/** "8 of 13", "62%": a count and its share, or nothing when it wasn't counted. */
function Rate({ part, whole }: { part: number | null; whole: number }) {
  if (part === null || whole === 0) return null;
  return (
    <span className="whitespace-nowrap">
      <span className="font-medium">{Math.round((part / whole) * 100)}%</span>{' '}
      <span className="text-small">
        {part} of {whole}
      </span>
    </span>
  );
}

/** Each arm's newest measurement on a split, in counts: never a figure that wasn't measured. */
function MeasurementTable({
  experiment,
  split,
}: {
  experiment: WspExperiment;
  split: 'dev' | 'qualification';
}) {
  const rows = ARMS.map((arm) => latest(experiment.measurements, arm, split)).filter(
    (row): row is WspMeasurement => row !== null,
  );
  if (rows.length === 0) return null;
  return (
    <DataTable
      aria-label={split === 'dev' ? 'Measured on dev' : 'Measured on qualification'}
      rows={rows}
      rowKey={(row) => row.arm}
      columns={[
        {
          key: 'arm',
          header: 'Arm',
          cell: (row) => (
            <span className="flex flex-col">
              <span className="font-medium">{ARM_WORDS[row.arm]}</span>
              {row.candidateId && <span className="font-mono text-small">{row.candidateId}</span>}
            </span>
          ),
        },
        {
          key: 'pass',
          header: 'Pass rate',
          hint: 'Outputs the check passed, of those with a check',
          align: 'end',
          cell: (row) => <Rate part={row.passed} whole={row.checked} />,
        },
        {
          key: 'loop',
          header: 'Loop rate',
          hint: 'Outputs that repeat themselves',
          align: 'end',
          cell: (row) => <Rate part={row.looped} whole={row.n} />,
        },
        {
          key: 'cut',
          header: 'Cut off',
          hint: 'Outputs that ran to the token limit',
          align: 'end',
          cell: (row) => <Rate part={row.cutOff} whole={row.n} />,
        },
        {
          key: 'tokens',
          header: 'Mean tokens',
          align: 'end',
          cell: (row) => Math.round(row.meanTokens),
        },
      ]}
    />
  );
}

/** The programs the mentor wrote, in order; each opens its source, output and candidate. */
function Programs({ experiment }: { experiment: WspExperiment }) {
  const [open, setOpen] = useState<WspIteration | null>(null);
  const base = latest(experiment.measurements, 'base', 'dev');
  const metric = metricOf(experiment);
  if (experiment.iterations.length === 0) return null;
  return (
    <section aria-label="Programs" className="flex flex-col gap-3">
      <h2 className="m-0 font-display text-h2 font-semibold">Programs</h2>
      <DataTable
        aria-label="Programs"
        rows={experiment.iterations}
        rowKey={(row) => String(row.n)}
        onRowClick={setOpen}
        selectedKey={open ? String(open.n) : undefined}
        columns={[
          { key: 'n', header: '#', width: '56px', cell: (row) => row.n },
          {
            key: 'hypothesis',
            header: 'Hypothesis',
            cell: (row) => <span className="line-clamp-2 text-pretty">{row.hypothesis}</span>,
          },
          {
            key: 'outcome',
            header: 'Outcome',
            hint: 'Edit made a candidate; Read and Inspected only looked; the rest stopped',
            cell: (row) => (
              <span
                className={
                  row.outcome === 'error' || row.outcome === 'timeout' || row.outcome === 'refused'
                    ? 'whitespace-nowrap text-danger'
                    : 'whitespace-nowrap'
                }
              >
                {OUTCOME_WORDS[row.outcome]}
              </span>
            ),
          },
          {
            key: 'candidate',
            header: 'Candidate',
            cell: (row) =>
              row.candidateId ? (
                <span className="font-mono text-small">{row.candidateId.slice(0, 13)}</span>
              ) : null,
          },
          {
            key: 'decision',
            header: 'Decision',
            hint: 'A kept candidate is the one later programs build on',
            cell: (row) =>
              row.decision === undefined ? null : row.decision === 'kept' ? (
                <span className="text-student">Kept</span>
              ) : (
                'Discarded'
              ),
          },
          {
            key: 'dev',
            header: 'Dev change',
            hint: "The candidate against the base on dev, in the brief's metric",
            align: 'end',
            cell: (row) => {
              const change = devChange(row, base, metric);
              return change === null ? null : (
                <span className="whitespace-nowrap">{pointsText(change)}</span>
              );
            },
          },
        ]}
      />
      <Drawer open={open !== null} onOpenChange={(next) => !next && setOpen(null)}>
        {open && <ProgramDrawer experiment={experiment} iteration={open} />}
      </Drawer>
    </section>
  );
}

/** The hard caps as meters, with what the workers ran beside them. */
function Budget({ experiment }: { experiment: WspExperiment }) {
  const { costs, limits } = experiment;
  return (
    <Card title="Budget">
      <div className="grid grid-cols-1 gap-x-10 gap-y-5 sm:grid-cols-2">
        <CapMeter
          label="Programs"
          used={costs.programs}
          cap={limits.programs}
          format={(value) => String(value)}
        />
        <CapMeter
          label="Forward passes"
          used={costs.forwardPasses}
          cap={limits.forwardPasses}
          format={(value) => String(value)}
        />
        <CapMeter
          tone="mentor"
          label={mentorName(experiment.mentor)}
          used={costs.mentorUsd}
          cap={limits.mentorUsd}
          format={formatCost}
        />
        <CapMeter
          label="Wall time"
          used={costs.wallSeconds / 60}
          cap={limits.wallMinutes}
          format={minutesText}
        />
        <CapMeter
          label="Compute"
          used={costs.computeSeconds}
          format={(seconds) => `${Math.round(seconds).toLocaleString('en-US')} s`}
        />
      </div>
    </Card>
  );
}

function Hypothesis({ experiment }: { experiment: WspExperiment }) {
  return (
    <Card
      title={`${mentorName(experiment.mentor)}'s hypothesis`}
      icon={<Lightbulb aria-hidden className="text-mentor" />}
    >
      <p className="m-0 text-body text-pretty">
        {experiment.hypothesis || 'None yet: the first program is still to come.'}
      </p>
    </Card>
  );
}

/** Where the run stands among its stages, and what it is doing now. */
function Stages({ experiment }: { experiment: WspExperiment }) {
  const states = stageStates(experiment.stage, experiment.status);
  const current = states.indexOf('current');
  return (
    <div className="flex flex-col gap-3">
      <ProgressStepper
        aria-label="Stages"
        steps={STAGES.map((stage) => STAGE_WORDS[stage])}
        current={current === -1 ? STAGES.length : current}
        className="-ml-3.5"
      />
      {experiment.activity && (
        <p className="m-0 flex items-center gap-2.5 text-ui">
          {WORKING.has(experiment.status) && <Spinner tone="mentor" size={16} label="Working" />}
          {experiment.activity}
        </p>
      )}
    </div>
  );
}

/** The one thing to do now, at the title's right: stop it, resume it, or qualify it. */
function Action({ experiment }: { experiment: WspExperiment }) {
  const [busy, setBusy] = useState(false);
  const run = async (title: string, call: () => Promise<WspExperiment>) => {
    setBusy(true);
    const next = await attempt(title, call);
    setBusy(false);
    if (next) keepExperiment(next);
  };
  const { id, status } = experiment;
  if (status === 'running') {
    return (
      <Button
        size="md"
        loading={busy}
        onClick={() => void run("Couldn't cancel it", () => wspApi.cancel(id))}
      >
        <Square size={14} strokeWidth={1.8} aria-hidden />
        Cancel
      </Button>
    );
  }
  if (status === 'interrupted') {
    return (
      <Button
        variant="primary"
        size="md"
        loading={busy}
        onClick={() => void run("Couldn't resume it", () => wspApi.resume(id))}
      >
        <Play size={14} strokeWidth={1.8} aria-hidden />
        Resume
      </Button>
    );
  }
  if (status === 'evaluated') {
    return (
      <Button
        variant="primary"
        size="md"
        loading={busy}
        onClick={() => void run("Couldn't qualify it", () => wspApi.qualify(id))}
      >
        <ShieldCheck size={16} strokeWidth={1.8} aria-hidden />
        Qualify
      </Button>
    );
  }
  return null;
}

/** Writes the frozen candidate as a whole checkpoint into a folder the person picks. */
function ExportButton({ experiment }: { experiment: WspExperiment }) {
  const [busy, setBusy] = useState(false);
  const save = async () => {
    const [parent] =
      (await attempt("Couldn't open the folder", () =>
        flowApi.pickFiles({ title: 'Choose where to write the checkpoint', directory: true }),
      )) ?? [];
    if (parent === undefined) return;
    setBusy(true);
    const written = await attempt("Couldn't export the checkpoint", () =>
      wspApi.exportCandidate(experiment.id, parent),
    );
    setBusy(false);
    if (written) toastWritten('Checkpoint written', written.folder);
  };
  return (
    <Button size="md" loading={busy} onClick={() => void save()}>
      <FolderOutput size={16} strokeWidth={1.8} aria-hidden />
      Export checkpoint
    </Button>
  );
}

/**
 * An experiment once it started: where it stands, the mentor's current hypothesis, the budget,
 * each arm as measured, every program, and once dev evaluation ends, its result.
 */
export function ExperimentView({ experiment }: { experiment: WspExperiment }) {
  const { result, status } = experiment;
  const exportable =
    experiment.frozen !== null && (status === 'evaluated' || status === 'qualified');
  return (
    <PlacePage
      title={experiment.title}
      back={{ label: 'Experiments', onClick: () => navigate(paths.home()) }}
      status={<Badge size="lg">{STATUS_WORDS[status]}</Badge>}
      action={
        <div className="flex items-center gap-2">
          {exportable && <ExportButton experiment={experiment} />}
          <Action experiment={experiment} />
        </div>
      }
    >
      {experiment.mentor.standIn && <StandInNote />}
      {(status === 'failed' || status === 'cancelled') && experiment.error && (
        <ErrorState
          layout="inline"
          title={status === 'failed' ? 'It stopped on an error' : 'It was cancelled'}
          message={experiment.error}
        />
      )}
      <Stages experiment={experiment} />
      {result && <ResultCard experiment={experiment} result={result} />}
      {!result && (
        <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-2">
          <Hypothesis experiment={experiment} />
          <Budget experiment={experiment} />
        </div>
      )}
      <section aria-label="Measurements" className="flex flex-col gap-3">
        <h2 className="m-0 font-display text-h2 font-semibold">Measured on dev</h2>
        <MeasurementTable experiment={experiment} split="dev" />
        {!experiment.measurements.some((item) => item.split === 'dev') && (
          <p className="m-0 text-ui">Nothing is measured yet: the baseline runs first.</p>
        )}
      </section>
      {status === 'qualified' && (
        <section aria-label="Qualification" className="flex flex-col gap-3">
          <h2 className="m-0 font-display text-h2 font-semibold">Measured on qualification</h2>
          <MeasurementTable experiment={experiment} split="qualification" />
        </section>
      )}
      <Programs experiment={experiment} />
      {result && <CaveatCards experiment={experiment} result={result} />}
      {result && <Budget experiment={experiment} />}
    </PlacePage>
  );
}
