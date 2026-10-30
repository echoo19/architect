import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { harnessToFiles, hashHarness, sha256Bytes } from '@architect/harness';
import {
  contractTerms,
  HARNESS_FORMAT,
  HarnessSchema,
  JobContractSchema,
  type Harness,
  type Job,
  type PermissionMode,
  type ReportCard,
} from '@architect/shared';
import type { z } from 'zod';
import { sameComputerGrants, storedFolder } from '../../src/graduates/bindings';
import { resourcesFor, type VersionFacts } from '../../src/graduates/build';
import { registerVersion, writeVersionFolder } from '../../src/graduates/versions';
import { DataPaths } from '../../src/loop/paths';
import type { EngineStore } from '../../src/store/engine-store';
import { makeJob, SAMPLE_CONTENT } from '../support/fixtures';
import { THIS_MACHINE } from '../support/machine';

export interface GraduateFixture {
  id: string;
  /** The version's package folder. */
  folder: string;
  /** The folder its `data/` resource is bound to. */
  workspaceDataDir: string;
  job: Job;
}

export interface GraduateOptions {
  id: string;
  /** Where the graduate's model runs on this computer. */
  baseUrl: string;
  job?: Parameters<typeof makeJob>[0];
  harness?: Partial<z.input<typeof HarnessSchema>>;
  /** The write mode this computer granted; the job's own when absent. */
  writes?: PermissionMode;
  /** A GGUF LoRA for the version to carry, trained on the base whose GGUF has `baseDigest`. */
  adapter?: { bytes: Uint8Array; baseDigest: string; scale: number };
  /**
   * The base model's name, `muse-glimmer:30b` when absent. A test that may meet a real Ollama
   * names one no runtime has, so no check of it can ever load a model.
   */
  baseModel?: string;
  /** The certificate on the version's report card (decision 077). */
  certificate?: ReportCard['certificate'];
}

const CREATED_AT = '2026-11-05T18:00:00.000Z';
const RUN_ID = 'run_fixture';

export function fixtureHarness(name: string, overrides: GraduateOptions['harness'] = {}): Harness {
  const harness = HarnessSchema.parse({
    meta: { format: HARNESS_FORMAT, name, version: 4, hash: '' },
    system: 'You are the service desk of Ferncliff Home Services.',
    retrieval: {},
    decoding: { maxSteps: 4 },
    guardrails: {},
    ...overrides,
  });
  return { ...harness, meta: { ...harness.meta, hash: hashHarness(harness) } };
}

/** What version 1 of a fixture graduate says: made, and tested, on THIS_MACHINE. */
export function fixtureFacts(id: string, job: Job, harness: Harness): VersionFacts {
  return {
    agentId: id,
    name: job.name,
    version: 1,
    createdAt: CREATED_AT,
    method: 'architect',
    contract: JobContractSchema.parse({ ...contractTerms(job), version: 1 }),
    modelLabel: 'Glimmer',
    base: { name: 'muse-glimmer:30b', digest: 'sha256:glimmer', sizeBytes: 1024 },
    contextLength: 16_384,
    runtime: 'ollama',
    harness: { meta: harness.meta, files: harnessToFiles(harness) },
    report: reportFor(job),
    lineage: [],
    columns: {},
    rounds: 0,
    keptChanges: 0,
    testMachine: THIS_MACHINE,
  };
}

/**
 * A graduate as the app keeps one after graduation: version 1 as a package folder under
 * `graduates/<id>/versions/`, its row and its version's row in the store, and an installation
 * whose `data/` is bound to a folder holding the sample tables and whose model runs at
 * `baseUrl`.
 */
export async function addGraduate(
  dataDir: string,
  store: EngineStore,
  options: GraduateOptions,
): Promise<GraduateFixture> {
  const paths = new DataPaths(dataDir);
  const job = makeJob({ id: `job_${options.id}`, ...options.job });

  const workspaceDataDir = join(dataDir, 'workspace', options.id);
  await mkdir(workspaceDataDir, { recursive: true });
  for (const [name, content] of Object.entries(SAMPLE_CONTENT)) {
    await writeFile(join(workspaceDataDir, name), content, 'utf8');
  }
  const output = paths.outputDir(options.id);
  await mkdir(output, { recursive: true });

  const harness = fixtureHarness(job.name, options.harness);
  const facts = fixtureFacts(options.id, job, harness);
  if (options.certificate !== undefined) {
    facts.report = { ...reportFor(job), certificate: options.certificate };
  }
  const baseModel = options.baseModel ?? facts.base.name;
  facts.base = { ...facts.base, name: baseModel };
  if (options.adapter) {
    const source = join(dataDir, `adapter-${options.id}.gguf`);
    await writeFile(source, options.adapter.bytes);
    facts.adapter = {
      path: 'adapter/adapter.gguf',
      format: 'gguf_lora',
      sha256: sha256Bytes(options.adapter.bytes),
      sizeBytes: options.adapter.bytes.byteLength,
      baseDigest: options.adapter.baseDigest,
      scale: options.adapter.scale,
      source,
    };
  }
  const written = await writeVersionFolder(store, paths, facts);
  store.transaction(() => {
    registerVersion(store, paths, {
      graduateId: options.id,
      name: job.name,
      version: 1,
      written,
      state: 'accepted',
      installation: {
        graduateId: options.id,
        model: { runtime: 'ollama', baseUrl: options.baseUrl, model: baseModel },
        bindings: {
          data: storedFolder(paths, workspaceDataDir),
          output: storedFolder(paths, output),
        },
        grants: sameComputerGrants(
          { contract: facts.contract, resources: resourcesFor(facts.contract, {}) },
          options.writes ?? job.permissions.writes,
        ),
        createdAt: CREATED_AT,
        updatedAt: CREATED_AT,
      },
      at: CREATED_AT,
    });
  });
  return { id: options.id, folder: paths.versionDir(options.id, 1), workspaceDataDir, job };
}

export function reportFor(job: Job): ReportCard {
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
    requirements: { passRate: { target: job.requirements.passRate, actual: 0.85, met: true } },
    overclaim: null,
  };
}
