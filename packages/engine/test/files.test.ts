import { createHash } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { GuardError, type DataFile } from '@architect/shared';
import { afterEach, describe, expect, it } from 'vitest';
import { DataError } from '../src/data/errors';
import { openAgentFiles, type AgentFiles, type OutputFolder } from '../src/files/agent-files';
import { globMatcher } from '../src/files/glob';
import { agentPath } from '../src/files/paths';
import { makeJobDir, SAMPLE_CONTENT, SAMPLE_FILES, type TempJob } from './support/fixtures';

let job: TempJob | undefined;
afterEach(() => job?.remove());

const SKILL = '---\nname: price-a-job\ndescription: Price a job.\n---\n1. Read the job.\n';

async function open(
  options: {
    mode?: 'scratch' | 'live';
    content?: Record<string, string>;
    files?: DataFile[];
    output?: OutputFolder;
  } = {},
): Promise<AgentFiles> {
  job = makeJobDir(options.content ?? SAMPLE_CONTENT);
  return openAgentFiles({
    dataDir: job.dataDir,
    files: options.files ?? SAMPLE_FILES,
    skills: { 'skills/price-a-job/SKILL.md': SKILL },
    mode: options.mode ?? 'scratch',
    ...(options.output === undefined ? {} : { output: options.output }),
  });
}

function guardOf(fn: () => unknown): GuardError {
  try {
    fn();
  } catch (error) {
    if (error instanceof GuardError) return error;
    throw error;
  }
  throw new Error('expected a GuardError');
}

describe('paths in the agent folder', () => {
  it('are logical paths with forward slashes', () => {
    expect(agentPath('data/orders.csv')).toBe('data/orders.csv');
    expect(agentPath('./data//orders.csv')).toBe('data/orders.csv');
    expect(agentPath('/data/orders.csv')).toBe('data/orders.csv');
    expect(agentPath('data\\orders.csv')).toBe('data/orders.csv');
    expect(agentPath(' data/ ')).toBe('data');
    expect(agentPath('')).toBe('');
    expect(agentPath('.')).toBe('');
  });

  it.each([
    '../vault/test.jsonl',
    'data/../../job.json',
    'data\\..\\..\\job.json',
    'C:\\Users\\dana\\secrets.txt',
    'c:data/x.csv',
    '//server/share/x',
    '\\\\server\\share\\x',
    'data/x.csv\0.txt',
  ])('refuse %j instead of correcting it', (raw) => {
    expect(guardOf(() => agentPath(raw)).guard).toBe('permission');
  });
});

describe('glob patterns', () => {
  const paths = ['data/orders.csv', 'data/policy.md', 'output/q3/report.md', 'skills/a/SKILL.md'];
  const match = (pattern: string) => paths.filter(globMatcher(pattern));

  it('match within a name, across folders, and by name alone without a slash', () => {
    expect(match('data/*.csv')).toEqual(['data/orders.csv']);
    expect(match('**/*.md')).toEqual([
      'data/policy.md',
      'output/q3/report.md',
      'skills/a/SKILL.md',
    ]);
    expect(match('*.md')).toEqual(['data/policy.md', 'output/q3/report.md', 'skills/a/SKILL.md']);
    expect(match('output/**')).toEqual(['output/q3/report.md']);
    expect(match('data/{orders,policy}.*')).toEqual(['data/orders.csv', 'data/policy.md']);
    expect(match('data/[op]*.csv')).toEqual(['data/orders.csv']);
    expect(match('data/?????s.csv')).toEqual(['data/orders.csv']);
    expect(match('/data/*.csv')).toEqual(['data/orders.csv']);
    expect(match('data/(*.csv')).toEqual([]);
    expect(match('**/report.md')).toEqual(['output/q3/report.md']);
    expect(match('output/**/*.md')).toEqual(['output/q3/report.md']);
    expect(match('data/[!o]*')).toEqual(['data/policy.md']);
    expect(match('*.{csv,md}')).toEqual(paths);
  });

  it('turn a pattern they cannot read into an error the agent sees', () => {
    expect(() => globMatcher('data/[z-a].csv')).toThrow(DataError);
    expect(() => globMatcher('data/[z-a].csv')).toThrow(
      '[z-a] has a range that runs backwards, z-a.',
    );
    expect(() => globMatcher('{a,b}{c,d}{e,f}{g,h}{i,j}{k,l}{m,n}')).toThrow(/more than 64 paths/);
  });

  it('stay quick on a pattern that would make a regular expression backtrack', () => {
    const started = performance.now();
    const name = `data/${'a'.repeat(200)}`;
    expect(globMatcher('*a*a*a*a*a*a*a*a*a*a*a*a*.csv')(name)).toBe(false);
    expect(globMatcher('**/**/**/**/**/**/x')(name)).toBe(false);
    expect(performance.now() - started).toBeLessThan(500);
  });
});

describe('opening the agent folder', () => {
  it('lists the data files, the skills and nothing undeclared, in path order', async () => {
    const files = await open({ content: { ...SAMPLE_CONTENT, 'secret.csv': 'a\n1\n' } });
    expect(files.list()).toEqual([
      {
        path: 'data/customers.csv',
        area: 'data',
        kind: 'table',
        writable: false,
        description: 'Customers and their payment terms.',
        lines: 4,
      },
      {
        path: 'data/invoices.csv',
        area: 'data',
        kind: 'table',
        writable: true,
        description: 'Issued invoices, one row each.',
        lines: 4,
      },
      {
        path: 'data/policy.md',
        area: 'data',
        kind: 'text',
        writable: false,
        description: 'Pricing and payment rules.',
        lines: 4,
      },
      {
        path: 'skills/price-a-job/SKILL.md',
        area: 'skills',
        kind: 'text',
        writable: false,
        lines: 5,
      },
    ]);
    expect(files.writable).toBe(true);
    expect(files.hasOutput).toBe(false);
    expect(() => files.read('data/secret.csv')).toThrow(DataError);
  });

  it('reads a file as text with LF line breaks, and says what is there when nothing is', async () => {
    const files = await open({
      content: { ...SAMPLE_CONTENT, 'policy.md': '\uFEFFLine one\r\nLine two\r\n' },
    });
    expect(files.read('data/policy.md')).toBe('Line one\nLine two\n');
    expect(() => files.read('data/nope.csv')).toThrow(
      'There is no data/nope.csv. In data/ there are: customers.csv, invoices.csv, policy.md.',
    );
    expect(() => files.read('nope')).toThrow('There is no nope. Your folders are data/, skills/.');
    expect(() => files.read('data')).toThrow('data is a folder. List it with ls data.');
  });

  it('rejects a malformed or missing data file with a clear message', async () => {
    const files: DataFile[] = [{ name: 'bad.csv', kind: 'table', access: 'read' }];
    await expect(open({ files, content: { 'bad.csv': 'a,b\n1,2\n3\n' } })).rejects.toThrow(
      'data/bad.csv: data row 2 has 1 values but the header has 2 columns.',
    );
    job?.remove();
    await expect(open({ files, content: { 'bad.csv': 'a,a\n1,2\n' } })).rejects.toThrow(
      'data/bad.csv has two columns named "a".',
    );
    job?.remove();
    await expect(open({ files, content: {} })).rejects.toThrow(
      'bad.csv is declared in the job but missing from its data folder.',
    );
  });

  it('refuses a data file that is a link', async (context) => {
    job = makeJobDir(SAMPLE_CONTENT);
    const outside = join(job.dir, 'outside.md');
    writeFileSync(outside, 'secret');
    const files: DataFile[] = [{ name: 'linked.md', kind: 'text', access: 'read' }];
    try {
      symlinkSync(outside, join(job.dataDir, 'linked.md'));
    } catch {
      context.skip('this system does not allow creating symbolic links');
    }
    await expect(openAgentFiles({ dataDir: job.dataDir, files, mode: 'scratch' })).rejects.toThrow(
      "linked.md in the job's data folder is not a plain file, so it isn't read.",
    );
  });

  it('hashes each data file as its bytes would be on disk, now', async () => {
    const files = await open({
      content: { ...SAMPLE_CONTENT, 'policy.md': '﻿Line one\r\nLine two\r\n' },
    });
    const sha = (text: string) => `sha256-${createHash('sha256').update(text).digest('hex')}`;
    const hashes = files.dataHashes();
    expect(hashes).toEqual({
      'data/customers.csv': sha(SAMPLE_CONTENT['customers.csv'] ?? ''),
      'data/invoices.csv': sha(SAMPLE_CONTENT['invoices.csv'] ?? ''),
      'data/policy.md': sha('﻿Line one\r\nLine two\r\n'),
    });
    const text = files.read('data/invoices.csv');
    await files.apply(
      files.plan('append', 'data/invoices.csv', `${text}INV-4,C-2,1,2026-12-01,\n`),
    );
    expect(files.dataHashes()['data/invoices.csv']).not.toBe(hashes['data/invoices.csv']);
    expect(files.dataHashes()['data/policy.md']).toBe(hashes['data/policy.md']);
  });
});

describe('changing files', () => {
  it('diffs a change to a table by rows and by text, and applies it only when asked', async () => {
    const files = await open();
    const before = files.read('data/invoices.csv');
    const next = `${before.replace('INV-3,C-1,990,2026-11-02,false', 'INV-3,C-1,990,2026-11-02,true')}INV-4,C-2,100,2026-12-01,\n`;
    const plan = files.plan('write', 'data/invoices.csv', next);
    expect(plan).toMatchObject({
      path: 'data/invoices.csv',
      op: 'write',
      summary: 'Update data/invoices.csv: 1 row added, 1 row changed',
      done: 'Updated data/invoices.csv: 1 row added, 1 row changed.',
      changes: true,
    });
    expect(plan.rows).toEqual({
      columns: ['invoice_id', 'customer_id', 'total_cents', 'due_date', 'paid'],
      added: [['INV-4', 'C-2', '100', '2026-12-01', null]],
      removed: [],
      changed: [
        {
          before: ['INV-3', 'C-1', '990', '2026-11-02', 'false'],
          after: ['INV-3', 'C-1', '990', '2026-11-02', 'true'],
        },
      ],
    });
    expect(plan.patch).toContain('--- a/data/invoices.csv\n+++ b/data/invoices.csv\n');
    expect(plan.patch).toContain('+INV-4,C-2,100,2026-12-01,');
    expect(files.read('data/invoices.csv')).toBe(before);
    await files.apply(plan);
    expect(files.read('data/invoices.csv')).toBe(next);
  });

  it('names a change by what it does to the rows or the lines', async () => {
    const files = await open({ output: {} });
    const invoices = files.read('data/invoices.csv');
    expect(
      files.plan('append', 'data/invoices.csv', `${invoices}INV-9,C-1,1,2026-12-01,\n`).summary,
    ).toBe('Add 1 row to data/invoices.csv');
    expect(
      files.plan('edit', 'data/invoices.csv', invoices.replace('12000', '12500')).summary,
    ).toBe('Change 1 row in data/invoices.csv');
    expect(
      files.plan('edit', 'data/invoices.csv', invoices.replace('INV-2,C-2,4550,2026-11-15,\n', ''))
        .summary,
    ).toBe('Remove 1 row from data/invoices.csv');
    expect(files.plan('write', 'data/invoices.csv', invoices)).toMatchObject({
      changes: false,
      done: 'data/invoices.csv already has this text, so nothing changed.',
    });
    expect(files.plan('write', 'output/notes.md', 'One\nTwo\n')).toMatchObject({
      summary: 'Create output/notes.md (2 lines)',
      done: 'Created output/notes.md (2 lines).',
    });
  });

  it('keeps every table valid CSV with its header line', async () => {
    const files = await open();
    const text = files.read('data/invoices.csv');
    expect(() => files.plan('write', 'data/invoices.csv', 'id,total\nINV-1,5\n')).toThrow(
      'Nothing was changed: data/invoices.csv has to keep its header line, invoice_id,customer_id,total_cents,due_date,paid, as its first line.',
    );
    expect(() => files.plan('append', 'data/invoices.csv', `${text}INV-4,C-2\n`)).toThrow(
      'Nothing was changed: data/invoices.csv: data row 4 has 2 values but the header has 5 columns.',
    );
    expect(files.read('data/invoices.csv')).toBe(text);
  });

  it('refuses read-only files, the skills and new files outside output/', async () => {
    const files = await open();
    expect(guardOf(() => files.plan('write', 'data/customers.csv', 'x')).message).toBe(
      'data/customers.csv is read-only for this job. Only data/invoices.csv can be changed.',
    );
    expect(guardOf(() => files.plan('write', 'skills/price-a-job/SKILL.md', 'x')).message).toBe(
      "skills/price-a-job/SKILL.md is read-only: skills can't be changed.",
    );
    expect(guardOf(() => files.plan('write', 'data/new.csv', 'a\n')).message).toBe(
      "There is no data/new.csv, and data/ holds only the job's own files.",
    );
    expect(guardOf(() => files.plan('write', 'output/report.md', 'x')).message).toBe(
      "This job has no folder for new files, so output/report.md can't be created.",
    );
    expect(guardOf(() => files.plan('write', '../../escape.md', 'x')).guard).toBe('permission');
  });

  it('has nothing it can change when no data file is writable and there is no output/, so no write is ever asked about', async () => {
    // The desktop offers the saving setting only where the agent can change something: a writable
    // data file, or the output folder. Every write is planned before it is put to the person, and
    // a plan for anything else is refused, so with neither there is nothing the setting could ask.
    const readOnly = SAMPLE_FILES.map((file): DataFile => ({ ...file, access: 'read' }));
    const files = await open({ files: readOnly });
    expect(files.writable).toBe(false);
    expect(files.hasOutput).toBe(false);
    expect(files.list().some((file) => file.writable)).toBe(false);
    for (const path of [
      'data/customers.csv',
      'data/invoices.csv',
      'data/new.csv',
      'output/report.md',
      'report.md',
      'skills/price-a-job/SKILL.md',
    ]) {
      expect(guardOf(() => files.plan('write', path, 'x')).guard, path).toBe('permission');
    }
    // One writable file, or the output folder alone, is enough for the setting to matter.
    expect((await open()).writable).toBe(true);
    expect((await open({ files: readOnly, output: { description: 'Reports.' } })).writable).toBe(
      true,
    );
  });

  it('creates files in output/ when the job has it, with safe names only', async () => {
    const files = await open({ output: { description: 'Reports.' } });
    expect(files.hasOutput).toBe(true);
    expect(guardOf(() => files.plan('write', 'data/new.csv', 'a\n')).message).toBe(
      "There is no data/new.csv, and data/ holds only the job's own files. New files go in output/.",
    );
    expect(guardOf(() => files.plan('write', 'report.md', 'x')).message).toBe(
      'New files go in output/, like output/report.md.',
    );
    expect(() => files.plan('write', 'output/con.txt', 'x')).toThrow(
      'output/con.txt can\'t be created: "con.txt" is a name Windows keeps for devices.',
    );
    expect(() => files.plan('write', 'output/notes.', 'x')).toThrow(
      /can't be a file or folder name/,
    );
    await files.apply(files.plan('write', 'output/q3/report.md', '# Q3\n'));
    expect(files.read('output/q3/report.md')).toBe('# Q3\n');
    expect(files.isFolder('output/q3')).toBe(true);
    expect(() => files.plan('write', 'output/q3/report.md/x', 'x')).toThrow(
      'output/q3/report.md is a file, not a folder.',
    );
  });

  it('rejects a plan made stale by another change, and one from other files', async () => {
    const files = await open();
    const text = files.read('data/invoices.csv');
    const first = files.plan('append', 'data/invoices.csv', `${text}INV-4,C-2,1,2026-12-01,\n`);
    const second = files.plan('append', 'data/invoices.csv', `${text}INV-5,C-2,1,2026-12-01,\n`);
    await files.apply(first);
    await expect(files.apply(second)).rejects.toThrow(
      'data/invoices.csv changed after this change was planned. Make it again.',
    );
    const others = await openAgentFiles({
      dataDir: job?.dataDir ?? '',
      files: SAMPLE_FILES,
      mode: 'scratch',
    });
    await expect(others.apply(second)).rejects.toThrow('planned by different files');
  });

  it('keeps a scratch copy in memory, apart from disk and from other copies', async () => {
    const files = await open({ output: {} });
    const text = files.read('data/invoices.csv');
    await files.apply(
      files.plan('append', 'data/invoices.csv', `${text}INV-4,C-2,1,2026-12-01,\n`),
    );
    await files.apply(files.plan('write', 'output/a.md', 'A\n'));
    expect(readFileSync(join(job?.dataDir ?? '', 'invoices.csv'), 'utf8')).toBe(
      SAMPLE_CONTENT['invoices.csv'],
    );
    expect(existsSync(join(job?.dataDir ?? '', 'output'))).toBe(false);
    const fresh = await openAgentFiles({
      dataDir: job?.dataDir ?? '',
      files: SAMPLE_FILES,
      mode: 'scratch',
    });
    expect(fresh.read('data/invoices.csv')).toBe(text);
  });

  it('saves a live change at once, keeping line endings and the byte-order mark', async () => {
    const files = await open({
      mode: 'live',
      content: {
        ...SAMPLE_CONTENT,
        'invoices.csv': '\uFEFFinvoice_id,total_cents\r\nINV-1,100\r\n',
      },
      files: [
        { name: 'invoices.csv', kind: 'table', access: 'write' },
        { name: 'policy.md', kind: 'text', access: 'read' },
      ],
    });
    const text = files.read('data/invoices.csv');
    expect(text).toBe('invoice_id,total_cents\nINV-1,100\n');
    await files.apply(
      files.plan('edit', 'data/invoices.csv', `${text.replace('100', '120')}INV-2,250\n`),
    );
    expect(readFileSync(join(job?.dataDir ?? '', 'invoices.csv'), 'utf8')).toBe(
      '\uFEFFinvoice_id,total_cents\r\nINV-1,120\r\nINV-2,250\r\n',
    );
    expect(readdirSync(job?.dataDir ?? '').filter((name) => name.endsWith('.tmp'))).toEqual([]);
  });

  it('reads and saves a live output folder on disk', async () => {
    job = makeJobDir(SAMPLE_CONTENT);
    const dir = join(job.dir, 'output');
    mkdirSync(join(dir, 'old'), { recursive: true });
    writeFileSync(join(dir, 'old', 'summary.md'), 'Earlier.\n');
    const files = await openAgentFiles({
      dataDir: job.dataDir,
      files: SAMPLE_FILES,
      output: { dir },
      mode: 'live',
    });
    expect(files.read('output/old/summary.md')).toBe('Earlier.\n');
    await files.apply(files.plan('write', 'output/new/report.md', '# Report\n'));
    expect(readFileSync(join(dir, 'new', 'report.md'), 'utf8')).toBe('# Report\n');
  });

  it('never replaces a live output file it did not open, or writes through a link', async () => {
    job = makeJobDir(SAMPLE_CONTENT);
    const dir = join(job.dir, 'output');
    const outside = join(job.dir, 'outside');
    mkdirSync(dir, { recursive: true });
    mkdirSync(outside);
    writeFileSync(join(dir, 'big.log'), 'x'.repeat(1024 * 1024 + 1));
    writeFileSync(join(dir, 'report.md'), 'Kept.\n');
    symlinkSync(outside, join(dir, 'elsewhere'), 'junction');
    const files = await openAgentFiles({
      dataDir: job.dataDir,
      files: SAMPLE_FILES,
      output: { dir },
      mode: 'live',
    });
    expect(files.file('output/big.log')).toBeUndefined();
    expect(() => files.plan('write', 'output/big.log', 'small\n')).toThrow(
      "output/big.log is already on this computer but wasn't opened here, so it isn't replaced.",
    );
    expect(() => files.plan('write', 'output/elsewhere/secret.txt', 'x\n')).toThrow(
      'output/elsewhere is a link on this computer, so nothing is written through it.',
    );
    expect(() => files.plan('write', 'output/REPORT.md', 'Other.\n')).toThrow(
      'output/report.md is already there, and on many computers a name that differs only in capitals is the same file.',
    );
    expect(readFileSync(join(dir, 'report.md'), 'utf8')).toBe('Kept.\n');
    expect(readdirSync(outside)).toEqual([]);
  });

  it('shows a change too large to diff as the whole file rewritten, without holding up', async () => {
    const header = 'id,amount\n';
    const rows = Array.from({ length: 6000 }, (_, i) => `R-${i},${i}\n`).join('');
    const files = await open({
      content: { ...SAMPLE_CONTENT, 'big.csv': `${header}${rows}` },
      files: [{ name: 'big.csv', kind: 'table', access: 'write' }],
    });
    const started = performance.now();
    const rewritten = `${header}${rows.replace(/,(\d+)\n/g, ',$1.00\n')}`;
    const plan = files.plan('edit', 'data/big.csv', rewritten);
    expect(performance.now() - started).toBeLessThan(4000);
    expect(plan.rows).toBeUndefined();
    expect(plan.summary).toBe('Rewrite data/big.csv (6,001 lines)');
    expect(plan.patch).toBe(
      '--- a/data/big.csv\n+++ b/data/big.csv\n@@ -1,6001 +1,6001 @@ the whole file was replaced\n',
    );
  });

  it('counts the lines a change adds and removes, whatever the text looks like', async () => {
    const files = await open({
      content: { ...SAMPLE_CONTENT, 'notes.md': 'One\n---\nTwo' },
      files: [{ name: 'notes.md', kind: 'text', access: 'write' }],
    });
    expect(files.plan('append', 'data/notes.md', 'One\n---\nTwo\nThree\n').summary).toBe(
      'Add 1 line to data/notes.md',
    );
    expect(files.plan('edit', 'data/notes.md', 'One\nTwo').summary).toBe(
      'Change data/notes.md: 0 lines added, 1 removed',
    );
  });

  it('compares a table header column by column', async () => {
    const files = await open({
      content: { ...SAMPLE_CONTENT, 'names.csv': '"Last, First",id\n"Doe, Jo",1\n' },
      files: [{ name: 'names.csv', kind: 'table', access: 'write' }],
    });
    expect(() => files.plan('write', 'data/names.csv', 'Last," First",id\nDoe," Jo",1\n')).toThrow(
      /has to keep its header line/,
    );
  });

  it('hashes a data file with mixed line breaks as its exact bytes', async () => {
    const mixed = 'a,b\r\n1,2\n3,4\r\n';
    const files = await open({
      content: { ...SAMPLE_CONTENT, 'mixed.csv': mixed },
      files: [{ name: 'mixed.csv', kind: 'table', access: 'read' }],
    });
    expect(files.dataHashes()['data/mixed.csv']).toBe(
      `sha256-${createHash('sha256').update(mixed).digest('hex')}`,
    );
  });

  it('diffs every file changed since an earlier point, new files included', async () => {
    const files = await open({ output: {} });
    const start = files.texts();
    const text = files.read('data/invoices.csv');
    await files.apply(
      files.plan('append', 'data/invoices.csv', `${text}INV-4,C-2,1,2026-12-01,\n`),
    );
    await files.apply(files.plan('write', 'output/a.md', 'A\n'));
    const changes = files.changesSince(start);
    expect(changes.map((change) => change.path)).toEqual(['data/invoices.csv', 'output/a.md']);
    expect(changes[0]?.rows?.added).toEqual([['INV-4', 'C-2', '1', '2026-12-01', null]]);
    expect(changes[1]?.patch).toContain('--- /dev/null\n+++ b/output/a.md');
    expect(files.changesSince(files.texts())).toEqual([]);
  });
});

describe('what a checker and a harness tool see', () => {
  it('gives the tables as they are and as they were, by data file name', async () => {
    const files = await open();
    const text = files.read('data/invoices.csv');
    await files.apply(
      files.plan('append', 'data/invoices.csv', `${text}INV-4,C-2,1,2026-12-01,\n`),
    );
    expect(Object.keys(files.tables())).toEqual(['customers.csv', 'invoices.csv']);
    expect(files.tables()['invoices.csv']?.rows).toHaveLength(4);
    expect(files.originalTables()['invoices.csv']?.rows).toHaveLength(3);
    expect(files.tables()['customers.csv']?.rows[1]).toEqual({
      customer_id: 'C-2',
      name: 'Ruiz, Ben',
      city: 'Lowell',
      terms_days: '15',
    });
    expect(files.tables()['customers.csv']?.rows[2]?.city).toBeNull();
  });

  it('gives harness tools the data files by name, with their shape', async () => {
    const files = await open();
    const data = files.sandboxData();
    expect(data.files.map((file) => [file.name, file.access, file.rows])).toEqual([
      ['customers.csv', 'read', 3],
      ['invoices.csv', 'write', 3],
      ['policy.md', 'read', undefined],
    ]);
    expect(Object.keys(data.tables)).toEqual(['customers.csv', 'invoices.csv']);
    expect(data.texts['policy.md']).toContain('Tax is 8.25%');
  });
});
