import { Fragment, type ReactNode } from 'react';
import { ArrowUpRight } from 'lucide-react';
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
  MONEY,
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
  type Pair,
  type Round,
  type SourceKey,
} from './evidence';
import { Actors } from './components/Actors';
import { Footer } from './components/Footer';
import { Forest, type ForestRow } from './components/Forest';
import { Header } from './components/Header';
import { Reveal } from './components/Reveal';
import { RoundDiagram } from './components/RoundDiagram';
import { ScoreChart } from './mock/score-chart';

/**
 * The results page, set out as a short paper: a title and an abstract, numbered sections, numbered
 * figures and tables with their captions, and numbered references to the documents the figures
 * come from. Every number is in `evidence.ts`, with the document it comes from.
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
  { key: 'first', what: "The first comparison's report." },
  { key: 'hackathon', what: "The repair shop's run." },
  { key: 'readme', what: 'The project overview.' },
  { key: 'scale', what: 'The plan for going from a specialist to a field model.' },
  { key: 'gepa', what: 'GEPA: improving prompts from failures by reflection.' },
  { key: 'ace', what: 'ACE: agents that grow their own context from experience.' },
  { key: 'taubench', what: 'tau-bench: checking an agent by the final state of its work.' },
  { key: 'certify', what: 'The plan for certified answers and counterexample-guided repair.' },
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

/**
 * A figure or a table in its own panel, with its number and caption: under a figure, over a
 * table, as a paper sets them.
 */
function Exhibit({
  label,
  caption,
  table = false,
  children,
}: {
  label: string;
  caption: ReactNode;
  table?: boolean;
  children: ReactNode;
}) {
  const text = (
    <figcaption className="t-small text-pretty">
      <span className="font-semibold">{label}.</span> {caption}
    </figcaption>
  );
  return (
    <Reveal className="exhibit my-2">
      <figure className="m-0 flex flex-col gap-6 rounded-card bg-card px-8 py-7 shadow-edge max-sm:px-4 max-sm:py-5">
        {table && text}
        {children}
        {!table && text}
      </figure>
    </Reveal>
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
      className="article flex scroll-mt-20 flex-col gap-6 pt-16 sm:pt-20"
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
    <h3 className="t-h2 hang mt-4">
      <span className="sec-num">{number}</span>
      {title}
    </h3>
  );
}

function Text({ children }: { children: ReactNode }) {
  return <p className="t-read">{children}</p>;
}

/** One pair of arms from a comparison, by its label. */
function pair(comparison: Comparison, label: string): Pair {
  const found = comparison.pairs.find((each) => each.label === label);
  if (!found) throw new Error(`The ${comparison.id} comparison has no pair "${label}".`);
  return found;
}

/** One arm of a comparison, by its name. */
function arm(comparison: Comparison, name: string): Arm {
  const found = comparison.arms.find((each) => each.name === name);
  if (!found) throw new Error(`The ${comparison.id} comparison has no arm "${name}".`);
  return found;
}

const interval = (p: Pair) => `${signed(p.low)} to ${signed(p.high)}`;

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

const armLabel = (arm: { name: string }) => (
  <span className="text-pretty">
    <Actors text={arm.name} />
  </span>
);

/** The pass rate of each arm on the final test, with its 95% interval. */
function PassRates({ comparison }: { comparison: Comparison }) {
  const rows: ForestRow[] = comparison.arms.map((arm) => ({
    label: armLabel(arm),
    value: (arm.passed / TEST_SIZE) * 100,
    low: arm.low,
    high: arm.high,
    tone: arm.tone,
    figure: (
      <span className="flex flex-col items-end">
        <span className="font-display text-h2 font-semibold">
          {arm.passed}
          <span className="t-body ml-1.5"> of {TEST_SIZE}</span>
        </span>
        <span className="t-small">
          {arm.low.toFixed(1)}% to {arm.high.toFixed(1)}%
        </span>
      </span>
    ),
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

/** Each arm's passes by kind of request. */
function ArmTable({ comparison }: { comparison: Comparison }) {
  return (
    <Table
      label={`Final-test passes by kind of request, ${comparison.title}`}
      fit
      columns={['', ...TYPES]}
      rows={comparison.arms.map((arm) => [armLabel(arm), ...arm.byType.map(String)])}
    />
  );
}

/** Each pair of arms, request by request: the difference in points with its interval. */
function PairForest({ comparison }: { comparison: Comparison }) {
  const rows: ForestRow[] = comparison.pairs.map((pair) => ({
    label: (
      <span className="text-pretty">
        <Actors text={pair.label} />
      </span>
    ),
    value: pair.diff,
    low: pair.low,
    high: pair.high,
    tone: pair.low > 0 ? 'student' : 'plain',
    figure: <span className="font-display text-h2 font-semibold">{signed(pair.diff)}</span>,
    summary: `${pair.label}: ${signed(pair.diff)} points, 95% interval ${signed(pair.low)} to ${signed(pair.high)}.`,
  }));
  return (
    <Forest
      name={`Difference in final-test pass rate, in percentage points, ${comparison.title}`}
      rows={rows}
      min={-40}
      max={50}
      ticks={[-40, -20, 0, 20, 40]}
      formatTick={(value) => `${value > 0 ? '+' : ''}${value}`}
      zero="No difference"
    />
  );
}

/** Each pair of arms, request by request: who won, who lost, and where they agreed. */
function PairTable({ comparison }: { comparison: Comparison }) {
  return (
    <Table
      fit
      label={`Request by request, ${comparison.title}`}
      columns={['', 'Won', 'Lost', 'Both passed', 'Neither']}
      rows={comparison.pairs.map((pair) => [
        <Actors key="label" text={pair.label} />,
        pair.wins,
        pair.losses,
        pair.both,
        pair.neither,
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
        <span className="flex flex-col items-end">
          <span className="font-display text-h2 font-semibold">
            {result.passed}
            <span className="t-body ml-1.5"> of {group.n}</span>
          </span>
          <span className="t-small">
            {result.low.toFixed(1)}% to {result.high.toFixed(1)}%
          </span>
        </span>
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
        `${signed(row.diff)}, ${signed(row.low)} to ${signed(row.high)}`,
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
        `${signed(row.diff)}, ${signed(row.low)} to ${signed(row.high)}`,
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
    title: 'Mostly hosted Glimmer, one seed, for the Academy desk.',
    text: 'Every figure in section 1 except 1.5 is from hosted Glimmer at full precision under seed 101. Section 1.5 is one check of the finished Academy desk on the build that runs on a computer, also under one seed. A second seed was declared and not run.',
    from: 'academyDesk',
  },
  {
    title: 'The local check is one seed and one setup.',
    text: 'Academy desk was the one setup run on this computer. The run of the blank setup on the Real academy stopped after 2 of 24 tasks when the system ran low on memory, so the local result says nothing about how the untaught Glimmer does there. The test had already been opened, and nothing was tuned for it.',
    from: 'local',
  },
  {
    title: 'A small real sample.',
    text: 'In the first run the Real academy gave 24 tasks, 8 for each of 3 skills, from one snapshot of 16 students. In the third it gave 30, 10 for each skill, from a second snapshot of 17 students. The tasks share students and files, so they are not independent. Its records have no question text, so hint, solve and the tutoring turn were not tested there. No gain is shown on it in either run.',
    from: 'academyDesk',
  },
  {
    title: "The third run's Real academy assign tasks could not be passed.",
    text: "They asked for new rows in an empty assignments file, and no file there says how to number the first one, so both setups scored 0 of 10. The task builder was fixed afterwards, and the run's numbers stand as measured. The one-shot setup's final test was held back, so the run cannot say how much of the gain came from it. Academy desk ran with high reasoning and used about three times the blank setup's spend.",
    from: 'third',
  },
  {
    title: 'A policy written for the test.',
    text: "The Real academy's policy was drafted for this test and awaits the academy's confirmation. Its follow-up and history numbers came from the generated academies, so transfer to it is weaker evidence than Harborview's, which uses numbers no taught academy has.",
    from: 'academyDesk',
  },
  {
    title: 'Settings differ by arm.',
    text: 'The blank setup ran at temperature 1 with a 16-turn limit and low reasoning. The one-shot setup and Academy desk ran at temperature 0 with 30 turns and medium reasoning. Each row compares a whole configuration.',
    from: 'academyDesk',
  },
  {
    title: 'A scripted study and a patched runner.',
    text: 'A script confirmed the study brief, not a person. The comparisons runner was a patched copy outside the repository.',
    from: 'academyDesk',
  },
  {
    title: 'Two desks of one kind.',
    text: 'Both are returns desks, made by the same generator for a made-up shop. They test one kind of job, not other businesses.',
    from: 'plan',
  },
  {
    title: 'One seed.',
    text: 'Each final test was taken under seed 101. A second seed, 102, was declared and not run, so no result here is under it. Self-reflection, where the student refines the setup itself, was not one of the arms in either comparison.',
    from: 'second',
  },
  {
    title: 'Glimmer served online.',
    text: 'The returns desk figures are from Glimmer served online. The smaller build that runs on your computer has not taken those final tests, and none of these agents has trained weights.',
    from: 'second',
  },
  {
    title: 'A target met is not proof.',
    text: 'Meeting the 95% target as observed is not proof of 95% reliability. The interval around 58 of 60 runs from 88.6% to 99.1%. Gains seen while developing lean upward, so only the final test is claimed.',
    from: 'second',
  },
  {
    title: 'One certificate run, on hosted Glimmer.',
    text: 'The certificate run used one set of five seeds at temperature 0, which makes agreement a weak signal. Its calibration tasks come from generated academies, and its check on the Real academy had 10 tasks on a drafted policy. Five attempts that all ran out of steps counted as agreement, a flaw fixed after the run. Counterexample repair is built and tested on stand-ins and on the generated academy practice data only.',
    from: 'cert',
  },
  {
    title: 'The repair shop ran once.',
    text: 'It was a single run, not a planned comparison, and a rule graded it.',
    from: 'hackathon',
  },
];

/** The headline figures under the abstract. */
const HEADLINE: readonly { figure: string; text: string }[] = [
  {
    figure: '24 to 43',
    text: 'of 48 tasks on a generated academy that Academy desk had never seen. Difference +39.6 points, 95% interval +22.9 to +53.7.',
  },
  {
    figure: '15 to 31',
    text: 'of 48 tasks on Juniper Study House, another generated academy it had never seen, in the third run. Difference +33.3 points, 95% interval +16.2 to +47.5.',
  },
  {
    figure: '13 to 3',
    text: 'of 30 tasks on the Real academy, anonymized, in the third run: worse, -33.3 points (-50.3 to -14.2). In the first run it was 9 to 12 of 24, no gain shown.',
  },
];

const TAUGHT = "Glimmer after Spark's teaching";
const ALONE = 'Glimmer on its own';
const ONE_SHOT = "Spark's one-shot setup";

export function ResultsPage() {
  const second = {
    taught: arm(SECOND, TAUGHT),
    alone: arm(SECOND, ALONE),
    oneShot: arm(SECOND, ONE_SHOT),
    againstAlone: pair(SECOND, 'Teaching against Glimmer on its own'),
    againstOneShot: pair(SECOND, 'Teaching against the one-shot setup'),
  };
  const first = {
    taught: arm(FIRST, TAUGHT),
    alone: arm(FIRST, ALONE),
    spark: arm(FIRST, 'Spark doing the job itself'),
    againstAlone: pair(FIRST, 'Teaching against Glimmer on its own'),
  };
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
          <h2 className="t-h2 mt-12">Abstract</h2>
          <p className="t-read mt-4">
            <Actors
              text={`Architect turns an organization's own material into a specialist that runs on its own computer. A large model, Spark, studies the material and teaches a small one, Glimmer, by changing its instructions and small tools. A change is kept only if it raises the score on check tasks Spark never sees. In the run on test-prep academies, Spark taught Glimmer to be Academy desk, an agent that helps academy staff after a student's wrong answer, on three generated academies. A sealed test of ${FIELD_TEST_SIZE} tasks then included a fourth generated academy and a real one that neither model had seen. On the fourth, Academy desk passed 43 of 48 tasks and Glimmer on a blank setup 24. On the real academy, Academy desk passed 12 of 24 and the blank setup 9, a difference whose interval includes zero, so no gain is shown there. Academy desk was then frozen and taken again on the build of Glimmer that runs on one graphics card, where it passed ${LOCAL_ROWS[3]?.local} of ${FIELD_TEST_SIZE} tasks against ${LOCAL_ROWS[3]?.hosted} hosted, with no difference shown, and took about four times as long. A third run, taught on three other generated academies, showed a gain again on an unseen one, ${THIRD_ROWS[1]?.bare.passed} to ${THIRD_ROWS[1]?.academyDesk.passed} of 48, and did worse on a second snapshot of the real academy, ${THIRD_ROWS[2]?.bare.passed} to ${THIRD_ROWS[2]?.academyDesk.passed} of 30, where the instructions and tools it was taught did not fit the real academy's wording and policy. A first live certificate for that Academy desk was refused: answering only when five attempts agreed, it was wrong on 14 of the 46 calibration tasks it would have answered. In an earlier run on one job, a returns desk, teaching took Glimmer from ${second.alone.passed} to ${second.taught.passed} of ${TEST_SIZE} requests for 42 cents of Spark. Every figure is under one seed, and all but the local check are from Glimmer served online.`}
            />
          </p>
          <ul className="m-0 mt-10 grid list-none gap-x-8 gap-y-6 border-y border-line p-0 py-8 sm:grid-cols-3">
            {HEADLINE.map((item) => (
              <li key={item.figure} className="flex flex-col gap-3">
                <span className="t-h1 leading-none tabular-nums">{item.figure}</span>
                <span className="t-small text-pretty">
                  <Actors text={item.text} />
                </span>
              </li>
            ))}
          </ul>
        </section>

        <Section id="field" number={1} title="An operations agent for test-prep academies">
          <Subsection number="1.1" title="The run" />
          <Text>
            <Actors text="Academy desk is Glimmer with the instructions and small tools Spark built for it. A student has just missed a practice question, and staff ask Academy desk what to do. Academy desk answers from the academy's own files: its topic labels, question bank, practice tests, student answers, hints, videos and tutoring policy. A program checks facts and file changes, never wording" />
            <Cite to={['academyDesk']} />.
          </Text>
          <Text>
            <Actors text="Spark studied the files of three generated academies, which differ in topic labels, id formats, question wording and policy numbers. Glimmer practiced on them, and Spark changed its setup over three rounds. Then everything was frozen and a sealed test of 120 tasks was opened once. It has three groups: held-out tasks from the three academies Academy desk was taught on (48), a fourth generated academy, Harborview Prep, that neither model had seen (48), and a real tutoring academy, anonymized, that neither had seen (24). Harborview's policy uses numbers no taught academy has" />
            <Cite to={['academyDesk']} />.
          </Text>
          <Text>
            <Actors text="The real academy's records give topic labels, right and chosen answers and history, but no question text. Only three skills could be checked there: diagnose (the topic and the right answer), history and assign. Its records are not published" />
            <Cite to={['academyDesk']} />.
          </Text>
          <Text>
            <Actors text="Three setups took the same test: Glimmer on a blank setup, Spark's one-shot setup, written once from the study and kept without a check, and Academy desk, which starts from that setup and gets up to three rounds of teaching" />
            <Cite to={['academyDesk']} />.
          </Text>

          <Subsection number="1.2" title="Final-test results" />
          <Text>
            <Actors
              text={`Across all ${FIELD_TEST_SIZE} tasks Academy desk passed ${FIELD_ARMS[2]?.all.passed}, the blank setup ${FIELD_ARMS[0]?.all.passed} and the one-shot setup ${FIELD_ARMS[1]?.all.passed} (Figure 1, Table 1).`}
            />
          </Text>
          <Exhibit
            label="Figure 1"
            caption="Final-test passes by setup in each group of organizations, with 95% intervals."
          >
            <div className="flex flex-col gap-8">
              {GROUPS.map((group, index) => (
                <FieldPassRates key={group.short} index={index} />
              ))}
            </div>
          </Exhibit>
          <Text>
            <Actors text="On Harborview Prep, which Academy desk never saw, it passed 43 of 48 and the blank setup 24. Matched task by task, Academy desk won 20 tasks the blank setup failed and lost 1, a difference of +39.6 points with a 95% interval of +22.9 to +53.7. A gain is shown on that one generated academy. The wins came from assign (7), the tutoring turn (6), hint (3) and history (3). Solve was 8 of 8 for every setup" />
            <Cite to={['academyDesk']} />.
          </Text>
          <Text>
            <Actors text="On the real academy, Academy desk passed 12 of 24 and the blank setup 9. The difference is +12.5 points with an interval from -17.9 to +40.2, so no gain is shown (Figure 2, Table 2). By skill, assign went from 0 of 8 to 7 of 8, history fell from 5 to 3 and diagnose from 4 to 2. Eight tasks of a skill, from 16 students, are too few to call any of these a difference in either direction" />
            <Cite to={['academyDesk']} />.
          </Text>
          <Text>
            <Actors text="The one-shot setup showed no gain over the blank setup in any group. Its intervals all include zero" />
            <Cite to={['academyDesk']} />.
          </Text>
          <Exhibit
            table
            label="Table 1"
            caption="Passes by skill and organization, out of the tasks in each cell. The Real academy had no tasks for solve, hint and the tutoring turn."
          >
            <SkillTable />
          </Exhibit>
          <Exhibit
            label="Figure 2"
            caption="Differences in final-test pass rate for Academy desk, matched task by task, in percentage points with 95% intervals."
          >
            <FieldPairForest />
          </Exhibit>
          <Exhibit
            table
            label="Table 2"
            caption="Tasks the first setup passed and the second failed (won), the reverse (lost), and where they agreed. The two comparisons that were planned as primary are Academy desk against a blank setup on Harborview Prep and on the Real academy."
          >
            <FieldPairTable />
          </Exhibit>

          <Subsection number="1.3" title="The three rounds" />
          <Text>
            <Actors
              text={`Teaching took about 15 minutes and 31 cents of Spark. Two changes were kept and one was reverted (Table 3). The whole run cost Spark about ${dollars(FIELD_MONEY.spark)}, including about 8 cents of estimates, and the hosted Glimmer ${dollars(FIELD_MONEY.glimmer)}`}
            />
            <Cite to={['academyDesk']} />.
          </Text>
          <Exhibit
            table
            label="Table 3"
            caption="Each round of teaching for Academy desk: the change, check tasks before and after, the same change measured again on new seeds, and the result."
          >
            <RoundList rounds={ROUNDS_FIELD} label="Rounds of teaching for Academy desk" />
          </Exhibit>

          <Subsection number="1.4" title="Where Academy desk missed on the real academy" />
          <Text>
            <Actors text="The stored records keep pass or fail and the checker's reason, not Academy desk's replies. So these causes come from replaying Academy desk's own tools against the real academy's files, with no model, after the test was retired" />
            <Cite to={['academyDesk']} />.
          </Text>
          <Text>
            <span className="font-semibold">Diagnose.</span> Six of eight tasks ended at the step
            limit. The question lookup tool finds a test by its section. In 11 of the 19 practice
            tests the records list the section as Full, so the tool answered that it could not find
            the position for seven of the eight requests. Glimmer on a blank setup, which has no
            rule against reading the files whole, passed all four Reading and Writing tasks. Academy
            desk passed two.
          </Text>
          <Text>
            <span className="font-semibold">History.</span> One task failed because the helper
            counts an answer right only when the picked text equals the key, and the academy marks
            11 answers right that were written another way. Three failed on the date: the agent was
            told it was Nov 16, and the real academy's requests said Oct 30. The date cause fits the
            records and is not confirmed by them.
          </Text>

          <Subsection number="1.5" title="On this computer" />
          <Text>
            <Actors
              text={`Academy desk was then frozen as it was and took the same ${FIELD_TEST_SIZE} tasks again on the 2-bit Glimmer that runs on one graphics card with 12 GB, through Ollama. Nothing was taught or tuned for this check, and the test had already been opened. Academy desk passed ${LOCAL_ROWS[3]?.local} of ${FIELD_TEST_SIZE}, against ${LOCAL_ROWS[3]?.hosted} hosted. The difference is ${signed(LOCAL_ROWS[3]?.diff ?? 0)} points with a 95% interval of ${signed(LOCAL_ROWS[3]?.low ?? 0)} to ${signed(LOCAL_ROWS[3]?.high ?? 0)}, and no group shows a difference (Table 4). The median task took ${LOCAL_SPEED.medianLocal} s here and ${LOCAL_SPEED.medianHosted} s hosted, and the slowest 5% took over ${LOCAL_SPEED.slowestLocal} s here against ${LOCAL_SPEED.slowestHosted} s. Tasks that reached the step limit numbered ${LOCAL_SPEED.stepLimitLocal} here and ${LOCAL_SPEED.stepLimitHosted} hosted. The untaught Glimmer did not finish on the Real academy locally, so the check does not show how that build does without Academy desk's setup`}
            />
            <Cite to={['local']} />.
          </Text>
          <Exhibit
            table
            label="Table 4"
            caption="Academy desk's final-test passes on this computer and hosted, with the tasks won and lost on this computer, and the difference with its 95% interval."
          >
            <LocalTable />
          </Exhibit>

          <Subsection number="1.6" title="A third run" />
          <Text>
            <Actors
              text={`A second run stopped twice before any result was read: first its budget ran out, then the runner opened two final tests at once. A third run replaced it on the same ${THIRD_TEST_SIZE} tasks. Spark studied three other generated academies and taught Glimmer on them over two rounds, and both changes were kept. The sealed test held 48 tasks from those academies, 48 from Juniper Study House, a generated academy neither model had seen, and 30 from a second anonymized snapshot of the real academy, from 17 students. The one-shot setup's final test was held back and never run, so the blank setup and Academy desk took it (Table 5). The run cost ${dollars(THIRD_MONEY.spark)} of Spark and ${dollars(THIRD_MONEY.glimmer)} of hosted Glimmer`}
            />
            <Cite to={['third']} />.
          </Text>
          <Exhibit
            table
            label="Table 5"
            caption="The third run: final-test passes for the blank setup and Academy desk in each group, with 95% intervals, and Academy desk against the blank setup task by task, with the difference in points and its 95% interval. The primary comparisons are Juniper Study House and the Real academy."
          >
            <ThirdTable />
          </Exhibit>
          <Text>
            <Actors text="On Juniper Study House, Academy desk passed 31 of 48 and the blank setup 15. It won 18 tasks and lost 2, a difference of +33.3 points with a 95% interval of +16.2 to +47.5, so a gain is shown. It came from assign, history and hint. On the taught academies the difference was +18.8 points, with an interval just above zero" />
            <Cite to={['third']} />.
          </Text>
          <Text>
            <Actors text="On the Real academy, Academy desk passed 3 of 30 and the blank setup 13. The difference is -33.3 points with an interval of -50.3 to -14.2, so Academy desk did worse there, not only no better. It lost 7 history tasks and 3 diagnose tasks and won none. The records keep no replies, so the causes below come from replaying Academy desk's tools on the Real academy's files and checking its rules against the wording of the requests, with no model, after the test" />
            <Cite to={['thirdMisses']} />.
          </Text>
          <Text>
            <span className="font-semibold">Diagnose.</span> Academy desk loads its diagnose
            instructions when a request says something like &quot;what topic&quot; or &quot;right
            choice&quot;. The Real academy asks &quot;Which topic was that, and what was the right
            answer?&quot;, so none of its 10 requests matched, while every generated academy&apos;s
            did. Five of the seven misses answered within two seconds, which fits answering without
            looking anything up.
          </Text>
          <Text>
            <span className="font-semibold">History.</span> Replayed with the inputs the Real
            academy&apos;s policy gives, the history tool returns the expected result on all 10
            tasks, yet every attempt ran to the 30-step limit without answering. The instructions
            ask for a number of days that this policy doesn&apos;t have, and the second round
            allowed one tool call per turn. That fits the records, and without replies it is not
            confirmed.
          </Text>
          <Text>
            <span className="font-semibold">Assign.</span> Both setups scored 0 of 10. The Real
            academy&apos;s assignments file is empty, and its drafted policy never says how to
            number the first row, so no setup could pass these tasks. The task builder was fixed
            afterwards, and the run&apos;s numbers stand as measured.
          </Text>

          <Subsection number="1.7" title="Direction" />
          <Text>
            <Actors text="The larger idea is that the same loop, run over many organizations of one field, would give verified curricula and checkable rewards, which models built for a field need. These runs do not show that. They cover one field, six taught academies, two unseen generated academies and two snapshots of one real academy, with 24 and 30 tasks, and on the second snapshot the taught agent did worse than the untaught one" />
            <Cite to={['academyDesk', 'third']} />.
          </Text>
        </Section>

        <Section id="setup" number={2} title="Setup">
          <Text>
            <Actors text="The earlier returns desk runs used one job and no organizations. Glimmer, a small open-weight model, took the same final test three ways: on its own, with a one-shot setup written by Spark, and after Spark watched it fail and taught it" />
            <Cite to={['plan']} />.
          </Text>
          <Text>
            <Actors
              text={`Each final test has ${TEST_SIZE} requests Glimmer has never seen, ${PER_TYPE} of each kind: refunds, order questions and pickups. Nothing Spark does can touch it. It is opened once, after every setup is frozen, and a program grades it.`}
            />
          </Text>
          <Text>
            Improving an agent from its failures is already published work, such as GEPA
            <Cite to={['gepa']} /> and ACE
            <Cite to={['ace']} />. Checking an agent's work by the state it leaves behind has
            precedent too, in tau-bench
            <Cite to={['taubench']} />. Architect puts these ideas into one product you can inspect.
            It has a sealed final test, a checker that is the same every time, and a result that
            runs offline.
          </Text>
          <Text>
            <Actors text="Teaching runs in rounds (Figure 3). Spark reads Glimmer's failed practice attempts and makes one change to its instructions or small tools. The change is kept only if check-task passes rise by at least 2 a run, measured again on new seeds over 2 runs, and no kind of task loses more than 1. Spark sees the check-task score, never the tasks" />
            <Cite to={['plan', 'second']} />.
          </Text>
          <Exhibit
            label="Figure 3"
            caption="The job's tasks, cut once into four sets, and the five steps of a round of teaching. The final test stays sealed until every setup is frozen."
          >
            <RoundDiagram />
          </Exhibit>
        </Section>

        <Section id="results" number={3} title="Final-test results">
          <Subsection number="3.1" title="A new returns desk" />
          <Text>
            <Actors
              text={`Teaching could run up to 8 rounds. After it, Glimmer passed ${second.taught.passed} of ${TEST_SIZE}, against ${second.alone.passed} on its own and ${second.oneShot.passed} with Spark's one-shot setup (Figure 4, Table 6)`}
            />
            <Cite to={['second']} />.
          </Text>
          <Exhibit
            label="Figure 4"
            caption="Final-test passes by arm on the new returns desk, with 95% intervals. The dashed line is the job's target."
          >
            <PassRates comparison={SECOND} />
          </Exhibit>
          <Exhibit table label="Table 6" caption="Passes by kind of request, of 20 each.">
            <ArmTable comparison={SECOND} />
          </Exhibit>
          <Text>
            <Actors
              text={`Matched request by request, the taught Glimmer won ${second.againstAlone.wins} requests that Glimmer alone failed and lost ${second.againstAlone.losses}, a difference of ${signed(second.againstAlone.diff)} points (95% interval ${interval(second.againstAlone)}). Against the one-shot setup it won ${second.againstOneShot.wins} and lost ${second.againstOneShot.losses} (Figure 5, Table 7).`}
            />
          </Text>
          <Exhibit
            label="Figure 5"
            caption="Differences in final-test pass rate between arms, matched request by request, in percentage points with 95% intervals."
          >
            <PairForest comparison={SECOND} />
          </Exhibit>
          <Exhibit
            table
            label="Table 7"
            caption="Requests each arm passed and the other failed (won), the reverse (lost), and where they agreed."
          >
            <PairTable comparison={SECOND} />
          </Exhibit>

          <Subsection number="3.2" title="The first returns desk" />
          <Text>
            <Actors
              text={`On the returns desk that ships with the app, teaching was held to two rounds. Glimmer passed ${first.taught.passed} of ${TEST_SIZE} after teaching against ${first.alone.passed} on its own, and Spark answering every request itself passed ${first.spark.passed} (Figure 6, Table 8)`}
            />
            <Cite to={['first']} />.
          </Text>
          <Exhibit
            label="Figure 6"
            caption="Final-test passes by arm on the first returns desk, with 95% intervals, and Spark answering the requests itself as a fourth arm."
          >
            <PassRates comparison={FIRST} />
          </Exhibit>
          <Exhibit table label="Table 8" caption="Passes by kind of request, of 20 each.">
            <ArmTable comparison={FIRST} />
          </Exhibit>
          <Text>
            <Actors
              text={`Request by request, teaching won ${first.againstAlone.wins} and lost ${first.againstAlone.losses} against Glimmer alone. The interval around that difference, ${interval(first.againstAlone)} points, includes zero, so this comparison shows no gain (Figure 7, Table 9). The second comparison was designed after seeing it, with the budget the job gives teaching, and its plan was published before it ran`}
            />
            <Cite to={['plan']} />.
          </Text>
          <Exhibit
            label="Figure 7"
            caption="Differences in final-test pass rate between arms on the first returns desk, in percentage points with 95% intervals."
          >
            <PairForest comparison={FIRST} />
          </Exhibit>
          <Exhibit
            table
            label="Table 9"
            caption="Requests won and lost in each pairing, as in Table 7."
          >
            <PairTable comparison={FIRST} />
          </Exhibit>
        </Section>

        <Section id="rounds" number={4} title="Teaching, round by round">
          <Text>
            <Actors text="On the new returns desk the check-task score rose from 31 of 45 to 44 of 45 in four rounds. Two changes were kept and two were reverted, and teaching stopped when the target was reached (Figure 8, Table 10)" />
            <Cite to={['second']} />.
          </Text>
          <Exhibit
            label="Figure 8"
            caption="Check tasks passed on the new returns desk after each round. Hollow points are changes that were measured and reverted; the line follows what was kept."
          >
            <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
              <span className="font-display text-hero font-semibold leading-none tabular-nums max-sm:text-title">
                98%
              </span>
              <span className="tabular-nums">44 of 45, from 31 of 45 to start</span>
            </div>
            <ScoreChart className="mb-8" times={{ rise1: 0, hollow2: 0, hollow3: 0, rise4: 0 }} />
          </Exhibit>
          <Exhibit
            table
            label="Table 10"
            caption="Each round on the new returns desk: the change, check tasks before and after, the same change measured again on new seeds, and the result."
          >
            <RoundList rounds={ROUNDS_SECOND} label="Rounds of teaching on the new returns desk" />
          </Exhibit>
          <Text>
            On the first returns desk, teaching was held to 2 rounds after the draft and stopped
            there, with the cap reached. One change was kept (Table 11)
            <Cite to={['first']} />.
          </Text>
          <Exhibit
            table
            label="Table 11"
            caption="Each round on the first returns desk, as in Table 10."
          >
            <RoundList rounds={ROUNDS_FIRST} label="Rounds of teaching on the first returns desk" />
          </Exhibit>
          <Text>
            <Actors
              text={`On a second kind of job, a repair shop's ticket costs, one round took Glimmer from ${REPAIR.checkBefore} of ${REPAIR.checkTotal} check tasks to ${REPAIR.checkAfter} of ${REPAIR.checkTotal}: Spark's first draft, a ticket-cost tool and a lookup. It then passed ${REPAIR.finalPassed} of ${REPAIR.finalTotal} on its final test, graded by the rule the shop confirmed, for ${REPAIR.cents} cents in all`}
            />
            <Cite to={['hackathon']} />.
          </Text>
        </Section>

        <Section id="time" number={5} title="Speed and cost">
          <Text>
            <Actors
              text={`After teaching, Glimmer's median answer took ${second.taught.p50} s, and its slowest 5% finished within ${second.taught.p95} s. On its own, its median answer took ${second.alone.p50} s (Figure 9)`}
            />
            <Cite to={['second']} />.
          </Text>
          <Exhibit
            label="Figure 9"
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
          <Text>
            Teaching cost 42 cents of Spark: 34 for the rounds and 8 for its first setup. The whole
            run cost Spark ${MONEY.spark.toFixed(4)} and the hosted Glimmer $
            {MONEY.glimmer.toFixed(4)}, as its attempts recorded it (Table 12)
            <Cite to={['second', 'readme']} />.
          </Text>
          <Exhibit table label="Table 12" caption="What each arm cost on the new returns desk.">
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
          </Exhibit>
        </Section>

        <Section id="scale" number={6} title="From a specialist to a field model">
          <Text>
            <Actors text="A field's work leaves three things besides the specialist. Verified demonstrations are worked examples from train tasks that the checker confirmed, each with its source and what it may be used for. An outcome scorer packages the field's train tasks and checker so an outside training framework can ask for a score. Sealed evaluations are organizations a model never trained on, opened once for a frozen candidate" />
            <Cite to={['scale']} />.
          </Text>
          <Text>
            <Actors text="From a model's own configuration on Hugging Face, Architect sizes a training job: the memory for weights, their updates, optimizer state and activations, then the GPUs and nodes. For a Slurm cluster or Kubernetes it writes a launch bundle and shows the command to run with your own tools. Architect never holds cluster credentials" />
            <Cite to={['scale']} />.
          </Text>
          <Text>
            <Actors text="Architect develops and evaluates field-specific agent setups, meaning instructions and small tools, and exports checker-verified training examples. Experimental cluster templates are validated structurally and against simulated schedulers; GPU execution, large-model compatibility and training gains remain unverified" />
            <Cite to={['scale']} />.
          </Text>
          <Exhibit
            table
            label="Table 13"
            caption="Each part of the path from a specialist to a field model, by whether it is measured, built, unverified or future."
          >
            <Table
              label="What is measured, built and future on the path to a field model"
              left={[0, 1, 2]}
              columns={['Part', 'Status', 'What backs it']}
              rows={SCALE_STATUS.map(([part, status, backing]) => [part, status, backing])}
            />
          </Exhibit>
        </Section>

        <Section id="certified" number={7} title="Certified answers and counterexamples">
          <Text>
            <Actors text="A specialist should know when not to answer. Architect can state a certificate for a finished one, in a sentence of this form: when Academy desk answers, it is wrong on at most 8% of requests like these, with 95% confidence, and it handed 22% to a person. Those two numbers show the form. They are not a measurement of Academy desk" />
            <Cite to={['certify']} />.
          </Text>
          <Text>
            <Actors text="Academy desk attempts each request in a sealed calibration set five times, and the share of attempts that agree decides whether it answers or hands the request to a person. The calibration set comes from the taught organizations, is kept apart from every other set, and Spark never sees it. For each agreement threshold, the error among the answered requests gets an exact one-sided Clopper-Pearson upper bound, and the loosest threshold whose bound stays under the target is chosen by testing from the strictest down. The method follows conformal risk control, Learn-then-Test and conformal abstention" />
            <Cite to={['crc', 'ltt', 'abstention']} />
            <Actors text=". The same frozen threshold then runs on the sealed test and on each organization the models never saw, and the report says whether the bound held there. A small calibration set gives a wide bound, and the report shows it wide. If no threshold qualifies, no certificate is issued" />
            <Cite to={['certify']} />.
          </Text>
          <Text>
            <Actors text="The second piece is for the small tools Spark writes. When a tool gives a wrong result on practice data, Architect shrinks the failing case by delta debugging" />
            <Cite to={['zeller']} />
            <Actors text=" and hands Spark the smaller case. The repair has to pass it and every earlier one, and each case stays as a regression test. On a generated academy's practice data, a question lookup that failed on tests laid out as Full shrank from 2,312 rows to 4. This shows a reproducible defect in a tool, not why the model reasoned as it did" />
            <Cite to={['certify']} />.
          </Text>
          <Text>
            <Actors text="Both are built and tested, the certificate with stand-in models from calibration to chat and the reduction in the real sandbox on the academy's practice data. Neither idea is new. What the work adds is the pipeline in a product: a checker that is the same every time, sets the teacher never saw, and a check on organizations it never saw" />
            <Cite to={['certify']} />.
          </Text>
          <Text>
            <Actors
              text={`The first live run asked for a certificate on the third run's Academy desk, frozen as it was, with hosted Glimmer: ${CERT.calibration} calibration tasks from the taught academies that its run never touched, ${CERT.attempts} attempts each, and a target of at most ${CERT.target}% wrong among answered requests at ${CERT.confidence}% confidence. No certificate was issued. Even answering only when all five attempts agreed, Academy desk would have answered ${CERT_ROWS[0]?.answered} of ${CERT.calibration} and been wrong on ${CERT_ROWS[0]?.wrong}, an upper bound of ${CERT_ROWS[0]?.bound.toFixed(1)}% (Table 14). Its errors were confident ones. On the tutoring turn, all 7 tasks it answered with five attempts in agreement were wrong, while solve was right on all 15. At temperature 0 the five attempts differ only by the provider's own variation, so a wrong answer repeats as reliably as a right one. The certificate refused to vouch for a model that was confidently wrong, which is the point of certifying`}
            />
            <Cite to={['cert']} />.
          </Text>
          <Exhibit
            table
            label="Table 14"
            caption="The first live certificate run. For each agreement threshold: the calibration tasks Academy desk would answer, of 60, how many of those were wrong, the share handed to staff, and the one-sided 95% upper bound on the error rate among answered tasks, against a 10% target; then the same thresholds on the Real academy's 10 check tasks. No threshold met the target, so no certificate was issued."
          >
            <CertTable />
          </Exhibit>
          <Text>
            <Actors
              text={`The check ran on the Real academy's first snapshot, ${CERT.checkTasks} tasks of diagnose and history, and got none right. At full agreement Academy desk would have answered ${CERT_ROWS[0]?.realAnswered}, all wrong, and handed 2 to staff. On every history task all five attempts ran out of steps, and the run counted five such cut-offs as agreement on "no answer", graded wrong instead of handed off. That flaw also made 3 of the 14 calibration errors, and it was fixed after this run. The run took ${CERT.runs} attempts and cost ${dollars(CERT.usd)} of hosted Glimmer, with no Spark and no local GPU`}
            />
            <Cite to={['cert']} />.
          </Text>
        </Section>

        <Section id="limits" number={8} title="Limitations">
          <Text>
            <Actors text="Glimmer served online and one seed throughout, a small real sample, and made-up businesses elsewhere." />
          </Text>
          {LIMITS.map((limit) => (
            <Text key={limit.title}>
              <span className="font-semibold">{limit.title}</span>{' '}
              <Actors text={limit.text.replace(/\.$/, '')} />
              <Cite to={[limit.from]} />.
            </Text>
          ))}
        </Section>

        <section
          id="references"
          aria-labelledby="references-title"
          className="article flex scroll-mt-20 flex-col gap-6 pt-16 sm:pt-20"
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
