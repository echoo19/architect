import { Fragment, type ReactNode } from 'react';
import { ArrowUpRight, ChevronRight } from 'lucide-react';
import { REPORTS } from './content';
import {
  ADAPTERS,
  CERT,
  CERT_ROWS,
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
  ROUNDS_FIRST,
  ROUNDS_SECOND,
  SECOND,
  SKILL_ROWS,
  SKILLS,
  sourceUrl,
  SOURCES,
  SWEEP_RUN,
  TARGET_PASSES,
  TEST_SIZE,
  THIRD_MONEY,
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
 * The results page, set out as a short paper: a title and an abstract, numbered sections, numbered
 * figures, and numbered tables folded under each section's figures, with numbered references to
 * the documents they come from. Every number is in `evidence.ts`, with the document it comes from.
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
  { key: 'academyDesk', what: "The Academy desk run's report." },
  { key: 'local', what: "The Academy desk's check on the build that runs on one graphics card." },
  { key: 'third', what: 'The third Academy desk run.' },
  { key: 'thirdMisses', what: "Why the third run's Academy desk missed, checked after the test." },
  { key: 'inventory', what: "Inventory desk's run, at a screening lab's compound store." },
  { key: 'open', what: 'The returns desk taught by Muse Spark Open, on open weights.' },
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
  { key: 'cert2', what: 'The second live certificate run, which issued the first certificate.' },
  { key: 'cert', what: "The first live certificate run, on the third run's Academy desk." },
  { key: 'zeller', what: 'Simplifying and isolating failure-inducing input (delta debugging).' },
  { key: 'certify', what: 'The plan for certified answers and counterexample-guided repair.' },
  { key: 'plan', what: "The second comparison's plan, published before it ran." },
  { key: 'second', what: "The second comparison's report." },
  { key: 'gepa', what: 'GEPA: improving prompts from failures by reflection.' },
  { key: 'ace', what: 'ACE: agents that grow their own context from experience.' },
  { key: 'taubench', what: 'tau-bench: checking an agent by the final state of its work.' },
  { key: 'first', what: "The first comparison's report." },
  { key: 'hackathon', what: "The repair shop's run." },
  { key: 'scale', what: 'The plan for going from a specialist to a field model.' },
  { key: 'qlora1', what: "The first fine-tune: Inventory desk's work as a QLoRA adapter." },
  { key: 'qlora2', what: "The second fine-tune: Sweep desk's work as a QLoRA adapter." },
  { key: 'assay', what: "Assay desk's first run, at a screening lab's plate reader." },
  { key: 'sweep2', what: "Sweep desk's second run, at ML research groups' training runs." },
];

/**
 * Sections, figures and tables take their numbers from their place in these lists, so a section
 * added later takes its place in them and everything after it renumbers.
 */
const SECTIONS = [
  'field',
  'inventory',
  'open',
  'certified',
  'results',
  'scale',
  'finetune',
  'limits',
] as const;
const FIGURES = [
  'fieldGroups',
  'fieldPairs',
  'lab',
  'open',
  'certificate',
  'round',
  'returns',
  'speed',
  'loss',
] as const;
const TABLES = [
  'fieldSkills',
  'fieldPairs',
  'fieldRounds',
  'local',
  'third',
  'labPairs',
  'labSkills',
  'openArms',
  'openPairs',
  'certCalibration',
  'certCheck',
  'certFirst',
  'returnsArms',
  'returnsPairs',
  'firstArms',
  'firstPairs',
  'returnsRounds',
  'firstRounds',
  'costs',
  'scale',
  'adapters',
] as const;

const sec = (key: (typeof SECTIONS)[number]) => SECTIONS.indexOf(key) + 1;
const fig = (key: (typeof FIGURES)[number]) => `Figure ${FIGURES.indexOf(key) + 1}`;
const tab = (key: (typeof TABLES)[number]) => `Table ${TABLES.indexOf(key) + 1}`;

/** Numbered citations, each a link to its entry in the references. */
function Cite({ to }: { to: readonly RefKey[] }) {
  return (
    <span className="whitespace-nowrap tabular-nums">
      {' ['}
      {to.map((key, index) => (
        <Fragment key={key}>
          {index > 0 && ', '}
          <a className="link-quiet" href={`#ref-${key}`}>
            {REFERENCES.findIndex((reference) => reference.key === key) + 1}
          </a>
        </Fragment>
      ))}
      ]
    </span>
  );
}

/** A figure in its own panel, with its number and caption under it, as a paper sets it. */
function Exhibit({
  label,
  caption,
  children,
}: {
  label: string;
  caption: ReactNode;
  children: ReactNode;
}) {
  return (
    <Reveal className="exhibit my-6">
      <figure className="m-0 flex flex-col gap-6 rounded-card bg-card px-8 py-7 shadow-edge max-sm:px-4 max-sm:py-5">
        {children}
        <figcaption className="t-small text-pretty">
          <span className="font-semibold">{label}.</span> {caption}
        </figcaption>
      </figure>
    </Reveal>
  );
}

/** A table with its number and caption over it, as a paper sets it, inside a section's tables. */
function TableExhibit({
  label,
  caption,
  children,
}: {
  label: string;
  caption: ReactNode;
  children: ReactNode;
}) {
  return (
    <figure className="m-0 flex flex-col gap-6 rounded-card bg-card px-8 py-7 shadow-edge max-sm:px-4 max-sm:py-5">
      <figcaption className="t-small text-pretty">
        <span className="font-semibold">{label}.</span> {caption}
      </figcaption>
      {children}
    </figure>
  );
}

/** A section's tables, folded under one line until a reader opens them. */
function Tables({ label, children }: { label: string; children: ReactNode }) {
  return (
    <details className="tables">
      <summary className="link-quiet inline-flex cursor-pointer items-center gap-2 font-medium">
        <ChevronRight className="tables-chevron" size={16} strokeWidth={1.8} aria-hidden />
        {label}
      </summary>
      <div className="exhibit flex flex-col gap-6 pt-6">{children}</div>
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

function Subsection({ number, title }: { number: string; title: string }) {
  return (
    <h3 className="t-h2 hang mt-6">
      <span className="sec-num">{number}</span>
      {title}
    </h3>
  );
}

function Text({ children }: { children: ReactNode }) {
  return <p className="t-read">{children}</p>;
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

/** The pass rate of each arm on the final test, with its 95% interval. */
function PassRates({ comparison }: { comparison: Comparison }) {
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
      target={{ at: 95, label: `The job's target: 95%, which is ${TARGET_PASSES} of ${TEST_SIZE}` }}
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

/** Academy desk against each other arm, group by group: the difference in points with its interval. */
function FieldPairForest() {
  const shown = FIELD_PAIRS.filter(
    (each) => each.label.startsWith('Academy desk') && each.group !== 'all',
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
      min={-40}
      max={70}
      ticks={[-40, -20, 0, 20, 40, 60]}
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

/** The third run's passes for both harnesses, group by group, with the paired difference. */
function ThirdTable() {
  const rate = (result: { passed: number; low: number; high: number }, n: number) =>
    `${result.passed} of ${n} (${result.low.toFixed(1)} to ${result.high.toFixed(1)})`;
  return (
    <Table
      label="The third run: the base harness and Academy desk on the same final-test tasks"
      columns={['Group', 'Base harness', 'Academy desk', 'Won', 'Lost', 'Difference, 95% interval']}
      rows={THIRD_ROWS.map((row) => [
        `${row.name} (${row.n})`,
        rate(row.bare, row.n),
        rate(row.academyDesk, row.n),
        row.wins,
        row.losses,
        `${signed(row.diff)}, ${interval(row)}`,
      ])}
    />
  );
}

/** The first live certificate run's risk and coverage, with the same thresholds on the Real academy. */
function CertTable() {
  return (
    <Table
      label="The first live certificate run: risk and coverage by agreement threshold"
      columns={[
        'Answers when',
        'Answered',
        'Wrong',
        'Handed off',
        'Upper bound',
        'Real academy, answered',
        'Real academy, wrong',
      ]}
      rows={CERT_ROWS.map((row) => [
        row.when,
        `${row.answered} of ${CERT.calibration}`,
        row.wrong,
        `${row.handedOff}%`,
        `${row.bound.toFixed(1)}%`,
        `${row.realAnswered} of ${CERT.checkTasks}`,
        row.realWrong,
      ])}
    />
  );
}

/** The certificate as the app states it, and the check on an academy it never trained on. */
function CertificateFigure() {
  const items: readonly { figure: string; text: string }[] = [
    { figure: `${CERT2.stated}% at most`, text: 'wrong when it answers' },
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
          <span className="t-small text-pretty">{item.text}</span>
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

/** What is measured, what is built and tested on stand-ins, and what has not been done. */
const SCALE_STATUS: readonly (readonly [string, string, string])[] = [
  [
    'Harnesses engineered for a field',
    'Measured',
    `Two Academy desk runs and an Inventory desk run, with sealed organizations, each under one seed (sections ${sec('field')} and ${sec('inventory')}).`,
  ],
  [
    'Export of verified demonstrations and an outcome scorer',
    'Built',
    'The export fed both fine-tunes. Nothing from a sealed organization goes in.',
  ],
  [
    "Training plans sized from a model's configuration",
    'Built',
    'The memory terms are estimates, shown with their arithmetic.',
  ],
  [
    'Cluster launch bundles for Slurm and Kubernetes',
    'Built, experimental',
    'Checked structurally and against simulated schedulers. Run by you, with your own tools.',
  ],
  [
    'LoRA and QLoRA fine-tuning on one rented GPU',
    'Run, effect not measured',
    `Two QLoRA adapters of Glimmer trained for real on Hugging Face Jobs, each on one A100, and checked against the base (section ${sec('finetune')}).`,
  ],
  ['Cluster execution and training gains', 'Unverified', 'No cluster job has run.'],
  [
    'A model trained on a field',
    'Run, effect not measured',
    "Glimmer with a QLoRA adapter trained on Inventory desk's verified work. Its effect on the sealed final test is measured next.",
  ],
];

const LIMITS: readonly { title: string; text: string; from: SourceKey }[] = [
  {
    title: 'One seed, mostly hosted Glimmer, for the Academy desk.',
    text: "Every Academy desk figure comes from one seed, the number that fixes a run's chance choices, and all but section 1.5 from hosted Glimmer; a second declared seed was not run.",
    from: 'academyDesk',
  },
  {
    title: 'The local check covers one harness.',
    text: 'Only Academy desk ran on this computer, because the base harness ran out of memory early, so the check says nothing about Glimmer on the base harness here.',
    from: 'local',
  },
  {
    title: 'A small real sample.',
    text: 'The real academy gave only 24 tasks in the first run and 30 in the third, many sharing students and files, and its records have no question text, so a gain there is not yet confirmed.',
    from: 'academyDesk',
  },
  {
    title: "The third run's real academy assign tasks could not be passed.",
    text: 'The empty assignments file never said how to number the first row, so both harnesses failed every one, and in the same run the one-shot harness was not tested and Academy desk spent about three times what the base harness did.',
    from: 'third',
  },
  {
    title: 'The third run reused its tasks.',
    text: 'It reused the 126 tasks of the second run, which had released its tests and recorded two attempts per arm before it stopped; nobody opened them.',
    from: 'third',
  },
  {
    title: 'A policy in the expected layout.',
    text: "The real academy's drafted policy used the table layout the generated academies' helper expected, so a policy in an academy's own layout was not tried.",
    from: 'academyDesk',
  },
  {
    title: 'A policy written for the test.',
    text: "The real academy's policy was drafted for this test and awaits the academy's confirmation, and some of its numbers came from the generated academies, so it tests transfer less strictly than Harborview Prep.",
    from: 'academyDesk',
  },
  {
    title: 'Settings differ by harness.',
    text: `The harnesses ran with different temperatures, turn limits and reasoning levels (${tab('fieldPairs')}, ${tab('labPairs')} and ${tab('openPairs')}), so each row compares a whole configuration.`,
    from: 'academyDesk',
  },
  {
    title: 'A scripted study and a patched runner.',
    text: 'A script, not a person, confirmed the study brief, and the first academy run used a patched copy of the runner outside the repository. Spark Open ran on an unchanged checkout, and the second certificate on unchanged release 0.8.0.',
    from: 'academyDesk',
  },
  {
    title: 'Inventory desk: one seed, generated labs, hosted Glimmer.',
    text: "Every figure is one run under one seed, on four labs from one generator and on hosted Glimmer, so a difference of a few tasks between the one-shot and the Spark-engineered harness is within what reruns could move. Inventory desk used about 3.6 times the base harness's student spend, a script confirmed its study brief, and the run raised the study's output limit and set the Spark-engineered arm's Spark cap in memory.",
    from: 'inventory',
  },
  {
    title: 'Spark Open: two rounds and a stricter context.',
    text: "Teaching ran 2 of the 3 registered rounds, because the arm's Glimmer cap could not cover another. Under the 16,384-token context, 12 of the base harness's 60 final attempts ended in an error, most likely turns that no longer fit, so its baseline is weaker than the earlier returns desk's. It ran under one seed on hosted Glimmer, and BaseTen's serving rests on probes and a no-fallback pin, not on a record per call.",
    from: 'open',
  },
  {
    title: 'Two desks of one kind.',
    text: 'Both returns desks are for a made-up shop from the same generator, so they test one kind of job, not other businesses.',
    from: 'plan',
  },
  {
    title: 'Unequal budgets on the returns desks.',
    text: 'In both returns comparisons the arms had different budgets, so each row compares a harness together with what it was allowed to spend.',
    from: 'second',
  },
  {
    title: 'One seed for the returns desks.',
    text: 'Each returns desk final test ran under one seed with a second declared seed not run, and the student refining its own harness was not one of the harnesses compared.',
    from: 'second',
  },
  {
    title: 'Glimmer served online.',
    text: 'The returns desk figures come from Glimmer served online, not the build on your computer, and none of these agents has trained weights.',
    from: 'second',
  },
  {
    title: 'A target met is not proof.',
    text: `Meeting the 95% target on the final test does not prove 95% reliability, since its interval reaches well below that (${tab('returnsArms')}), and only the final test is claimed because gains seen while teaching lean upward.`,
    from: 'second',
  },
  {
    title: 'The certificate covers three skills, on generated academies.',
    text: 'It covers diagnose, history and assign, the skills that can be built from records, and the real academy was not checked. With no errors, 60 calibration tasks can certify no lower than 4.87%. Its five attempts at temperature 0 differ only through the provider, and it ran on hosted Glimmer without a forced provider pin.',
    from: 'cert2',
  },
  {
    title: 'Calibration on known files.',
    text: `The certificate's calibration tasks are new student and topic pairs on files the run already knew, and leaving out the pairs it had used may tilt the draw. Its $${CERT2.usd.toFixed(2)} is the engine's own count, and the local build was not certified.`,
    from: 'cert2',
  },
  {
    title: 'The earlier certificate attempt.',
    text: 'Its five attempts ran with no randomness, which makes agreement a weak signal, a counting flaw was fixed only after it, and counterexample repair is tested only on stand-ins and practice data.',
    from: 'cert',
  },
  {
    title: 'Assay desk measured its draft.',
    text: "Its first run's Spark-engineered arm never ran a refinement, because its budget stopped the round, so it measured the one-shot draft. At Corvid Hill that arm and the base harness each passed 7 of 48, on labs that are all generated. A second run is registered.",
    from: 'assay',
  },
  {
    title: "Sweep desk's rounds were not measured.",
    text: `The teacher's budget stopped its refinement rounds after one call, so its taught arm ran on the one-shot draft; on all ${SWEEP_RUN.tasks} tasks it passed ${SWEEP_RUN.taught} against ${SWEEP_RUN.bare} for the base harness.`,
    from: 'sweep2',
  },
  {
    title: 'The fine-tunes ran on one GPU, and their effect is not measured.',
    text: "Both QLoRA adapters trained on one A100 and passed their checks against the base at the file level, but neither has been run on a sealed final test, and Inventory desk's 22 examples are Glimmer's own successes, so its low loss is expected, not evidence. Cluster launch bundles are checked only for structure and against simulated schedulers.",
    from: 'qlora1',
  },
  {
    title: 'The repair shop ran once.',
    text: 'It was a single run, not a planned comparison, and a rule graded it.',
    from: 'hackathon',
  },
];

/** The headline figures under the abstract: a figure, then what it counts. */
const HEADLINE: readonly { figure: string; text: string }[] = [
  { figure: '24 to 43', text: 'of 48 · Harborview Prep, an academy never seen' },
  { figure: '4 to 27', text: 'of 32 · Corvid Hill Discovery, a lab never seen' },
  {
    figure: `${CERT2.stated}% at most`,
    text: `wrong when it answers, at ${CERT2.confidence}% confidence · the first risk certificate`,
  },
];

const ENGINEERED = 'Glimmer on the Spark-engineered harness';
const BASE = 'Glimmer on the base harness';

export function ResultsPage() {
  const second = {
    engineered: arm(SECOND, ENGINEERED),
    base: arm(SECOND, BASE),
  };
  const first = {
    engineered: arm(FIRST, ENGINEERED),
    base: arm(FIRST, BASE),
  };
  const open = {
    engineered: arm(OPEN, 'Glimmer on the Spark Open-engineered harness'),
    base: arm(OPEN, BASE),
    draft: arm(OPEN, "Spark Open's one-shot harness"),
  };
  const local = found(LOCAL_ROWS[3], 'local row for all groups');
  const juniper = found(THIRD_ROWS[1], 'third-run row for Juniper Study House');
  const real = found(THIRD_ROWS[2], 'third-run row for the Real academy');
  const corvid = {
    engineered: found(LAB_ARMS[2]?.groups[1], "Inventory desk's Corvid Hill result"),
    base: found(LAB_ARMS[0]?.groups[1], "the base harness's Corvid Hill result"),
  };
  const corvidSize = found(LAB_GROUPS[1], 'Corvid Hill group').n;
  const inventoryAdapter = found(ADAPTERS[0], "Inventory desk's adapter");
  const sweepAdapter = found(ADAPTERS[1], "Sweep desk's adapter");
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
          <p className="m-0 mt-4">Jake Kang · November 2026</p>
          <h2 className="t-h2 mt-16">Abstract</h2>
          <p className="t-read mt-4">
            Architect is an R&amp;D platform that turns an organization&apos;s own material into a
            specialist that runs on-premise. A large model, Spark, engineers the harness of a small
            one, Glimmer: its instructions and small tools, with a change kept only when it helps on
            held-out checks Spark never sees. On organizations neither model had seen, the
            Spark-engineered harness took Glimmer from 24 to 43 of 48 tasks at a test-prep academy
            and from 4 to 27 of 32 at a screening lab. The same pipeline runs on Meta&apos;s open
            weights, and its first risk certificate held at an academy the specialist never trained
            on.
          </p>
          <ul className="m-0 mt-16 grid list-none gap-x-8 gap-y-10 border-y border-line p-0 py-10 sm:grid-cols-3">
            {HEADLINE.map((item) => (
              <li key={item.figure} className="flex flex-col gap-3">
                <span className="t-title leading-none tabular-nums">{item.figure}</span>
                <span className="t-small text-pretty tabular-nums">{item.text}</span>
              </li>
            ))}
          </ul>
        </section>

        <Section
          id="field"
          number={sec('field')}
          title="An operations agent for test-prep academies"
        >
          <Subsection number="1.1" title="The run" />
          <Text>
            Academy desk is Glimmer on the harness Spark engineered for it: instructions and small
            tools. When a student misses a practice question, staff ask it what to do. It answers
            from the academy&apos;s own files: topic labels, question bank, practice tests, answers,
            hints, videos and tutoring policy. A program checks the facts and file changes, never
            the wording
            <Cite to={['academyDesk']} />.
          </Text>
          <Text>
            Spark engineered the harness over three rounds on three generated academies. Each one
            differs in labels, id formats, wording and policy numbers. Then everything was frozen,
            and a sealed final test was opened once. It held new tasks from the taught academies,
            tasks from Harborview Prep, a generated academy neither model had seen, and tasks from a
            real tutoring academy, anonymized. The real academy&apos;s records have no question
            text, so only diagnose, history and assign could be checked there. Three harnesses took
            the test: the base harness Glimmer starts from, Spark&apos;s one-shot harness (written
            once and kept without a check), and the Spark-engineered harness, which is Academy desk
            <Cite to={['academyDesk']} />.
          </Text>

          <Subsection number="1.2" title="Final-test results" />
          <Text>
            Across all {FIELD_TEST_SIZE} tasks, Academy desk passed {FIELD_ARMS[2]?.all.passed},
            against {FIELD_ARMS[0]?.all.passed} for the base harness ({fig('fieldGroups')}).
          </Text>
          <Exhibit
            label={fig('fieldGroups')}
            caption={`Sealed final-test passes by harness in each group of organizations, with 95% intervals. The one-shot harness passed ${FIELD_ARMS[1]?.all.passed} of ${FIELD_TEST_SIZE} in all.`}
          >
            <div className="flex flex-col gap-8">
              {GROUPS.map((group, index) => (
                <GroupPassRates key={group.short} groups={GROUPS} arms={FIELD_ARMS} index={index} />
              ))}
            </div>
          </Exhibit>
          <Text>
            On Harborview Prep, an academy neither model had seen, Academy desk passed 43 of 48,
            against 24 for the base harness. Most of the gain came from assign and the tutoring turn
            ({tab('fieldSkills')}). On the real academy, a small sample, it also passed more.
            Spark&apos;s one-shot harness, written once without seeing Glimmer try, stayed level
            with the base harness in every group ({fig('fieldPairs')})
            <Cite to={['academyDesk']} />.
          </Text>
          <Exhibit
            label={fig('fieldPairs')}
            caption="How many more tasks Academy desk passed than each other harness, in percentage points, with 95% intervals."
          >
            <FieldPairForest />
          </Exhibit>
          <Tables label="Tables for the final test">
            <TableExhibit
              label={tab('fieldSkills')}
              caption="Passes by skill and organization, out of the tasks in each cell. The Real academy, a snapshot of 16 students, had no tasks for solve, hint and the tutoring turn. There, 6 of 8 diagnose tasks ended at the step limit, as 11 of its 19 practice tests list the section as Full, and history lost 1 task to wording and 3 to the date (section 1.4)."
            >
              <SkillTable />
            </TableExhibit>
            <TableExhibit
              label={tab('fieldPairs')}
              caption="Tasks the first harness passed and the second failed (won), the reverse (lost), and where they agreed. The two comparisons planned as primary are Academy desk against the base harness on Harborview Prep and on the Real academy. The base harness ran at temperature 1 with a 16-turn limit and low reasoning; the one-shot harness and Academy desk at temperature 0 with 30 turns and medium reasoning."
            >
              <GroupPairTable
                pairs={FIELD_PAIRS}
                name={groupName}
                label="Task by task, the field run"
              />
            </TableExhibit>
          </Tables>

          <Subsection number="1.3" title="The three rounds" />
          <Text>
            Spark kept two of its three changes to the harness ({tab('fieldRounds')})
            <Cite to={['academyDesk']} />.
          </Text>
          <Tables label="Table for the rounds">
            <TableExhibit
              label={tab('fieldRounds')}
              caption={`Each round of teaching for Academy desk: the change, held-out checks before and after, the same change measured again on new seeds, and the result. Teaching took about 15 minutes and cost 31 cents of Spark. The whole run cost about ${dollars(FIELD_MONEY.spark)} of Spark, including about 8 cents of estimates, and ${dollars(FIELD_MONEY.glimmer)} of hosted Glimmer.`}
            >
              <RoundList rounds={ROUNDS_FIELD} label="Rounds of teaching for Academy desk" />
            </TableExhibit>
          </Tables>

          <Subsection number="1.4" title="Where Academy desk missed on the real academy" />
          <Text>
            The records keep pass or fail, not replies. So after the test, Academy desk&apos;s tools
            were replayed on the real academy&apos;s files, with no model. Most diagnose tasks ended
            at the step limit. The question lookup tool finds a test by its section, and most of the
            academy&apos;s practice tests list the section as Full. History lost tasks to answers
            the academy marks right in other wording, and to the date: the agent was told it was Nov
            16, and the requests said Oct 30. That last cause fits the records, but they do not
            confirm it ({tab('fieldSkills')})
            <Cite to={['academyDesk']} />.
          </Text>

          <Subsection number="1.5" title="On this computer" />
          <Text>
            Frozen as it was, Academy desk took the same test again on-premise, on the small Glimmer
            build that runs on one graphics card through Ollama. It passed {local.local} of{' '}
            {FIELD_TEST_SIZE} here against {local.hosted} hosted, with no group showing a
            difference, and ran slower ({tab('local')})
            <Cite to={['local']} />.
          </Text>
          <Tables label="Table for this computer">
            <TableExhibit
              label={tab('local')}
              caption={`Academy desk's final-test passes on the 2-bit build on this computer's 12 GB graphics card and hosted, with the tasks won and lost on this computer, and the difference with its 95% interval. The median task took ${LOCAL_SPEED.medianLocal} s here and ${LOCAL_SPEED.medianHosted} s hosted, the slowest 5% over ${LOCAL_SPEED.slowestLocal} s against ${LOCAL_SPEED.slowestHosted} s, and ${LOCAL_SPEED.stepLimitLocal} tasks reached the step limit here against ${LOCAL_SPEED.stepLimitHosted} hosted.`}
            >
              <LocalTable />
            </TableExhibit>
          </Tables>

          <Subsection number="1.6" title="A third run" />
          <Text>
            A second run stopped twice before any result was read, so a third replaced it. Spark
            engineered the harness on three other generated academies over two rounds and kept both
            changes. The sealed final test held tasks from those academies, from Juniper Study
            House, which neither model had seen, and from a second snapshot of the real academy. The
            one-shot harness&apos;s test was held back
            <Cite to={['third']} />.
          </Text>
          <Text>
            On Juniper Study House, Academy desk passed {juniper.academyDesk.passed} of {juniper.n},
            against {juniper.bare.passed} for the base harness ({tab('third')})
            <Cite to={['third']} />.
          </Text>
          <Text>
            On the second snapshot of the real academy it passed {real.academyDesk.passed} of{' '}
            {real.n}, against {real.bare.passed} for the base harness. Replaying its tools after the
            test, with no model, traced that to three causes. First, the diagnose instructions load
            on phrases like &quot;what topic&quot;, but the real academy asks &quot;Which topic was
            that&quot;, so none of its requests matched. Second, every history attempt ran to the
            step limit. The instructions ask for a number of days this policy doesn&apos;t have, and
            the second round allowed one tool call per turn; that fits the records but is not
            confirmed. Third, assign failed for both harnesses, because the empty assignments file
            gave no way to number the first row. The task builder was fixed afterwards, and the
            numbers stand as measured
            <Cite to={['thirdMisses']} />.
          </Text>
          <Tables label="Table for the third run">
            <TableExhibit
              label={tab('third')}
              caption={`The third run, a sealed final test of ${THIRD_TEST_SIZE} tasks: passes for the base harness and Academy desk in each group, with 95% intervals, and Academy desk against the base harness task by task, with the difference in points and its 95% interval. The primary comparisons are Juniper Study House and the Real academy, here a snapshot of 17 students. On the Real academy none of the 10 diagnose requests matched, every history attempt ran to the 30-step limit, and assign was 0 of 10 for both harnesses. The run cost ${dollars(THIRD_MONEY.spark)} of Spark and ${dollars(THIRD_MONEY.glimmer)} of hosted Glimmer; Academy desk ran with high reasoning at about three times the base harness's spend.`}
            >
              <ThirdTable />
            </TableExhibit>
          </Tables>

          <Subsection number="1.7" title="Direction" />
          <Text>
            The larger idea: run the same loop over many organizations in one field, and it gives
            the verified lessons and checkable rewards that a model built for that field needs.
            These runs are a first step, and they show a gain on academies neither model saw.
            Section {sec('inventory')} takes the same loop to a second field
            <Cite to={['academyDesk', 'third']} />.
          </Text>
        </Section>

        <Section id="inventory" number={sec('inventory')} title="A screening lab: Inventory desk">
          <Text>
            Inventory desk runs a screening lab&apos;s compound store. Scientists ask it how much of
            a compound is usable, which lot a re-test should draw from, how to allocate stock for
            the compounds Assay desk sent back for re-testing, and to put holds on that stock. It
            works only from the lab&apos;s own files and policy, and a program checks the volumes,
            lots and rows it writes, never the wording
            <Cite to={['inventory']} />.
          </Text>
          <Text>
            Spark studied three generated labs, each with its own units, date formats, lot names and
            policy numbers, and engineered Glimmer&apos;s harness on them: a one-shot draft, then
            two refinement rounds. Then every harness was frozen and a sealed final test opened
            once. It held new tasks from the taught labs and from Corvid Hill Discovery, a lab
            sealed away from both models, whose stock rules no taught lab shares
            <Cite to={['inventory']} />.
          </Text>
          <Text>
            On Corvid Hill Discovery, the Spark-engineered harness passed {corvid.engineered.passed}{' '}
            of {corvidSize}, against {corvid.base.passed} for the base harness ({fig('lab')})
            <Cite to={['inventory']} />.
          </Text>
          <Exhibit
            label={fig('lab')}
            caption={`Sealed final-test passes by harness at the taught labs and at Corvid Hill Discovery, with 95% intervals. Across all ${LAB_TEST_SIZE} tasks the base harness passed ${LAB_ARMS[0]?.all.passed}, Spark's one-shot harness ${LAB_ARMS[1]?.all.passed} and Inventory desk ${LAB_ARMS[2]?.all.passed}.`}
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
            Spark&apos;s draft wrote a stock-planning tool that reads each lab&apos;s own policy
            numbers, so it worked at a lab whose numbers it had never met. Most of the gain was in
            place with that one-shot harness, and the two refinement rounds added a guard on
            tool-call format ({tab('labPairs')})
            <Cite to={['inventory']} />.
          </Text>
          <Tables label="Tables for the screening lab">
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
          </Tables>
        </Section>

        <Section id="open" number={sec('open')} title="An open-weight teacher: Muse Spark Open">
          <Text>
            The whole pipeline also runs on Meta&apos;s open weights. Muse Spark Open, served by
            BaseTen, engineered Glimmer&apos;s harness for the returns desk of section{' '}
            {sec('results')}, with the same split and the same sealed final test
            <Cite to={['open']} />.
          </Text>
          <Text>
            Spark Open&apos;s engineered harness took Glimmer from {open.base.passed} to{' '}
            {open.engineered.passed} of {TEST_SIZE} on the sealed final test ({fig('open')})
            <Cite to={['open']} />.
          </Text>
          <Exhibit
            label={fig('open')}
            caption={`Sealed final-test passes by harness on the returns desk taught by Spark Open, with 95% intervals. Spark Open's one-shot harness passed ${open.draft.passed} of ${TEST_SIZE}. The dashed line is the job's target.`}
          >
            <PassRates comparison={OPEN} />
          </Exhibit>
          <Text>
            Every arm here ran under Glimmer&apos;s on-device context of 16,384 tokens, the limit of
            the build that runs on-premise, so this run stands on its own and is not set against the
            earlier returns desk runs
            <Cite to={['open']} />.
          </Text>
          <Tables label="Tables for the open-weight teacher">
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
          </Tables>
        </Section>

        <Section id="certified" number={sec('certified')} title="The first risk certificate">
          <Text>
            A specialist should know when not to answer. Academy desk tries each request in a sealed
            calibration set {CERT2.attempts} times, and answers only when enough attempts agree.
            Architect picks the loosest agreement level whose exact upper bound on error stays under
            a target, following conformal risk control, Learn-then-Test and conformal abstention
            <Cite to={['crc', 'ltt', 'abstention']} />. If no level qualifies, no certificate is
            issued.
          </Text>
          <Text>
            The first certificate went to the Academy desk of section {sec('field')}: wrong on at
            most {CERT2.stated}% of the requests it answers, at {CERT2.confidence}% confidence (
            {fig('certificate')})
            <Cite to={['cert2']} />.
          </Text>
          <Exhibit
            label={fig('certificate')}
            caption={`The certificate as the app states it, and its check. The bound is the one-sided ${CERT2.confidence}% upper bound on 0 wrong of ${CERT2.calibration} calibration tasks answered, ${CERT2.bound}%, against a ${CERT2.target}% target; with no error, ${CERT2.calibration} tasks can certify no lower. On its own, ${CERT2.checkWrong} wrong of ${CERT2.checkAnswered} at Harborview Prep has a bound of ${CERT2.checkBound}%.`}
          >
            <CertificateFigure />
          </Exhibit>
          <Text>
            It held at Harborview Prep, which it never trained on: it answered {CERT2.checkAnswered}{' '}
            of {CERT2.checkTasks} sealed requests there and got none wrong ({tab('certCheck')})
            <Cite to={['cert2']} />.
          </Text>
          <Text>
            An earlier attempt, on the third run&apos;s Academy desk, issued none: its attempts ran
            with no randomness, so a wrong answer repeated as reliably as a right one (
            {tab('certFirst')})
            <Cite to={['cert']} />.
          </Text>
          <Text>
            When a tool Spark wrote fails on practice data, the failing case is shrunk by delta
            debugging
            <Cite to={['zeller']} /> and kept as a regression test. One question lookup&apos;s case
            shrank from 2,312 rows to 4
            <Cite to={['certify']} />.
          </Text>
          <Tables label="Tables for the certificate">
            <TableExhibit
              label={tab('certCalibration')}
              caption={`The certificate run on ${CERT2.calibration} calibration tasks from the taught academies, ${CERT2.attempts} attempts each. For each agreement threshold: the tasks Academy desk would answer, how many were wrong, the share handed to staff, and the one-sided ${CERT2.confidence}% upper bound on the error rate among answered tasks. The run made ${CERT2.runs} attempts for ${dollars(CERT2.usd)} of hosted Glimmer.`}
            >
              <CertCalibrationTable />
            </TableExhibit>
            <TableExhibit
              label={tab('certCheck')}
              caption={`The check at Harborview Prep, ${CERT2.checkTasks} sealed tasks: answered, wrong and handed off at each threshold. The certified threshold answers when 1 or more of ${CERT2.attempts} attempts give an answer.`}
            >
              <CertCheckTable />
            </TableExhibit>
            <TableExhibit
              label={tab('certFirst')}
              caption={`The earlier attempt, at temperature 0. For each agreement threshold: the calibration tasks Academy desk would answer, of ${CERT.calibration}, how many of those were wrong, the share handed to staff, and the one-sided ${CERT.confidence}% upper bound on the error rate among answered tasks, against a ${CERT.target}% target; then the same thresholds on the Real academy's ${CERT.checkTasks} check tasks. No threshold met the target, so no certificate was issued. The run cost ${dollars(CERT.usd)} of hosted Glimmer.`}
            >
              <CertTable />
            </TableExhibit>
          </Tables>
        </Section>

        <Section
          id="results"
          number={sec('results')}
          title="An earlier run: one job, a returns desk"
        >
          <Text>
            Before the academies, Architect was tried on one job with no organizations: a returns
            desk for a made-up shop. Glimmer took a sealed final test of refunds, order questions
            and pickups on three harnesses: the base harness, a one-shot harness Spark wrote, and a
            Spark-engineered harness built over rounds ({fig('round')}). A change was kept only if
            it clearly raised passes on held-out checks, measured twice, and cost no kind of task
            more than one pass
            <Cite to={['plan', 'second']} />. Learning from failures, and checking an agent by the
            state it leaves, both have published precedent
            <Cite to={['gepa', 'ace', 'taubench']} />.
          </Text>
          <Exhibit
            label={fig('round')}
            caption="The job's tasks, cut once into four sets, and the five steps of a round of teaching. The sealed final test stays closed until every harness is frozen."
          >
            <RoundDiagram />
          </Exhibit>
          <Text>
            On a new returns desk, after four rounds, the Spark-engineered harness took Glimmer from{' '}
            {second.base.passed} to {second.engineered.passed} of {TEST_SIZE} ({fig('returns')}).
            This is the returns desk that ships with the app
            <Cite to={['second']} />.
          </Text>
          <Exhibit
            label={fig('returns')}
            caption="Sealed final-test passes by harness on the new returns desk, with 95% intervals. The dashed line is the job's target."
          >
            <PassRates comparison={SECOND} />
          </Exhibit>
          <Text>
            On the first returns desk, with teaching held to two rounds, the Spark-engineered
            harness passed {first.engineered.passed} of {TEST_SIZE}, against {first.base.passed} for
            the base harness ({tab('firstPairs')}). The second comparison was designed after that
            one, and its plan was published before it ran
            <Cite to={['first', 'plan']} />.
          </Text>
          <Text>
            On the new returns desk, the Spark-engineered harness also answered much faster (
            {fig('speed')})
            <Cite to={['second']} />.
          </Text>
          <Exhibit
            label={fig('speed')}
            caption="Time to answer on the new returns desk. The dot is the median answer; the line runs to the slowest 5%."
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
            On a second kind of job, a repair shop&apos;s ticket costs, one round was enough, and
            Glimmer then passed all {REPAIR.finalTotal} of its final-test tasks ({tab('costs')})
            <Cite to={['hackathon']} />.
          </Text>
          <Tables label="Tables for the returns desks">
            <TableExhibit
              label={tab('returnsArms')}
              caption={`Passes by kind of request on the new returns desk, of ${PER_TYPE} each, and in all, of ${TEST_SIZE}, with 95% intervals.`}
            >
              <ArmTable comparison={SECOND} />
            </TableExhibit>
            <TableExhibit
              label={tab('returnsPairs')}
              caption="Requests each harness passed and the other failed (won), the reverse (lost), where they agreed, and the difference in points with its 95% interval, on the new returns desk."
            >
              <PairTable comparison={SECOND} />
            </TableExhibit>
            <TableExhibit
              label={tab('firstArms')}
              caption={`Passes by kind of request on the first returns desk, as in ${tab('returnsArms')}, with Spark answering the requests itself as a fourth arm.`}
            >
              <ArmTable comparison={FIRST} />
            </TableExhibit>
            <TableExhibit
              label={tab('firstPairs')}
              caption={`Requests won and lost in each pairing on the first returns desk, as in ${tab('returnsPairs')}. The Spark-engineered harness passed ${first.engineered.passed} against ${first.base.passed} for the base harness, and the interval includes zero.`}
            >
              <PairTable comparison={FIRST} />
            </TableExhibit>
            <TableExhibit
              label={tab('returnsRounds')}
              caption="Each round on the new returns desk: the change, held-out checks before and after, the same change measured again on new seeds, and the result. Teaching stopped when the target was reached."
            >
              <RoundList
                rounds={ROUNDS_SECOND}
                label="Rounds of teaching on the new returns desk"
              />
            </TableExhibit>
            <TableExhibit
              label={tab('firstRounds')}
              caption={`Each round on the first returns desk, as in ${tab('returnsRounds')}, held to 2 rounds after the draft.`}
            >
              <RoundList
                rounds={ROUNDS_FIRST}
                label="Rounds of teaching on the first returns desk"
              />
            </TableExhibit>
            <TableExhibit
              label={tab('costs')}
              caption={`What each harness cost on the new returns desk. On the repair shop, one round took Glimmer from ${REPAIR.checkBefore} to ${REPAIR.checkAfter} of ${REPAIR.checkTotal} held-out checks, and it passed ${REPAIR.finalPassed} of ${REPAIR.finalTotal} on its final test for ${REPAIR.cents} cents in all.`}
            >
              <Table
                fit
                label="What each harness cost on the new returns desk"
                columns={['', 'Spark', 'Glimmer, hosted']}
                rows={SECOND.arms.map((each) => [
                  armLabel(each),
                  dollars(each.spark),
                  each.glimmer === null ? '' : dollars(each.glimmer),
                ])}
              />
            </TableExhibit>
          </Tables>
        </Section>

        <Section id="scale" number={sec('scale')} title="From a specialist to a field model">
          <Text>
            A field&apos;s work leaves three things besides the specialist. Verified demonstrations
            are worked examples from training tasks that the checker confirmed. An outcome scorer
            lets an outside training framework ask for a score. Sealed evaluations are organizations
            a model never trained on, opened once for a frozen candidate
            <Cite to={['scale']} />.
          </Text>
          <Text>
            From a model&apos;s configuration on Hugging Face, Architect sizes a LoRA or QLoRA
            fine-tuning job. It writes a cluster launch bundle for Slurm or Kubernetes for you to
            run with your own tools, and it never holds cluster credentials ({tab('scale')})
            <Cite to={['scale']} />.
          </Text>
          <Tables label="Table for the path to a field model">
            <TableExhibit
              label={tab('scale')}
              caption="Each part of the path from a specialist to a field model, by whether it is measured, run with its effect not yet measured, built or unverified."
            >
              <Table
                label="What is measured, run, built and unverified on the path to a field model"
                left={[0, 1, 2]}
                columns={['Part', 'Status', 'What backs it']}
                rows={SCALE_STATUS.map(([part, status, backing]) => [part, status, backing])}
              />
            </TableExhibit>
          </Tables>
        </Section>

        <Section id="finetune" number={sec('finetune')} title="Fine-tuning on Hugging Face Jobs">
          <Text>
            Architect fine-tuned Glimmer&apos;s open weights on a screening lab&apos;s
            checker-verified work, as a QLoRA adapter trained on one A100 in about{' '}
            {Math.round(inventoryAdapter.gpuMinutes)} minutes, for {dollars(inventoryAdapter.usd)}
            <Cite to={['qlora1']} />.
          </Text>
          <Text>
            The training data were the {inventoryAdapter.examples} practice attempts at Inventory
            desk&apos;s training tasks that the checker passed, made by Glimmer on its engineered
            harness. The export takes training tasks only and scans every example for the sealed
            final test and the sealed lab, so nothing sealed went in
            <Cite to={['qlora1']} />.
          </Text>
          <Text>
            Over {FINETUNE_LOSS.length} optimizer steps the training loss fell from{' '}
            {found(FINETUNE_LOSS[0], 'first loss').loss.toFixed(4)} to{' '}
            {found(FINETUNE_LOSS.at(-1), 'last loss').loss.toFixed(4)} ({fig('loss')}). The examples
            are Glimmer&apos;s own successes, so the loss starts low, and it shows the adapter fits
            them, not that it helps
            <Cite to={['qlora1']} />.
          </Text>
          <Exhibit
            label={fig('loss')}
            caption="Training loss at each optimizer step of Inventory desk's QLoRA run. Five of the six steps were warmup, so the learning rate reached its peak, 1e-4, only at the last."
          >
            <LossFigure />
          </Exhibit>
          <Text>
            The adapter holds {inventoryAdapter.pairs} LoRA pairs at rank {inventoryAdapter.rank},
            and it passes the product&apos;s file-level checks against the base model it was trained
            on ({tab('adapters')})
            <Cite to={['qlora1']} />.
          </Text>
          <Text>
            The adapter&apos;s effect on the sealed final test is measured next
            <Cite to={['qlora1']} />.
          </Text>
          <Text>
            The runs also fixed the product: the converter&apos;s targets, which now leave out the
            projections the pinned converter can&apos;t convert, the trained weights, now uploaded
            before conversion so a failed conversion can&apos;t lose them, and the memory planner,
            which now counts the fp32 weights and fp32 logits it had left out
            <Cite to={['qlora1']} />.
          </Text>
          <Tables label="Table for the adapters">
            <TableExhibit
              label={tab('adapters')}
              caption={`Both QLoRA adapters of Glimmer, each trained in 4 bits on one A100 80 GB on Hugging Face Jobs. Sweep desk's had ${sweepAdapter.examples} examples, so it took ${sweepAdapter.steps} optimizer steps, the first at learning rate 0, and is not expected to change anything. The checks are at the file level; no model was loaded.`}
            >
              <AdapterTable />
            </TableExhibit>
          </Tables>
        </Section>

        <Section id="limits" number={sec('limits')} title="Limitations">
          {LIMITS.map((limit) => (
            <Text key={limit.title}>
              <span className="font-semibold">{limit.title}</span> {limit.text.replace(/\.$/, '')}
              <Cite to={[limit.from]} />.
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
