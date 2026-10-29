import {
  CodedError,
  GuardError,
  JobSchema,
  newId,
  shippedModels,
  slugify,
  type ChatMessage,
  type DraftRecord,
  type DraftTurn,
  type MentorAdapter,
  type MentorCompletionRequest,
  type MentorConfig,
  type Task,
  type TaskSpec,
} from '@architect/shared';
import { MentorGate } from '../mentor/gate';
import type { Clock, JobDrafter, LoopDeps } from '../loop/deps';
import type { JobLibrary } from '../loop/jobs';
import { connectTeacher } from '../loop/setup';
import { isoNow } from '../loop/time';
import { formatUsd } from '../loop/budget';
import { SplitError } from '../splits/split';
import {
  checkReply,
  DRAFT_NOW,
  MAX_QUESTIONS,
  replyJsonSchema,
  type DraftedJob,
  type Question,
} from './envelope';
import { describeAttached, digestOf, readAttachments, totalRows, type Attached } from './files';
import {
  generateTasks,
  MIN_PER_TYPE,
  MIN_TASKS,
  seedFrom,
  splitSizes,
  trainable,
  type Generation,
} from './generate';
import {
  answerMessage,
  DRAFT_MAX_OUTPUT_TOKENS,
  fixMessage,
  openingMessage,
  systemPrompt,
} from './prompts';
import { foldKey } from './values';

/** The most a drafting conversation may cost the teacher, in dollars. */
export const DRAFTING_CAP_USD = 1;

/** A conversation left alone this long is forgotten, and no more than this many are kept. */
const SESSION_IDLE_MS = 60 * 60_000;
const MAX_SESSIONS = 4;

/** The job's budget, as the sample jobs ship it. */
const BUDGET = { maxRounds: 8, maxMentorUsd: 5, maxWallMinutes: 240 } as const;

/** No final test exists while a job is being drafted, so there is nothing a call could leak. */
const NOTHING_SEALED = { scan: () => ({ leaked: false, matchedIds: [] }) };

interface Spend {
  calls: number;
  inputTokens: number;
  outputTokens: number;
  usd: number;
}

interface Session {
  id: string;
  description: string;
  attached: Attached;
  /** The messages both sides have kept: the person's, and the teacher's questions. */
  history: ChatMessage[];
  questions: number;
  spend: Spend;
  gate: MentorGate;
  busy: boolean;
  touched: number;
}

/** What a reply turned into once Architect had made the tasks it asks for. */
interface Built {
  job: DraftedJob;
  source: DraftRecord['source'];
  tasks: Task[];
  generation: Generation | null;
  /** Task types the files support too few requests of, left out. */
  dropped: { label: string; available: number }[];
  seed: number;
}

export interface DraftingOptions {
  jobs: JobLibrary;
  deps: Pick<LoopDeps, 'adapters' | 'secrets' | 'runtime'>;
  clock: Clock;
  /** Dollars one conversation may cost the teacher, at most. */
  capUsd?: number;
}

function sentence(text: string): string {
  return /[.!?]$/.test(text) ? text : `${text}.`;
}

/** Why the files can't make a job that can be trained, or null when they might. */
function tooLittle(attached: Attached): string | null {
  if (attached.tasks !== null) {
    const count = attached.tasks.tasks.length;
    return trainable(count)
      ? null
      : `${attached.tasks.name} has ${count} ${count === 1 ? 'task' : 'tasks'}, and training needs at least ${MIN_TASKS}. Add more tasks to it, or attach the records the tasks are about and Architect will make some.`;
  }
  if (!attached.files.some((file) => file.kind === 'table')) {
    return 'There is nothing to make practice tasks from yet. Attach the records the agent works from as CSV files, or a tasks.jsonl file with example requests and their answers, and describe the job again.';
  }
  const rows = totalRows(attached);
  return rows >= MIN_TASKS
    ? null
    : `Your files hold only ${rows} ${rows === 1 ? 'row' : 'rows'} between them, too few to make ${MIN_TASKS} different tasks to train and test on. Attach more of the records, or a tasks.jsonl file with example requests and their answers, and describe the job again.`;
}

/** Spark's draft was refused, with the reasons, even after it was asked again. */
function unusable(problems: readonly string[]): Error {
  return new Error(
    `The draft couldn't be used: ${problems.slice(0, 3).join(' ')} Try again, or describe the job a little differently.`,
  );
}

/** The model the teacher is, as the record names it. */
function modelOf(teacher: MentorConfig): string {
  return teacher.kind === 'model' ? teacher.model : teacher.label;
}

/**
 * The conversation that drafts a job from a description and the person's own files (decision
 * 058). The teacher reads what the files hold and either asks one question or drafts; Architect
 * makes the tasks and every expected answer itself, then records the job so that saving it and
 * training work exactly as they do for an imported one.
 */
export class JobDrafting implements JobDrafter {
  private readonly sessions = new Map<string, Session>();

  constructor(private readonly options: DraftingOptions) {}

  async start(description: string, files: string[], teacher: MentorConfig): Promise<DraftTurn> {
    if (description.trim() === '') throw new Error('Describe the job first.');
    const attached = await readAttachments(files);
    const stop = tooLittle(attached);
    if (stop !== null) return { sessionId: newId('drf'), message: stop, options: [], ended: true };
    const session = this.open(description, attached);
    return this.run(
      session,
      teacher,
      openingMessage(description, describeAttached(attached)),
      false,
    );
  }

  async reply(sessionId: string, text: string, teacher: MentorConfig): Promise<DraftTurn> {
    const session = this.sessions.get(sessionId);
    if (session === undefined) {
      throw new CodedError(
        'draft_not_found',
        'This conversation is no longer open. Describe the job again to start a new one.',
      );
    }
    const draftNow = foldKey(text) === foldKey(DRAFT_NOW);
    const mustDraft = draftNow || session.questions >= MAX_QUESTIONS;
    return this.run(session, teacher, answerMessage(text, draftNow, mustDraft), mustDraft);
  }

  private open(description: string, attached: Attached): Session {
    const now = this.options.clock.now();
    for (const [id, session] of this.sessions) {
      if (!session.busy && now - session.touched > SESSION_IDLE_MS) this.sessions.delete(id);
    }
    const idle = [...this.sessions.values()]
      .filter((session) => !session.busy)
      .sort((a, b) => a.touched - b.touched);
    while (this.sessions.size >= MAX_SESSIONS && idle.length > 0) {
      this.sessions.delete(idle.shift()?.id ?? '');
    }
    const spend: Spend = { calls: 0, inputTokens: 0, outputTokens: 0, usd: 0 };
    const session: Session = {
      id: newId('drf'),
      description: description.trim(),
      attached,
      history: [],
      questions: 0,
      spend,
      gate: new MentorGate({
        leakDetector: NOTHING_SEALED,
        authorize: (maxUsd) => this.authorize(spend, maxUsd),
        onRefusal: () => undefined,
      }),
      busy: false,
      touched: now,
    };
    this.sessions.set(session.id, session);
    return session;
  }

  /** Lets a call start only when its worst case fits what drafting may still cost. */
  private authorize(spend: Spend, maxUsd: number | null): number {
    const cap = this.options.capUsd ?? DRAFTING_CAP_USD;
    if (maxUsd === null) {
      throw new GuardError(
        'budget',
        "Architect doesn't know what the teacher costs, so it can't keep drafting under its limit. Enter the model's price in Settings, or pick a model with a known price.",
      );
    }
    if (spend.usd + maxUsd > cap + 1e-9) {
      throw new GuardError(
        'budget',
        `Drafting a job may cost the teacher at most ${formatUsd(cap)}. The next step could cost up to ${formatUsd(maxUsd)}${spend.usd > 0 ? `, with ${formatUsd(spend.usd)} already spent` : ''}.`,
      );
    }
    return maxUsd;
  }

  private async run(
    session: Session,
    teacher: MentorConfig,
    message: string,
    mustDraft: boolean,
  ): Promise<DraftTurn> {
    if (session.busy) {
      throw new Error('The teacher is still working on the last message. Wait for its answer.');
    }
    session.busy = true;
    try {
      const mentor = await connectTeacher(this.options.deps, teacher);
      return await this.converse(session, mentor, teacher, message, mustDraft);
    } finally {
      session.busy = false;
      session.touched = this.options.clock.now();
    }
  }

  /**
   * One turn: ask the teacher, hold its reply to the format and the files, and if it drafted,
   * make the tasks. A reply that can't be used goes back once with the reasons; a second one that
   * can't be used ends the turn with them.
   */
  private async converse(
    session: Session,
    mentor: MentorAdapter,
    teacher: MentorConfig,
    message: string,
    mustDraft: boolean,
  ): Promise<DraftTurn> {
    const messages: ChatMessage[] = [...session.history, { role: 'user', content: message }];
    let sent = messages;
    for (let attempt = 1; ; attempt += 1) {
      const final = attempt === 2;
      const reply = await this.exchange(session, mentor, sent, mustDraft);
      const checked = checkReply(reply.json, { mustDraft, attached: session.attached });
      let problems: string[];
      if (!checked.ok) {
        problems = checked.problems;
      } else if (checked.reply.action === 'ask') {
        return this.asked(session, messages, reply.text, checked.reply);
      } else {
        const made = this.build(session, checked.reply.job, final);
        if ('built' in made) return await this.drafted(session, teacher, made.built);
        problems = made.problems;
      }
      if (final) throw unusable(problems);
      sent = [
        ...messages,
        { role: 'assistant', content: reply.text },
        { role: 'user', content: fixMessage(problems) },
      ];
    }
  }

  /** One call to the teacher, counted against what drafting may cost. */
  private async exchange(
    session: Session,
    mentor: MentorAdapter,
    messages: ChatMessage[],
    mustDraft: boolean,
  ): Promise<{ text: string; json: unknown }> {
    const request: MentorCompletionRequest = {
      system: systemPrompt(),
      messages,
      json: { name: 'job_draft', schema: replyJsonSchema(mustDraft) },
      maxOutputTokens: DRAFT_MAX_OUTPUT_TOKENS,
    };
    const { spend } = session;
    const { completion, costUsd } = await session.gate.complete(mentor, request, {
      onSpent: (charge) => {
        spend.calls += 1;
        spend.inputTokens += charge.usage.inputTokens;
        spend.outputTokens += charge.usage.outputTokens;
        spend.usd += charge.costUsd;
      },
    });
    spend.calls += 1;
    spend.inputTokens += completion.usage.inputTokens;
    spend.outputTokens += completion.usage.outputTokens;
    spend.usd += costUsd;
    return { text: completion.text, json: completion.json };
  }

  private asked(
    session: Session,
    messages: ChatMessage[],
    text: string,
    question: Question,
  ): DraftTurn {
    session.history = [...messages, { role: 'assistant', content: text }];
    session.questions += 1;
    return {
      sessionId: session.id,
      message: question.message,
      options: [...question.options, DRAFT_NOW],
    };
  }

  /**
   * Makes the tasks a draft asks for, or says what is wrong with it. Kinds of task that would
   * give one answer or name what the table lacks are problems the teacher is told of. A kind the
   * table supports too few requests of is a problem the first time and is left out the second.
   */
  private build(
    session: Session,
    job: DraftedJob,
    final: boolean,
  ): { built: Built } | { problems: string[] } {
    const { attached } = session;
    if (attached.tasks !== null) {
      return {
        built: {
          job,
          source: 'attached',
          tasks: attached.tasks.tasks,
          generation: null,
          dropped: [],
          seed: seedFrom([...digestOf(attached), 'attached']),
        },
      };
    }
    const inputs = job.types.flatMap((type) =>
      type.spec === undefined
        ? []
        : [{ id: type.id, label: type.label, description: type.description, spec: type.spec }],
    );
    const tables = new Map(
      attached.files.flatMap((file) =>
        file.table === undefined ? [] : ([[file.name, file.table]] as const),
      ),
    );
    const seed = seedFrom([
      ...digestOf(attached),
      ...inputs.map((input) => JSON.stringify([input.id, input.spec])),
    ]);
    const generation = generateTasks(inputs, tables, seed);
    const problems = generation.rejected.flatMap((type) =>
      type.problems.map((problem) => `Task type "${type.id}" (${type.label}): ${problem}`),
    );
    if (!final) {
      for (const type of generation.thin) {
        problems.push(
          `Task type "${type.id}" (${type.label}) supports only ${type.available} different ${type.available === 1 ? 'request' : 'requests'}, and at least ${MIN_PER_TYPE} are needed. Use a column with more different values, or drop this type.`,
        );
      }
    }
    if (problems.length > 0) return { problems };
    return {
      built: {
        job,
        source: 'generated',
        tasks: generation.tasks,
        generation,
        dropped: generation.thin.map((type) => ({ label: type.label, available: type.available })),
        seed,
      },
    };
  }

  /** Records the drafted job, or ends the conversation when the files can't train one. */
  private async drafted(session: Session, teacher: MentorConfig, built: Built): Promise<DraftTurn> {
    const tasks = this.fitToSplits(built);
    if (tasks === null) {
      this.sessions.delete(session.id);
      return {
        sessionId: session.id,
        message:
          built.tasks.length < MIN_TASKS
            ? `Your files support only ${built.tasks.length} different tasks I can check, and training needs at least ${MIN_TASKS}. Attach more of the records, or a tasks.jsonl file with example requests and their answers, and describe the job again.`
            : "I couldn't divide the tasks into practice, check and final-test sets that keep related requests together. Attach more of the records, or a tasks.jsonl file with example requests and their answers, and describe the job again.",
        options: [],
        ended: true,
      };
    }
    const sizes = splitSizes(tasks.length);
    const { job: drafted } = built;
    const kept = new Set(tasks.map((task) => task.type));
    const types = drafted.types.filter((type) => built.source === 'attached' || kept.has(type.id));
    const job = JobSchema.parse({
      format: 1,
      id: slugify(drafted.name),
      name: drafted.name,
      description: drafted.description,
      summary: drafted.summary,
      does: drafted.does,
      doesNot: drafted.doesNot,
      createdAt: isoNow(this.options.clock),
      ...(drafted.businessDate === undefined ? {} : { businessDate: drafted.businessDate }),
      taskTypes: types.map((type) => ({
        id: type.id,
        label: type.label,
        ...(type.description === '' ? {} : { description: type.description }),
      })),
      data: {
        files: session.attached.files.map((file) => {
          const described = drafted.files.find((item) => item.name === file.name);
          return {
            name: file.name,
            kind: file.kind,
            access: described?.access ?? 'read',
            ...(described?.description ? { description: described.description } : {}),
          };
        }),
      },
      permissions: { writes: 'ask', unseenFiles: 'never' },
      checker: { kind: 'builtin' },
      requirements: { passRate: drafted.passRate },
      budget: BUDGET,
      ...shippedModels(),
      startingHarness: { kind: 'blank' },
      splits: { seed: built.seed, ...sizes },
      evaluation: {
        trainBatch: Math.min(12, sizes.train),
        minDevGain: Math.min(2, sizes.dev),
        maxTypeRegression: 1,
        devRepeats: 1,
        patience: 4,
      },
    });

    const notes = [
      ...(built.generation?.types.flatMap((type) => type.notes) ?? []),
      ...built.dropped.map(
        (type) =>
          `Left out "${type.label}": the files support only ${type.available} different ${type.available === 1 ? 'request' : 'requests'} of that kind.`,
      ),
    ];
    const { spend } = session;
    const specs = new Map<string, { rule: string; spec: TaskSpec }>(
      (built.generation?.types ?? []).map((type) => [
        type.id,
        { rule: type.rule, spec: type.spec },
      ]),
    );
    const record: DraftRecord = {
      format: 1,
      source: built.source,
      createdAt: job.createdAt,
      seed: built.seed,
      teacher: { label: teacher.label, model: modelOf(teacher) },
      cost: {
        calls: spend.calls,
        inputTokens: spend.inputTokens,
        outputTokens: spend.outputTokens,
        usd: spend.usd,
      },
      types: types.map((type) => ({ id: type.id, ...(specs.get(type.id) ?? {}) })),
      unresolved: drafted.unresolved,
      notes,
    };
    const created = await this.options.jobs.create({
      job,
      files: session.attached.files.map((file) => ({ name: file.name, content: file.bytes })),
      tasks,
      drafting: record,
    });
    this.sessions.delete(session.id);
    return {
      sessionId: session.id,
      message: this.draftMessage(drafted.unresolved, built.dropped),
      options: [],
      draft: created,
    };
  }

  /**
   * The tasks that can be divided into the job's sets with every family in one set. A job whose
   * tasks can't be divided loses its last tasks, one at a time from its largest kind, until they
   * can; one left with too few to train on is null.
   */
  private fitToSplits(built: Built): Task[] | null {
    const tasks = [...built.tasks];
    for (;;) {
      if (!trainable(tasks.length)) return null;
      try {
        this.options.deps.runtime.splitTasks(tasks, {
          seed: built.seed,
          ...splitSizes(tasks.length),
        });
        return tasks;
      } catch (error) {
        if (!(error instanceof SplitError)) throw error;
        const counts = new Map<string, number>();
        for (const task of tasks) counts.set(task.type, (counts.get(task.type) ?? 0) + 1);
        const largest = [...counts].sort((a, b) => b[1] - a[1])[0]?.[0];
        const at = tasks.findLastIndex((task) => task.type === largest);
        if (at < 0) return null;
        tasks.splice(at, 1);
      }
    }
  }

  private draftMessage(unresolved: readonly string[], dropped: Built['dropped']): string {
    const parts: string[] = [];
    if (unresolved.length > 0) {
      parts.push(
        `${unresolved.length === 1 ? "I couldn't settle this" : "I couldn't settle these"} from your files and answers, so I left ${unresolved.length === 1 ? 'it' : 'them'} open: ${unresolved.map(sentence).join(' ')}`,
      );
    }
    for (const type of dropped) {
      parts.push(
        `I left out "${type.label}", because your files support only ${type.available} different ${type.available === 1 ? 'request' : 'requests'} of that kind.`,
      );
    }
    if (parts.length > 0) parts.push("I've drafted the job for you to review.");
    return parts.join('\n\n');
  }
}
