import { createLlamaCppStudent, createOllamaStudent } from '@architect/adapters';
import { skillFiles } from '@architect/harness';
import {
  AdapterError,
  StudentEndpointSchema,
  type LlamaServerAccess,
  type LlamaServerLease,
  type LoraScale,
  type StudentAdapter,
  type Trace,
} from '@architect/shared';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { runAgent } from '../src/agent/loop';
import { openAgentFiles } from '../src/files/agent-files';
import { createSandbox } from '../src/sandbox/sandbox';
import type { Sandbox } from '../src/sandbox/types';
import { startFakeOllama, type ScriptedTurn } from './agent-host/fake-ollama';
import { startFakeLlamaChat, type FakeLlamaChat } from './support/fake-llama-chat';
import { makeHarness, makeJob, makeJobDir, SAMPLE_FILES } from './support/fixtures';

/*
 * The agent loop behaves the same on each local runtime's student. Graduates without an adapter
 * answer through Ollama and those with one through llama.cpp, so the same scripted turns go
 * through both real adapters, over fake servers on 127.0.0.1: tool calls run and their results
 * go back, reasoning is counted and kept out of the conversation, a garbled reply fails only
 * the attempt, and a runtime failure stops the run with the adapter's error.
 */

let sandbox: Sandbox;
beforeAll(() => {
  sandbox = createSandbox();
});
afterAll(() => sandbox.dispose());

const cleanups: (() => unknown)[] = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) await cleanup();
});

/** A failed request is reported at once instead of after backoff. */
const ONCE = { retry: { maxAttempts: 1 } };

const LORA: LoraScale[] = [
  { id: 0, scale: 1 },
  { id: 1, scale: 0 },
];

interface Rig {
  student: StudentAdapter;
  /** The messages of each chat request, as the server got them. */
  sent(): unknown[][];
}

interface LlamaRig extends Rig {
  fake: FakeLlamaChat;
  leases: { taken: number; returned: number };
}

async function ollamaRig(script: readonly ScriptedTurn[]): Promise<Rig> {
  const fake = await startFakeOllama(script);
  cleanups.push(() => fake.close());
  const endpoint = StudentEndpointSchema.parse({
    runtime: 'ollama',
    baseUrl: fake.url,
    model: 'muse-glimmer:30b',
  });
  return {
    student: createOllamaStudent(endpoint, ONCE),
    sent: () => fake.chats().map((chat) => chat.messages),
  };
}

async function llamaRig(
  script: readonly ScriptedTurn[],
  acquire?: LlamaServerAccess['acquire'],
): Promise<LlamaRig> {
  const fake = await startFakeLlamaChat(script);
  cleanups.push(() => fake.close());
  const leases = { taken: 0, returned: 0 };
  const lease = (): Promise<LlamaServerLease> => {
    leases.taken += 1;
    return Promise.resolve({
      url: fake.url,
      apiKey: fake.key,
      lora: LORA,
      release: () => {
        leases.returned += 1;
      },
    });
  };
  const access: LlamaServerAccess = {
    model: 'muse-glimmer:30b-iq2',
    baseUrl: fake.url,
    acquire: acquire ?? lease,
    check: () => Promise.resolve({ ok: true, latencyMs: 0, detail: 'A fake llama-server.' }),
    describe: () => Promise.resolve({ model: 'muse-glimmer:30b-iq2' }),
    stop: () => Promise.resolve(),
  };
  return {
    student: createLlamaCppStudent(access, ONCE),
    sent: () => fake.chats().map((chat) => chat.messages),
    fake,
    leases,
  };
}

async function attempt(student: StudentAdapter): Promise<Trace> {
  const folder = makeJobDir();
  cleanups.push(() => folder.remove());
  const harness = makeHarness();
  const files = await openAgentFiles({
    dataDir: folder.dataDir,
    files: SAMPLE_FILES,
    skills: skillFiles(harness),
    mode: 'scratch',
  });
  return runAgent({
    harness,
    job: makeJob(),
    student,
    files,
    sandbox,
    request: 'Which invoices are unpaid?',
    mode: 'task',
    seed: 42,
  });
}

/** 34 characters of reasoning in five pieces, then 24 in three. */
const READ_THEN_ANSWER: ScriptedTurn[] = [
  {
    thinking: 'Let me look at the invoices first.',
    toolCalls: [{ name: 'read', arguments: { path: 'data/invoices.csv' } }],
  },
  { thinking: 'Two have no payment yet.', text: 'INV-2 and INV-3 are unpaid.' },
];

const RIGS: [string, (script: readonly ScriptedTurn[]) => Promise<Rig>][] = [
  ['Ollama', ollamaRig],
  ['llama.cpp', llamaRig],
];

describe.each(RIGS)('the agent loop on a student served by %s', (_runtime, rig) => {
  it('runs its tool calls, sends back the results, and counts the reasoning it leaves out', async () => {
    const { student, sent } = await rig(READ_THEN_ANSWER);
    const trace = await attempt(student);

    expect(trace).toMatchObject({ stopReason: 'answer', finalText: 'INV-2 and INV-3 are unpaid.' });
    expect(trace.steps.map((step) => step.kind)).toEqual(['model', 'tool', 'model']);
    const [asked, read, answered] = trace.steps;
    expect(asked).toMatchObject({
      kind: 'model',
      text: '',
      toolCalls: [{ name: 'read', arguments: { path: 'data/invoices.csv' } }],
      usage: { inputTokens: 120, outputTokens: 30, reasoningTokens: 5 },
    });
    const callId = asked?.kind === 'model' ? asked.toolCalls[0]?.id : undefined;
    expect(read).toMatchObject({
      kind: 'tool',
      callId,
      name: 'read',
      result: expect.stringContaining('INV-2,C-2,4550,2026-11-15,') as unknown,
    });
    expect(read).not.toHaveProperty('error');
    expect(answered).toMatchObject({
      kind: 'model',
      text: 'INV-2 and INV-3 are unpaid.',
      toolCalls: [],
      usage: { inputTokens: 120, outputTokens: 30, reasoningTokens: 3 },
    });
    expect(trace.usage).toEqual({
      inputTokens: 240,
      outputTokens: 60,
      reasoningTokens: 8,
      cachedInputTokens: 0,
    });

    // The reasoning is counted, never kept: not in the trace, not in what goes back to the model.
    expect(JSON.stringify(trace)).not.toMatch(/Let me look|no payment yet/);
    const requests = sent();
    expect(requests).toHaveLength(2);
    expect(JSON.stringify(requests[1])).not.toContain('Let me look');
    expect(requests[1]?.at(-1)).toMatchObject({
      role: 'tool',
      content: read?.kind === 'tool' ? read.result : undefined,
    });
  });

  it('ends only the attempt when the model garbles a tool call', async () => {
    const { student } = await rig([
      { toolCalls: [{ name: 'read', arguments: '{"path": "data/invoi' }] },
    ]);
    const trace = await attempt(student);
    expect(trace).toMatchObject({
      stopReason: 'error',
      error: expect.stringContaining(
        `a call to "read" whose arguments aren't valid JSON`,
      ) as unknown,
    });
    expect(trace.steps).toEqual([]);
  });

  it('stops the run with the adapter error when the runtime fails', async () => {
    const { student } = await rig([{ status: 500, error: 'CUDA error: out of memory' }]);
    const failure = await attempt(student).catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(AdapterError);
    expect(failure).toMatchObject({
      code: 'server',
      message: expect.stringContaining('CUDA error: out of memory') as unknown,
    });
  });
});

describe("the agent loop and llama-server's leases", () => {
  it("sends each turn with the lease's key and adapter scales, and gives every lease back", async () => {
    const { student, fake, leases } = await llamaRig(READ_THEN_ANSWER);
    const trace = await attempt(student);

    expect(trace.stopReason).toBe('answer');
    expect(fake.chats().map((chat) => chat.lora)).toEqual([LORA, LORA]);
    expect(leases).toEqual({ taken: 2, returned: 2 });
    // The tool result answers the call under the id llama-server gave it.
    expect(trace.steps[0]).toMatchObject({ toolCalls: [{ id: 'fake_1_0' }] });
    expect(fake.chats()[1]?.messages.at(-1)).toMatchObject({
      role: 'tool',
      tool_call_id: 'fake_1_0',
      name: 'read',
    });
  });

  it('gives the lease back when the server fails partway through a run', async () => {
    const { student, leases } = await llamaRig([
      READ_THEN_ANSWER[0] ?? {},
      { status: 503, error: 'Loading model' },
    ]);
    await expect(attempt(student)).rejects.toMatchObject({ name: 'AdapterError', code: 'server' });
    expect(leases).toEqual({ taken: 2, returned: 2 });
  });

  it("stops the run with the runtime's error when the server can't start", async () => {
    const unusable = new AdapterError(
      'bad_request',
      "The adapter for v2 doesn't fit muse-glimmer:30b-iq2: The base model has no blk.2.attn_q.weight.",
    );
    const { student, fake } = await llamaRig([], () => Promise.reject(unusable));
    await expect(attempt(student)).rejects.toBe(unusable);
    expect(fake.chats()).toEqual([]);
  });
});
