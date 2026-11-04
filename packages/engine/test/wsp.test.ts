import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import {
  WSP_DEFAULT_LIMITS,
  WspExperimentSchema,
  type WspExample,
  type WspExperiment,
  type WspMeasurement,
} from '@architect/shared';
import { describe, expect, it } from 'vitest';
import { releaseMentor } from '../src/vault/gate';
import { Vault } from '../src/vault/vault';
import { compare, measure, passes, repeats } from '../src/wsp/metrics';
import { inspectModelFolder, safetensorsHeader } from '../src/wsp/models';
import { wspResult } from '../src/wsp/result';
import { WspService } from '../src/wsp/service';
import { standInMentor } from '../src/wsp/stand-in';
import { splitExamples } from '../src/wsp/store';
import { runKernel } from '../src/wsp/worker';

const SOURCE = resolve(import.meta.dirname, '..', '..', '..', 'trainer', 'wsp');

function temp(): string {
  return mkdtempSync(join(tmpdir(), 'wsp-'));
}

/** A safetensors file of float32 tensors, written byte by byte. */
function writeSafetensors(path: string, tensors: Record<string, { shape: number[]; values: number[] }>): void {
  const header: Record<string, unknown> = { __metadata__: { format: 'pt' } };
  let offset = 0;
  const parts: Buffer[] = [];
  for (const [name, tensor] of Object.entries(tensors)) {
    const data = Buffer.from(new Float32Array(tensor.values).buffer);
    header[name] = { dtype: 'F32', shape: tensor.shape, data_offsets: [offset, offset + data.length] };
    offset += data.length;
    parts.push(data);
  }
  let json = JSON.stringify(header);
  while ((json.length + 8) % 8 !== 0) json += ' ';
  const size = Buffer.alloc(8);
  size.writeBigUInt64LE(BigInt(json.length));
  writeFileSync(path, Buffer.concat([size, Buffer.from(json), ...parts]));
}

/** A tiny checkpoint folder: two layers' down projections, an embedding and a config. */
function tinyModel(dir: string): string {
  mkdirSync(dir, { recursive: true });
  const values = (n: number) => Array.from({ length: n }, (_, i) => Math.sin(i + 1));
  writeSafetensors(join(dir, 'model.safetensors'), {
    'model.embed_tokens.weight': { shape: [8, 4], values: values(32) },
    'model.layers.0.mlp.down_proj.weight': { shape: [4, 6], values: values(24) },
    'model.layers.1.mlp.down_proj.weight': { shape: [4, 6], values: values(24) },
  });
  writeFileSync(
    join(dir, 'config.json'),
    JSON.stringify({ architectures: ['TinyForCausalLM'], num_hidden_layers: 2 }),
  );
  return dir;
}

const examples = (n: number): WspExample[] =>
  Array.from({ length: n }, (_, i) => ({
    prompt: `Problem number ${1000 + i}: what is ${i} plus ${i}?`,
    check: { kind: 'number', value: String(2 * i) },
  }));

describe('scoring outputs', () => {
  it('checks each kind deterministically', () => {
    expect(passes({ kind: 'number', value: '1,115' }, 'So it is 1115 days.')).toBe(true);
    expect(passes({ kind: 'number', value: '42' }, '40 then 42.0')).toBe(true);
    expect(passes({ kind: 'number', value: '42' }, '42 then 41')).toBe(false);
    expect(passes({ kind: 'contains', value: 'Paris' }, 'It is paris.')).toBe(true);
    expect(passes({ kind: 'exact', value: 'Yes' }, ' yes ')).toBe(true);
    expect(passes({ kind: 'regex', value: '^a+b$' }, 'aaab')).toBe(true);
    expect(passes({ kind: 'regex', value: '(' }, 'anything')).toBe(false);
  });

  it('tells repetition from ordinary text', () => {
    expect(repeats('Hello, hello, hello, '.repeat(20))).toBe(true);
    expect(repeats('one\none\none\n')).toBe(true);
    expect(
      repeats(
        'The train goes 60 km an hour for four hours, which is 240 km, then 45 km an hour for two hours, which is 90 km, so 330 km in all.',
      ),
    ).toBe(false);
  });

  it('measures and compares arms example by example', () => {
    const items = examples(10);
    const right = items.map((example) => ({ text: example.check!.value, tokens: 3, cutOff: false }));
    const wrong = items.map(() => ({ text: 'no idea', tokens: 2, cutOff: false }));
    const half = items.map((example, i) => (i < 5 ? right[i]! : wrong[i]!));
    const candidate = measure('candidate', 'dev', items, right, 1, 'wspc-00000000000000000000');
    const base = measure('base', 'dev', items, half, 1);
    expect(candidate.passed).toBe(10);
    expect(base.passed).toBe(5);
    const difference = compare(candidate, base, 'pass_rate')!;
    expect(difference.points).toBe(50);
    expect(difference.low).toBeGreaterThan(0);
    expect(difference.n).toBe(10);
  });
});

describe('the split', () => {
  it('is the same for the same seed, disjoint, and leaves four of each at least', () => {
    const items = examples(12);
    const a = splitExamples(items, 7);
    const b = splitExamples(items, 7);
    expect(a).toEqual(b);
    expect(a.qualification.length).toBeGreaterThanOrEqual(4);
    expect(a.dev.length).toBeGreaterThanOrEqual(4);
    expect(a.practice.length).toBeGreaterThanOrEqual(4);
    const all = [...a.practice, ...a.dev, ...a.qualification].map((item) => item.prompt);
    expect(new Set(all).size).toBe(12);
  });
});

describe('sealed examples in the vault', () => {
  it('open only with proof that the mentor was released, and are caught in outgoing text', async () => {
    const vault = new Vault(temp());
    const sealed = examples(4);
    vault.sealWsp('wsp-abcdef12', sealed);
    expect(() => vault.sealWsp('wsp-abcdef12', sealed)).toThrow(/already sealed/);
    expect(() => vault.openWsp('wsp-abcdef12', {} as never)).toThrow(/mentor is released/);
    expect(vault.wspLeaks('wsp-abcdef12', `Here: ${sealed[2]!.prompt.toUpperCase()}`)).toBe(true);
    expect(vault.wspLeaks('wsp-abcdef12', 'Nothing sealed here.')).toBe(false);
    const proof = await releaseMentor({ dispose: () => undefined });
    expect(vault.openWsp('wsp-abcdef12', proof)).toEqual(sealed);
  });
});

describe('model folders', () => {
  it('reads shapes from the safetensors header and says what keeps a folder out', () => {
    const dir = tinyModel(join(temp(), 'tiny'));
    expect(safetensorsHeader(join(dir, 'model.safetensors'))['model.layers.0.mlp.down_proj.weight']).toEqual({
      dtype: 'F32',
      shape: [4, 6],
    });
    const model = inspectModelFolder(dir, {}, 64);
    expect(model.parameters).toBe(32 + 24 + 24);
    expect(model.compatibility.supported).toBe(true);
    const empty = temp();
    writeFileSync(join(empty, 'model.gguf'), 'x');
    const refused = inspectModelFolder(empty, {}, 64);
    expect(refused.compatibility.supported).toBe(false);
    expect(refused.compatibility.reasons.join(' ')).toMatch(/config\.json/);
    expect(refused.compatibility.reasons.join(' ')).toMatch(/safetensors/);
  });

  it('names a cache snapshot by its repository and revision', () => {
    const revision = 'c1899de289a04d12100db370d81485cdf75e47ca';
    const dir = tinyModel(join(temp(), 'models--Qwen--Qwen3-0.6B', 'snapshots', revision));
    const model = inspectModelFolder(dir, {}, 64);
    expect(model.repo).toBe('Qwen/Qwen3-0.6B');
    expect(model.revision).toBe(revision);
  });
});

function measured(arm: WspMeasurement['arm'], passed: boolean[], candidateId?: string): WspMeasurement {
  const items = examples(passed.length);
  return measure(
    arm,
    'dev',
    items,
    items.map((example, i) => ({ text: passed[i] ? example.check!.value : 'no', tokens: 1, cutOff: false })),
    1,
    candidateId,
  );
}

function evaluated(measurements: WspMeasurement[], frozen: string | null): WspExperiment {
  return {
    brief: {
      target: { metric: 'pass_rate', minPoints: 10 },
      controls: { decoding: { temperature: 0, topP: 1, repetitionPenalty: 1.1, maxNewTokens: 64 }, instructions: null },
    },
    frozen: frozen === null ? null : { candidateId: frozen, digest: 'a'.repeat(64), at: '2026-11-04T00:00:00.000Z' },
    measurements,
    iterations: [],
  } as unknown as WspExperiment;
}

describe('the verdict', () => {
  const id = 'wspc-11111111111111111111';
  const all = Array<boolean>(20).fill(true);
  const quarter = all.map((_, i) => i < 5);

  it('calls a clear gain past the target, ahead of the controls, improved', () => {
    const result = wspResult(evaluated([measured('base', quarter), measured('decoding', quarter), measured('candidate', all, id)], id), 'dev');
    expect(result.verdict).toBe('improved');
    expect(result.notRun.map((item) => item.arm)).toContain('Fine-tuning (QLoRA)');
    expect(result.deployment.status).toBe('not-verified');
  });

  it("doesn't credit the edit when a control does as well", () => {
    const result = wspResult(evaluated([measured('base', quarter), measured('decoding', all), measured('candidate', all, id)], id), 'dev');
    expect(result.verdict).toBe('not-established');
    expect(result.summary).toMatch(/decoding control/);
  });

  it('says so when nothing was kept, and lists examples the candidate lost', () => {
    expect(wspResult(evaluated([measured('base', quarter)], null), 'dev').verdict).toBe('no-candidate');
    const worse = wspResult(evaluated([measured('base', all), measured('decoding', all), measured('candidate', quarter, id)], id), 'dev');
    expect(worse.verdict).toBe('regressed');
    expect(worse.regressions.join(' ')).toMatch(/15 examples the base passed/);
  });
});

describe('the service without a worker', () => {
  function service(dir: string, sourceDir = join(dir, 'no-worker')) {
    return new WspService({
      dir: join(dir, 'wsp'),
      sourceDir,
      vault: new Vault(dir),
      connectMentor: () => Promise.resolve(standInMentor()),
      mentorStatus: () =>
        Promise.resolve({
          mentor: { label: 'Stand-in mentor', provider: 'openai', model: 'scripted', reasoningEffort: 'high', standIn: true },
          status: 'ready',
        }),
    });
  }

  const draftInput = (model: string, count = 14) => ({
    modelPath: model,
    goal: { task: 'Add two numbers.', examples: examples(count) },
    compute: 'local-cpu' as const,
    limits: WSP_DEFAULT_LIMITS,
    reasoningEffort: 'high' as const,
  });

  const settled = async (wsp: WspService, id: string) => {
    for (let i = 0; i < 100 && wsp.get(id).status === 'briefing'; i += 1) {
      await new Promise((r) => setTimeout(r, 20));
    }
    return wsp.get(id);
  };

  it('drafts a brief, seals the qualification split apart, and keeps the base read only', async () => {
    const dir = temp();
    const model = tinyModel(join(dir, 'tiny'));
    const before = readFileSync(join(model, 'model.safetensors'));
    const wsp = service(dir);
    const drafted = await wsp.draft(draftInput(model));
    const experiment = await settled(wsp, drafted.id);
    expect(WspExperimentSchema.parse(experiment).status).toBe('brief');
    expect(experiment.brief?.target.metric).toBe('pass_rate');
    expect(experiment.mentor.standIn).toBe(true);
    expect(experiment.goal.examples).toEqual([]);
    expect(experiment.split.qualification).toBeGreaterThanOrEqual(4);
    const stored = readFileSync(join(dir, 'wsp', 'experiments', drafted.id, 'examples.json'), 'utf8');
    const sealed = readFileSync(join(dir, 'wsp', drafted.id, 'qualification.jsonl'), 'utf8');
    for (const line of sealed.trim().split('\n')) {
      expect(stored).not.toContain((JSON.parse(line) as WspExample).prompt);
    }
    expect(experiment.base.files.map((file) => file.name)).toEqual(['config.json', 'model.safetensors']);
    expect(readFileSync(join(model, 'model.safetensors'))).toEqual(before);
  });

  it('refuses too few examples, a duplicate prompt and an unsupported compute target', async () => {
    const dir = temp();
    const model = tinyModel(join(dir, 'tiny'));
    const wsp = service(dir);
    await expect(wsp.draft(draftInput(model, 6))).rejects.toThrow(/at least 12/);
    const twice = draftInput(model);
    twice.goal.examples.push({ ...twice.goal.examples[0]! });
    await expect(wsp.draft(twice)).rejects.toThrow(/there twice/);
    await expect(wsp.draft({ ...draftInput(model), compute: 'hf-jobs' as never })).rejects.toThrow(/turn by turn/);
  });

  it('fails a start plainly when the worker is missing, and freezes the brief once started', async () => {
    const dir = temp();
    const model = tinyModel(join(dir, 'tiny'));
    const wsp = service(dir);
    const drafted = await settled(wsp, (await wsp.draft(draftInput(model))).id);
    const started = wsp.start(drafted.id);
    expect(started.approval?.briefSha256).toMatch(/^[0-9a-f]{64}$/);
    expect(() => wsp.revise(drafted.id, drafted.brief!, 'New title')).toThrow(/approved/);
    for (let i = 0; i < 100 && wsp.get(drafted.id).status === 'running'; i += 1) {
      await new Promise((r) => setTimeout(r, 20));
    }
    const failed = wsp.get(drafted.id);
    expect(failed.status).toBe('failed');
    expect(failed.error).toMatch(/WSP worker|carry the WSP worker/);
    expect(wsp.computeTargets().find((target) => target.id === 'hf-jobs')?.status).toBe('unsupported');
  });

  it('turns a run left running when the app closed into an interrupted one', async () => {
    const dir = temp();
    const model = tinyModel(join(dir, 'tiny'));
    const wsp = service(dir);
    const drafted = await settled(wsp, (await wsp.draft(draftInput(model))).id);
    const path = join(dir, 'wsp', 'experiments', drafted.id, 'experiment.json');
    const record = JSON.parse(readFileSync(path, 'utf8')) as WspExperiment;
    writeFileSync(path, JSON.stringify({ ...record, status: 'running' }));
    const reopened = service(dir);
    reopened.recover();
    expect(reopened.get(drafted.id).status).toBe('interrupted');
  });
});

/*
 * The guard runs in the real kernel only where a worker environment is installed: set
 * WSP_TEST_PYTHON_ENV to one (trainer/wsp/requirements.txt). CI has none, so it skips there.
 */
const env = process.env['WSP_TEST_PYTHON_ENV'];
const python = env === undefined ? undefined : join(env, process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python');
describe.skipIf(python === undefined || !existsSync(python) || spawnSync(python, ['-c', 'import torch']).status !== 0)(
  'the kernel and its guard',
  () => {
    it('refuses the network, processes, other files and protected tensors, and hands back a checked edit', async () => {
      const dir = temp();
      const model = tinyModel(join(dir, 'tiny'));
      const out = join(dir, 'out');
      mkdirSync(out);
      const program = join(dir, 'program.py');
      writeFileSync(
        program,
        `for attempt in ["import socket", "import subprocess", "import ctypes", "import os; os.system('echo hi')", "open('${join(dir, 'secret.txt').split('\\').join('/')}').read()", "open('../escape.txt', 'w')", "torch.save({}, 'x.pt')", "save_edit('model.embed_tokens.weight', weights.get('model.embed_tokens.weight') + 1)"]:
    try:
        exec(attempt)
        print("ALLOWED", attempt)
    except Exception as error:
        print("refused", type(error).__name__)
W = weights.get("model.layers.1.mlp.down_proj.weight")
u = torch.ones(4) / 2
save_edit("model.layers.1.mlp.down_proj.weight", W - torch.outer(u, u @ W))
`,
      );
      writeFileSync(join(dir, 'secret.txt'), 'a key');
      const outcome = await runKernel(
        { sourceDir: SOURCE, envDir: env! },
        {
          base: model,
          program,
          incumbent: null,
          out,
          scratch: join(dir, 'scratch'),
          reads: join(dir, 'reads'),
          practice: [],
          memoryBytes: 4 * 1024 ** 3,
        },
        join(dir, 'request.json'),
        { timeoutMs: 120_000, tempDir: join(dir, 'tmp') },
      );
      expect(outcome.kind).toBe('done');
      if (outcome.kind !== 'done') return;
      expect(outcome.result.error).toBeNull();
      expect(outcome.result.output).not.toContain('ALLOWED');
      expect(outcome.result.output.match(/refused/g)?.length).toBe(8);
      expect(outcome.result.refused.join(' ')).toMatch(/embedding, output head and final norm/);
      expect(Object.keys(outcome.result.edits!.files)).toEqual(['model.layers.1.mlp.down_proj.weight']);
      expect(existsSync(join(dir, 'escape.txt'))).toBe(false);
    }, 180_000);

    it('stops a program at its time limit', async () => {
      const dir = temp();
      const model = tinyModel(join(dir, 'tiny'));
      const program = join(dir, 'program.py');
      writeFileSync(program, 'while True:\n    pass\n');
      const outcome = await runKernel(
        { sourceDir: SOURCE, envDir: env! },
        {
          base: model,
          program,
          incumbent: null,
          out: join(dir, 'out'),
          scratch: join(dir, 'scratch'),
          reads: join(dir, 'reads'),
          practice: [],
          memoryBytes: 4 * 1024 ** 3,
        },
        join(dir, 'request.json'),
        { timeoutMs: 8_000, tempDir: join(dir, 'tmp') },
      );
      expect(outcome.kind).toBe('timeout');
    }, 60_000);
  },
);
