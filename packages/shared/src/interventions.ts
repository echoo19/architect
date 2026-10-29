import { z } from 'zod';

/*
 * The kinds of change a mentor may choose from each round, and which of them a job allows. They
 * are here and not in `mentor.ts` because a job holds the person's choice among them, and
 * `mentor.ts` already reads from `job.ts`.
 */

/** The bounded intervention menu (spec section 7). */
export const InterventionTypeSchema = z.enum([
  /** A rule or a step-by-step procedure in AGENTS.md or a skill. */
  'procedure',
  /** Which skill, example or source loads for which request. */
  'retrieval',
  /** A small typed tool in the sandbox. */
  'helper',
  /** A LoRA adapter trained on verified lessons. */
  'weights',
  /** One question for the person, asked before any label is made. */
  'clarification',
]);
export type InterventionType = z.infer<typeof InterventionTypeSchema>;

/** The kinds that change the agent. A question to the person changes nothing by itself. */
export const AGENT_INTERVENTIONS: readonly InterventionType[] = [
  'procedure',
  'retrieval',
  'helper',
  'weights',
];

/** What a person calls each kind, on the screen where they choose and wherever it is refused. */
export const INTERVENTION_LABELS: Readonly<Record<InterventionType, string>> = {
  procedure: 'Instructions and steps',
  retrieval: 'What it reads when',
  helper: 'Small tools',
  weights: 'Its weights',
  clarification: 'Questions for you',
};

/**
 * The kinds of change a job lets the mentor use. At least one must change the agent, since a
 * mentor that may only ask questions teaches nothing, and each kind is listed once.
 */
export const AllowedInterventionsSchema = z
  .array(InterventionTypeSchema)
  .refine((types) => new Set(types).size === types.length, 'List each kind of change once.')
  .refine(
    (types) => types.some((type) => AGENT_INTERVENTIONS.includes(type)),
    'Keep at least one way to change the agent: instructions and steps, what it reads when, small tools or its weights. Questions alone teach nothing.',
  );

/** Anything that holds a job's choice of interventions. */
export interface InterventionChoice {
  interventions?: readonly InterventionType[] | undefined;
}

/** The kinds the job lets the mentor use, in the menu's order. A job that says nothing allows all. */
export function allowedInterventions(job: InterventionChoice): InterventionType[] {
  const chosen = job.interventions;
  return InterventionTypeSchema.options.filter(
    (type) => chosen === undefined || chosen.includes(type),
  );
}

/** Whether the job lets the mentor use a kind of change. */
export function mayIntervene(job: InterventionChoice, type: InterventionType): boolean {
  return allowedInterventions(job).includes(type);
}

/**
 * What a job stores for a set of allowed kinds: the list in the menu's order, or nothing at all
 * when every kind is allowed, so a job that never changed the choice is left as it was.
 */
export function storedInterventions(
  allowed: Iterable<InterventionType>,
): InterventionType[] | undefined {
  const chosen = new Set(allowed);
  const list = InterventionTypeSchema.options.filter((type) => chosen.has(type));
  return list.length === InterventionTypeSchema.options.length ? undefined : list;
}

/**
 * The kinds of change that may write a harness file. A skill is a procedure and something a
 * retrieval rule loads, so either kind may write one. Decoding and guardrails belong to no kind
 * (null): changing them is no more one kind of change than another.
 */
export function interventionsForFile(path: string): readonly InterventionType[] | null {
  if (path === 'AGENTS.md') return ['procedure'];
  if (path.startsWith('skills/')) return ['procedure', 'retrieval'];
  if (path.startsWith('tools/')) return ['helper'];
  if (path === 'retrieval.yaml' || path.startsWith('examples/')) return ['retrieval'];
  return null;
}

/**
 * The first of these harness files a job's choice keeps the mentor from writing or deleting,
 * with the kinds that could have, or null when it may write them all.
 */
export function fileOffLimits(
  paths: readonly string[],
  job: InterventionChoice,
): { path: string; kinds: readonly InterventionType[] } | null {
  const allowed = allowedInterventions(job);
  for (const path of paths) {
    const kinds = interventionsForFile(path);
    if (kinds !== null && !kinds.some((kind) => allowed.includes(kind))) return { path, kinds };
  }
  return null;
}
