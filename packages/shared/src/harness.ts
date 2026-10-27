import { z } from 'zod';
import { ChatMessageSchema } from './chat';
import { JsonSchemaObjectSchema } from './json';

export const HARNESS_FORMAT = 1;

const slug = z.string().regex(/^[a-z0-9][a-z0-9-]{0,59}$/);
const toolName = z.string().regex(/^[a-z][a-z0-9_]{0,63}$/);

export const HarnessMetaSchema = z.object({
  format: z.literal(HARNESS_FORMAT),
  name: z.string().min(1),
  version: z.number().int().nonnegative(),
  parent: z.number().int().nonnegative().optional(),
  hash: z.string(),
});
export type HarnessMeta = z.infer<typeof HarnessMetaSchema>;

export const SkillSchema = z.object({
  slug,
  name: z.string().min(1),
  summary: z.string().min(1),
  taskTypes: z.array(z.string()).default([]),
  body: z.string(),
});
export type Skill = z.infer<typeof SkillSchema>;

export const HarnessToolSchema = z.object({
  name: toolName,
  description: z.string().min(1),
  parameters: JsonSchemaObjectSchema,
  /** JavaScript source that defines `function run(args, ctx)`. Runs only in the sandbox. */
  code: z.string().min(1),
});
export type HarnessTool = z.infer<typeof HarnessToolSchema>;

export const ExampleSchema = z.object({
  slug,
  title: z.string().min(1),
  taskTypes: z.array(z.string()).default([]),
  messages: z.array(ChatMessageSchema).min(1),
});
export type Example = z.infer<typeof ExampleSchema>;

export const RetrievalRuleSchema = z.object({
  whenAny: z.array(z.string().min(1)).min(1),
  loadSkills: z.array(slug).default([]),
  loadExamples: z.array(slug).default([]),
});
export type RetrievalRule = z.infer<typeof RetrievalRuleSchema>;

export const RetrievalSchema = z.object({
  listSkills: z.boolean().default(true),
  maxLoadedSkills: z.number().int().min(0).max(8).default(2),
  maxExamples: z.number().int().min(0).max(8).default(2),
  rules: z.array(RetrievalRuleSchema).default([]),
});
export type Retrieval = z.infer<typeof RetrievalSchema>;

export const DecodingSchema = z.object({
  /** Meta's recommended sampling for Glimmer. The sampler seed is not here: the runner owns it. */
  temperature: z.number().min(0).max(2).default(1),
  topP: z.number().gt(0).max(1).default(0.95),
  topK: z.number().int().min(0).max(1000).default(64),
  /** Model turns per request. Glimmer makes one tool call per turn, and a write task reads ~10 tables. */
  maxSteps: z.number().int().min(1).max(40).default(16),
  /** Includes reasoning tokens, which count against the cap; hard steps can think for 1,500+. */
  maxOutputTokens: z.number().int().min(64).max(32_768).default(4096),
  /** Reasoning strength. Glimmer always reasons; `low` keeps each step short. */
  thinking: z.enum(['low', 'medium', 'high']).default('low'),
});
export type Decoding = z.infer<typeof DecodingSchema>;

export const GuardrailSchema = z.object({
  taskType: z.string().min(1),
  whenAny: z.array(z.string().min(1)).min(1),
  reason: z.string().min(1),
});
export type Guardrail = z.infer<typeof GuardrailSchema>;

export const GuardrailsSchema = z.object({
  refuse: z.array(GuardrailSchema).default([]),
});
export type Guardrails = z.infer<typeof GuardrailsSchema>;

export const HarnessSchema = z.object({
  meta: HarnessMetaSchema,
  system: z.string(),
  skills: z.array(SkillSchema).default([]),
  tools: z.array(HarnessToolSchema).default([]),
  examples: z.array(ExampleSchema).default([]),
  retrieval: RetrievalSchema,
  decoding: DecodingSchema,
  guardrails: GuardrailsSchema,
});
export type Harness = z.infer<typeof HarnessSchema>;

/**
 * Files the mentor may write or delete, relative to the harness folder. `harness.yaml` is
 * managed by the runner, and nothing outside this surface (checker, splits, data, permissions)
 * can be touched by a change.
 */
export const HARNESS_SURFACE: readonly RegExp[] = [
  /^system\.md$/,
  /^skills\/[a-z0-9][a-z0-9-]{0,59}\.md$/,
  /^tools\/[a-z][a-z0-9_]{0,63}\.(json|js)$/,
  /^examples\/[a-z0-9][a-z0-9-]{0,59}\.json$/,
  /^retrieval\.yaml$/,
  /^decoding\.yaml$/,
  /^guardrails\.yaml$/,
];

export function isHarnessSurfacePath(path: string): boolean {
  return HARNESS_SURFACE.some((pattern) => pattern.test(path));
}
