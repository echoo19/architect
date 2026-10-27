import type {
  MentorAdapter,
  MentorCompletion,
  MentorCompletionRequest,
  StudentAdapter,
  StudentChatRequest,
  StudentEndpoint,
  StudentModelInfo,
  StudentStreamEvent,
  Usage,
} from '@architect/shared';

export interface HypothesisReply {
  title: string;
  diagnosis: string;
  causeTaskIds: string[];
  edits: { op: 'write' | 'delete'; path: string; content: string }[];
  predicted: { devDeltaMin: number; devDeltaMax: number; rationale: string };
  readyClaim: boolean;
}

/** A reply in the mentor's JSON format whose one edit rewrites system.md. */
export function hypothesis(title: string, system: string, extra: Partial<HypothesisReply> = {}) {
  return {
    title,
    diagnosis: `${title}: the traces show the rule is missing.`,
    causeTaskIds: [],
    edits: [{ op: 'write' as const, path: 'system.md', content: system }],
    predicted: { devDeltaMin: 1, devDeltaMax: 3, rationale: 'Three dev tasks of the type.' },
    readyClaim: false,
    ...extra,
  };
}

/** A mentor that answers from a script and remembers every request it was sent. */
export class FakeMentor implements MentorAdapter {
  readonly kind = 'model' as const;
  readonly label = 'Spark';
  readonly model = 'fake-mentor-1';
  readonly provider = 'fake';
  readonly requests: MentorCompletionRequest[] = [];
  script: (request: MentorCompletionRequest, call: number) => unknown = () => {
    throw new Error('No mentor reply was scripted.');
  };

  async complete(request: MentorCompletionRequest): Promise<MentorCompletion> {
    this.requests.push(request);
    const json = this.script(request, this.requests.length);
    const usage = { inputTokens: 2000, outputTokens: 500 };
    return {
      text: JSON.stringify(json),
      json,
      usage,
      costUsd: this.estimateCostUsd(usage),
      model: this.model,
      latencyMs: 5,
    };
  }

  estimateCostUsd(usage: Usage): number {
    return (usage.inputTokens * 1.25 + usage.outputTokens * 4.25) / 1_000_000;
  }

  async testConnection() {
    return { ok: true as const, latencyMs: 1, detail: 'fake' };
  }
}

/** A student whose chat replies come from a function; attempts go through the fake runtime. */
export class FakeStudent implements StudentAdapter {
  readonly label: string;
  readonly model: string;
  readonly baseUrl: string;
  readonly isLocal: boolean;
  readonly chats: StudentChatRequest[] = [];
  released = 0;

  constructor(
    endpoint: StudentEndpoint,
    private readonly reply: (request: StudentChatRequest, call: number) => string,
  ) {
    this.label = 'Glimmer';
    this.model = endpoint.model;
    this.baseUrl = endpoint.baseUrl;
    this.isLocal = new URL(endpoint.baseUrl).hostname === '127.0.0.1';
  }

  async *chat(request: StudentChatRequest): AsyncIterable<StudentStreamEvent> {
    this.chats.push(request);
    yield { type: 'text', delta: this.reply(request, this.chats.length) };
    yield { type: 'done', usage: { inputTokens: 300, outputTokens: 80 }, finish: 'stop' };
  }

  /** A hosted copy reports only its model id, as the OpenAI-compatible adapter does. */
  async describe(): Promise<StudentModelInfo> {
    if (!this.isLocal) return { model: this.model };
    return {
      model: this.model,
      quantization: 'Q4_K_M',
      digest: 'sha256:fake',
      contextLength: 16_384,
    };
  }

  async testConnection() {
    return { ok: true as const, latencyMs: 1, detail: 'fake' };
  }

  async release() {
    this.released += 1;
  }
}
