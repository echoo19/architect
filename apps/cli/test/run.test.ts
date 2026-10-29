import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { PassThrough } from 'node:stream';
import { RunResultSchema, type RunResult } from '@architect/shared';
import { afterEach, describe, expect, it } from 'vitest';
import { cleanUp, cli, keyboard, machineWith, tempDir, type Machine } from './support';

afterEach(cleanUp);

const ADD_INVOICE = {
  text: "I'll add the invoice.",
  toolCalls: [
    {
      name: 'append',
      arguments: { path: 'data/invoices.csv', text: 'INV-4,C-2,5000,2026-12-05,false' },
    },
  ],
};

/** What Ollama says when a model's tool call can't be parsed. */
const UNREADABLE_CALL = 'parse Glimmer call to run: missing ATEM function_calls wrapper';

const READ_THEN_ANSWER = [
  { toolCalls: [{ name: 'read', arguments: { path: 'data/invoices.csv' } }] },
  { text: 'There are 3 invoices on file.' },
];

async function requestFile(machine: Machine, request: unknown): Promise<string> {
  const dir = await tempDir('request');
  const file = join(dir, 'request.json');
  await writeFile(file, typeof request === 'string' ? request : JSON.stringify(request), 'utf8');
  return file;
}

function task(text: string, extra: Record<string, unknown> = {}) {
  return { format: 'architect.run-request/1', task: text, ...extra };
}

/** Runs one batch request and returns the exit code with the JSON result, checked. */
async function batch(
  machine: Machine,
  request: unknown,
  extra: string[] = [],
  options: { interruptWith?(press: () => void): void } = {},
): Promise<{ code: number; result: RunResult; stderr: string; guards: number }> {
  const input = await requestFile(machine, request);
  const output = join(await tempDir('out'), 'result.json');
  const run = await cli(
    ['run', 'service-desk', '--input', input, '--output', output, '--non-interactive', ...extra],
    { env: machine.env, ...options },
  );
  const text = await readFile(output, 'utf8');
  return {
    code: run.code,
    result: RunResultSchema.parse(JSON.parse(text)),
    stderr: run.stderr,
    guards: run.guards,
  };
}

const invoices = (machine: Machine) =>
  readFile(join(machine.graduate.workspaceDataDir, 'invoices.csv'), 'utf8');

describe('A11: a batch run reads a JSON request and always writes a JSON result', () => {
  it('answers with the version and setup that ran it, and exits 0', async () => {
    const machine = await machineWith(READ_THEN_ANSWER);
    const { code, result, guards } = await batch(machine, task('How many invoices are there?'));
    expect(code).toBe(0);
    expect(result).toMatchObject({
      format: 'architect.run-result/1',
      status: 'succeeded',
      exit_code: 0,
      answer: 'There are 3 invoices on file.',
      agent: {
        id: 'grd_desk',
        name: 'Service desk',
        version: 1,
        evaluation: 'ready',
        model: {
          label: 'Glimmer',
          runtime: 'ollama',
          name: 'muse-glimmer:30b',
          base_url: machine.model.url,
        },
      },
      steps: [{ tool: 'read', detail: 'data/invoices.csv', status: 'done', summary: '3 rows' }],
      artifacts: [],
      approval: null,
      error: null,
      architect: { request_format: 'architect.run-request/1' },
    });
    expect(result.agent?.digest).toMatch(/^[0-9a-f]{64}$/);
    // The network guard went up before the graduate loaded.
    expect(guards).toBe(1);
  });

  it('answers with the final text only when a turn was asked again on the way', async () => {
    const machine = await machineWith([
      { text: 'Let me add it up. ', streamError: UNREADABLE_CALL, delayMs: 45 },
      { text: 'There are 3 invoices on file.' },
    ]);
    const { code, result } = await batch(machine, task('How many invoices are there?'));
    expect(code).toBe(0);
    expect(result).toMatchObject({ status: 'succeeded', answer: 'There are 3 invoices on file.' });
    expect(machine.model.chats()).toHaveLength(2);
  });

  it('writes to stdout when no output file is named, and nothing else goes there', async () => {
    const machine = await machineWith(READ_THEN_ANSWER);
    const input = await requestFile(machine, task('How many invoices are there?'));
    const run = await cli(['run', 'service-desk', '--input', input], { env: machine.env });
    expect(run.code).toBe(0);
    expect(RunResultSchema.parse(JSON.parse(run.stdout))).toMatchObject({ status: 'succeeded' });
    expect(run.stderr).toContain('read data/invoices.csv (3 rows)');
  });

  it.each([
    ['malformed JSON', '{"format": "architect.run-request/1", "task": '],
    ['a request with no task', { format: 'architect.run-request/1' }],
    ['an unknown format', { format: 'architect.run-request/9', task: 'Hi' }],
    ['an unknown field', { format: 'architect.run-request/1', task: 'Hi', approve: true }],
    ['a file the job does not name', task('Hi', { inputs: ['data/payroll.csv'] })],
    ['a path out of the folder', task('Hi', { inputs: ['data/../secrets.txt'] })],
  ])('refuses %s with exit 2 before anything runs', async (_label, request) => {
    const machine = await machineWith([]);
    const { code, result } = await batch(machine, request);
    expect(code).toBe(2);
    expect(result).toMatchObject({ status: 'invalid_input', exit_code: 2, answer: null });
    expect(result.error?.message).not.toBe('');
    expect(machine.model.requests).toEqual([]);
  });

  it('refuses an agent that is not there with exit 2', async () => {
    const machine = await machineWith([]);
    const input = await requestFile(machine, task('Hi'));
    const run = await cli(['run', 'payroll', '--input', input], { env: machine.env });
    expect(run.code).toBe(2);
    expect(JSON.parse(run.stdout)).toMatchObject({
      status: 'invalid_input',
      error: { code: 'unknown_agent' },
    });
  });

  it('ends at the first write that needs approval, writes nothing, and exits 3 with the change', async () => {
    const machine = await machineWith([ADD_INVOICE, { text: 'never reached' }]);
    const before = await invoices(machine);
    const { code, result } = await batch(machine, task('Add an invoice for Ruiz, Ben.'));
    expect(code).toBe(3);
    expect(result).toMatchObject({
      status: 'not_permitted',
      error: { code: 'approval_required' },
      approval: {
        tool: 'append',
        file: 'data/invoices.csv',
        summary: 'Add 1 row to data/invoices.csv',
        diff: { added: [['INV-4', 'C-2', '5000', '2026-12-05', 'false']] },
      },
      artifacts: [],
    });
    expect(await invoices(machine)).toBe(before);
    expect(machine.model.chats()).toHaveLength(1);
  });

  it('exits 3 when the folder it needs is not granted here, before the model is called', async () => {
    const machine = await machineWith([]);
    const { openEngineStore } = await import('@architect/engine/testing');
    const store = openEngineStore(join(machine.dataDir, 'architect.db'));
    const installation = store.installations.get('grd_desk');
    if (!installation) throw new Error('no installation');
    store.installations.put({
      ...installation,
      grants: {
        ...installation.grants,
        resources: { ...installation.grants.resources, data: 'none' },
      },
    });
    store.close();
    const { code, result } = await batch(machine, task('How many invoices are there?'));
    expect(code).toBe(3);
    expect(result).toMatchObject({ status: 'not_permitted', error: { code: 'not_granted' } });
    expect(machine.model.requests).toEqual([]);
  });

  it('records a change it was allowed to make as an artifact', async () => {
    const machine = await machineWith([ADD_INVOICE, { text: 'Added INV-4.' }], { writes: 'allow' });
    const { code, result } = await batch(machine, task('Add an invoice for Ruiz, Ben.'));
    expect(code).toBe(0);
    expect(result.artifacts).toEqual([
      { path: 'data/invoices.csv', tool: 'append', summary: '1 row added' },
    ]);
    expect(await invoices(machine)).toContain('INV-4,C-2,5000,2026-12-05,false');
  });

  it('exits 130 when stopped with Ctrl+C, and the reply is closed off, not left running', async () => {
    const machine = await machineWith([
      { text: 'Counting the invoices one by one, slowly. '.repeat(20), chunk: 4, delayMs: 20 },
    ]);
    let press = () => undefined as void;
    const pending = batch(machine, task('Count slowly.'), [], {
      interruptWith: (pressed) => (press = pressed),
    });
    await new Promise((resolve) => setTimeout(resolve, 400));
    press();
    const { code, result } = await pending;
    expect(code).toBe(130);
    expect(result).toMatchObject({ status: 'cancelled', exit_code: 130, answer: null });
  });

  it('exits 1 when the model runtime is not running', async () => {
    const machine = await machineWith([]);
    await machine.model.close();
    const { code, result } = await batch(machine, task('How many invoices are there?'));
    expect(code).toBe(1);
    expect(result).toMatchObject({ status: 'runtime_error', exit_code: 1 });
    expect(result.error?.code).toMatch(/^model_/);
  });

  it('exits 4 when the agent runs out of steps without an answer', async () => {
    const reads = Array.from({ length: 4 }, () => ({
      toolCalls: [{ name: 'read', arguments: { path: 'data/policy.md' } }],
    }));
    const machine = await machineWith(reads);
    const { code, result } = await batch(machine, task('Read the policy forever.'));
    expect(code).toBe(4);
    expect(result).toMatchObject({ status: 'task_failed', error: { code: 'no_answer' } });
    expect(result.steps).toHaveLength(4);
  });

  it('stops a run that takes longer than --timeout, with exit 1', async () => {
    const machine = await machineWith([
      { text: 'Still thinking about it. '.repeat(40), chunk: 4, delayMs: 25 },
    ]);
    const { code, result } = await batch(machine, task('Think.'), ['--timeout', '1']);
    expect(code).toBe(1);
    expect(result).toMatchObject({ status: 'runtime_error', error: { code: 'timeout' } });
  });
});

describe('a request file run at a terminal', () => {
  async function atTerminal(
    machine: Machine,
    onQuestion: (keys: PassThrough, press: () => void) => void,
  ) {
    const input = await requestFile(machine, task('Add an invoice for Ruiz, Ben.'));
    const output = join(await tempDir('out'), 'result.json');
    const keys = keyboard();
    let press = () => undefined as void;
    const run = await cli(['run', 'service-desk', '--input', input, '--output', output], {
      env: machine.env,
      stdin: keys,
      terminal: true,
      interruptWith: (pressed) => (press = pressed),
      onStderr: (text) => {
        if (text.endsWith('[a]lways for this agent: ')) onQuestion(keys, press);
      },
    });
    return { run, result: RunResultSchema.parse(JSON.parse(await readFile(output, 'utf8'))) };
  }

  it('asks there, and takes the end of input as a no instead of waiting', async () => {
    const machine = await machineWith([ADD_INVOICE, { text: 'I left the invoices as they were.' }]);
    const before = await invoices(machine);
    const { run, result } = await atTerminal(machine, (keys) => keys.end());
    expect(run.code).toBe(0);
    expect(result).toMatchObject({
      status: 'succeeded',
      answer: `I'll add the invoice.\n\nI left the invoices as they were.`,
      artifacts: [],
      steps: [{ tool: 'append', summary: 'declined' }],
    });
    expect(await invoices(machine)).toBe(before);
  });

  it('stops at the question when Ctrl+C comes, with exit 130 and nothing written', async () => {
    const machine = await machineWith([ADD_INVOICE, { text: 'never reached' }]);
    const before = await invoices(machine);
    const { run, result } = await atTerminal(machine, (_keys, press) => press());
    expect(run.code).toBe(130);
    expect(result).toMatchObject({ status: 'cancelled', answer: null });
    expect(await invoices(machine)).toBe(before);
    expect(machine.model.chats()).toHaveLength(1);
  });
});

describe('a conversation in the terminal', () => {
  it('answers each line on stdout with the steps on stderr, in one chat', async () => {
    const machine = await machineWith([
      ...READ_THEN_ANSWER,
      { text: 'INV-2 belongs to Ruiz, Ben.' },
    ]);
    const run = await cli(['run', 'service-desk'], {
      env: machine.env,
      stdin: 'How many invoices are there?\nWhose is INV-2?\n',
    });
    expect(run.code).toBe(0);
    expect(run.stdout).toBe('There are 3 invoices on file.\nINV-2 belongs to Ruiz, Ben.\n');
    expect(run.stderr).toContain('read data/invoices.csv (3 rows)');
    // The second request went with the first as history.
    const [, , second] = machine.model.chats();
    expect(second?.messages.map((message) => message.role)).toEqual([
      'system',
      'user',
      'assistant',
      'user',
    ]);
  });

  it("says on its own line when the model's turn is asked again, since printed text cannot be taken back", async () => {
    const machine = await machineWith([
      // A pause between pieces, so some of the text is printed before the call fails.
      { text: 'Let me add it up. ', streamError: UNREADABLE_CALL, delayMs: 45 },
      { text: 'There are 3 invoices on file.' },
    ]);
    const run = await cli(['run', 'service-desk'], {
      env: machine.env,
      stdin: 'How many invoices are there?\n',
    });
    expect(run.code).toBe(0);
    expect(run.stdout).toMatch(/^Let me[^\n]*\n\(asked again\)\nThere are 3 invoices on file\.\n$/);
    expect(machine.model.chats()).toHaveLength(2);
  });

  it("keeps the earlier turns' text above the marker, and the new text after it", async () => {
    const machine = await machineWith([
      {
        text: 'Let me look.',
        chunk: 64,
        toolCalls: [{ name: 'read', arguments: { path: 'data/invoices.csv' } }],
      },
      // Long enough after the step above that the reply publishes this text at once.
      { text: 'Working it out. ', chunk: 64, streamError: UNREADABLE_CALL, delayMs: 100 },
      { text: 'There are 3 invoices on file.' },
    ]);
    const run = await cli(['run', 'service-desk'], {
      env: machine.env,
      stdin: 'How many invoices are there?\n',
    });
    expect(run.code).toBe(0);
    expect(run.stdout).toBe(
      'Let me look.\n\nWorking it out. \n(asked again)\nThere are 3 invoices on file.\n',
    );
  });

  it('prints no marker when nothing had been shown for the turn that is asked again', async () => {
    const machine = await machineWith([
      { status: 500, error: UNREADABLE_CALL },
      { text: 'There are 3 invoices on file.' },
    ]);
    const run = await cli(['run', 'service-desk'], {
      env: machine.env,
      stdin: 'How many invoices are there?\n',
    });
    expect(run.code).toBe(0);
    expect(run.stdout).toBe('There are 3 invoices on file.\n');
  });

  it('asks about a change on a terminal, and writes it once allowed', async () => {
    const machine = await machineWith([ADD_INVOICE, { text: 'Added INV-4.' }]);
    const keys = keyboard();
    const pending = cli(['run', 'service-desk'], {
      env: machine.env,
      stdin: keys,
      terminal: true,
      onStderr: (text) => {
        if (text.endsWith('[a]lways for this agent: ')) keys.write('y\n');
      },
    });
    keys.write('Add an invoice for Ruiz, Ben.\n');
    const watching = setInterval(() => {
      if (machine.model.chats().length === 2) {
        clearInterval(watching);
        setTimeout(() => keys.end(), 50);
      }
    }, 20);
    const run = await pending;
    clearInterval(watching);
    expect(run.stderr).toContain('Add 1 row to data/invoices.csv:');
    expect(run.stderr).toContain('  + INV-4, C-2, 5000, 2026-12-05, false');
    expect(run.stdout).toContain('Added INV-4.');
    expect(await invoices(machine)).toContain('INV-4,C-2,5000,2026-12-05,false');
    expect(run.code).toBe(0);
  });

  it('fails a change that needs approval when nobody is at a terminal, and exits 3', async () => {
    const machine = await machineWith([ADD_INVOICE]);
    const before = await invoices(machine);
    const run = await cli(['run', 'service-desk'], {
      env: machine.env,
      stdin: 'Add an invoice for Ruiz, Ben.\n',
    });
    expect(run.code).toBe(3);
    expect(run.stderr).toContain('needs approval, and nobody could give it');
    expect(await invoices(machine)).toBe(before);
  });
});
