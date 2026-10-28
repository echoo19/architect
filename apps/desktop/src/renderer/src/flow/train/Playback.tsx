import { useState, type ReactNode } from 'react';
import { cn, DrawerSection, StepList, StepListItem, StepListNav } from '@architect/ui';
import {
  Ban,
  BookOpen,
  CircleX,
  FilePen,
  FileText,
  Flag,
  FolderSearch,
  MessageSquare,
  SquareTerminal,
  TextSearch,
  Wrench,
  type LucideIcon,
} from 'lucide-react';
import { formatAnswerTime } from '../format';
import type { ShownStep, StepNote } from './lesson-steps';
import { CallEvidence } from './StepEvidence';
import { callLine, firstLine, type PlaybackCall } from './trace-steps';

const TOOL_ICONS: Record<string, LucideIcon> = {
  read: FileText,
  ls: FolderSearch,
  glob: FolderSearch,
  grep: TextSearch,
  write: FilePen,
  edit: FilePen,
  append: FilePen,
  run: SquareTerminal,
};

function callIcon(call: PlaybackCall, failed: boolean): LucideIcon {
  if (failed) return CircleX;
  if (call.skill !== undefined) return BookOpen;
  return TOOL_ICONS[call.step.name] ?? Wrench;
}

export interface PlaybackProps {
  /** The section's title, such as "Glimmer's steps". */
  title: string;
  steps: readonly ShownStep[];
  /** The step number the playback opens at; the first step when absent. */
  openAt?: number;
  notes?: readonly StepNote[];
  /** A line before the first step replayed from the student's attempt, naming whose they are. */
  replayed?: ReactNode;
  /** A line before the first step the mentor took, where a correction began. */
  takeover?: ReactNode;
  /** Scroll the step it opens at into view, as when a finding names it. On by default. */
  revealOnOpen?: boolean;
  mentor: string;
  student: string;
}

/**
 * An attempt step by step, from the keyboard (Up and Down, or K and J) as well as the mouse:
 * each step's line, and under the current one what the agent wrote, each call's evidence and the
 * raw call. Steps Spark took as the agent carry its color; replayed ones are muted.
 */
export function Playback({
  title,
  steps,
  openAt,
  notes = [],
  replayed,
  takeover,
  revealOnOpen = true,
  mentor,
  student,
}: PlaybackProps) {
  const start = Math.max(
    0,
    steps.findIndex((shown) => shown.step.number === openAt),
  );
  const [current, setCurrent] = useState(start);
  const firstReplayed = steps.findIndex((shown) => shown.replayed);
  const firstMentor = steps.findIndex((shown) => shown.actor === 'mentor');
  const divider = (index: number) => {
    if (index === firstReplayed && replayed) return <Divider>{replayed}</Divider>;
    if (index === firstMentor && takeover) return <Divider tone="mentor">{takeover}</Divider>;
    return null;
  };
  if (steps.length === 0) {
    return (
      <DrawerSection title={title}>
        <p className="m-0 text-fg-secondary">No steps were recorded.</p>
      </DrawerSection>
    );
  }
  return (
    <DrawerSection
      title={title}
      actions={<StepListNav count={steps.length} current={current} onCurrentChange={setCurrent} />}
    >
      <StepList
        aria-label={title}
        count={steps.length}
        current={current}
        onCurrentChange={setCurrent}
        revealOnOpen={revealOnOpen}
      >
        {steps.map((shown, index) => {
          const stepNotes = notes.filter((note) => note.number === shown.step.number);
          return (
            <StepListItem
              key={`${shown.actor}-${shown.step.number}-${index}`}
              index={index}
              tone={shown.actor === 'mentor' ? 'mentor' : shown.replayed ? 'muted' : 'default'}
              lead={<StepNumber shown={shown} />}
              line={
                <StepLine
                  shown={shown}
                  noted={stepNotes.length > 0}
                  open={index === current}
                  mentor={mentor}
                />
              }
              before={divider(index)}
            >
              <StepDetail
                shown={shown}
                notes={stepNotes}
                mentor={mentor}
                who={shown.actor === 'mentor' ? mentor : student}
              />
            </StepListItem>
          );
        })}
      </StepList>
    </DrawerSection>
  );
}

function StepNumber({ shown }: { shown: ShownStep }) {
  return (
    <span
      className={cn(
        'w-6 shrink-0 pt-px text-right font-mono text-sm tabular-nums',
        shown.actor === 'mentor' ? 'text-mentor' : 'text-fg-muted',
      )}
    >
      {shown.step.number}
    </span>
  );
}

/**
 * A divider across the list, naming whose steps follow: the student's replayed ones, or the
 * mentor's from where it took over, in the mentor's color.
 */
function Divider({ tone = 'muted', children }: { tone?: 'muted' | 'mentor'; children: ReactNode }) {
  return (
    <div
      className={cn(
        'flex items-center gap-3 px-3 py-2 text-sm',
        tone === 'mentor' ? 'text-mentor' : 'text-fg-muted',
      )}
    >
      <span
        className={cn('h-px flex-1', tone === 'mentor' ? 'bg-mentor/40' : 'bg-line-row-strong')}
        aria-hidden
      />
      <span className="shrink-0">{children}</span>
      <span
        className={cn('h-px flex-1', tone === 'mentor' ? 'bg-mentor/40' : 'bg-line-row-strong')}
        aria-hidden
      />
    </div>
  );
}

/** A step's line: each call it made, or what it said when it made none. */
function StepLine({
  shown,
  noted,
  open,
  mentor,
}: {
  shown: ShownStep;
  noted: boolean;
  /** The step is the current one, with its evidence under the line. */
  open: boolean;
  mentor: string;
}) {
  const { step } = shown;
  const flag = noted ? (
    <Flag
      size={13}
      strokeWidth={2}
      role="img"
      aria-label={`${mentor}'s note`}
      className="mt-[3px] shrink-0 text-mentor"
    />
  ) : null;
  if (step.refusal) {
    return (
      <LineRow icon={Ban} flag={flag}>
        <span>Turned the request down</span>
      </LineRow>
    );
  }
  if (step.calls.length === 0) {
    return (
      <LineRow icon={MessageSquare} flag={flag}>
        {step.answer ? (
          <span className="flex min-w-0 items-baseline gap-2">
            <span className="shrink-0">Answered</span>{' '}
            <span className="truncate font-mono text-fg-secondary">{firstLine(step.text)}</span>
          </span>
        ) : (
          <span className="truncate text-fg-soft">{firstLine(step.text) || 'No words'}</span>
        )}
      </LineRow>
    );
  }
  return (
    <>
      {step.calls.map((call, index) => {
        const line = callLine(call);
        // Open, code shows its own output under the line, so the line's summary would repeat it.
        const meta = open && call.step.name === 'run' && !line.failed ? '' : line.meta;
        return (
          <LineRow
            key={call.step.callId}
            icon={callIcon(call, line.failed)}
            failed={line.failed}
            flag={index === 0 ? flag : null}
          >
            {/* Spaces between the parts, so the line reads as words, not one run of text. */}
            <span className="flex min-w-0 flex-wrap items-baseline gap-x-2">
              <span className={line.failed ? 'text-danger' : undefined}>{line.action}</span>
              {line.target !== '' && (
                <>
                  {' '}
                  <span className="min-w-0 truncate font-mono text-fg-secondary">
                    {line.target}
                  </span>
                </>
              )}
              {meta !== '' && (
                <>
                  {' '}
                  <span className="text-fg-muted">{meta}</span>
                </>
              )}
            </span>
          </LineRow>
        );
      })}
    </>
  );
}

function LineRow({
  icon: Icon,
  failed = false,
  flag,
  children,
}: {
  icon: LucideIcon;
  failed?: boolean;
  flag: ReactNode;
  children: ReactNode;
}) {
  return (
    <span className="flex min-w-0 items-start gap-2.5">
      <Icon
        size={14}
        strokeWidth={1.7}
        aria-hidden
        className={cn('mt-[3px] shrink-0', failed ? 'text-danger' : 'text-fg-muted')}
      />
      <span className="flex min-w-0 flex-1">{children}</span>
      {flag}
    </span>
  );
}

/** Under the current step: Spark's notes, what the agent wrote, and each call's evidence. */
function StepDetail({
  shown,
  notes,
  mentor,
  who,
}: {
  shown: ShownStep;
  notes: readonly StepNote[];
  mentor: string;
  who: string;
}) {
  const { step } = shown;
  return (
    <>
      {notes.length > 0 && (
        // One flag for the step: what Spark suspects of it first, then its evidence.
        <div className="flex items-start gap-2 text-sm text-mentor">
          <Flag size={13} strokeWidth={2} aria-hidden className="mt-[3px] shrink-0" />
          <div className="flex min-w-0 flex-col gap-0.5">
            <span className="font-medium">
              {notes.some((note) => note.suspected)
                ? `${mentor} suspects this step`
                : `${mentor}'s note`}
            </span>
            {notes.map((note) => (
              <span key={`${note.suspected}-${note.text}`} className="text-pretty">
                {note.text}
              </span>
            ))}
          </div>
        </div>
      )}
      {step.skills.map((skill) => (
        <p key={skill} className="m-0 flex items-center gap-2 text-sm text-fg-secondary">
          <BookOpen size={13} strokeWidth={1.7} aria-hidden className="shrink-0" />
          <span>
            Loaded the skill <span className="font-mono">{skill}</span>, which matches the request
          </span>
        </p>
      ))}
      {step.refusal && (
        <p className="m-0 text-sm text-fg-secondary text-pretty">{step.refusal.reason}</p>
      )}
      {step.text.trim() !== '' && (
        <div className="flex flex-col gap-1">
          <span className="text-xs text-fg-muted">{who}</span>
          <pre
            className={cn(
              'm-0 whitespace-pre-wrap break-words text-sm text-fg-soft',
              step.answer ? 'rounded-md bg-well px-3 py-2 font-mono' : 'font-sans',
            )}
          >
            {step.text}
          </pre>
        </div>
      )}
      {step.calls.map((call) => (
        <CallEvidence key={call.step.callId} step={call.step} />
      ))}
      <span className="text-xs text-fg-muted">
        Took{' '}
        <span className="font-mono">
          {formatAnswerTime(
            step.latencyMs + step.calls.reduce((sum, call) => sum + call.step.latencyMs, 0),
          )}
        </span>
      </span>
    </>
  );
}
