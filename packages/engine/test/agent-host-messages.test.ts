import { describeCall, describeResult, type WorkspaceMessage } from '@architect/shared';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { chatHistory } from '../src/agent-host/history';
import { agentMessage, chatTitle, userMessage } from '../src/agent-host/messages';
import { LiveReply } from '../src/agent-host/reply';

const AT = '2026-11-05T09:00:00.000Z';

describe('step descriptions', () => {
  it('say what a call acts on', () => {
    expect(describeCall('read', { path: 'data/invoices.csv', offset: 40 })).toBe(
      'data/invoices.csv',
    );
    expect(describeCall('ls', {})).toBe('your folders');
    expect(describeCall('ls', { path: 'data' })).toBe('data');
    expect(describeCall('glob', { pattern: 'data/*.csv' })).toBe('data/*.csv');
    expect(describeCall('grep', { pattern: 'INV-2', path: 'data/invoices.csv' })).toBe(
      'data/invoices.csv for /INV-2/',
    );
    expect(describeCall('grep', { pattern: 'refund' })).toBe('/refund/');
    expect(
      describeCall('edit', { path: 'data/invoices.csv', old_string: 'a', new_string: 'b' }),
    ).toBe('data/invoices.csv');
    expect(
      describeCall('run', {
        code: 'const rows = csv.parse(files.read(\'data/invoices.csv\'));\nconst more = files.read("data/customers.csv");',
      }),
    ).toBe('data/invoices.csv, data/customers.csv');
    expect(describeCall('run', { code: '\n  12 * 1.0825\nprint(1)' })).toBe('12 * 1.0825');
    expect(describeCall('invoice_total', { job_id: 'W-2482', after_hours: true })).toBe(
      'job_id: W-2482, after_hours: true',
    );
    expect(describeCall('run', { code: '1 + '.repeat(40) })).toHaveLength(80);
  });

  it('sum up a result in a few words', () => {
    expect(describeResult('read', '1\ta\n2\tb\n3\tc')).toBe('3 lines');
    expect(
      describeResult(
        'read',
        '1\ta\n2\tb\n[Lines 1-2 of 596. 594 more lines: read on with offset 3.]',
      ),
    ).toBe('lines 1-2 of 596');
    expect(describeResult('read', 'data/empty.csv is empty.')).toBe('empty');
    expect(
      describeResult('ls', 'data/     3 files, 1 writable\nskills/   1 skill, read-only'),
    ).toBe('2 entries');
    expect(describeResult('glob', 'data/a.csv\ndata/b.csv')).toBe('2 files');
    expect(describeResult('glob', 'No files match *.xlsx.')).toBe('none');
    expect(describeResult('grep', 'data/a.csv:2: x')).toBe('1 match');
    expect(
      describeResult(
        'grep',
        'data/a.csv:2: x\n[132 matching lines; showing 1. Narrow the pattern.]',
      ),
    ).toBe('132 matches');
    expect(describeResult('grep', 'No lines match in data.')).toBe('no matches');
    expect(describeResult('run', '=> 4925')).toBe('=> 4925');
    expect(describeResult('run', 'Two unpaid\n=> 5540')).toBe('Two unpaid');
    const rows = { columns: ['id'], added: [['A'], ['B']], removed: [], changed: [] };
    const change = { path: 'data/x.csv', op: 'append' as const, patch: '', rows, applied: true };
    expect(describeResult('append', 'Added 2 rows to data/x.csv.', change)).toBe('2 rows added');
    expect(describeResult('append', 'The user declined', { ...change, applied: false })).toBe(
      'declined',
    );
    expect(
      describeResult('edit', 'Changed', {
        ...change,
        op: 'edit',
        rows: { ...rows, added: [], changed: [{ before: ['A'], after: ['C'] }] },
      }),
    ).toBe('1 row changed');
    expect(
      describeResult('write', 'Created', {
        path: 'output/a.md',
        op: 'write',
        patch: '--- /dev/null\n+++ b/output/a.md\n@@ -0,0 +1,2 @@\n+A\n+B\n',
        applied: true,
      }),
    ).toBe('created, 2 lines');
    expect(
      describeResult('edit', 'Changed', {
        path: 'output/a.md',
        op: 'edit',
        patch: '--- a/output/a.md\n+++ b/output/a.md\n@@ -1,2 +1,2 @@\n-A\n+C\n B\n',
        applied: true,
      }),
    ).toBe('1 line added, 1 removed');
    expect(describeResult('invoice_total', { total_cents: 128450 })).toBe('total_cents: 128450');
    expect(describeResult('busy_slots', [1, 2, 3])).toBe('3 items');
    expect(describeResult('lookup', { a: 1, b: 2, c: 3, d: 4 })).toBe('4 fields');
  });
});

describe('chat history', () => {
  const user = (text: string) => userMessage('cht_1', text, AT);
  const agent = (text: string, extra: Partial<WorkspaceMessage> = {}): WorkspaceMessage => ({
    ...agentMessage('cht_1', 1, AT),
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
    const reply = new LiveReply(agentMessage('cht_1', 1, AT), (message, save) =>
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

    reply.addStep({ kind: 'tool', name: 'ls', detail: 'your folders', status: 'running' });
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
      { kind: 'tool', name: 'append', detail: 'data/invoices.csv', status: 'running' },
      'call_1',
    );
    reply.addBlock({
      kind: 'approval',
      changeId: 'chg_1',
      op: 'append',
      file: 'data/invoices.csv',
      summary: 'Add 1 row to data/invoices.csv',
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
