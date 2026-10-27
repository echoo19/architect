import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { TableSnapshot } from '../src/data/types';
import { createSandbox } from '../src/sandbox/sandbox';
import type { Sandbox, SandboxData, SandboxFailure, SandboxOutcome } from '../src/sandbox/types';

const fixture = (name: string) => fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url));

function table(columns: string[], rows: Record<string, string | null>[]): TableSnapshot {
  return {
    columns: Object.freeze([...columns]),
    rows: Object.freeze(rows.map((row) => Object.freeze({ ...row }))),
  };
}

const jobs = table(
  ['job_id', 'status', 'minutes'],
  [
    { job_id: 'W-1', status: 'done', minutes: '90' },
    { job_id: 'W-2', status: 'open', minutes: '45' },
    { job_id: 'W-3', status: 'done', minutes: '120' },
  ],
);

const data: SandboxData = {
  files: [
    {
      name: 'jobs.csv',
      kind: 'table',
      access: 'read',
      rows: 3,
      columns: ['job_id', 'status', 'minutes'],
    },
    { name: 'policy.md', kind: 'text', access: 'read' },
  ],
  tables: { 'jobs.csv': jobs },
  texts: { 'policy.md': 'Labor is billed per started half hour.' },
};

const tool = (name: string, code: string) => ({ name, code });

function valueOf(outcome: SandboxOutcome): unknown {
  if (!outcome.ok)
    throw new Error(`Expected success, got ${outcome.failure.kind}: ${outcome.failure.message}`);
  return outcome.value;
}

function failureOf(outcome: SandboxOutcome): SandboxFailure {
  if (outcome.ok) throw new Error(`Expected a failure, got ${JSON.stringify(outcome.value)}`);
  return outcome.failure;
}

describe('sandbox', () => {
  let sandbox: Sandbox;
  beforeAll(() => {
    sandbox = createSandbox({ timeoutMs: 1000, memoryLimitBytes: 32 * 1024 * 1024 });
  });
  afterAll(() => sandbox.dispose());

  it('runs a tool against the data it is given', async () => {
    const outcome = await sandbox.runTool(
      tool(
        'job_summary',
        `function run(args, ctx) {
          var done = ctx.readTable('jobs.csv', { where: [{ column: 'status', op: '=', value: 'done' }] });
          var long = ctx.readTable('jobs.csv', { where: [{ column: 'minutes', op: '>', value: 60 }], columns: ['job_id'] });
          return {
            done: done.map(function (row) { return row.job_id; }),
            long: long,
            policy: ctx.readText('policy.md').split(' ')[0],
            files: ctx.listFiles().map(function (file) { return file.name; }),
            doubled: args.n * 2
          };
        }`,
      ),
      { n: 21 },
      data,
    );
    expect(valueOf(outcome)).toEqual({
      done: ['W-1', 'W-3'],
      long: [{ job_id: 'W-1' }, { job_id: 'W-3' }],
      policy: 'Labor',
      files: ['jobs.csv', 'policy.md'],
      doubled: 42,
    });
  });

  it('takes a file by its name without the extension when only one file has it', async () => {
    const outcome = await sandbox.runTool(
      tool(
        'short_names',
        `function run(args, ctx) {
          return {
            jobs: ctx.readTable('jobs', { where: [{ column: 'status', op: '=', value: 'open' }] }),
            policy: ctx.readText('policy').split(' ')[0],
          };
        }`,
      ),
      {},
      data,
    );
    expect(valueOf(outcome)).toEqual({
      jobs: [{ job_id: 'W-2', status: 'open', minutes: '45' }],
      policy: 'Labor',
    });
    const twins: SandboxData = {
      ...data,
      files: [...data.files, { name: 'jobs.tsv', kind: 'table', access: 'read', rows: 3 }],
      tables: { ...data.tables, 'jobs.tsv': jobs },
    };
    const ambiguous = failureOf(
      await sandbox.runTool(
        tool('ambiguous', `function run(args, ctx) { return ctx.readTable('jobs'); }`),
        {},
        twins,
      ),
    );
    expect(ambiguous.message).toContain(
      'There is no table called "jobs". The tables are: jobs.csv, jobs.tsv.',
    );
  });

  it('runs a validator over the end state and the original data', async () => {
    const source = `var validators = {
      appended: function (params, ctx) {
        var added = ctx.readTable('jobs.csv').length - ctx.readOriginalTable('jobs.csv').length;
        return {
          pass: added === params.expected,
          reason: added + ' rows were added.',
          details: { answer: ctx.answer, finalText: ctx.finalText, tools: ctx.toolCalls.map(function (c) { return c.name; }) }
        };
      }
    };`;
    const after = table(jobs.columns as string[], [
      ...jobs.rows,
      { job_id: 'W-4', status: 'open', minutes: '30' },
    ]);
    const outcome = await sandbox.runValidator(
      source,
      'appended',
      { expected: 1 },
      {
        tables: { 'jobs.csv': after },
        originalTables: { 'jobs.csv': jobs },
        answer: { job_id: 'W-4' },
        finalText: 'ANSWER: {"job_id": "W-4"}',
        toolCalls: [{ name: 'append_rows', arguments: { file: 'jobs.csv' } }],
      },
    );
    expect(valueOf(outcome)).toEqual({
      pass: true,
      reason: '1 rows were added.',
      details: {
        answer: { job_id: 'W-4' },
        finalText: 'ANSWER: {"job_id": "W-4"}',
        tools: ['append_rows'],
      },
    });
  });

  it('has no clock and no randomness, but dates from arguments work in UTC', async () => {
    const probe = (expression: string) =>
      sandbox.runTool(tool('probe', `function run() { return ${expression}; }`), {}, data);
    expect(failureOf(await probe('Math.random()')).message).toMatch(/no randomness/);
    expect(failureOf(await probe('Date.now()')).message).toMatch(/no clock/);
    expect(failureOf(await probe('new Date()')).message).toMatch(/no clock/);
    expect(failureOf(await probe('Date()')).message).toMatch(/no clock/);
    expect(failureOf(await probe('new (new Date(0).constructor)()')).message).toMatch(/no clock/);
    expect(valueOf(await probe('new Date("2026-11-03").getDay()'))).toBe(2);
    expect(valueOf(await probe('new Date(2026, 10, 3).getTimezoneOffset()'))).toBe(0);
  });

  it('gives tools nothing from Node: no process, require, console, timers or network', async () => {
    const outcome = await sandbox.runTool(
      tool(
        'escape',
        `function run() {
          return [typeof process, typeof require, typeof module, typeof console, typeof setTimeout,
            typeof fetch, typeof host, typeof globalThis.host];
        }`,
      ),
      {},
      data,
    );
    expect(valueOf(outcome)).toEqual(Array(8).fill('undefined'));
  });

  it('stops a tool that runs too long and keeps working afterwards', async () => {
    const started = Date.now();
    const failure = failureOf(
      await sandbox.runTool(tool('spin', 'function run() { while (true) {} }'), {}, data),
    );
    expect(failure.kind).toBe('timeout');
    expect(Date.now() - started).toBeLessThan(5000);
    expect(
      valueOf(await sandbox.runTool(tool('ok', 'function run() { return 1; }'), {}, data)),
    ).toBe(1);
  });

  it('enforces the memory limit', async () => {
    const failure = failureOf(
      await sandbox.runTool(
        tool('hog', 'function run() { return "x".repeat(1e8).length; }'),
        {},
        data,
      ),
    );
    expect(failure.kind).toBe('memory');
  });

  it('reports code problems with a kind and a readable message', async () => {
    const run = (code: string) => sandbox.runTool(tool('broken', code), {}, data);
    expect(failureOf(await run('function run( {')).kind).toBe('load');
    expect(failureOf(await run('var x = 1;'))).toEqual({
      kind: 'load',
      message: 'The tool code must define function run(args, ctx).',
    });
    const thrown = failureOf(await run('function run() {\n  return null.total;\n}'));
    expect(thrown.kind).toBe('error');
    expect(thrown.message).toMatch(/TypeError/);
    expect(thrown.message).toContain('tools/broken.js:2');
    expect(failureOf(await run('function run() { return Promise.resolve(1); }')).message).toMatch(
      /not a promise/,
    );
    expect(
      failureOf(await run('function run() { function f() { return f() + 1; } return f(); }'))
        .message,
    ).toMatch(/recursed too deeply/);
    const unknownTable = failureOf(
      await run('function run(args, ctx) { return ctx.readTable("notes.csv"); }'),
    );
    expect(unknownTable.message).toContain(
      'There is no table called "notes.csv". The tables are: jobs.csv.',
    );
    expect(valueOf(await run('function run() { return undefined; }'))).toBeNull();
  });

  it('reports a missing validator as a load problem', async () => {
    const failure = failureOf(
      await sandbox.runValidator(
        'var validators = {};',
        'missing',
        {},
        {
          tables: {},
          originalTables: {},
          answer: null,
          finalText: '',
          toolCalls: [],
        },
      ),
    );
    expect(failure).toEqual({
      kind: 'load',
      message: 'The checker module has no validator named "missing".',
    });
  });

  it('serializes concurrent calls and answers each one', async () => {
    const outcomes = await Promise.all(
      [1, 2, 3, 4, 5].map((n) =>
        sandbox.runTool(
          tool('square', 'function run(args) { return args.n * args.n; }'),
          { n },
          data,
        ),
      ),
    );
    expect(outcomes.map(valueOf)).toEqual([1, 4, 9, 16, 25]);
  });
});

describe('sandbox process failures', () => {
  it('restarts after the child crashes, with a clear error for the call that crashed', async () => {
    const sandbox = createSandbox({ entryPath: fixture('faulty-sandbox-child.ts') });
    try {
      const ok = tool('ok', 'function run() { return "fine"; }');
      expect(valueOf(await sandbox.runTool(ok, {}, data))).toBe('fine');
      const failure = failureOf(
        await sandbox.runTool(tool('crash_now', 'function run() {}'), {}, data),
      );
      expect(failure.kind).toBe('crashed');
      expect(failure.message).toContain('exit code 70');
      expect(failure.message).toContain('restarts on the next call');
      expect(valueOf(await sandbox.runTool(ok, {}, data))).toBe('fine');
    } finally {
      await sandbox.dispose();
    }
  });

  it('kills a child that stops answering and restarts on the next call', async () => {
    const sandbox = createSandbox({
      entryPath: fixture('faulty-sandbox-child.ts'),
      timeoutMs: 300,
    });
    try {
      const failure = failureOf(
        await sandbox.runTool(tool('hang_now', 'function run() {}'), {}, data),
      );
      expect(failure.kind).toBe('timeout');
      expect(failure.message).toContain('did not finish within 300 ms');
      expect(
        valueOf(await sandbox.runTool(tool('ok', 'function run() { return 2; }'), {}, data)),
      ).toBe(2);
    } finally {
      await sandbox.dispose();
    }
  });

  it('reports a child that cannot start', async () => {
    const sandbox = createSandbox({ entryPath: fixture('no-such-child.js') });
    try {
      const failure = failureOf(await sandbox.runTool(tool('ok', 'function run() {}'), {}, data));
      expect(failure.kind).toBe('crashed');
      expect(failure.message).toMatch(/could not start/);
    } finally {
      await sandbox.dispose();
    }
  });

  it('refuses calls after it is disposed', async () => {
    const sandbox = createSandbox({ entryPath: fixture('recording-sandbox-child.ts') });
    await sandbox.dispose();
    await expect(sandbox.runTool(tool('ok', 'function run() {}'), {}, data)).rejects.toThrow(
      /disposed/,
    );
  });
});

describe('sandbox data transfer and environment', () => {
  let sandbox: Sandbox;
  beforeAll(() => {
    process.env.ARCHITECT_TEST_SECRET = 'must-not-reach-the-child';
    sandbox = createSandbox({ entryPath: fixture('recording-sandbox-child.ts') });
  });
  afterAll(async () => {
    delete process.env.ARCHITECT_TEST_SECRET;
    await sandbox.dispose();
  });

  const report = async (name: string, input: SandboxData) =>
    valueOf(await sandbox.runTool(tool(name, 'function run() {}'), {}, input)) as {
      blobCount: number;
      environment: string[];
    };

  /** Data no earlier call has sent, so the child can't have it yet. */
  const freshData = (tag: string): SandboxData => ({
    ...data,
    tables: { 'jobs.csv': table(['job_id'], [{ job_id: `${tag}-1` }]) },
    texts: { 'policy.md': `Policy version ${tag}.` },
  });

  it('starts the child with nothing from the engine environment', async () => {
    const { environment } = await report('env', data);
    expect(environment).not.toContain('ARCHITECT_TEST_SECRET');
    // libuv gives every Windows process these; they come from the OS, not from the engine's settings.
    const windows = [
      'HOMEDRIVE',
      'HOMEPATH',
      'LOGONSERVER',
      'PATH',
      'SYSTEMDRIVE',
      'SYSTEMROOT',
      'TEMP',
      'USERDOMAIN',
      'USERNAME',
      'USERPROFILE',
      'WINDIR',
    ];
    const allowed = new Set(['TZ', ...(process.platform === 'win32' ? windows : [])]);
    expect(environment.filter((name) => !allowed.has(name.toUpperCase()))).toEqual([]);
  });

  it('sends each table and text once, then only what changed', async () => {
    const fresh = freshData('A');
    expect((await report('first', fresh)).blobCount).toBe(2);
    expect((await report('again', fresh)).blobCount).toBe(0);
    const changed: SandboxData = {
      ...fresh,
      tables: { 'jobs.csv': table(['job_id'], [{ job_id: 'B' }]) },
    };
    expect((await report('changed', changed)).blobCount).toBe(1);
  });

  it('resends data the child reports missing', async () => {
    const fresh = freshData('C');
    expect((await report('first', fresh)).blobCount).toBe(2);
    expect((await report('evicted', fresh)).blobCount).toBe(2);
  });
});
