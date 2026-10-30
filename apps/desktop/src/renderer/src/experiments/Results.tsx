import { useState, type ReactNode } from 'react';
import type {
  ArmId,
  ArmRow,
  BackendId,
  ComparisonReport,
  ExperimentInput,
} from '@architect/shared';
import {
  DataTable,
  Disclosure,
  IntervalPlot,
  Panel,
  Segmented,
  type IntervalGroup,
} from '@architect/ui';
import { formatAnswerTime, formatCost } from '../flow/format';
import {
  ARM_NAMES,
  BACKEND_NAMES,
  VERDICT_WORDS,
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

/** What the experiment found, in a few sentences: the leading pairing and what it cost. */
function Summary({ report }: { report: ComparisonReport }) {
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
      `${ARM_NAMES[pair.a]} passed ${passes(pair, 'a')} of ${pair.scenarios} final-test tasks and ${ARM_NAMES[pair.b].toLowerCase()} ${passes(pair, 'b')}, under seed ${pair.seed}.`,
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
    )} of Spark${totals.studentUsd === null ? '' : ` and ${formatCost(totals.studentUsd)} of Glimmer`}.`,
  );
  return <p className="m-0 max-w-[68ch] text-body text-pretty">{sentences.join(' ')}</p>;
}

/** Each row of a figure on each group of the final test, with its 95% interval. */
function plotGroups(rows: readonly ArmRow[], groups: readonly TestGroup[]): IntervalGroup[] {
  return groups.map((group) => ({
    label: group.label,
    rows: rows.map((row) => {
      const id = `${row.arm}-${row.configuration ?? ''}`;
      const count = countIn(row, group);
      const tone =
        row.arm === 'reference' || row.arm === 'reference-targeted' ? 'mentor' : 'student';
      return count === null
        ? { id, label: rowLabel(row), estimate: null, tone }
        : {
            id,
            label: rowLabel(row),
            estimate: count.pass / count.total,
            low: count.low,
            high: count.high,
            tone,
          };
    }),
  }));
}

function PairsTable({ measured }: { measured: Measured }) {
  return (
    <DataTable
      aria-label="Paired comparisons"
      rows={measured.pairs}
      rowKey={(pair) => pair.label}
      empty="No two arms here ran on the same tasks."
      columns={[
        { key: 'pair', header: 'Pair', cell: (pair) => pairName(pair) },
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
function SkillTable({ rows, groups }: { rows: readonly ArmRow[]; groups: readonly TestGroup[] }) {
  const [chosen, setChosen] = useState<ArmId | undefined>(rows[0]?.arm);
  const row = rows.find((item) => item.arm === chosen) ?? rows[0];
  if (!row) return null;
  return (
    <TableExhibit
      label="Table 2"
      caption="Tasks passed by skill and organization."
      control={
        rows.length > 1 && (
          <Segmented<ArmId>
            aria-label="Arm"
            value={row.arm}
            onValueChange={setChosen}
            options={rows.map((item) => ({ value: item.arm, label: ARM_NAMES[item.arm] }))}
          />
        )
      }
    >
      <DataTable
        aria-label={`Skills of ${ARM_NAMES[row.arm]}`}
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
}: {
  report: ComparisonReport;
  input: ExperimentInput;
  measured: Measured | undefined;
}) {
  const asked = new Set(input.arms.map((item) => item.arm));
  const arms = report.arms.filter((arm) => asked.has(arm.arm));
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
        { key: 'arm', header: 'Arm', cell: (arm) => ARM_NAMES[arm.arm] },
        {
          key: 'spark',
          header: 'Spark',
          align: 'end',
          cell: (arm) => against(arm.spent.sparkUsd, arm.caps.sparkUsd),
        },
        {
          key: 'student',
          header: 'Glimmer',
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

/** The released results: summary, the figure and tables for where the student ran, the notes. */
export function Results({ report, input }: { report: ComparisonReport; input: ExperimentInput }) {
  const figures = figuresOf(report);
  const [where, setWhere] = useState<BackendId | undefined>(figures[0]?.backend.backend);
  const measured = figures.find((figure) => figure.backend.backend === where) ?? figures[0];
  const groups = groupsOf(measured?.rows ?? []);
  const seed = report.plan.testSeeds[0];
  return (
    <div className="flex max-w-[960px] flex-col gap-10">
      <Summary report={report} />
      {measured && (
        <div className="flex flex-col gap-4">
          {figures.length > 1 && (
            <div className="flex items-center justify-between gap-4 px-1">
              <span className="text-ui font-medium">Where Glimmer ran</span>
              <Segmented<BackendId>
                aria-label="Where Glimmer ran"
                value={measured.backend.backend}
                onValueChange={setWhere}
                options={figures.map((figure) => ({
                  value: figure.backend.backend,
                  label: BACKEND_NAMES[figure.backend.backend],
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
              groups={plotGroups(measured.rows, groups)}
            />
          </Figure>
        </div>
      )}
      {measured && (
        <TableExhibit
          label="Table 1"
          caption="Pairs of arms, task by task. A gain counts only when the whole interval is above zero."
        >
          <PairsTable measured={measured} />
        </TableExhibit>
      )}
      {measured && (
        <SkillTable
          key={measured.backend.backend}
          rows={measured.rows.filter((row) => row.configuration === null)}
          groups={groups}
        />
      )}
      <TableExhibit
        label="Table 3"
        caption="What each arm spent of its caps, and how long its answers took."
      >
        <SpendTable report={report} input={input} measured={measured} />
      </TableExhibit>
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
