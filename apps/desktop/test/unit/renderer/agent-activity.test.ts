import { describe, expect, it } from 'vitest';
import type { AgentBlock, WorkspaceChat, WorkspaceMessage } from '@architect/shared';
import {
  activityEnd,
  activitySpan,
  answerTimes,
  dayKey,
  oversight,
  percentile,
  requestsByDay,
  sessionRows,
  tokensPerSecond,
  toolUse,
} from '../../../src/renderer/src/agent/activity';

let next = 0;
function message(patch: Partial<WorkspaceMessage> = {}): WorkspaceMessage {
  next += 1;
  return {
    id: `msg_${next}`,
    chatId: 'cht_1',
    role: 'agent',
    createdAt: new Date(2026, 9, 28, 10).toISOString(),
    text: '',
    steps: [],
    blocks: [],
    status: 'done',
    ...patch,
  };
}

const ask = (createdAt: Date) => message({ role: 'user', createdAt: createdAt.toISOString() });

function chat(id: string, patch: Partial<WorkspaceChat> = {}): WorkspaceChat {
  return {
    id,
    graduateId: 'grd_1',
    title: id,
    createdAt: '2026-10-28T09:00:00.000Z',
    updatedAt: '2026-10-28T09:00:00.000Z',
    running: false,
    waiting: false,
    ...patch,
  };
}

const approval = (status: Extract<AgentBlock, { kind: 'approval' }>['status']): AgentBlock => ({
  kind: 'approval',
  changeId: `chg_${status}`,
  op: 'append',
  file: 'data/x.csv',
  summary: 'Add 1 row to data/x.csv',
  status,
});

describe('percentile', () => {
  it('takes the nearest rank', () => {
    const values = [10, 20, 30, 40, 50, 60, 70, 80, 90, 100];
    expect(percentile(values, 0.5)).toBe(50);
    expect(percentile(values, 0.95)).toBe(100);
    expect(percentile([7, 3, 5], 0.5)).toBe(5);
    expect(percentile([4], 0.95)).toBe(4);
  });

  it('has none for no values', () => {
    expect(percentile([], 0.5)).toBeNull();
  });
});

describe('requestsByDay', () => {
  it("counts each day's requests and failed replies, the empty days at zero", () => {
    const end = new Date(2026, 10, 1, 15);
    const days = requestsByDay(
      [
        ask(new Date(2026, 10, 1, 9)),
        ask(new Date(2026, 10, 1, 14)),
        message({ status: 'error', createdAt: new Date(2026, 10, 1, 14).toISOString() }),
        ask(new Date(2026, 9, 30, 23, 30)),
        // Before the window: left out.
        ask(new Date(2026, 9, 20, 12)),
      ],
      end,
      3,
    );
    expect(days).toEqual([
      { day: '2026-10-30', requests: 1, errors: 0 },
      { day: '2026-10-31', requests: 0, errors: 0 },
      { day: '2026-11-01', requests: 2, errors: 1 },
    ]);
  });

  it('steps one day at a time across a change of the clocks', () => {
    const days = requestsByDay([], new Date(2026, 10, 3, 1), 7);
    expect(new Set(days.map((day) => day.day)).size).toBe(7);
    expect(days.at(-1)?.day).toBe(dayKey(new Date(2026, 10, 3, 1)));
  });
});

describe('answerTimes', () => {
  it('times only finished replies', () => {
    const times = answerTimes([
      ask(new Date()),
      message({ workedMs: 4_000 }),
      message({ workedMs: 9_000 }),
      message({ workedMs: 2_000 }),
      message({ workedMs: 60_000, status: 'error' }),
      message({ status: 'streaming' }),
      message({}),
    ]);
    expect(times).toEqual({ median: 4_000, p95: 9_000, count: 3 });
  });
});

describe('tokensPerSecond', () => {
  it("divides the runtime's counted tokens by the model time", () => {
    expect(
      tokensPerSecond([
        message({ generated: { tokens: 300, ms: 10_000 } }),
        message({ generated: { tokens: 100, ms: 0 } }),
        message({}),
      ]),
    ).toBe(40);
  });

  it('has none when no reply was counted', () => {
    expect(tokensPerSecond([message({})])).toBeNull();
  });
});

describe('toolUse', () => {
  it('counts tool calls and teammates asked, the most used first', () => {
    const tool = (name: string) => ({
      id: name,
      kind: 'tool' as const,
      name,
      detail: '',
      status: 'done' as const,
    });
    const used = toolUse([
      message({ steps: [tool('read'), tool('grep'), tool('read')] }),
      message({
        steps: [
          tool('append'),
          { id: 's', kind: 'skill', name: 'price', detail: 'price', status: 'done' },
          {
            id: 'c',
            kind: 'consult',
            name: 'Assay desk',
            detail: 'ask',
            status: 'done',
            view: { kind: 'consult', graduateId: 'grd_2', version: 1, steps: [] },
          },
        ],
      }),
    ]);
    expect(used).toEqual([
      { name: 'read', count: 2 },
      { name: 'append', count: 1 },
      { name: 'Assay desk', count: 1 },
      { name: 'grep', count: 1 },
    ]);
  });
});

describe('oversight', () => {
  it('counts refusals, each write by its answer, and errors', () => {
    const counts = oversight([
      ask(new Date()),
      message({
        blocks: [approval('approved'), approval('approved'), approval('denied')],
      }),
      message({ blocks: [approval('pending'), approval('failed')] }),
      message({ blocks: [{ kind: 'refusal', taskType: 'refunds', reason: 'No refunds.' }] }),
      message({ status: 'error', error: 'The model stopped.' }),
    ]);
    expect(counts).toEqual({
      replies: 4,
      refusals: 1,
      approved: 2,
      denied: 1,
      waiting: 1,
      failed: 1,
      errors: 1,
    });
  });

  it('counts a write waiting on a reply that is still streaming, and not the reply', () => {
    const counts = oversight([
      ask(new Date()),
      message({ status: 'streaming', blocks: [approval('pending')] }),
    ]);
    expect(counts.waiting).toBe(1);
    expect(counts.replies).toBe(0);
  });
});

describe('sessionRows', () => {
  it('lists what waits first, then the newest, each with how it stands and what it came to', () => {
    const rows = sessionRows([
      {
        chat: chat('old', { updatedAt: '2026-10-28T09:00:00.000Z' }),
        messages: [
          ask(new Date()),
          message({ text: '**Three customers**, $2,915 in total.\nThe oldest is Okafor.' }),
        ],
      },
      {
        chat: chat('waits', { updatedAt: '2026-10-26T09:00:00.000Z', waiting: true }),
        messages: [ask(new Date()), message({ status: 'streaming', text: 'Both are ready.' })],
      },
      {
        chat: chat('refused', { updatedAt: '2026-10-29T09:00:00.000Z' }),
        messages: [
          ask(new Date()),
          message({ blocks: [{ kind: 'refusal', taskType: 'refunds', reason: 'No refunds.' }] }),
        ],
      },
      {
        chat: chat('failed', { updatedAt: '2026-10-29T08:00:00.000Z' }),
        messages: [ask(new Date()), message({ status: 'error', error: 'The GPU stayed busy.' })],
      },
      { chat: chat('new', { updatedAt: '2026-10-27T09:00:00.000Z' }), messages: [] },
    ]);
    expect(rows.map((row) => [row.chat.id, row.state, row.requests, row.outcome])).toEqual([
      ['waits', 'waiting', 1, 'Both are ready.'],
      ['refused', 'answered', 1, 'No refunds.'],
      ['failed', 'failed', 1, 'The GPU stayed busy.'],
      ['old', 'answered', 1, 'Three customers, $2,915 in total.'],
      ['new', 'new', 0, null],
    ]);
  });
});

describe('activityEnd', () => {
  it('ends today, or on a later record', () => {
    const now = new Date('2026-11-01T12:00:00.000Z');
    expect(activityEnd([message({ createdAt: '2026-10-30T12:00:00.000Z' })], now)).toBe(now);
    expect(activityEnd([message({ createdAt: '2026-11-24T12:00:00.000Z' })], now)).toEqual(
      new Date('2026-11-24T12:00:00.000Z'),
    );
  });
});

describe('activitySpan', () => {
  const end = new Date(2026, 10, 1, 15);
  const at = (month: number, day: number, hour = 17) =>
    new Date(2026, month, day, hour).toISOString();

  it('starts on the day the version was accepted', () => {
    expect(activitySpan(at(9, 24), end)).toEqual({ days: 9, fromAcceptance: true });
  });

  it('covers at least a week', () => {
    expect(activitySpan(at(9, 30), end)).toEqual({ days: 7, fromAcceptance: false });
    // Accepted after the clock's today, as a recording dated later can be.
    expect(activitySpan(at(10, 24), end)).toEqual({ days: 7, fromAcceptance: false });
  });

  it('covers at most two weeks', () => {
    expect(activitySpan(at(9, 19), end)).toEqual({ days: 14, fromAcceptance: true });
    expect(activitySpan(at(8, 1), end)).toEqual({ days: 14, fromAcceptance: false });
  });

  it('counts the week exactly when it was accepted a week ago', () => {
    expect(activitySpan(at(9, 26, 23), end)).toEqual({ days: 7, fromAcceptance: true });
  });
});
