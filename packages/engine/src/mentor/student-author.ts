import {
  DecodingSchema,
  emptyUsage,
  type JsonSchemaObject,
  type MentorAdapter,
  type StudentAdapter,
} from '@architect/shared';
import { extractJson } from './reply';

function jsonInstruction(schema: JsonSchemaObject): string {
  return [
    'Reply with one JSON object and nothing else: no prose before or after it, no code fence.',
    `It must match this JSON Schema:\n${JSON.stringify(schema)}`,
  ].join('\n');
}

/**
 * The student as its own author, for the self-reflection baseline: it gets the same prompts a
 * mentor gets and writes the hypothesis itself. It costs no mentor dollars. The student API has
 * no constrained decoding, so the schema goes into the prompt and the JSON is read from the text.
 */
export function studentAsMentor(student: StudentAdapter, seed: number): MentorAdapter {
  return {
    kind: 'model',
    label: student.label,
    model: student.model,
    provider: 'student',
    async complete(request, signal) {
      const started = performance.now();
      const system = request.json
        ? `${request.system}\n\n${jsonInstruction(request.json.schema)}`
        : request.system;
      const decoding = DecodingSchema.parse({
        maxOutputTokens: Math.min(Math.max(request.maxOutputTokens, 64), 32_768),
        thinking: request.reasoningEffort ?? 'low',
      });
      let text = '';
      let usage = emptyUsage();
      const stream = student.chat(
        {
          messages: [{ role: 'system', content: system }, ...request.messages],
          tools: [],
          decoding,
          seed,
        },
        signal,
      );
      for await (const event of stream) {
        if (event.type === 'text') text += event.delta;
        else if (event.type === 'done') usage = event.usage;
      }
      return {
        text,
        json: request.json ? extractJson(text) : undefined,
        usage,
        costUsd: 0,
        model: student.model,
        latencyMs: Math.round(performance.now() - started),
      };
    },
    estimateCostUsd: () => 0,
    testConnection: () => student.testConnection(),
  };
}
