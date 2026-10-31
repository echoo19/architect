import type { ReactNode } from 'react';
import { Button, LogoMark } from '@architect/ui';
import {
  ArrowUp,
  Building2,
  Check,
  ChevronDown,
  ChevronRight,
  FilePlus2,
  Laptop,
  Lock,
  Wifi,
  WifiOff,
} from 'lucide-react';
import { ACADEMY, type Specialist } from './data';
import { clamp, count, mix, outQuart, rise, span, ui } from './time';

/**
 * A staff member asks the academy desk about a missed question at Harborview Prep, an academy it
 * never saw, with the network off. The case is real: Vito Vasquez chose 230 on question 6 of
 * Mock Exam D's second module, and the practice and the staff note follow Harborview's policy
 * (architect-runs/phil-1/job/orgs/harborview).
 */
export function WorkspacePage({ lt, allowAt }: { lt: number; allowAt: number }) {
  const offline = ui(lt, 1.2, 0.3);
  const answerWords = ANSWER.split(' ');
  const shown = Math.round(mix(0, answerWords.length, clamp((lt - 4.4) / 2.4)));
  const saved = ui(lt, allowAt + 0.15, 0.25);
  // The conversation rises as it grows, as a chat keeps its newest line in view.
  const scroll = mix(0, 114, outQuart(span(lt, 7.0, 1.4)));
  return (
    <div className="relative flex h-full flex-col">
      <header className="flex h-14 shrink-0 items-center justify-between gap-3 pl-7 pr-5">
        <span className="font-medium">Vito missed question 6</span>
        <span className="flex items-center gap-5 text-small">
          <span className="flex items-center gap-2">
            <Building2 size={14} strokeWidth={1.8} aria-hidden />
            Harborview Prep
            <ChevronDown size={13} strokeWidth={1.8} aria-hidden />
          </span>
          <span className="grid" data-frame="network">
            <span
              className="flex items-center gap-2 [grid-area:1/1]"
              style={{ opacity: 1 - offline }}
            >
              <Wifi size={14} strokeWidth={1.8} aria-hidden />
              Online
            </span>
            <span
              className="flex items-center gap-2 font-medium [grid-area:1/1]"
              style={{ opacity: offline, transform: `translateY(${(1 - offline) * 6}px)` }}
            >
              <WifiOff size={14} strokeWidth={1.8} aria-hidden />
              Offline
            </span>
          </span>
          <span className="flex items-center gap-2">
            <Laptop size={14} strokeWidth={1.8} aria-hidden />
            Running on this computer
          </span>
        </span>
      </header>
      <div className="relative min-h-0 flex-1 overflow-hidden">
        <div
          className="mx-auto flex w-[680px] flex-col gap-5 pt-6"
          style={{ transform: `translateY(${-scroll}px)` }}
          data-frame="chat"
        >
          <div
            className="ml-auto max-w-[540px] rounded-card bg-raised px-5 py-3.5 text-body"
            style={rise(lt, 2.4, 8)}
          >
            Vito missed question 6 in module 2 of Mock Exam D. What should happen next?
          </div>
          <span className="flex items-center gap-1.5 text-ui font-medium" style={rise(lt, 3.8, 6)}>
            4 steps
            <ChevronRight size={14} strokeWidth={1.8} aria-hidden />
          </span>
          <p className="m-0 text-body" style={{ opacity: ui(lt, 4.3, 0.2) }}>
            {answerWords.map((word, index) => (
              <span key={index} style={{ opacity: index < shown ? 1 : 0 }}>
                {word}{' '}
              </span>
            ))}
          </p>
          <Proposal
            file="data/assignments.csv"
            count="3 new rows"
            columns={['assignment_id', 'student_id', 'question_id', 'assigned_on', 'assigned_by']}
            rows={[
              ['HW-00013', 'L005', 'QB-30231', '2026-11-14', 'C3'],
              ['HW-00014', 'L005', 'QB-30518', '2026-11-14', 'C3'],
              ['HW-00015', 'L005', 'QB-31036', '2026-11-14', 'C3'],
            ]}
            p={outQuart(span(lt, 7.4, 0.7))}
            saved={saved}
            click
          />
          <Proposal
            file="data/staff_notes.csv"
            count="1 new row"
            columns={['note_id', 'student_id', 'staff_id', 'written_on', 'topic']}
            rows={[['SN-004', 'L005', 'C3', '2026-11-14', 'M-PRO-08 Percent Change']]}
            p={outQuart(span(lt, 8.3, 0.7))}
            saved={0}
          />
        </div>
      </div>
      <div className="shrink-0 bg-ground px-8 pb-5 pt-2">
        <div className="mx-auto flex w-[680px] flex-col gap-3 rounded-card bg-card px-5 py-4 shadow-edge">
          <span className="text-body text-fg-dim">Ask {ACADEMY}</span>
          <span className="flex items-center justify-between">
            <Lock size={15} strokeWidth={1.8} aria-hidden />
            <span className="grid size-8 place-items-center rounded-full bg-selected">
              <ArrowUp size={15} strokeWidth={1.8} aria-hidden />
            </span>
          </span>
        </div>
      </div>
    </div>
  );
}

const ANSWER =
  'He chose 230: he took the 10% off as $10. The answer is B, 216 (M-PRO-08 Percent Change). First hint: FH-038. I set 3 practice questions in his band, and since he has 4 misses on this topic in 30 days, I added a note for his tutor, Mira Pemberton.';

function Proposal({
  file,
  count: size,
  columns,
  rows,
  p,
  saved,
  click,
}: {
  file: string;
  count: string;
  columns: readonly string[];
  rows: readonly (readonly string[])[];
  p: number;
  saved: number;
  click?: boolean;
}) {
  const height = 56 + 30 + rows.length * 32 + 8;
  return (
    <div className="overflow-hidden" style={{ height: p * height, marginTop: (p - 1) * 20 }}>
      <div
        className="flex flex-col rounded-card bg-card shadow-edge"
        style={{ opacity: clamp(p * 1.5 - 0.2), transform: `translateY(${(1 - p) * 10}px)` }}
      >
        <div className="flex h-14 items-center gap-3 px-4">
          <span className="grid size-9 place-items-center rounded-control bg-selected">
            <FilePlus2 size={16} strokeWidth={1.8} aria-hidden />
          </span>
          <span className="flex flex-1 flex-col">
            <span className="text-ui">
              Add to <span className="font-mono">{file}</span>
            </span>
            <span className="text-small">{size}</span>
          </span>
          <span className="grid">
            <span
              className="flex items-center gap-2 [grid-area:1/1]"
              style={{ opacity: 1 - saved }}
            >
              <Button size="sm">Deny</Button>
              <span data-click={click ? 'allow' : undefined}>
                <Button size="sm" variant="primary">
                  Allow once
                </Button>
              </span>
            </span>
            <span
              className="flex items-center justify-end gap-2 text-ui font-medium text-student [grid-area:1/1]"
              style={{ opacity: saved, transform: `scale(${mix(0.94, 1, saved)})` }}
            >
              <Check size={16} strokeWidth={2} aria-hidden />
              Saved
            </span>
          </span>
        </div>
        <div className="px-3 pb-2">
          <div
            className="grid h-[30px] items-center gap-2 px-3 font-mono text-small font-medium"
            style={{ gridTemplateColumns: `repeat(${columns.length}, minmax(0, 1fr))` }}
          >
            {columns.map((column) => (
              <span key={column} className="truncate">
                {column}
              </span>
            ))}
          </div>
          {rows.map((row) => (
            <div
              key={row[0]}
              className="grid h-8 items-center gap-2 rounded-mark bg-student-soft px-3 font-mono text-small"
              style={{
                gridTemplateColumns: `repeat(${columns.length}, minmax(0, 1fr))`,
                marginBottom: 0,
              }}
            >
              {row.map((cell, index) => (
                <span key={index} className="truncate">
                  {cell}
                </span>
              ))}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

const WELCOME_STEPS = ['Edition', 'Model', 'Teacher', 'Faster training', 'Done'] as const;

/** The first screen: the edition chosen, and switchable later in Settings (welcome-editions-dark.png). */
export function WelcomePage({ lt, chooseAt }: { lt: number; chooseAt: number }) {
  const lab = ui(lt, chooseAt + 0.05, 0.25);
  return (
    <div className="relative flex h-full flex-col">
      <header className="flex h-14 shrink-0 items-center border-b border-line px-6">
        <span className="flex items-center gap-2.5">
          <LogoMark size={20} />
          <span className="text-body font-semibold">Architect</span>
        </span>
        <span className="absolute left-1/2 flex -translate-x-1/2 gap-1 text-ui">
          {WELCOME_STEPS.map((step, index) => (
            <span
              key={step}
              className={`flex h-9 items-center rounded-full px-3.5 ${index === 0 ? 'bg-selected' : ''}`}
            >
              {step}
            </span>
          ))}
        </span>
      </header>
      <div className="flex flex-1 flex-col items-center pt-24" data-frame="editions">
        <h1 className="m-0 font-display text-h1 font-semibold" style={rise(lt, 0.3, 8)}>
          Welcome to Architect
        </h1>
        <p className="mb-0 mt-4 text-body" style={rise(lt, 0.5, 8)}>
          Choose how you'll use it. You can switch in Settings at any time.
        </p>
        <div className="mt-10 grid w-[680px] grid-cols-2 gap-4" style={rise(lt, 0.8, 10)}>
          <Edition title="Architect" detail="Teach an agent one job" selected={1 - lab} />
          <span data-click="lab-edition">
            <Edition
              title="Architect Lab"
              detail="Fields, experiments, models and compute"
              selected={lab}
            />
          </span>
        </div>
      </div>
      <div className="flex h-20 shrink-0 items-center justify-end border-t border-line px-[235px]">
        <Button size="lg" variant="primary">
          Continue
        </Button>
      </div>
    </div>
  );
}

function Edition({ title, detail, selected }: { title: string; detail: string; selected: number }) {
  return (
    <span className="relative flex h-[104px] flex-col justify-center gap-1.5 rounded-card bg-card px-6 shadow-edge">
      <span
        aria-hidden
        className="absolute inset-0 rounded-card"
        style={{ boxShadow: `inset 0 0 0 1.5px rgb(255 255 255 / ${0.92 * selected})` }}
      />
      <span className="flex items-center justify-between">
        <span className="font-display text-h2 font-semibold">{title}</span>
        <span className="relative grid size-5 place-items-center rounded-full shadow-edge-strong">
          <span
            className="size-2.5 rounded-full bg-fg"
            style={{ opacity: selected, transform: `scale(${selected})` }}
          />
          <span
            aria-hidden
            className="absolute inset-0 rounded-full"
            style={{ boxShadow: `inset 0 0 0 1.5px rgb(255 255 255 / ${selected})` }}
          />
        </span>
      </span>
      <span className="text-body">{detail}</span>
    </span>
  );
}

/** A specialist as the opening shows it: what it does, and its measured result where there is one. */
export function GalleryCard({ agent, lt }: { agent: Specialist; lt: number }) {
  const figure = agent.figure;
  const value = figure ? count(lt, 0, 1.4, 0, Number(figure.value)) : 0;
  return (
    <div className="flex h-full flex-col justify-between px-6 pb-6 pt-[86px]">
      <span className="text-[17px] leading-[1.45]">{agent.does}</span>
      {figure ? (
        <div className="flex flex-col gap-1.5">
          <span className="font-display text-[48px] font-semibold leading-none tracking-[-0.03em] tabular-nums">
            {value}
            <span className="text-[24px] tracking-[-0.01em]"> of {figure.of}</span>
          </span>
          <span className="text-[16px]">{figure.label}</span>
        </div>
      ) : (
        <span className="text-[16px]">The sample job that ships with Architect</span>
      )}
    </div>
  );
}

/** The command that serves the academy desk to other apps on this computer (docs/CLI.md, serve). */
export function Terminal({ lt }: { lt: number }) {
  const command = 'architect serve academy-desk';
  const typed = Math.round(mix(0, command.length, clamp((lt - 0.6) / 1.3)));
  const lines: readonly ReactNode[] = [
    'Serving Academy desk, version 1, on muse-glimmer:30b (ollama), to apps on this computer only.',
    'Changes to files come back as proposals; nothing is written. Ctrl+C stops.',
    <>Base URL: http://127.0.0.1:8420/v1</>,
    <>Model: academy-desk</>,
  ];
  return (
    <div className="flex h-full flex-col rounded-card bg-raised shadow-float">
      <div className="flex h-10 shrink-0 items-center border-b border-line px-5 text-small font-medium">
        Terminal
      </div>
      <div className="flex flex-col gap-1.5 whitespace-pre px-5 py-4 font-mono text-ui">
        <span>
          <span className="text-fg-dim">$ </span>
          {command.slice(0, typed)}
        </span>
        {lines.map((line, index) => (
          <span
            key={index}
            style={{ opacity: ui(lt, 2.3 + index * 0.25, 0.2) }}
            className="whitespace-pre-wrap"
          >
            {line}
          </span>
        ))}
      </div>
    </div>
  );
}
