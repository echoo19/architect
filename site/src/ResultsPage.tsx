import { Fragment, type ReactNode } from 'react';
import { ArrowUpRight } from 'lucide-react';
import { REPORTS } from './content';
import {
  FIRST,
  MONEY,
  PER_TYPE,
  REPAIR,
  ROUNDS_FIRST,
  ROUNDS_SECOND,
  SECOND,
  sourceUrl,
  SOURCES,
  TARGET_PASSES,
  TEST_SIZE,
  TYPES,
  type Arm,
  type Comparison,
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
type RefKey = SourceKey | 'gepa' | 'ace' | 'taubench';

/** Published papers cited, by their arXiv number; the page links to no address but the repository. */
const PAPERS: Partial<Record<RefKey, string>> = {
  gepa: 'arXiv 2507.19457',
  ace: 'arXiv 2510.04618',
  taubench: 'arXiv 2406.12045',
};

const REFERENCES: readonly { key: RefKey; what: string }[] = [
  { key: 'plan', what: "The second comparison's plan, published before it ran." },
  { key: 'second', what: "The second comparison's report." },
  { key: 'first', what: "The first comparison's report." },
  { key: 'hackathon', what: "The repair shop's run." },
  { key: 'readme', what: 'The project overview.' },
  { key: 'gepa', what: 'GEPA: improving prompts from failures by reflection.' },
  { key: 'ace', what: 'ACE: agents that grow their own context from experience.' },
  { key: 'taubench', what: 'tau-bench: checking an agent by the final state of its work.' },
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
    <figcaption className="text-pretty">
      <span className="font-semibold">{label}.</span> {caption}
    </figcaption>
  );
  return (
    <Reveal>
      <figure className="m-0 flex flex-col gap-5 rounded-card bg-card px-7 py-6 shadow-edge max-sm:px-4 max-sm:py-5">
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
      className="article flex scroll-mt-16 flex-col gap-6 pt-14 sm:pt-16"
    >
      <h2 id={`${id}-title`} className="t-h1">
        <span className="mr-3 tabular-nums">{number}</span>
        {title}
      </h2>
      {children}
    </section>
  );
}

function Subsection({ number, title }: { number: string; title: string }) {
  return (
    <h3 className="m-0 mt-4 font-display text-h2 font-semibold">
      <span className="mr-3 tabular-nums">{number}</span>
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
        className={`w-full border-collapse text-left tabular-nums ${fit ? '' : 'min-w-[640px]'}`}
      >
        <thead>
          <tr>
            {columns.map((column, index) => (
              <th
                key={column}
                scope="col"
                className={`py-3 pr-4 font-medium ${left.includes(index) ? '' : 'whitespace-nowrap text-right'}`}
              >
                {column === '' ? <span className="sr-only">Arm</span> : column}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => (
            <tr key={index} className="border-t border-line">
              {row.map((cell, cellIndex) => (
                <td
                  key={cellIndex}
                  className={`py-3 pr-4 ${cellIndex === 0 ? 'min-w-[10rem] font-medium' : ''} ${left.includes(cellIndex) ? '' : 'whitespace-nowrap text-right'}`}
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

const armLabel = (arm: Arm) => (
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
              Check tasks {round.before} to {round.after} of 45
              {round.again && `, measured again ${round.again[0]} to ${round.again[1]} of 90`}
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

const LIMITS: readonly { title: string; text: string; from: SourceKey }[] = [
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
    text: 'Every figure is from Glimmer served online. The smaller build that runs on your computer has not taken the final test, and none of these agents has trained weights.',
    from: 'second',
  },
  {
    title: 'A target met is not proof.',
    text: 'Meeting the 95% target as observed is not proof of 95% reliability. The interval around 58 of 60 runs from 88.6% to 99.1%. Gains seen while developing lean upward, so only the final test is claimed.',
    from: 'second',
  },
  {
    title: 'The repair shop ran once.',
    text: 'It was a single run, not a planned comparison, and a rule graded it.',
    from: 'hackathon',
  },
];

/** The headline figures under the abstract. */
const HEADLINE: readonly { figure: string; text: string }[] = [
  { figure: '44 to 58', text: 'of 60 requests Glimmer had never seen, on a new returns desk.' },
  {
    figure: '+23.3 points',
    text: 'against Glimmer on its own, with a 95% interval of +10.9 to +35.9.',
  },
  { figure: '42 cents', text: "of Spark's money paid for the teaching." },
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
        <section aria-labelledby="results-title" className="article pt-12 sm:pt-16">
          <h1 id="results-title" className="t-title">
            What teaching changed
          </h1>
          <p className="m-0 mt-4">Jake Kang · October 2026</p>
          <h2 className="m-0 mt-10 font-display text-h2 font-semibold">Abstract</h2>
          <p className="t-read mt-3">
            <Actors
              text={`A large model, Spark, taught a small one, Glimmer, a returns desk's job by changing its instructions and small tools, and kept a change only if it raised the score on check tasks Spark never sees. On a sealed final test of ${TEST_SIZE} requests Glimmer had never seen, the taught Glimmer passed ${second.taught.passed}, against ${second.alone.passed} on its own and ${second.oneShot.passed} with a one-shot setup from Spark. The teaching cost 42 cents. On an earlier desk, where teaching was held to two rounds, the gain was not distinguishable from zero. Both desks are made up, each final test ran under one seed, and Glimmer was served online.`}
            />
          </p>
          <ul className="m-0 mt-8 grid list-none gap-x-8 gap-y-5 border-y border-line p-0 py-6 sm:grid-cols-3">
            {HEADLINE.map((item) => (
              <li key={item.figure} className="flex flex-col gap-2.5">
                <span className="t-h1 leading-none tabular-nums">{item.figure}</span>
                <span className="text-pretty">
                  <Actors text={item.text} />
                </span>
              </li>
            ))}
          </ul>
        </section>

        <Section id="setup" number={1} title="Setup">
          <Text>
            <Actors text="Glimmer, a small open-weight model, took the same final test three ways: on its own, with a one-shot setup written by Spark, and after Spark watched it fail and taught it" />
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
            <Actors text="Teaching runs in rounds (Figure 1). Spark reads Glimmer's failed practice attempts and makes one change to its instructions or small tools. The change is kept only if check-task passes rise by at least 2 a run, measured again on new seeds over 2 runs, and no kind of task loses more than 1. Spark sees the check-task score, never the tasks" />
            <Cite to={['plan', 'second']} />.
          </Text>
          <Exhibit
            label="Figure 1"
            caption="The job's tasks, cut once into four sets, and the five steps of a round of teaching. The final test stays sealed until every setup is frozen."
          >
            <RoundDiagram />
          </Exhibit>
        </Section>

        <Section id="results" number={2} title="Final-test results">
          <Subsection number="2.1" title="A new returns desk" />
          <Text>
            <Actors
              text={`Teaching could run up to 8 rounds. After it, Glimmer passed ${second.taught.passed} of ${TEST_SIZE}, against ${second.alone.passed} on its own and ${second.oneShot.passed} with Spark's one-shot setup (Figure 2, Table 1)`}
            />
            <Cite to={['second']} />.
          </Text>
          <Exhibit
            label="Figure 2"
            caption="Final-test passes by arm on the new returns desk, with 95% intervals. The dashed line is the job's target."
          >
            <PassRates comparison={SECOND} />
          </Exhibit>
          <Exhibit table label="Table 1" caption="Passes by kind of request, of 20 each.">
            <ArmTable comparison={SECOND} />
          </Exhibit>
          <Text>
            <Actors
              text={`Matched request by request, the taught Glimmer won ${second.againstAlone.wins} requests that Glimmer alone failed and lost ${second.againstAlone.losses}, a difference of ${signed(second.againstAlone.diff)} points (95% interval ${interval(second.againstAlone)}). Against the one-shot setup it won ${second.againstOneShot.wins} and lost ${second.againstOneShot.losses} (Figure 3, Table 2).`}
            />
          </Text>
          <Exhibit
            label="Figure 3"
            caption="Differences in final-test pass rate between arms, matched request by request, in percentage points with 95% intervals."
          >
            <PairForest comparison={SECOND} />
          </Exhibit>
          <Exhibit
            table
            label="Table 2"
            caption="Requests each arm passed and the other failed (won), the reverse (lost), and where they agreed."
          >
            <PairTable comparison={SECOND} />
          </Exhibit>

          <Subsection number="2.2" title="The first returns desk" />
          <Text>
            <Actors
              text={`On the returns desk that ships with the app, teaching was held to two rounds. Glimmer passed ${first.taught.passed} of ${TEST_SIZE} after teaching against ${first.alone.passed} on its own, and Spark answering every request itself passed ${first.spark.passed} (Figure 4, Table 3)`}
            />
            <Cite to={['first']} />.
          </Text>
          <Exhibit
            label="Figure 4"
            caption="Final-test passes by arm on the first returns desk, with 95% intervals, and Spark answering the requests itself as a fourth arm."
          >
            <PassRates comparison={FIRST} />
          </Exhibit>
          <Exhibit table label="Table 3" caption="Passes by kind of request, of 20 each.">
            <ArmTable comparison={FIRST} />
          </Exhibit>
          <Text>
            <Actors
              text={`Request by request, teaching won ${first.againstAlone.wins} and lost ${first.againstAlone.losses} against Glimmer alone. The interval around that difference, ${interval(first.againstAlone)} points, includes zero, so this comparison shows no gain (Figure 5, Table 4). The second comparison was designed after seeing it, with the budget the job gives teaching, and its plan was published before it ran`}
            />
            <Cite to={['plan']} />.
          </Text>
          <Exhibit
            label="Figure 5"
            caption="Differences in final-test pass rate between arms on the first returns desk, in percentage points with 95% intervals."
          >
            <PairForest comparison={FIRST} />
          </Exhibit>
          <Exhibit
            table
            label="Table 4"
            caption="Requests won and lost in each pairing, as in Table 2."
          >
            <PairTable comparison={FIRST} />
          </Exhibit>
        </Section>

        <Section id="rounds" number={3} title="Teaching, round by round">
          <Text>
            <Actors text="On the new returns desk the check-task score rose from 31 of 45 to 44 of 45 in four rounds. Two changes were kept and two were reverted, and teaching stopped when the target was reached (Figure 6, Table 5)" />
            <Cite to={['second']} />.
          </Text>
          <Exhibit
            label="Figure 6"
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
            label="Table 5"
            caption="Each round on the new returns desk: the change, check tasks before and after, the same change measured again on new seeds, and the result."
          >
            <RoundList rounds={ROUNDS_SECOND} label="Rounds of teaching on the new returns desk" />
          </Exhibit>
          <Text>
            On the first returns desk, teaching was held to 2 rounds after the draft and stopped
            there, with the cap reached. One change was kept (Table 6)
            <Cite to={['first']} />.
          </Text>
          <Exhibit
            table
            label="Table 6"
            caption="Each round on the first returns desk, as in Table 5."
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

        <Section id="time" number={4} title="Speed and cost">
          <Text>
            <Actors
              text={`After teaching, Glimmer's median answer took ${second.taught.p50} s, and its slowest 5% finished within ${second.taught.p95} s. On its own, its median answer took ${second.alone.p50} s (Figure 7)`}
            />
            <Cite to={['second']} />.
          </Text>
          <Exhibit
            label="Figure 7"
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
            {MONEY.glimmer.toFixed(4)}, as its attempts recorded it (Table 7)
            <Cite to={['second', 'readme']} />.
          </Text>
          <Exhibit table label="Table 7" caption="What each arm cost on the new returns desk.">
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

        <Section id="limits" number={5} title="Limitations">
          <Text>
            <Actors text="Two made-up businesses, one seed, and a build of Glimmer that is not the one on your computer." />
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
          className="article flex scroll-mt-16 flex-col gap-5 pt-14 sm:pt-16"
        >
          <h2 id="references-title" className="t-h1">
            References
          </h2>
          <ol className="m-0 flex list-none flex-col gap-3 p-0">
            {REFERENCES.map((reference, index) => (
              <li
                key={reference.key}
                id={`ref-${reference.key}`}
                className="grid scroll-mt-20 grid-cols-[2.25rem_minmax(0,1fr)]"
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
          <a className="link-quiet inline-flex items-center gap-1.5" href={REPORTS}>
            The full reports on GitHub
            <ArrowUpRight size={16} strokeWidth={1.8} aria-hidden />
          </a>
        </section>
      </main>
      <Footer page="results" />
    </div>
  );
}
