import type {
  ConnectionTest,
  JsonValue,
  StudentAdapter,
  StudentChatRequest,
  StudentModelInfo,
  StudentStreamEvent,
  Usage,
} from '@architect/shared';

export interface ScriptedTurn {
  text?: string;
  toolCalls?: { name: string; arguments?: Record<string, JsonValue> }[];
  usage?: Usage;
  /** Throw this instead of answering, as a failing adapter would. */
  error?: Error;
  /** Wait this long between streamed text pieces. */
  delayMs?: number;
}

type Script =
  readonly ScriptedTurn[] | ((request: StudentChatRequest, turn: number) => ScriptedTurn);

/** A student that plays back scripted turns in order and records every request it gets. */
export class ScriptedStudent implements StudentAdapter {
  readonly label = 'Scripted';
  readonly model = 'scripted-student';
  readonly baseUrl = 'http://127.0.0.1:1';
  readonly isLocal = true;
  readonly requests: StudentChatRequest[] = [];
  private turn = 0;

  constructor(private readonly script: Script) {}

  async *chat(
    request: StudentChatRequest,
    signal?: AbortSignal,
  ): AsyncGenerator<StudentStreamEvent> {
    this.requests.push(request);
    const index = this.turn++;
    const turn =
      typeof this.script === 'function' ? this.script(request, index) : this.script[index];
    if (!turn) throw new Error(`The scripted student has no turn ${index + 1}.`);
    if (turn.error) throw turn.error;
    for (const piece of (turn.text ?? '').match(/[\s\S]{1,8}/g) ?? []) {
      if (turn.delayMs) await new Promise((resolve) => setTimeout(resolve, turn.delayMs));
      signal?.throwIfAborted();
      yield { type: 'text', delta: piece };
    }
    const calls = turn.toolCalls ?? [];
    for (const [position, call] of calls.entries()) {
      yield {
        type: 'tool_call',
        call: { id: `call_${index}_${position}`, name: call.name, arguments: call.arguments ?? {} },
      };
    }
    yield {
      type: 'done',
      usage: turn.usage ?? { inputTokens: 100, outputTokens: 20 },
      finish: calls.length > 0 ? 'tool_calls' : 'stop',
    };
  }

  async describe(): Promise<StudentModelInfo> {
    return { model: this.model };
  }

  async testConnection(): Promise<ConnectionTest> {
    return { ok: true, latencyMs: 0, detail: 'scripted' };
  }

  async release(): Promise<void> {}
}
