import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { GraduateManifest, Harness, LineageEntry, ReportCard } from '@architect/shared';
import { afterEach } from 'vitest';
import { hashHarness } from '../src';

const tempDirs: string[] = [];

/** A fresh temp folder per call, removed after each test. */
export async function tempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'architect-harness-'));
  tempDirs.push(dir);
  return dir;
}

export function cleanTempDirsAfterEach(): void {
  afterEach(async () => {
    await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
  });
}

export function withHash(harness: Harness): Harness {
  return { ...harness, meta: { ...harness.meta, hash: hashHarness(harness) } };
}

/** A harness that uses every part of the format, in canonical (slug) order. */
export function sampleHarness(): Harness {
  return withHash({
    meta: { format: 1, name: 'Service desk', version: 3, parent: 2, hash: '' },
    system: 'You are the Service desk agent.\n\nUse the records. Never guess a price.\n',
    skills: [
      {
        slug: 'overdue-balances',
        name: 'Find overdue balances',
        summary: 'List invoices past terms after partial payments.',
        taskTypes: ['overdue'],
        body: '1. Read the invoices.\n2. Subtract payments.\n',
      },
      {
        slug: 'price-a-job',
        name: 'Price a completed job',
        summary: 'Turn a job into invoice lines: labor, parts, tax, in cents.',
        taskTypes: ['invoice', 'quote'],
        body: '1. Read the job with read_table.\n2. Call invoice_total.\n\n```\ntotal = sum(lines)\n```\n',
      },
    ],
    tools: [
      {
        name: 'invoice_total',
        description: 'Total an invoice in cents from its lines.',
        parameters: {
          type: 'object',
          required: ['lines'],
          properties: { lines: { type: 'array', items: { type: 'object' } } },
        },
        code: 'function run(args, ctx) {\n  return { total_cents: args.lines.length };\n}\n',
      },
    ],
    examples: [
      {
        slug: 'after-hours-plan-member',
        title: 'After-hours job with a plan member',
        taskTypes: ['invoice'],
        messages: [
          { role: 'system', content: 'You are the Service desk agent.' },
          { role: 'user', content: 'Invoice job J-100.' },
          {
            role: 'assistant',
            content: 'Reading the job.',
            toolCalls: [
              {
                id: 'call_1',
                name: 'read_table',
                arguments: { name: 'jobs', where: { id: 'J-100' } },
              },
            ],
          },
          { role: 'tool', toolCallId: 'call_1', name: 'read_table', content: '{"rows":[]}' },
          { role: 'assistant', content: 'ANSWER: {"total_cents": 12345}' },
        ],
      },
    ],
    retrieval: {
      listSkills: true,
      maxLoadedSkills: 3,
      maxExamples: 1,
      rules: [
        {
          whenAny: ['invoice', 'bill', 'price the job'],
          loadSkills: ['price-a-job'],
          loadExamples: ['after-hours-plan-member'],
        },
        { whenAny: ['overdue, late'], loadSkills: ['overdue-balances'], loadExamples: [] },
      ],
    },
    decoding: {
      temperature: 0.7,
      topP: 0.9,
      topK: 40,
      maxSteps: 12,
      maxOutputTokens: 4096,
      thinking: 'medium',
    },
    guardrails: {
      refuse: [
        {
          taskType: 'scheduling',
          whenAny: ['book', 'schedule', 'appointment'],
          reason: 'Scheduled jobs in testing chose a valid slot only 60% of the time.',
        },
      ],
    },
  });
}

export function sampleLineage(): LineageEntry[] {
  const base: LineageEntry = {
    id: 'chg_1',
    runId: 'run_1',
    round: 1,
    title: 'Add a pricing skill',
    diagnosis: 'The student skipped the after-hours multiplier.',
    files: ['skills/price-a-job.md'],
    causeTaskIds: ['t1', 't2'],
    predicted: { devDeltaMin: 2, devDeltaMax: 5, rationale: 'The skill states the rule.' },
    measured: {
      devBefore: { pass: 10, total: 40 },
      devAfter: { pass: 15, total: 40 },
      delta: 5,
      perType: [{ type: 'invoice', before: 4, after: 9 }],
    },
    decision: 'kept',
    decisionReason: 'Dev passes rose by 5.',
    versionFrom: 1,
    versionTo: 2,
    mentor: { model: 'mentor-model', costUsd: 0.0123, inputTokens: 4000, outputTokens: 900 },
    at: '2026-10-27T15:00:00.000Z',
  };
  return [
    base,
    {
      ...base,
      id: 'chg_2',
      round: 2,
      title: 'Lower the temperature',
      files: ['decoding.yaml'],
      measured: {
        ...base.measured,
        devBefore: { pass: 15, total: 40 },
        devAfter: { pass: 14, total: 40 },
        delta: -1,
      },
      decision: 'reverted',
      decisionReason: 'Dev passes fell by 1.',
      versionFrom: 2,
      versionTo: 3,
      mentor: { ...base.mentor, costUsd: null },
      at: '2026-10-27T15:20:00.000Z',
    },
  ];
}

export function sampleReport(): ReportCard {
  return {
    jobId: 'job_1',
    runId: 'run_1',
    method: 'architect',
    name: 'Service desk',
    createdAt: '2026-10-27T18:30:00.000Z',
    student: { label: 'Glimmer', model: 'muse-glimmer:30b', runtime: 'ollama' },
    testedOn: 'local',
    mentor: { label: 'Spark', model: 'muse-spark-1.3' },
    test: {
      score: { pass: 38, total: 50 },
      perType: [
        { type: 'invoice', label: 'Invoices', pass: 20, total: 24, refused: false },
        { type: 'overdue', label: 'Overdue balances', pass: 18, total: 26, refused: false },
        { type: 'scheduling', label: 'Scheduling | urgent', pass: 0, total: 0, refused: true },
      ],
      latencyMs: { p50: 8200, p95: 21_400 },
      refusals: 0,
      ranOffline: true,
    },
    dev: {
      baseline: { pass: 12, total: 40 },
      final: { pass: 31, total: 40 },
      curve: [
        { round: 0, score: { pass: 12, total: 40 }, decision: 'baseline' },
        { round: 1, score: { pass: 17, total: 40 }, decision: 'kept' },
        { round: 2, score: { pass: 16, total: 40 }, decision: 'reverted' },
      ],
    },
    cost: {
      mentorUsd: 0.84,
      mentorInputTokens: 123_456,
      mentorOutputTokens: 32_100,
      rounds: 7,
      wallMs: 4_320_000,
    },
    refusedTypes: [
      {
        type: 'scheduling',
        label: 'Scheduling',
        reason: 'Scheduled jobs in testing chose a valid slot only 60% of the time.',
      },
    ],
    topInterventions: [
      { round: 3, title: 'Add a pricing skill', delta: 5 },
      { round: 5, title: 'Add an invoice total tool', delta: 3 },
    ],
    requirements: {
      passRate: { target: 0.7, actual: 0.76, met: true },
      p95LatencyMs: { target: 25_000, actual: 21_400, met: true },
    },
    overclaim: false,
  };
}

export function sampleManifest(harness: Harness): GraduateManifest {
  return {
    format: 1,
    id: 'grd_1',
    name: 'Service desk',
    jobId: 'job_1',
    runId: 'run_1',
    method: 'architect',
    createdAt: '2026-10-27T18:30:00.000Z',
    student: {
      label: 'Glimmer',
      runtime: 'ollama',
      baseUrl: 'http://127.0.0.1:11434',
      model: 'muse-glimmer:30b',
      quantization: 'Q4_K_M',
      digest: 'sha256:0123456789abcdef',
      sizeBytes: 18_000_000_000,
      contextLength: 32_768,
    },
    harness: { version: harness.meta.version, hash: harness.meta.hash },
    requirements: {
      passRate: { target: 0.7, actual: 0.76, met: true },
      p95LatencyMs: { target: 25_000, actual: 21_400, met: true },
    },
    test: {
      score: { pass: 38, total: 50 },
      perType: sampleReport().test.perType,
    },
    mentor: { label: 'Spark', model: 'muse-spark-1.3' },
  };
}
