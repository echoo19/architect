import type { CSSProperties, ReactNode } from 'react';
import { Badge, Button, Meter, Spinner } from '@architect/ui';
import {
  ArrowRight,
  Check,
  ChevronDown,
  ChevronRight,
  CircleHelp,
  EyeOff,
  RotateCcw,
  X,
} from 'lucide-react';
import { ACADEMY, ROUNDS } from './data';
import { clamp, count, grouped, mix, outQuart, rise, span, ui } from './time';

/** The column the guided flow's screens are set in. */
function Column({ children, style }: { children: ReactNode; style?: CSSProperties }) {
  return (
    <div className="mx-auto flex w-[760px] flex-col" style={style}>
      {children}
    </div>
  );
}

function FileName({ children }: { children: ReactNode }) {
  return <span className="font-mono text-small">{children}</span>;
}

/** A quoted passage under a rule, with where it came from, as the brief shows one. */
function Passage({ text, org, style }: { text: string; org: string; style?: CSSProperties }) {
  return (
    <div className="flex flex-col gap-1 border-l-2 border-line-strong py-0.5 pl-4" style={style}>
      <span className="text-ui">{text}</span>
      <span className="font-mono text-small">{org}, policy.md</span>
    </div>
  );
}

/** A row of the brief: its name at the left, what Spark understood at the right. */
function BriefRow({
  name,
  children,
  style,
}: {
  name: string;
  children: ReactNode;
  style?: CSSProperties;
}) {
  return (
    <div
      className="grid grid-cols-[180px_1fr] gap-6 border-t border-line py-5 first:border-t-0"
      style={style}
    >
      <span className="font-medium">{name}</span>
      <div className="flex flex-col gap-3">{children}</div>
    </div>
  );
}

const DIFFERENCES = [
  { org: 'Lakemont Scholars', text: 'Assign 5 questions from the bank.' },
  { org: 'Ridgeline Test Prep', text: 'Assign 4 questions from the bank.' },
  { org: 'Wrenfield Prep', text: 'Assign 2 questions from the bank.' },
] as const;

/** How far the Define screen has scrolled at a moment, in px. */
export function defineScroll(lt: number): number {
  return mix(0, 300, outQuart(span(lt, 4.4, 2.4))) + mix(0, 560, outQuart(span(lt, 10.4, 2.6)));
}

/**
 * Define, with the study brief: what Spark found in the academies' own files, each rule with the
 * passage it came from, where the academies differ, and what is unclear (the field's first run's
 * brief, architect-runs/phil-1/brief.json). Ends with the confirmation.
 */
export function DefinePage({ lt }: { lt: number }) {
  const confirmed = ui(lt, 13.9, 0.25);
  return (
    <Column style={{ transform: `translateY(${-defineScroll(lt)}px)`, paddingTop: 44 }}>
      <h1 className="m-0 font-display text-title font-semibold">{ACADEMY}</h1>
      <p className="mb-0 mt-3 text-body">
        Diagnoses a missed question, sets practice in the academy's records and flags students for
        staff.
      </p>
      <div className="mt-7 grid grid-cols-2 gap-8 text-body" style={rise(lt, 0.3, 6)}>
        <ul className="m-0 flex list-none flex-col gap-3 p-0">
          {[
            'Names the topic, the right choice and the error behind it',
            'Gives an approved first hint, by its id',
            "Sets practice the way the academy's policy says",
          ].map((line) => (
            <li key={line} className="flex gap-3">
              <Check size={18} strokeWidth={1.8} className="mt-0.5 shrink-0" aria-hidden />
              {line}
            </li>
          ))}
        </ul>
        <ul className="m-0 flex list-none flex-col gap-3 p-0">
          {['Writes hints of its own', "Uses one academy's rules at another"].map((line) => (
            <li key={line} className="flex gap-3">
              <X size={18} strokeWidth={1.8} className="mt-0.5 shrink-0" aria-hidden />
              {line}
            </li>
          ))}
        </ul>
      </div>
      <h2 className="mb-4 mt-10 font-display text-h2 font-semibold" style={rise(lt, 0.8, 6)}>
        What Spark understood
      </h2>
      <section className="rounded-card bg-card px-6 py-1 shadow-edge" data-frame="brief">
        <BriefRow name="Skills" style={rise(lt, 1.1, 6)}>
          <Skill
            name="Diagnose"
            text="Name the topic, the right choice and the error behind a wrong answer."
            files={['tests.csv', 'questions.csv', 'attempts.csv', 'errors.csv']}
          />
          <Skill
            name="First hint"
            text="Choose the approved first hint for the topic and the error."
            files={['hints.csv', 'errors.csv']}
          />
          <Skill
            name="Assign practice"
            text="Assign follow-up practice of the same topic, not yet tried, in the band."
            files={['questions.csv', 'attempts.csv', 'assignments.csv']}
          />
        </BriefRow>
        <BriefRow name="Rules" style={rise(lt, 1.5, 6)}>
          <span>New rows go at the end; rows already there are never changed.</span>
          <Passage
            org="Ridgeline Test Prep"
            text="Change nothing else. Never edit or delete a row that is already there."
          />
        </BriefRow>
        <BriefRow name="Where academies differ" style={rise(lt, 1.9, 6)}>
          <span>The academies assign a different count of follow-up questions.</span>
          <span className="flex items-center gap-1.5 text-ui font-medium">
            <ChevronDown size={15} strokeWidth={1.8} aria-hidden />3 passages
          </span>
          {DIFFERENCES.map((passage, index) => (
            <Grow key={passage.org} p={outQuart(span(lt, 7.6 + index * 0.55, 0.6))} height={58}>
              <Passage org={passage.org} text={passage.text} />
            </Grow>
          ))}
          <span className="mt-1">
            The first hint rule is different: one gives the general hint, another the hint for the
            error.
          </span>
          <span className="flex items-center gap-1.5 text-ui font-medium">
            <ChevronRight size={15} strokeWidth={1.8} aria-hidden />2 passages
          </span>
        </BriefRow>
        <BriefRow name="Open questions" style={rise(lt, 2.3, 6)}>
          {[
            'Which video should be picked when a topic folder holds more than one?',
            'What to do when no practice question meets all rules?',
          ].map((question) => (
            <span key={question} className="flex items-start gap-2.5">
              <CircleHelp size={16} strokeWidth={1.8} className="mt-1 shrink-0" aria-hidden />
              {question}
            </span>
          ))}
        </BriefRow>
      </section>
      <div className="mt-6 flex items-center justify-between" data-frame="confirm">
        <span className="font-medium">Is this the job?</span>
        <span data-click="confirm" className="grid">
          <span className="[grid-area:1/1]" style={{ opacity: 1 - confirmed }}>
            <Button size="md" variant="primary">
              <Check size={16} strokeWidth={1.8} aria-hidden />
              Confirm and continue
            </Button>
          </span>
          <span
            className="flex items-center justify-end gap-2 [grid-area:1/1]"
            style={{ opacity: confirmed, transform: `scale(${mix(0.94, 1, confirmed)})` }}
          >
            <Badge tone="student" size="lg" icon={<Check size={14} strokeWidth={2} aria-hidden />}>
              Confirmed
            </Badge>
          </span>
        </span>
      </div>
      <div className="h-24" />
    </Column>
  );
}

function Skill({ name, text, files }: { name: string; text: string; files: readonly string[] }) {
  return (
    <div className="flex flex-col gap-1">
      <span className="font-medium">{name}</span>
      <span>{text}</span>
      <span className="flex gap-3">
        {files.map((file) => (
          <FileName key={file}>{file}</FileName>
        ))}
      </span>
    </div>
  );
}

/** A block that is made room for: its height opens as it arrives, so what is below moves down. */
export function Grow({ p, height, children }: { p: number; height: number; children: ReactNode }) {
  return (
    <div className="overflow-hidden" style={{ height: p * height, marginTop: (p - 1) * 12 }}>
      <div style={{ opacity: clamp(p * 1.4 - 0.3), transform: `translateY(${(1 - p) * 8}px)` }}>
        {children}
      </div>
    </div>
  );
}

/** When each round lands on the Train screen, in seconds from its start. */
const ROUND_AT = [1.4, 4.6, 7.8] as const;

/** The check score over the rounds: kept points on the line, the reverted one hollow, beside it. */
function ScoreChart({ lt }: { lt: number }) {
  const W = 470;
  const H = 168;
  const x = (step: number) => 56 + step * 118;
  const y = (percent: number) => 16 + ((100 - percent) / 60) * (H - 46);
  const p1 = outQuart(span(lt, ROUND_AT[0] + 0.6, 0.9));
  const p2 = outQuart(span(lt, ROUND_AT[1] + 0.6, 0.9));
  const p3 = outQuart(span(lt, ROUND_AT[2] + 3.0, 1.1));
  const line = (from: [number, number], to: [number, number], p: number) => (
    <line
      x1={from[0]}
      y1={from[1]}
      x2={mix(from[0], to[0], p)}
      y2={mix(from[1], to[1], p)}
      className="stroke-student"
      strokeWidth={2}
    />
  );
  const start: [number, number] = [x(0), y(47)];
  const r1: [number, number] = [x(1), y(69)];
  const r2: [number, number] = [x(2), y(64)];
  const r3: [number, number] = [x(3), y(97)];
  return (
    <svg
      width={W}
      height={H}
      viewBox={`0 0 ${W} ${H}`}
      className="overflow-visible font-mono text-small"
    >
      {[40, 60, 80, 100].map((value) => (
        <g key={value}>
          <line
            x1={48}
            x2={W - 60}
            y1={y(value)}
            y2={y(value)}
            className="stroke-line"
            strokeWidth={1}
          />
          <text x={36} y={y(value) + 4} textAnchor="end" className="fill-fg">
            {value}%
          </text>
        </g>
      ))}
      <line
        x1={48}
        x2={W - 60}
        y1={y(90)}
        y2={y(90)}
        className="stroke-fg-dim"
        strokeWidth={1}
        strokeDasharray="2 5"
      />
      <text x={W - 52} y={y(90) + 4} className="fill-fg">
        Target 90%
      </text>
      {['Start', '1', '2', '3'].map((label, step) => (
        <text key={label} x={x(step)} y={H - 4} textAnchor="middle" className="fill-fg">
          {label}
        </text>
      ))}
      {line(start, r1, p1)}
      {p2 > 0 && (
        <line
          x1={r1[0]}
          y1={r1[1]}
          x2={mix(r1[0], r2[0], p2)}
          y2={mix(r1[1], r2[1], p2)}
          className="stroke-fg-dim"
          strokeWidth={1.5}
          strokeDasharray="3 4"
        />
      )}
      {p3 > 0 && line(r1, r3, p3)}
      <circle cx={start[0]} cy={start[1]} r={4.5} className="fill-student" />
      {p1 >= 1 && <circle cx={r1[0]} cy={r1[1]} r={4.5} className="fill-student" />}
      {p2 >= 1 && (
        <circle cx={r2[0]} cy={r2[1]} r={4.5} className="fill-ground stroke-fg" strokeWidth={1.5} />
      )}
      {p3 >= 1 && <circle cx={r3[0]} cy={r3[1]} r={4.5} className="fill-student" />}
    </svg>
  );
}

/**
 * Train: Spark teaching Glimmer on the academy field's first run. Three rounds; the first and
 * the third kept, the second reverted (tutor-1.md). Scores are of the 36 check tasks.
 */
export function TrainPage({ lt }: { lt: number }) {
  const score =
    lt < ROUND_AT[0] + 0.6
      ? 47
      : lt < ROUND_AT[2] + 3
        ? count(lt, ROUND_AT[0] + 0.6, 0.9, 47, 69)
        : count(lt, ROUND_AT[2] + 3, 1.1, 69, 97);
  const passed = Math.round((score / 100) * 36);
  const done = ui(lt, ROUND_AT[2] + 4.4, 0.3);
  return (
    <Column
      style={{
        paddingTop: 18,
        transform: `translateY(${-mix(0, 78, outQuart(span(lt, ROUND_AT[2] + 0.3, 1.0)))}px)`,
      }}
    >
      <div className="flex h-12 items-center gap-3 border-b border-line pb-4">
        <span className="grid size-6 place-items-center">
          <span className="[grid-area:1/1]" style={{ opacity: 1 - done }}>
            <Spinner size={18} />
          </span>
          <Check
            size={20}
            strokeWidth={2}
            className="text-student [grid-area:1/1]"
            style={{ opacity: done }}
            aria-hidden
          />
        </span>
        <span className="grid font-display text-h2 font-semibold">
          <span className="[grid-area:1/1]" style={{ opacity: 1 - done }}>
            <span className="text-mentor">Spark</span> is teaching{' '}
            <span className="text-student">Glimmer</span>
          </span>
          <span className="[grid-area:1/1]" style={{ opacity: done }}>
            Training is done
          </span>
        </span>
      </div>
      <div className="flex items-center justify-between py-4" data-frame="score">
        <div className="flex flex-col gap-3">
          <span className="font-display text-[72px] font-semibold leading-none tracking-[-0.03em] tabular-nums">
            {score}%
          </span>
          <span className="flex items-center gap-2 text-ui">
            <EyeOff size={15} strokeWidth={1.8} aria-hidden />
            check tasks
            <span className="ml-2 tabular-nums">{passed} of 36</span>
          </span>
        </div>
        <ScoreChart lt={lt} />
      </div>
      <div className="grid grid-cols-3 gap-8 pb-4">
        <MeterCell
          label="Time"
          value={`${count(lt, 0, ROUND_AT[2] + 4.4, 1, 15)} min`}
          share={mix(0.05, 0.35, clamp(lt / (ROUND_AT[2] + 4.4)))}
        />
        <MeterCell
          label="Spark's cost"
          value={`$${mix(0, 0.31, clamp(lt / (ROUND_AT[2] + 4.4))).toFixed(2)} / $5`}
          share={mix(0, 0.062, clamp(lt / (ROUND_AT[2] + 4.4)))}
          tone="mentor"
        />
        <MeterCell
          label="Rounds"
          value={`${lt < ROUND_AT[1] ? 1 : lt < ROUND_AT[2] ? 2 : 3} / 3`}
          share={lt < ROUND_AT[1] ? 1 / 3 : lt < ROUND_AT[2] ? 2 / 3 : 1}
        />
      </div>
      <div data-frame="round-list">
        <div className="flex items-center justify-between border-t border-line pt-5">
          <span className="font-display text-h2 font-semibold">Rounds</span>
          <span className="text-ui tabular-nums">
            {lt < ROUND_AT[1] + 1.4
              ? lt < ROUND_AT[0] + 1.2
                ? 0
                : 1
              : lt < ROUND_AT[2] + 4
                ? 1
                : 2}{' '}
            of {lt < ROUND_AT[1] ? 1 : lt < ROUND_AT[2] ? 2 : 3} kept
          </span>
        </div>
        <div className="mt-2 flex flex-col">
          {[...ROUNDS].reverse().map((round) => {
            const index = Number(round.number) - 1;
            const at = ROUND_AT[index] ?? 0;
            const open = outQuart(span(lt, at, 0.6));
            const settled = ui(lt, index === 2 ? at + 4.0 : at + 1.2, 0.3);
            const expanded = index === 2 ? outQuart(span(lt, at + 0.5, 0.7)) : 0;
            return (
              <div
                key={round.number}
                className="overflow-hidden"
                style={{ height: open * (52 + expanded * 112) }}
              >
                <div className="border-t border-line" style={{ opacity: clamp(open * 1.5 - 0.3) }}>
                  <div className="grid h-[52px] grid-cols-[44px_1fr_120px_120px] items-center text-ui">
                    <span className="font-mono">{round.number}</span>
                    <span>{round.title}</span>
                    <span
                      className="font-mono text-small tabular-nums"
                      style={{ opacity: settled }}
                    >
                      {round.before}% <ArrowRight size={11} className="inline" aria-hidden />{' '}
                      {round.after}%
                    </span>
                    <span className="flex justify-end">
                      <Verdict kept={round.kept} p={settled} />
                    </span>
                  </div>
                  {index === 2 && (
                    <div
                      className="grid grid-cols-[44px_96px_1fr] gap-y-3 pb-5 text-ui"
                      style={{ opacity: expanded }}
                    >
                      <span />
                      <span className="text-mentor">Spark</span>
                      <span>
                        Failed attempts died on their first turn, with a malformed call, while
                        reading policy.md by hand for the numbers.
                      </span>
                      <span />
                      <span>Expected</span>
                      <span className="tabular-nums">+2 to +5 check tasks</span>
                      <span />
                      <span>Measured</span>
                      <span className="tabular-nums" style={{ opacity: settled }}>
                        +11 check tasks
                      </span>
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </Column>
  );
}

function MeterCell({
  label,
  value,
  share,
  tone = 'fg',
}: {
  label: string;
  value: string;
  share: number;
  tone?: 'fg' | 'mentor';
}) {
  return (
    <div className="flex flex-col gap-2.5">
      <span className="flex justify-between text-ui">
        <span>{label}</span>
        <span className="tabular-nums">{value}</span>
      </span>
      <Meter value={share} label={label} tone={tone} thickness={3} />
    </div>
  );
}

function Verdict({ kept, p }: { kept: boolean; p: number }) {
  const style = { opacity: p, transform: `translateX(${(1 - p) * 8}px)` };
  return kept ? (
    <span className="flex items-center gap-1.5 text-student" style={style}>
      <Check size={15} strokeWidth={2} aria-hidden />
      Kept
    </span>
  ) : (
    <span className="flex items-center gap-1.5" style={style}>
      <RotateCcw size={14} strokeWidth={1.8} aria-hidden />
      Reverted
    </span>
  );
}

/** The rows of tests.csv the failing call read, as the reduction takes them away. */
const TEST_ROWS = [
  ['Practice Test 4', 'Full', '2', '5', 'Q-0083', false],
  ['Practice Test 4', 'Full', '2', '6', 'Q-0059', true],
  ['Practice Test 4', 'Full', '1', '1', 'Q-0205', false],
  ['Practice Test 4', 'Full', '2', '4', 'Q-0159', false],
  ['Practice Test 4', 'Full', '2', '5', 'Q-0320', false],
  ['Practice Test 4', 'Full', '2', '6', 'Q-0040', true],
] as const;

const tableGrid =
  'grid grid-cols-[1.5fr_0.8fr_0.7fr_0.7fr_1fr] items-center gap-2 font-mono text-small';

/**
 * A counterexample in the round's drawer: the question lookup Spark wrote crashed on tests laid
 * out as "Full", and the failing case shrinks from 2,312 rows to 4 (docs/DECISIONS.md 078, on the
 * academy's practice data). Then the repair passes both cases.
 */
export function CounterexampleDrawer({ lt }: { lt: number }) {
  const shrink = outQuart(span(lt, 2.0, 2.6));
  const rows = Math.round(mix(2312, 4, Math.pow(shrink, 0.35)));
  const questions = outQuart(span(lt, 4.6, 0.6));
  const repaired = ui(lt, 6.0, 0.35);
  const cases = outQuart(span(lt, 6.8, 0.7));
  let removed = 0;
  return (
    <div className="flex h-full flex-col">
      <div className="flex items-start justify-between border-b border-line px-6 pb-4 pt-5">
        <div className="flex flex-col gap-1">
          <span className="font-display text-h2 font-semibold">The question lookup</span>
          <span className="text-ui">A helper Spark wrote, failing on practice data</span>
        </div>
        <X size={18} strokeWidth={1.8} className="mt-1" aria-hidden />
      </div>
      <div className="min-h-0 flex-1 overflow-hidden">
        <div
          className="flex flex-col gap-5 px-6 pt-5"
          data-frame="counterexample"
          style={{
            transform: `translateY(${-(mix(0, 150, outQuart(span(lt, 4.5, 1.1))) + mix(0, 170, outQuart(span(lt, 6.5, 1.0))))}px)`,
          }}
        >
          <div className="flex items-center justify-between text-ui font-medium">
            <span>Counterexample</span>
            <span style={{ opacity: ui(lt, 4.6) }}>1-minimal</span>
          </div>
          <div className="flex items-baseline gap-3 font-display text-h1 font-semibold tabular-nums">
            <span>2,312 rows</span>
            <ArrowRight
              size={20}
              strokeWidth={2}
              className="self-center"
              style={{ opacity: ui(lt, 1.8, 0.3) }}
              aria-hidden
            />
            <span style={{ opacity: ui(lt, 1.9, 0.3) }}>
              {grouped(rows)} {rows === 1 ? 'row' : 'rows'}
            </span>
          </div>
          <div className="flex flex-col gap-1.5">
            <span className="text-body">
              <span className="font-mono">question_lookup</span> stops with the error "test position
              not found".
            </span>
            <span className="font-mono text-small">
              {
                'question_lookup({"test_name":"Practice Test 4","section":"Math","module":2,"number":6})'
              }
            </span>
          </div>
          <div className="flex flex-col">
            <span className="pb-2 font-mono text-small font-medium">tests.csv</span>
            <div className={`${tableGrid} h-8 border-b border-line font-medium`}>
              <span>test_name</span>
              <span>section</span>
              <span>module</span>
              <span>number</span>
              <span>question_id</span>
            </div>
            {TEST_ROWS.map((row, index) => {
              const keep = row[5];
              const gone = keep ? 0 : outQuart(span(shrink, 0.1 + removed++ * 0.13, 0.25));
              return (
                <div key={index} className="overflow-hidden" style={{ height: 34 * (1 - gone) }}>
                  <div className={`${tableGrid} h-[34px]`} style={{ opacity: 1 - gone }}>
                    {row.slice(0, 5).map((cell, column) => (
                      <span
                        key={column}
                        className={column === 1 && keep ? 'text-student' : undefined}
                      >
                        {cell}
                      </span>
                    ))}
                  </div>
                </div>
              );
            })}
            <div className="overflow-hidden" style={{ height: 30 * (1 - shrink) }}>
              <span className="font-mono text-small" style={{ opacity: 1 - shrink }}>
                2,306 more rows
              </span>
            </div>
          </div>
          <Grow p={questions} height={112}>
            <div className="flex flex-col">
              <span className="pb-2 font-mono text-small font-medium">questions.csv</span>
              <div className="grid h-8 grid-cols-[1fr_2.6fr_0.8fr] items-center gap-2 border-b border-line font-mono text-small font-medium">
                <span>question_id</span>
                <span>topic</span>
                <span>correct</span>
              </div>
              {[
                ['Q-0059', 'Rule 2B - Verb Tense', 'C'],
                ['Q-0040', 'Rule 5B - Function Notation', 'B'],
              ].map((row) => (
                <div
                  key={row[0]}
                  className="grid h-[34px] grid-cols-[1fr_2.6fr_0.8fr] items-center gap-2 font-mono text-small"
                >
                  {row.map((cell) => (
                    <span key={cell}>{cell}</span>
                  ))}
                </div>
              ))}
            </div>
          </Grow>
          <div
            className="flex flex-col gap-3 border-t border-line pt-4"
            style={{ opacity: repaired }}
          >
            <span className="flex items-center gap-2.5 font-medium">
              <Check size={17} strokeWidth={2} className="text-student" aria-hidden />
              Repaired: passed 2 cases
            </span>
            <Grow p={cases} height={104}>
              <div className="flex flex-col gap-3 pl-7 text-ui">
                <span className="flex flex-col">
                  <span className="font-medium">Reduced case</span>
                  <span>Finds both questions at the place and picks the one in Math.</span>
                </span>
                <span className="flex flex-col">
                  <span className="font-medium">Original attempt</span>
                  <span>
                    Runs on the attempt's own inputs with no value the checker contradicts.
                  </span>
                </span>
              </div>
            </Grow>
          </div>
        </div>
      </div>
    </div>
  );
}
