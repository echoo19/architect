import type { WorkspaceMessage } from '@architect/shared';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { chatHistory } from '../src/agent-host/history';
import { agentMessage, chatTitle, userMessage } from '../src/agent-host/messages';
import { LiveReply } from '../src/agent-host/reply';
import { describeCall, describeResult } from '../src/agent-host/steps';

const AT = '2026-11-05T09:00:00.000Z';

describe('step descriptions', () => {
  it('say what a call acts on', () => {
    expect(describeCall('list_files', {})).toBe('the data files');
    expect(
      describeCall('read_table', {
        file: 'invoices.csv',
        where: [
          { column: 'paid', op: '!=', value: 'true' },
          { column: 'customer_id', op: 'in', value: ['C-1', 'C-2'] },
        ],
      }),
    ).toBe('invoices.csv, paid != true, customer_id in [C-1, C-2]');
    expect(
      describeCall('update_rows', {
        file: 'invoices.csv',
        where: { column: 'invoice_id', op: '=', value: 'INV-2' },
        set: { paid: true },
      }),
    ).toBe('invoices.csv, invoice_id = INV-2');
    expect(describeCall('append_rows', { file: 'invoices.csv', rows: [] })).toBe('invoices.csv');
    expect(describeCall('calculate', { expression: 'round(4550 * 1.0825)' })).toBe(
      'round(4550 * 1.0825)',
    );
    expect(describeCall('invoice_total', { job_id: 'W-2482', after_hours: true })).toBe(
      'job_id: W-2482, after_hours: true',
    );
    expect(describeCall('calculate', { expression: '1 + '.repeat(40) })).toHaveLength(80);
  });

  it('sum up a result in a few words', () => {
    expect(describeResult('read_table', { file: 'jobs.csv', total: 1284, rows: [] })).toBe(
      '1,284 rows',
    );
    expect(describeResult('read_table', { total: 1, rows: [] })).toBe('1 row');
    expect(describeResult('read_table', '{"file":"jobs.csv","rows":[[… [cut]')).toBe('cut to fit');
    expect(describeResult('list_files', { files: [{}, {}, {}] })).toBe('3 files');
    expect(describeResult('read_text', { file: 'policy.md', text: 'a\nb' })).toBe('2 lines');
    expect(describeResult('read_text', { text: 'a', next_offset: 1 })).toBe('1 line, more to read');
    expect(describeResult('calculate', { result: '4925.38' })).toBe('= 4925.38');
    expect(describeResult('append_rows', { file: 'invoices.csv', appended: 2 })).toBe(
      '2 rows added',
    );
    expect(describeResult('append_rows', { declined: true, message: 'No.' })).toBe('declined');
    expect(describeResult('update_rows', { matched: 3, changed: 1 })).toBe('1 row changed');
    expect(describeResult('update_rows', { matched: 3, changed: 0 })).toBe('no change');
    expect(describeResult('load_skill', { slug: 'price-a-job' })).toBe('loaded');
    expect(describeResult('invoice_total', { total_cents: 128450 })).toBe('total_cents: 128450');
    expect(describeResult('busy_slots', [1, 2, 3])).toBe('3 items');
    expect(describeResult('lookup', { a: 1, b: 2, c: 3, d: 4 })).toBe('4 fields');
  });
});

describe('chat history', () => {
  const user = (text: string) => userMessage('cht_1', text, AT);
  const agent = (text: string, extra: Partial<WorkspaceMessage> = {}): WorkspaceMessage => ({
    ...agentMessage('cht_1', AT),
    text,
    status: 'done',
    ...extra,
  });

  it('keeps the end of the conversation, starting with a user message', () => {
    const messages = Array.from({ length: 10 }, (_, index) => [
      user(`Question ${index}`),
      agent(`Answer ${index}`),
    ]).flat();
    const history = chatHistory(messages, 16_384);
    expect(history).toHaveLength(12);
    expect(history[0]).toEqual({ role: 'user', content: 'Question 4' });
    expect(history.at(-1)).toEqual({ role: 'assistant', content: 'Answer 9' });
  });

  it('stays within a quarter of the context window', () => {
    // 1,500 tokens each against a budget of 2,048: the long answer fits, its question doesn't.
    const long = 'x'.repeat(6000);
    const history = chatHistory([user(long), agent(long), user('Short'), agent('Reply')], 8192);
    expect(history).toEqual([
      { role: 'user', content: 'Short' },
      { role: 'assistant', content: 'Reply' },
    ]);
  });

  it('counts a refusal by its reason and leaves out replies with nothing to show', () => {
    const refused = agent('', {
      blocks: [{ kind: 'refusal', taskType: 'schedule', reason: 'It books the wrong slots.' }],
    });
    const stopped = agent('', { status: 'stopped' });
    expect(chatHistory([user('Book a visit'), refused, user('Hi'), stopped], 16_384)).toEqual([
      { role: 'user', content: 'Book a visit' },
      {
        role: 'assistant',
        content: "I can't help with schedule requests. It books the wrong slots.",
      },
      { role: 'user', content: 'Hi' },
    ]);
  });
});

describe('chat titles', () => {
  it('are the first message on one line, at most 40 characters', () => {
    expect(chatTitle('  Which invoices\nare unpaid?  ')).toBe('Which invoices are unpaid?');
    const title = chatTitle('Please list every customer in Ferncliff whose invoices are overdue');
    expect(title).toBe('Please list every customer in Ferncliff…');
    expect(Array.from(title)).toHaveLength(40);
    expect(Array.from(chatTitle('🧾'.repeat(50)))).toHaveLength(40);
  });
});

describe('a live reply', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  function live() {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'performance'] });
    const published: { message: WorkspaceMessage; save: boolean }[] = [];
    const reply = new LiveReply(agentMessage('cht_1', AT), (message, save) =>
      published.push({ message, save }),
    );
    return { reply, published };
  }

  it('publishes the first change at once and later ones together, every 33 ms', () => {
    const { reply, published } = live();
    reply.appendText('\n\nTwo');
    reply.appendText(' invoices');
    reply.appendText(' are unpaid.');
    expect(published.map(({ message }) => message.text)).toEqual(['Two']);
    vi.advanceTimersByTime(33);
    expect(published.map(({ message }) => message.text)).toEqual([
      'Two',
      'Two invoices are unpaid.',
    ]);
    expect(published.every(({ save }) => !save)).toBe(true);

    reply.addStep({
      kind: 'tool',
      name: 'list_files',
      detail: 'the data files',
      status: 'running',
    });
    vi.advanceTimersByTime(33);
    expect(published.at(-1)).toMatchObject({ save: true, message: { steps: [{ id: 'step-1' }] } });
  });

  it('keeps text from each model turn as its own paragraph', () => {
    const { reply } = live();
    reply.appendText('Let me look.  ');
    reply.endTurn();
    reply.appendText('\n');
    reply.appendText('Found it.');
    expect(reply.finish({ status: 'done' }).text).toBe('Let me look.\n\nFound it.');
  });

  it('finishes once: settled, saved and published at once, with later changes ignored', () => {
    const { reply, published } = live();
    reply.addStep(
      { kind: 'tool', name: 'append_rows', detail: 'invoices.csv', status: 'running' },
      'call_1',
    );
    reply.addBlock({
      kind: 'approval',
      changeId: 'chg_1',
      file: 'invoices.csv',
      summary: 'Append 1 row to invoices.csv',
      diff: { columns: ['invoice_id'], added: [['INV-4']], removed: [], changed: [] },
      status: 'pending',
    });
    vi.advanceTimersByTime(250);
    const final = reply.finish({ status: 'stopped' });
    reply.appendText('late');
    vi.advanceTimersByTime(100);

    expect(published.at(-1)).toEqual({ message: final, save: true });
    expect(final).toMatchObject({
      status: 'stopped',
      text: '',
      workedMs: 250,
      steps: [{ status: 'done', meta: 'stopped' }],
      blocks: [{ status: 'denied' }],
    });
  });
});
