import { spawnSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { TrainBundleSchema, type ModelConfig, type TrainBundle } from '@architect/shared';
import { afterEach, describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import {
  BUNDLE_CLAIM,
  BundleError,
  planTraining,
  PYTORCHJOB_FILE,
  SBATCH_FILE,
  writeTrainBundle,
  type TrainingPlanInput,
} from '../src/training-plan';

const ROOT = join(import.meta.dirname, '..', '..', '..');
const TRAINER = join(ROOT, 'trainer');
const REVISION = 'a'.repeat(40);
const config = (name: string): ModelConfig =>
  JSON.parse(
    readFileSync(join(import.meta.dirname, 'fixtures', 'model-configs', `${name}.json`), 'utf8'),
  ) as ModelConfig;

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});
function temp(): string {
  const dir = mkdtempSync(join(tmpdir(), 'architect-bundle-'));
  dirs.push(dir);
  return dir;
}

const PLAN_INPUT: TrainingPlanInput = {
  model: { repo: 'lab/moe-235b', revision: REVISION },
  method: 'lora',
  precision: 'bf16',
  gpu: { name: 'h100-80gb', memoryGb: 80 },
  seqLen: 4096,
  microBatch: 1,
  gpusPerNode: 8,
  loraRank: 16,
};

/** A field export as `architect field export` lays it out, with material that must stay out. */
function fieldExport(): string {
  const dir = temp();
  mkdirSync(join(dir, 'sft'));
  mkdirSync(join(dir, 'env'));
  mkdirSync(join(dir, 'eval'));
  writeFileSync(join(dir, 'MANIFEST.json'), JSON.stringify({ hash: 'field-hash-1', counts: {} }));
  writeFileSync(
    join(dir, 'sft', 'demonstrations.jsonl'),
    `${JSON.stringify({
      messages: [
        { role: 'user', content: 'hi' },
        { role: 'assistant', content: 'hello' },
      ],
    })}\n`,
  );
  writeFileSync(join(dir, 'env', 'tasks.jsonl'), 'train tasks\n');
  writeFileSync(join(dir, 'eval', 'sealed.json'), '{"sealed":"by hash only"}');
  return dir;
}

function bundleFor(target: 'slurm' | 'kubernetes') {
  const out = join(temp(), 'bundle');
  const written = writeTrainBundle({
    target,
    plan: planTraining(config('moe-235b'), PLAN_INPUT),
    trainerDir: TRAINER,
    exportDir: fieldExport(),
    outputDir: out,
  });
  return { out, written };
}

/** A bash that can check syntax here: the one on PATH, or Git's on Windows. */
function findBash(): string | null {
  const candidates = ['bash', 'C:/Program Files/Git/bin/bash.exe'];
  for (const candidate of candidates) {
    const probe = spawnSync(candidate, ['-c', 'echo ok'], { encoding: 'utf8' });
    if (probe.status === 0 && probe.stdout.trim() === 'ok') return candidate;
  }
  return null;
}

function findPython(): string | null {
  for (const candidate of ['python3', 'python']) {
    const probe = spawnSync(candidate, ['-c', 'import sys; print(sys.version_info[0])'], {
      encoding: 'utf8',
    });
    if (probe.status === 0 && probe.stdout.trim() === '3') return candidate;
  }
  return null;
}

const BASH = findBash();
const PYTHON = findPython();

/**
 * A stand-in for Slurm's sbatch: checks the script's directives as sbatch reads them (before
 * the first command), that the job asks for the bundle's nodes and GPUs, and that what it runs
 * is in the folder. It submits nothing.
 */
function fakeSbatch(argv: string[], cwd: string, bundle: TrainBundle): string {
  expect(argv[0]).toBe('sbatch');
  const script = readFileSync(join(cwd, argv.at(-1) ?? ''), 'utf8');
  const lines = script.split('\n');
  expect(lines[0]).toBe('#!/bin/bash');
  const directives = new Map<string, string>();
  for (const line of lines.slice(1)) {
    if (line.trim() === '') continue;
    if (!line.startsWith('#')) break;
    const match = /^#SBATCH --([a-z-]+)(?:=(\S+))?$/.exec(line);
    if (match) directives.set(match[1] ?? '', match[2] ?? '');
  }
  const known = ['job-name', 'nodes', 'ntasks-per-node', 'gpus-per-node', 'exclusive', 'output'];
  for (const name of directives.keys()) expect(known).toContain(name);
  expect(Number(directives.get('nodes'))).toBe(bundle.nodes);
  expect(Number(directives.get('gpus-per-node'))).toBe(bundle.gpus_per_node);
  expect(directives.get('ntasks-per-node')).toBe('1');
  expect(script).toContain('--rdzv_backend=c10d');
  expect(script).toContain('${SLURM_JOB_NODELIST}');
  for (const file of ['train_fsdp.py', 'train.json']) {
    expect(script).toContain(file);
    expect(existsSync(join(cwd, file))).toBe(true);
  }
  return 'Submitted batch job 1001';
}

/** A stand-in for kubectl apply: checks the PyTorchJob as the training operator reads it. */
function fakeKubectl(argv: string[], cwd: string, bundle: TrainBundle): string {
  expect(argv.slice(0, 3)).toEqual(['kubectl', 'apply', '-f']);
  const job = parse(readFileSync(join(cwd, argv[3] ?? ''), 'utf8')) as {
    apiVersion: string;
    kind: string;
    metadata: { name: string; annotations: Record<string, string> };
    spec: {
      pytorchReplicaSpecs: Record<string, { replicas: number; template: { spec: PodSpec } }>;
    };
  };
  interface PodSpec {
    containers: {
      name: string;
      image: string;
      command: string[];
      resources: { limits: Record<string, number> };
      volumeMounts: { name: string; mountPath: string }[];
    }[];
    volumes: { name: string; persistentVolumeClaim?: { claimName: string } }[];
  }
  expect(job.apiVersion).toBe('kubeflow.org/v1');
  expect(job.kind).toBe('PyTorchJob');
  expect(job.metadata.name).toMatch(/^[a-z0-9]([-a-z0-9]*[a-z0-9])?$/);
  for (const value of Object.values(job.metadata.annotations)) expect(typeof value).toBe('string');
  const specs = job.spec.pytorchReplicaSpecs;
  expect(Object.keys(specs).sort()).toEqual(bundle.nodes > 1 ? ['Master', 'Worker'] : ['Master']);
  expect(specs['Master']?.replicas).toBe(1);
  const replicas = Object.values(specs).reduce((sum, spec) => sum + spec.replicas, 0);
  expect(replicas).toBe(bundle.nodes);
  for (const spec of Object.values(specs)) {
    const [container] = spec.template.spec.containers;
    expect(container?.name).toBe('pytorch');
    expect(container?.image).toMatch(/@sha256:[0-9a-f]{64}$/);
    expect(container?.resources.limits['nvidia.com/gpu']).toBe(bundle.gpus_per_node);
    expect(container?.command.join(' ')).toContain(`--nnodes=${bundle.nodes}`);
    expect(container?.command.join(' ')).toContain(
      '/bundle/train_fsdp.py --config /bundle/train.json',
    );
    expect(spec.template.spec.volumes[0]?.persistentVolumeClaim?.claimName).toBe(BUNDLE_CLAIM);
  }
  return `pytorchjob.kubeflow.org/${job.metadata.name} created`;
}

/** The submit command exactly as the README gives it, split into arguments. */
function readmeCommand(dir: string, bundle: TrainBundle): string[] {
  const readme = readFileSync(join(dir, 'README.txt'), 'utf8');
  const line = readme.split('\n').find((entry) => entry.trim().endsWith(bundle.submit));
  if (!line) throw new Error('the README has no submit command');
  return bundle.submit.split(' ');
}

describe('a Slurm bundle', () => {
  it('writes the trainer, its settings, the data and an sbatch script, and traces back', () => {
    const { out, written } = bundleFor('slurm');
    const bundle = TrainBundleSchema.parse(
      JSON.parse(readFileSync(join(out, 'bundle.json'), 'utf8')),
    );
    expect(bundle).toMatchObject({
      target: 'slurm',
      base_model: { repo: 'lab/moe-235b', revision: REVISION },
      nodes: 2,
      gpus_per_node: 8,
      submit: `sbatch ${SBATCH_FILE}`,
    });
    expect(bundle.field_export?.declared_hash).toBe('field-hash-1');
    expect(bundle.field_export?.manifest_sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(bundle.recipe.files.map((file) => file.name)).toEqual([
      'chat_spans.py',
      'fsdp_config.json',
      'requirements.txt',
      'train.json',
      'train_fsdp.py',
    ]);
    expect(bundle.recipe.pins.name).toBe('glimmer-qlora');
    expect(written.files).toContain('data/demonstrations.jsonl');
    // Only the verified demonstrations travel: never the scorer's tasks or the sealed manifest.
    expect(readdirSync(out).sort()).toEqual(
      [
        'README.txt',
        'bundle.json',
        'chat_spans.py',
        'data',
        'fsdp_config.json',
        'plan.json',
        'requirements.txt',
        SBATCH_FILE,
        'train.json',
        'train_fsdp.py',
      ].sort(),
    );
    expect(readdirSync(join(out, 'data'))).toEqual(['demonstrations.jsonl']);
    const settings = JSON.parse(readFileSync(join(out, 'train.json'), 'utf8')) as {
      lora: { target_modules: string };
    };
    const targets = new RegExp(settings.lora.target_modules);
    for (const name of [
      'model.layers.0.self_attn.q_proj',
      'model.layers.3.mlp.experts.17.down_proj',
      'model.layers.3.block_sparse_moe.experts.2.w1',
    ]) {
      expect(targets.test(name)).toBe(true);
    }
    for (const name of ['model.layers.3.mlp.gate', 'lm_head', 'model.embed_tokens']) {
      expect(targets.test(name)).toBe(false);
    }
  });

  it('says what it is and how to submit it, in the plan’s words, with no credentials', () => {
    const { out, written } = bundleFor('slurm');
    const readme = readFileSync(join(out, 'README.txt'), 'utf8');
    expect(readme.startsWith('EXPERIMENTAL, NOT RUN')).toBe(true);
    expect(readme).toContain(
      'Experimental cluster templates are validated structurally and against simulated schedulers; GPU execution, large-model compatibility and training gains remain unverified.',
    );
    expect(readme).toContain('sbatch submit.sbatch');
    expect(readFileSync(join(out, 'train_fsdp.py'), 'utf8')).toMatch(/^"""EXPERIMENTAL, NOT RUN\./);
    for (const file of written.files) {
      expect(readFileSync(join(out, file), 'utf8')).not.toMatch(/hf_[A-Za-z0-9]{20,}|HF_TOKEN=\S/);
    }
  });

  it.skipIf(BASH === null)('is a script bash can parse', () => {
    const { out } = bundleFor('slurm');
    const check = spawnSync(BASH ?? 'bash', ['-n'], {
      input: readFileSync(join(out, SBATCH_FILE), 'utf8'),
      encoding: 'utf8',
    });
    expect(check.stderr).toBe('');
    expect(check.status).toBe(0);
  });

  it('is accepted by a stand-in sbatch, run with the README’s command', () => {
    const { out, written } = bundleFor('slurm');
    expect(fakeSbatch(readmeCommand(out, written.bundle), out, written.bundle)).toMatch(
      /^Submitted batch job \d+$/,
    );
  });
});

describe('a Kubernetes bundle', () => {
  it('is a PyTorchJob that parses, with one master and a worker per further node', () => {
    const { out, written } = bundleFor('kubernetes');
    expect(written.bundle.submit).toBe(`kubectl apply -f ${PYTORCHJOB_FILE}`);
    expect(fakeKubectl(readmeCommand(out, written.bundle), out, written.bundle)).toMatch(
      /created$/,
    );
    const text = readFileSync(join(out, PYTORCHJOB_FILE), 'utf8');
    expect(text.startsWith('# EXPERIMENTAL, NOT RUN')).toBe(true);
  });
});

describe('the experimental trainer', () => {
  it.skipIf(PYTHON === null)('compiles, with the chat spans it imports', () => {
    const { out } = bundleFor('slurm');
    const compiled = spawnSync(
      PYTHON ?? 'python3',
      ['-m', 'py_compile', join(out, 'train_fsdp.py'), join(out, 'chat_spans.py')],
      { encoding: 'utf8' },
    );
    expect(compiled.stderr).toBe('');
    expect(compiled.status).toBe(0);
  });
});

describe('what a bundle refuses', () => {
  it('needs a commit, a plan that fits, an empty folder and a real export', () => {
    const plan = planTraining(config('moe-235b'), PLAN_INPUT);
    const base = { target: 'slurm' as const, trainerDir: TRAINER, exportDir: null };
    expect(() =>
      writeTrainBundle({
        ...base,
        plan: planTraining(config('moe-235b'), {
          ...PLAN_INPUT,
          model: { repo: 'lab/m', revision: 'main' },
        }),
        outputDir: join(temp(), 'b'),
      }),
    ).toThrow(/40-character commit/);
    expect(() =>
      writeTrainBundle({
        ...base,
        plan: planTraining(config('moe-235b'), {
          ...PLAN_INPUT,
          gpu: { name: 'a100-40gb', memoryGb: 40 },
          seqLen: 131072,
          microBatch: 4,
        }),
        outputDir: join(temp(), 'b'),
      }),
    ).toThrow(BundleError);
    const full = temp();
    writeFileSync(join(full, 'x'), '');
    expect(() => writeTrainBundle({ ...base, plan, outputDir: full })).toThrow(/isn't empty/);
    expect(() =>
      writeTrainBundle({ ...base, plan, exportDir: temp(), outputDir: join(temp(), 'b') }),
    ).toThrow(/no sft/);
  });

  it('writes a bundle without an export, recording that it has none', () => {
    const out = join(temp(), 'b');
    const { bundle } = writeTrainBundle({
      target: 'kubernetes',
      plan: planTraining(config('small-1b'), PLAN_INPUT),
      trainerDir: TRAINER,
      exportDir: null,
      outputDir: out,
    });
    expect(bundle.field_export).toBeNull();
    expect(bundle.nodes).toBe(1);
    expect(readFileSync(join(out, 'README.txt'), 'utf8')).toContain('put chat examples in data/');
  });
});
