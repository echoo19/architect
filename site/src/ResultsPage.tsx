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
 * The results page: the evidence that is in the README and in docs/comparisons, set out as one
 * column to read: the same sealed final test taken three ways, the score round by round, answer
 * time and cost, how a round works, and what none of it shows. Each chart or table sits in its own
 * panel under its own title. Every number is in `evidence.ts`, with the document it comes from,
 * and each section says which.
 */

const dollars = (value: number) => `$${value.toFixed(2)}`;
const signed = (value: number) => `${value > 0 ? '+' : ''}${value.toFixed(1)}`;

/** The documents a block rests on, each a link to the file. */
function Sources({ from }: { from: readonly SourceKey[] }) {
  return (
    <p className="t-small m-0">
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

/** A chart or a table with its title, set apart from the text around it. */
function Panel({ title, children, note }: { title: string; children: ReactNode; note?: string }) {
  return (
    <Reveal className="rounded-card bg-card px-7 pb-6 pt-6 shadow-edge max-sm:px-4 max-sm:pb-5">
      <h3 className="m-0 mb-5 font-display text-h2 font-semibold">{title}</h3>
      {children}
      {note && <p className="t-small m-0 mt-4 text-pretty">{note}</p>}
    </Reveal>
  );
}

/** A section of the page: its claim as a heading, then its text and panels, then its sources. */
function Part({
  id,
  title,
  from,
  children,
}: {
  id: string;
  title: string;
  from: readonly SourceKey[];
  children: ReactNode;
}) {
  return (
    <section
      id={id}
      aria-labelledby={`${id}-title`}
      className="article scroll-mt-16 pb-16 sm:pb-20"
    >
      <div className="flex flex-col gap-7 border-t border-line pt-12 sm:pt-14">
        <h2 id={`${id}-title`} className="t-title">
          {title}
        </h2>
        {children}
        <Sources from={from} />
      </div>
    </section>
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
      columns={['', ...TYPES.map((type) => `${type}, of ${PER_TYPE}`)]}
      rows={comparison.arms.map((arm) => [armLabel(arm), ...arm.byType.map(String)])}
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
    title: 'The first comparison showed no gain.',
    text: 'Teaching won 11 requests and lost 9 against Glimmer alone, and its interval, -11.5 to +18.0 points, includes zero. The second was designed after seeing it, with the budget the job gives teaching, and its plan was published before it ran.',
    from: 'plan',
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
    text: `Its job went from ${REPAIR.checkBefore} of ${REPAIR.checkTotal} check tasks to ${REPAIR.checkAfter} of ${REPAIR.checkTotal} after one round, and passed ${REPAIR.finalPassed} of ${REPAIR.finalTotal} on its final test. It was a single run, not a planned comparison, and a rule graded it.`,
    from: 'hackathon',
  },
];

/** Three figures side by side, each with what it counts. */
function Figures({ items }: { items: readonly { figure: string; text: string }[] }) {
  return (
    <ul className="m-0 grid list-none gap-x-8 gap-y-5 p-0 sm:grid-cols-3">
      {items.map((item) => (
        <li key={item.figure} className="flex flex-col gap-2.5">
          <span className="t-h1 leading-none tabular-nums">{item.figure}</span>
          <span className="text-pretty">
            <Actors text={item.text} />
          </span>
        </li>
      ))}
    </ul>
  );
}

const TAUGHT = "Glimmer after Spark's teaching";
const ALONE = 'Glimmer on its own';

export function ResultsPage() {
  const second = {
    alone: pair(SECOND, 'Teaching against Glimmer on its own'),
    oneShot: pair(SECOND, 'Teaching against the one-shot setup'),
  };
  const first = pair(FIRST, 'Teaching against Glimmer on its own');
  const taught = arm(SECOND, TAUGHT);
  const alone = arm(SECOND, ALONE);
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
        <section aria-labelledby="results-title" className="article pb-16 pt-12 sm:pb-20 sm:pt-16">
          <h1 id="results-title" className="t-hero">
            What teaching changed.
          </h1>
          <p className="t-read mt-6">
            <Actors text="The same final test, sealed until the end, taken three ways: by Glimmer alone, with a one-shot setup from Spark, and after Spark watched it fail and taught it." />
          </p>
          <div className="mt-9 rounded-card bg-card px-7 py-6 shadow-edge max-sm:px-4">
            <Figures
              items={[
                {
                  figure: '44 to 58',
                  text: 'of 60 requests Glimmer had never seen, on a new returns desk.',
                },
                {
                  figure: '+23.3 points',
                  text: 'against Glimmer on its own, with a 95% interval of +10.9 to +35.9.',
                },
                { figure: '42 cents', text: "of Spark's money paid for the teaching." },
              ]}
            />
          </div>
        </section>

        <Part
          id="second"
          title="On a new returns desk, teaching raised the score."
          from={['second', 'plan', 'readme']}
        >
          <Text>
            <Actors
              text={`Glimmer passed ${taught.passed} of ${TEST_SIZE} requests it had never seen, against ${alone.passed} on its own. Spark's one-shot setup did worse than Glimmer alone.`}
            />
          </Text>
          <Text>
            <Actors
              text={`All three took the same final test: ${TEST_SIZE} requests, ${PER_TYPE} of each kind, sealed until every setup was frozen. Teaching could run up to 8 rounds.`}
            />
          </Text>
          <Panel title="Final test, of 60">
            <div className="flex flex-col gap-8">
              <PassRates comparison={SECOND} />
              <ArmTable comparison={SECOND} />
            </div>
          </Panel>
          <Text>
            <Actors
              text={`Matched request by request, the taught Glimmer won ${second.alone.wins} requests that Glimmer alone failed and lost ${second.alone.losses}: ${signed(second.alone.diff)} points, with a 95% interval of ${interval(second.alone)}. Against the one-shot setup it won ${second.oneShot.wins} and lost ${second.oneShot.losses}.`}
            />
          </Text>
          <Panel title="Request by request, in points">
            <Pairs comparison={SECOND} min={-40} max={50} ticks={[-40, -20, 0, 20, 40]} />
          </Panel>
        </Part>

        <Part id="first" title="On the first returns desk, it did not." from={['first', 'plan']}>
          <Text>
            <Actors
              text={`With teaching held to two rounds, Glimmer passed ${arm(FIRST, TAUGHT).passed} of ${TEST_SIZE} against ${arm(FIRST, ALONE).passed} on its own. Spark answering every request itself passed ${arm(FIRST, 'Spark doing the job itself').passed}.`}
            />
          </Text>
          <Panel title="Final test, of 60">
            <div className="flex flex-col gap-8">
              <PassRates comparison={FIRST} />
              <ArmTable comparison={FIRST} />
            </div>
          </Panel>
          <Text>
            <Actors
              text={`Request by request, teaching won ${first.wins} and lost ${first.losses} against Glimmer alone. The interval around that difference, ${interval(first)} points, crosses zero.`}
            />
          </Text>
          <Panel title="Request by request, in points">
            <Pairs comparison={FIRST} min={-40} max={50} ticks={[-40, -20, 0, 20, 40]} />
          </Panel>
        </Part>

        <Part
          id="rounds"
          title="The score rose a round at a time."
          from={['second', 'first', 'hackathon', 'readme']}
        >
          <Text>
            <Actors text="Each change was scored on check tasks Spark never sees, and kept only if it cleared the margin. Two of the four rounds on the new returns desk were reverted." />
          </Text>
          <Text>
            A change counts only if check-task passes rise by at least 2 per run, measured again on
            new seeds over 2 runs, so +4 of 90, and no kind of task loses more than 1 per run.
          </Text>
          <Panel title="Check tasks, new returns desk">
            <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
              <span className="font-display text-hero font-semibold leading-none tabular-nums max-sm:text-title">
                98%
              </span>
              <span className="tabular-nums">44 of 45, from 31 of 45 to start</span>
            </div>
            <ScoreChart className="mb-8" times={{ rise1: 0, hollow2: 0, hollow3: 0, rise4: 0 }} />
          </Panel>
          <Panel title="Each round, new returns desk">
            <RoundList rounds={ROUNDS_SECOND} label="Rounds of teaching on the new returns desk" />
          </Panel>
          <Text>
            Teaching stopped after round 4 because the target was reached. On the first returns desk
            it was held to 2 rounds after the draft, and stopped there with the cap reached.
          </Text>
          <Panel title="Each round, first returns desk">
            <RoundList rounds={ROUNDS_FIRST} label="Rounds of teaching on the first returns desk" />
          </Panel>
          <Panel title="A repair shop, one round">
            <Figures
              items={[
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
              ]}
            />
          </Panel>
        </Part>

        <Part id="time" title="Faster answers, for cents." from={['second', 'readme']}>
          <Text>
            <Actors
              text={`After teaching, Glimmer's typical answer took ${taught.p50} s, and its slowest 5% finished within ${taught.p95} s. On its own, its typical answer took ${alone.p50} s.`}
            />
          </Text>
          <Panel
            title="Time to answer, new returns desk"
            note="The dot is a typical answer; the line runs to the slowest 5%."
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
          </Panel>
          <Text>
            The whole run cost Spark ${MONEY.spark.toFixed(4)} and the hosted Glimmer $
            {MONEY.glimmer.toFixed(4)} as its attempts recorded it. Teaching cost 42 cents of Spark:
            34 for the rounds and 8 for its first setup.
          </Text>
          <Panel title="What each arm cost">
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
          </Panel>
        </Part>

        <Part id="how" title="Why the final test can be trusted." from={['plan', 'second']}>
          <Text>
            <Actors text="Nothing Spark does can touch it. It is opened once, after every setup is frozen, and a program grades it." />
          </Text>
          <Panel title="How a round works">
            <RoundDiagram />
          </Panel>
        </Part>

        <Part id="limits" title="What this does not show." from={['plan', 'second', 'hackathon']}>
          <Text>
            <Actors text="Two made-up businesses, one seed, and a build of Glimmer that is not the one on your computer." />
          </Text>
          <ul className="m-0 flex list-none flex-col gap-6 p-0">
            {LIMITS.map((limit) => (
              <li key={limit.title} className="flex flex-col gap-2">
                <h3 className="m-0 font-display text-h2 font-semibold">{limit.title}</h3>
                <p className="t-read">
                  <Actors text={limit.text} />
                </p>
              </li>
            ))}
          </ul>
          <a className="link-quiet inline-flex items-center gap-1.5" href={REPORTS}>
            The full reports on GitHub
            <ArrowUpRight size={16} strokeWidth={1.8} aria-hidden />
          </a>
        </Part>
      </main>
      <Footer page="results" />
    </div>
  );
}
