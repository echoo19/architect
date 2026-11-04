import {
  WSP_DEFAULT_DECODING,
  WspBriefSchema,
  type JsonSchemaObject,
  type MentorAdapter,
  type MentorCompletion,
  type WspBrief,
  type WspExample,
  type WspExperiment,
  type WspIteration,
  type WspMeasurement,
} from '@architect/shared';
import { z } from 'zod';
import { points } from './metrics';

/*
 * What Astra is told and asked in Architect WSP (decision 109): one call drafts the brief, and
 * one call a turn writes the next program or ends the investigation. Astra sees the base's
 * tensor names and shapes, the practice examples with their outputs and checks, and the dev
 * split only as overall rates. The sealed examples are never in reach.
 */

export const STEP_MAX_OUTPUT = 12_000;
export const BRIEF_MAX_OUTPUT = 4_000;

const nullableString = { type: ['string', 'null'] } as const;

export const BRIEF_JSON: { name: string; schema: JsonSchemaObject } = {
  name: 'wsp_brief',
  schema: {
    type: 'object',
    additionalProperties: false,
    required: [
      'objective',
      'baseline',
      'investigation',
      'successCriteria',
      'regressionChecks',
      'expectedOutput',
      'target',
      'controls',
    ],
    properties: {
      objective: { type: 'string' },
      baseline: { type: 'string' },
      investigation: { type: 'string' },
      successCriteria: { type: 'array', items: { type: 'string' } },
      regressionChecks: { type: 'array', items: { type: 'string' } },
      expectedOutput: { type: 'string' },
      target: {
        type: 'object',
        additionalProperties: false,
        required: ['metric', 'minPoints'],
        properties: {
          metric: { type: 'string', enum: ['pass_rate', 'loop_rate'] },
          minPoints: { type: 'number' },
        },
      },
      controls: {
        type: 'object',
        additionalProperties: false,
        required: ['decoding', 'instructions'],
        properties: {
          decoding: {
            type: 'object',
            additionalProperties: false,
            required: ['temperature', 'topP', 'repetitionPenalty', 'maxNewTokens'],
            properties: {
              temperature: { type: 'number' },
              topP: { type: 'number' },
              repetitionPenalty: { type: 'number' },
              maxNewTokens: { type: 'integer' },
            },
          },
          instructions: nullableString,
        },
      },
    },
  },
};

export const StepSchema = z.object({
  hypothesis: z.string(),
  expected: z.string(),
  action: z.enum(['program', 'finish']),
  program: z.string(),
  summary: z.string(),
});
export type WspStep = z.infer<typeof StepSchema>;

export const STEP_JSON: { name: string; schema: JsonSchemaObject } = {
  name: 'wsp_step',
  schema: {
    type: 'object',
    additionalProperties: false,
    required: ['hypothesis', 'expected', 'action', 'program', 'summary'],
    properties: {
      hypothesis: { type: 'string' },
      expected: { type: 'string' },
      action: { type: 'string', enum: ['program', 'finish'] },
      program: { type: 'string' },
      summary: { type: 'string' },
    },
  },
};

const METHOD = `You are the mentor in Architect WSP, an experimental weight-space programming lab. You improve a small open language model toward a goal by reading and editing its weights directly, with no gradient descent and no training. You work through Python programs that a runner executes in an isolated kernel over the model's tensors; the runner, not you, runs the model and measures every candidate on examples you see (practice) and on a dev split you see only as overall rates. A sealed split you never see qualifies the final candidate.

Be honest about the method. Published work (Takehi, Teoh, Zhang and Khattab, MIT CSAIL, 2026) repaired a looping pathology in Qwen3.5-0.8B by removing one direction from a few MLP output columns, and found that editing could remove an obstacle that hid an ability but could not add an ability the model lacked. Prefer targeted repairs of a behavior the model shows, and say plainly when the evidence does not support an edit.`;

const KERNEL = `Each turn you write one Python program. It runs once, in a fresh process, with these names:
- weights: names(), shape(name), dtype(name), get(name) -> a float32 torch tensor (the current candidate's, or the base's), and config (the model's config.json).
- save_edit(name, tensor): a whole replacement for one tensor, same shape. Refused: the embedding, the output head and the final norm, values that aren't finite, and scaling a whole tensor by one number.
- request_read(name, texts, layers): asks for hidden states after the program ends (up to 64 texts of 2,000 characters; layer 0 is the embeddings). A later program loads them with load_read(name), a dict of arrays mean_<layer> and last_<layer>, each [texts, hidden]. A read costs one forward pass.
- practice: a list of dicts with prompt, output, passed (True, False or None when unchecked) and looped, for the current candidate.
- scratch: a folder path kept between programs, for np.save and np.load.
- torch, np, math.
The program can't run the model, reach the network, start processes or read other files. Print what you learn, briefly; the end of what it prints comes back to you. When a program saves edits, the runner builds a candidate from the current one plus your edits and measures it on practice and dev (two forward passes); it becomes the current candidate only if it gains on the brief's target over the current one on dev.`;

function rate(measurement: WspMeasurement | undefined, metric: 'pass_rate' | 'loop_rate'): string {
  if (measurement === undefined) return 'not measured';
  const value = points(measurement, metric);
  return value === null ? 'none checked' : `${value.toFixed(1)}%`;
}

function dev(measurement: WspMeasurement | undefined): string {
  if (measurement === undefined) return 'not measured';
  return `pass rate ${rate(measurement, 'pass_rate')}, loop rate ${rate(measurement, 'loop_rate')}, mean ${measurement.meanTokens.toFixed(0)} tokens, ${measurement.cutOff} of ${measurement.n} cut off`;
}

/** A compact account of the checkpoint's tensors: the first layer's, and the rest by pattern. */
export function inventory(
  names: readonly string[],
  shapes: ReadonlyMap<string, readonly number[]>,
): string {
  const layered = new Map<string, number[]>();
  const other: string[] = [];
  for (const name of names) {
    const match = /^(.*\.layers\.)(\d+)(\..*)$/.exec(name);
    if (match === null) {
      other.push(`${name} ${JSON.stringify(shapes.get(name))}`);
      continue;
    }
    const key = `${match[1]}{i}${match[3]}`;
    layered.set(key, [...(layered.get(key) ?? []), Number(match[2])]);
  }
  const rows = [...layered].map(([pattern, indices]) => {
    const example = pattern.replace('{i}', String(Math.min(...indices)));
    return `${pattern} for i in 0..${Math.max(...indices)} ${JSON.stringify(shapes.get(example))}`;
  });
  return [...other, ...rows].join('\n');
}

export interface BriefContext {
  experiment: WspExperiment;
  practice: readonly WspExample[];
  tensors: string;
}

export function briefRequest(context: BriefContext) {
  const { experiment, practice } = context;
  const examples = practice
    .slice(0, 24)
    .map((example, index) => `${index + 1}. ${JSON.stringify(example)}`)
    .join('\n');
  const limits = experiment.limits;
  return {
    system: `${METHOD}\n\nNow draft the experiment's brief. The person reads it, may edit it, and approves it by starting the experiment. Keep every field short and concrete. The target is the metric the runner decides on (pass_rate over the examples that have a check, or loop_rate over all) and the least change in points on dev that counts. The controls are the simpler interventions every candidate is compared with: one decoding setting (temperature, top_p, repetition penalty, max new tokens) and, if useful, one system instruction (or null). Regression checks name what must not get worse.`,
    messages: [
      {
        role: 'user' as const,
        content: `Model: ${experiment.base.name} (${experiment.base.architecture ?? 'unknown architecture'}, ${experiment.base.parameters.toLocaleString('en-US')} parameters).
Tensors:
${context.tensors}

Goal: ${experiment.goal.task}
Constraints: ${experiment.goal.constraints ?? 'none stated'}
Examples: ${experiment.split.practice} practice, ${experiment.split.dev} dev, ${experiment.split.qualification} sealed. The practice ones:
${examples}

Limits: ${limits.programs} programs, ${limits.forwardPasses} forward passes, ${limits.wallMinutes} minutes, $${limits.mentorUsd} of mentor calls, at most ${(limits.maxChangedFraction * 100).toFixed(2)}% of the weights changed. Compute: this computer's CPU.`,
      },
    ],
    json: BRIEF_JSON,
    maxOutputTokens: BRIEF_MAX_OUTPUT,
  };
}

/** A reply's brief, held to the schema; the runner's own bounds clamp the controls. */
export function parseBrief(value: unknown, maxNewTokens: number): WspBrief {
  const raw = z
    .object({ controls: z.object({ decoding: z.record(z.string(), z.unknown()) }).loose() })
    .loose()
    .parse(value);
  const decoding = raw.controls.decoding;
  const clamp = (key: string, low: number, high: number, fallback: number) => {
    const number = Number(decoding[key]);
    return Number.isFinite(number) ? Math.min(high, Math.max(low, number)) : fallback;
  };
  return WspBriefSchema.parse({
    ...raw,
    controls: {
      ...raw.controls,
      decoding: {
        temperature: clamp('temperature', 0, 2, 0),
        topP: clamp('topP', 0.05, 1, 1),
        repetitionPenalty: clamp('repetitionPenalty', 1, 2, 1),
        maxNewTokens: Math.round(clamp('maxNewTokens', 8, 4_096, maxNewTokens)),
      },
    },
  });
}

export interface StepContext {
  experiment: WspExperiment;
  tensors: string;
  /** The current candidate's practice outputs, with their verdicts. */
  practice: readonly { prompt: string; output: string; passed: boolean | null; looped: boolean }[];
  baseDev: WspMeasurement | undefined;
  currentDev: WspMeasurement | undefined;
  programs: ReadonlyMap<number, string>;
  remaining: { programs: number; forwardPasses: number; minutes: number; mentorUsd: number };
}

function history(
  iterations: readonly WspIteration[],
  programs: ReadonlyMap<number, string>,
): string {
  if (iterations.length === 0) return 'No program has run yet.';
  return iterations
    .map((item, index) => {
      const full = index >= iterations.length - 3;
      const program = programs.get(item.n);
      return [
        `Program ${item.n}: ${item.hypothesis}`,
        full && program !== undefined ? `\`\`\`python\n${program}\n\`\`\`` : '(program omitted)',
        `Outcome: ${item.outcome}${item.reason ? ` (${item.reason})` : ''}`,
        item.output ? `Printed:\n${full ? item.output : item.output.slice(-600)}` : '',
        item.dev ? `Candidate ${item.candidateId} on dev: ${dev(item.dev)}; ${item.decision}` : '',
      ]
        .filter(Boolean)
        .join('\n');
    })
    .join('\n\n');
}

export function stepRequest(context: StepContext) {
  const { experiment } = context;
  const brief = experiment.brief!;
  const practice = context.practice
    .map(
      (item, index) =>
        `${index + 1}. prompt ${JSON.stringify(item.prompt.slice(0, 600))}\n   output ${JSON.stringify(item.output.slice(0, 600))}\n   passed ${item.passed} looped ${item.looped}`,
    )
    .join('\n');
  const r = context.remaining;
  return {
    system: `${METHOD}\n\n${KERNEL}\n\nReply with your current hypothesis, what you expect this program to show or change, and either action "program" with the Python source, or action "finish" with an empty program when the evidence says to stop (the target is met, or no edit is supported). The summary is one sentence for the person following the experiment.`,
    messages: [
      {
        role: 'user' as const,
        content: `Brief, as approved:
${JSON.stringify(brief, null, 2)}

Model: ${experiment.base.name}, ${experiment.base.parameters.toLocaleString('en-US')} parameters. Tensors:
${context.tensors}

The base on dev: ${dev(context.baseDev)}.
The current candidate (${experiment.incumbent ?? 'the base'}) on dev: ${dev(context.currentDev)}.
Its practice outputs:
${practice}

History:
${history(experiment.iterations, context.programs)}

Left: ${r.programs} programs, ${r.forwardPasses} forward passes, ${r.minutes.toFixed(0)} minutes, $${r.mentorUsd.toFixed(2)} of mentor calls.`,
      },
    ],
    json: STEP_JSON,
    maxOutputTokens: STEP_MAX_OUTPUT,
  };
}

/** What a mentor turn returns, for both Astra and the scripted stand-in. */
export interface WspMentorTurn<T> {
  value: T;
  completion: Pick<MentorCompletion, 'usage' | 'costUsd'>;
}

/** Astra, or the scripted stand-in: drafts a brief and writes programs. */
export interface WspMentorClient {
  readonly standIn: boolean;
  brief(context: BriefContext, signal?: AbortSignal): Promise<WspMentorTurn<WspBrief>>;
  step(context: StepContext, signal?: AbortSignal): Promise<WspMentorTurn<WspStep>>;
  /** The most one more call could cost, for checking the cap before asking. */
  worstCaseUsd(inputChars: number, maxOutputTokens: number): number;
}

/** A request's text, for the leak check and the cost bound. */
export function requestText(request: { system: string; messages: { content: string }[] }): string {
  return `${request.system}\n${request.messages.map((m) => m.content).join('\n')}`;
}

export function astraClient(
  adapter: MentorAdapter,
  reasoningEffort: 'low' | 'medium' | 'high',
  pricing: { inputPerM: number; outputPerM: number },
): WspMentorClient {
  return {
    standIn: false,
    async brief(context, signal) {
      const request = briefRequest(context);
      const completion = await adapter.complete({ ...request, reasoningEffort }, signal);
      return { value: parseBrief(completion.json, WSP_DEFAULT_DECODING.maxNewTokens), completion };
    },
    async step(context, signal) {
      const request = stepRequest(context);
      const completion = await adapter.complete({ ...request, reasoningEffort }, signal);
      return { value: StepSchema.parse(completion.json), completion };
    },
    worstCaseUsd(inputChars, maxOutputTokens) {
      // A token is at least two characters of this text; reasoning bills as output.
      return (
        (inputChars / 2) * (pricing.inputPerM / 1e6) + maxOutputTokens * (pricing.outputPerM / 1e6)
      );
    },
  };
}
