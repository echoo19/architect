import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { GuardError, type DataFile } from '@architect/shared';
import { afterEach, describe, expect, it } from 'vitest';
import { DataError } from '../src/data/errors';
import { openTableStore, type TableStore } from '../src/data/table-store';
import { makeJobDir, SAMPLE_FILES, type TempJob } from './support/fixtures';

let job: TempJob | undefined;
afterEach(() => job?.remove());

async function open(
  mode: 'scratch' | 'live' = 'scratch',
  content?: Record<string, string>,
): Promise<TableStore> {
  job = makeJobDir(content);
  return openTableStore({ dataDir: job.dataDir, files: SAMPLE_FILES, mode });
}

const ids = (store: TableStore, where: Parameters<TableStore['read']>[1]) =>
  store.read('invoices.csv', where).rows.map((row) => row.invoice_id);

describe('TableStore reads', () => {
  it('lists the declared files with their shape', async () => {
    const store = await open();
    expect(store.listFiles()).toEqual([
      {
        name: 'customers.csv',
        kind: 'table',
        access: 'read',
        description: 'Customers and their payment terms.',
        rows: 3,
        columns: ['customer_id', 'name', 'city', 'terms_days'],
      },
      {
        name: 'invoices.csv',
        kind: 'table',
        access: 'write',
        description: 'Issued invoices, one row each.',
        rows: 3,
        columns: ['invoice_id', 'customer_id', 'total_cents', 'due_date', 'paid'],
      },
      {
        name: 'policy.md',
        kind: 'text',
        access: 'read',
        description: 'Pricing and payment rules.',
      },
    ]);
  });

  it('keeps every cell as text and turns empty cells into null', async () => {
    const store = await open();
    const { rows } = store.read('customers.csv');
    expect(rows[1]).toEqual({
      customer_id: 'C-2',
      name: 'Ruiz, Ben',
      city: 'Lowell',
      terms_days: '15',
    });
    expect(rows[2]?.city).toBeNull();
    expect(store.readText('policy.md')).toContain('due 30 days');
  });

  it('filters with every operator, numerically when both sides are numbers', async () => {
    const store = await open();
    expect(ids(store, { where: [{ column: 'total_cents', op: '=', value: 4550 }] })).toEqual([
      'INV-2',
    ]);
    expect(ids(store, { where: [{ column: 'total_cents', op: '=', value: '4550.00' }] })).toEqual([
      'INV-2',
    ]);
    expect(ids(store, { where: [{ column: 'total_cents', op: '>', value: 1000 }] })).toEqual([
      'INV-1',
      'INV-2',
    ]);
    expect(ids(store, { where: [{ column: 'total_cents', op: '<=', value: '990' }] })).toEqual([
      'INV-3',
    ]);
    expect(ids(store, { where: [{ column: 'due_date', op: '<', value: '2026-11-01' }] })).toEqual([
      'INV-1',
    ]);
    expect(ids(store, { where: [{ column: 'due_date', op: '>=', value: '2026-11-02' }] })).toEqual([
      'INV-2',
      'INV-3',
    ]);
    expect(ids(store, { where: [{ column: 'customer_id', op: '!=', value: 'C-1' }] })).toEqual([
      'INV-2',
    ]);
    expect(
      ids(store, { where: [{ column: 'invoice_id', op: 'in', value: ['INV-3', 'INV-1'] }] }),
    ).toEqual(['INV-1', 'INV-3']);
    expect(ids(store, { where: [{ column: 'paid', op: '=', value: null }] })).toEqual(['INV-2']);
    expect(ids(store, { where: [{ column: 'paid', op: '=', value: '' }] })).toEqual(['INV-2']);
    expect(ids(store, { where: [{ column: 'paid', op: '=', value: true }] })).toEqual(['INV-1']);
    expect(ids(store, { where: [{ column: 'paid', op: '>', value: 'a' }] })).toEqual([
      'INV-1',
      'INV-3',
    ]);
    const names = store.read('customers.csv', {
      where: [{ column: 'name', op: 'contains', value: 'RUIZ' }],
    });
    expect(names.rows.map((row) => row.customer_id)).toEqual(['C-2']);
  });

  it('applies all conditions together and picks columns', async () => {
    const store = await open();
    const result = store.read('invoices.csv', {
      where: [
        { column: 'customer_id', op: '=', value: 'C-1' },
        { column: 'total_cents', op: '<', value: 5000 },
      ],
      columns: ['total_cents', 'invoice_id'],
    });
    expect(result).toEqual({
      columns: ['total_cents', 'invoice_id'],
      rows: [{ total_cents: '990', invoice_id: 'INV-3' }],
      total: 1,
      truncated: false,
    });
  });

  it('pages with limit and offset and caps the limit at 200', async () => {
    const rows = Array.from({ length: 260 }, (_, i) => `R-${i},x`).join('\n');
    job = makeJobDir({ 'big.csv': `id,value\n${rows}\n` });
    const store = await openTableStore({
      dataDir: job.dataDir,
      files: [{ name: 'big.csv', kind: 'table', access: 'read' }],
      mode: 'scratch',
    });
    expect(store.read('big.csv').rows).toHaveLength(50);
    const page = store.read('big.csv', { offset: 250, limit: 5 });
    expect(page.rows.map((row) => row.id)).toEqual(['R-250', 'R-251', 'R-252', 'R-253', 'R-254']);
    expect(page).toMatchObject({ total: 260, truncated: true });
    expect(store.read('big.csv', { offset: 255, limit: 10 })).toMatchObject({
      total: 260,
      truncated: false,
    });
    expect(store.read('big.csv', { limit: 1000 }).rows).toHaveLength(200);
  });

  it('explains bad requests', async () => {
    const store = await open();
    expect(() =>
      store.read('invoices.csv', { where: [{ column: 'totl', op: '=', value: 1 }] }),
    ).toThrow(
      new DataError(
        'invoices.csv has no column "totl". Its columns are: invoice_id, customer_id, total_cents, due_date, paid.',
      ),
    );
    expect(() =>
      store.read('invoices.csv', { where: [{ column: 'paid', op: 'in', value: 'true' }] }),
    ).toThrow(/needs a list/);
    expect(() =>
      store.read('invoices.csv', { where: [{ column: 'paid', op: '=', value: ['a'] }] }),
    ).toThrow(/Only the in operator takes a list/);
    expect(() => store.read('policy.md')).toThrow(
      new DataError('policy.md is a text file, not a table.'),
    );
    expect(() => store.readText('invoices.csv')).toThrow(/is a table, not a text file/);
    expect(() => store.read('invoices.csv', { limit: -1 })).toThrow(DataError);
  });
});

describe('TableStore permissions', () => {
  it('refuses files the job did not declare', async () => {
    const store = await open();
    const attempt = () => store.read('payroll.csv');
    expect(attempt).toThrow(GuardError);
    expect(attempt).toThrow(
      '"payroll.csv" is not one of this job\'s data files. The files are: customers.csv, invoices.csv, policy.md.',
    );
    try {
      attempt();
    } catch (error) {
      expect((error as GuardError).guard).toBe('permission');
    }
  });

  it('refuses writes to read-only files and names the writable ones', async () => {
    const store = await open();
    const attempt = () => store.append('customers.csv', [{ customer_id: 'C-9' }]);
    expect(attempt).toThrow(GuardError);
    expect(attempt).toThrow(
      'customers.csv is read-only for this job. Only invoices.csv can be changed.',
    );
  });

  it('refuses undeclared files even when they exist in the data folder', async () => {
    job = makeJobDir({ 'secret.csv': 'a\n1\n', 'open.csv': 'a\n1\n' });
    const files: DataFile[] = [{ name: 'open.csv', kind: 'table', access: 'write' }];
    const store = await openTableStore({ dataDir: job.dataDir, files, mode: 'scratch' });
    expect(() => store.read('secret.csv')).toThrow(GuardError);
    expect(() => store.append('secret.csv', [{ a: '2' }])).toThrow(GuardError);
  });
});

describe('TableStore writes', () => {
  it('normalizes written values to text or null', async () => {
    const store = await open();
    store.append('invoices.csv', [
      { invoice_id: 'INV-4', customer_id: 'C-3', total_cents: 2500, paid: false, due_date: '' },
    ]);
    expect(store.read('invoices.csv', { offset: 3 }).rows).toEqual([
      {
        invoice_id: 'INV-4',
        customer_id: 'C-3',
        total_cents: '2500',
        due_date: null,
        paid: 'false',
      },
    ]);
    expect(() => store.append('invoices.csv', [{ total: 1 }])).toThrow(/has no column "total"/);
    expect(() => store.append('invoices.csv', [{ total_cents: { cents: 1 } }])).toThrow(
      /must be text, a number, true or false, or null/,
    );
    expect(() => store.append('invoices.csv', [])).toThrow(/at least one row/);
  });

  it('updates matching rows and reports added and changed rows as diffs', async () => {
    const store = await open();
    store.append('invoices.csv', [
      { invoice_id: 'INV-4', customer_id: 'C-3', total_cents: '2500' },
    ]);
    const plan = store.update('invoices.csv', [{ column: 'customer_id', op: '=', value: 'C-1' }], {
      paid: 'true',
    });
    expect(plan).toMatchObject({ matched: 2, changed: 1, summary: 'Update 1 row in invoices.csv' });
    expect(store.pendingChanges()).toEqual([
      {
        file: 'invoices.csv',
        diff: {
          columns: ['invoice_id', 'customer_id', 'total_cents', 'due_date', 'paid'],
          added: [['INV-4', 'C-3', '2500', null, null]],
          removed: [],
          changed: [
            {
              before: ['INV-3', 'C-1', '990', '2026-11-02', 'false'],
              after: ['INV-3', 'C-1', '990', '2026-11-02', 'true'],
            },
          ],
        },
      },
    ]);
    expect(store.original('invoices.csv')).toHaveLength(3);
    expect(store.snapshot()['invoices.csv']?.rows).toHaveLength(4);
    expect(() => store.update('invoices.csv', [], { paid: 'true' })).toThrow(
      /at least one where condition/,
    );
  });

  it('shows a planned write before applying it, and rejects a stale plan', async () => {
    const store = await open();
    const plan = store.planAppend('invoices.csv', [{ invoice_id: 'INV-4' }]);
    expect(plan.summary).toBe('Append 1 row to invoices.csv');
    expect(store.pendingChanges()).toEqual([]);
    store.append('invoices.csv', [{ invoice_id: 'INV-5' }]);
    expect(() => store.apply(plan)).toThrow(/changed after this write was planned/);
    const other = await openTableStore({
      dataDir: job?.dataDir ?? '',
      files: SAMPLE_FILES,
      mode: 'scratch',
    });
    expect(() => other.apply(store.planAppend('invoices.csv', [{ invoice_id: 'INV-6' }]))).toThrow(
      /different store/,
    );
  });

  it('keeps scratch stores isolated from each other and from disk', async () => {
    const store = await open();
    const before = readFileSync(join(job?.dataDir ?? '', 'invoices.csv'), 'utf8');
    const other = await openTableStore({
      dataDir: job?.dataDir ?? '',
      files: SAMPLE_FILES,
      mode: 'scratch',
    });
    store.append('invoices.csv', [{ invoice_id: 'INV-4' }]);
    expect(other.read('invoices.csv').total).toBe(3);
    expect(() => store.commit()).toThrow(/scratch/);
    expect(readFileSync(join(job?.dataDir ?? '', 'invoices.csv'), 'utf8')).toBe(before);
    store.discard();
    expect(store.pendingChanges()).toEqual([]);
    expect(store.read('invoices.csv').total).toBe(3);
  });

  it('commits a live store to disk atomically, keeping line endings and the byte-order mark', async () => {
    const crlf = '﻿invoice_id,total_cents\r\nINV-1,100\r\n';
    const store = await open('live', {
      'customers.csv': 'customer_id\nC-1\n',
      'invoices.csv': crlf,
      'policy.md': '',
    });
    store.append('invoices.csv', [{ invoice_id: 'INV-2', total_cents: 250 }]);
    store.update('invoices.csv', [{ column: 'invoice_id', op: '=', value: 'INV-1' }], {
      total_cents: '120',
    });
    expect(store.commit()).toEqual(['invoices.csv']);
    expect(readFileSync(join(job?.dataDir ?? '', 'invoices.csv'), 'utf8')).toBe(
      '﻿invoice_id,total_cents\r\nINV-1,120\r\nINV-2,250\r\n',
    );
    expect(readdirSync(job?.dataDir ?? '').filter((name) => name.endsWith('.tmp'))).toEqual([]);
    expect(store.pendingChanges()).toEqual([]);
    expect(store.commit()).toEqual([]);
    const reopened = await openTableStore({
      dataDir: job?.dataDir ?? '',
      files: SAMPLE_FILES,
      mode: 'live',
    });
    expect(reopened.read('invoices.csv').rows).toEqual([
      { invoice_id: 'INV-1', total_cents: '120' },
      { invoice_id: 'INV-2', total_cents: '250' },
    ]);
  });

  it('quotes values that need it when writing CSV', async () => {
    const store = await open('live');
    store.append('invoices.csv', [{ invoice_id: 'INV-4', customer_id: 'Ruiz, "Ben"\nLowell' }]);
    store.commit();
    const reopened = await openTableStore({
      dataDir: job?.dataDir ?? '',
      files: SAMPLE_FILES,
      mode: 'live',
    });
    expect(reopened.read('invoices.csv', { offset: 3 }).rows[0]?.customer_id).toBe(
      'Ruiz, "Ben"\nLowell',
    );
  });
});

describe('loading data', () => {
  it('rejects malformed files with a clear message', async () => {
    const files: DataFile[] = [{ name: 'bad.csv', kind: 'table', access: 'read' }];
    job = makeJobDir({ 'bad.csv': 'a,b\n1,2\n3\n' });
    await expect(openTableStore({ dataDir: job.dataDir, files, mode: 'scratch' })).rejects.toThrow(
      'bad.csv: data row 2 has 1 values but the header has 2 columns.',
    );
    job.remove();
    job = makeJobDir({ 'bad.csv': 'a,a\n1,2\n' });
    await expect(openTableStore({ dataDir: job.dataDir, files, mode: 'scratch' })).rejects.toThrow(
      'bad.csv has two columns named "a".',
    );
    job.remove();
    job = makeJobDir({});
    await expect(openTableStore({ dataDir: job.dataDir, files, mode: 'scratch' })).rejects.toThrow(
      'bad.csv is declared in the job but missing from its data folder.',
    );
  });
});
