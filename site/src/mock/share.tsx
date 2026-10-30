import type { ReactNode } from 'react';
import { Button, cn, IconButton } from '@architect/ui';
import { Check, ExternalLink, X } from 'lucide-react';
import { Insert, Swap, Typed } from './kit';
import { at } from './motion';
import { ChapterStage } from './stage';

/**
 * Handing the agent to someone else: the Export dialog publishing it to a private Hugging Face
 * repository, and a terminal where `architect` installs that commit and runs it. The repository is
 * made up. The terminal's lines are the ones the command prints, from docs/CLI.md.
 */

const REPO = 'larchwood/returns';
const COMMIT = '3f9a2c1';

/** When things happen, in ms from the start. */
const PICK = 700;
const FIELDS = 1100;
const NAME = 1500;
const PUBLISH = 3000;
const PUBLISHED = PUBLISH + 500;
const TERMINAL = 3300;

interface Line {
  /** What the terminal prints, in order. A command is typed; the rest arrives whole. */
  text: string;
  command?: boolean;
}

const LINES: readonly Line[] = [
  {
    text: `architect install hf://${REPO} --revision ${COMMIT} --bind data=./records --grant data=read_write`,
    command: true,
  },
  { text: 'architect run returns-desk', command: true },
  { text: 'Returns desk, version 1, on muse-glimmer:30b (ollama).' },
  { text: '> Book the earliest pickup for return RT-4106.' },
  { text: '  read data/returns.csv (1 row)' },
  { text: 'Add 1 row to data/pickups.csv:' },
  { text: '  + PU-4106, RT-4106, Cedarline Parcel, 2026-12-04, 2026-11-24' },
  { text: 'Allow this change? [y]es, [n]o, [a]lways for this agent: y' },
  { text: '  append data/pickups.csv (1 row added)' },
  { text: 'Booked. Cedarline Parcel will collect RT-4106 on Friday, December 4.' },
];

/** When each line of the terminal starts, in ms from the start. */
const LINE_AT = [
  TERMINAL,
  TERMINAL + 1600,
  TERMINAL + 2200,
  TERMINAL + 2650,
  TERMINAL + 3300,
  TERMINAL + 3750,
  TERMINAL + 4050,
  TERMINAL + 4700,
  TERMINAL + 5300,
  TERMINAL + 5800,
] as const;

function Segment({
  options,
  selected,
  from,
  pickAt,
}: {
  options: readonly [string, string];
  /** The one that ends up selected. */
  selected: 0 | 1;
  /** Where the selection starts, when it moves. */
  from?: 0 | 1;
  pickAt?: number;
}) {
  const pill = 'absolute inset-y-0 w-1/2 rounded-full bg-selected';
  const place = (index: number) => (index === 0 ? 'left-0' : 'left-1/2');
  return (
    <span className="relative inline-grid grid-cols-2 rounded-full bg-hover p-[3px] text-small">
      <span className="absolute inset-[3px]">
        {from !== undefined && pickAt !== undefined && (
          <span
            aria-hidden
            className={cn(pill, place(from), 'a a-exit-up motion-only')}
            style={at(pickAt - 30, { dur: 200, dy: 0 })}
          />
        )}
        <span
          aria-hidden
          className={cn(pill, place(selected), from !== undefined && 'a a-fade')}
          style={from !== undefined && pickAt !== undefined ? at(pickAt, { dur: 260 }) : undefined}
        />
      </span>
      {options.map((option) => (
        <span
          key={option}
          className="relative flex h-8 items-center justify-center whitespace-nowrap px-4 narrow:px-3"
        >
          {option}
        </span>
      ))}
    </span>
  );
}

function Row({ label, start, children }: { label: string; start: number; children: ReactNode }) {
  return (
    <li
      className="a a-up flex min-h-14 items-center justify-between gap-4 border-t border-line"
      style={at(start, { dy: 10, dur: 560 })}
    >
      <span>{label}</span>
      {children}
    </li>
  );
}

function Dialog() {
  return (
    <section
      aria-label="Export"
      className="a a-pop flex min-w-0 flex-col rounded-card bg-raised shadow-float"
      style={at(150, { dur: 500 })}
    >
      <div className="flex min-h-16 items-center justify-between px-6">
        <h3 className="m-0 font-display text-h2 font-semibold">Export</h3>
        <IconButton label="Close" size="sm" tabIndex={-1}>
          <X size={16} strokeWidth={1.8} aria-hidden />
        </IconButton>
      </div>
      <div className="flex flex-col gap-1 px-6 pb-2">
        <span className="pb-3">
          <Segment options={['Package file', 'Hugging Face']} selected={1} from={0} pickAt={PICK} />
        </span>
        <ul className="m-0 flex list-none flex-col p-0">
          <Row label="Name" start={FIELDS}>
            <span className="min-w-0 rounded-control bg-field px-3.5 py-2 font-mono text-ui shadow-edge-strong">
              <Typed text={REPO} start={NAME} step={1} />
            </span>
          </Row>
          <Row label="Visibility" start={FIELDS + 140}>
            <Segment options={['Private', 'Public']} selected={0} />
          </Row>
          <Row label="Token" start={FIELDS + 280}>
            <span className="flex items-center gap-1.5">
              <Check size={15} strokeWidth={2} aria-hidden />
              Saved
            </span>
          </Row>
        </ul>
        <Insert start={PUBLISHED} dur={600}>
          <div className="flex min-h-[72px] items-center justify-between gap-3 border-t border-line">
            <span className="flex min-w-0 items-center gap-3">
              <span className="flex size-9 shrink-0 items-center justify-center rounded-control bg-student-soft text-student">
                <Check size={17} strokeWidth={2} aria-hidden />
              </span>
              <span className="flex min-w-0 flex-col">
                <span className="font-medium">Version 1 is on Hugging Face</span>
                <span className="text-small">Commit {COMMIT}, private</span>
              </span>
            </span>
            <Button variant="secondary" size="sm" tabIndex={-1} className="narrow:hidden">
              <ExternalLink size={14} strokeWidth={1.7} aria-hidden />
              {REPO}
            </Button>
          </div>
        </Insert>
      </div>
      <div className="flex min-h-[76px] items-center justify-end border-t border-line px-6">
        <span className="a a-press inline-flex" style={at(PUBLISH, { dur: 360 })}>
          <Swap
            at={PUBLISHED}
            before={
              <Button variant="primary" size="md" tabIndex={-1}>
                Publish
              </Button>
            }
            after={
              <Button variant="secondary" size="md" tabIndex={-1}>
                <Check size={15} strokeWidth={2} aria-hidden />
                Published
              </Button>
            }
          />
        </span>
      </div>
    </section>
  );
}

function Terminal() {
  return (
    <section
      aria-label="Terminal"
      className="a a-pop min-w-0 rounded-card bg-ground p-5 shadow-edge-strong"
      style={at(TERMINAL - 400, { dur: 500 })}
    >
      <pre className="m-0 flex flex-col gap-1 whitespace-pre-wrap break-words font-mono text-small leading-[1.55]">
        {LINES.map((line, index) => {
          const start = LINE_AT[index] ?? TERMINAL;
          return (
            <code key={line.text} className={cn('block', line.command && index > 0 && 'mt-3')}>
              {line.command ? (
                <>
                  <span aria-hidden>$ </span>
                  <Typed text={line.text} start={start} step={34} />
                </>
              ) : (
                <span className="a a-fade" style={at(start, { dur: 260 })}>
                  {line.text}
                </span>
              )}
            </code>
          );
        })}
      </pre>
    </section>
  );
}

export function ShareMock() {
  return (
    <ChapterStage
      id="share"
      label="Two panels. On the left, the Architect Export dialog set to Hugging Face, with the repository name larchwood/returns, private visibility and a saved token, after publishing: version 1 is on Hugging Face at commit 3f9a2c1 and private. On the right, a terminal where the architect command installs that commit, runs the returns desk, shows the row it wants to add to pickups.csv, asks to allow the change, and after the answer yes books the pickup."
      heightWide={560}
    >
      <div className="absolute inset-0 grid grid-cols-[minmax(0,5fr)_minmax(0,6fr)] items-start gap-6 p-7 narrow:relative narrow:inset-auto narrow:grid-cols-1 narrow:gap-4 narrow:p-4">
        <Dialog />
        <Terminal />
      </div>
    </ChapterStage>
  );
}
