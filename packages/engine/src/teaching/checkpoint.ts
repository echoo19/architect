import { taskDataDir } from '../loop/organizations';
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
import type { Sandbox, SandboxData } from '../sandbox/types';
import { TOOL_RUNTIME } from '../tools/specs';
import { createToolbox, type Toolbox } from '../tools/toolbox';

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
  /** The job folder; its `data/`, or the organization's `orgs/<id>/data/`, holds the original files. */
  jobDir: string;
  /** The organization the attempt's task was for, when the job has organizations. */
  org?: string;
  /** The harness version the attempt ran with. */
  harness: Harness;
  sandbox: Sandbox;
  /** The date the run works as of, YYYY-MM-DD. */
  today: string;
  /** Resume before this model turn: after the last whole tool batch before it. */
  turn: number;
}

function diverged(reason: string): { ok: false; reason: string } {
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

/** A recorded attempt opened again on a fresh scratch copy of its data, checked against the record. */
interface OpenedReplay {
  files: AgentFiles;
  startTexts: Record<string, string>;
  toolbox: Toolbox;
  /** Each call's recorded result text, by call id. */
  results: Map<string, string>;
  turns: TraceTurn[];
  replay: ReplaySetup;
}

type ReplayInput = Omit<CheckpointInput, 'turn'>;

/**
 * Opens a fresh scratch copy of the original data after checking the attempt's record holds
 * here: the harness hash, the tools' version, the working date, and then the data's hashes.
 */
async function openReplay(
  input: ReplayInput,
  setup: ReplaySetup,
): Promise<{ ok: true; opened: OpenedReplay } | { ok: false; reason: string }> {
  const { trace, job, harness } = input;
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
  const files = await openAgentFiles({
    dataDir: taskDataDir(input.jobDir, input),
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
  return {
    ok: true,
    opened: { files, startTexts, toolbox, results, turns: traceTurns(trace), replay: setup },
  };
}

/** Replays one recorded call; why its text or file change differs from the record, or null. */
async function replayCall(
  opened: OpenedReplay,
  turn: TraceTurn,
  call: ToolCall,
): Promise<string | null> {
  const step = turn.tools.find((tool) => tool.callId === call.id);
  const content = opened.results.get(call.id);
  if (step === undefined || content === undefined) {
    return `Turn ${turn.number}'s ${call.name} call has no recorded result.`;
  }
  const outcome = await opened.toolbox.run(call);
  if (outcome.content !== content) {
    return `Turn ${turn.number}: ${call.name} returned different text than it did in the attempt.`;
  }
  if (!sameChange(outcome.change, step.change)) {
    return `Turn ${turn.number}: ${call.name} changed ${step.change?.path ?? outcome.change?.path ?? 'a file'} differently than it did in the attempt.`;
  }
  return null;
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
  const { trace, turn } = input;
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
  const at = turnIndex(trace.messages, turn);
  const opening = await openReplay(input, setup);
  if (!opening.ok) return opening;
  if (at < 0 || trace.messages[0]?.role !== 'system') {
    return diverged("The attempt's conversation doesn't hold its turns as recorded.");
  }
  const { opened } = opening;
  const calls: ToolCall[] = [];
  for (const recorded of opened.turns.slice(0, turn - 1)) {
    for (const call of recorded.model.toolCalls) {
      const problem = await replayCall(opened, recorded, call);
      if (problem !== null) return diverged(problem);
      calls.push(call);
    }
  }
  return {
    ok: true,
    checkpoint: {
      turn,
      messages: trace.messages.slice(0, at),
      files: opened.files,
      startTexts: opened.startTexts,
      replay: opened.replay,
      replayedCalls: calls.length,
      calls,
    },
  };
}

/** One call of a recorded attempt, replayed: the call and the data it was given. */
export interface ReplayedCall {
  call: ToolCall;
  /** The files just before the call, as the sandbox hands them to a helper. */
  data: SandboxData;
}

export type ReplayedCallResult =
  { ok: true; replayed: ReplayedCall } | { ok: false; reason: string };

/**
 * Replays a recorded attempt up to and including one of its calls, checked call by call as a
 * checkpoint is, and returns the data that call was given. The call's own text must match the
 * record too, so the inputs are the ones the attempt really used.
 */
export async function replayToCall(
  input: ReplayInput & { callId: string },
): Promise<ReplayedCallResult> {
  const setup = input.trace.replay;
  if (setup === undefined) {
    return diverged("The attempt's trace has no record of what it started from.");
  }
  const opening = await openReplay(input, setup);
  if (!opening.ok) return opening;
  const { opened } = opening;
  for (const turn of opened.turns) {
    for (const call of turn.model.toolCalls) {
      const data = call.id === input.callId ? opened.files.sandboxData() : null;
      const problem = await replayCall(opened, turn, call);
      if (problem !== null) return diverged(problem);
      if (data !== null) return { ok: true, replayed: { call, data } };
    }
  }
  return diverged(`The attempt has no call ${input.callId}.`);
}
