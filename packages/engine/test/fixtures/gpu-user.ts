import { join } from 'node:path';
import { createLlamaCppStudent, createStudent } from '@architect/adapters';
import { DecodingSchema, type LlamaServerLease, type StudentAdapter } from '@architect/shared';
import {
  CHECK_PURPOSE,
  GpuLease,
  LocalAdapterRuntime,
  LocalRuntimeError,
  replyPurpose,
  RUN_PURPOSE,
  ServerCommandSchema,
  type GpuPriority,
  type GpuPurpose,
  type ServeRequest,
} from '../../src/local-runtime';

/*
 * One of Architect's processes, for the GPU lease's tests: a share of the lease on the data folder
 * of its own, a llama-server (the stand-in) and Ollama through a student, each used on its
 * parent's word over the IPC channel. Arguments: the data folder, the owner (`workspace`, `engine`
 * or `cli`), the stand-in llama-server's command as JSON, and the folder of Ollama's store.
 */

const [dataDir = '', owner = '', command = '', modelsDir = ''] = process.argv.slice(2);
const gpu = new GpuLease({ dataDir, owner, pollMs: 25, heartbeatMs: 200 });
const runtime = new LocalAdapterRuntime({
  runtimeDir: join(dataDir, 'local-runtime', owner),
  ollamaModelsDir: () => modelsDir,
  env: {},
  freeGpu: async () => undefined,
  command: ServerCommandSchema.parse(JSON.parse(command)),
  gpu,
});

type Message =
  | { id: number; kind: 'serve'; request: ServeRequest; priority: GpuPriority }
  | { id: number; kind: 'hold'; request: ServeRequest; priority: GpuPriority }
  | { id: number; kind: 'release' }
  | { id: number; kind: 'ollama'; baseUrl: string; model: string; priority: GpuPriority }
  | { id: number; kind: 'server' };

const purposeOf = (priority: GpuPriority): GpuPurpose =>
  priority === 'reply'
    ? replyPurpose('Returns desk')
    : priority === 'check'
      ? CHECK_PURPOSE
      : RUN_PURPOSE;

const decoding = DecodingSchema.parse({});

async function ask(student: StudentAdapter): Promise<string> {
  let text = '';
  for await (const event of student.chat({
    messages: [{ role: 'user', content: 'Which invoices are open?' }],
    tools: [],
    decoding,
    seed: 1,
  })) {
    if (event.type === 'text') text += event.delta;
  }
  return text;
}

/** A request in flight that stays in flight: the GPU held and the server started, until released. */
let held: LlamaServerLease | null = null;

async function act(message: Message): Promise<unknown> {
  switch (message.kind) {
    case 'serve':
      return ask(
        createLlamaCppStudent(runtime.access(message.request, purposeOf(message.priority))),
      );
    case 'hold':
      held = await runtime.access(message.request, purposeOf(message.priority)).acquire();
      return runtime.status().pid;
    case 'release':
      held?.release();
      held = null;
      return null;
    case 'ollama': {
      const endpoint = {
        runtime: 'ollama' as const,
        baseUrl: message.baseUrl,
        model: message.model,
        contextLength: 16_384,
      };
      return ask(
        gpu.ollama.student(endpoint, createStudent(endpoint), purposeOf(message.priority)),
      );
    }
    case 'server':
      return runtime.status().pid;
  }
}

process.on('message', (raw) => {
  const message = raw as Message;
  act(message).then(
    (result) => process.send?.({ id: message.id, ok: true, result }),
    (error: unknown) =>
      process.send?.({
        id: message.id,
        ok: false,
        error: {
          name: error instanceof Error ? error.name : 'Error',
          message: error instanceof Error ? error.message : String(error),
          code: (error as { code?: unknown }).code,
          hint: error instanceof LocalRuntimeError ? error.hint : undefined,
        },
      }),
  );
});

process.once('disconnect', () => {
  void runtime
    .stop()
    .then(() => gpu.close())
    .finally(() => process.exit(0));
});

process.send?.({ ready: true });
