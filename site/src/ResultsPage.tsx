import type { ReactNode } from 'react';
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
  type Round,
  type SourceKey,
} from './evidence';
import { Actors } from './components/Actors';
import { Chapter, type SectionCopy } from './components/Chapter';
import { Footer } from './components/Footer';
import { Forest, type ForestRow } from './components/Forest';
import { Header } from './components/Header';
import { Reveal } from './components/Reveal';
import { RoundDiagram } from './components/RoundDiagram';
import { ScoreChart } from './mock/score-chart';

/**
 * The results page: the evidence that is in the README and in docs/comparisons, set out so it can
 * be read: the same sealed final test taken three ways, the score round by round, answer time and
 * cost, how a round works, and what none of it shows. Every number is in `evidence.ts`, with the
 * document it comes from, and each block says which.
 */

const dollars = (value: number) => `$${value.toFixed(2)}`;
const signed = (value: number) => `${value > 0 ? '+' : ''}${value.toFixed(1)}`;

/** The documents a block rests on, each a link to the file. */
function Sources({ from }: { from: readonly SourceKey[] }) {
  return (
    <p className="t-small m-0 mt-8">
      Sources:{' '}
      {from.map((key, index) => (
        <span key={key}>
          {index > 0 && ', '}
          <a className="link-quiet" href={sourceUrl(key)}>
            {SOURCES[key].name}
          </a>
        </span>
      ))}
      .
    </p>
  );
}

function SubHeading({ children }: { children: ReactNode }) {
  return <h3 className="m-0 mb-5 font-display text-h2 font-semibold">{children}</h3>;
}

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
                  className={`py-3 pr-4 ${cellIndex === 0 ? 'font-medium' : ''} ${left.includes(cellIndex) ? '' : 'whitespace-nowrap text-right'}`}
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
      <span className="font-display text-h2 font-semibold">
        {arm.passed}
        <span className="t-body ml-1.5"> of {TEST_SIZE}</span>
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

function ArmTable({ comparison }: { comparison: Comparison }) {
  return (
    <Table
      label={`Final test by arm, ${comparison.title}`}
      columns={['', 'Passed', '95% interval', ...TYPES.map((type) => `${type}, of ${PER_TYPE}`)]}
      rows={comparison.arms.map((arm) => [
        armLabel(arm),
        `${arm.passed} of ${TEST_SIZE}`,
        `${arm.low.toFixed(1)}% to ${arm.high.toFixed(1)}%`,
        ...arm.byType.map(String),
      ])}
    />
  );
}

/** Each pair of arms, request by request: who won, who lost, and the difference with its interval. */
function Pairs({
  comparison,
  min,
  max,
  ticks,
}: {
  comparison: Comparison;
  min: number;
  max: number;
  ticks: readonly number[];
}) {
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
    <div className="flex flex-col gap-8">
      <Forest
        name={`Difference in final-test pass rate, in percentage points, ${comparison.title}`}
        rows={rows}
        min={min}
        max={max}
        ticks={ticks}
        formatTick={(value) => `${value > 0 ? '+' : ''}${value}`}
        zero="No difference"
      />
      <Table
        label={`Request by request, ${comparison.title}`}
        columns={['', 'Won', 'Lost', 'Both passed', 'Neither', 'Points (95% interval)']}
        rows={comparison.pairs.map((pair) => [
          <Actors key="label" text={pair.label} />,
          pair.wins,
          pair.losses,
          pair.both,
          pair.neither,
          `${signed(pair.diff)} (${signed(pair.low)} to ${signed(pair.high)})`,
        ])}
      />
    </div>
  );
}

const SECTIONS = {
  second: {
    id: 'second',
    title: 'On a new returns desk, teaching raised the score.',
    body: "Glimmer passed 58 of 60 requests it had never seen, against 44 on its own. Spark's one-shot setup did worse than Glimmer alone.",
  },
  first: {
    id: 'first',
    title: 'On the first returns desk, it did not.',
    body: 'With teaching held to two rounds, Glimmer passed 45 of 60 against 43 on its own. The interval around that difference crosses zero.',
  },
  rounds: {
    id: 'rounds',
    title: 'The score rose a round at a time.',
    body: 'Each change was scored on check tasks Spark never sees, and kept only if it cleared the margin. Two of the four rounds were reverted.',
  },
  time: {
    id: 'time',
    title: 'Faster answers, for cents.',
    body: 'The dot is a typical answer; the line runs to the slowest 5%. Teaching cost 42 cents of Spark.',
  },
  how: {
    id: 'how',
    title: 'Why the final test can be trusted.',
    body: 'Nothing Spark does can touch it. It is opened once, after every setup is frozen, and a program grades it.',
  },
  limits: {
    id: 'limits',
    title: 'What this does not show.',
    body: 'Two made-up businesses, one seed, and a build of Glimmer that is not the one on your computer.',
  },
} satisfies Record<string, SectionCopy>;

function RoundTable({ rounds, label }: { rounds: readonly Round[]; label: string }) {
  return (
    <Table
      label={label}
      left={[0, 1]}
      columns={['Round', 'Change', 'Check tasks, of 45', 'Measured again, of 90', 'Result']}
      rows={rounds.map((round) => [
        round.n,
        <span key="c" className="font-normal text-pretty">
          {round.change}
        </span>,
        `${round.before} to ${round.after}`,
        round.again ? `${round.again[0]} to ${round.again[1]}` : '',
        round.kept ? (
          <span key="r" className="font-medium text-student">
            Kept
          </span>
        ) : (
          <span key="r">Reverted{round.why ? `: ${round.why.toLowerCase()}` : ''}</span>
        ),
      ])}
    />
  );
}

const LIMITS: readonly { figure: string; text: string; from: SourceKey }[] = [
  {
    figure: 'No gain',
    text: 'The first comparison showed none. Teaching won 11 requests and lost 9 against Glimmer alone, and its interval, -11.5 to +18.0 points, includes zero. The second was designed after seeing it, with the budget the job gives teaching, and its plan was published before it ran.',
    from: 'plan',
  },
  {
    figure: '2 desks',
    text: 'Both are returns desks of the same kind, made by the same generator for a made-up shop. They test one kind of job, not other businesses.',
    from: 'plan',
  },
  {
    figure: 'Seed 101',
    text: 'Each final test was taken under one seed. A second seed, 102, was declared and not run, so no result here is under it. Self-reflection, where the student refines the setup itself, was not one of the arms in either comparison.',
    from: 'second',
  },
  {
    figure: 'Online',
    text: 'Every figure is from Glimmer served online. The smaller build that runs on your computer has not taken the final test, and none of these agents has trained weights.',
    from: 'second',
  },
  {
    figure: '57 of 60',
    text: 'Meeting the 95% target as observed is not proof of 95% reliability. The interval around 58 of 60 runs from 88.6% to 99.1%. Gains seen while developing lean upward, so only the final test is claimed.',
    from: 'second',
  },
  {
    figure: '1 run',
    text: `The repair shop's job went from ${REPAIR.checkBefore} of ${REPAIR.checkTotal} check tasks to ${REPAIR.checkAfter} of ${REPAIR.checkTotal} after one round, and passed ${REPAIR.finalPassed} of ${REPAIR.finalTotal} on its final test. It was a single run, not a planned comparison, and a rule graded it.`,
    from: 'hackathon',
  },
];

export function ResultsPage() {
  return (
    <div id="top">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:rounded-control focus:bg-primary focus:px-4 focus:py-2 focus:text-on-primary"
      >
        Skip to the content
      </a>
      <Header page="results" />
      <main id="main">
        <section aria-labelledby="results-title" className="page pb-14 pt-12 sm:pb-16 sm:pt-16">
          <h1 id="results-title" className="t-hero max-w-[14em]">
            What teaching changed.
          </h1>
          <p className="t-lead mt-5 max-w-[60ch]">
            <Actors text="The same final test, sealed until the end, taken three ways: by Glimmer alone, with a one-shot setup from Spark, and after Spark watched it fail and taught it." />
          </p>
          <ul className="m-0 mt-10 grid list-none gap-x-10 p-0 sm:grid-cols-3">
            {[
              {
                figure: '44 to 58',
                text: 'of 60 requests Glimmer had never seen, on a new returns desk.',
              },
              {
                figure: '+23.3 points',
                text: 'against Glimmer on its own, with a 95% interval of +10.9 to +35.9.',
              },
              { figure: '42 cents', text: "of Spark's money paid for the teaching." },
            ].map((item) => (
              <li key={item.figure} className="flex flex-col gap-3 border-t border-line py-5">
                <span className="t-h1 leading-none tabular-nums">{item.figure}</span>
                <span className="max-w-[32ch] text-pretty">
                  <Actors text={item.text} />
                </span>
              </li>
            ))}
          </ul>
        </section>

        <Chapter copy={SECTIONS.second}>
          <Reveal className="flex flex-col gap-14">
            <div>
              <SubHeading>{SECOND.title}</SubHeading>
              <PassRates comparison={SECOND} />
            </div>
            <ArmTable comparison={SECOND} />
            <div>
              <SubHeading>Request by request</SubHeading>
              <Pairs comparison={SECOND} min={-40} max={50} ticks={[-40, -20, 0, 20, 40]} />
            </div>
          </Reveal>
          <Sources from={['second', 'plan', 'readme']} />
        </Chapter>

        <Chapter copy={SECTIONS.first}>
          <Reveal className="flex flex-col gap-14">
            <div>
              <SubHeading>{FIRST.title}</SubHeading>
              <PassRates comparison={FIRST} />
            </div>
            <ArmTable comparison={FIRST} />
            <div>
              <SubHeading>Request by request</SubHeading>
              <Pairs comparison={FIRST} min={-40} max={50} ticks={[-40, -20, 0, 20, 40]} />
            </div>
          </Reveal>
          <Sources from={['first', 'plan']} />
        </Chapter>

        <Chapter copy={SECTIONS.rounds}>
          <Reveal className="flex flex-col gap-14">
            <div className="rounded-card bg-card px-7 pb-6 pt-6 shadow-edge max-sm:px-4">
              <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
                <span className="font-display text-hero font-semibold leading-none tabular-nums max-sm:text-title">
                  98%
                </span>
                <span className="tabular-nums">44 of 45 check tasks, from 31 of 45 to start</span>
              </div>
              <ScoreChart times={{ rise1: 0, hollow2: 0, hollow3: 0, rise4: 0 }} />
            </div>
            <div>
              <SubHeading>The new returns desk</SubHeading>
              <RoundTable
                rounds={ROUNDS_SECOND}
                label="Rounds of teaching on the new returns desk"
              />
              <p className="m-0 mt-4 max-w-[70ch] text-pretty">
                A change counts only if check-task passes rise by at least 2 per run, measured again
                on new seeds over 2 runs, so +4 of 90, and no kind of task loses more than 1 per
                run. Teaching stopped after round 4 because the target was reached.
              </p>
            </div>
            <div>
              <SubHeading>The first returns desk</SubHeading>
              <RoundTable
                rounds={ROUNDS_FIRST}
                label="Rounds of teaching on the first returns desk"
              />
              <p className="m-0 mt-4 max-w-[70ch] text-pretty">
                Teaching was held to 2 rounds after the draft and stopped there, with the cap
                reached.
              </p>
            </div>
            <div>
              <SubHeading>A repair shop, one round</SubHeading>
              <div className="grid gap-x-10 sm:grid-cols-3">
                {[
                  {
                    figure: `${REPAIR.checkBefore} of ${REPAIR.checkTotal}`,
                    text: 'check tasks before teaching.',
                  },
                  {
                    figure: `${REPAIR.checkAfter} of ${REPAIR.checkTotal}`,
                    text: "after round 1, Spark's first draft: a ticket-cost tool and a lookup.",
                  },
                  {
                    figure: `${REPAIR.finalPassed} of ${REPAIR.finalTotal}`,
                    text: `on its final test, graded by the rule the shop confirmed, for ${REPAIR.cents} cents in all.`,
                  },
                ].map((item) => (
                  <div key={item.figure} className="flex flex-col gap-3 border-t border-line py-5">
                    <span className="t-h1 leading-none tabular-nums">{item.figure}</span>
                    <span className="max-w-[32ch] text-pretty">{item.text}</span>
                  </div>
                ))}
              </div>
            </div>
          </Reveal>
          <Sources from={['second', 'first', 'hackathon', 'readme']} />
        </Chapter>

        <Chapter copy={SECTIONS.time}>
          <Reveal className="flex flex-col gap-14">
            <div>
              <SubHeading>Time to answer, on the new returns desk</SubHeading>
              <Forest
                name="Median and slowest 5% of answer times, by arm"
                rows={SECOND.arms.map((arm) => ({
                  label: armLabel(arm),
                  value: arm.p50,
                  low: arm.p50,
                  high: arm.p95,
                  tone: arm.tone,
                  figure: (
                    <span className="whitespace-nowrap">
                      <span className="font-display text-h2 font-semibold">
                        {arm.p50.toFixed(1)} s
                      </span>
                      <span className="t-body ml-2">to {arm.p95.toFixed(1)} s</span>
                    </span>
                  ),
                  summary: `${arm.name}: typical answer ${arm.p50} seconds, slowest 5 percent within ${arm.p95}.`,
                }))}
                min={0}
                max={60}
                figureWidth="11.5rem"
                ticks={[0, 15, 30, 45, 60]}
                formatTick={(value) => `${value} s`}
              />
            </div>
            <div>
              <SubHeading>What each arm cost</SubHeading>
              <Table
                fit
                label="What each arm cost on the new returns desk"
                columns={['', 'Spark', 'Glimmer, hosted']}
                rows={SECOND.arms.map((arm) => [
                  armLabel(arm),
                  dollars(arm.spark),
                  arm.glimmer === null ? '' : dollars(arm.glimmer),
                ])}
              />
              <p className="m-0 mt-4 max-w-[70ch] text-pretty">
                The whole run cost Spark ${MONEY.spark.toFixed(4)} and the hosted Glimmer $
                {MONEY.glimmer.toFixed(4)} as its attempts recorded it. Teaching cost 42 cents of
                Spark: 34 for the rounds and 8 for its first setup.
              </p>
            </div>
          </Reveal>
          <Sources from={['second', 'readme']} />
        </Chapter>

        <Chapter copy={SECTIONS.how}>
          <Reveal>
            <RoundDiagram />
          </Reveal>
          <Sources from={['plan', 'second']} />
        </Chapter>

        <Chapter copy={SECTIONS.limits}>
          <Reveal>
            <ul className="m-0 grid list-none grid-cols-1 gap-x-10 p-0 sm:grid-cols-2 lg:grid-cols-3">
              {LIMITS.map((limit) => (
                <li
                  key={limit.figure}
                  className="flex flex-col gap-3 border-t border-line pb-9 pt-5"
                >
                  <span className="t-h1 leading-none tabular-nums">{limit.figure}</span>
                  <span className="max-w-[44ch] text-pretty">
                    <Actors text={limit.text} />
                  </span>
                  <a className="link-quiet t-small" href={sourceUrl(limit.from)}>
                    {SOURCES[limit.from].name}
                  </a>
                </li>
              ))}
            </ul>
          </Reveal>
          <a className="link-quiet mt-4 inline-flex items-center gap-1.5" href={REPORTS}>
            The full reports on GitHub
            <ArrowUpRight size={16} strokeWidth={1.8} aria-hidden />
          </a>
        </Chapter>
      </main>
      <Footer page="results" />
    </div>
  );
}
