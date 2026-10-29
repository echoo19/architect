import {
  AdapterError,
  GuardError,
  type ActorAdapter,
  type StudentAdapter,
  type StudentStreamEvent,
  type Usage,
} from '@architect/shared';
import { chatPayloadText, type MentorGate } from '../mentor/gate';

/** One call of the mentor's model acting as the agent, as it was charged. */
export interface ActorCharge {
  model: string;
  usage: Usage;
  costUsd: number;
}

export interface GatedActorOptions {
  /** Called once per call that ran, with what it is charged against the mentor budget. */
  onCharge(charge: ActorCharge): void;
}

/**
 * The guard's own error, when a gated actor's call was refused: the budget, the leak check or
 * a released mentor. The agent loop only sees an adapter error, which stops the attempt.
 */
export function refusalOf(error: unknown): GuardError | null {
  if (error instanceof GuardError) return error;
  if (error instanceof AdapterError && error.cause instanceof GuardError) return error.cause;
  return null;
}

/**
 * The mentor's model as a student the agent loop can drive, every turn admitted through the
 * mentor's gate: refused once the mentor is released, refused when anything it would send
 * matches the locked test, and refused when the most the turn could cost doesn't fit the budget.
 * A refusal reaches the loop as an adapter error, so the attempt stops instead of scoring it.
 */
export function gatedActor(
  actor: ActorAdapter,
  gate: MentorGate,
  options: GatedActorOptions,
): StudentAdapter {
  async function* chat(
    request: Parameters<StudentAdapter['chat']>[0],
    signal?: AbortSignal,
  ): AsyncGenerator<StudentStreamEvent> {
    let admission;
    try {
      admission = gate.admit(
        actor,
        chatPayloadText(request.messages, request.tools),
        request.decoding.maxOutputTokens,
      );
    } catch (error) {
      if (!(error instanceof GuardError)) throw error;
      throw new AdapterError('blocked', error.message, { cause: error });
    }
    let usage: Usage | null = null;
    try {
      for await (const event of actor.chat(request, signal)) {
        if (event.type === 'done') usage = event.usage;
        yield event;
      }
    } finally {
      // A call that ran is charged, whether or not its reply could be used. One that ended without
      // saying what it used (a broken stream, a filtered reply, no usage reported) is charged the
      // most it was allowed to cost, so the dollar cap still holds.
      const known = usage !== null && usage.inputTokens + usage.outputTokens > 0;
      options.onCharge({
        model: actor.model,
        usage: usage ?? { inputTokens: 0, outputTokens: 0 },
        costUsd: known && usage !== null ? admission.charge(usage) : admission.authorizedUsd,
      });
    }
  }

  return {
    label: actor.label,
    model: actor.model,
    baseUrl: actor.baseUrl,
    isLocal: actor.isLocal,
    contextLength: actor.contextLength,
    chat,
    describe: () => actor.describe(),
    testConnection: () => actor.testConnection(),
    release: () => actor.release(),
  };
}
