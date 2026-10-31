import {
  CLI_EXIT_CODES,
  RUN_REQUEST_FORMAT,
  RUN_RESULT_FORMAT,
  RunResultSchema,
  type AgentStep,
  type CliOutcome,
  type RunResult,
  type RunStep,
  type WorkspaceMessage,
} from '@architect/shared';
import cliPackage from '../../package.json' with { type: 'json' };
import { failureOf, type Failure } from '../exit';
import type { AgentSession, Reply } from './session';

/** The command's own version, recorded in every result. */
export const CLI_VERSION = cliPackage.version;

const WRITE_TOOLS = new Set(['write', 'edit', 'append']);

export interface Outcome {
  outcome: CliOutcome;
  failure: Failure | null;
}

/**
 * How a settled reply ended, as an outcome with an exit code. Stopping it is a cancellation; an
 * approval no one could give is not permitted; a reply the runtime broke (the model server down,
 * say) is a runtime error, while one the model ended badly, a refusal or no answer in the steps
 * it had is a task failure.
 */
export function outcomeOf(reply: Reply): Outcome {
  const { message, failure } = reply;
  if (message.status === 'stopped') {
    return {
      outcome: 'cancelled',
      failure: { outcome: 'cancelled', code: 'cancelled', message: 'Stopped before it finished.' },
    };
  }
  if (message.failure?.kind === 'approval_required') {
    const { approval } = message.failure;
    return {
      outcome: 'not_permitted',
      failure: {
        outcome: 'not_permitted',
        code: 'approval_required',
        message: `${approval.summary} needs approval, and nobody could give it, so nothing was written.`,
        hint: 'Run it in a terminal without --non-interactive to answer, or allow writes for this agent in the app.',
      },
    };
  }
  if (message.status === 'error') {
    if (failure !== null) {
      const found = failureOf(failure);
      return { outcome: found.outcome, failure: found };
    }
    return {
      outcome: 'task_failed',
      failure: {
        outcome: 'task_failed',
        code: 'agent_error',
        message: message.error ?? 'The agent stopped with an error.',
      },
    };
  }
  const refusal = message.blocks.find((block) => block.kind === 'refusal');
  if (refusal) {
    return {
      outcome: 'task_failed',
      failure: { outcome: 'task_failed', code: 'refused', message: refusal.reason },
    };
  }
  const note = message.blocks.find((block) => block.kind === 'note');
  if (note) {
    return {
      outcome: 'task_failed',
      failure: { outcome: 'task_failed', code: 'no_answer', message: note.text },
    };
  }
  return { outcome: 'succeeded', failure: null };
}

/** A reply's steps as a result lists them: the tool, what it acted on and what it found. */
export function runSteps(steps: readonly AgentStep[]): RunStep[] {
  return steps.map((step) => ({
    tool: step.name,
    detail: step.detail,
    status: step.status,
    ...(step.meta === undefined ? {} : { summary: step.meta }),
    ...(step.ms === undefined ? {} : { ms: step.ms }),
  }));
}

export interface ResultInput {
  outcome: Outcome;
  session: AgentSession | null;
  message: WorkspaceMessage | null;
  inputs: readonly string[];
  saved: boolean;
  startedAt: Date;
  finishedAt: Date;
}

/** The JSON a run writes: what happened, with the version and setup that ran it. */
export function runResult(input: ResultInput): RunResult {
  const { outcome, session, message } = input;
  const manifest = session?.version.manifest;
  const steps = message?.steps ?? [];
  const approval =
    message?.failure?.kind === 'approval_required' ? message.failure.approval : undefined;
  const refusal = message?.blocks.find((block) => block.kind === 'refusal');
  const failure = outcome.failure;
  return RunResultSchema.parse({
    format: RUN_RESULT_FORMAT,
    status: outcome.outcome,
    exit_code: CLI_EXIT_CODES[outcome.outcome],
    answer: outcome.outcome === 'succeeded' ? (message?.text ?? '') : null,
    agent:
      session && manifest
        ? {
            id: session.agent.id,
            name: session.agent.name,
            version: session.version.version,
            digest: session.version.digest,
            harness_hash: manifest.harness.hash,
            contract_version: manifest.contract.version,
            evaluation: manifest.evidence.status,
            model: {
              label: manifest.model.label,
              runtime: session.installation.model.runtime,
              name: session.installation.model.model,
              base_url: session.installation.model.baseUrl,
            },
          }
        : null,
    inputs: [...input.inputs],
    steps: runSteps(steps),
    artifacts: steps
      .filter(
        (step) => WRITE_TOOLS.has(step.name) && step.status === 'done' && step.meta !== 'declined',
      )
      .map((step) => ({ path: step.detail, tool: step.name, summary: step.meta ?? '' })),
    approval: approval
      ? {
          tool: approval.tool,
          file: approval.file,
          summary: approval.summary,
          ...(approval.diff === undefined ? {} : { diff: approval.diff }),
          ...(approval.patch === undefined ? {} : { patch: approval.patch }),
        }
      : null,
    refusal:
      refusal?.kind === 'refusal' ? { task_type: refusal.taskType, reason: refusal.reason } : null,
    error: failure
      ? {
          code: failure.code,
          message: failure.message,
          ...(failure.hint === undefined ? {} : { hint: failure.hint }),
        }
      : null,
    ...(input.saved && session ? { chat_id: session.chat.id } : {}),
    started_at: input.startedAt.toISOString(),
    finished_at: input.finishedAt.toISOString(),
    duration_ms: Math.max(0, input.finishedAt.getTime() - input.startedAt.getTime()),
    architect: { cli_version: CLI_VERSION, request_format: RUN_REQUEST_FORMAT },
  });
}
