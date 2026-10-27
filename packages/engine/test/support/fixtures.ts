import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { HarnessSchema, JobSchema, type DataFile, type Harness, type Job } from '@architect/shared';
import type { z } from 'zod';

export const SAMPLE_FILES: DataFile[] = [
  {
    name: 'customers.csv',
    kind: 'table',
    access: 'read',
    description: 'Customers and their payment terms.',
  },
  {
    name: 'invoices.csv',
    kind: 'table',
    access: 'write',
    description: 'Issued invoices, one row each.',
  },
  { name: 'policy.md', kind: 'text', access: 'read', description: 'Pricing and payment rules.' },
];

export const SAMPLE_CONTENT: Readonly<Record<string, string>> = {
  'customers.csv':
    'customer_id,name,city,terms_days\nC-1,Ada Park,Ferncliff,30\nC-2,"Ruiz, Ben",Lowell,15\nC-3,Cho Lin,,30\n',
  'invoices.csv':
    'invoice_id,customer_id,total_cents,due_date,paid\nINV-1,C-1,12000,2026-10-01,true\nINV-2,C-2,4550,2026-11-15,\nINV-3,C-1,990,2026-11-02,false\n',
  'policy.md': '# Policy\n\nInvoices are due 30 days after issue.\nTax is 8.25% on parts.\n',
};

export interface TempJob {
  dir: string;
  dataDir: string;
  remove(): void;
}

/** A job folder in the temp directory with the sample data (or the given files) in `data/`. */
export function makeJobDir(content: Readonly<Record<string, string>> = SAMPLE_CONTENT): TempJob {
  const dir = mkdtempSync(join(tmpdir(), 'architect-engine-'));
  const dataDir = join(dir, 'data');
  mkdirSync(dataDir);
  for (const [name, text] of Object.entries(content)) writeFileSync(join(dataDir, name), text);
  return { dir, dataDir, remove: () => rmSync(dir, { recursive: true, force: true }) };
}

export function makeHarness(overrides: Partial<z.input<typeof HarnessSchema>> = {}): Harness {
  return HarnessSchema.parse({
    meta: { format: 1, name: 'Service desk', version: 3, hash: 'sha256-test' },
    system: 'You are the service desk of Ferncliff Home Services.',
    retrieval: {},
    decoding: {},
    guardrails: {},
    ...overrides,
  });
}

export function makeJob(overrides: Partial<z.input<typeof JobSchema>> = {}): Job {
  return JobSchema.parse({
    format: 1,
    id: 'job_test',
    name: 'Service desk',
    description: 'Handles the office work of a home-services company.',
    createdAt: '2026-10-27T09:00:00.000Z',
    businessDate: '2026-11-03',
    taskTypes: [
      { id: 'invoice', label: 'Invoices' },
      { id: 'overdue', label: 'Overdue balances' },
    ],
    data: { files: SAMPLE_FILES },
    permissions: { writes: 'ask', unseenFiles: 'never' },
    checker: { kind: 'builtin' },
    requirements: { passRate: 0.85 },
    budget: { maxRounds: 8, maxMentorUsd: 5, maxWallMinutes: 240 },
    mentor: { kind: 'coding_agent', agent: 'claude_code', label: 'Mentor' },
    student: {
      label: 'Glimmer',
      local: { runtime: 'ollama', baseUrl: 'http://127.0.0.1:11434', model: 'muse-glimmer:30b' },
    },
    startingHarness: { kind: 'blank' },
    splits: { seed: 7, calibration: 0, train: 2, dev: 1, test: 1 },
    evaluation: { trainBatch: 2, minDevGain: 1, maxTypeRegression: 1 },
    ...overrides,
  });
}
