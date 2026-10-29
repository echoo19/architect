import type {
  ActorAdapter,
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

/** A reply in the mentor's JSON format whose one edit rewrites AGENTS.md. */
export function hypothesis(title: string, system: string, extra: Partial<HypothesisReply> = {}) {
  return {
    title,
    diagnosis: `${title}: the traces show the rule is missing.`,
    causeTaskIds: [],
    edits: [{ op: 'write' as const, path: 'AGENTS.md', content: system }],
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
    const json: unknown = await this.script(request, this.requests.length);
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

/** A reply in the mentor's menu format: findings and one intervention. */
export function diagnosis(
  title: string,
  options: {
    system?: string;
    findings?: {
      taskId: string;
      failureTurn?: number;
      category?: { id?: string; slug?: string; label?: string };
    }[];
    intervention?: Partial<{
      type: 'procedure' | 'retrieval' | 'helper' | 'weights' | 'clarification';
      workedExamples: string[];
      practicePerFinding: number;
      question: string;
      estimatedCost: { mentorUsd: number; computeUsd: number; minutes: number };
    }>;
    edits?: HypothesisReply['edits'];
  } = {},
) {
  const type = options.intervention?.type ?? 'procedure';
  const harness = type === 'procedure' || type === 'retrieval' || type === 'helper';
  return {
    ...hypothesis(title, options.system ?? `Service desk.\n${title}`),
    edits: options.edits ?? (harness ? hypothesis(title, options.system ?? title).edits : []),
    findings: (options.findings ?? []).map((finding) => ({
      taskId: finding.taskId,
      failureTurn: finding.failureTurn ?? 2,
      evidence: [{ turn: 1, note: 'It read the jobs table and stopped there.' }],
      cause: 'It never applied the rule the task turns on.',
      category: {
        id: finding.category?.id ?? '',
        slug: finding.category?.slug ?? 'missed-rule',
        label: finding.category?.label ?? 'A rule it missed',
      },
      taskType: 'invoice',
    })),
    intervention: {
      type,
      hypothesis: `${title}: the student misses one rule.`,
      workedExamples: [],
      practicePerFinding: 0,
      question: '',
      estimatedCost: { mentorUsd: 0.1, computeUsd: 0, minutes: 5 },
      verificationPlan: 'Dev passes, checked by the checker.',
      ...options.intervention,
    },
  };
}

/** A student whose chat replies come from a function; attempts go through the fake runtime. */
export class FakeStudent implements StudentAdapter {
  readonly label: string;
  readonly model: string;
  readonly baseUrl: string;
  readonly isLocal: boolean;
  readonly contextLength: number | null;
  readonly chats: StudentChatRequest[] = [];
  released = 0;

  constructor(
    endpoint: StudentEndpoint,
    private readonly reply: (request: StudentChatRequest, call: number) => string,
    /** The build a local runtime reports, read on every `describe`, so a test can swap it. */
    private readonly digest: () => string = () => 'sha256:fake',
  ) {
    this.label = 'Glimmer';
    this.model = endpoint.model;
    this.baseUrl = endpoint.baseUrl;
    this.isLocal = new URL(endpoint.baseUrl).hostname === '127.0.0.1';
    this.contextLength = endpoint.contextLength;
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
      digest: this.digest(),
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

/**
 * The mentor's model as the agent: a fake student that prices its calls like the mentor, or at
 * `priceScale` times that, so a test can make its calls dearer than the budget left.
 */
export class FakeActor extends FakeStudent implements ActorAdapter {
  priceScale = 1;
  override readonly contextLength = null;

  estimateCostUsd(usage: Usage): number {
    return (this.priceScale * (usage.inputTokens * 1.25 + usage.outputTokens * 4.25)) / 1_000_000;
  }
}
