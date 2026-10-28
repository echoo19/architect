import { describe, expect, it } from 'vitest';
import {
  DecodingSchema,
  HypothesisSchema,
  isHarnessSurfacePath,
  newId,
  ReportCardSchema,
  slugify,
  TaskSchema,
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
