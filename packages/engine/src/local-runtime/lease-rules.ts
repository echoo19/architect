import { z } from 'zod';

/*
 * The rules of the GPU lease (decision 046), as pure functions over its state, so the order in
 * which Architect's processes take turns can be read, and tested, apart from the files that carry
 * it between them.
 */

/**
 * What holds the GPU: one of Architect's llama-servers, which loads the base on the GPU by itself,
 * or Ollama, which every Architect process can share, since Ollama schedules its own models.
 */
export type GpuUse = 'llama-server' | 'ollama';

export const GPU_USES: readonly GpuUse[] = ['llama-server', 'ollama'];

/** Who goes first among those waiting: a reply someone is reading, then a check, then a run. */
export type GpuPriority = 'reply' | 'check' | 'run';

const RANKS: Record<GpuPriority, number> = { run: 0, check: 1, reply: 2 };

export function rankOf(priority: GpuPriority): number {
  return RANKS[priority];
}

/** What a hold of the GPU is for: its place in line, and what to tell whoever has to wait. */
export interface GpuPurpose {
  priority: GpuPriority;
  /** What it does with the GPU, after "is": "answering a chat with Returns desk". */
  doing: string;
  /** What someone kept waiting can do about it. */
  hint: string;
}

/** A training run's request: it holds the GPU for one request, so others get turns between. */
export const RUN_PURPOSE: GpuPurpose = {
  priority: 'run',
  doing: 'using it for a training run',
  hint: 'Wait for the run to reach its next step, or pause it, then try again.',
};

/** An installation check's short request. */
export const CHECK_PURPOSE: GpuPurpose = {
  priority: 'check',
  doing: 'checking an agent on this computer',
  hint: 'Wait for the check to finish, then try again.',
};

/** A reply to someone chatting with an agent, held from its start to its end. */
export function replyPurpose(agent: string): GpuPurpose {
  return {
    priority: 'reply',
    doing: `answering a chat with ${agent}`,
    hint: 'Wait for that reply to finish, or stop it, then try again.',
  };
}

const UseSchema = z.enum(['llama-server', 'ollama']);

/** Who an entry belongs to: one use of the GPU by one process. */
const EntrySchema = z.object({
  /** The process's lease and the use: `<token>:<use>`. */
  user: z.string().min(1),
  pid: z.number().int().positive(),
  /** Which of Architect's processes: `workspace`, `engine`, `cli` or `comparisons`. */
  owner: z.string().min(1),
  use: UseSchema,
  /** When its process last said it was there, in milliseconds since the epoch. */
  beat: z.number(),
});

/** A process holding the GPU: its model is loaded there, or about to be. */
export const HolderSchema = EntrySchema.extend({
  /** A request, or a whole reply, is running on it now. */
  busy: z.boolean(),
  /** It is giving the GPU up: stopping its server, or unloading its models. */
  leaving: z.boolean(),
  doing: z.string(),
  hint: z.string(),
  /** Its llama-server's folder, so a process that takes over after it dies can stop that server. */
  serverDir: z.string().min(1).optional(),
});
export type LeaseHolder = z.infer<typeof HolderSchema>;

/** A process waiting for the GPU. */
export const AskSchema = EntrySchema.extend({
  rank: z.number().int().min(0).max(2),
  /** When it began waiting. */
  since: z.number(),
  doing: z.string(),
});
export type LeaseAsk = z.infer<typeof AskSchema>;

export const LeaseStateSchema = z.object({
  holders: z.array(HolderSchema),
  asks: z.array(AskSchema),
});
export type LeaseState = z.infer<typeof LeaseStateSchema>;

export const emptyLease = (): LeaseState => ({ holders: [], asks: [] });

/** Two uses can share the GPU only when both are Ollama's. */
export function conflicts(a: GpuUse, b: GpuUse): boolean {
  return a === 'llama-server' || b === 'llama-server';
}

/** A place in line: a higher rank goes first, then whoever began waiting first. */
export interface Place {
  user: string;
  rank: number;
  since: number;
}

export function ranksAhead(a: Place, b: Place): boolean {
  if (a.rank !== b.rank) return a.rank > b.rank;
  if (a.since !== b.since) return a.since < b.since;
  return a.user < b.user;
}

/** Holders of other users whose use can't share the GPU with `use`. */
export function blockingHolders(state: LeaseState, user: string, use: GpuUse): LeaseHolder[] {
  return state.holders.filter((holder) => holder.user !== user && conflicts(holder.use, use));
}

/** Others waiting, for a use that can't share with `use`, who go before `place`. */
export function asksAhead(state: LeaseState, use: GpuUse, place: Place): LeaseAsk[] {
  return state.asks.filter(
    (ask) => ask.user !== place.user && conflicts(ask.use, use) && ranksAhead(ask, place),
  );
}

/**
 * Whether a user may take the GPU for `use` from its place in line: nothing that can't share it
 * holds it, and nobody that can't share it is ahead.
 */
export function mayTake(state: LeaseState, use: GpuUse, place: Place): boolean {
  return (
    blockingHolders(state, place.user, use).length === 0 &&
    asksAhead(state, use, place).length === 0
  );
}

/**
 * Whether a user holding the GPU with nothing running on it should give it up: someone who can't
 * share it waits, ahead of the user's own next request when it has one waiting.
 */
export function shouldYield(
  state: LeaseState,
  holder: { user: string; use: GpuUse },
  ownPlace: Place | null,
): boolean {
  return state.asks.some(
    (ask) =>
      ask.user !== holder.user &&
      conflicts(ask.use, holder.use) &&
      (ownPlace === null || ranksAhead(ask, ownPlace)),
  );
}
