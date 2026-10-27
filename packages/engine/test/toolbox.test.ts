import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { DataFile, JsonValue, ToolCall } from '@architect/shared';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { openTableStore, type TableStore } from '../src/data/table-store';
import type { Sandbox } from '../src/sandbox/types';
import type { ApproveWrite } from '../src/tools/builtins';
import { createToolbox, type Toolbox } from '../src/tools/toolbox';
import { makeHarness, makeJobDir, SAMPLE_FILES, type TempJob } from './support/fixtures';

let job: TempJob | undefined;
afterEach(() => job?.remove());

const unusedSandbox: Sandbox = {
  runTool: () => Promise.reject(new Error('not expected')),
  runValidator: () => Promise.reject(new Error('not expected')),
  checkTool: () => Promise.reject(new Error('not expected')),
  dispose: async () => undefined,
};

async function setup(
  options: {
    mode?: 'scratch' | 'live';
    files?: DataFile[];
    approveWrite?: ApproveWrite;
    sandbox?: Sandbox;
    harness?: Parameters<typeof makeHarness>[0];
    resultBudget?: number;
  } = {},
): Promise<{ store: TableStore; toolbox: Toolbox }> {
  job = makeJobDir();
  const store = await openTableStore({
    dataDir: job.dataDir,
    files: options.files ?? SAMPLE_FILES,
    mode: options.mode ?? 'scratch',
  });
  const toolbox = createToolbox({
    harness: makeHarness(options.harness),
    store,
    sandbox: options.sandbox ?? unusedSandbox,
    approveWrite: options.approveWrite,
    resultBudget: options.resultBudget,
  });
  return { store, toolbox };
}

let callNumber = 0;
const call = (name: string, args: Record<string, JsonValue> = {}): ToolCall => ({
  id: `call_${callNumber++}`,
  name,
  arguments: args,
});

const skill = {
  slug: 'price-a-job',
  name: 'Price a completed job',
  summary: 'Turn a job into invoice lines.',
  body: '1. Read the job.\n2. Price it.',
};

describe('toolbox', () => {
  it('offers write tools only when a table is writable, and load_skill only when there are skills', async () => {
    const { toolbox } = await setup();
    expect(toolbox.specs.map((spec) => spec.name)).toEqual([
      'list_files',
      'read_table',
      'read_text',
      'calculate',
      'append_rows',
      'update_rows',
    ]);
    const readOnly = await setup({
      files: SAMPLE_FILES.map((file) => ({ ...file, access: 'read' as const })),
      harness: {
        skills: [skill],
        tools: [
          {
            name: 'invoice_total',
            description: 'Total an invoice.',
            parameters: { type: 'object' },
            code: 'function run() {}',
          },
        ],
      },
    });
    expect(readOnly.toolbox.specs.map((spec) => spec.name)).toEqual([
      'list_files',
      'read_table',
      'read_text',
      'calculate',
      'load_skill',
      'invoice_total',
    ]);
  });

  it('reads tables as compact rows, with a note on how to read more', async () => {
    const { toolbox } = await setup();
    const outcome = await toolbox.run(
      call('read_table', { file: 'invoices.csv', limit: 2, columns: ['invoice_id', 'paid'] }),
    );
    expect(outcome.result).toEqual({
      file: 'invoices.csv',
      columns: ['invoice_id', 'paid'],
      rows: [
        ['INV-1', 'true'],
        ['INV-2', null],
      ],
      total: 3,
      truncated: true,
      note: 'Rows 1 to 2 of 3 are shown. Read again with offset 2 for more.',
    });
    expect(JSON.parse(outcome.content)).toEqual(outcome.result);
  });

  it('keeps table results within the budget', async () => {
    const { toolbox } = await setup({ resultBudget: 1000 });
    const rows = Array.from({ length: 40 }, (_, i) => ({
      invoice_id: `INV-${100 + i}`,
      customer_id: 'C-1',
      total_cents: '1',
    }));
    await toolbox.run(call('append_rows', { file: 'invoices.csv', rows }));
    const outcome = await toolbox.run(call('read_table', { file: 'invoices.csv', limit: 200 }));
    expect(outcome.content.length).toBeLessThanOrEqual(1000);
    const result = outcome.result as {
      rows: unknown[];
      total: number;
      truncated: boolean;
      note: string;
    };
    expect(result.total).toBe(43);
    expect(result.truncated).toBe(true);
    expect(result.note).toMatch(
      new RegExp(`Rows 1 to ${result.rows.length} of 43 are shown to stay within the size limit`),
    );
  });

  it('reads long text in parts that end at a line break', async () => {
    job = makeJobDir({
      'policy.md': Array.from(
        { length: 80 },
        (_, i) => `Rule ${i}: invoices are due in 30 days.`,
      ).join('\n'),
    });
    const store = await openTableStore({
      dataDir: job.dataDir,
      files: [{ name: 'policy.md', kind: 'text', access: 'read' }],
      mode: 'scratch',
    });
    const toolbox = createToolbox({
      harness: makeHarness(),
      store,
      sandbox: unusedSandbox,
      resultBudget: 1000,
    });
    const first = (await toolbox.run(call('read_text', { file: 'policy.md' }))).result as {
      text: string;
      next_offset: number;
      total_chars: number;
    };
    expect(first.text.endsWith('\n')).toBe(true);
    const second = (
      await toolbox.run(call('read_text', { file: 'policy.md', offset: first.next_offset }))
    ).result as {
      text: string;
    };
    expect(second.text.startsWith('Rule')).toBe(true);
    expect(first.total_chars).toBe(store.readText('policy.md').length);
  });

  it('calculates', async () => {
    const { toolbox } = await setup();
    expect(
      (await toolbox.run(call('calculate', { expression: 'round(1.005, 2)' }))).result,
    ).toEqual({ result: 1.01 });
  });

  it('turns mistakes into errors the model can read', async () => {
    const { toolbox } = await setup();
    const error = async (name: string, args: Record<string, JsonValue>) => {
      const outcome = await toolbox.run(call(name, args));
      expect(outcome.result).toBeNull();
      expect(JSON.parse(outcome.content)).toEqual({ error: outcome.error });
      return outcome.error;
    };
    expect(await error('read_tables', {})).toBe(
      'There is no tool called "read_tables". The tools are: list_files, read_table, read_text, calculate, append_rows, update_rows.',
    );
    expect(await error('read_table', { file: 'invoices.csv', filter: 'x' })).toBe(
      'Invalid arguments for read_table. Unrecognized key: "filter".',
    );
    expect(await error('read_table', {})).toMatch(/^Invalid arguments for read_table\. file: /);
    expect(await error('read_table', { file: 'payroll.csv' })).toMatch(
      /is not one of this job's data files/,
    );
    expect(
      await error('append_rows', { file: 'customers.csv', rows: [{ customer_id: 'C-9' }] }),
    ).toMatch(/customers.csv is read-only/);
    expect(await error('calculate', { expression: '1 / 0' })).toBe(
      'Division by zero at position 3.',
    );
    expect(await error('load_skill', { name: 'x' })).toMatch(
      /There is no tool called "load_skill"/,
    );
  });

  it('accepts a single where condition in place of a list', async () => {
    const { toolbox } = await setup();
    const outcome = await toolbox.run(
      call('read_table', {
        file: 'invoices.csv',
        where: { column: 'invoice_id', op: '=', value: 'INV-2' },
      }),
    );
    expect((outcome.result as { total: number }).total).toBe(1);
  });

  it('applies writes to the scratch store in task mode', async () => {
    const { store, toolbox } = await setup();
    const append = await toolbox.run(
      call('append_rows', {
        file: 'invoices.csv',
        rows: [{ invoice_id: 'INV-4', total_cents: 700 }],
      }),
    );
    expect(append.result).toEqual({ file: 'invoices.csv', appended: 1 });
    const update = await toolbox.run(
      call('update_rows', {
        file: 'invoices.csv',
        where: [{ column: 'invoice_id', op: '=', value: 'INV-9' }],
        set: { paid: 'true' },
      }),
    );
    expect(update.result).toEqual({
      file: 'invoices.csv',
      matched: 0,
      changed: 0,
      note: 'No rows in invoices.csv match.',
    });
    expect(store.pendingChanges()[0]?.diff.added).toEqual([['INV-4', null, '700', null, null]]);
  });

  it('asks before writing in chat mode and saves an approved write to a live store', async () => {
    const approveWrite = vi.fn<ApproveWrite>(async () => 'approve');
    const { store, toolbox } = await setup({ mode: 'live', approveWrite });
    const outcome = await toolbox.run(
      call('update_rows', {
        file: 'invoices.csv',
        where: [{ column: 'invoice_id', op: '=', value: 'INV-2' }],
        set: { paid: true },
      }),
    );
    expect(outcome.result).toEqual({ file: 'invoices.csv', matched: 1, changed: 1 });
    expect(approveWrite).toHaveBeenCalledWith(
      {
        tool: 'update_rows',
        file: 'invoices.csv',
        summary: 'Update 1 row in invoices.csv',
        diff: {
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
      },
      undefined,
    );
    expect(store.pendingChanges()).toEqual([]);
    expect(readFileSync(join(job?.dataDir ?? '', 'invoices.csv'), 'utf8')).toContain(
      'INV-2,C-2,4550,2026-11-15,true',
    );
  });

  it('reports a declined write without changing anything', async () => {
    const { store, toolbox } = await setup({ mode: 'live', approveWrite: async () => 'deny' });
    const outcome = await toolbox.run(
      call('append_rows', { file: 'invoices.csv', rows: [{ invoice_id: 'INV-4' }] }),
    );
    expect(outcome.result).toEqual({
      file: 'invoices.csv',
      declined: true,
      message:
        'The user declined this change, so nothing was written: Append 1 row to invoices.csv.',
    });
    expect(store.read('invoices.csv').total).toBe(3);
    expect(readFileSync(join(job?.dataDir ?? '', 'invoices.csv'), 'utf8')).not.toContain('INV-4');
  });

  it('stops waiting for approval when the run is aborted', async () => {
    const { store, toolbox } = await setup({ approveWrite: () => new Promise(() => undefined) });
    const controller = new AbortController();
    const pending = toolbox.run(
      call('append_rows', { file: 'invoices.csv', rows: [{ invoice_id: 'INV-4' }] }),
      controller.signal,
    );
    controller.abort();
    await expect(pending).rejects.toThrow(/abort/i);
    expect(store.pendingChanges()).toEqual([]);
  });

  it('loads a skill by slug or by name', async () => {
    const { toolbox } = await setup({ harness: { skills: [skill] } });
    const bySlug = await toolbox.run(call('load_skill', { name: 'price-a-job' }));
    expect(bySlug).toMatchObject({
      loadedSkill: 'price-a-job',
      result: { slug: 'price-a-job', body: skill.body },
    });
    expect(
      (await toolbox.run(call('load_skill', { name: ' price a completed JOB ' }))).loadedSkill,
    ).toBe('price-a-job');
    expect((await toolbox.run(call('load_skill', { name: 'invoices' }))).error).toBe(
      'There is no skill called "invoices". The skills are: price-a-job (Price a completed job).',
    );
  });

  it('runs harness tools in the sandbox with the current data and reports their failures', async () => {
    const runTool = vi.fn<Sandbox['runTool']>();
    runTool.mockResolvedValueOnce({ ok: true, value: { total_cents: 5540 } });
    runTool.mockResolvedValueOnce({
      ok: false,
      failure: { kind: 'timeout', message: 'It ran longer than 2000 ms and was stopped.' },
    });
    const { store, toolbox } = await setup({
      sandbox: { ...unusedSandbox, runTool },
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
    store.append('invoices.csv', [{ invoice_id: 'INV-4' }]);
    expect((await toolbox.run(call('invoice_total', { invoice_id: 'INV-1' }))).result).toEqual({
      total_cents: 5540,
    });
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
    const store = await openTableStore({
      dataDir: job.dataDir,
      files: SAMPLE_FILES,
      mode: 'scratch',
    });
    const harness = makeHarness({
      tools: [
        {
          name: 'read_table',
          description: 'x',
          parameters: { type: 'object' },
          code: 'function run() {}',
        },
      ],
    });
    expect(() => createToolbox({ harness, store, sandbox: unusedSandbox })).toThrow(
      /name of a built-in tool/,
    );
  });
});
