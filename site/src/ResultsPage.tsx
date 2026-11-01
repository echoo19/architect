import { Fragment, type ReactNode } from 'react';
import { ArrowUpRight, ChevronRight } from 'lucide-react';
import { REPORTS } from './content';
import {
  CERT,
  CERT_ROWS,
  FIELD_ARMS,
  FIELD_MONEY,
  FIELD_PAIRS,
  FIELD_TEST_SIZE,
  FIRST,
  GROUPS,
  LOCAL_ROWS,
  LOCAL_SPEED,
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
  TARGET_PASSES,
  TEST_SIZE,
  THIRD_MONEY,
  THIRD_ROWS,
  THIRD_TEST_SIZE,
  TYPES,
  type Arm,
  type Comparison,
  type FieldPair,
  type GroupKey,
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
  { key: 'plan', what: "The second comparison's plan, published before it ran." },
  { key: 'second', what: "The second comparison's report." },
  { key: 'gepa', what: 'GEPA: improving prompts from failures by reflection.' },
  { key: 'ace', what: 'ACE: agents that grow their own context from experience.' },
  { key: 'taubench', what: 'tau-bench: checking an agent by the final state of its work.' },
  { key: 'first', what: "The first comparison's report." },
  { key: 'hackathon', what: "The repair shop's run." },
  { key: 'scale', what: 'The plan for going from a specialist to a field model.' },
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
  { key: 'zeller', what: 'Simplifying and isolating failure-inducing input (delta debugging).' },
  { key: 'certify', what: 'The plan for certified answers and counterexample-guided repair.' },
  { key: 'cert', what: "The first live certificate run, on the third run's Academy desk." },
];

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
      name={`Final-test pass rate by arm, ${comparison.title}`}
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

/** The rounds as rows: the change, its check-task scores, and whether it was kept. */
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
              Check tasks {round.before} to {round.after} of {round.total ?? 45}
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

const pairName = (pair: FieldPair) => `${pair.label}, ${groupName(pair.group)}`;

/** The pass rate of each arm in one group of organizations, with its 95% interval. */
function FieldPassRates({ index }: { index: number }) {
  const group = GROUPS[index];
  if (group === undefined) throw new Error(`There is no group ${index}.`);
  const rows: ForestRow[] = FIELD_ARMS.map((each) => {
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
        name={`Final-test pass rate by arm, ${group.name}`}
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
      name="Difference in final-test pass rate, in percentage points, Academy desk against the other setups"
      rows={rows}
      min={-40}
      max={70}
      ticks={[-40, -20, 0, 20, 40, 60]}
      formatTick={(value) => `${value > 0 ? '+' : ''}${value}`}
      zero="No difference"
    />
  );
}

/** Every pairing, task by task, with the difference and its interval. */
function FieldPairTable() {
  return (
    <Table
      label="Task by task, the field run"
      left={[0, 1]}
      columns={['', 'Group', 'Won', 'Lost', 'Both passed', 'Neither', 'Difference, 95% interval']}
      rows={FIELD_PAIRS.map((each) => [
        each.label,
        `${groupName(each.group)} (${each.n})`,
        each.wins,
        each.losses,
        each.both,
        each.neither,
        `${signed(each.diff)}, ${interval(each)}`,
      ])}
    />
  );
}

/** Passes by skill and organization, for each setup. */
function SkillTable() {
  return (
    <Table
      label="Passes by skill and organization, the field run"
      left={[0, 1]}
      columns={['Skill', 'Group', 'Blank setup', 'One-shot setup', 'Academy desk']}
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

/** The third run's passes for both setups, group by group, with the paired difference. */
function ThirdTable() {
  const rate = (result: { passed: number; low: number; high: number }, n: number) =>
    `${result.passed} of ${n} (${result.low.toFixed(1)} to ${result.high.toFixed(1)})`;
  return (
    <Table
      label="The third run: the blank setup and Academy desk on the same final-test tasks"
      columns={['Group', 'Blank setup', 'Academy desk', 'Won', 'Lost', 'Difference, 95% interval']}
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

/** What is measured, what is built and tested on stand-ins, and what has not been done. */
const SCALE_STATUS: readonly (readonly [string, string, string])[] = [
  [
    'Instructions and small tools taught for a field',
    'Measured',
    'Two Academy desk runs, with sealed organizations, each under one seed (sections 1.2, 1.5 and 1.6).',
  ],
  [
    'Export of verified demonstrations and an outcome scorer',
    'Built',
    'Tested on stand-ins. Nothing from a sealed organization goes in.',
  ],
  [
    "Training plans sized from a model's configuration",
    'Built',
    'The memory terms are estimates, shown with their arithmetic.',
  ],
  [
    'Launch bundles for Slurm and Kubernetes',
    'Built, experimental',
    'Checked structurally and against simulated schedulers. Run by you, with your own tools.',
  ],
  ['Adapter training on one rented GPU', 'Built', 'Tested against stand-ins.'],
  [
    'GPU execution, large-model compatibility, training gains',
    'Unverified',
    'No cluster job has run.',
  ],
  ['A model trained on a field', 'Future', 'None has been trained.'],
];

const LIMITS: readonly { title: string; text: string; from: SourceKey }[] = [
  {
    title: 'One seed, mostly hosted Glimmer, for the Academy desk.',
    text: "Every Academy desk figure comes from one seed, the number that fixes a run's chance choices, and all but section 1.5 from hosted Glimmer; a second declared seed was not run.",
    from: 'academyDesk',
  },
  {
    title: 'The local check covers one setup.',
    text: 'Only Academy desk ran on this computer, because the blank setup ran out of memory early, so the check says nothing about untaught Glimmer here.',
    from: 'local',
  },
  {
    title: 'A small real sample.',
    text: 'The real academy gave only 24 tasks in the first run and 30 in the third, many sharing students and files, and its records have no question text, so a gain there is not yet confirmed.',
    from: 'academyDesk',
  },
  {
    title: "The third run's real academy assign tasks could not be passed.",
    text: 'The empty assignments file never said how to number the first row, so both setups failed every one, and in the same run the one-shot setup was not tested and Academy desk spent about three times what the blank setup did.',
    from: 'third',
  },
  {
    title: 'A policy written for the test.',
    text: "The real academy's policy was drafted for this test and awaits the academy's confirmation, and some of its numbers came from the generated academies, so it tests transfer less strictly than Harborview Prep.",
    from: 'academyDesk',
  },
  {
    title: 'Settings differ by setup.',
    text: 'The setups ran with different temperatures, turn limits and reasoning levels (Table 2), so each row compares a whole configuration.',
    from: 'academyDesk',
  },
  {
    title: 'A scripted study and a patched runner.',
    text: 'A script, not a person, confirmed the study brief, and the comparisons ran on a patched copy of the runner outside the repository.',
    from: 'academyDesk',
  },
  {
    title: 'Two desks of one kind.',
    text: 'Both returns desks are for a made-up shop from the same generator, so they test one kind of job, not other businesses.',
    from: 'plan',
  },
  {
    title: 'One seed for the returns desks.',
    text: 'Each returns desk final test ran under one seed with a second declared seed not run, and the student refining its own setup was not one of the setups compared.',
    from: 'second',
  },
  {
    title: 'Glimmer served online.',
    text: 'The returns desk figures come from Glimmer served online, not the build on your computer, and none of these agents has trained weights.',
    from: 'second',
  },
  {
    title: 'A target met is not proof.',
    text: 'Meeting the 95% target on the final test does not prove 95% reliability, since its interval reaches well below that (Table 6), and only the final test is claimed because gains seen while teaching lean upward.',
    from: 'second',
  },
  {
    title: 'One certificate run, on hosted Glimmer.',
    text: 'Its five attempts ran with no randomness, which makes agreement a weak signal, a counting flaw was fixed only after it, and counterexample repair is tested only on stand-ins and practice data.',
    from: 'cert',
  },
  {
    title: 'The repair shop ran once.',
    text: 'It was a single run, not a planned comparison, and a rule graded it.',
    from: 'hackathon',
  },
];

/** The headline figures under the abstract: a figure, then what it counts. */
const HEADLINE: readonly { figure: string; text: string }[] = [
  { figure: '24 to 43', text: 'of 48 · Harborview Prep, never seen' },
  { figure: '15 to 31', text: 'of 48 · Juniper Study House, never seen' },
  { figure: '54 to 99', text: 'of 120 · every group, first run' },
];

const TAUGHT = "Glimmer after Spark's teaching";
const ALONE = 'Glimmer on its own';

export function ResultsPage() {
  const second = {
    taught: arm(SECOND, TAUGHT),
    alone: arm(SECOND, ALONE),
  };
  const first = {
    taught: arm(FIRST, TAUGHT),
    alone: arm(FIRST, ALONE),
  };
  const local = found(LOCAL_ROWS[3], 'local row for all groups');
  const juniper = found(THIRD_ROWS[1], 'third-run row for Juniper Study House');
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
          <p className="m-0 mt-4">Jake Kang · October 2026</p>
          <h2 className="t-h2 mt-16">Abstract</h2>
          <p className="t-read mt-4">
            Architect turns an organization&apos;s own material into a specialist that runs on its
            own computer. A large model, Spark, teaches a small one, Glimmer, by changing its
            instructions and small tools, and keeps a change only if it helps on check tasks Spark
            never sees. Taught on three generated test-prep academies to be Academy desk, an agent
            for academy staff, Glimmer passed 43 of 48 tasks on an academy neither model had seen,
            against 24 untaught. On a real academy that gain is not yet confirmed, and a later run
            on a second snapshot scored lower, for three causes we traced.
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

        <Section id="field" number={1} title="An operations agent for test-prep academies">
          <Subsection number="1.1" title="The run" />
          <Text>
            Academy desk is Glimmer with the instructions and small tools Spark built for it. When a
            student misses a practice question, staff ask it what to do. It answers from the
            academy&apos;s own files: topic labels, question bank, practice tests, answers, hints,
            videos and tutoring policy. A program checks the facts and file changes, never the
            wording
            <Cite to={['academyDesk']} />.
          </Text>
          <Text>
            Spark taught Glimmer over three rounds on three generated academies. Each one differs in
            labels, id formats, wording and policy numbers. Then everything was frozen, and a sealed
            test was opened once. It held new tasks from the taught academies, tasks from Harborview
            Prep, a generated academy neither model had seen, and tasks from a real tutoring
            academy, anonymized. The real academy&apos;s records have no question text, so only
            diagnose, history and assign could be checked there. Three setups took the test: Glimmer
            on a blank setup, Spark&apos;s one-shot setup (written once and kept without a check),
            and Academy desk
            <Cite to={['academyDesk']} />.
          </Text>

          <Subsection number="1.2" title="Final-test results" />
          <Text>
            Across all {FIELD_TEST_SIZE} tasks, Academy desk passed {FIELD_ARMS[2]?.all.passed}. The
            blank setup passed {FIELD_ARMS[0]?.all.passed} (Figure 1).
          </Text>
          <Exhibit
            label="Figure 1"
            caption={`Final-test passes by setup in each group of organizations, with 95% intervals. The one-shot setup passed ${FIELD_ARMS[1]?.all.passed} of ${FIELD_TEST_SIZE} in all.`}
          >
            <div className="flex flex-col gap-8">
              {GROUPS.map((group, index) => (
                <FieldPassRates key={group.short} index={index} />
              ))}
            </div>
          </Exhibit>
          <Text>
            On Harborview Prep, an academy neither model had seen, Academy desk passed 43 of 48. The
            blank setup passed 24. Most of the gain came from assign and the tutoring turn (Table
            1). On the real academy Academy desk also passed more, but there were too few tasks to
            confirm that gain yet. The one-shot setup did no better than the blank setup in any
            group (Figure 2)
            <Cite to={['academyDesk']} />.
          </Text>
          <Exhibit
            label="Figure 2"
            caption="How many more tasks Academy desk passed than each other setup, in percentage points, with 95% intervals."
          >
            <FieldPairForest />
          </Exhibit>
          <Tables label="Tables for the final test">
            <TableExhibit
              label="Table 1"
              caption="Passes by skill and organization, out of the tasks in each cell. The Real academy, a snapshot of 16 students, had no tasks for solve, hint and the tutoring turn. There, 6 of 8 diagnose tasks ended at the step limit, as 11 of its 19 practice tests list the section as Full, and history lost 1 task to wording and 3 to the date (section 1.4)."
            >
              <SkillTable />
            </TableExhibit>
            <TableExhibit
              label="Table 2"
              caption="Tasks the first setup passed and the second failed (won), the reverse (lost), and where they agreed. The two comparisons planned as primary are Academy desk against a blank setup on Harborview Prep and on the Real academy. The blank setup ran at temperature 1 with a 16-turn limit and low reasoning; the one-shot setup and Academy desk at temperature 0 with 30 turns and medium reasoning."
            >
              <FieldPairTable />
            </TableExhibit>
          </Tables>

          <Subsection number="1.3" title="The three rounds" />
          <Text>
            Teaching took about 15 minutes, and two of Spark&apos;s three changes were kept (Table
            3)
            <Cite to={['academyDesk']} />.
          </Text>
          <Tables label="Table for the rounds">
            <TableExhibit
              label="Table 3"
              caption={`Each round of teaching for Academy desk: the change, check tasks before and after, the same change measured again on new seeds, and the result. Teaching cost 31 cents of Spark. The whole run cost about ${dollars(FIELD_MONEY.spark)} of Spark, including about 8 cents of estimates, and ${dollars(FIELD_MONEY.glimmer)} of hosted Glimmer.`}
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
            confirm it (Table 1)
            <Cite to={['academyDesk']} />.
          </Text>

          <Subsection number="1.5" title="On this computer" />
          <Text>
            Frozen as it was, Academy desk took the same test again on the small Glimmer build that
            runs on one 12 GB graphics card, through Ollama. It passed {local.local} of{' '}
            {FIELD_TEST_SIZE}, about as many as hosted, and no group shows a difference. It was
            slower here, and more tasks reached the step limit (Table 4)
            <Cite to={['local']} />.
          </Text>
          <Tables label="Table for this computer">
            <TableExhibit
              label="Table 4"
              caption={`Academy desk's final-test passes on the 2-bit build on this computer and hosted, with the tasks won and lost on this computer, and the difference with its 95% interval. The median task took ${LOCAL_SPEED.medianLocal} s here and ${LOCAL_SPEED.medianHosted} s hosted, the slowest 5% over ${LOCAL_SPEED.slowestLocal} s against ${LOCAL_SPEED.slowestHosted} s, and ${LOCAL_SPEED.stepLimitLocal} tasks reached the step limit here against ${LOCAL_SPEED.stepLimitHosted} hosted.`}
            >
              <LocalTable />
            </TableExhibit>
          </Tables>

          <Subsection number="1.6" title="A third run" />
          <Text>
            A second run stopped twice before any result was read, so a third replaced it. Spark
            taught Glimmer on three other generated academies over two rounds, and both changes were
            kept. The sealed test held tasks from those academies, from Juniper Study House, which
            neither model had seen, and from a second snapshot of the real academy. The one-shot
            setup&apos;s test was held back
            <Cite to={['third']} />.
          </Text>
          <Text>
            On Juniper Study House, Academy desk passed {juniper.academyDesk.passed} of 48. The
            blank setup passed {juniper.bare.passed}. On the second snapshot of the real academy,
            Academy desk scored lower than the blank setup. Replaying its tools traced that to three
            causes
            <Cite to={['third']} />.
          </Text>
          <Text>
            The replays ran after the test, with no model. First, the diagnose instructions load on
            phrases like &quot;what topic&quot;, but the real academy asks &quot;Which topic was
            that&quot;, so none of its requests matched. Second, every history attempt ran to the
            step limit. The instructions ask for a number of days this policy doesn&apos;t have, and
            the second round allowed one tool call per turn; that fits the records but is not
            confirmed. Third, assign failed for both setups, because the empty assignments file gave
            no way to number the first row. The task builder was fixed afterwards, and the numbers
            stand as measured
            <Cite to={['thirdMisses']} />.
          </Text>
          <Tables label="Table for the third run">
            <TableExhibit
              label="Table 5"
              caption={`The third run, a sealed test of ${THIRD_TEST_SIZE} tasks: final-test passes for the blank setup and Academy desk in each group, with 95% intervals, and Academy desk against the blank setup task by task, with the difference in points and its 95% interval. The primary comparisons are Juniper Study House and the Real academy, here a snapshot of 17 students. On the Real academy none of the 10 diagnose requests matched, every history attempt ran to the 30-step limit, and assign was 0 of 10 for both setups. The run cost ${dollars(THIRD_MONEY.spark)} of Spark and ${dollars(THIRD_MONEY.glimmer)} of hosted Glimmer; Academy desk ran with high reasoning at about three times the blank setup's spend.`}
            >
              <ThirdTable />
            </TableExhibit>
          </Tables>

          <Subsection number="1.7" title="Direction" />
          <Text>
            The larger idea: run the same loop over many organizations in one field, and it would
            give the verified lessons and checkable rewards that a model built for that field needs.
            These runs are a first step, in one field. They show a gain on academies neither model
            saw. On the real academy, that gain is not yet confirmed
            <Cite to={['academyDesk', 'third']} />.
          </Text>
        </Section>

        <Section id="results" number={2} title="An earlier run: one job, a returns desk">
          <Text>
            Before the academies, Architect was tried on one job with no organizations: a returns
            desk for a made-up shop. Glimmer took a sealed final test of refunds, order questions
            and pickups three ways: on its own, with a one-shot setup Spark wrote, and after Spark
            taught it in rounds (Figure 3). A change was kept only if it clearly raised passes on
            check tasks, measured twice, and cost no kind of task more than one pass
            <Cite to={['plan', 'second']} />. Learning from failures, and checking an agent by the
            state it leaves, both have published precedent
            <Cite to={['gepa', 'ace', 'taubench']} />.
          </Text>
          <Exhibit
            label="Figure 3"
            caption="The job's tasks, cut once into four sets, and the five steps of a round of teaching. The final test stays sealed until every setup is frozen."
          >
            <RoundDiagram />
          </Exhibit>
          <Text>
            On a new returns desk, after four rounds of teaching, Glimmer passed{' '}
            {second.taught.passed} of {TEST_SIZE}. On its own it passed {second.alone.passed}{' '}
            (Figure 4)
            <Cite to={['second']} />. On the returns desk that ships with the app, held to two
            rounds, teaching showed no clear gain (Table 9). The second comparison was designed
            after that one, and its plan was published before it ran
            <Cite to={['first', 'plan']} />.
          </Text>
          <Exhibit
            label="Figure 4"
            caption="Final-test passes by arm on the new returns desk, with 95% intervals. The dashed line is the job's target."
          >
            <PassRates comparison={SECOND} />
          </Exhibit>
          <Text>
            Taught Glimmer also answered much faster than Glimmer on its own (Figure 5)
            <Cite to={['second']} />. On a second kind of job, a repair shop&apos;s ticket costs,
            one round of teaching was enough. Glimmer then passed all {REPAIR.finalTotal} of its
            final-test tasks (Table 12)
            <Cite to={['hackathon']} />.
          </Text>
          <Exhibit
            label="Figure 5"
            caption="Time to answer on the new returns desk. The dot is the median answer; the line runs to the slowest 5%."
          >
            <Forest
              name="Median and slowest 5% of answer times, by arm"
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
                summary: `${each.name}: typical answer ${each.p50} seconds, slowest 5 percent within ${each.p95}.`,
              }))}
              min={0}
              max={60}
              figureWidth="10.5rem"
              ticks={[0, 15, 30, 45, 60]}
              formatTick={(value) => `${value} s`}
            />
          </Exhibit>
          <Tables label="Tables for the returns desks">
            <TableExhibit
              label="Table 6"
              caption={`Passes by kind of request on the new returns desk, of ${PER_TYPE} each, and in all, of ${TEST_SIZE}, with 95% intervals.`}
            >
              <ArmTable comparison={SECOND} />
            </TableExhibit>
            <TableExhibit
              label="Table 7"
              caption="Requests each arm passed and the other failed (won), the reverse (lost), where they agreed, and the difference in points with its 95% interval, on the new returns desk."
            >
              <PairTable comparison={SECOND} />
            </TableExhibit>
            <TableExhibit
              label="Table 8"
              caption="Passes by kind of request on the first returns desk, as in Table 6, with Spark answering the requests itself as a fourth arm."
            >
              <ArmTable comparison={FIRST} />
            </TableExhibit>
            <TableExhibit
              label="Table 9"
              caption={`Requests won and lost in each pairing on the first returns desk, as in Table 7. Teaching passed ${first.taught.passed} against ${first.alone.passed} for Glimmer on its own, and the interval includes zero.`}
            >
              <PairTable comparison={FIRST} />
            </TableExhibit>
            <TableExhibit
              label="Table 10"
              caption="Each round on the new returns desk: the change, check tasks before and after, the same change measured again on new seeds, and the result. Teaching stopped when the target was reached."
            >
              <RoundList
                rounds={ROUNDS_SECOND}
                label="Rounds of teaching on the new returns desk"
              />
            </TableExhibit>
            <TableExhibit
              label="Table 11"
              caption="Each round on the first returns desk, as in Table 10, held to 2 rounds after the draft."
            >
              <RoundList
                rounds={ROUNDS_FIRST}
                label="Rounds of teaching on the first returns desk"
              />
            </TableExhibit>
            <TableExhibit
              label="Table 12"
              caption={`What each arm cost on the new returns desk. On the repair shop, one round took Glimmer from ${REPAIR.checkBefore} to ${REPAIR.checkAfter} of ${REPAIR.checkTotal} check tasks, and it passed ${REPAIR.finalPassed} of ${REPAIR.finalTotal} on its final test for ${REPAIR.cents} cents in all.`}
            >
              <Table
                fit
                label="What each arm cost on the new returns desk"
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

        <Section id="scale" number={3} title="From a specialist to a field model">
          <Text>
            A field&apos;s work leaves three things besides the specialist. Verified demonstrations
            are worked examples from training tasks that the checker confirmed. An outcome scorer
            lets an outside training framework ask for a score. Sealed evaluations are organizations
            a model never trained on, opened once for a frozen candidate
            <Cite to={['scale']} />.
          </Text>
          <Text>
            From a model&apos;s configuration on Hugging Face, Architect sizes a training job. It
            writes a launch bundle for Slurm or Kubernetes for you to run with your own tools, and
            it never holds cluster credentials. The bundles are checked for structure and against
            simulated schedulers. Running on GPUs, large-model support and training gains are not
            yet verified (Table 13)
            <Cite to={['scale']} />.
          </Text>
          <Tables label="Table for the path to a field model">
            <TableExhibit
              label="Table 13"
              caption="Each part of the path from a specialist to a field model, by whether it is measured, built, unverified or future."
            >
              <Table
                label="What is measured, built and future on the path to a field model"
                left={[0, 1, 2]}
                columns={['Part', 'Status', 'What backs it']}
                rows={SCALE_STATUS.map(([part, status, backing]) => [part, status, backing])}
              />
            </TableExhibit>
          </Tables>
        </Section>

        <Section id="certified" number={4} title="Certified answers and counterexamples">
          <Text>
            A specialist should know when not to answer. Academy desk tries each request in a sealed
            calibration set {CERT.attempts} times, and answers only when enough attempts agree.
            Architect picks the loosest agreement level whose exact upper bound on error stays under
            a target, following conformal risk control, Learn-then-Test and conformal abstention
            <Cite to={['crc', 'ltt', 'abstention']} />. If no level qualifies, no certificate is
            issued. When a tool Spark wrote fails on practice data, the failing case is shrunk by
            delta debugging
            <Cite to={['zeller']} /> and kept as a regression test. One question lookup&apos;s case
            shrank from 2,312 rows to 4
            <Cite to={['certify']} />.
          </Text>
          <Text>
            The first live run, on the third run&apos;s Academy desk with hosted Glimmer, issued no
            certificate. Even when all five attempts agreed, it was wrong too often to meet the
            target (Table 14). Its attempts ran with no randomness, so a wrong answer repeated as
            reliably as a right one, and its errors were confident ones. On the real academy&apos;s
            check tasks it got none right. On every history task all five attempts ran out of steps,
            and the run counted that as agreement, a flaw fixed after the run
            <Cite to={['cert']} />.
          </Text>
          <Tables label="Table for the certificate run">
            <TableExhibit
              label="Table 14"
              caption={`The first live certificate run, at temperature 0. For each agreement threshold: the calibration tasks Academy desk would answer, of ${CERT.calibration}, how many of those were wrong, the share handed to staff, and the one-sided ${CERT.confidence}% upper bound on the error rate among answered tasks, against a ${CERT.target}% target; then the same thresholds on the Real academy's ${CERT.checkTasks} check tasks. No threshold met the target, so no certificate was issued. The run cost ${dollars(CERT.usd)} of hosted Glimmer.`}
            >
              <CertTable />
            </TableExhibit>
          </Tables>
        </Section>

        <Section id="limits" number={5} title="Limitations">
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
