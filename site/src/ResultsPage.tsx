import { Fragment, type ReactNode } from 'react';
import { ArrowUpRight, ChevronRight } from 'lucide-react';
import { REPORTS } from './content';
import {
  ADAPTER_ARMS,
  ADAPTER_PAIRS,
  ADAPTER_RUN,
  ADAPTERS,
  CERT2,
  CERT2_CHECK,
  CERT2_ROWS,
  FIELD_ARMS,
  FIELD_MONEY,
  FIELD_PAIRS,
  FIELD_TEST_SIZE,
  FINETUNE_LOSS,
  FIRST,
  GROUPS,
  LAB_ARMS,
  LAB_GROUPS,
  LAB_PAIRS,
  LAB_RUN,
  LAB_SKILL_ROWS,
  LAB_SKILLS,
  LAB_TEST_SIZE,
  LOCAL_ROWS,
  LOCAL_SPEED,
  OPEN,
  OPEN_MONEY,
  PER_TYPE,
  REPAIR,
  ROUNDS_FIELD,
  ROUNDS_SECOND,
  SECOND,
  SKILL_ROWS,
  SKILLS,
  sourceUrl,
  SOURCES,
  SWEEP_RUN,
  TARGET_PASSES,
  TEST_SIZE,
  THIRD_ROWS,
  THIRD_TEST_SIZE,
  TYPES,
  type Arm,
  type Comparison,
  type FieldArm,
  type FieldPair,
  type GroupKey,
  type LabGroupKey,
  type LocalRow,
  type Round,
  type SourceKey,
} from './evidence';
import { Footer } from './components/Footer';
import { Forest, type ForestRow } from './components/Forest';
import { Header } from './components/Header';
import { Reveal } from './components/Reveal';
import { RoundDiagram } from './components/RoundDiagram';

/**
 * The results page, set out as a short paper: a title and an abstract, then numbered sections with
 * the strongest results first. Each section has the same rhythm: a plain lead, its headline
 * figure, a numbered figure, and a fold of details with the method and the numbered tables. Every
 * number is in `evidence.ts`, with the document it comes from.
 */

const dollars = (value: number) => `$${value.toFixed(2)}`;
const signed = (value: number) => `${value > 0 ? '+' : ''}${value.toFixed(1)}`;

/** The documents cited, in the order the page first cites them, with what each one is. */
type RefKey = SourceKey | 'gepa' | 'ace' | 'taubench' | 'crc' | 'ltt' | 'abstention' | 'zeller';

/** Published papers cited, by their arXiv number; the page links to no address but the repository. */
const PAPERS: Partial<Record<RefKey, string>> = {
  gepa: 'arXiv 2507.19457',
  ace: 'arXiv 2510.04618',
  taubench: 'arXiv 2406.12045',
  crc: 'arXiv 2208.02814',
  ltt: 'arXiv 2110.01052',
  abstention: 'arXiv 2405.01563',
  zeller: 'Zeller and Hildebrandt, 2002',
};

const REFERENCES: readonly { key: RefKey; what: string }[] = [
  { key: 'plan', what: "The returns desk comparison's plan, published before it ran." },
  { key: 'gepa', what: 'GEPA: improving prompts from failures by reflection.' },
  { key: 'ace', what: 'ACE: agents that grow their own context from experience.' },
  { key: 'taubench', what: 'tau-bench: checking an agent by the final state of its work.' },
  { key: 'academyDesk', what: "The Academy desk run's report." },
  { key: 'local', what: "The Academy desk's check on the build that runs on one graphics card." },
  { key: 'inventory', what: "Inventory desk's run, at a screening lab's compound store." },
  { key: 'qlora1', what: "The first fine-tune: Inventory desk's work as a QLoRA adapter." },
  {
    key: 'adapterEval',
    what: "Inventory desk's QLoRA adapter on Inventory desk's sealed final test.",
  },
  { key: 'cert2', what: 'The second live certificate run, which issued the first certificate.' },
  { key: 'zeller', what: 'Simplifying and isolating failure-inducing input (delta debugging).' },
  { key: 'certify', what: 'The plan for certified answers and counterexample-guided repair.' },
  {
    key: 'decisions',
    what: 'The decision on counterexample-guided repair, with its first real reduction.',
  },
  {
    key: 'crc',
    what: 'Conformal risk control: keeping the expected error of a prediction under a chosen level.',
  },
  {
    key: 'ltt',
    what: 'Learn-then-Test: choosing a setting so that a risk is controlled with stated confidence.',
  },
  {
    key: 'abstention',
    what: 'Conformal abstention: when a language model should decline to answer.',
  },
  { key: 'open', what: 'The returns desk taught by Muse Spark Open, on open weights.' },
  { key: 'scale', what: 'The plan for going from a specialist to a field model.' },
  { key: 'second', what: "The returns desk comparison's report." },
  { key: 'hackathon', what: "The repair shop's demo run, recorded with the film." },
  { key: 'third', what: 'The third Academy desk run.' },
  { key: 'thirdMisses', what: "Why the third run's Academy desk missed, checked after the test." },
  { key: 'cert', what: "The first live certificate run, on the third run's Academy desk." },
  { key: 'first', what: "The first returns desk comparison's report." },
  { key: 'qlora2', what: "The second fine-tune: Sweep desk's work as a QLoRA adapter." },
  { key: 'assay', what: "Assay desk's first run, at a screening lab's plate reader." },
  { key: 'assay2', what: "Assay desk's second run, under two seeds." },
  { key: 'sweep2', what: "Sweep desk's second run, at ML research groups' training runs." },
  { key: 'team2', what: 'The second agent-team run, Inventory desk asking Assay desk.' },
];

/**
 * Sections, figures and tables take their numbers from their place in these lists, which follow
 * the order they appear on the page, so a section added later takes its place in them and
 * everything after it renumbers.
 */
const SECTIONS = [
  'method',
  'field',
  'inventory',
  'finetune',
  'certified',
  'open',
  'scale',
  'returns',
  'limits',
] as const;
const FIGURES = [
  'round',
  'fieldGroups',
  'fieldPairs',
  'lab',
  'adapter',
  'loss',
  'certificate',
  'open',
  'returns',
  'speed',
] as const;
const TABLES = [
  'fieldPairs',
  'fieldSkills',
  'fieldRounds',
  'local',
  'labPairs',
  'labSkills',
  'adapterPairs',
  'adapterArms',
  'adapters',
  'certCalibration',
  'certCheck',
  'openArms',
  'openPairs',
  'scale',
  'returnsArms',
  'returnsPairs',
  'returnsRounds',
  'costs',
] as const;

const sec = (key: (typeof SECTIONS)[number]) => SECTIONS.indexOf(key) + 1;
const fig = (key: (typeof FIGURES)[number]) => `Figure ${FIGURES.indexOf(key) + 1}`;
const tab = (key: (typeof TABLES)[number]) => `Table ${TABLES.indexOf(key) + 1}`;

const refNumber = (key: RefKey) => REFERENCES.findIndex((reference) => reference.key === key) + 1;

/** Numbered citations in ascending order, each a link to its entry in the references. */
function Cite({ to }: { to: readonly RefKey[] }) {
  const sorted = [...to].sort((one, two) => refNumber(one) - refNumber(two));
  return (
    <span className="whitespace-nowrap tabular-nums">
      {' ['}
      {sorted.map((key, index) => (
        <Fragment key={key}>
          {index > 0 && ', '}
          <a className="link-quiet" href={`#ref-${key}`}>
            {refNumber(key)}
          </a>
        </Fragment>
      ))}
      ]
    </span>
  );
}

/**
 * A numbered figure or table in its own panel. A figure's number and caption sit under it and a
 * table's over it, as a paper sets them.
 */
function Panel({
  label,
  caption,
  children,
  table = false,
}: {
  label: string;
  caption: ReactNode;
  children: ReactNode;
  table?: boolean;
}) {
  const text = (
    <figcaption className="t-body text-pretty">
      <span className="font-semibold">{label}.</span> {caption}
    </figcaption>
  );
  return (
    <figure className="m-0 flex flex-col gap-6 rounded-card bg-card px-8 py-7 shadow-edge max-sm:px-4 max-sm:py-5">
      {table && text}
      {children}
      {!table && text}
    </figure>
  );
}

/** A figure in the running text, stepping out past the column where the window is wide. */
function Exhibit(props: { label: string; caption: ReactNode; children: ReactNode }) {
  return (
    <Reveal className="exhibit my-6">
      <Panel {...props} />
    </Reveal>
  );
}

/** A table inside a section's details. */
function TableExhibit(props: { label: string; caption: ReactNode; children: ReactNode }) {
  return <Panel table {...props} />;
}

/**
 * A section's method and tables, folded under one line until a reader opens them: the method in
 * the column, then the panels stepping out past it.
 */
function Details({ method, children }: { method?: ReactNode; children: ReactNode }) {
  return (
    <details className="tables">
      <summary className="link-quiet inline-flex cursor-pointer items-center gap-2 font-medium">
        <ChevronRight className="tables-chevron" size={16} strokeWidth={1.8} aria-hidden />
        Details
      </summary>
      <div className="flex flex-col gap-6 pt-6">
        {method}
        <div className="exhibit flex flex-col gap-6">{children}</div>
      </div>
    </details>
  );
}

/** A numbered section. */
function Section({
  id,
  number,
  title,
  children,
}: {
  id: string;
  number: number;
  title: string;
  children: ReactNode;
}) {
  return (
    <section
      id={id}
      aria-labelledby={`${id}-title`}
      className="article flex scroll-mt-20 flex-col gap-6 pt-20 sm:pt-28"
    >
      <h2 id={`${id}-title`} className="t-h1 hang">
        <span className="sec-num">{number}</span>
        {title}
      </h2>
      {children}
    </section>
  );
}

function Text({ children }: { children: ReactNode }) {
  return <p className="t-read">{children}</p>;
}

/** A section's headline figure, set large, then what it counts, read as one sentence. */
function Headline({ figure, children }: { figure: string; children: ReactNode }) {
  return (
    <p className="m-0 my-2 flex flex-col gap-x-6 gap-y-2 border-y border-line py-6 sm:flex-row sm:items-baseline">
      <span className="t-title shrink-0 tabular-nums">{figure}</span>{' '}
      <span className="t-read">{children}</span>
    </p>
  );
}

/** One arm of a comparison, by its name. */
function arm(comparison: Comparison, name: string): Arm {
  const found = comparison.arms.find((each) => each.name === name);
  if (!found) throw new Error(`The ${comparison.id} comparison has no arm "${name}".`);
  return found;
}

/** A row the page reads by its place, which must be there. */
function found<T>(value: T | undefined, what: string): T {
  if (value === undefined) throw new Error(`There is no ${what}.`);
  return value;
}

const interval = (p: { low: number; high: number }) => `${signed(p.low)} to ${signed(p.high)}`;

/** A hairline table: a header row, then rows whose numbers line up. */
function Table({
  columns,
  rows,
  label,
  left = [0],
  fit = false,
}: {
  columns: readonly string[];
  rows: readonly (readonly ReactNode[])[];
  label: string;
  /** The columns set against the left edge; the rest are numbers, against the right. */
  left?: readonly number[];
  /** A short table that never needs to scroll sideways. */
  fit?: boolean;
}) {
  return (
    <div className="overflow-x-auto">
      <table
        aria-label={label}
        className={`paper-table w-full border-collapse text-left text-body tabular-nums ${fit ? '' : 'min-w-[640px]'}`}
      >
        <thead>
          <tr>
            {columns.map((column, index) => (
              <th
                key={column}
                scope="col"
                className={`t-small pb-3 pr-4 align-bottom font-medium last:pr-0 ${left.includes(index) ? '' : 'whitespace-nowrap text-right'}`}
              >
                {column === '' ? <span className="sr-only">Arm</span> : column}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => (
            <tr key={index} className="border-t border-line first:border-t-0">
              {row.map((cell, cellIndex) => (
                <td
                  key={cellIndex}
                  className={`py-3 pr-4 align-top last:pr-0 ${cellIndex === 0 ? 'min-w-[10rem] font-medium' : ''} ${left.includes(cellIndex) ? '' : 'whitespace-nowrap text-right'}`}
                >
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const armLabel = (arm: { name: string }) => <span className="text-pretty">{arm.name}</span>;

/** A count with its 95% interval, as a figure row ends on it. */
function CountFigure({
  passed,
  of,
  low,
  high,
}: {
  passed: number;
  of: number;
  low: number;
  high: number;
}) {
  return (
    <span className="flex flex-col items-end">
      <span className="font-display text-h2 font-semibold">
        {passed}
        <span className="t-body ml-1.5"> of {of}</span>
      </span>
      <span className="t-small">
        {low.toFixed(1)}% to {high.toFixed(1)}%
      </span>
    </span>
  );
}

/** The pass rate of each arm on the final test, with its 95% interval, and the job's target. */
function PassRates({ comparison, target = true }: { comparison: Comparison; target?: boolean }) {
  const rows: ForestRow[] = comparison.arms.map((arm) => ({
    label: armLabel(arm),
    value: (arm.passed / TEST_SIZE) * 100,
    low: arm.low,
    high: arm.high,
    tone: arm.tone,
    figure: <CountFigure passed={arm.passed} of={TEST_SIZE} low={arm.low} high={arm.high} />,
    summary: `${arm.name}: ${arm.passed} of ${TEST_SIZE}, 95% interval ${arm.low} to ${arm.high} percent.`,
  }));
  return (
    <Forest
      name={`Final-test pass rate by harness, ${comparison.title}`}
      rows={rows}
      min={0}
      max={100}
      ticks={[0, 25, 50, 75, 100]}
      formatTick={(value) => `${value}%`}
      target={
        target
          ? { at: 95, label: `The job's target: 95%, which is ${TARGET_PASSES} of ${TEST_SIZE}` }
          : undefined
      }
    />
  );
}

/** Each arm's passes by kind of request, and in all with its 95% interval. */
function ArmTable({ comparison }: { comparison: Comparison }) {
  return (
    <Table
      label={`Final-test passes by kind of request, ${comparison.title}`}
      columns={['', ...TYPES, 'All, 95% interval']}
      rows={comparison.arms.map((arm) => [
        armLabel(arm),
        ...arm.byType.map(String),
        `${arm.passed} (${arm.low.toFixed(1)}% to ${arm.high.toFixed(1)}%)`,
      ])}
    />
  );
}

/** Each pair of arms, request by request: who won, who lost, where they agreed, and the difference. */
function PairTable({ comparison }: { comparison: Comparison }) {
  return (
    <Table
      label={`Request by request, ${comparison.title}`}
      columns={['', 'Won', 'Lost', 'Both passed', 'Neither', 'Difference, 95% interval']}
      rows={comparison.pairs.map((pair) => [
        pair.label,
        pair.wins,
        pair.losses,
        pair.both,
        pair.neither,
        `${signed(pair.diff)}, ${interval(pair)}`,
      ])}
    />
  );
}

/** The rounds as rows: the change, its held-out check scores, and whether it was kept. */
function RoundList({ rounds, label }: { rounds: readonly Round[]; label: string }) {
  return (
    <ol aria-label={label} className="m-0 list-none p-0">
      {rounds.map((round) => (
        <li
          key={round.n}
          className="grid grid-cols-[2rem_minmax(0,1fr)_auto] gap-x-4 border-t border-line py-4"
        >
          <span className="tabular-nums">{String(round.n).padStart(2, '0')}</span>
          <span className="flex flex-col gap-1">
            <span className="font-medium text-pretty">{round.change}</span>
            <span className="t-small tabular-nums">
              Held-out checks {round.before} to {round.after} of {round.total ?? 45}
              {round.again &&
                `, measured again ${round.again[0]} to ${round.again[1]} of ${round.againTotal ?? 90}`}
              {round.why && `. ${round.why}.`}
            </span>
          </span>
          {round.kept ? (
            <span className="font-medium text-student">Kept</span>
          ) : (
            <span>Reverted</span>
          )}
        </li>
      ))}
    </ol>
  );
}

const groupName = (key: GroupKey | 'all') =>
  key === 'all' ? 'All groups' : (GROUPS.find((group) => group.short === key)?.name ?? key);

const labGroupName = (key: LabGroupKey | 'all') =>
  key === 'all' ? 'All labs' : (LAB_GROUPS.find((group) => group.short === key)?.name ?? key);

const pairName = (pair: FieldPair) => `${pair.label}, ${groupName(pair.group)}`;

/** The pass rate of each arm in one group of organizations, with its 95% interval. */
function GroupPassRates({
  groups,
  arms,
  index,
}: {
  groups: readonly { name: string; n: number }[];
  arms: readonly FieldArm[];
  index: number;
}) {
  const group = groups[index];
  if (group === undefined) throw new Error(`There is no group ${index}.`);
  const rows: ForestRow[] = arms.map((each) => {
    const result = each.groups[index];
    if (result === undefined) throw new Error(`${each.name} has no result for ${group.name}.`);
    return {
      label: armLabel(each),
      value: (result.passed / group.n) * 100,
      low: result.low,
      high: result.high,
      tone: each.tone,
      figure: (
        <CountFigure passed={result.passed} of={group.n} low={result.low} high={result.high} />
      ),
      summary: `${group.name}, ${each.name}: ${result.passed} of ${group.n}, 95% interval ${result.low} to ${result.high} percent.`,
    };
  });
  return (
    <div className="flex flex-col gap-2">
      <h4 className="t-h2">{group.name}</h4>
      <Forest
        name={`Final-test pass rate by harness, ${group.name}`}
        rows={rows}
        min={0}
        max={100}
        ticks={[0, 25, 50, 75, 100]}
        formatTick={(value) => `${value}%`}
      />
    </div>
  );
}

/**
 * Academy desk against each other arm at the taught academies and Harborview Prep: the difference
 * in points with its interval. The Real academy's pairs are in the table under the section.
 */
function FieldPairForest() {
  const shown = FIELD_PAIRS.filter(
    (each) =>
      each.label.startsWith('Academy desk') &&
      (each.group === 'harborview' || each.group === 'taught'),
  );
  const rows: ForestRow[] = shown.map((each) => ({
    label: <span className="text-pretty">{pairName(each)}</span>,
    value: each.diff,
    low: each.low,
    high: each.high,
    tone: each.low > 0 ? 'student' : 'plain',
    figure: <span className="font-display text-h2 font-semibold">{signed(each.diff)}</span>,
    summary: `${pairName(each)}: ${signed(each.diff)} points, 95% interval ${signed(each.low)} to ${signed(each.high)}.`,
  }));
  return (
    <Forest
      name="Difference in final-test pass rate, in percentage points, Academy desk against the other harnesses"
      rows={rows}
      min={-20}
      max={70}
      ticks={[-20, 0, 20, 40, 60]}
      formatTick={(value) => `${value > 0 ? '+' : ''}${value}`}
      zero="No difference"
    />
  );
}

/** Every pairing in a field run, task by task, with the difference and its interval. */
function GroupPairTable<G extends string>({
  pairs,
  name,
  label,
}: {
  pairs: readonly FieldPair<G>[];
  name: (group: G | 'all') => string;
  label: string;
}) {
  return (
    <Table
      label={label}
      left={[0, 1]}
      columns={['', 'Group', 'Won', 'Lost', 'Both passed', 'Neither', 'Difference, 95% interval']}
      rows={pairs.map((each) => [
        each.label,
        `${name(each.group)} (${each.n})`,
        each.wins,
        each.losses,
        each.both,
        each.neither,
        `${signed(each.diff)}, ${interval(each)}`,
      ])}
    />
  );
}

/** Passes by skill and organization, for each harness. */
function SkillTable() {
  return (
    <Table
      label="Passes by skill and organization, the field run"
      left={[0, 1]}
      columns={['Skill', 'Group', 'Base harness', 'One-shot harness', 'Academy desk']}
      rows={SKILLS.flatMap((skill) =>
        SKILL_ROWS.filter((row) => row.skill === skill).map((row, index) => [
          index === 0 ? skill : '',
          groupName(row.group),
          `${row.bare} of ${row.of}`,
          `${row.draft} of ${row.of}`,
          `${row.academyDesk} of ${row.of}`,
        ]),
      )}
    />
  );
}

/** Passes by skill and lab, for each harness. */
function LabSkillTable() {
  return (
    <Table
      label="Passes by skill and lab, the screening lab run"
      left={[0, 1]}
      columns={['Skill', 'Lab', 'Base harness', 'One-shot harness', 'Inventory desk']}
      rows={LAB_SKILLS.flatMap((skill) =>
        LAB_SKILL_ROWS.filter((row) => row.skill === skill).map((row, index) => [
          index === 0 ? skill : '',
          labGroupName(row.group),
          `${row.bare} of ${row.of}`,
          `${row.draft} of ${row.of}`,
          `${row.inventoryDesk} of ${row.of}`,
        ]),
      )}
    />
  );
}

/** Academy desk's passes on this computer against hosted, group by group, with the paired difference. */
function LocalTable() {
  const name = (row: LocalRow) => `${groupName(row.group)} (${row.n})`;
  return (
    <Table
      label="Academy desk on this computer and hosted, the same final-test tasks"
      columns={['Group', 'This computer', 'Hosted', 'Won', 'Lost', 'Difference, 95% interval']}
      rows={LOCAL_ROWS.map((row) => [
        name(row),
        `${row.local} of ${row.n}`,
        `${row.hosted} of ${row.n}`,
        row.wins,
        row.losses,
        `${signed(row.diff)}, ${interval(row)}`,
      ])}
    />
  );
}

/** The certificate as the app states it, and the check on an academy it never trained on. */
function CertificateFigure() {
  const items: readonly { figure: string; text: string }[] = [
    { figure: `At most ${CERT2.stated}%`, text: 'wrong when it answers' },
    { figure: `${CERT2.confidence}%`, text: 'confidence' },
    { figure: `${CERT2.coverage}%`, text: 'of calibration requests answered' },
    {
      figure: `${CERT2.checkWrong} of ${CERT2.checkAnswered}`,
      text: 'wrong at Harborview Prep, never trained on',
    },
  ];
  return (
    <ul className="m-0 grid list-none grid-cols-2 gap-x-6 gap-y-8 p-0 lg:grid-cols-4">
      {items.map((item) => (
        <li key={item.text} className="flex flex-col gap-2 border-t border-line pt-4">
          <span className="font-display text-h2 font-semibold tabular-nums">{item.figure}</span>
          <span className="t-body text-pretty">{item.text}</span>
        </li>
      ))}
    </ul>
  );
}

/** The certificate run's risk and coverage on calibration, by agreement threshold. */
function CertCalibrationTable() {
  return (
    <Table
      fit
      label="The certificate run: risk and coverage on calibration by agreement threshold"
      columns={['Answers when', 'Answered', 'Wrong', 'Handed off', 'Upper bound']}
      rows={CERT2_ROWS.map((row) => [
        row.when,
        `${row.answered} of ${CERT2.calibration}`,
        row.wrong,
        `${row.handedOff}%`,
        `${row.bound.toFixed(2)}%`,
      ])}
    />
  );
}

/** The check at Harborview Prep, by agreement threshold. */
function CertCheckTable() {
  return (
    <Table
      fit
      label="The certificate's check at Harborview Prep by agreement threshold"
      columns={['Answers when', 'Answered', 'Wrong', 'Handed off']}
      rows={CERT2_CHECK.map((row) => [
        row.when,
        `${row.answered} of ${CERT2.checkTasks}`,
        row.wrong,
        row.handedOff,
      ])}
    />
  );
}

/** The training loss at each optimizer step, as a dot on a shared axis. */
function LossFigure() {
  const rows: ForestRow[] = FINETUNE_LOSS.map((row) => ({
    label: `Step ${row.step}`,
    value: row.loss,
    low: row.loss,
    high: row.loss,
    tone: 'student',
    figure: <span className="font-display text-h2 font-semibold">{row.loss.toFixed(4)}</span>,
    summary: `Step ${row.step}: training loss ${row.loss.toFixed(4)}.`,
  }));
  return (
    <Forest
      name="Training loss by optimizer step, Inventory desk's QLoRA run"
      rows={rows}
      min={0}
      max={0.12}
      ticks={[0, 0.04, 0.08, 0.12]}
      formatTick={(value) => value.toFixed(2)}
    />
  );
}

/** Each adapter: what it was trained on, what it cost, and the checks it passed. */
function AdapterTable() {
  return (
    <Table
      label="The two QLoRA adapters and their checks"
      columns={['', ...ADAPTERS.map((adapter) => adapter.desk)]}
      rows={[
        ['Examples', ...ADAPTERS.map((adapter) => adapter.examples)],
        ['Optimizer steps', ...ADAPTERS.map((adapter) => adapter.steps)],
        [
          'GPU time, of it training',
          ...ADAPTERS.map((adapter) => `${adapter.gpuMinutes} min, ${adapter.trainingMinutes} min`),
        ],
        ['Cost', ...ADAPTERS.map((adapter) => dollars(adapter.usd))],
        ['LoRA pairs', ...ADAPTERS.map((adapter) => adapter.pairs)],
        ['Rank, alpha', ...ADAPTERS.map((adapter) => `${adapter.rank}, ${adapter.alpha}`)],
        ['sha256', ...ADAPTERS.map((adapter) => <code key={adapter.desk}>{adapter.sha256}</code>)],
        ['Checked against the base', ...ADAPTERS.map(() => 'Pass')],
      ]}
    />
  );
}

/** Each arm of the adapter run in one group of labs, out of the tasks it took, with its interval. */
function AdapterPassRates({ index }: { index: number }) {
  const group = found(LAB_GROUPS[index], `lab group ${index}`);
  const rows: ForestRow[] = ADAPTER_ARMS.map((each) => {
    const result = found(each.groups[index], `${each.name}'s result for ${group.name}`);
    return {
      label: armLabel(each),
      value: (result.passed / result.of) * 100,
      low: result.low,
      high: result.high,
      tone: each.tone,
      figure: (
        <CountFigure passed={result.passed} of={result.of} low={result.low} high={result.high} />
      ),
      summary: `${group.name}, ${each.name}: ${result.passed} of ${result.of}, 95% interval ${result.low} to ${result.high} percent.`,
    };
  });
  return (
    <div className="flex flex-col gap-2">
      <h4 className="t-h2">{group.name}</h4>
      <Forest
        name={`Final-test pass rate with the adapter and without it, ${group.name}`}
        rows={rows}
        min={0}
        max={100}
        ticks={[0, 25, 50, 75, 100]}
        formatTick={(value) => `${value}%`}
      />
    </div>
  );
}

/** Each arm of the adapter run: passes by group, how much it wrote a call, and how long it took. */
function AdapterArmTable() {
  return (
    <Table
      label="Final-test passes, output and time by arm, the adapter run"
      columns={[
        '',
        ...LAB_GROUPS.map((group) => group.name),
        'All, 95% interval',
        'Tokens a call',
        'Median seconds (95th percentile)',
      ]}
      rows={ADAPTER_ARMS.map((each) => [
        armLabel(each),
        ...each.groups.map((result) => `${result.passed} of ${result.of}`),
        `${each.all.passed} of ${each.all.of} (${each.all.low.toFixed(1)}% to ${each.all.high.toFixed(1)}%)`,
        each.tokens,
        `${each.p50.toFixed(1)} (${each.p95.toFixed(1)})`,
      ])}
    />
  );
}

/** What is measured, what is built and tested on stand-ins, and what has not been done. */
const SCALE_STATUS: readonly (readonly [string, string, string])[] = [
  [
    'Harnesses engineered for a field',
    'Measured',
    `Two Academy desk runs and an Inventory desk run, with sealed organizations, each under one seed (sections ${sec('field')}, ${sec('inventory')} and ${sec('limits')}).`,
  ],
  [
    'Export of verified demonstrations and an outcome scorer',
    'Built',
    'The export fed both fine-tunes, and field-export.test.ts tests the scorer. Nothing from a sealed organization goes in.',
  ],
  [
    "Training plans sized from a model's configuration",
    'Built',
    'The memory terms are estimates, shown with their arithmetic.',
  ],
  [
    'Cluster launch bundles for Slurm and Kubernetes',
    'Built, experimental',
    'Checked structurally and against simulated schedulers in training-bundle.test.ts, and not yet run on a real cluster. Run by you, with your own tools.',
  ],
  [
    'LoRA and QLoRA fine-tuning on one rented GPU',
    'Measured',
    `Two QLoRA adapters of Glimmer trained for real on Hugging Face Jobs, each on one A100, and checked against the base. Inventory desk's took its sealed final test (section ${sec('finetune')}).`,
  ],
  ['Cluster execution and training gains', 'Unverified', 'No cluster job has run.'],
  [
    'A model trained on a field',
    'Measured, one seed',
    "Glimmer with a QLoRA adapter trained on Inventory desk's verified work passed 32 of 32 at Corvid Hill Discovery, against 22 of 30 without it.",
  ],
];

const ENGINEERED = 'Glimmer on the Spark-engineered harness';
const BASE = 'Glimmer on the base harness';

const firstReturns = {
  engineered: arm(FIRST, ENGINEERED),
  base: arm(FIRST, BASE),
};
const thirdJuniper = found(THIRD_ROWS[1], 'third-run row for Juniper Study House');
const thirdReal = found(THIRD_ROWS[2], 'third-run row for the Real academy');
const realFirst = {
  academyDesk: found(FIELD_ARMS[2]?.groups[2], "Academy desk's Real academy result"),
  base: found(FIELD_ARMS[0]?.groups[2], "the base harness's Real academy result"),
  n: found(GROUPS[2], 'Real academy group').n,
};
const inventoryAdapter = found(ADAPTERS[0], "Inventory desk's adapter");
const sweepAdapter = found(ADAPTERS[1], "Sweep desk's adapter");

/**
 * What the results do not show, grouped by cause, each with the documents that state it. Weak or
 * unconfirmed runs are reported here, in a sentence or two, rather than in the sections above.
 */
const LIMITS: readonly { title: string; text: string; from: readonly SourceKey[] }[] = [
  {
    title: 'One seed.',
    text: `Every comparison in sections ${sec('field')} to ${sec('returns')} ran its final test once, under one seed, and all but the local check used Glimmer served online.`,
    from: ['academyDesk', 'second'],
  },
  {
    title: 'Whole configurations.',
    text: `The harnesses ran with different temperatures, turn limits, reasoning levels and, on the returns desks, budgets (${tab('fieldPairs')}, ${tab('labPairs')} and ${tab('openPairs')}), and Inventory desk used about 3.6 times the base harness's student spend.`,
    from: ['academyDesk', 'inventory', 'second'],
  },
  {
    title: 'Generated organizations.',
    text: 'Every organization but the Real academy is generated, and both returns desks come from one made-up shop. On the labs, a difference of a few tasks between the one-shot and the engineered harness is within what reruns could move.',
    from: ['inventory', 'plan'],
  },
  {
    title: 'The Real academy.',
    text: `Academy desk passed ${realFirst.academyDesk.passed} of ${realFirst.n} there against ${realFirst.base.passed}, too few tasks to confirm a gain. A replay traced its misses to a question lookup that searches by section, which most of the academy's tests list as Full, and to history answers marked right in other wording. Its policy was drafted for this test, partly from the generated academies, and awaits the academy's confirmation.`,
    from: ['academyDesk'],
  },
  {
    title: 'A third run.',
    text: `A third run passed ${thirdJuniper.academyDesk.passed} of ${thirdJuniper.n} at Juniper Study House, another unseen academy, against ${thirdJuniper.bare.passed}, and ${thirdReal.academyDesk.passed} of ${thirdReal.n} against ${thirdReal.bare.passed} on a second Real academy snapshot. A replay traced the Real academy misses to instructions keyed to phrases that academy doesn't use, history attempts that hit the step limit and an empty assignments file, and the task builder was fixed afterwards. The run reused the ${THIRD_TEST_SIZE} tasks of a second run that stopped before any result was read.`,
    from: ['third', 'thirdMisses'],
  },
  {
    title: 'The local check.',
    text: 'Only Academy desk took it, since the base harness ran out of memory on one graphics card.',
    from: ['local'],
  },
  {
    title: 'Scripted steps.',
    text: "A script, not a person, confirmed the study briefs, and the first academy run and Inventory desk's run used runner patches listed in their reports.",
    from: ['academyDesk', 'inventory'],
  },
  {
    title: 'The adapter.',
    text: 'It took the final test once, in bf16 rather than the 4-bit base it trained on. Its training examples held no reasoning, so it answers without writing any, and part of its gain may come from that. On the base harness, every interval for its gain includes zero.',
    from: ['adapterEval'],
  },
  {
    title: 'The certificate.',
    text: 'It covers diagnose, history and assign on generated academies, from attempts at temperature 0 that differ only through the provider, with calibration tasks that are new pairs on files the run already knew. An earlier attempt issued none: with no randomness, a wrong answer repeated as reliably as a right one.',
    from: ['cert2', 'cert'],
  },
  {
    title: 'Spark Open.',
    text: "Teaching ran 2 of its 3 registered rounds, as the Glimmer cap could not cover a third, and under the 16,384-token context 12 of the base harness's 60 attempts ended in an error, so that baseline is weaker than the earlier returns desk's. BaseTen's serving rests on probes, not a record per call.",
    from: ['open'],
  },
  {
    title: 'The returns desks.',
    text: `On the first returns desk, held to two rounds, the engineered harness passed ${firstReturns.engineered.passed} of ${TEST_SIZE} against ${firstReturns.base.passed}, with an interval that includes zero. Meeting the 95% target does not prove 95% reliability (${tab('returnsArms')}).`,
    from: ['first', 'second'],
  },
  {
    title: 'Not yet measured.',
    text: "Sweep desk's adapter has not taken a sealed final test, the local build has neither a certificate nor the adapter's test, cluster bundles are checked only against simulated schedulers, and counterexample repair only on stand-ins and practice data.",
    from: ['qlora2', 'adapterEval', 'cert2', 'scale'],
  },
  {
    title: 'Other desks.',
    text: `A budget stop or the counterexample check left Assay desk and Sweep desk on Spark's first draft, so their refinements are unmeasured. Assay desk's first run tied the base harness at 7 of 48 at Corvid Hill, and its second passed 14 against 5, and 16 against 8 under a second seed; Sweep desk passed ${SWEEP_RUN.taught} of ${SWEEP_RUN.tasks} against ${SWEEP_RUN.bare}. In an agent-team run, Assay desk's plate tool overflowed Glimmer's context, so no answer carried the plate list.`,
    from: ['assay', 'assay2', 'sweep2', 'team2'],
  },
  {
    title: 'The repair shop.',
    text: "It was the film's demo run, graded by a rule, with no report in docs/comparisons.",
    from: ['hackathon'],
  },
];

/** The headline figures under the abstract: a figure, then what it counts. */
const HEADLINE: readonly { figure: string; text: string }[] = [
  { figure: '24 to 43', text: 'of 48 at Harborview Prep, an academy never seen' },
  { figure: '4 to 27', text: 'of 32 at Corvid Hill Discovery, a lab never seen' },
  {
    figure: '32 of 32',
    text: 'at Corvid Hill Discovery with a LoRA adapter, against 22 of 30 without it',
  },
  {
    figure: `At most ${CERT2.stated}%`,
    text: `wrong when it answers, at ${CERT2.confidence}% confidence, on the first risk certificate`,
  },
];

export function ResultsPage() {
  const second = {
    engineered: arm(SECOND, ENGINEERED),
    base: arm(SECOND, BASE),
  };
  const open = {
    engineered: arm(OPEN, 'Glimmer on the Spark Open-engineered harness'),
    base: arm(OPEN, BASE),
    draft: arm(OPEN, "Spark Open's one-shot harness"),
  };
  const openOverDraft = found(OPEN.pairs[2], "Spark Open's rounds against its draft");
  const harborview = {
    academyDesk: found(FIELD_ARMS[2]?.groups[1], "Academy desk's Harborview result"),
    base: found(FIELD_ARMS[0]?.groups[1], "the base harness's Harborview result"),
    n: found(GROUPS[1], 'Harborview group').n,
  };
  const local = found(LOCAL_ROWS[3], 'local row for all groups');
  const corvid = {
    engineered: found(LAB_ARMS[2]?.groups[1], "Inventory desk's Corvid Hill result"),
    base: found(LAB_ARMS[0]?.groups[1], "the base harness's Corvid Hill result"),
    n: found(LAB_GROUPS[1], 'Corvid Hill group').n,
  };
  const tunedArm = found(ADAPTER_ARMS[3], 'Inventory desk with the adapter');
  const untunedArm = found(ADAPTER_ARMS[2], 'Inventory desk without the adapter');
  const tuned = found(tunedArm.groups[1], "the adapter's Corvid Hill result");
  const untuned = found(untunedArm.groups[1], 'the Corvid Hill result without the adapter');
  const adapterPrimary = found(ADAPTER_PAIRS[0], "the adapter's primary comparison");
  return (
    <div id="top">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:rounded-control focus:bg-primary focus:px-4 focus:py-2 focus:text-on-primary"
      >
        Skip to the content
      </a>
      <Header page="results" />
      <main id="main" className="pb-20 sm:pb-24">
        <section aria-labelledby="results-title" className="article pt-12 sm:pt-20">
          <h1 id="results-title" className="t-title">
            What teaching changed
          </h1>
          <p className="m-0 mt-4">Jake Kang, November 2026</p>
          <h2 className="t-h2 mt-16">Abstract</h2>
          <p className="t-read mt-4">
            Architect turns an organization&apos;s own material into a specialist that runs
            on-premise. A large model, Spark, engineers the harness of a small one, Glimmer: its
            instructions and small tools. A change is kept only when it helps on held-out checks
            whose tasks Spark never sees. On organizations neither model had seen, the
            Spark-engineered harness took Glimmer from 24 to 43 of 48 tasks at a test-prep academy
            and from 4 to 27 of 32 at a screening lab. On top of that lab&apos;s harness, a LoRA
            adapter trained on 22 of Glimmer&apos;s own checker-passed attempts took it to 32 of 32,
            against 22 of 30 without the adapter. Architect&apos;s first risk certificate held at an
            academy the specialist never trained on, and the whole pipeline also runs with both
            models on open weights.
          </p>
          <ul className="m-0 mt-16 grid list-none gap-x-8 gap-y-10 border-y border-line p-0 py-10 sm:grid-cols-2">
            {HEADLINE.map((item) => (
              <li key={item.figure} className="flex flex-col gap-3">
                <span className="t-title leading-none tabular-nums">{item.figure}</span>
                <span className="t-body text-pretty tabular-nums">{item.text}</span>
              </li>
            ))}
          </ul>
        </section>

        <Section id="method" number={sec('method')} title="How it works">
          <Text>
            A large model, Spark, teaches a small one, Glimmer, to do a job. Glimmer attempts
            practice tasks, Spark reads where the attempts went wrong, and Spark changes
            Glimmer&apos;s harness: the instructions and small tools it works with. A change is kept
            only if Glimmer then passes more held-out checks, whose tasks Spark never sees (
            {fig('round')}).
          </Text>
          <Text>
            Each comparison ends on a sealed final test. It stays closed until every harness is
            frozen, opens once, and is graded by a program rather than a model. Most comparisons set
            three harnesses side by side: the base harness Glimmer starts with, Spark&apos;s
            one-shot harness, written once and kept without a check, and the Spark-engineered
            harness, built over rounds of teaching.
          </Text>
          <Text>
            Once a harness works, Architect can also fine-tune Glimmer on its own verified attempts,
            and it can issue a risk certificate: a bound on how often the specialist is wrong when
            it answers.
          </Text>
          <Exhibit
            label={fig('round')}
            caption={
              <>
                A job&apos;s tasks, cut once into four sets, and the five steps of a round of
                teaching, with the counts of the returns desk in section {sec('returns')}
                <Cite to={['plan']} />. Learning from failures, and checking an agent by the state
                it leaves, both have published precedent
                <Cite to={['gepa', 'ace', 'taubench']} />.
              </>
            }
          >
            <RoundDiagram />
          </Exhibit>
        </Section>

        <Section id="field" number={sec('field')} title="Academy desk, at test-prep academies">
          <Text>
            When a student misses a practice question, staff ask Academy desk what to do, and it
            answers from the academy&apos;s own files. Spark taught it on three generated academies,
            and the test asks whether that teaching carries over to academies it never saw (
            {fig('fieldGroups')})
            <Cite to={['academyDesk']} />.
          </Text>
          <Headline figure={`${harborview.academyDesk.passed} of ${harborview.n}`}>
            tasks passed at Harborview Prep, an academy neither model had seen, against{' '}
            {harborview.base.passed} on the base harness
          </Headline>
          <Exhibit
            label={fig('fieldGroups')}
            caption={`Sealed final-test passes by harness in each group, with 95% intervals. The Real academy is a real tutoring academy's records, anonymized. Across all ${FIELD_TEST_SIZE} tasks Academy desk passed ${FIELD_ARMS[2]?.all.passed}, the base harness ${FIELD_ARMS[0]?.all.passed} and the one-shot harness ${FIELD_ARMS[1]?.all.passed}.`}
          >
            <div className="flex flex-col gap-8">
              {GROUPS.map((group, index) => (
                <GroupPassRates key={group.short} groups={GROUPS} arms={FIELD_ARMS} index={index} />
              ))}
            </div>
          </Exhibit>
          <Text>
            The rounds of teaching made the difference. Spark&apos;s one-shot harness, written once
            without seeing Glimmer try, stayed level with the base harness in every group, while
            Academy desk pulled far ahead of both on the taught academies and Harborview Prep (
            {fig('fieldPairs')})
            <Cite to={['academyDesk']} />.
          </Text>
          <Exhibit
            label={fig('fieldPairs')}
            caption={`How many more tasks Academy desk passed than each other harness at the taught academies and Harborview Prep, in percentage points, with 95% intervals. Every pairing, the Real academy's included, is in ${tab('fieldPairs')}.`}
          >
            <FieldPairForest />
          </Exhibit>
          <Text>
            At Harborview Prep, most of the gain came from assigning practice and the tutoring turn
            ({tab('fieldSkills')}). Spark kept two of its three changes: a question lookup tool, and
            a policy lookup tool that returns the numbers every skill needs ({tab('fieldRounds')})
            <Cite to={['academyDesk']} />.
          </Text>
          <Text>
            Academy desk also runs on-premise. Frozen as it was, it took the same test on the small
            Glimmer build that runs on one graphics card through Ollama, and passed {local.local} of{' '}
            {FIELD_TEST_SIZE}, against {local.hosted} hosted ({tab('local')})
            <Cite to={['local']} />.
          </Text>
          <Details
            method={
              <Text>
                The taught academies differ in topic labels, id formats, wording and policy numbers,
                and Harborview Prep uses a practice count, difficulty band and escalation rule that
                none of them uses. The sealed final test held 48 new tasks from the taught
                academies, 48 from Harborview Prep and 24 from the Real academy, whose records have
                no question text, so only diagnose, history and assign could be checked there. A
                program checks the facts and file changes, never the wording
                <Cite to={['academyDesk']} />.
              </Text>
            }
          >
            <TableExhibit
              label={tab('fieldPairs')}
              caption="Tasks the first harness passed and the second failed (won), the reverse (lost), and where they agreed. The two comparisons planned as primary are Academy desk against the base harness at Harborview Prep and at the Real academy. The base harness ran at temperature 1 with a 16-turn limit and low reasoning; the one-shot harness and Academy desk at temperature 0 with 30 turns and medium reasoning."
            >
              <GroupPairTable
                pairs={FIELD_PAIRS}
                name={groupName}
                label="Task by task, the field run"
              />
            </TableExhibit>
            <TableExhibit
              label={tab('fieldSkills')}
              caption="Passes by skill and organization, out of the tasks in each cell. The Real academy, a snapshot of 16 students, had no tasks for solve, hint and the tutoring turn."
            >
              <SkillTable />
            </TableExhibit>
            <TableExhibit
              label={tab('fieldRounds')}
              caption={`Each round of teaching for Academy desk: the change, held-out checks before and after, the same change measured again on new seeds, and the result. Teaching took about 15 minutes and cost 31 cents of Spark. The whole run cost about ${dollars(FIELD_MONEY.spark)} of Spark, including about 8 cents of estimates, and ${dollars(FIELD_MONEY.glimmer)} of hosted Glimmer.`}
            >
              <RoundList rounds={ROUNDS_FIELD} label="Rounds of teaching for Academy desk" />
            </TableExhibit>
            <TableExhibit
              label={tab('local')}
              caption={`Academy desk's final-test passes on the 2-bit build on this computer's 12 GB graphics card and hosted, with the tasks won and lost on this computer, and the difference with its 95% interval. The median task took ${LOCAL_SPEED.medianLocal} s here and ${LOCAL_SPEED.medianHosted} s hosted, the slowest 5% over ${LOCAL_SPEED.slowestLocal} s against ${LOCAL_SPEED.slowestHosted} s, and ${LOCAL_SPEED.stepLimitLocal} tasks reached the step limit here against ${LOCAL_SPEED.stepLimitHosted} hosted.`}
            >
              <LocalTable />
            </TableExhibit>
          </Details>
        </Section>

        <Section
          id="inventory"
          number={sec('inventory')}
          title="Inventory desk, at a screening lab"
        >
          <Text>
            The same loop works in a second field. Inventory desk runs a screening lab&apos;s
            compound store: scientists ask it how much of a compound is usable, which lot a re-test
            should draw from, and how to allocate and hold stock, and it works only from the
            lab&apos;s own files and policy ({fig('lab')})
            <Cite to={['inventory']} />.
          </Text>
          <Headline figure={`${corvid.engineered.passed} of ${corvid.n}`}>
            tasks passed at Corvid Hill Discovery, a lab sealed from both models whose stock rules
            no taught lab shares, against {corvid.base.passed} on the base harness
          </Headline>
          <Exhibit
            label={fig('lab')}
            caption={`Sealed final-test passes by harness at the taught labs and at Corvid Hill Discovery, with 95% intervals. Across all ${LAB_TEST_SIZE} tasks Inventory desk passed ${LAB_ARMS[2]?.all.passed}, Spark's one-shot harness ${LAB_ARMS[1]?.all.passed} and the base harness ${LAB_ARMS[0]?.all.passed}.`}
          >
            <div className="flex flex-col gap-8">
              {LAB_GROUPS.map((group, index) => (
                <GroupPassRates
                  key={group.short}
                  groups={LAB_GROUPS}
                  arms={LAB_ARMS}
                  index={index}
                />
              ))}
            </div>
          </Exhibit>
          <Text>
            Here Spark&apos;s first draft carried most of the gain. It wrote a stock-planning tool
            that reads each lab&apos;s own policy numbers, so it worked at a lab whose numbers it
            had never met, and the refinement rounds added a guard on tool-call format (
            {tab('labPairs')})
            <Cite to={['inventory']} />.
          </Text>
          <Details
            method={
              <Text>
                Spark studied three generated labs, each with its own units, date formats, lot names
                and policy numbers, and engineered the harness on them: a one-shot draft, then two
                refinement rounds. Then every harness was frozen, and the sealed final test opened
                once, with new tasks from the taught labs and from Corvid Hill Discovery
                <Cite to={['inventory']} />.
              </Text>
            }
          >
            <TableExhibit
              label={tab('labPairs')}
              caption="Tasks the first harness passed and the second failed (won), the reverse (lost), and where they agreed, with the difference in points and its 95% interval. The primary comparison is Inventory desk against the base harness at Corvid Hill Discovery. The base harness ran at temperature 1 with a 16-turn limit and low reasoning; the one-shot harness and Inventory desk at temperature 0 with 30 turns and high reasoning."
            >
              <GroupPairTable
                pairs={LAB_PAIRS}
                name={labGroupName}
                label="Task by task, the screening lab run"
              />
            </TableExhibit>
            <TableExhibit
              label={tab('labSkills')}
              caption={`Passes by skill and lab, out of the tasks in each cell. On the taught labs' ${LAB_RUN.checks} held-out checks, Spark's draft went from ${LAB_RUN.draftBefore} to ${LAB_RUN.draftAfter}; the first refinement round was reverted, and the second, kept, went from ${LAB_RUN.keptBefore} to ${LAB_RUN.keptAfter} of ${LAB_RUN.keptTotal} over two runs. The run cost ${dollars(LAB_RUN.spark)} of Spark as recorded, plus at most about ${dollars(LAB_RUN.sparkUnrecorded)} for a study call cut off before it was recorded, and ${dollars(LAB_RUN.glimmer)} of hosted Glimmer.`}
            >
              <LabSkillTable />
            </TableExhibit>
          </Details>
        </Section>

        <Section id="finetune" number={sec('finetune')} title="Fine-tuning Glimmer on its own work">
          <Text>
            A harness changes what Glimmer works with, and a fine-tune changes Glimmer itself.
            Architect trained a LoRA adapter on the work Inventory desk got right, then tested it at
            the same sealed lab with the harness held fixed ({fig('adapter')})
            <Cite to={['qlora1', 'adapterEval']} />.
          </Text>
          <Headline figure={`${tuned.passed} of ${tuned.of}`}>
            tasks passed at Corvid Hill Discovery with the adapter, against {untuned.passed} of the{' '}
            {untuned.of} it took without it
          </Headline>
          <Exhibit
            label={fig('adapter')}
            caption={`Sealed final-test passes with the adapter and without it, on Inventory desk's harness and on the base harness, out of the tasks each arm took, with 95% intervals. Across all tasks, Inventory desk passed ${tunedArm.all.passed} of ${tunedArm.all.of} with the adapter and ${untunedArm.all.passed} of ${untunedArm.all.of} without it.`}
          >
            <div className="flex flex-col gap-8">
              {LAB_GROUPS.map((group, index) => (
                <AdapterPassRates key={group.short} index={index} />
              ))}
            </div>
          </Exhibit>
          <Text>
            Task by task at Corvid Hill, the adapter won {adapterPrimary.wins} and lost none (
            {tab('adapterPairs')})
            <Cite to={['adapterEval']} />.
          </Text>
          <Text>
            With the adapter, Glimmer also answered faster: its median attempt took{' '}
            {tunedArm.p50.toFixed(1)} seconds, against {untunedArm.p50.toFixed(1)} without it (
            {tab('adapterArms')})
            <Cite to={['adapterEval']} />.
          </Text>
          <Text>
            Training cost {dollars(inventoryAdapter.usd)} on one rented A100 ({fig('loss')},{' '}
            {tab('adapters')}). The examples were Glimmer&apos;s own attempts at training tasks that
            the checker passed, and the export scanned every one for the sealed test and the sealed
            lab, so nothing sealed went in
            <Cite to={['qlora1']} />.
          </Text>
          <Details
            method={
              <Text>
                One deployment of Glimmer served each harness with the adapter and without it, on
                one A100 80 GB on a Hugging Face Inference Endpoint, by vLLM in bf16, for at most{' '}
                {dollars(ADAPTER_RUN.gpuUsd)} of GPU. Two of the base arm&apos;s Corvid Hill tasks
                never ran, because the endpoint paused when the account&apos;s prepaid credit ran
                out. The adapter passed both, so the interval stays above zero whichever way they
                are counted ({tab('adapterPairs')})
                <Cite to={['adapterEval']} />.
              </Text>
            }
          >
            <TableExhibit
              label={tab('adapterPairs')}
              caption={`Tasks the arm with the adapter passed and the arm without it failed (won), the reverse (lost), and where they agreed, with the difference in points and its 95% interval. The primary comparison is Inventory desk at Corvid Hill Discovery. With the two tasks the base arm never took counted, the difference there is ${signed(ADAPTER_RUN.ifPassed.diff)} (${interval(ADAPTER_RUN.ifPassed)}) if it had passed both and ${signed(ADAPTER_RUN.ifFailed.diff)} (${interval(ADAPTER_RUN.ifFailed)}) if it had failed both.`}
            >
              <GroupPairTable
                pairs={ADAPTER_PAIRS}
                name={labGroupName}
                label="Task by task, with the adapter against without it"
              />
            </TableExhibit>
            <TableExhibit
              label={tab('adapterArms')}
              caption={`Each arm's passes out of the tasks it took, its output tokens a call, reasoning included, and its median seconds an attempt, with the 95th percentile. Each lab's intervals are in ${fig('adapter')}. The four arms shared one GPU, so the seconds compare them with each other only.`}
            >
              <AdapterArmTable />
            </TableExhibit>
            <Panel
              label={fig('loss')}
              caption={`Training loss at each optimizer step of Inventory desk's QLoRA run, on ${inventoryAdapter.examples} examples. The examples are Glimmer's own successes, so the loss starts low. Five of the six steps were warmup, so the learning rate reached its peak, 1e-4, only at the last.`}
            >
              <LossFigure />
            </Panel>
            <TableExhibit
              label={tab('adapters')}
              caption={`Both QLoRA adapters of Glimmer, each trained in 4 bits on one A100 80 GB on Hugging Face Jobs. Sweep desk's had ${sweepAdapter.examples} examples, so it took ${sweepAdapter.steps} optimizer steps. The checks are at the file level; no model was loaded.`}
            >
              <AdapterTable />
            </TableExhibit>
          </Details>
        </Section>

        <Section id="certified" number={sec('certified')} title="A risk certificate">
          <Text>
            A specialist should know when not to answer. Academy desk tries each request{' '}
            {CERT2.attempts} times and answers only when enough attempts agree, handing the rest to
            staff, and its certificate bounds how often it is wrong when it does answer (
            {fig('certificate')})
            <Cite to={['cert2']} />.
          </Text>
          <Headline figure={`At most ${CERT2.stated}%`}>
            of the requests it answers are wrong, with {CERT2.confidence}% confidence, as
            Architect&apos;s first certificate states
          </Headline>
          <Exhibit
            label={fig('certificate')}
            caption={`The certificate as the app states it, and its check at Harborview Prep. The bound is the one-sided ${CERT2.confidence}% upper bound on 0 wrong of ${CERT2.calibration} calibration tasks answered, ${CERT2.bound}%, against a ${CERT2.target}% target.`}
          >
            <CertificateFigure />
          </Exhibit>
          <Text>
            It held at Harborview Prep, which it never trained on: it answered {CERT2.checkAnswered}{' '}
            of {CERT2.checkTasks} sealed requests there and got none wrong ({tab('certCheck')})
            <Cite to={['cert2']} />.
          </Text>
          <Text>
            When a tool Spark wrote fails on practice data, Architect shrinks the failing case by
            delta debugging
            <Cite to={['zeller']} /> and keeps it as a regression test
            <Cite to={['certify']} />. On one generated academy, a question lookup&apos;s failing
            case shrank from 2,312 rows to 4
            <Cite to={['decisions']} />.
          </Text>
          <Details
            method={
              <Text>
                Architect picks the loosest agreement level whose exact upper bound on error, at{' '}
                {CERT2.confidence}% confidence, stays under the {CERT2.target}% target, following
                conformal risk control, Learn-then-Test and conformal abstention
                <Cite to={['crc', 'ltt', 'abstention']} />. If no level qualifies, no certificate is
                issued. Calibration used {CERT2.calibration} tasks from the taught academies; with
                no error, {CERT2.calibration} tasks can certify no lower than {CERT2.bound}%. On its
                own, {CERT2.checkWrong} wrong of {CERT2.checkAnswered} at Harborview Prep has a
                bound of {CERT2.checkBound}%.
              </Text>
            }
          >
            <TableExhibit
              label={tab('certCalibration')}
              caption={`The certificate run on ${CERT2.calibration} calibration tasks from the taught academies, ${CERT2.attempts} attempts each. For each agreement threshold: the tasks Academy desk would answer, how many were wrong, the share handed to staff, and the one-sided ${CERT2.confidence}% upper bound on the error rate among answered tasks. The run made ${CERT2.runs} attempts for ${dollars(CERT2.usd)} of hosted Glimmer, by the engine's own count.`}
            >
              <CertCalibrationTable />
            </TableExhibit>
            <TableExhibit
              label={tab('certCheck')}
              caption={`The check at Harborview Prep, ${CERT2.checkTasks} sealed tasks: answered, wrong and handed off at each threshold. The certified threshold answers when 1 or more of ${CERT2.attempts} attempts give an answer.`}
            >
              <CertCheckTable />
            </TableExhibit>
          </Details>
        </Section>

        <Section id="open" number={sec('open')} title="An open-weight teacher">
          <Text>
            The teacher can be an open-weight model. Muse Spark Open, served by BaseTen, engineered
            Glimmer&apos;s harness for the returns desk of section {sec('returns')}, with the same
            split and the same sealed final test ({fig('open')})
            <Cite to={['open']} />.
          </Text>
          <Headline figure={`${open.base.passed} to ${open.engineered.passed}`}>
            of {TEST_SIZE} requests passed on the sealed final test, with the harness Spark Open
            engineered
          </Headline>
          <Exhibit
            label={fig('open')}
            caption={`Sealed final-test passes by harness on the returns desk taught by Spark Open, with 95% intervals. Spark Open's one-shot harness passed ${open.draft.passed} of ${TEST_SIZE}.`}
          >
            <PassRates comparison={OPEN} target={false} />
          </Exhibit>
          <Text>
            Its rounds built on its own first draft: the engineered harness won {openOverDraft.wins}{' '}
            requests against Spark Open&apos;s one-shot harness and lost none ({tab('openPairs')})
            <Cite to={['open']} />.
          </Text>
          <Details
            method={
              <Text>
                Every arm ran under Glimmer&apos;s on-device context of 16,384 tokens, the limit of
                the build that runs on-premise, so this run stands on its own and is not set against
                the earlier returns desk runs
                <Cite to={['open']} />.
              </Text>
            }
          >
            <TableExhibit
              label={tab('openArms')}
              caption={`Passes by kind of request, of ${PER_TYPE} each, and in all, of ${TEST_SIZE}, with 95% intervals. Spark Open made a one-shot draft and one refinement round, "Fix email normalization and stop wasteful CSV reads".`}
            >
              <ArmTable comparison={OPEN} />
            </TableExhibit>
            <TableExhibit
              label={tab('openPairs')}
              caption={`Requests each harness passed and the other failed (won), the reverse (lost), where they agreed, and the difference in points with its 95% interval. The base harness ran at temperature 1 with 16 turns and low reasoning, the other two at temperature 0.2 with 20 turns and medium reasoning. The run cost ${dollars(OPEN_MONEY.sparkOpen)} of Spark Open and ${dollars(OPEN_MONEY.glimmer)} of hosted Glimmer.`}
            >
              <PairTable comparison={OPEN} />
            </TableExhibit>
          </Details>
        </Section>

        <Section id="scale" number={sec('scale')} title="From a specialist to a field model">
          <Text>
            Run the same loop over many organizations in one field, and it leaves what a model built
            for that field needs: verified lessons and checkable rewards
            <Cite to={['scale']} />.
          </Text>
          <Text>
            A field&apos;s work leaves three things besides the specialist. Verified demonstrations
            are worked examples from training tasks that the checker confirmed. An outcome scorer
            lets an outside training framework ask for a score. Sealed evaluations are organizations
            a model never trained on, opened once for a frozen candidate
            <Cite to={['scale']} />.
          </Text>
          <Text>
            From a model&apos;s configuration on Hugging Face, Architect sizes a LoRA or QLoRA
            fine-tuning job and writes a launch bundle for a Slurm or Kubernetes cluster, for you to
            run with your own tools. It never holds cluster credentials ({tab('scale')})
            <Cite to={['scale']} />.
          </Text>
          <Details>
            <TableExhibit
              label={tab('scale')}
              caption="Each part of the path from a specialist to a field model, by whether it is measured, built or unverified."
            >
              <Table
                label="What is measured, built and unverified on the path to a field model"
                left={[0, 1, 2]}
                columns={['Part', 'Status', 'What backs it']}
                rows={SCALE_STATUS.map(([part, status, backing]) => [part, status, backing])}
              />
            </TableExhibit>
          </Details>
        </Section>

        <Section id="returns" number={sec('returns')} title="An earlier run: a returns desk">
          <Text>
            Before the fields, Architect was tried on one job: a returns desk for a made-up shop,
            handling refunds, order questions and pickups ({fig('returns')})
            <Cite to={['second']} />.
          </Text>
          <Headline figure={`${second.base.passed} to ${second.engineered.passed}`}>
            of {TEST_SIZE} requests passed on the sealed final test after four rounds, meeting the
            job&apos;s 95% target
          </Headline>
          <Exhibit
            label={fig('returns')}
            caption="Sealed final-test passes by harness on the returns desk that ships with the app, with 95% intervals. The dashed line is the job's target."
          >
            <PassRates comparison={SECOND} />
          </Exhibit>
          <Text>
            The engineered harness also answered faster, with a median of{' '}
            {second.engineered.p50.toFixed(1)} seconds against {second.base.p50.toFixed(1)} on the
            base harness ({fig('speed')})
            <Cite to={['second']} />.
          </Text>
          <Exhibit
            label={fig('speed')}
            caption="Time to answer on the returns desk. The dot is the median answer; the line runs to the slowest 5%."
          >
            <Forest
              name="Median and slowest 5% of answer times, by harness"
              rows={SECOND.arms.map((each) => ({
                label: armLabel(each),
                value: each.p50,
                low: each.p50,
                high: each.p95,
                tone: each.tone,
                figure: (
                  <span className="whitespace-nowrap">
                    <span className="font-display text-h2 font-semibold">
                      {each.p50.toFixed(1)} s
                    </span>
                    <span className="t-body ml-2">to {each.p95.toFixed(1)} s</span>
                  </span>
                ),
                summary: `${each.name}: typical answer ${each.p50} seconds, about 95 percent within ${each.p95}, the slowest 5 percent longer.`,
              }))}
              min={0}
              max={60}
              figureWidth="10.5rem"
              ticks={[0, 15, 30, 45, 60]}
              formatTick={(value) => `${value} s`}
            />
          </Exhibit>
          <Text>
            On a second kind of job, a repair shop&apos;s ticket costs, the film&apos;s demo run
            needed one round, and Glimmer then passed all {REPAIR.finalTotal} of its final-test
            tasks ({tab('costs')})
            <Cite to={['hackathon']} />.
          </Text>
          <Details
            method={
              <Text>
                A change was kept only if it clearly raised passes on held-out checks, measured
                twice, and cost no kind of task more than one pass. The comparison&apos;s plan was
                published before it ran
                <Cite to={['plan', 'second']} />.
              </Text>
            }
          >
            <TableExhibit
              label={tab('returnsArms')}
              caption={`Passes by kind of request, of ${PER_TYPE} each, and in all, of ${TEST_SIZE}, with 95% intervals.`}
            >
              <ArmTable comparison={SECOND} />
            </TableExhibit>
            <TableExhibit
              label={tab('returnsPairs')}
              caption="Requests each harness passed and the other failed (won), the reverse (lost), where they agreed, and the difference in points with its 95% interval."
            >
              <PairTable comparison={SECOND} />
            </TableExhibit>
            <TableExhibit
              label={tab('returnsRounds')}
              caption="Each round: the change, held-out checks before and after, the same change measured again on new seeds, and the result. Teaching stopped when the target was reached."
            >
              <RoundList rounds={ROUNDS_SECOND} label="Rounds of teaching on the returns desk" />
            </TableExhibit>
            <TableExhibit
              label={tab('costs')}
              caption={`What each harness cost on the returns desk. On the repair shop's demo run, one round took Glimmer from ${REPAIR.checkBefore} to ${REPAIR.checkAfter} of ${REPAIR.checkTotal} held-out checks, and it passed ${REPAIR.finalPassed} of ${REPAIR.finalTotal} on its final test for ${REPAIR.cents} cents in all.`}
            >
              <Table
                fit
                label="What each harness cost on the returns desk"
                columns={['', 'Spark', 'Glimmer, hosted']}
                rows={SECOND.arms.map((each) => [
                  armLabel(each),
                  dollars(each.spark),
                  each.glimmer === null ? '' : dollars(each.glimmer),
                ])}
              />
            </TableExhibit>
          </Details>
        </Section>

        <Section id="limits" number={sec('limits')} title="Limitations">
          {LIMITS.map((limit) => (
            <Text key={limit.title}>
              <span className="font-semibold">{limit.title}</span> {limit.text.replace(/\.$/, '')}
              <Cite to={limit.from} />.
            </Text>
          ))}
        </Section>

        <section
          id="references"
          aria-labelledby="references-title"
          className="article flex scroll-mt-20 flex-col gap-6 pt-20 sm:pt-28"
        >
          <h2 id="references-title" className="t-h1">
            References
          </h2>
          <ol className="t-small m-0 flex list-none flex-col gap-4 p-0">
            {REFERENCES.map((reference, index) => (
              <li
                key={reference.key}
                id={`ref-${reference.key}`}
                className="grid scroll-mt-24 grid-cols-[2.5rem_minmax(0,1fr)]"
              >
                <span className="tabular-nums">[{index + 1}]</span>
                <span className="flex flex-col">
                  <span className="text-pretty">{reference.what}</span>
                  {PAPERS[reference.key] === undefined ? (
                    <a
                      className="link-quiet underline [overflow-wrap:anywhere]"
                      href={sourceUrl(reference.key as SourceKey)}
                    >
                      {SOURCES[reference.key as SourceKey].path}
                    </a>
                  ) : (
                    <span>{PAPERS[reference.key]}</span>
                  )}
                </span>
              </li>
            ))}
          </ol>
          <a className="link-quiet inline-flex items-center gap-2" href={REPORTS}>
            The full reports on GitHub
            <ArrowUpRight size={16} strokeWidth={1.8} aria-hidden />
          </a>
        </section>
      </main>
      <Footer page="results" />
    </div>
  );
}
