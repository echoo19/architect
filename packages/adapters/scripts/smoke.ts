/**
 * Live smoke test: one tiny real call per adapter that has credentials in the environment, and
 * each connection's model list. It is not part of CI and the app never imports it. It prints
 * status, latency, token counts and cost for each call, how many models each list holds, and
 * nothing else: no keys, prompts or replies.
 *
 * Run it from the repository root, setting only the variables for what you want to try:
 *
 *   SMOKE_OPENAI_KEY=... pnpm exec tsx packages/adapters/scripts/smoke.ts
 *
 * Mentors (each makes one paid request for a small JSON object, held to a schema where the API
 * can; a reply that doesn't parse costs a second request):
 *   SMOKE_META_KEY        Meta Model API key. SMOKE_META_PRESET picks the model: meta-spark
 *                         (default) or meta-spark-contributor.
 *   SMOKE_OPENAI_KEY      OpenAI key, for the cheapest preset (GPT-6 Luna).
 *   SMOKE_ANTHROPIC_KEY   Anthropic key, for the cheapest preset (Claude Haiku 5.5).
 *   SMOKE_GEMINI_KEY      Google Gemini key, for the cheapest preset (Gemini 3.5 Flash-Lite).
 *   SMOKE_OPENROUTER_MENTOR
 *                         An OpenRouter model id to use as mentor, such as a free one; its price
 *                         comes from OpenRouter's list. Needs SMOKE_OPENROUTER_KEY.
 *   SMOKE_OLLAMA_MENTOR   A model already in the local Ollama, used as mentor through its /v1.
 *   SMOKE_BASETEN_KEY     Baseten key, for Muse Spark Open.
 *   SMOKE_MODAL_KEY       Modal proxy token (wk-<id>.ws-<secret>), for Muse Spark Open. Also set
 *                         SMOKE_MODAL_URL and SMOKE_MODAL_MODEL to the values on the endpoint's
 *                         dashboard.
 *
 * Students:
 *   SMOKE_OLLAMA=1        Chat with the local model, then unload it. This loads the whole model
 *                         into memory, so it only runs when asked for. SMOKE_OLLAMA_URL changes
 *                         the address and SMOKE_OLLAMA_MODEL the model (Muse Glimmer by default).
 *   SMOKE_TOGETHER_KEY, SMOKE_OPENROUTER_KEY, SMOKE_DEEPINFRA_KEY
 *                         Hosted Muse Glimmer (one paid request each). SMOKE_SKIP_HOSTED=1 skips
 *                         them, for a key with no credit left.
 *   SMOKE_LLAMACPP_URL    A llama.cpp server's /v1 address. Also set SMOKE_LLAMACPP_MODEL (the
 *                         server's -a name), and SMOKE_LLAMACPP_KEY if it was started with
 *                         --api-key.
 *
 * Model lists: every provider above with a key, OpenRouter's public list, and the local Ollama.
 *
 * The exit code is 1 if any call that ran failed.
 */
import {
  AdapterError,
  costUsd,
  DEFAULT_STUDENT,
  DecodingSchema,
  emptyUsage,
  FREE_PRICING,
  mentorPreset,
  OLLAMA_BASE_URL,
  OPENROUTER_BASE_URL,
  PROVIDERS,
  STUDENT_PRESETS,
  type MentorConfig,
  type MentorPresetKey,
  type ProviderId,
  type StudentEndpoint,
  type TokenPricing,
  type Usage,
} from '@architect/shared';
import { createMentor, createStudent, listModels } from '../src';

interface Outcome {
  usage: Usage;
  costUsd: number | null;
  /** What else to say about the call, such as whether its JSON held to the schema. */
  note?: string;
}

const env = process.env;
let failures = 0;

function write(line: string): void {
  process.stdout.write(`${line}\n`);
}

function reasonOf(error: unknown): string {
  // Adapter errors are written for the person using the app and never hold keys or bodies.
  return error instanceof AdapterError ? `${error.code}: ${error.message}` : 'unexpected error';
}

async function run(name: string, call: () => Promise<Outcome>): Promise<void> {
  const started = performance.now();
  try {
    const { usage, costUsd: cost, note } = await call();
    const latency = `${Math.round(performance.now() - started)} ms`;
    const reasoning =
      usage.reasoningTokens === undefined ? '' : ` (reasoning ${usage.reasoningTokens})`;
    const price = cost === null ? 'cost unknown' : `$${cost.toFixed(6)}`;
    write(
      `${name.padEnd(34)} ok       ${latency.padStart(9)}   in ${usage.inputTokens}  out ${usage.outputTokens}${reasoning}   ${price}${note ? `   ${note}` : ''}`,
    );
  } catch (error) {
    failures += 1;
    write(`${name.padEnd(34)} FAILED   ${reasonOf(error)}`);
  }
}

function skip(name: string, hint: string): void {
  write(`${name.padEnd(34)} skipped  set ${hint}`);
}

/** The small object every mentor is asked for, in the strict shape the loop's schema has too. */
const READY_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: { ready: { type: 'boolean' } },
  required: ['ready'],
} as const;

async function mentor(name: string, config: MentorConfig, apiKey?: string): Promise<void> {
  await run(name, async () => {
    const adapter = createMentor(config, apiKey === undefined ? {} : { apiKey });
    // Asking for JSON exercises the path the training loop uses: structured output where the
    // provider has it (streamed, with reasoning on), a fenced block where it doesn't.
    const completion = await adapter.complete({
      system: 'Answer with the JSON object only.',
      messages: [{ role: 'user', content: 'Say that you are ready.' }],
      json: { name: 'ready', schema: READY_SCHEMA },
      maxOutputTokens: 1024,
      reasoningEffort: 'low',
    });
    const json = completion.json as Record<string, unknown> | undefined;
    const held =
      json !== undefined && Object.keys(json).length === 1 && typeof json['ready'] === 'boolean';
    return {
      usage: completion.usage,
      costUsd: completion.costUsd,
      note: held ? 'json ok' : 'json NOT as asked',
    };
  });
}

function presetConfig(key: MentorPresetKey, overrides: Partial<MentorConfig> = {}): MentorConfig {
  const preset = mentorPreset(key);
  return {
    kind: 'model',
    provider: preset.provider,
    label: preset.label,
    baseUrl: preset.baseUrl,
    model: preset.model,
    reasoningEffort: 'low',
    secretRef: preset.secretRef,
    ...overrides,
  } as MentorConfig;
}

async function presetMentor(key: MentorPresetKey, variable: string): Promise<void> {
  const apiKey = env[variable];
  const { label } = mentorPreset(key);
  if (!apiKey) {
    skip(label, variable);
    return;
  }
  await mentor(label, presetConfig(key), apiKey);
}

async function list(name: string, provider: ProviderId, baseUrl: string, apiKey?: string) {
  const started = performance.now();
  try {
    const models = await listModels({ provider, baseUrl, ...(apiKey ? { apiKey } : {}) });
    const priced = models.filter((model) => model.pricing !== undefined).length;
    const latency = `${Math.round(performance.now() - started)} ms`;
    write(
      `${`${name} models`.padEnd(34)} ok       ${latency.padStart(9)}   ${models.length} chat models${priced > 0 ? `, ${priced} priced` : ''}`,
    );
  } catch (error) {
    failures += 1;
    write(`${`${name} models`.padEnd(34)} FAILED   ${reasonOf(error)}`);
  }
}

async function student(
  name: string,
  endpoint: StudentEndpoint,
  options: { apiKey?: string; pricing?: TokenPricing | null; unload?: boolean },
): Promise<void> {
  await run(name, async () => {
    const adapter = createStudent(endpoint, { apiKey: options.apiKey });
    try {
      let usage = emptyUsage();
      let text = '';
      const events = adapter.chat({
        messages: [{ role: 'user', content: 'Say ready.' }],
        tools: [],
        decoding: DecodingSchema.parse({ maxOutputTokens: 256, thinking: 'low' }),
        seed: 1,
      });
      for await (const event of events) {
        if (event.type === 'text') text += event.delta;
        if (event.type === 'done') usage = event.usage;
      }
      return {
        usage,
        costUsd: options.pricing ? costUsd(options.pricing, usage) : null,
        note: text.trim() === '' ? 'empty reply' : 'replied',
      };
    } finally {
      if (options.unload) await adapter.release();
    }
  });
}

type StudentPresetKey = (typeof STUDENT_PRESETS)[number]['key'];

function studentPreset(key: StudentPresetKey) {
  const found = STUDENT_PRESETS.find((candidate) => candidate.key === key);
  if (!found) throw new Error(`Unknown student preset: ${key}`);
  return found;
}

async function hosted(key: StudentPresetKey, variable: string): Promise<void> {
  const { label, runtime, baseUrl, model, pricing } = studentPreset(key);
  const apiKey = env[variable];
  if (!apiKey || env['SMOKE_SKIP_HOSTED'] === '1') {
    skip(label, apiKey ? 'SMOKE_SKIP_HOSTED=0' : variable);
    return;
  }
  const endpoint = { runtime, baseUrl, model, contextLength: DEFAULT_STUDENT.contextLength };
  await student(label, endpoint, { apiKey, pricing });
}

const metaKey = env['SMOKE_META_KEY'];
if (metaKey) {
  const tier =
    env['SMOKE_META_PRESET'] === 'meta-spark-contributor' ? 'meta-spark-contributor' : 'meta-spark';
  await mentor(mentorPreset(tier).label, presetConfig(tier), metaKey);
} else {
  skip(mentorPreset('meta-spark').label, 'SMOKE_META_KEY');
}

await presetMentor('openai-gpt-6-luna', 'SMOKE_OPENAI_KEY');
await presetMentor('anthropic-haiku', 'SMOKE_ANTHROPIC_KEY');
await presetMentor('gemini-flash-lite', 'SMOKE_GEMINI_KEY');

const openRouterKey = env['SMOKE_OPENROUTER_KEY'];
const openRouterMentor = env['SMOKE_OPENROUTER_MENTOR'];
if (openRouterKey && openRouterMentor) {
  const listed = await listModels({ provider: 'openrouter', baseUrl: OPENROUTER_BASE_URL });
  const pricing = listed.find((model) => model.id === openRouterMentor)?.pricing;
  await mentor(
    `OpenRouter ${openRouterMentor}`,
    {
      kind: 'model',
      provider: 'openrouter',
      label: openRouterMentor,
      baseUrl: OPENROUTER_BASE_URL,
      model: openRouterMentor,
      reasoningEffort: 'low',
      secretRef: 'openrouter',
      ...(pricing ? { pricing } : {}),
    },
    openRouterKey,
  );
} else {
  skip('OpenRouter mentor', 'SMOKE_OPENROUTER_KEY and SMOKE_OPENROUTER_MENTOR');
}

const ollamaUrl = env['SMOKE_OLLAMA_URL'] ?? OLLAMA_BASE_URL;
const ollamaMentor = env['SMOKE_OLLAMA_MENTOR'];
if (ollamaMentor) {
  await mentor(`Ollama ${ollamaMentor} as mentor`, {
    kind: 'model',
    provider: 'ollama',
    label: ollamaMentor,
    baseUrl: ollamaUrl,
    model: ollamaMentor,
    reasoningEffort: 'low',
  });
} else {
  skip('Local mentor on Ollama', 'SMOKE_OLLAMA_MENTOR');
}

const basetenKey = env['SMOKE_BASETEN_KEY'];
if (basetenKey) {
  await mentor(
    mentorPreset('baseten-spark-open').label,
    presetConfig('baseten-spark-open'),
    basetenKey,
  );
} else {
  skip(mentorPreset('baseten-spark-open').label, 'SMOKE_BASETEN_KEY');
}

const modalKey = env['SMOKE_MODAL_KEY'];
if (modalKey) {
  await mentor(
    mentorPreset('modal-spark-open').label,
    presetConfig('modal-spark-open', {
      ...(env['SMOKE_MODAL_URL'] ? { baseUrl: env['SMOKE_MODAL_URL'] } : {}),
      ...(env['SMOKE_MODAL_MODEL'] ? { model: env['SMOKE_MODAL_MODEL'] } : {}),
    }),
    modalKey,
  );
} else {
  skip(mentorPreset('modal-spark-open').label, 'SMOKE_MODAL_KEY');
}

const local = studentPreset('ollama-glimmer');
if (env['SMOKE_OLLAMA'] === '1') {
  const model = env['SMOKE_OLLAMA_MODEL'] ?? local.model;
  await student(
    `Ollama ${model} as student`,
    { runtime: local.runtime, baseUrl: ollamaUrl, model, contextLength: 4096 },
    { pricing: FREE_PRICING, unload: true },
  );
} else {
  skip(local.label, 'SMOKE_OLLAMA=1');
}

await hosted('together-glimmer', 'SMOKE_TOGETHER_KEY');
await hosted('openrouter-glimmer', 'SMOKE_OPENROUTER_KEY');
await hosted('deepinfra-glimmer', 'SMOKE_DEEPINFRA_KEY');

const llamaUrl = env['SMOKE_LLAMACPP_URL'];
const llamaModel = env['SMOKE_LLAMACPP_MODEL'];
if (llamaUrl && llamaModel) {
  await student(
    'llama.cpp server',
    {
      runtime: 'openai_compatible',
      baseUrl: llamaUrl,
      model: llamaModel,
      contextLength: DEFAULT_STUDENT.contextLength,
    },
    { apiKey: env['SMOKE_LLAMACPP_KEY'] },
  );
} else {
  skip('llama.cpp server', 'SMOKE_LLAMACPP_URL and SMOKE_LLAMACPP_MODEL');
}

const keyed: [string, ProviderId, string | undefined][] = [
  ['Meta', 'meta', metaKey],
  ['OpenAI', 'openai', env['SMOKE_OPENAI_KEY']],
  ['Anthropic', 'anthropic', env['SMOKE_ANTHROPIC_KEY']],
  ['Google Gemini', 'gemini', env['SMOKE_GEMINI_KEY']],
];
for (const [name, provider, apiKey] of keyed) {
  if (apiKey) await list(name, provider, PROVIDERS[provider].baseUrl, apiKey);
}
await list('OpenRouter', 'openrouter', OPENROUTER_BASE_URL);
if (env['SMOKE_OLLAMA'] === '1' || ollamaMentor) await list('Ollama', 'ollama', ollamaUrl);

if (failures > 0) process.exitCode = 1;
