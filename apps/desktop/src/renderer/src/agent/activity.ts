import type { WorkspaceChat, WorkspaceMessage } from '@architect/shared';

/*
 * What an agent's home says of its work, worked out from the chats and messages the agent host
 * keeps: each number counts records, never estimates them.
 */

/** A chat with its messages, oldest first. */
export interface Session {
  chat: WorkspaceChat;
  messages: readonly WorkspaceMessage[];
}

const DAY_MS = 24 * 60 * 60 * 1000;

/** A day on this computer's calendar, as `YYYY-MM-DD`. */
export function dayKey(time: Date | string): string {
  const date = typeof time === 'string' ? new Date(time) : time;
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export interface DayCount {
  /** `YYYY-MM-DD`, on this computer's calendar. */
  day: string;
  /** Requests the person sent that day. */
  requests: number;
  /** Replies that day that stopped on an error. */
  errors: number;
}

/**
 * Requests and failed replies on each of the `days` days ending on `end`'s day, oldest first,
 * with the days that had none at zero.
 */
export function requestsByDay(
  messages: readonly WorkspaceMessage[],
  end: Date,
  days: number,
): DayCount[] {
  const counts = new Map<string, DayCount>();
  // Noon steps clear of a daylight-saving change, so each step lands on the next day.
  const last = new Date(end.getFullYear(), end.getMonth(), end.getDate(), 12);
  for (let back = days - 1; back >= 0; back -= 1) {
    const day = dayKey(new Date(last.getTime() - back * DAY_MS));
    counts.set(day, { day, requests: 0, errors: 0 });
  }
  for (const message of messages) {
    const entry = counts.get(dayKey(message.createdAt));
    if (!entry) continue;
    if (message.role === 'user') entry.requests += 1;
    else if (message.status === 'error') entry.errors += 1;
  }
  return [...counts.values()];
}

/** The nearest-rank percentile (`share` from 0 to 1) of the values; null when there are none. */
export function percentile(values: readonly number[], share: number): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const rank = Math.max(1, Math.ceil(share * sorted.length));
  return sorted[Math.min(rank, sorted.length) - 1] ?? null;
}

const settledReplies = (messages: readonly WorkspaceMessage[]) =>
  messages.filter((message) => message.role === 'agent' && message.status !== 'streaming');

export interface AnswerTimes {
  /** Milliseconds; null with no timed reply. */
  median: number | null;
  p95: number | null;
  /** The replies timed. */
  count: number;
}

/** How long finished replies took, from the request to the last word: their median and 95th percentile. */
export function answerTimes(messages: readonly WorkspaceMessage[]): AnswerTimes {
  const times = settledReplies(messages)
    .filter((message) => message.status === 'done')
    .flatMap((message) => (message.workedMs === undefined ? [] : [message.workedMs]));
  return { median: percentile(times, 0.5), p95: percentile(times, 0.95), count: times.length };
}

/**
 * Tokens written per second of model time, over every reply whose runtime counted them; null when
 * none did.
 */
export function tokensPerSecond(messages: readonly WorkspaceMessage[]): number | null {
  let tokens = 0;
  let ms = 0;
  for (const message of messages) {
    if (!message.generated) continue;
    tokens += message.generated.tokens;
    ms += message.generated.ms;
  }
  return ms > 0 ? (tokens * 1000) / ms : null;
}

export interface ToolCount {
  name: string;
  count: number;
}

/**
 * How often the replies called each tool, the most used first; a lead asking a teammate counts
 * under the teammate's name.
 */
export function toolUse(messages: readonly WorkspaceMessage[]): ToolCount[] {
  const counts = new Map<string, number>();
  for (const message of settledReplies(messages)) {
    for (const step of message.steps) {
      if (step.kind !== 'tool' && step.kind !== 'consult') continue;
      counts.set(step.name, (counts.get(step.name) ?? 0) + 1);
    }
  }
  return [...counts]
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
}

export interface Oversight {
  /** Settled replies. */
  replies: number;
  /** Requests the agent's job told it to leave to a person. */
  refusals: number;
  /** Writes the person allowed, declined, or hasn't answered yet. */
  approved: number;
  denied: number;
  waiting: number;
  /** Writes allowed that couldn't be saved. */
  failed: number;
  /** Replies that stopped on an error. */
  errors: number;
}

/**
 * What the person was asked to decide, and what went wrong. A reply paused on a write is still
 * streaming, so its writes count while the rest of it waits to settle.
 */
export function oversight(messages: readonly WorkspaceMessage[]): Oversight {
  const counts: Oversight = {
    replies: 0,
    refusals: 0,
    approved: 0,
    denied: 0,
    waiting: 0,
    failed: 0,
    errors: 0,
  };
  for (const message of messages) {
    if (message.role !== 'agent') continue;
    const settled = message.status !== 'streaming';
    if (settled) counts.replies += 1;
    if (message.status === 'error') counts.errors += 1;
    for (const block of message.blocks) {
      if (block.kind === 'refusal' && settled) counts.refusals += 1;
      if (block.kind !== 'approval') continue;
      if (block.status === 'approved') counts.approved += 1;
      else if (block.status === 'denied') counts.denied += 1;
      else if (block.status === 'failed') counts.failed += 1;
      else counts.waiting += 1;
    }
  }
  return counts;
}

export type SessionState = 'working' | 'waiting' | 'failed' | 'stopped' | 'answered' | 'new';

export interface SessionRow {
  chat: WorkspaceChat;
  state: SessionState;
  /** Requests sent in it. */
  requests: number;
  /** What its last reply did, in one line: its first sentence, or why it gave none. */
  outcome: string | null;
}

/** A reply's text as one plain line, without its markdown and its ANSWER line. */
function plainLine(text: string): string | null {
  const line = text
    .split('\n')
    .map((each) => each.trim())
    .find((each) => each !== '' && !each.startsWith('ANSWER:'));
  if (line === undefined) return null;
  return line
    .replace(/^[-*#>]+\s*/, '')
    .replace(/\*\*|__|`/g, '')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1');
}

function outcomeOf(reply: WorkspaceMessage | undefined): string | null {
  if (!reply) return null;
  if (reply.status === 'error') return reply.error ?? 'Stopped on an error.';
  const refusal = reply.blocks.find((block) => block.kind === 'refusal');
  if (refusal) return refusal.reason;
  return plainLine(reply.text);
}

function stateOf(session: Session): SessionState {
  const { chat, messages } = session;
  if (chat.waiting) return 'waiting';
  if (chat.running) return 'working';
  const last = messages.at(-1);
  if (!last) return 'new';
  if (last.status === 'error') return 'failed';
  if (last.status === 'stopped') return 'stopped';
  return 'answered';
}

/**
 * The sessions, each with how it stands and what it came to: those waiting for the person or
 * working first, then the most recently used.
 */
export function sessionRows(sessions: readonly Session[]): SessionRow[] {
  const live = (row: SessionRow) => (row.state === 'waiting' || row.state === 'working' ? 0 : 1);
  return sessions
    .map((session) => ({
      chat: session.chat,
      state: stateOf(session),
      requests: session.messages.filter((message) => message.role === 'user').length,
      outcome: outcomeOf(session.messages.findLast((message) => message.role === 'agent')),
    }))
    .sort((a, b) => live(a) - live(b) || b.chat.updatedAt.localeCompare(a.chat.updatedAt));
}

/**
 * The requests that opened the most recent sessions, newest first, each once: what people
 * actually ask the agent, in their words. A request of several lines is left out.
 */
export function recentAsks(sessions: readonly Session[], limit = 3): string[] {
  const asks = [...sessions]
    .sort((a, b) => b.chat.createdAt.localeCompare(a.chat.createdAt))
    .flatMap((session) => {
      const text = session.messages.find((message) => message.role === 'user')?.text.trim();
      return text && !text.includes('\n') ? [text] : [];
    });
  return [...new Set(asks)].slice(0, limit);
}

/**
 * The day the activity chart ends on: today, or the newest message's day when a record is dated
 * later than this computer's clock, so nothing recorded falls off its end.
 */
export function activityEnd(messages: readonly WorkspaceMessage[], now: Date): Date {
  const newest = messages.reduce(
    (latest, message) => Math.max(latest, Date.parse(message.createdAt)),
    Number.NEGATIVE_INFINITY,
  );
  return newest > now.getTime() ? new Date(newest) : now;
}

/** The fewest and the most days the activity chart covers. */
export const SPAN_DAYS = { least: 7, most: 14 } as const;

/**
 * How many days the activity chart covers, ending on `end`'s day: from the day the version was
 * accepted, but never fewer than 7 days or more than 14. `fromAcceptance` says whether the span
 * starts on that day, so the count can be named by it.
 */
export function activitySpan(
  acceptedAt: string,
  end: Date,
): { days: number; fromAcceptance: boolean } {
  const accepted = new Date(acceptedAt);
  const first = Date.UTC(accepted.getFullYear(), accepted.getMonth(), accepted.getDate());
  const last = Date.UTC(end.getFullYear(), end.getMonth(), end.getDate());
  const since = Math.round((last - first) / DAY_MS) + 1;
  const days = Math.min(SPAN_DAYS.most, Math.max(SPAN_DAYS.least, since));
  return { days, fromAcceptance: days === since };
}
