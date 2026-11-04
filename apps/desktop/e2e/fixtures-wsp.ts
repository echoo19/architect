import { createHash } from 'node:crypto';
import {
  WSP_DEFAULT_DECODING,
  WSP_DEFAULT_LIMITS,
  WSP_EXPERIMENT_FORMAT,
  WSP_ZERO_COSTS,
  WspComputeTargetSchema,
  WspExperimentSchema,
  WspMentorStatusSchema,
  WspModelSchema,
  WspWorkerStatusSchema,
  type WspBrief,
  type WspExample,
  type WspExperiment,
  type WspIteration,
  type WspMeasurement,
  type WspMentor,
} from '@architect/shared';
import type { ElectronApplication } from '@playwright/test';
import { stubEngine } from './fixtures';
import { stubByKey } from './fixtures-flow';

/*
 * Architect WSP's records for its screens (decision 109): models found on this computer, where an
 * experiment can run, the worker and the mentor, and an experiment in each state. Each is parsed
 * with the shared schemas, so none can drift from the contract. They are fixtures for screens,
 * not measurements: every finished experiment that reports an improvement ran on the scripted
 * stand-in mentor, and says so on screen.
 */

const sha = (seed: string) => createHash('sha256').update(seed).digest('hex');
const commit = (seed: string) => sha(seed).slice(0, 40);
const candidateId = (seed: string) => `wspc-${sha(seed).slice(0, 20)}`;

const QWEN_REVISION = commit('qwen3-0.6b');
const QWEN_PATH = `C:/Users/researcher/.cache/huggingface/hub/models--Qwen--Qwen3-0.6B/snapshots/${QWEN_REVISION}`;

export const WSP_MODELS = WspModelSchema.array().parse([
  {
    repo: 'Qwen/Qwen3-0.6B',
    revision: QWEN_REVISION,
    path: QWEN_PATH,
    name: 'Qwen3-0.6B',
    architecture: 'Qwen3ForCausalLM',
    parameters: 596_049_920,
    dtype: 'bf16',
    layers: 28,
    bytes: 1_610_612_736,
    compatibility: { supported: true, reasons: [] },
    memoryGb: 4.2,
  },
  {
    path: 'D:/models/qwen3-0.6b-gguf',
    name: 'qwen3-0.6b-gguf',
    architecture: null,
    parameters: 0,
    dtype: null,
    layers: null,
    bytes: 639_000_000,
    compatibility: { supported: false, reasons: ['No .safetensors weights'] },
    memoryGb: 0,
  },
]);

/** A folder picked with Choose a folder: the same Qwen checkpoint, copied elsewhere. */
export const WSP_PICKED_MODEL = WspModelSchema.parse({
  ...WSP_MODELS[0],
  repo: undefined,
  revision: undefined,
  path: 'D:/checkpoints/qwen3-0.6b-copy',
  name: 'qwen3-0.6b-copy',
});

export const WSP_COMPUTE = WspComputeTargetSchema.array().parse([
  { id: 'local-cpu', label: 'This computer', status: 'ready', threads: 16, memoryGb: 32 },
  {
    id: 'hf-jobs',
    label: 'Hugging Face Jobs',
    status: 'unsupported',
    reason: "A batch job can't answer the runner turn by turn",
  },
  {
    id: 'slurm',
    label: 'Slurm',
    status: 'unsupported',
    reason: "A batch job can't answer the runner turn by turn",
  },
  {
    id: 'kubernetes',
    label: 'Kubernetes',
    status: 'unsupported',
    reason: 'A pod would need a way back to the runner for every turn',
  },
  {
    id: 'skypilot',
    label: 'SkyPilot',
    status: 'unsupported',
    reason: "A launched cluster can't answer the runner turn by turn",
  },
]);

export const WSP_WORKER_READY = WspWorkerStatusSchema.parse({
  status: 'ready',
  python: '3.12.7',
});
export const WSP_WORKER_NEEDS_SETUP = WspWorkerStatusSchema.parse({
  status: 'needs-setup',
  reason: 'Its pinned packages are not installed yet',
});

/** The mentor as the engine names it. Its model is a fixture's, never a real id. */
const MENTOR: WspMentor = {
  label: 'GPT-6 Astra',
  provider: 'openai',
  model: 'fixture-mentor',
  reasoningEffort: 'high',
  standIn: false,
};
const STAND_IN: WspMentor = {
  label: 'Stand-in mentor',
  provider: 'openai',
  model: 'scripted',
  reasoningEffort: 'high',
  standIn: true,
};

export const WSP_MENTOR_READY = WspMentorStatusSchema.parse({ mentor: MENTOR, status: 'ready' });
export const WSP_MENTOR_MISSING = WspMentorStatusSchema.parse({
  mentor: MENTOR,
  status: 'missing-key',
  reason: 'No OpenAI key is saved',
});

/** Twenty-four prompts that tend to loop, half of them with a check. */
export const WSP_EXAMPLES: WspExample[] = Array.from({ length: 24 }, (_, index) =>
  index % 2 === 0
    ? {
        prompt: `List ${index + 3} different uses for a paperclip, one per line.`,
        check: { kind: 'regex', value: `^(?:.*\\n){${index + 2}}.*$` },
      }
    : { prompt: `Write a short paragraph about tide pool number ${index}.` },
);

const BRIEF: WspBrief = {
  objective: 'Cut the share of long answers that repeat a sentence, without losing correct lists.',
  baseline: 'Measure the base, a repetition penalty of 1.15 and a system instruction on dev.',
  investigation:
    'Find the attention heads in layers 20 to 27 whose output grows on a repeated span, then damp their value projections in proportion.',
  successCriteria: ['Loop rate on dev falls by at least 15 points against the base'],
  regressionChecks: [
    'Pass rate on checked list prompts does not fall',
    'Mean length stays within 20%',
  ],
  expectedOutput: 'One candidate that changes under 1% of the weights, frozen for qualification.',
  target: { metric: 'loop_rate', minPoints: 15 },
  controls: {
    decoding: { ...WSP_DEFAULT_DECODING, repetitionPenalty: 1.15 },
    instructions: 'Never repeat a sentence you have already written.',
  },
};

const outcomes = (n: number, passed: number, looped: number) =>
  Array.from({ length: n }, (_, index) => ({
    passed: index < 3 ? index < passed : null,
    looped: index < looped,
  }));

function measurement(
  arm: WspMeasurement['arm'],
  split: WspMeasurement['split'],
  passed: number,
  looped: number,
  candidate?: string,
): WspMeasurement {
  return {
    arm,
    split,
    ...(candidate ? { candidateId: candidate } : {}),
    n: 6,
    passed,
    checked: 3,
    looped,
    cutOff: looped,
    meanTokens: 160 - looped * 6,
    seconds: 41,
    outcomes: outcomes(6, passed, looped),
  };
}

const FIRST = candidateId('first');
const SECOND = candidateId('second');

const ITERATIONS: WspIteration[] = [
  {
    n: 1,
    hypothesis: 'Repetition comes from a few late heads that copy the previous sentence.',
    expected: 'Per-head attention to the last repeated span in layers 20 to 27.',
    programSha256: sha('program-1'),
    outcome: 'inspected',
    output: 'layer 23 head 5: 0.61 on repeated span\nlayer 25 head 2: 0.48\nothers under 0.12',
    mentorUsd: 0.21,
    startedAt: '2026-11-03T09:02:10.000Z',
    endedAt: '2026-11-03T09:03:02.000Z',
  },
  {
    n: 2,
    hypothesis: 'Damping the value projection of layer 23 head 5 will cut loops.',
    expected: 'Loop rate on dev falls; list prompts unchanged.',
    programSha256: sha('program-2'),
    outcome: 'edit',
    output: 'scaled v_proj rows 320-383 of layer 23 by 0.7\nchanged 0.07% of weights',
    candidateId: FIRST,
    decision: 'kept',
    dev: measurement('candidate', 'dev', 3, 2, FIRST),
    mentorUsd: 0.34,
    startedAt: '2026-11-03T09:03:40.000Z',
    endedAt: '2026-11-03T09:06:12.000Z',
  },
  {
    n: 3,
    hypothesis: 'Zeroing layer 25 head 2 entirely would remove the rest.',
    expected: 'Fewer loops still.',
    programSha256: sha('program-3'),
    outcome: 'refused',
    output: 'would change 3.4% of weights',
    reason: 'It would change 3.4% of the weights, past the 1% cap.',
    mentorUsd: 0.18,
    startedAt: '2026-11-03T09:06:40.000Z',
    endedAt: '2026-11-03T09:07:01.000Z',
  },
];

const BASE_DEV = measurement('base', 'dev', 3, 4);
const CONTROLS_DEV = [
  measurement('decoding', 'dev', 2, 3),
  measurement('instructions', 'dev', 3, 4),
];

const BASE = {
  repo: 'Qwen/Qwen3-0.6B',
  revision: QWEN_REVISION,
  path: QWEN_PATH,
  name: 'Qwen3-0.6B',
  architecture: 'Qwen3ForCausalLM',
  parameters: 596_049_920,
  files: [
    { name: 'config.json', bytes: 726, sha256: sha('config.json') },
    { name: 'model.safetensors', bytes: 1_503_300_328, sha256: sha('model.safetensors') },
    { name: 'tokenizer.json', bytes: 11_422_654, sha256: sha('tokenizer.json') },
  ],
  digest: sha('qwen3-0.6b-base'),
};

const APPROVAL = { briefSha256: sha('brief'), at: '2026-11-03T09:00:00.000Z' };

function experiment(id: string, title: string, patch: Partial<WspExperiment>): WspExperiment {
  return WspExperimentSchema.parse({
    format: WSP_EXPERIMENT_FORMAT,
    id,
    title,
    createdAt: '2026-11-03T08:58:00.000Z',
    status: 'brief',
    stage: 'baseline',
    activity: '',
    base: BASE,
    goal: {
      task: 'Stop repeating the same sentence in long answers',
      constraints: 'Lists must stay correct',
      examples: WSP_EXAMPLES,
    },
    compute: 'local-cpu',
    limits: WSP_DEFAULT_LIMITS,
    mentor: MENTOR,
    brief: BRIEF,
    approval: null,
    split: { seed: 7, practice: 12, dev: 6, qualification: 6 },
    hypothesis: '',
    iterations: [],
    measurements: [],
    incumbent: null,
    frozen: null,
    costs: WSP_ZERO_COSTS,
    worker: null,
    result: null,
    ...patch,
  });
}

const RAN = {
  approval: APPROVAL,
  worker: {
    version: '0.1.0',
    python: '3.12.7',
    packages: ['torch==2.7.1', 'safetensors==0.6.2', 'transformers==4.57.1'],
    sourceSha256: sha('worker'),
  },
};

const COSTS = {
  ...WSP_ZERO_COSTS,
  mentorUsd: 0.73,
  mentorCalls: 4,
  inputTokens: 48_210,
  outputTokens: 9_870,
  computeSeconds: 612,
  forwardPasses: 9,
  programs: 3,
  wallSeconds: 1_140,
};

export const WSP_BRIEFING = experiment('wsp-tidepool1', 'Loops in long answers', {
  status: 'briefing',
  brief: null,
  activity: 'Reading the examples',
});

export const WSP_BRIEF = experiment('wsp-tidepool2', 'Loops in long answers', {});

export const WSP_DRAFT_FAILED = experiment('wsp-tidepool3', 'Loops in long answers', {
  status: 'failed',
  brief: null,
  error: 'The mentor stopped answering: the request timed out after 120 s.',
});

export const WSP_RUNNING = experiment('wsp-paperclip1', 'Loops in long answers', {
  ...RAN,
  status: 'running',
  stage: 'edit',
  activity: 'Program 4 is reading layer 25',
  hypothesis:
    'The remaining loops come from layer 25 head 2, which a smaller scale on its value projection should damp without the cap being passed.',
  iterations: ITERATIONS,
  measurements: [BASE_DEV, ...CONTROLS_DEV, measurement('candidate', 'dev', 3, 2, FIRST)],
  incumbent: FIRST,
  costs: COSTS,
});

export const WSP_INTERRUPTED = experiment('wsp-paperclip2', 'Loops in long answers, rerun', {
  ...RAN,
  status: 'interrupted',
  stage: 'investigation',
  activity: 'Stopped when the app closed, after program 1',
  hypothesis: ITERATIONS[0]?.hypothesis ?? '',
  iterations: ITERATIONS.slice(0, 1),
  measurements: [BASE_DEV, ...CONTROLS_DEV],
  costs: { ...COSTS, programs: 1, mentorUsd: 0.21, mentorCalls: 2, forwardPasses: 3 },
});

export const WSP_FAILED = experiment('wsp-paperclip3', 'Terse answers', {
  ...RAN,
  status: 'failed',
  stage: 'baseline',
  error: 'The worker ran out of memory past its 12 GB limit while measuring the base.',
  costs: { ...COSTS, programs: 0, mentorUsd: 0.04, mentorCalls: 1, forwardPasses: 0 },
});

const notRun = [
  { arm: 'Fine-tuning', reason: 'Not part of this method; compare it in Architect Lab.' },
];

export const WSP_EVALUATED = experiment('wsp-paperclip4', 'Loops in long answers', {
  ...RAN,
  status: 'evaluated',
  stage: 'results',
  hypothesis: ITERATIONS[1]?.hypothesis ?? '',
  iterations: ITERATIONS,
  measurements: [BASE_DEV, ...CONTROLS_DEV, measurement('candidate', 'dev', 3, 2, FIRST)],
  incumbent: FIRST,
  frozen: { candidateId: FIRST, digest: sha('first'), at: '2026-11-03T09:20:00.000Z' },
  costs: COSTS,
  result: {
    verdict: 'not-established',
    summary:
      'The candidate looped on 2 of 6 dev prompts against 4 for the base, too few to tell from chance.',
    candidateId: FIRST,
    comparisons: [
      {
        against: 'base',
        metric: 'loop_rate',
        split: 'dev',
        points: -33.3,
        low: -71.2,
        high: 8.4,
        n: 6,
      },
      {
        against: 'decoding',
        metric: 'loop_rate',
        split: 'dev',
        points: -16.7,
        low: -52.1,
        high: 21.6,
        n: 6,
      },
      {
        against: 'instructions',
        metric: 'loop_rate',
        split: 'dev',
        points: -33.3,
        low: -71.2,
        high: 8.4,
        n: 6,
      },
    ],
    regressions: [],
    notRun,
    deployment: {
      status: 'not-verified',
      reason: 'It was measured on the worker; no local runtime has loaded it yet.',
    },
  },
});

/** The stand-in mentor's run, which reports an improvement: the screens must say it is no result. */
const STAND_IN_RESULT = {
  verdict: 'improved' as const,
  summary: 'The candidate looped on none of 6 dev prompts against 4 for the base.',
  candidateId: SECOND,
  comparisons: [
    {
      against: 'base' as const,
      metric: 'loop_rate' as const,
      split: 'dev' as const,
      points: -66.7,
      low: -96.1,
      high: -21.4,
      n: 6,
    },
    {
      against: 'decoding' as const,
      metric: 'loop_rate' as const,
      split: 'dev' as const,
      points: -50,
      low: -88.2,
      high: -6.3,
      n: 6,
    },
  ],
  regressions: ['Mean length fell 24%, past the 20% the brief allows'],
  notRun: [
    ...notRun,
    { arm: 'Instructions control', reason: 'The brief tried no system instruction.' },
  ],
  deployment: {
    status: 'not-verified' as const,
    reason: 'It was measured on the worker; no local runtime has loaded it yet.',
  },
};

export const WSP_STAND_IN_EVALUATED = experiment('wsp-standin1', 'Loops, stand-in run', {
  ...RAN,
  mentor: STAND_IN,
  status: 'evaluated',
  stage: 'results',
  iterations: ITERATIONS.slice(0, 2).map((item) =>
    item.n === 2
      ? { ...item, candidateId: SECOND, dev: measurement('candidate', 'dev', 3, 0, SECOND) }
      : item,
  ),
  measurements: [
    BASE_DEV,
    CONTROLS_DEV[0] as WspMeasurement,
    measurement('candidate', 'dev', 3, 0, SECOND),
  ],
  incumbent: SECOND,
  frozen: { candidateId: SECOND, digest: sha('second'), at: '2026-11-03T09:20:00.000Z' },
  costs: { ...COSTS, mentorUsd: 0, mentorCalls: 3, programs: 2 },
  result: STAND_IN_RESULT,
});

export const WSP_QUALIFIED = experiment('wsp-standin2', 'Loops, stand-in run, qualified', {
  ...WSP_STAND_IN_EVALUATED,
  id: 'wsp-standin2',
  title: 'Loops, stand-in run, qualified',
  status: 'qualified',
  measurements: [
    ...WSP_STAND_IN_EVALUATED.measurements,
    measurement('base', 'qualification', 2, 3),
    measurement('decoding', 'qualification', 2, 3),
    measurement('candidate', 'qualification', 2, 1, SECOND),
  ],
  result: {
    ...STAND_IN_RESULT,
    comparisons: [
      ...STAND_IN_RESULT.comparisons,
      {
        against: 'base',
        metric: 'loop_rate',
        split: 'qualification',
        points: -33.3,
        low: -71.2,
        high: 8.4,
        n: 6,
      },
    ],
  },
  endedAt: '2026-11-03T09:40:00.000Z',
});

/** Every experiment, newest first, as the list returns them. */
export const WSP_EXPERIMENTS: WspExperiment[] = [
  WSP_RUNNING,
  WSP_EVALUATED,
  WSP_STAND_IN_EVALUATED,
  WSP_QUALIFIED,
  WSP_INTERRUPTED,
  WSP_FAILED,
  WSP_BRIEF,
  WSP_BRIEFING,
];

const PROGRAMS: Record<string, string> = {
  '1': [
    'import torch',
    '',
    'def run(model, probe):',
    '    scores = {}',
    '    for layer in range(20, 28):',
    '        attn = probe.attention(layer, prompts=probe.practice[:4])',
    '        scores[layer] = attn.on_repeated_span().mean(dim=0)',
    '    for layer, heads in scores.items():',
    '        for head, value in enumerate(heads.tolist()):',
    '            if value > 0.4:',
    "                print(f'layer {layer} head {head}: {value:.2f} on repeated span')",
  ].join('\n'),
  '2': [
    'def run(model, edit):',
    "    v = model.tensor('model.layers.23.self_attn.v_proj.weight')",
    '    rows = slice(320, 384)',
    '    edit.replace(v.name, v.scaled_rows(rows, 0.7))',
  ].join('\n'),
  '3': [
    'def run(model, edit):',
    "    o = model.tensor('model.layers.25.self_attn.o_proj.weight')",
    '    edit.replace(o.name, o.zero_columns(slice(128, 192)))',
  ].join('\n'),
};

/** The draft a new experiment's flow makes, and what Start experiment and an edit reply. */
export const WSP_DRAFTED = WSP_BRIEF;
export const WSP_STARTED = experiment(WSP_BRIEF.id, WSP_BRIEF.title, {
  ...RAN,
  status: 'running',
  stage: 'baseline',
  activity: 'Measuring the base on dev',
});

/** Answers every WSP channel with these records, in the WSP edition's world. */
export async function stubWsp(
  app: ElectronApplication,
  options: { worker?: unknown; mentor?: unknown } = {},
): Promise<void> {
  await stubEngine(app, {
    'wsp:models': WSP_MODELS,
    'wsp:inspectModel': WSP_PICKED_MODEL,
    'wsp:computeTargets': WSP_COMPUTE,
    'wsp:worker': options.worker ?? WSP_WORKER_READY,
    'wsp:setupWorker': { status: 'setting-up' },
    'wsp:mentor': options.mentor ?? WSP_MENTOR_READY,
    'wsp:list': WSP_EXPERIMENTS,
    'wsp:draft': WSP_DRAFTED,
    'wsp:redraft': WSP_BRIEFING,
    'wsp:revise': WSP_BRIEF,
    'wsp:start': WSP_STARTED,
    'wsp:cancel': { ...WSP_RUNNING, status: 'cancelling' },
    'wsp:resume': { ...WSP_INTERRUPTED, status: 'running' },
    'wsp:qualify': { ...WSP_EVALUATED, status: 'qualifying' },
  });
  await stubByKey(
    app,
    'wsp:get',
    Object.fromEntries(WSP_EXPERIMENTS.concat(WSP_DRAFT_FAILED).map((item) => [item.id, item])),
  );
  await app.evaluate(({ ipcMain }, programs) => {
    ipcMain.removeHandler('wsp:program');
    ipcMain.handle('wsp:program', (_event, _id: unknown, n: unknown) => {
      const source = programs[String(n)];
      return source === undefined
        ? { ok: false, error: { message: `No program ${String(n)} is kept.` } }
        : { ok: true, value: source };
    });
  }, PROGRAMS);
}
