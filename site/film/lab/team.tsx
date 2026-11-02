import type { CSSProperties, ReactNode } from 'react';
import { AgentAvatar, Button, cn, InfoTip, Spinner, VersionTag } from '@architect/ui';
import { Check, ChevronDown, ChevronRight, Info, Square } from 'lucide-react';
import { TEAM } from './data';
import { camera, MOMENT, pageAt, Pointer, type Framing, type Measured } from './film';
import { Fields } from './pages-lab';
import { WelcomePage, WorkspacePage } from './pages-more';
import { CHAT_AGENT, ROW, SIDEBAR, Sidebar, TEAM_ROW, WINDOW } from './shell';
import { clamp, inOutCubic, mix, outQuart, span, ui } from './time';
import { World } from './why';

/**
 * Agents as a team, between Offline and the two editions: the Screening logistics team's chat at
 * Fenwick Screening Core, rebuilt from the app's team chat (workspace/Steps.tsx ConsultRow,
 * workspace/blocks.tsx ApprovalCard; docs/screenshots/team-*.png). Inventory desk leads: it asks
 * Assay desk which compounds need a re-test, whose own steps open under its avatar, then reserves
 * stock for exactly those, and each desk's write to its own file is a card of its own. The scene
 * leaves the Lab's window as Offline ends and turns to another kind of work: Fields opens with the
 * academy's row lit, the light moves to the screening labs' desks, then the sidebar scrolls down to
 * the team. It goes on to the first screen as the walkthrough does, so the cut on each side is
 * seamless.
 */

/** The walkthrough's moment the scene leaves, in authored seconds: Offline, the write saved. */
export const TEAM_FROM = 135.4;
/** The walkthrough's moment the scene returns to: the first screen, just in. */
export const TEAM_BACK = 143.8;
/** How long the turn from the academy to the screening labs takes, before the team's chat. */
const BRIDGE = 3.4;
/** The scene's length, in seconds. Its last 0.6 s are the first screen coming in. */
export const TEAM_LENGTH = BRIDGE + 10.8;

/** When each part comes in, in seconds from the scene's start. */
const AT = {
  /** Fields opens, its academy row lit, then the screening labs' desks. */
  fields: 0.75,
  academy: 1.15,
  lab: 2.35,
  click: BRIDGE + 0.75,
  request: BRIDGE + 0.95,
  read: BRIDGE + 1.35,
  /** The version that answers, on the steps' summary while it is still in view. */
  version: BRIDGE + 1.5,
  ask: BRIDGE + 1.65,
  open: BRIDGE + 2.0,
  quote: BRIDGE + 2.1,
  policy: BRIDGE + 2.4,
  code: BRIDGE + 2.65,
  output: BRIDGE + 2.95,
  added: BRIDGE + 3.55,
  answer: BRIDGE + 3.85,
  answered: BRIDGE + 4.15,
  search: BRIDGE + 4.5,
  reservations: BRIDGE + 4.75,
  adding: BRIDGE + 5.0,
  reply: BRIDGE + 5.5,
  bullets: [BRIDGE + 5.8, BRIDGE + 6.15],
  assay: BRIDGE + 6.6,
  hold: BRIDGE + 6.9,
  allow: BRIDGE + 8.1,
  /** When the first screen comes in, as the walkthrough has it 0.6 s before it returns. */
  leave: TEAM_LENGTH - (TEAM_BACK - pageAt('welcome')),
} as const;

/** The chat's last line sits here, so the camera's push never cuts what it shows. */
const CHAT = { top: 56, bottom: 476 } as const;

const STEP_LIST =
  'm-0 ml-1.5 flex min-w-0 list-none flex-col border-l border-line-strong py-0 pl-4 pr-0 text-small leading-normal';

/**
 * A part of the chat that opens to its own height as it comes in, and closes again from `until`:
 * the rows of a grid track grow from 0 to 1fr, so nothing has to be measured.
 */
function Grow({
  t,
  at,
  until = Infinity,
  dur = 0.4,
  className,
  children,
}: {
  t: number;
  at: number;
  until?: number;
  dur?: number;
  className?: string;
  children: ReactNode;
}) {
  const p = Math.min(outQuart(span(t, at, dur)), 1 - outQuart(span(t, until, 0.35)));
  if (p <= 0) return null;
  return (
    <div className="grid" style={{ gridTemplateRows: `${p}fr` }}>
      <div
        className={cn('min-h-0', className)}
        style={{
          clipPath: p < 1 ? 'inset(0 -40px)' : undefined,
          opacity: clamp(p * 1.4 - 0.25),
          transform: `translateY(${(1 - p) * 6}px)`,
        }}
      >
        {children}
      </div>
    </div>
  );
}

/** One step's words: what it did, on what, and what came back. */
function Step({ action, target, meta }: { action: ReactNode; target?: ReactNode; meta?: string }) {
  return (
    <span className="flex flex-wrap items-baseline gap-x-2">
      <span>{action}</span>
      {target}
      {meta && <span className="ml-1.5">{meta}</span>}
    </span>
  );
}

const Mono = ({ children }: { children: ReactNode }) => (
  <span className="font-mono">{children}</span>
);

function StepItem({ t, at, children }: { t: number; at: number; children: ReactNode }) {
  return (
    <Grow t={t} at={at} dur={0.3}>
      <div className="flex min-w-0 flex-col gap-2 py-[5px]">{children}</div>
    </Grow>
  );
}

/** Assay desk's own work, under the lead's step that asked it. */
function Consultation({ t }: { t: number }) {
  // The row says it is asking, with a spinner, until the answer's first line replaces both.
  const answered = t >= AT.answered;
  const open = ui(t, AT.open, 0.3);
  return (
    <div className="flex min-w-0 flex-col py-[5px]">
      <span className="flex min-w-0 items-center gap-x-2 self-start">
        <AgentAvatar name={TEAM.teammate} className="size-5" />
        <span>
          {answered ? 'Asked' : 'Asking'} {TEAM.teammate}
        </span>
        {/* Open, the step shows the answer itself, so its header shows no preview of it. */}
        {answered ? (
          <span style={{ opacity: ui(t, AT.answered, 0.3) }}>
            <VersionTag version={1} />
          </span>
        ) : (
          <Spinner size={13} />
        )}
        <ChevronRight
          size={13}
          strokeWidth={1.8}
          aria-hidden
          className="shrink-0"
          style={{ transform: `rotate(${open * 90}deg)` }}
        />
      </span>
      {t >= AT.open && (
        <div className={cn(STEP_LIST, 'mt-1.5')}>
          <StepItem t={t} at={AT.quote}>
            <q className="text-pretty">{TEAM.asked}</q>
          </StepItem>
          <StepItem t={t} at={AT.policy}>
            <Step action="Read" target={<Mono>data/policy.md</Mono>} />
          </StepItem>
          <StepItem t={t} at={AT.code}>
            <Step
              action="Ran code"
              target={<Mono>data/lumen_export.csv, data/compounds.csv</Mono>}
            />
            <div className="min-w-0 overflow-hidden rounded-control bg-field font-mono text-small leading-5">
              <span className="flex items-start gap-2 px-3 pt-2">
                <ChevronRight size={13} strokeWidth={1.8} aria-hidden className="mt-[3px]" />
                {TEAM.code} …
              </span>
              <span className="mt-2 flex flex-col border-t border-line px-3 py-2">
                {TEAM.output.map((line, index) => (
                  <span key={line} style={{ opacity: ui(t, AT.output + index * 0.15, 0.2) }}>
                    {line}
                  </span>
                ))}
              </span>
            </div>
          </StepItem>
          <StepItem t={t} at={AT.added}>
            <Step action="Added to" target={<Mono>data/retests.csv</Mono>} meta="2 rows" />
          </StepItem>
          <StepItem t={t} at={AT.answer}>
            <span className="text-pretty">{TEAM.answer}</span>
          </StepItem>
        </div>
      )}
    </div>
  );
}

/** "Allowed", as a decided card says it. */
function Allowed({ style }: { style?: CSSProperties }) {
  return (
    <span className="flex items-center gap-1.5 text-small" style={style}>
      <Check size={14} aria-hidden />
      Allowed
    </span>
  );
}

/** A desk's write to one of its own files, waiting for an answer or answered. */
function ApprovalCard({
  agent,
  file,
  count,
  allowed,
  rows,
}: {
  agent: string;
  file: string;
  count: string;
  /** How far "Allowed" has replaced the choice, from 0 to 1. */
  allowed: number;
  rows?: { columns: readonly string[]; row: readonly string[] };
}) {
  return (
    <div className="flex flex-col overflow-hidden rounded-card bg-raised leading-[1.4] shadow-edge-strong">
      <div className="flex items-center gap-3.5 py-3.5 pl-4 pr-3.5">
        <span className="flex min-w-0 flex-1 items-center gap-3.5">
          <AgentAvatar name={agent} />
          <span className="flex min-w-0 flex-col gap-0.5">
            <span className="flex min-w-0 items-center gap-1.5">
              <span className="shrink-0">Add to</span>
              <span className="truncate font-mono text-ui">{file}</span>
              <ChevronRight
                size={14}
                strokeWidth={1.8}
                aria-hidden
                className={cn('shrink-0', rows && 'rotate-90')}
              />
            </span>
            <span className="text-small">
              {agent}, {count}
            </span>
          </span>
        </span>
        <span className="grid items-center justify-items-end">
          {allowed < 1 && (
            <span className="flex gap-1.5 [grid-area:1/1]" style={{ opacity: 1 - allowed }}>
              <Button size="md" className="h-[38px]">
                Deny
              </Button>
              {/* Allow once, with "Allow saving from now on" in the menu beside it. */}
              <span className="flex">
                <span data-click="team-allow">
                  <Button size="md" variant="primary" className="h-[38px] rounded-r-none">
                    Allow once
                  </Button>
                </span>
                <Button
                  size="md"
                  variant="primary"
                  aria-label="More ways to allow"
                  className="h-[38px] w-8 rounded-l-none border-l border-ground/25 px-0"
                >
                  <ChevronDown size={14} strokeWidth={1.8} aria-hidden />
                </Button>
              </span>
            </span>
          )}
          <Allowed
            style={{
              gridArea: '1 / 1',
              opacity: allowed,
              transform: `scale(${mix(0.94, 1, allowed)})`,
            }}
          />
        </span>
      </div>
      {rows && (
        <div className="border-t border-line px-4 pb-2.5 pt-1 font-mono text-small">
          <div
            className="grid h-[38px] items-center gap-2 pr-3 font-medium"
            style={{ gridTemplateColumns: `20px repeat(${rows.columns.length}, minmax(0, 1fr))` }}
          >
            <span />
            {rows.columns.map((column) => (
              <span key={column} className="truncate">
                {column}
              </span>
            ))}
          </div>
          <div
            className="grid h-9 items-center gap-2 bg-student-soft pr-3"
            style={{ gridTemplateColumns: `20px repeat(${rows.columns.length}, minmax(0, 1fr))` }}
          >
            <span className="pl-2 text-student">+</span>
            {rows.row.map((cell) => (
              <span key={cell} className="truncate">
                {cell}
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

/** The team's chat as Inventory desk works on the request, from the scene's time. */
export function TeamChatPage({ t }: { t: number }) {
  const steps = [AT.read, AT.ask, AT.search, AT.reservations, AT.adding].filter(
    (at) => t >= at,
  ).length;
  const allowed = ui(t, AT.allow + 0.05, 0.25);
  return (
    <div className="relative h-full">
      <header className="flex h-14 items-center justify-between gap-3 pl-7 pr-10">
        <span className="font-medium">{TEAM.chat}</span>
        <span className="flex items-center gap-3 text-small">
          <span className="flex items-center gap-2">
            <span className="flex gap-0.5">
              <AgentAvatar name={TEAM.lead} className="size-5" />
              <AgentAvatar name={TEAM.teammate} className="size-5" />
            </span>
            <span className="font-medium">{TEAM.org}</span>
            <ChevronDown size={13} strokeWidth={1.8} aria-hidden />
          </span>
          <Info size={15} strokeWidth={1.8} aria-hidden />
        </span>
      </header>
      <div
        className="absolute inset-x-0 flex flex-col justify-end overflow-hidden"
        style={{ top: CHAT.top, height: CHAT.bottom - CHAT.top }}
      >
        <div className="mx-auto flex w-[720px] shrink-0 flex-col pb-1 pt-6">
          <Grow t={t} at={AT.request} dur={0.5}>
            <div className="ml-auto w-fit max-w-[540px] rounded-card bg-raised px-5 py-3.5 text-body">
              {TEAM.request}
            </div>
          </Grow>
          <Grow t={t} at={AT.read} className="pt-5">
            <div className="flex flex-col gap-2">
              <span className="flex h-7 items-center gap-2 text-ui">
                {steps} {steps === 1 ? 'step' : 'steps'} so far
                <ChevronRight size={13} strokeWidth={1.8} aria-hidden className="rotate-90" />
                {/* The version that answered; no certificate covers an agent asking another. */}
                <span
                  className="ml-1 flex items-center gap-0.5"
                  style={{ opacity: ui(t, AT.version, 0.3) }}
                >
                  <VersionTag version={1} />
                  <InfoTip about="the version">Not certified as a team</InfoTip>
                </span>
              </span>
              <div className={STEP_LIST}>
                <div className="py-[5px]">
                  <Step action="Read" target={<Mono>data/policy.md</Mono>} />
                </div>
                <Grow t={t} at={AT.ask} dur={0.3}>
                  <Consultation t={t} />
                </Grow>
                <StepItem t={t} at={AT.search}>
                  <Step
                    action="Searched"
                    target={
                      <span>
                        <Mono>data/inventory.csv</Mono> for <Mono>/FWC-13399|FWC-13444/</Mono>
                      </span>
                    }
                    meta="6 matches"
                  />
                </StepItem>
                <StepItem t={t} at={AT.reservations}>
                  <Step action="Read" target={<Mono>data/reservations.csv</Mono>} meta="162 rows" />
                </StepItem>
                <StepItem t={t} at={AT.adding}>
                  {/* The write waits for its answer; once allowed, the step is done. */}
                  {allowed > 0 ? (
                    <Step
                      action="Added to"
                      target={<Mono>data/reservations.csv</Mono>}
                      meta="1 row"
                    />
                  ) : (
                    <span className="flex items-center gap-2">
                      <Step action="Adding to" target={<Mono>data/reservations.csv</Mono>} />
                      <Spinner size={13} />
                    </span>
                  )}
                </StepItem>
              </div>
            </div>
          </Grow>
          <Grow t={t} at={AT.reply} className="pt-5">
            <p className="m-0 text-body">{TEAM.reply}</p>
          </Grow>
          {TEAM.allocations.map((allocation, index) => (
            <Grow key={allocation.compound} t={t} at={AT.bullets[index]!} className="pt-2.5">
              <p className="m-0 flex gap-3 pl-2 text-body">
                <span aria-hidden className="mt-[10px] size-[5px] shrink-0 rounded-full bg-fg" />
                <span className="min-w-0">
                  <span className="font-semibold">{allocation.compound}</span>: {allocation.text}
                </span>
              </p>
            </Grow>
          ))}
          <Grow t={t} at={AT.assay} className="pt-5">
            <ApprovalCard
              agent={TEAM.teammate}
              file="data/retests.csv"
              count="2 new rows"
              allowed={1}
            />
          </Grow>
          <Grow t={t} at={AT.hold} className="pt-5" dur={0.5}>
            <ApprovalCard
              agent={TEAM.lead}
              file="data/reservations.csv"
              count="1 new row"
              allowed={allowed}
              rows={TEAM.hold}
            />
          </Grow>
        </div>
        <div className="flex-1" />
      </div>
      <div className="absolute inset-x-0 bottom-0 px-8 pb-5 pt-2">
        <div className="mx-auto flex w-[720px] flex-col gap-3 rounded-card bg-card px-5 py-4 shadow-edge">
          <span className="text-body text-fg-dim">Ask {TEAM.lead}</span>
          <span className="flex justify-end">
            <span className="grid size-8 place-items-center rounded-full bg-fg text-ground">
              <Square size={11} strokeWidth={0} fill="currentColor" aria-hidden />
            </span>
          </span>
        </div>
      </div>
    </div>
  );
}

/**
 * Where the pointer clicks, in window pixels: Fields, the team's chat in the sidebar, then
 * Inventory desk's Allow once, read off the page at the click (the chat is anchored to its last
 * line, so it holds).
 */
const FIELDS_ROW: readonly [number, number] = [92, ROW.place(1) + 20];
const CHAT_ROW: readonly [number, number] = [120, TEAM_ROW.chat + TEAM_ROW.chatHeight / 2];
const ALLOW: readonly [number, number] = [956, 348];

function TeamPointer({ t }: { t: number }) {
  const clicks = [
    { at: AT.fields, to: FIELDS_ROW, lead: 0.6 },
    { at: AT.click, to: CHAT_ROW, lead: 0.7 },
    { at: AT.allow, to: ALLOW, lead: 0.85 },
  ];
  const click = clicks.find((item) => t < item.at + 0.7 && t >= item.at - item.lead - 0.05);
  if (!click) return null;
  const [x1, y1] = click.to;
  const travel = span(t, click.at - click.lead + 0.05, click.lead - 0.12);
  const x = mix(x1 + 170, x1, outQuart(travel));
  const y = mix(y1 + 130, y1, inOutCubic(travel));
  const press = Math.sin(Math.PI * span(t, click.at - 0.04, 0.18));
  const shown = Math.min(
    outQuart(span(t, click.at - click.lead, 0.2)),
    1 - outQuart(span(t, click.at + 0.35, 0.3)),
  );
  return <Pointer x={x} y={y} shown={shown} press={press} />;
}

/**
 * The window over the scene: Offline's chat gives way to Fields, where the light moves from the
 * academy to the screening labs; the sidebar scrolls down to the team and its chat is chosen; at
 * the end the team's chat goes and the first screen comes in, with the sidebar sliding away, as
 * the walkthrough turns to it.
 */
function TeamWindow({ t }: { t: number }) {
  const scroll = inOutCubic(span(t, BRIDGE, 0.65));
  const chosen = t >= AT.click - 0.1;
  const swap = outQuart(span(t, AT.click + 0.12, 0.45));
  // Each page leaves before the next arrives, so no two are ever seen through each other.
  const offline = 1 - outQuart(span(t, AT.fields, 0.18));
  const arrive = outQuart(span(t, AT.fields + 0.08, 0.45));
  const fields = Math.min(arrive, 1 - outQuart(span(t, AT.click, 0.2)));
  const toFields = ui(t, AT.fields - 0.12, 0.32);
  const leave = outQuart(span(t, AT.leave, 0.3));
  const welcome = outQuart(span(t, AT.leave, 0.5));
  const sidebar = 1 - outQuart(span(t, AT.leave, 0.55));
  const chatRow = ROW.agent(CHAT_AGENT) + ROW.height;
  return (
    <div
      className="absolute overflow-hidden rounded-[14px] bg-ground"
      style={{
        width: WINDOW.width,
        height: WINDOW.height,
        boxShadow: 'inset 0 0 0 1px rgb(255 255 255 / 0.1), 0 30px 80px rgb(0 0 0 / 0.5)',
      }}
    >
      {offline > 0 && (
        <div
          className="absolute overflow-hidden"
          style={{ left: SIDEBAR, top: 0, right: 0, bottom: 0, opacity: offline }}
        >
          <WorkspacePage
            lt={TEAM_FROM - pageAt('workspace')}
            allowAt={MOMENT.allow - pageAt('workspace')}
          />
        </div>
      )}
      {fields > 0 && (
        <div
          className="absolute overflow-hidden"
          style={{
            left: SIDEBAR,
            top: 0,
            right: 0,
            bottom: 0,
            opacity: fields,
            transform: `translateY(${(1 - arrive) * 10}px)`,
          }}
        >
          <Fields
            lt={t - AT.fields}
            selected={Math.min(ui(t, AT.academy, 0.25), 1 - ui(t, AT.lab, 0.35))}
            lab={ui(t, AT.lab, 0.35)}
          />
        </div>
      )}
      {swap > 0 && leave < 1 && (
        <div
          className="absolute overflow-hidden"
          style={{
            left: SIDEBAR * sidebar,
            top: 0,
            right: 0,
            bottom: 0,
            opacity: swap * (1 - leave),
            transform: `translateY(${(1 - swap) * 10}px)`,
          }}
        >
          <TeamChatPage t={t} />
        </div>
      )}
      {welcome > 0 && (
        <div
          className="absolute inset-0 overflow-hidden"
          style={{ opacity: welcome, transform: `translateY(${(1 - welcome) * 10}px)` }}
        >
          <WelcomePage lt={t - AT.leave} chooseAt={MOMENT.choose - pageAt('welcome')} />
        </div>
      )}
      <Sidebar
        state={{
          fillTop: chosen ? TEAM_ROW.chat : mix(chatRow, ROW.place(1), toFields),
          fillHeight: chosen ? TEAM_ROW.chatHeight : mix(TEAM_ROW.chatHeight, ROW.height, toFields),
          fill: chosen ? ui(t, AT.click - 0.05, 0.25) : 1,
          chat: 1,
          agents: 1,
          rest: 1,
          team: scroll,
        }}
        style={{ transform: `translateX(${(sidebar - 1) * SIDEBAR}px)`, opacity: sidebar }}
      />
      <TeamPointer t={t} />
    </div>
  );
}

/**
 * The push onto the team's chat: the frame's left edge just right of the sidebar, so the header
 * has room on both sides, and its top the window's.
 */
const ZOOM: Framing = { cx: 250 + 960 / 2.15, cy: 4 + 540 / 2.15, s: 2.15 };

/** A little closer on the whole window while Fields shows, so the sidebar stays in frame. */
const FIELDS_VIEW: Framing = { cx: WINDOW.width / 2, cy: WINDOW.height / 2, s: 1.62 };

export function TeamScene({ t, measured }: { t: number; measured: Measured }) {
  const welcome = pageAt('welcome');
  const back = camera(measured, welcome + clamp(t - AT.leave, 0, TEAM_BACK - welcome));
  const look = inOutCubic(span(t, AT.fields + 0.1, 1.1));
  const push = inOutCubic(span(t, BRIDGE + 0.85, 1.1));
  const pull = inOutCubic(span(t, BRIDGE + 9.0, 1.1));
  const drift = 1 + 0.012 * span(t, BRIDGE + 1.95, 9.0 - 1.95);
  const toward = (a: Framing, b: Framing, p: number): Framing => ({
    cx: mix(a.cx, b.cx, p),
    cy: mix(a.cy, b.cy, p),
    s: Math.exp(mix(Math.log(a.s), Math.log(b.s), p)),
  });
  const from = toward(camera(measured, TEAM_FROM), FIELDS_VIEW, look);
  const held = toward(from, { ...ZOOM, s: ZOOM.s * drift }, push);
  const view = toward(held, back, pull);
  return (
    <World view={view}>
      <TeamWindow t={t} />
    </World>
  );
}
