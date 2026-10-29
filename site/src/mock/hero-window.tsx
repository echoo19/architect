import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { cn } from '@architect/ui';
import { Bullets, DataCard, KeepIds, P, Prose, Reply, UserBubble, WorkedFor } from './chat';
import { AppWindow, ChatHeader, Sidebar } from './frame';
import { JOBS, sidebarFor, type JobChat } from './jobs';
import { at } from './motion';
import { Stage } from './stage';

/** How long a job stays on screen before the window hands over to the next, in ms. */
const HOLD = 7600;
/** How long the old job's lines take to leave, in ms. */
const HAND_OVER = 1100;

type Phase = 'in' | 'out';

/**
 * One element's turn in the roll. Going out, the lines leave in order from the top; coming in,
 * each arrives from below just after the one above it, so the new job resolves down the page.
 */
function turn(phase: Phase, order: number): { className: string; style: CSSProperties } {
  return phase === 'in'
    ? { className: 'a a-up', style: at(420 + order * 100, { dur: 600, dy: 18 }) }
    : { className: 'a a-exit-up', style: at(order * 55, { dur: 300, dy: 18 }) };
}

function Lead({ job, phase }: { job: JobChat; phase: Phase }) {
  const { className, style } = turn(phase, 3);
  return (
    <P className={className} style={style}>
      {job.lead.map((part, index) =>
        typeof part === 'string' ? (
          part
        ) : (
          <strong key={index} className="font-semibold">
            {part.b}
          </strong>
        ),
      )}
    </P>
  );
}

/** One job's conversation, as a layer the roll can bring in or take out. */
function Conversation({ job, phase }: { job: JobChat; phase: Phase }) {
  const ask = turn(phase, 1);
  const worked = turn(phase, 2);
  const intro = turn(phase, 6);
  const card = turn(phase, 7);
  return (
    <div className="mx-auto flex max-w-[720px] flex-col gap-10 text-chat">
      <UserBubble className={ask.className} style={ask.style}>
        <KeepIds text={job.ask} />
      </UserBubble>
      <Reply>
        <WorkedFor className={worked.className} style={worked.style}>
          {job.worked}
        </WorkedFor>
        <Prose>
          <Lead job={job} phase={phase} />
          <div className="narrow:hidden">
            <Bullets
              items={job.bullets.map((bullet) => (
                <KeepIds text={bullet} />
              ))}
              itemClassName={turn(phase, 4).className}
              itemStyle={(index) => turn(phase, 4 + index).style}
            />
          </div>
          <P className={intro.className} style={intro.style}>
            {job.intro}
          </P>
        </Prose>
        <DataCard
          label={job.table.label}
          columns={job.table.columns}
          rows={job.table.rows}
          hideOnNarrow={job.table.hideOnNarrow}
          note={job.table.note}
          className={card.className}
          style={card.style}
        />
      </Reply>
    </div>
  );
}

/** The chat's title, which rolls to the next one inside its own line. */
function Title({ job, phase }: { job: JobChat; phase: Phase }) {
  const { className, style } = turn(phase, 0);
  return (
    <span
      className={cn('block truncate', phase === 'out' && 'absolute inset-0', className)}
      style={style}
    >
      {job.title}
    </span>
  );
}

/**
 * The window over the page's first screen, near its real size and cropped by the band's bottom
 * edge. It is the one thing on the page that cycles: every few seconds the returns desk's next
 * finished chat takes its turn in the same frame, and only what is inside the conversation changes.
 */
export function HeroWindow() {
  const stage = useRef<HTMLDivElement>(null);
  const [turnState, setTurnState] = useState<{ index: number; previous: number | null }>({
    index: 0,
    previous: null,
  });
  const [onScreen, setOnScreen] = useState(true);
  const [tabShown, setTabShown] = useState(true);

  useEffect(() => {
    const node = stage.current;
    if (!node || typeof IntersectionObserver === 'undefined') return;
    const watcher = new IntersectionObserver(
      (entries) => setOnScreen(entries.some((entry) => entry.isIntersecting)),
      { threshold: 0.1 },
    );
    watcher.observe(node);
    return () => watcher.disconnect();
  }, []);

  useEffect(() => {
    const update = () => setTabShown(document.visibilityState === 'visible');
    document.addEventListener('visibilitychange', update);
    return () => document.removeEventListener('visibilitychange', update);
  }, []);

  const cycling = onScreen && tabShown;
  useEffect(() => {
    // Reduced motion pins the window to its first job, still.
    if (!cycling || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const timer = window.setInterval(() => {
      setTurnState((state) => ({ index: (state.index + 1) % JOBS.length, previous: state.index }));
    }, HOLD);
    return () => window.clearInterval(timer);
  }, [cycling]);

  const { index, previous } = turnState;
  useEffect(() => {
    if (previous === null) return;
    const timer = window.setTimeout(
      () => setTurnState((state) => ({ ...state, previous: null })),
      HAND_OVER,
    );
    return () => window.clearTimeout(timer);
  }, [previous]);

  const job = JOBS[index] ?? JOBS[0];
  const before = previous === null ? undefined : JOBS[previous];
  if (!job) return null;

  return (
    <Stage
      ref={stage}
      id="hero"
      label="The Architect window with the returns desk agent of an outdoor-gear shop, showing three finished chats in turn: a tent return refunded with its fees, a customer's spending on tents, and a return that was denied. Each has the agent's answer and a table of figures."
      heightWide={692}
      heightCompact={620}
      playback="playing"
    >
      <AppWindow className="inset-x-3 top-3 flex h-[800px] wide:inset-x-7 wide:top-7">
        <Sidebar agents={sidebarFor(index)} className="narrow:hidden" />
        <div className="flex min-w-0 flex-1 flex-col">
          <ChatHeader
            title={
              <span className="relative block h-6 overflow-hidden">
                {before && <Title key={`out-${previous}`} job={before} phase="out" />}
                <Title key={`in-${index}`} job={job} phase="in" />
              </span>
            }
          />
          <div className="relative min-h-0 flex-1 overflow-hidden px-8 pt-8 narrow:px-4 narrow:pt-5">
            <div className="relative">
              {before && (
                <div key={`out-${previous}`} className="absolute inset-x-0 top-0">
                  <Conversation job={before} phase="out" />
                </div>
              )}
              <Conversation key={`in-${index}`} job={job} phase="in" />
            </div>
          </div>
        </div>
      </AppWindow>
    </Stage>
  );
}
