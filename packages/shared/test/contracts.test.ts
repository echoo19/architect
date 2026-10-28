import { describe, expect, it } from 'vitest';
import {
  contractTerms,
  DecodingSchema,
  HypothesisSchema,
  isHarnessSurfacePath,
  JobContractSchema,
  JobSchema,
  newId,
  packagePathProblem,
  ReportCardSchema,
  sameContractTerms,
  slugify,
  TaskSchema,
  WorkspaceMessageSchema,
} from '../src';

describe('harness surface', () => {
  it('accepts the files the mentor may change', () => {
    for (const path of [
      'AGENTS.md',
      'skills/price-a-job/SKILL.md',
      'tools/invoice_total.js',
      'tools/invoice_total.json',
      'examples/after-hours.json',
      'retrieval.yaml',
      'decoding.yaml',
      'guardrails.yaml',
    ]) {
      expect(isHarnessSurfacePath(path), path).toBe(true);
    }
  });

  it('rejects everything else, including path tricks', () => {
    for (const path of [
      'harness.yaml',
      'checker.js',
      '../vault/test.jsonl',
      'skills/../../job.json',
      'tools/Invoice.js',
      'skills/a/b.md',
      'skills/a/b/SKILL.md',
      'skills/price-a-job.md',
      'system.md',
      '/AGENTS.md',
      'data/invoices.csv',
    ]) {
      expect(isHarnessSurfacePath(path), path).toBe(false);
    }
  });
});

describe('schemas', () => {
  it('fills decoding defaults', () => {
    expect(DecodingSchema.parse({})).toEqual({
      temperature: 1,
      topP: 0.95,
      topK: 64,
      maxSteps: 16,
      maxOutputTokens: 4096,
      thinking: 'low',
    });
  });

  it('parses a task with an exact answer', () => {
    const task = TaskSchema.parse({
      id: 't1',
      type: 'overdue',
      family: 'overdue:cust-12',
      prompt: 'Which invoices are overdue?',
      expected: { kind: 'answer', value: ['INV-1'], compare: { mode: 'set' } },
    });
    expect(task.expected.kind).toBe('answer');
  });

  it('requires at least one edit in a hypothesis', () => {
    const result = HypothesisSchema.safeParse({
      title: 'Nothing',
      diagnosis: 'x',
      edits: [],
      predicted: { devDeltaMin: 0, devDeltaMax: 1, rationale: 'x' },
    });
    expect(result.success).toBe(false);
  });

  it('reads a report card from before cards named their test target as a local test', () => {
    const card = {
      jobId: 'job_1',
      runId: 'run_1',
      method: 'bare',
      name: 'Service desk',
      createdAt: '2026-10-27T14:00:00.000Z',
      student: { label: 'Glimmer', model: 'muse-glimmer:30b', runtime: 'ollama' },
      mentor: { label: 'No mentor', model: '' },
      test: {
        score: { pass: 1, total: 2 },
        perType: [],
        latencyMs: { p50: 1000, p95: 2000 },
        refusals: 0,
        ranOffline: true,
      },
      dev: { baseline: null, final: null, curve: [] },
      cost: { mentorUsd: 0, mentorInputTokens: 0, mentorOutputTokens: 0, rounds: 0, wallMs: 0 },
      refusedTypes: [],
      topInterventions: [],
      requirements: { passRate: { target: 0.9, actual: 0.5, met: false } },
      overclaim: null,
    };
    expect(ReportCardSchema.parse(card).testedOn).toBe('local');
    expect(ReportCardSchema.parse({ ...card, testedOn: 'hosted' }).testedOn).toBe('hosted');
    expect(ReportCardSchema.safeParse({ ...card, testedOn: 'cloud' }).success).toBe(false);
  });

  it("keeps a reply's work with it, and still reads replies saved without it", () => {
    const earlier = {
      id: 'msg_2',
      chatId: 'chat_1',
      role: 'agent',
      createdAt: '2026-10-28T09:00:00.000Z',
      text: 'Two invoices are unpaid.',
      status: 'done',
    };
    expect(WorkspaceMessageSchema.parse(earlier).trace).toBeUndefined();
    const trace = [
      {
        kind: 'model',
        text: 'Let me check.',
        calls: [{ id: 'c1', name: 'read', arguments: '{"path":"data/invoices.csv"}' }],
      },
      {
        kind: 'tool',
        callId: 'c1',
        name: 'read',
        arguments: '{"path":"data/invoices.csv"}',
        result: '1\tinvoice_id,paid\n2\tINV-2,false',
      },
      { kind: 'skill', slug: 'overdue-balances', via: 'rule' },
      { kind: 'model', text: 'Two invoices are unpaid.', calls: [] },
    ];
    expect(WorkspaceMessageSchema.parse({ ...earlier, trace }).trace).toEqual(trace);
    expect(
      WorkspaceMessageSchema.safeParse({ ...earlier, trace: [{ kind: 'tool', name: 'read' }] })
        .success,
    ).toBe(false);
  });
});

describe('ids', () => {
  it('prefixes ids and keeps them unique', () => {
    const a = newId('run');
    const b = newId('run');
    expect(a.startsWith('run_')).toBe(true);
    expect(a).not.toBe(b);
  });

  it('slugifies names for file paths', () => {
    expect(slugify('Price a Job (after hours)')).toBe('price-a-job-after-hours');
    expect(slugify('***')).toBe('item');
  });
});

describe('job contracts', () => {
  const job = JobSchema.parse({
    format: 1,
    id: 'job_desk',
    name: 'Service desk',
    description: 'Invoices for a home-services office.',
    createdAt: '2026-10-27T09:00:00.000Z',
    taskTypes: [{ id: 'invoice', label: 'Invoices' }],
    data: { files: [{ name: 'invoices.csv', kind: 'table', access: 'write' }] },
    permissions: { writes: 'ask', unseenFiles: 'never' },
    checker: { kind: 'builtin' },
    requirements: { passRate: 0.9 },
    budget: { maxRounds: 4, maxMentorUsd: 1, maxWallMinutes: 60 },
    mentor: { kind: 'coding_agent', agent: 'claude_code', label: 'Mentor' },
    student: {
      label: 'Glimmer',
      local: { runtime: 'ollama', baseUrl: 'http://127.0.0.1:11434', model: 'muse-glimmer:30b' },
    },
    startingHarness: { kind: 'blank' },
    splits: { seed: 1, calibration: 0, train: 1, dev: 1, test: 1 },
    evaluation: { trainBatch: 1, minDevGain: 1, maxTypeRegression: 0 },
  });

  it('state what the job promises, with nothing about training', () => {
    const terms = contractTerms(job);
    expect(terms.outputs.files).toEqual(['invoices.csv']);
    expect(terms.boundaries).toEqual({ writes: 'ask', unseenFiles: 'never', network: 'none' });
    expect(JSON.stringify(terms)).not.toContain('127.0.0.1');
    expect(JobContractSchema.parse({ ...terms, version: 1 }).version).toBe(1);
  });

  it('compare by what they promise, not by their version or labels', () => {
    const recorded = JobContractSchema.parse({ ...contractTerms(job), version: 3 });
    expect(sameContractTerms(recorded, contractTerms({ ...job, name: 'Front desk' }))).toBe(true);
    expect(sameContractTerms(recorded, contractTerms({ ...job, description: 'Refunds.' }))).toBe(
      false,
    );
    expect(
      sameContractTerms(recorded, contractTerms({ ...job, requirements: { passRate: 0.95 } })),
    ).toBe(false);
  });
});

describe('package paths', () => {
  it('accept plain relative paths', () => {
    for (const path of ['graduate.json', 'harness/skills/price-a-job.md', 'adapter/adapter.gguf']) {
      expect(packagePathProblem(path), path).toBeNull();
    }
  });

  it('refuse anything that could escape, hide or mean another file elsewhere', () => {
    for (const path of [
      '../evil.txt',
      'harness/../../evil',
      '/etc/passwd',
      'C:/Windows/evil.dll',
      'harness\\system.md',
      'harness//system.md',
      '.hidden',
      'harness/con.md',
      'harness/system.md.',
      'harness/sys:tem.md',
    ]) {
      expect(packagePathProblem(path), path).not.toBeNull();
    }
  });
});
