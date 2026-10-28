import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { GuardError, TrainerJobSchema } from '@architect/shared';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  buildTrainerJob,
  buildTrainingDataset,
  loadRecipe,
  MIN_JOB_SECONDS,
  STARTUP_RESERVE_SECONDS,
  writeTrainerInputs,
} from '../src/training';
import { orderEpisode } from './support/episodes';

const TRAINER = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'trainer');
const BASE = { repo: 'meta-models/Muse-Glimmer-30B', revision: 'a'.repeat(40) };

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'architect-recipe-'));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

function dataset() {
  return buildTrainingDataset([orderEpisode('ep-1'), orderEpisode('ep-2', {}, '2002')], {
    destination: 'remote',
    now: () => new Date('2026-10-28T10:00:00.000Z'),
  });
}

function job(authorizedSeconds = 3 * 3600) {
  const recipe = loadRecipe(TRAINER);
  return {
    recipe,
    job: buildTrainerJob({
      jobId: 'trn_test1',
      recipe,
      baseModel: BASE,
      dataset: dataset().manifest,
      authorizedSeconds,
      outputRepo: 'someone/architect-trn-test1',
    }),
  };
}

describe('the pinned recipe', () => {
  it('pins the image by digest, every package by version and the converter by commit', () => {
    const { recipe, files, sha256 } = loadRecipe(TRAINER);
    expect(recipe.image).toMatch(/@sha256:[0-9a-f]{64}$/);
    expect(recipe.python_packages.every((pin) => /==/.test(pin))).toBe(true);
    expect(recipe.converter.commit).toMatch(/^[0-9a-f]{40}$/);
    expect(recipe.lora).toMatchObject({ use_rslora: false, use_dora: false });
    expect(files.map((file) => file.name)).toEqual([
      'recipe.json',
      'pipeline.py',
      'train_qlora.py',
      'chat_spans.py',
    ]);
    expect(sha256).toMatch(/^[0-9a-f]{64}$/);
  });

  it("adapts only the text decoder's linear layers, never the vision tower", () => {
    const pattern = new RegExp(loadRecipe(TRAINER).recipe.lora.target_modules);
    for (const name of [
      'model.language_model.layers.0.self_attn.q_proj',
      'model.language_model.layers.51.self_attn.gate_proj',
      'model.language_model.layers.7.mlp.down_proj',
    ]) {
      expect(pattern.test(name)).toBe(true);
    }
    for (const name of [
      'model.vision_tower.layers.0.attn.q_proj',
      'model.language_model.embed_tokens',
      'lm_head',
      'model.vision_projection',
    ]) {
      expect(pattern.test(name)).toBe(false);
    }
  });
});

describe("the trainer's job file", () => {
  it('carries the recipe, the dataset and the base revision, and leaves time to start up', () => {
    const { recipe, job: built } = job();
    expect(TrainerJobSchema.parse(built)).toEqual(built);
    expect(built).toMatchObject({
      job_id: 'trn_test1',
      base_model: BASE,
      dataset: { sha256: dataset().manifest.examples_sha256, example_count: 2 },
      recipe: { name: 'glimmer-qlora', version: 1, sha256: recipe.sha256 },
      lora: recipe.recipe.lora,
      converter: recipe.recipe.converter,
      max_seconds: 3 * 3600 - STARTUP_RESERVE_SECONDS,
      output: { repo: 'someone/architect-trn-test1', path_in_repo: 'outputs' },
    });
  });

  it('refuses a job too short to train in', () => {
    expect(() => job(MIN_JOB_SECONDS - 1)).toThrow(GuardError);
    expect(job(MIN_JOB_SECONDS).job.max_seconds).toBe(MIN_JOB_SECONDS - STARTUP_RESERVE_SECONDS);
  });

  it('lays out the inputs the way the job reads them', () => {
    const { recipe, job: built } = job();
    const inputs = writeTrainerInputs(join(dir, 'inputs'), built, recipe, dataset());
    expect(inputs.map((file) => file.name)).toEqual([
      'job.json',
      'dataset.json',
      'examples.jsonl',
      'recipe.json',
      'pipeline.py',
      'train_qlora.py',
      'chat_spans.py',
    ]);
    const copied = inputs.find((file) => file.name === 'recipe.json');
    expect(copied?.sha256).toBe(recipe.sha256);
  });
});

/** Python, when this computer has it; the checks below need nothing beyond its standard library. */
function findPython(): string | null {
  for (const candidate of ['python3', 'python']) {
    const probe = spawnSync(candidate, ['-c', 'import sys; print(sys.version_info[0])'], {
      encoding: 'utf8',
    });
    if (probe.status === 0 && probe.stdout.trim() === '3') return candidate;
  }
  return null;
}
const python = findPython();

describe.skipIf(python === null)('the recipe under Python', () => {
  const run = (args: string[], cwd = TRAINER) =>
    spawnSync(python ?? 'python3', ['-B', ...args], { cwd, encoding: 'utf8' });

  it('compiles, and passes its own checks of the span logic', () => {
    const compiled = run([
      '-c',
      'import ast, sys\nfor name in sys.argv[1:]: ast.parse(open(name, encoding="utf-8").read(), name)',
      'pipeline.py',
      'train_qlora.py',
      'chat_spans.py',
      'selftest.py',
    ]);
    expect(compiled.stderr).toBe('');
    expect(compiled.status).toBe(0);
    const selftest = run(['selftest.py']);
    expect(selftest.stderr).toMatch(/OK/);
    expect(selftest.status).toBe(0);
  });

  it('accepts the inputs this app writes, in a dry run', () => {
    const { recipe, job: built } = job();
    const inputs = join(dir, 'inputs');
    writeTrainerInputs(inputs, built, recipe, dataset());
    const dry = run(
      ['pipeline.py', '--job', join(inputs, 'job.json'), '--inputs', inputs, '--dry-run'],
      inputs,
    );
    expect(dry.status).toBe(0);
    expect(JSON.parse(dry.stdout)).toEqual({
      ok: true,
      job_id: 'trn_test1',
      base_model: BASE,
      examples: 2,
      trained_turns: 2,
      categories: { orders: 2 },
      lora: { r: 16, alpha: 32 },
      max_seconds: built.max_seconds,
    });
  });

  it('refuses inputs that changed after the job was made', () => {
    const { recipe, job: built } = job();
    const inputs = join(dir, 'inputs');
    writeTrainerInputs(inputs, built, recipe, dataset());
    const examples = join(inputs, 'examples.jsonl');
    writeFileSync(examples, readFileSync(examples, 'utf8').replace('1182', '1183'));
    const dry = run(
      ['pipeline.py', '--job', join(inputs, 'job.json'), '--inputs', inputs, '--dry-run'],
      inputs,
    );
    expect(dry.status).toBe(2);
    expect(JSON.parse(dry.stdout)).toEqual({
      ok: false,
      error: 'examples.jsonl is not the dataset the job was made from',
    });

    writeTrainerInputs(inputs, built, recipe, dataset());
    const recipeFile = join(inputs, 'recipe.json');
    writeFileSync(recipeFile, readFileSync(recipeFile, 'utf8').replace('"r": 16', '"r": 64'));
    const tampered = run(
      ['pipeline.py', '--job', join(inputs, 'job.json'), '--inputs', inputs, '--dry-run'],
      inputs,
    );
    expect(JSON.parse(tampered.stdout)).toMatchObject({
      ok: false,
      error: 'recipe.json is not the recipe the job was made from',
    });
  });
});
