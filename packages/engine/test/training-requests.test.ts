import { createHash } from 'node:crypto';
import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  FIELD_EXPORT_FORMAT,
  type FieldExportManifest,
  type ModelConfig,
  type TrainingPlanRequest,
} from '@architect/shared';
import { afterEach, describe, expect, it } from 'vitest';
import { HubClient } from '../src/hub';
import {
  BundleError,
  bundleFromRequest,
  planFromRequest,
  readModelConfig,
  SizingError,
} from '../src/training-plan';
import { FAKE_HUB_TOKEN, startFakeHub } from './support/fake-hub';

/* The Compute place's three requests: read a config, plan from it, bundle it. */

const TRAINER = join(import.meta.dirname, '..', '..', '..', 'trainer');
const FIXTURES = join(import.meta.dirname, 'fixtures', 'model-configs');
const fixture = (name: string): ModelConfig =>
  JSON.parse(readFileSync(join(FIXTURES, `${name}.json`), 'utf8')) as ModelConfig;

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});
function temp(): string {
  const dir = mkdtempSync(join(tmpdir(), 'architect-compute-'));
  dirs.push(dir);
  return dir;
}

const offline = new HubClient({ endpoint: 'http://127.0.0.1:9', token: async () => undefined });

function request(config: ModelConfig, repo: string | null, revision: string | null) {
  return {
    config,
    model: { repo, revision },
    method: 'lora',
    precision: 'bf16',
    gpu: { name: 'H100 80GB', memoryGb: 80 },
    seqLen: 4096,
    microBatch: 1,
    gpusPerNode: 8,
    loraRank: 16,
  } satisfies TrainingPlanRequest;
}

function fieldExport(): string {
  const dir = temp();
  const demonstrations = '{"messages":[]}\n';
  const sha = (text: string) => createHash('sha256').update(text).digest('hex');
  const stamp = '2026-10-30T00:00:00.000Z';
  mkdirSync(join(dir, 'sft'));
  writeFileSync(join(dir, 'sft', 'demonstrations.jsonl'), demonstrations);
  const manifest: FieldExportManifest = {
    format: FIELD_EXPORT_FORMAT,
    created_at: stamp,
    job: { id: 'job', name: 'Job', format: 1, created_at: stamp, sha256: sha('job') },
    counts: {
      demonstrations: 1,
      trained_turns: 1,
      train_tasks: 1,
      train_organizations: 1,
      sealed_organizations: 1,
      locked_test_tasks: 1,
    },
    files: { 'sft/demonstrations.jsonl': sha(demonstrations) },
    permitted_uses: { sft: [], env: [], eval: [] },
    left_out: [],
  };
  writeFileSync(join(dir, 'MANIFEST.json'), JSON.stringify(manifest));
  return dir;
}

/** Makes a link to a folder: a symlink, or on Windows a junction, which needs no privilege. */
function linkFolder(target: string, path: string): boolean {
  try {
    symlinkSync(target, path, 'junction');
    return true;
  } catch {
    return false;
  }
}

describe('the Compute requests', () => {
  it('reads a config.json from a file, naming no model', async () => {
    const file = join(temp(), 'config.json');
    writeFileSync(file, JSON.stringify(fixture('small-1b')));
    const read = await readModelConfig(offline, { kind: 'file', path: file });
    expect(read.model).toEqual({ repo: null, revision: null });
    expect(planFromRequest(request(read.config, null, null)).label).toBe('estimate');
  });

  it("refuses a file that isn't a JSON object, and a config it can't size, with the reason", async () => {
    const file = join(temp(), 'config.json');
    writeFileSync(file, '[1, 2]');
    await expect(readModelConfig(offline, { kind: 'file', path: file })).rejects.toThrow(
      /isn't a JSON object/,
    );
    expect(() =>
      planFromRequest(request({ ...fixture('small-1b'), model_type: 'mamba' }, null, null)),
    ).toThrow(SizingError);
  });

  it('reads from the Hub at the commit its revision names', async () => {
    const hub = await startFakeHub();
    try {
      hub.repos.set('lab/moe', { private: false, commits: [] });
      const commit = hub.commit('lab/moe', {
        'config.json': Buffer.from(JSON.stringify(fixture('moe-235b'))),
      });
      const client = new HubClient({ endpoint: hub.url, token: async () => FAKE_HUB_TOKEN });
      const read = await readModelConfig(client, {
        kind: 'hub',
        repo: 'lab/moe',
        revision: 'main',
      });
      expect(read.model).toEqual({ repo: 'lab/moe', revision: commit });
    } finally {
      await hub.close();
    }
  });

  it('writes each bundle in a new folder inside the one chosen', () => {
    const parent = temp();
    const plan = request(fixture('moe-235b'), 'lab/moe-235b', 'a'.repeat(40));
    const ask = { plan, target: 'slurm', exportDir: fieldExport(), parentDir: parent } as const;
    const first = bundleFromRequest(ask, TRAINER);
    const second = bundleFromRequest(ask, TRAINER);
    expect(first.dir).toBe(join(parent, 'moe-235b-slurm'));
    expect(second.dir).toBe(join(parent, 'moe-235b-slurm-2'));
    expect(first.bundle.submit).toBe('sbatch submit.sbatch');
    expect(readdirSync(parent).sort()).toEqual(['moe-235b-slurm', 'moe-235b-slurm-2']);
  });

  it('refuses an output folder that is a link, so nothing is written where it points', (context) => {
    const parent = temp();
    const outside = temp();
    if (!linkFolder(outside, join(parent, 'moe-235b-slurm'))) context.skip();
    const ask = {
      plan: request(fixture('moe-235b'), 'lab/moe-235b', 'a'.repeat(40)),
      target: 'slurm',
      exportDir: fieldExport(),
      parentDir: parent,
    } as const;
    expect(() => bundleFromRequest(ask, TRAINER)).toThrow(/is a link/);
    expect(readdirSync(outside)).toEqual([]);
  });

  it('refuses a bundle for a model read from a file, and writes nothing', () => {
    const parent = temp();
    const ask = {
      plan: request(fixture('small-1b'), null, null),
      target: 'kubernetes',
      exportDir: fieldExport(),
      parentDir: parent,
    } as const;
    expect(() => bundleFromRequest(ask, TRAINER)).toThrow(BundleError);
    expect(readdirSync(parent)).toEqual([]);
  });
});
