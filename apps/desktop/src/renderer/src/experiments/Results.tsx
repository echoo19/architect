import { useState, type ReactNode } from 'react';
import {
  ExperimentDispositionSchema,
  type ArmId,
  type ArmReport,
  type ArmRow,
  type BackendId,
  type ComparisonReport,
  type ExperimentInput,
} from '@architect/shared';
import { armInSentence } from '@architect/shared';
import {
  DataTable,
  DetailList,
  Disclosure,
  Drawer,
  DrawerContent,
  DrawerSection,
  IntervalPlot,
  Panel,
  Segmented,
  type IntervalGroup,
} from '@architect/ui';
import { formatAnswerTime, formatCost } from '../flow/format';
import { DISPOSITIONS } from '../flow/train/evidence-words';
import { formatPercent } from '../lib/format';
import type { ModelNames } from '../flow/train/phase';
import { CostTable } from './CostTable';
import {
  armNames,
  backendNames,
  VERDICT_WORDS,
  costRowsOf,
  countIn,
  figuresOf,
  groupsOf,
  leadPair,
  minutesText,
  pairName,
  points,
  rowLabel,
  skillIn,
  skillsOf,
  verdictOf,
  type Measured,
  type TestGroup,
} from './model';

/*
 * A released experiment read like a short paper: what it found in a few sentences, then numbered
 * figures and tables, every number from the runner's report.
 */

function Figure({
  label,
  caption,
  children,
}: {
  label: string;
  caption: string;
  children: ReactNode;
}) {
  return (
    <figure className="m-0 flex flex-col gap-3">
      <Panel padded>{children}</Panel>
      <figcaption className="px-1 text-ui text-pretty">
        <span className="font-semibold">{label}.</span> {caption}
      </figcaption>
    </figure>
  );
}

function TableExhibit({
  label,
  caption,
  control,
  children,
}: {
  label: string;
  caption: string;
  control?: ReactNode;
  children: ReactNode;
}) {
  return (
    <figure className="m-0 flex flex-col gap-3">
      <div className="flex min-h-9 flex-wrap items-center justify-between gap-3 px-1">
        <figcaption className="text-ui text-pretty">
          <span className="font-semibold">{label}.</span> {caption}
        </figcaption>
        {control}
      </div>
      {children}
    </figure>
  );
}

/** The passes of one side of a pairing, from the pair's own counts. */
function passes(pair: { both: number; aOnly: number; bOnly: number }, side: 'a' | 'b') {
  return pair.both + (side === 'a' ? pair.aOnly : pair.bOnly);
}

/** The arms by name, as a released experiment's figures and tables call them. */
type ArmNames = Record<ArmId, string>;

/** What the experiment found, in a few sentences: the leading pairing and what it cost. */
function Summary({ report, names }: { report: ComparisonReport; names: ModelNames }) {
  const arms = armNames(names);
  const lead = leadPair(report);
  const { totals } = report;
  // A simulation says so first, so none of its figures is read as a measured result.
  const sentences: string[] = report.dryRun
    ? ['A simulation on stand-in models: no model was called, so these figures are not a result.']
    : [];
  if (lead) {
    const { pair } = lead;
    const verdict = verdictOf(pair.difference);
    sentences.push(
      `${arms[pair.a]} passed ${passes(pair, 'a')} of ${pair.scenarios} final-test tasks and ${armInSentence(arms[pair.b])} ${passes(pair, 'b')}, under seed ${pair.seed}.`,
      `Task by task, the difference is ${points(pair.difference.rate)} points, with a 95% interval from ${points(pair.difference.low)} to ${points(pair.difference.high)}, so ${
        verdict === 'gain'
          ? 'a gain is shown.'
          : verdict === 'loss'
            ? 'a loss is shown.'
            : 'no gain is shown.'
      }`,
    );
  } else {
    sentences.push('No two arms were measured on the same tasks, so nothing is compared.');
  }
  sentences.push(
    `${report.dryRun ? 'As simulated, it would have spent' : 'In all it spent'} ${formatCost(
      totals.sparkUsd,
    )} of ${names.mentor}${totals.studentUsd === null ? '' : ` and ${formatCost(totals.studentUsd)} of ${names.student}`}.`,
  );
  return <p className="m-0 max-w-[68ch] text-body text-pretty">{sentences.join(' ')}</p>;
}

/** Each row of a figure on each group of the final test, with its 95% interval. */
function plotGroups(
  rows: readonly ArmRow[],
  groups: readonly TestGroup[],
  arms: ArmNames,
): IntervalGroup[] {
  return groups.map((group) => ({
    label: group.label,
    rows: rows.map((row) => {
      const id = `${row.arm}-${row.configuration ?? ''}`;
      const count = countIn(row, group);
      const tone =
        row.arm === 'reference' || row.arm === 'reference-targeted' || row.arm === 'teacher'
          ? 'mentor'
          : 'student';
      return count === null
        ? { id, label: rowLabel(row, arms), estimate: null, tone }
        : {
            id,
            label: rowLabel(row, arms),
            estimate: count.pass / count.total,
            low: count.low,
            high: count.high,
            tone,
          };
    }),
  }));
}

function PairsTable({ measured, arms }: { measured: Measured; arms: ArmNames }) {
  return (
    <DataTable
      aria-label="Paired comparisons"
      rows={measured.pairs}
      rowKey={(pair) => pair.label}
      empty="No two arms here ran on the same tasks."
      columns={[
        { key: 'pair', header: 'Pair', cell: (pair) => pairName(pair, arms) },
        { key: 'wins', header: 'Won', align: 'end', width: '76px', cell: (pair) => pair.aOnly },
        { key: 'losses', header: 'Lost', align: 'end', width: '76px', cell: (pair) => pair.bOnly },
        {
          key: 'difference',
          header: 'Points',
          align: 'end',
          width: '88px',
          cell: (pair) => points(pair.difference.rate),
        },
        {
          key: 'interval',
          header: '95% interval',
          align: 'end',
          width: '156px',
          cell: (pair) => `${points(pair.difference.low)} to ${points(pair.difference.high)}`,
        },
        {
          key: 'verdict',
          header: 'Gain rule',
          width: '156px',
          cell: (pair) => {
            const verdict = verdictOf(pair.difference);
            const tone =
              verdict === 'gain' ? 'text-student' : verdict === 'loss' ? 'text-danger' : undefined;
            return <span className={tone}>{VERDICT_WORDS[verdict]}</span>;
          },
        },
      ]}
    />
  );
}

/** Each skill of one arm in each group: the tasks it passed of those it had. */
function SkillTable({
  rows,
  groups,
  arms,
}: {
  rows: readonly ArmRow[];
  groups: readonly TestGroup[];
  arms: ArmNames;
}) {
  const [chosen, setChosen] = useState<ArmId | undefined>(rows[0]?.arm);
  const row = rows.find((item) => item.arm === chosen) ?? rows[0];
  if (!row) return null;
  return (
    <TableExhibit
      label="Table 3"
      caption="Tasks passed by skill and organization."
      control={
        rows.length > 1 && (
          <Segmented<ArmId>
            aria-label="Arm"
            value={row.arm}
            onValueChange={setChosen}
            options={rows.map((item) => ({ value: item.arm, label: arms[item.arm] }))}
          />
        )
      }
    >
      <DataTable
        aria-label={`Skills of ${arms[row.arm]}`}
        rows={skillsOf(row)}
        rowKey={(skill) => skill.type}
        columns={[
          { key: 'skill', header: 'Skill', cell: (skill) => skill.label },
          ...groups.map((group) => ({
            key: group.key,
            header: group.label || 'Final test',
            align: 'end' as const,
            cell: (skill: { type: string }) => {
              const count = skillIn(row, group, skill.type);
              return count === null ? null : `${count.pass} of ${count.total}`;
            },
          })),
        ]}
      />
    </TableExhibit>
  );
}

function SpendTable({
  report,
  input,
  measured,
  names,
}: {
  report: ComparisonReport;
  input: ExperimentInput;
  measured: Measured | undefined;
  names: ModelNames;
}) {
  const asked = new Set(input.arms.map((item) => item.arm));
  const arms = report.arms.filter((arm) => asked.has(arm.arm));
  const named = armNames(names);
  const latency = (arm: ArmId) =>
    measured?.rows.find((row) => row.arm === arm && row.configuration === null)?.latencyMs ?? null;
  const against = (used: number | null, cap: number | null) =>
    used === null
      ? null
      : cap === null
        ? formatCost(used)
        : `${formatCost(used)} of ${formatCost(cap)}`;
  return (
    <DataTable
      aria-label="Spend and latency"
      rows={arms}
      rowKey={(arm) => arm.arm}
      columns={[
        { key: 'arm', header: 'Arm', cell: (arm) => named[arm.arm] },
        {
          key: 'spark',
          header: names.mentor,
          align: 'end',
          cell: (arm) => against(arm.spent.sparkUsd, arm.caps.sparkUsd),
        },
        {
          key: 'student',
          header: names.student,
          align: 'end',
          cell: (arm) => against(arm.spent.studentUsd, arm.caps.studentUsd),
        },
        {
          key: 'time',
          header: 'Time',
          align: 'end',
          width: '88px',
          cell: (arm) => (arm.status === 'not_run' ? null : minutesText(arm.spent.wallMinutes)),
        },
        {
          key: 'rounds',
          header: 'Rounds',
          align: 'end',
          width: '88px',
          cell: (arm) =>
            arm.rounds === null
              ? null
              : arm.caps.rounds === null
                ? arm.rounds.used
                : `${arm.rounds.used} of ${arm.caps.rounds}`,
        },
        {
          key: 'latency',
          header: 'Answer, median / 95th',
          align: 'end',
          width: '200px',
          cell: (arm) => {
            const measuredLatency = latency(arm.arm);
            return measuredLatency === null
              ? null
              : `${formatAnswerTime(measuredLatency.p50)} / ${formatAnswerTime(measuredLatency.p95)}`;
          },
        },
      ]}
    />
  );
}

/** "83% · 30 of 36", or null for nothing measured. */
const scoreText = (score: { pass: number; total: number } | null) =>
  score === null || score.total === 0
    ? null
    : `${formatPercent(score)} · ${score.pass} of ${score.total}`;

/** The harness version an arm froze, and its hash as a person reads it: "v3 · 61b8a9d". */
const versionText = (frozen: NonNullable<ArmReport['frozen']>) =>
  `v${frozen.harnessVersion} · ${frozen.harnessHash.replace(/^sha256[:-]/, '').slice(0, 7)}`;

/** Each arm's run: its rounds, its check tasks at the last kept change, and the version it froze. */
function RunsTable({
  arms,
  named,
  onOpen,
}: {
  arms: readonly ArmReport[];
  named: ArmNames;
  onOpen: (arm: ArmId) => void;
}) {
  return (
    <DataTable
      aria-label="Each arm's run"
      rows={arms}
      rowKey={(arm) => arm.arm}
      onRowClick={(arm) => onOpen(arm.arm)}
      columns={[
        { key: 'arm', header: 'Arm', cell: (arm) => named[arm.arm] },
        {
          key: 'rounds',
          header: 'Rounds',
          align: 'end',
          width: '88px',
          cell: (arm) => arm.rounds?.used ?? null,
        },
        {
          key: 'kept',
          header: 'Kept',
          align: 'end',
          width: '76px',
          cell: (arm) =>
            arm.rounds === null
              ? null
              : arm.experiments.filter((round) => round.disposition === 'kept').length,
        },
        {
          key: 'check',
          header: 'Check tasks',
          align: 'end',
          width: '176px',
          cell: (arm) => scoreText(arm.dev.kept?.after ?? arm.dev.baseline),
        },
        {
          key: 'version',
          header: 'Version',
          align: 'end',
          width: '156px',
          cell: (arm) =>
            arm.frozen === null ? null : (
              <span className="font-mono text-small">{versionText(arm.frozen)}</span>
            ),
        },
      ]}
    />
  );
}

/** What came of a round, in the Train screen's words; the runner's own word when it is new. */
function Disposition({ value }: { value: string }) {
  const known = ExperimentDispositionSchema.safeParse(value);
  if (!known.success) return <span className="shrink-0">{value}</span>;
  const { label, tone } = DISPOSITIONS[known.data];
  return <span className={`shrink-0 ${tone}`}>{label}</span>;
}

/** An arm's run as the runner recorded it: each round and what came of it, and its version. */
function ArmRun({ arm, named }: { arm: ArmReport; named: ArmNames }) {
  const { frozen } = arm;
  return (
    <DrawerContent
      title={named[arm.arm]}
      subtitle={arm.runId === null ? undefined : <span className="font-mono">{arm.runId}</span>}
    >
      <div className="flex flex-col gap-7">
        <DrawerSection title="Rounds">
          {arm.experiments.length === 0 ? (
            <p className="m-0 text-ui">{arm.rounds === null ? 'It has no rounds' : 'None'}</p>
          ) : (
            <ol className="m-0 flex list-none flex-col p-0">
              {arm.experiments.map((round) => (
                <li
                  key={round.round}
                  className="flex items-baseline gap-3 border-t border-line py-2.5 text-ui first:border-t-0"
                >
                  <span className="w-16 shrink-0 text-small">Round {round.round}</span>
                  <span className="min-w-0 flex-1 text-pretty">{round.title}</span>
                  <Disposition value={round.disposition} />
                </li>
              ))}
            </ol>
          )}
        </DrawerSection>
        <DrawerSection title="Check tasks">
          <DetailList
            items={[
              { label: 'At the start', value: scoreText(arm.dev.baseline) ?? '–' },
              ...(arm.dev.kept
                ? [
                    {
                      label: `After round ${arm.dev.kept.round}`,
                      value: scoreText(arm.dev.kept.after) ?? '–',
                    },
                  ]
                : []),
            ]}
          />
        </DrawerSection>
        <DrawerSection title="Version">
          {frozen === null ? (
            <p className="m-0 text-ui">Its harness wasn't frozen</p>
          ) : (
            <DetailList
              items={[
                { label: 'Harness', value: versionText(frozen) },
                { label: 'Model', value: frozen.localModel },
                { label: 'Runs on', value: frozen.backend },
                ...(frozen.adapter
                  ? [{ label: 'Adapter', value: frozen.adapter.sha256.slice(0, 7) }]
                  : []),
                { label: 'Final-test seeds', value: frozen.testSeeds.join(', ') },
              ]}
            />
          )}
        </DrawerSection>
      </div>
    </DrawerContent>
  );
}

/**
 * Each arm's run beside the paper: a row opens what it did round by round and the version of
 * its harness it froze. The runs are the experiment's own, kept with it.
 */
function ArmRuns({
  report,
  input,
  named,
}: {
  report: ComparisonReport;
  input: ExperimentInput;
  named: ArmNames;
}) {
  const asked = new Set(input.arms.map((item) => item.arm));
  const arms = report.arms.filter((arm) => asked.has(arm.arm) && arm.runId !== null);
  const [open, setOpen] = useState<ArmId | null>(null);
  const [shown, setShown] = useState(false);
  const chosen = arms.find((arm) => arm.arm === open);
  if (arms.length === 0) return null;
  return (
    <TableExhibit
      label="Table 5"
      caption="Each arm's run: its rounds, its check tasks, and the version of its harness it froze."
    >
      <RunsTable
        arms={arms}
        named={named}
        onOpen={(arm) => {
          setOpen(arm);
          setShown(true);
        }}
      />
      <Drawer open={shown} onOpenChange={setShown}>
        {chosen && <ArmRun arm={chosen} named={named} />}
      </Drawer>
    </TableExhibit>
  );
}

/** The released results: summary, the figure and tables for where the student ran, the notes. */
export function Results({
  report,
  input,
  names,
}: {
  report: ComparisonReport;
  input: ExperimentInput;
  /** The models it ran, as every line names them. */
  names: ModelNames;
}) {
  const arms = armNames(names);
  const figures = figuresOf(report);
  const [where, setWhere] = useState<BackendId | undefined>(figures[0]?.backend.backend);
  const measured = figures.find((figure) => figure.backend.backend === where) ?? figures[0];
  const groups = groupsOf(measured?.rows ?? []);
  const seed = report.plan.testSeeds[0];
  return (
    <div className="flex max-w-[960px] flex-col gap-10">
      <Summary report={report} names={names} />
      {measured && (
        <div className="flex flex-col gap-4">
          {figures.length > 1 && (
            <div className="flex items-center justify-between gap-4 px-1">
              <span className="text-ui font-medium">Where {names.student} ran</span>
              <Segmented<BackendId>
                aria-label={`Where ${names.student} ran`}
                value={measured.backend.backend}
                onValueChange={setWhere}
                options={figures.map((figure) => ({
                  value: figure.backend.backend,
                  label: backendNames(names)[figure.backend.backend],
                }))}
              />
            </div>
          )}
          <Figure
            label="Figure 1"
            caption={`Final-test pass rate of each arm${groups.length > 1 ? ' in each group' : ''}, with its 95% interval. ${measured.backend.label}, seed ${seed}.`}
          >
            <IntervalPlot
              aria-label={`Final-test pass rate, ${measured.backend.label}`}
              groups={plotGroups(measured.rows, groups, arms)}
            />
          </Figure>
        </div>
      )}
      {measured && (
        <TableExhibit
          label="Table 1"
          caption="Pairs of arms, task by task. A gain counts only when the whole interval is above zero."
        >
          <PairsTable measured={measured} arms={arms} />
        </TableExhibit>
      )}
      {costRowsOf(report).length > 0 && (
        <TableExhibit
          label="Table 2"
          caption="Final-test pass rate against what 1,000 requests cost, by the model that answered and where it ran: the tokens each attempt recorded, at that model's listed price."
        >
          <CostTable report={report} arms={arms} />
        </TableExhibit>
      )}
      {measured && (
        <SkillTable
          key={measured.backend.backend}
          rows={measured.rows.filter((row) => row.configuration === null)}
          groups={groups}
          arms={arms}
        />
      )}
      <TableExhibit
        label="Table 4"
        caption="What each arm spent of its caps, and how long its answers took."
      >
        <SpendTable report={report} input={input} measured={measured} names={names} />
      </TableExhibit>
      <ArmRuns report={report} input={input} named={arms} />
      {report.disclosures.length > 0 && (
        <Disclosure label="Notes from the report">
          <ul className="m-0 flex max-w-[76ch] list-disc flex-col gap-2 pl-5 text-ui text-pretty">
            {report.disclosures.map((note) => (
              <li key={note}>{note}</li>
            ))}
          </ul>
        </Disclosure>
      )}
    </div>
  );
}
