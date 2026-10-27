import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { hashHarness, writeGraduate } from '@architect/harness';
import {
  HarnessSchema,
  type GraduateManifest,
  type Harness,
  type Job,
  type ReportCard,
} from '@architect/shared';
import type { z } from 'zod';
import { DataPaths } from '../../src/loop/paths';
import type { EngineStore } from '../../src/store/engine-store';
import { makeJob, SAMPLE_CONTENT } from '../support/fixtures';

export interface GraduateFixture {
  id: string;
  folder: string;
  workspaceDataDir: string;
  job: Job;
}

export interface GraduateOptions {
  id: string;
  /** Where the graduate's student runs. */
  baseUrl: string;
  job?: Parameters<typeof makeJob>[0];
  harness?: Partial<z.input<typeof HarnessSchema>>;
}

const CREATED_AT = '2026-11-05T18:00:00.000Z';
const RUN_ID = 'run_fixture';

/**
 * A graduate as the app keeps one: its folder under `graduates/`, written with `writeGraduate`;
 * the job its run used; a workspace data folder with the sample tables; and its row in the store.
 */
export async function addGraduate(
  dataDir: string,
  store: EngineStore,
  options: GraduateOptions,
): Promise<GraduateFixture> {
  const paths = new DataPaths(dataDir);
  const job = makeJob({ id: `job_${options.id}`, ...options.job });
  await writeJson(paths.runJobFile(job.id, RUN_ID), job);

  const workspaceDataDir = join(dataDir, 'workspace', options.id);
  await mkdir(workspaceDataDir, { recursive: true });
  for (const [name, content] of Object.entries(SAMPLE_CONTENT)) {
    await writeFile(join(workspaceDataDir, name), content, 'utf8');
  }

  const harness = withHash(
    HarnessSchema.parse({
      meta: { format: 1, name: job.name, version: 4, hash: '' },
      system: 'You are the service desk of Ferncliff Home Services.',
      retrieval: {},
      decoding: { maxSteps: 4 },
      guardrails: {},
      ...options.harness,
    }),
  );
  const manifest = manifestFor(options, job, harness);
  const folder = paths.graduateDir(options.id);
  await writeGraduate(folder, { harness, manifest, report: reportFor(job), lineage: [] });
  store.graduates.insert({
    id: options.id,
    runId: null,
    name: job.name,
    path: paths.toStored(folder),
    manifest,
    settings: null,
    createdAt: CREATED_AT,
  });
  return { id: options.id, folder, workspaceDataDir, job };
}

function withHash(harness: Harness): Harness {
  return { ...harness, meta: { ...harness.meta, hash: hashHarness(harness) } };
}

function manifestFor(options: GraduateOptions, job: Job, harness: Harness): GraduateManifest {
  return {
    format: 1,
    id: options.id,
    name: job.name,
    jobId: job.id,
    runId: RUN_ID,
    method: 'architect',
    createdAt: CREATED_AT,
    student: {
      label: 'Glimmer',
      runtime: 'ollama',
      baseUrl: options.baseUrl,
      model: 'muse-glimmer:30b',
      contextLength: 16_384,
    },
    harness: { version: harness.meta.version, hash: harness.meta.hash },
    requirements: { passRate: { target: 0.8, actual: 0.85, met: true } },
    test: {
      score: { pass: 17, total: 20 },
      perType: [{ type: 'invoice', label: 'Invoices', pass: 17, total: 20, refused: false }],
    },
    mentor: { label: 'Spark', model: 'muse-spark-1.3' },
  };
}

function reportFor(job: Job): ReportCard {
  return {
    jobId: job.id,
    runId: RUN_ID,
    method: 'architect',
    name: job.name,
    createdAt: CREATED_AT,
    student: { label: 'Glimmer', model: 'muse-glimmer:30b', runtime: 'ollama' },
    testedOn: 'local',
    mentor: { label: 'Spark', model: 'muse-spark-1.3' },
    test: {
      score: { pass: 17, total: 20 },
      perType: [{ type: 'invoice', label: 'Invoices', pass: 17, total: 20, refused: false }],
      latencyMs: { p50: 9000, p95: 21_000 },
      refusals: 0,
      ranOffline: true,
    },
    dev: { baseline: null, final: null, curve: [] },
    cost: { mentorUsd: 0, mentorInputTokens: 0, mentorOutputTokens: 0, rounds: 0, wallMs: 0 },
    refusedTypes: [],
    topInterventions: [],
    requirements: { passRate: { target: 0.8, actual: 0.85, met: true } },
    overclaim: null,
  };
}

async function writeJson(file: string, value: unknown): Promise<void> {
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}
