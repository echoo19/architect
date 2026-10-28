/**
 * Live check of the Anthropic mentor's forced-tool path, which the adapter takes for models
 * without structured outputs. Current models all have them, so this run tells the adapter the
 * model lacks them (by rewriting the capability answer it reads) and makes one small real call
 * to the cheapest model, which still accepts a forced tool call. Prints no keys or replies.
 *
 *   SMOKE_ANTHROPIC_KEY=... pnpm exec tsx packages/adapters/scripts/anthropic-tool-path.ts
 */
import { mentorPreset } from '@architect/shared';
import { createMentor } from '../src';

const apiKey = process.env['SMOKE_ANTHROPIC_KEY'];
if (!apiKey) {
  process.stdout.write('skipped: set SMOKE_ANTHROPIC_KEY\n');
  process.exit(0);
}

let forcedTool = false;
const rewrite: typeof fetch = async (input, init) => {
  const url = input instanceof Request ? input.url : String(input);
  if (init?.method === 'POST' && typeof init.body === 'string') {
    forcedTool =
      (JSON.parse(init.body) as { tool_choice?: { type?: string } }).tool_choice?.type === 'tool';
  }
  const response = await fetch(input, init);
  if (!/\/v1\/models\/[^/?]+$/.test(new URL(url).pathname)) return response;
  const info = (await response.json()) as { capabilities?: Record<string, unknown> };
  info.capabilities = { ...info.capabilities, structured_outputs: { supported: false } };
  return new Response(JSON.stringify(info), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
};

const preset = mentorPreset('anthropic-haiku');
const mentor = createMentor(
  {
    kind: 'model',
    provider: preset.provider,
    label: preset.label,
    baseUrl: preset.baseUrl,
    model: preset.model,
    reasoningEffort: 'low',
    secretRef: preset.secretRef,
  },
  { apiKey, fetch: rewrite },
);
const completion = await mentor.complete({
  system: 'Answer with the JSON object only.',
  messages: [{ role: 'user', content: 'Say that you are ready.' }],
  json: {
    name: 'ready',
    schema: {
      type: 'object',
      additionalProperties: false,
      properties: { ready: { type: 'boolean' } },
      required: ['ready'],
    },
  },
  maxOutputTokens: 1024,
  reasoningEffort: 'low',
});
const json = completion.json as Record<string, unknown> | undefined;
process.stdout.write(
  `forced tool call: ${forcedTool ? 'sent' : 'NOT sent'}   json ${typeof json?.['ready'] === 'boolean' ? 'ok' : 'NOT as asked'}   in ${completion.usage.inputTokens}  out ${completion.usage.outputTokens}   $${(completion.costUsd ?? 0).toFixed(6)}\n`,
);
