import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { DataFile, JsonValue, ToolCall } from '@architect/shared';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { openAgentFiles, type AgentFiles, type OutputFolder } from '../src/files/agent-files';
import { createSandbox } from '../src/sandbox/sandbox';
import type { Sandbox } from '../src/sandbox/types';
import type { ApproveWrite } from '../src/tools/builtins';
import { createToolbox, type Toolbox } from '../src/tools/toolbox';
import {
  makeHarness,
  makeJobDir,
  SAMPLE_CONTENT,
  SAMPLE_FILES,
  type TempJob,
} from './support/fixtures';

let job: TempJob | undefined;
afterEach(() => job?.remove());

let sandbox: Sandbox;
beforeAll(() => {
  sandbox = createSandbox();
});
afterAll(() => sandbox.dispose());

const skill = {
  name: 'price-a-job',
  description: 'Turn a job into invoice lines.',
  body: '1. Read the job.\n2. Price it.\n',
};
const SKILL_FILE = `---\nname: price-a-job\ndescription: Turn a job into invoice lines.\n---\n${skill.body}`;

async function setup(
  options: {
    mode?: 'scratch' | 'live';
    files?: DataFile[];
    content?: Record<string, string>;
    output?: OutputFolder;
    approveWrite?: ApproveWrite;
    sandbox?: Sandbox;
    harness?: Parameters<typeof makeHarness>[0];
    resultBudget?: number;
  } = {},
): Promise<{ files: AgentFiles; toolbox: Toolbox }> {
  job = makeJobDir(options.content ?? SAMPLE_CONTENT);
  const harness = makeHarness(options.harness);
  const files = await openAgentFiles({
    dataDir: job.dataDir,
    files: options.files ?? SAMPLE_FILES,
    skills: harness.skills.length > 0 ? { 'skills/price-a-job/SKILL.md': SKILL_FILE } : {},
    mode: options.mode ?? 'scratch',
    ...(options.output === undefined ? {} : { output: options.output }),
  });
  const toolbox = createToolbox({
    harness,
    files,
    sandbox: options.sandbox ?? sandbox,
    today: '2026-11-03',
    approveWrite: options.approveWrite,
    resultBudget: options.resultBudget,
  });
  return { files, toolbox };
}

let callNumber = 0;
const call = (name: string, args: Record<string, JsonValue> = {}): ToolCall => ({
  id: `call_${callNumber++}`,
  name,
  arguments: args,
});

describe('toolbox', () => {
  it("offers a coding agent's tools, the write tools only when something can change", async () => {
    const { toolbox } = await setup();
    expect(toolbox.specs.map((spec) => spec.name)).toEqual([
      'read',
      'ls',
      'glob',
      'grep',
      'write',
      'edit',
      'append',
      'run',
    ]);
    const readOnly = await setup({
      files: SAMPLE_FILES.map((file) => ({ ...file, access: 'read' as const })),
      harness: {
        tools: [
          {
            name: 'invoice_total',
            description: 'Total an invoice.',
            parameters: { type: 'object' },
            code: 'function run(args, ctx) { return 1; }',
          },
        ],
      },
    });
    expect(readOnly.toolbox.specs.map((spec) => spec.name)).toEqual([
      'read',
      'ls',
      'glob',
      'grep',
      'run',
      'invoice_total',
    ]);
    const withOutput = await setup({
      files: SAMPLE_FILES.map((file) => ({ ...file, access: 'read' as const })),
      output: {},
    });
    expect(withOutput.toolbox.specs.map((spec) => spec.name)).toContain('write');
  });

  it('reads a file as numbered lines, with a table read showing its rows', async () => {
    const { toolbox } = await setup();
    const outcome = await toolbox.run(call('read', { path: 'data/invoices.csv' }));
    expect(outcome.content).toBe(
      [
        '1\tinvoice_id,customer_id,total_cents,due_date,paid',
        '2\tINV-1,C-1,12000,2026-10-01,true',
        '3\tINV-2,C-2,4550,2026-11-15,',
        '4\tINV-3,C-1,990,2026-11-02,false',
      ].join('\n'),
    );
    expect(outcome.result).toBe(outcome.content);
    expect(outcome.table).toEqual({
      columns: ['invoice_id', 'customer_id', 'total_cents', 'due_date', 'paid'],
      rows: [
        ['INV-1', 'C-1', '12000', '2026-10-01', 'true'],
        ['INV-2', 'C-2', '4550', '2026-11-15', null],
        ['INV-3', 'C-1', '990', '2026-11-02', 'false'],
      ],
      total: 3,
    });
    const part = await toolbox.run(
      call('read', { file_path: 'data/invoices.csv', offset: 3, limit: '1' }),
    );
    expect(part.content).toBe(
      '3\tINV-2,C-2,4550,2026-11-15,\n[Lines 3-3 of 4. 1 more line: read on with offset 4.]',
    );
    expect(part.table?.rows).toEqual([['INV-2', 'C-2', '4550', '2026-11-15', null]]);
    expect((await toolbox.run(call('read', { path: 'data/policy.md' }))).table).toBeUndefined();
  });

  it('keeps a read within the budget and says where to read on', async () => {
    const long = Array.from(
      { length: 400 },
      (_, i) => `Line ${i + 1} of the policy, which goes on.`,
    ).join('\n');
    const { toolbox } = await setup({
      content: { ...SAMPLE_CONTENT, 'policy.md': `${long}\n` },
      resultBudget: 2000,
    });
    const first = await toolbox.run(call('read', { path: 'data/policy.md' }));
    expect(first.content.length).toBeLessThanOrEqual(2000);
    const note = /\[Lines 1-(\d+) of 400\. (\d+) more lines: read on with offset (\d+)\.\]$/.exec(
      first.content,
    );
    expect(note).not.toBeNull();
    const shown = Number(note?.[1]);
    expect(Number(note?.[2])).toBe(400 - shown);
    expect(Number(note?.[3])).toBe(shown + 1);
    expect(first.content.split('\n')[0]).toBe('  1\tLine 1 of the policy, which goes on.');
    const next = await toolbox.run(call('read', { path: 'data/policy.md', offset: shown + 1 }));
    expect(next.content.trimStart().startsWith(`${shown + 1}\tLine ${shown + 1} `)).toBe(true);
    expect((await toolbox.run(call('read', { path: 'data/policy.md', offset: 401 }))).error).toBe(
      'data/policy.md has 400 lines, so there is no line 401.',
    );
  });

  it('marks reading a skill, and lists, finds and searches files', async () => {
    const { toolbox } = await setup({ harness: { skills: [skill] } });
    const read = await toolbox.run(call('read', { path: 'skills/price-a-job/SKILL.md' }));
    expect(read.loadedSkill).toBe('price-a-job');
    expect((await toolbox.run(call('ls'))).content).toBe(
      'data/     3 files, 1 writable\nskills/   1 skill, read-only',
    );
    expect((await toolbox.run(call('ls', { path: 'data' }))).content).toBe(
      [
        'data/customers.csv  table  4 lines  read-only',
        'data/invoices.csv   table  4 lines  writable',
        'data/policy.md      text   4 lines  read-only',
      ].join('\n'),
    );
    expect((await toolbox.run(call('glob', { pattern: '*.csv' }))).content).toBe(
      'data/customers.csv\ndata/invoices.csv',
    );
    expect((await toolbox.run(call('glob', { pattern: 'data/*.xlsx' }))).content).toBe(
      'No files match data/*.xlsx.',
    );
    expect(
      (await toolbox.run(call('grep', { pattern: 'c-1', ignore_case: true, glob: '*.csv' })))
        .content,
    ).toBe(
      [
        'data/customers.csv:2: C-1,Ada Park,Ferncliff,30',
        'data/invoices.csv:2: INV-1,C-1,12000,2026-10-01,true',
        'data/invoices.csv:4: INV-3,C-1,990,2026-11-02,false',
      ].join('\n'),
    );
    expect(
      (await toolbox.run(call('grep', { pattern: 'INV', path: 'data/invoices.csv', limit: 1 })))
        .content,
    ).toBe(
      'data/invoices.csv:2: INV-1,C-1,12000,2026-10-01,true\n[3 matching lines; showing 1. Narrow the pattern or the path, or raise limit.]',
    );
    expect((await toolbox.run(call('grep', { pattern: 'refund', path: 'data' }))).content).toBe(
      'No lines match in data.',
    );
    expect((await toolbox.run(call('grep', { pattern: '(' }))).error).toMatch(
      /^The pattern isn't a regular expression: /,
    );
    expect((await toolbox.run(call('glob', { pattern: '[z-a]' }))).error).toBe(
      '[z-a] has a range that runs backwards, z-a.',
    );
    expect((await toolbox.run(call('grep', { pattern: 'x', glob: '[z-a]' }))).error).toBe(
      '[z-a] has a range that runs backwards, z-a.',
    );
  });

  it('runs code over the files and returns what it printed and its last value', async () => {
    const { toolbox } = await setup();
    const outcome = await toolbox.run(
      call('run', {
        code: `const unpaid = csv.parse(files.read('data/invoices.csv')).filter((row) => row.paid !== 'true');
print(unpaid.length, 'unpaid as of', today);
unpaid.reduce((sum, row) => sum + Number(row.total_cents), 0)`,
      }),
    );
    expect(outcome.content).toBe('2 unpaid as of 2026-11-03\n=> 5540');
    expect((await toolbox.run(call('run', { code: 'let x = 1;' }))).content).toBe('(no output)');
    const failed = await toolbox.run(call('run', { code: 'print("so far");\nnull.total' }));
    expect(failed.error).toMatch(
      /^TypeError: .+ \(run\.js:2:\d+\)\nIt printed this before it stopped:\nso far$/,
    );
    expect(failed.content.startsWith('Error: TypeError')).toBe(true);
  });

  it('cuts a long result to the budget, with a note', async () => {
    const { toolbox } = await setup({ resultBudget: 1000 });
    const outcome = await toolbox.run(call('run', { code: '"x".repeat(5000)' }));
    expect(outcome.content.length).toBeLessThanOrEqual(1000);
    expect(outcome.content).toMatch(
      /\[cut: 5,005 characters in all, and the limit is 1,000; print less, or filter or add up in the code\]$/,
    );
  });

  it('turns mistakes into errors the model can read', async () => {
    const { toolbox } = await setup();
    expect((await toolbox.run(call('read_table', { file: 'invoices.csv' }))).error).toBe(
      'There is no tool called "read_table". Use read, grep or run instead. The tools are: read, ls, glob, grep, write, edit, append, run.',
    );
    expect((await toolbox.run(call('read', {}))).error).toMatch(
      /^Invalid arguments for read\. path: /,
    );
    expect((await toolbox.run(call('read', { path: 'data/x.csv' }))).error).toBe(
      'There is no data/x.csv. In data/ there are: customers.csv, invoices.csv, policy.md.',
    );
    expect((await toolbox.run(call('read', { path: '../job.json' }))).error).toBe(
      '"../job.json" climbs out of your folder with "..". Paths here are like data/orders.csv.',
    );
    expect((await toolbox.run(call('ls', { path: 'nope' }))).error).toBe(
      'There is no nope. Your folders are data/.',
    );
    const unsure = await toolbox.run(
      call('edit', { path: 'data/invoices.csv', old_string: 'C-1', new_string: 'C-9' }),
    );
    expect(unsure.error).toBe(
      'old_string is in data/invoices.csv 2 times. Give more of the text around it so it matches once, or set replace_all to change all 2.',
    );
    expect(
      (
        await toolbox.run(
          call('edit', { path: 'data/invoices.csv', old_string: 'INV-9', new_string: 'x' }),
        )
      ).error,
    ).toBe(
      "old_string isn't in data/invoices.csv. Read the file and copy the text exactly, with its spaces and line breaks.",
    );
    expect(
      (await toolbox.run(call('write', { path: 'data/customers.csv', content: 'x' }))).error,
    ).toBe('data/customers.csv is read-only for this job. Only data/invoices.csv can be changed.');
  });

  it('applies changes to the scratch copy in task mode and records each one', async () => {
    const { files, toolbox } = await setup();
    const appended = await toolbox.run(
      call('append', { path: 'data/invoices.csv', text: 'INV-4,C-3,700,2026-12-01,' }),
    );
    expect(appended.content).toBe('Added 1 row to data/invoices.csv.');
    expect(appended.change).toMatchObject({
      path: 'data/invoices.csv',
      op: 'append',
      applied: true,
      rows: { added: [['INV-4', 'C-3', '700', '2026-12-01', null]], changed: [], removed: [] },
    });
    const edited = await toolbox.run(
      call('edit', {
        path: 'data/invoices.csv',
        old_string: 'INV-2,C-2,4550,2026-11-15,',
        new_string: 'INV-2,C-2,4550,2026-11-15,true',
      }),
    );
    expect(edited.content).toBe('Changed 1 row in data/invoices.csv.');
    expect(files.tables()['invoices.csv']?.rows.map((row) => row.paid)).toEqual([
      'true',
      'true',
      'false',
      null,
    ]);
    const all = await toolbox.run(
      call('edit', {
        path: 'data/invoices.csv',
        old_string: 'C-1,',
        new_string: 'C-01,',
        replace_all: true,
      }),
    );
    expect(all.content).toBe('Changed 2 rows in data/invoices.csv.');
    expect(readFileSync(join(job?.dataDir ?? '', 'invoices.csv'), 'utf8')).toBe(
      SAMPLE_CONTENT['invoices.csv'],
    );
  });

  it('appends on a new line, whatever the end of the file', async () => {
    const { files, toolbox } = await setup({
      content: {
        ...SAMPLE_CONTENT,
        'invoices.csv':
          'invoice_id,customer_id,total_cents,due_date,paid\nINV-1,C-1,1,2026-10-01,true',
      },
    });
    await toolbox.run(
      call('append', { path: 'data/invoices.csv', text: 'INV-2,C-1,2,2026-10-02,\n' }),
    );
    expect(files.read('data/invoices.csv')).toBe(
      'invoice_id,customer_id,total_cents,due_date,paid\nINV-1,C-1,1,2026-10-01,true\nINV-2,C-1,2,2026-10-02,\n',
    );
  });

  it('asks before changing a file in chat mode and saves an approved change to a live copy', async () => {
    const approveWrite = vi.fn<ApproveWrite>(async () => 'approve');
    const { toolbox } = await setup({ mode: 'live', approveWrite });
    const outcome = await toolbox.run(
      call('edit', {
        path: 'data/invoices.csv',
        old_string: 'INV-2,C-2,4550,2026-11-15,',
        new_string: 'INV-2,C-2,4550,2026-11-15,true',
      }),
    );
    expect(outcome.content).toBe('Changed 1 row in data/invoices.csv.');
    const [pending] = approveWrite.mock.calls[0] ?? [];
    expect(pending).toMatchObject({
      tool: 'edit',
      path: 'data/invoices.csv',
      summary: 'Change 1 row in data/invoices.csv',
      rows: {
        columns: ['invoice_id', 'customer_id', 'total_cents', 'due_date', 'paid'],
        added: [],
        removed: [],
        changed: [
          {
            before: ['INV-2', 'C-2', '4550', '2026-11-15', null],
            after: ['INV-2', 'C-2', '4550', '2026-11-15', 'true'],
          },
        ],
      },
    });
    expect(pending?.patch).toContain('+INV-2,C-2,4550,2026-11-15,true');
    expect(readFileSync(join(job?.dataDir ?? '', 'invoices.csv'), 'utf8')).toContain(
      'INV-2,C-2,4550,2026-11-15,true',
    );
  });

  it('reports a declined change without changing anything', async () => {
    const { files, toolbox } = await setup({ mode: 'live', approveWrite: async () => 'deny' });
    const outcome = await toolbox.run(
      call('append', { path: 'data/invoices.csv', text: 'INV-4,C-1,1,2026-12-01,' }),
    );
    expect(outcome.content).toBe(
      'The user declined this change, so nothing was written: Add 1 row to data/invoices.csv.',
    );
    expect(outcome.change).toMatchObject({ applied: false, op: 'append' });
    expect(files.tables()['invoices.csv']?.rows).toHaveLength(3);
    expect(readFileSync(join(job?.dataDir ?? '', 'invoices.csv'), 'utf8')).not.toContain('INV-4');
  });

  it('stops waiting for approval when the run is aborted', async () => {
    const { files, toolbox } = await setup({ approveWrite: () => new Promise(() => undefined) });
    const controller = new AbortController();
    const pending = toolbox.run(
      call('append', { path: 'data/invoices.csv', text: 'INV-4,C-1,1,2026-12-01,' }),
      controller.signal,
    );
    controller.abort();
    await expect(pending).rejects.toThrow(/abort/i);
    expect(files.tables()['invoices.csv']?.rows).toHaveLength(3);
  });

  it('writes a new file in output/, and diffs it as text in the approval', async () => {
    const approveWrite = vi.fn<ApproveWrite>(async () => 'approve');
    const { files, toolbox } = await setup({ output: {}, approveWrite });
    const outcome = await toolbox.run(
      call('write', { path: 'output/summary.md', content: '# Unpaid\n\nTwo invoices.\n' }),
    );
    expect(outcome.content).toBe('Created output/summary.md (3 lines).');
    const [pending] = approveWrite.mock.calls[0] ?? [];
    expect(pending?.rows).toBeUndefined();
    expect(pending?.patch).toContain('--- /dev/null\n+++ b/output/summary.md');
    expect(files.read('output/summary.md')).toBe('# Unpaid\n\nTwo invoices.\n');
    const more = await toolbox.run(
      call('append', { path: 'output/summary.md', text: 'Both are due.' }),
    );
    expect(more.content).toBe('Added 1 line to output/summary.md.');
  });

  it('runs harness tools in the sandbox with the current data and reports their failures', async () => {
    const runTool = vi.fn<Sandbox['runTool']>();
    runTool.mockResolvedValueOnce({ ok: true, value: { total_cents: 5540 } });
    runTool.mockResolvedValueOnce({
      ok: false,
      failure: { kind: 'timeout', message: 'It ran longer than 2000 ms and was stopped.' },
    });
    const { toolbox } = await setup({
      sandbox: { ...sandbox, runTool, dispose: async () => undefined },
      harness: {
        tools: [
          {
            name: 'invoice_total',
            description: 'Total an invoice.',
            parameters: { type: 'object', required: ['invoice_id'] },
            code: 'function run(args, ctx) { return 1; }',
          },
        ],
      },
    });
    await toolbox.run(
      call('append', { path: 'data/invoices.csv', text: 'INV-4,C-1,1,2026-12-01,' }),
    );
    const outcome = await toolbox.run(call('invoice_total', { invoice_id: 'INV-1' }));
    expect(outcome.result).toEqual({ total_cents: 5540 });
    expect(outcome.content).toBe('{"total_cents":5540}');
    const [toolArg, args, data] = runTool.mock.calls[0] ?? [];
    expect(toolArg?.name).toBe('invoice_total');
    expect(args).toEqual({ invoice_id: 'INV-1' });
    expect(data?.tables['invoices.csv']?.rows).toHaveLength(4);
    expect(data?.texts['policy.md']).toContain('due 30 days');
    expect((await toolbox.run(call('invoice_total', { invoice_id: 'INV-1' }))).error).toBe(
      'invoice_total failed: It ran longer than 2000 ms and was stopped.',
    );
    expect((await toolbox.run(call('invoice_total', {}))).error).toBe(
      'invoice_total needs these arguments: invoice_id.',
    );
    expect(runTool).toHaveBeenCalledTimes(2);
  });

  it('refuses a harness tool that shadows a built-in', async () => {
    job = makeJobDir();
    const files = await openAgentFiles({
      dataDir: job.dataDir,
      files: SAMPLE_FILES,
      mode: 'scratch',
    });
    const harness = makeHarness({
      tools: [
        {
          name: 'grep',
          description: 'x',
          parameters: { type: 'object' },
          code: 'function run() {}',
        },
      ],
    });
    expect(() => createToolbox({ harness, files, sandbox, today: '2026-11-03' })).toThrow(
      /name of a built-in tool/,
    );
  });
});
