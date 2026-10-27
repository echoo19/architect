/**
 * Live smoke test: one tiny real call per adapter that has credentials in the environment.
 * It is not part of CI and the app never imports it. It prints status, latency, token counts and
 * cost for each call, and nothing else: no keys, prompts or replies.
 *
 * Run it from the repository root, setting only the variables for what you want to try:
 *
 *   SMOKE_META_KEY=... pnpm exec tsx packages/adapters/scripts/smoke.ts
 *
 * Mentors (each makes one paid request):
 *   SMOKE_META_KEY        Meta Model API key. SMOKE_META_PRESET picks the model: meta-spark
 *                         (default) or meta-spark-contributor.
 *   SMOKE_BASETEN_KEY     Baseten key, for Muse Spark Open.
 *   SMOKE_MODAL_KEY       Modal proxy token (wk-<id>.ws-<secret>), for Muse Spark Open. Also set
 *                         SMOKE_MODAL_URL and SMOKE_MODAL_MODEL to the values on the endpoint's
 *                         dashboard.
 *
 * Students:
 *   SMOKE_OLLAMA=1        Chat with the local model, then unload it. This loads the whole model
 *                         into memory, so it only runs when asked for. SMOKE_OLLAMA_URL changes
 *                         the address.
 *   SMOKE_TOGETHER_KEY, SMOKE_OPENROUTER_KEY, SMOKE_DEEPINFRA_KEY
 *                         Hosted Muse Glimmer (one paid request each).
 *   SMOKE_LLAMACPP_URL    A llama.cpp server's /v1 address. Also set SMOKE_LLAMACPP_MODEL (the
 *                         server's -a name), and SMOKE_LLAMACPP_KEY if it was started with
 *                         --api-key.
 *
 * The exit code is 1 if any call that ran failed.
 */
import {
  AdapterError,
  costUsd,
  DEFAULT_STUDENT,
  DecodingSchema,
  emptyUsage,
  mentorPreset,
  STUDENT_PRESETS,
  type MentorPresetKey,
  type StudentEndpoint,
  type TokenPricing,
  type Usage,
} from '@architect/shared';
import { createMentor, createStudent } from '../src';

interface Outcome {
  usage: Usage;
  costUsd: number | null;
}

const env = process.env;
let failures = 0;

function write(line: string): void {
  process.stdout.write(`${line}\n`);
}

async function run(name: string, call: () => Promise<Outcome>): Promise<void> {
  const started = performance.now();
  try {
    const { usage, costUsd: cost } = await call();
    const latency = `${Math.round(performance.now() - started)} ms`;
    const reasoning =
      usage.reasoningTokens === undefined ? '' : ` (reasoning ${usage.reasoningTokens})`;
    const price = cost === null ? 'cost unknown' : `$${cost.toFixed(6)}`;
    write(
      `${name.padEnd(34)} ok       ${latency.padStart(9)}   in ${usage.inputTokens}  out ${usage.outputTokens}${reasoning}   ${price}`,
    );
  } catch (error) {
    failures += 1;
    // Adapter errors are written for the person using the app and never hold keys or bodies.
    const reason =
      error instanceof AdapterError ? `${error.code}: ${error.message}` : 'unexpected error';
    write(`${name.padEnd(34)} FAILED   ${reason}`);
  }
}

function skip(name: string, hint: string): void {
  write(`${name.padEnd(34)} skipped  set ${hint}`);
}

async function mentor(
  key: MentorPresetKey,
  apiKey: string,
  overrides: { baseUrl?: string; model?: string } = {},
): Promise<void> {
  const preset = mentorPreset(key);
  await run(preset.label, async () => {
    const adapter = createMentor(
      {
        kind: 'model',
        provider: preset.provider,
        label: preset.label,
        baseUrl: overrides.baseUrl ?? preset.baseUrl,
        model: overrides.model ?? preset.model,
        reasoningEffort: 'low',
        secretRef: 'smoke',
      },
      { apiKey, pricing: preset.pricing },
    );
    const completion = await adapter.complete({
      system: 'Answer with one word.',
      messages: [{ role: 'user', content: 'Say ready.' }],
      maxOutputTokens: 256,
      reasoningEffort: 'low',
    });
    return { usage: completion.usage, costUsd: completion.costUsd };
  });
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
      const events = adapter.chat({
        messages: [{ role: 'user', content: 'Say ready.' }],
        tools: [],
        decoding: DecodingSchema.parse({ maxOutputTokens: 256, thinking: 'low' }),
        seed: 1,
      });
      for await (const event of events) {
        if (event.type === 'done') usage = event.usage;
      }
      return { usage, costUsd: options.pricing ? costUsd(options.pricing, usage) : null };
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
  if (!apiKey) {
    skip(label, variable);
    return;
  }
  const endpoint = { runtime, baseUrl, model, contextLength: DEFAULT_STUDENT.contextLength };
  await student(label, endpoint, { apiKey, pricing });
}

const metaKey = env['SMOKE_META_KEY'];
if (metaKey) {
  const tier =
    env['SMOKE_META_PRESET'] === 'meta-spark-contributor' ? 'meta-spark-contributor' : 'meta-spark';
  await mentor(tier, metaKey);
} else {
  skip(mentorPreset('meta-spark').label, 'SMOKE_META_KEY');
}

const basetenKey = env['SMOKE_BASETEN_KEY'];
if (basetenKey) await mentor('baseten-spark-open', basetenKey);
else skip(mentorPreset('baseten-spark-open').label, 'SMOKE_BASETEN_KEY');

const modalKey = env['SMOKE_MODAL_KEY'];
if (modalKey) {
  await mentor('modal-spark-open', modalKey, {
    baseUrl: env['SMOKE_MODAL_URL'],
    model: env['SMOKE_MODAL_MODEL'],
  });
} else {
  skip(mentorPreset('modal-spark-open').label, 'SMOKE_MODAL_KEY');
}

const local = studentPreset('ollama-glimmer');
if (env['SMOKE_OLLAMA'] === '1') {
  await student(
    local.label,
    {
      runtime: local.runtime,
      baseUrl: env['SMOKE_OLLAMA_URL'] ?? local.baseUrl,
      model: local.model,
      contextLength: DEFAULT_STUDENT.contextLength,
    },
    { unload: true },
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

if (failures > 0) process.exitCode = 1;
