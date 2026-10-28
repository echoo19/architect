import { join } from 'node:path';
import { skillFiles } from '@architect/harness';
import type {
  ChatMessage,
  Harness,
  Job,
  ReplaySetup,
  ToolCall,
  Trace,
  TraceStep,
  WriteRecord,
} from '@architect/shared';
import { openAgentFiles, type AgentFiles } from '../files/agent-files';
import type { Sandbox } from '../sandbox/types';
import { TOOL_RUNTIME } from '../tools/specs';
import { createToolbox } from '../tools/toolbox';

type ModelStep = Extract<TraceStep, { kind: 'model' }>;
type ToolStep = Extract<TraceStep, { kind: 'tool' }>;

/** One model turn of a trace: what the model said and the tool calls it made, with results. */
export interface TraceTurn {
  /** Counting from 1. */
  number: number;
  model: ModelStep;
  tools: ToolStep[];
}

/** A trace's model turns in order, each with the tool steps that answered it. */
export function traceTurns(trace: Trace): TraceTurn[] {
  const turns: TraceTurn[] = [];
  for (const step of trace.steps) {
    if (step.kind === 'model') {
      turns.push({ number: turns.length + 1, model: step, tools: [] });
    } else if (step.kind === 'tool') {
      turns.at(-1)?.tools.push(step);
    }
  }
  return turns;
}

/**
 * The state an attempt was in just before one of its model turns: the conversation so far and
 * the agent's files, rebuilt from the original data by replaying every tool call before it.
 */
export interface Checkpoint {
  /** The model turn the continuation takes first; at least 2, since turn 1 is the whole task. */
  turn: number;
  /** The system prompt, the request and the student's turns before `turn`, as it saw them. */
  messages: ChatMessage[];
  files: AgentFiles;
  /** Every file's text when the attempt began. */
  startTexts: Record<string, string>;
  /** What the attempt started from, as its trace recorded it. */
  replay: ReplaySetup;
  replayedCalls: number;
  /** The tool calls replayed, in order, for the checker's view of the whole episode. */
  calls: ToolCall[];
}

export type CheckpointResult = { ok: true; checkpoint: Checkpoint } | { ok: false; reason: string };

export interface CheckpointInput {
  trace: Trace;
  job: Job;
  /** The job folder; its `data/` holds the original files. */
  jobDir: string;
  /** The harness version the attempt ran with. */
  harness: Harness;
  sandbox: Sandbox;
  /** The date the run works as of, YYYY-MM-DD. */
  today: string;
  /** Resume before this model turn: after the last whole tool batch before it. */
  turn: number;
}

function diverged(reason: string): CheckpointResult {
  return { ok: false, reason };
}

/** The first difference between the data an attempt started from and the data here now. */
function dataDifference(recorded: ReplaySetup['data'], now: ReplaySetup['data']): string | null {
  const paths = [...new Set([...Object.keys(recorded), ...Object.keys(now)])].sort();
  for (const path of paths) {
    if (recorded[path] === undefined) return `${path} wasn't there when the attempt began`;
    if (now[path] === undefined) return `${path} is gone`;
    if (recorded[path] !== now[path])
      return `${path} differs from the bytes the attempt began with`;
  }
  return null;
}

/** The place in the conversation where a model turn's assistant message is. */
function turnIndex(messages: readonly ChatMessage[], turn: number): number {
  let seen = 0;
  for (const [index, message] of messages.entries()) {
    if (message.role !== 'assistant') continue;
    seen += 1;
    if (seen === turn) return index;
  }
  return -1;
}

function sameChange(a: WriteRecord | undefined, b: WriteRecord | undefined): boolean {
  if (a === undefined || b === undefined) return a === b;
  return a.path === b.path && a.patch === b.patch && a.applied === b.applied && a.op === b.op;
}

/**
 * Rebuilds the state before model turn `turn` of a recorded attempt. It starts from a fresh
 * scratch copy of the original data and checks it is what the attempt began with: the data's
 * hashes, the harness hash, the tools' version and the working date. Then it replays every
 * recorded tool call before the turn through the same tools and checks each result's text and
 * each file change against the record. Any difference ends the replay with the reason; nothing
 * is repaired to make it match.
 */
export async function rebuildCheckpoint(input: CheckpointInput): Promise<CheckpointResult> {
  const { trace, job, harness, turn } = input;
  const setup = trace.replay;
  if (setup === undefined) {
    return diverged("The attempt's trace has no record of what it started from.");
  }
  const turns = traceTurns(trace);
  if (turn < 2 || turn > turns.length) {
    return diverged(
      `Turn ${turn} isn't a point to resume from: the attempt took ${turns.length} model turns, and turn 1 is the whole task.`,
    );
  }
  if (setup.harnessHash !== harness.meta.hash) {
    return diverged('The harness changed since the attempt: its hash differs from the record.');
  }
  if (setup.toolRuntime !== TOOL_RUNTIME) {
    return diverged(
      `The attempt ran on tools ${setup.toolRuntime}, and these are ${TOOL_RUNTIME}.`,
    );
  }
  if (setup.today !== input.today) {
    return diverged(`The attempt worked as of ${setup.today}, not ${input.today}.`);
  }
  const at = turnIndex(trace.messages, turn);
  if (at < 0 || trace.messages[0]?.role !== 'system') {
    return diverged("The attempt's conversation doesn't hold its turns as recorded.");
  }

  const files = await openAgentFiles({
    dataDir: join(input.jobDir, 'data'),
    files: job.data.files,
    ...(job.data.output === undefined ? {} : { output: job.data.output }),
    skills: skillFiles(harness),
    mode: 'scratch',
  });
  const difference = dataDifference(setup.data, files.dataHashes());
  if (difference !== null) return diverged(`The data changed since the attempt: ${difference}.`);
  const startTexts = files.texts();
  const toolbox = createToolbox({ harness, files, sandbox: input.sandbox, today: input.today });
  const results = new Map(
    trace.messages.flatMap((message) =>
      message.role === 'tool' ? [[message.toolCallId, message.content] as const] : [],
    ),
  );

  const calls: ToolCall[] = [];
  for (const recorded of turns.slice(0, turn - 1)) {
    for (const call of recorded.model.toolCalls) {
      const step = recorded.tools.find((tool) => tool.callId === call.id);
      const content = results.get(call.id);
      if (step === undefined || content === undefined) {
        return diverged(`Turn ${recorded.number}'s ${call.name} call has no recorded result.`);
      }
      const outcome = await toolbox.run(call);
      if (outcome.content !== content) {
        return diverged(
          `Turn ${recorded.number}: ${call.name} returned different text than it did in the attempt.`,
        );
      }
      if (!sameChange(outcome.change, step.change)) {
        return diverged(
          `Turn ${recorded.number}: ${call.name} changed ${step.change?.path ?? outcome.change?.path ?? 'a file'} differently than it did in the attempt.`,
        );
      }
      calls.push(call);
    }
  }
  return {
    ok: true,
    checkpoint: {
      turn,
      messages: trace.messages.slice(0, at),
      files,
      startTexts,
      replay: setup,
      replayedCalls: calls.length,
      calls,
    },
  };
}
