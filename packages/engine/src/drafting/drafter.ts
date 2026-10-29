import {
  BLANK_ANSWERS,
  CodedError,
  GuardError,
  JobSchema,
  newId,
  shippedModels,
  slugify,
  type BlankAnswer,
  type ChatMessage,
  type DraftRecord,
  type DraftTurn,
  type MentorAdapter,
  type MentorCompletionRequest,
  type MentorConfig,
  type PlaceholderAnswer,
  type RuleDetails,
  type Task,
  type TaskSpec,
} from '@architect/shared';
import { MentorGate } from '../mentor/gate';
import type { Clock, JobDrafter, LoopDeps, TaskSplits } from '../loop/deps';
import type { JobLibrary } from '../loop/jobs';
import { connectTeacher } from '../loop/setup';
import { isoNow } from '../loop/time';
import { formatUsd } from '../loop/budget';
import {
  checkReply,
  DRAFT_NOW,
  MAX_QUESTIONS,
  replyJsonSchema,
  type DraftedJob,
  type Question,
} from './envelope';
import {
  describeAttached,
  digestOf,
  hashesOf,
  readAttachments,
  shownRowsOf,
  textTooLong,
  totalRows,
  type Attached,
} from './files';
import type { RuleCase } from './rule/cases';
import {
  auditSplits,
  divide,
  faultsToPerson,
  faultsToTeacher,
  type Division,
  type Fault,
} from './division';
import { chooseExamples } from './rule/examples';
import type { RuleOutcome } from './rule/outcome';
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
  settledMessage,
  systemPrompt,
} from './prompts';
import { markWords, unaskedLine } from './rule/placeholders';
import type { BlankAsked, MarkAsked, TableBlank, TableMark } from './rule-reply';
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

/**
 * The reply of the teacher that Architect is holding while it asks about marks. Its rule does not
 * change with the answers, which Architect applies itself, so it is checked again with them and
 * the teacher is not called a second time for it.
 */
interface Parked {
  /** What the teacher was sent for this reply. */
  messages: ChatMessage[];
  reply: { text: string; json: unknown };
  mustDraft: boolean;
}

/**
 * An open question about a rule that changes an answer, which waits for the person. One about an
 * empty cell names the column and its table, and is answered with one of the two choices a rule
 * can do.
 */
interface RuleQuestion {
  question: string;
  options: string[];
  blank?: BlankAsked;
}

/**
 * Architect's own question about a mark such as N/A or a dash in a column of the records, with the
 * teacher's reply it is held against. It is answered with the same two choices.
 */
interface MarkQuestion {
  question: string;
  options: string[];
  mark: MarkAsked;
  parked: Parked;
}

type Settling = RuleQuestion | MarkQuestion;

/**
 * Questions about a rule that the teacher raised, which Architect puts to the person in all, after
 * which the draft ends.
 */
export const MAX_RULE_QUESTIONS = 3;

/**
 * Questions Architect asks about marks such as N/A or a dash, in all. They are its own, from the
 * records, so they do not count against the teacher's. Past this it asks no more: a mark it did not
 * ask about leaves its row out, as before, and the draft says so. It never counts as zero.
 */
export const MAX_MARK_QUESTIONS = 6;

/** What a turn says when it is Architect asking, not the teacher. */
const ARCHITECT = { from: 'architect' } as const;

interface Session {
  id: string;
  /** The description exactly as the person wrote it. */
  description: string;
  attached: Attached;
  /** The messages both sides have kept: the person's, and the teacher's questions. */
  history: ChatMessage[];
  questions: number;
  /**
   * What the person answered, exactly as they wrote it, which a rule may rest on. An answer about
   * an empty cell or about a mark says which table and column it was about and what they chose.
   */
  answers: {
    question: string;
    answer: string;
    blank?: TableBlank;
    placeholder?: PlaceholderAnswer;
  }[];
  /** The last question the teacher asked, which the next reply answers. */
  asking: string | null;
  /** A question about a rule that must be answered before any job is drafted, and how many so far. */
  settling: Settling | null;
  ruleQuestions: number;
  /** Questions about marks Architect has put to the person. */
  markQuestions: number;
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
  /** The tasks divided into the job's sets, or null when they can't be. */
  divided: Extract<Division, { kind: 'divided' }> | null;
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

/**
 * Which of the two answers about an empty cell, or about a mark such as N/A, a reply is, or null
 * when it is neither. Only these two words answer: nothing else, "Draft it now" included, is read
 * as a choice, and no answer is ever taken for zero.
 */
function blankMeaning(text: string): BlankAnswer['means'] | null {
  const said = foldKey(text);
  if (said === foldKey(BLANK_ANSWERS.zero)) return 'zero';
  if (said === foldKey(BLANK_ANSWERS.leave_out)) return 'leave_out';
  return null;
}

/**
 * A draft whose sets could be passed by a copy however they were divided. The teacher is told that
 * a copy could pass and which kind of task, and nothing of the sets as they were proposed, which
 * are the final test's before it is sealed. The person, who may know the final test, gets the rest.
 */
function refusal(faults: readonly Fault[]): { problems: string[]; shown: string[] } {
  return { problems: faultsToTeacher(faults), shown: faultsToPerson(faults) };
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
    const stop = textTooLong(attached) ?? tooLittle(attached);
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
    const open = session.settling;
    if (open !== null) {
      // A question about a rule changes the numbers every answer is checked against, so it needs
      // an answer: "Draft it now" doesn't stand in for one.
      if (draftNow) {
        return {
          sessionId: session.id,
          message: `${open.question}\n\nThis changes the numbers the agent is tested on, so it needs an answer before I can draft the job.`,
          options: open.options,
          ...('mark' in open ? ARCHITECT : {}),
        };
      }
      if ('mark' in open) {
        const means = blankMeaning(text);
        if (means === null) {
          return {
            sessionId: session.id,
            message: `${open.question}\n\nChoose one of the answers: it decides what ${markWords(open.mark.mark)} counts as in ${open.mark.column} of ${open.mark.table}, in every row.`,
            options: open.options,
            ...ARCHITECT,
          };
        }
        session.answers.push({
          question: open.question,
          answer: BLANK_ANSWERS[means],
          placeholder: { ...open.mark, means },
        });
        session.settling = null;
        // The teacher's rule is as it was: Architect applies the answer to it, without a call.
        return this.run(session, teacher, '', open.parked.mustDraft, open.parked);
      }
      let answer = text;
      let blank: TableBlank | undefined;
      if (open.blank !== undefined) {
        // Only two things can be done with an empty cell, so only one of the two is an answer.
        const means = blankMeaning(text);
        if (means === null) {
          return {
            sessionId: session.id,
            message: `${open.question}\n\nChoose one of the answers: it decides what an empty ${open.blank.column} in ${open.blank.table} counts as in every row.`,
            options: open.options,
          };
        }
        answer = BLANK_ANSWERS[means];
        blank = { ...open.blank, means };
      }
      session.answers.push({
        question: open.question,
        answer,
        ...(blank === undefined ? {} : { blank }),
      });
      session.settling = null;
      return this.run(session, teacher, settledMessage(open.question, answer, blank), true);
    }
    if (!draftNow && session.asking !== null) {
      session.answers.push({ question: session.asking, answer: text });
    }
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
      description,
      attached,
      history: [],
      questions: 0,
      answers: [],
      asking: null,
      settling: null,
      ruleQuestions: 0,
      markQuestions: 0,
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
    parked: Parked | null = null,
  ): Promise<DraftTurn> {
    if (session.busy) {
      throw new Error('The teacher is still working on the last message. Wait for its answer.');
    }
    session.busy = true;
    try {
      // The teacher is reached when it is first asked something. A reply Architect is holding is
      // checked again without it, so an answer about a mark makes no call.
      let mentor: MentorAdapter | undefined;
      const connect = async (): Promise<MentorAdapter> =>
        (mentor ??= await connectTeacher(this.options.deps, teacher));
      return await this.converse(session, connect, teacher, message, mustDraft, parked);
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
    connect: () => Promise<MentorAdapter>,
    teacher: MentorConfig,
    message: string,
    mustDraft: boolean,
    parked: Parked | null,
  ): Promise<DraftTurn> {
    const messages: ChatMessage[] = parked?.messages ?? [
      ...session.history,
      { role: 'user', content: message },
    ];
    let sent = messages;
    for (let attempt = 1; ; attempt += 1) {
      const final = attempt === 2;
      const reply =
        attempt === 1 && parked !== null
          ? parked.reply
          : await this.exchange(session, await connect(), sent, mustDraft);
      const checked = checkReply(reply.json, {
        mustDraft,
        attached: session.attached,
        said: {
          description: session.description,
          answers: session.answers.map((item) => item.answer).join('\n'),
          blanks: session.answers.flatMap((item) => (item.blank === undefined ? [] : [item.blank])),
          marks: session.answers.flatMap((item): TableMark[] =>
            item.placeholder === undefined
              ? []
              : [{ ...item.placeholder, question: item.question }],
          ),
        },
      });
      // What the teacher is told is wrong, and what the person is told when it stays wrong, which
      // is the same unless the teacher must not know the reason in full.
      let problems: string[];
      let shown: string[];
      if (!checked.ok) {
        problems = checked.problems;
        shown = problems;
      } else if (checked.reply.action === 'ask') {
        return this.asked(session, messages, reply.text, checked.reply);
      } else {
        // A rule that depends on something the policy leaves open is not made: the person is
        // asked, whether or not they chose to draft now. What the teacher raised comes first, then
        // what Architect itself found in the records: a mark that may mean none. Past the number
        // of questions it asks about marks, the rest are not asked, and their rows stay out.
        const blocking = checked.reply.job.types.flatMap((type) => type.ambiguities ?? []);
        const open = blocking.find(
          (item) => item.mark === undefined || session.markQuestions < MAX_MARK_QUESTIONS,
        );
        if (open !== undefined) return this.settle(session, messages, reply, mustDraft, open);
        const made = this.build(session, checked.reply.job, final);
        if ('built' in made) {
          const unasked = blocking.flatMap((item) => (item.mark === undefined ? [] : [item.mark]));
          return await this.drafted(session, teacher, made.built, unasked);
        }
        problems = made.problems;
        shown = made.shown ?? made.problems;
      }
      if (final) throw unusable(shown);
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
    session.asking = question.message;
    return {
      sessionId: session.id,
      message: question.message,
      options: [...question.options, DRAFT_NOW],
    };
  }

  /**
   * Puts to the person a question about a rule that changes what the answers are. It offers no way
   * to draft anyway, and after a few of the teacher's that stay open the conversation ends: a rule
   * that rests on something nobody settled would give a score that means nothing. Architect's own,
   * about a mark such as N/A, holds the teacher's reply until it is answered.
   */
  private settle(
    session: Session,
    messages: ChatMessage[],
    reply: { text: string; json: unknown },
    mustDraft: boolean,
    open: RuleQuestion & { mark?: MarkAsked },
  ): DraftTurn {
    session.history = [...messages, { role: 'assistant', content: reply.text }];
    if (open.mark !== undefined) {
      // Architect's own question about a mark. The teacher's rule waits for the answer.
      session.markQuestions += 1;
      session.settling = {
        question: open.question,
        options: open.options,
        mark: open.mark,
        parked: { messages, reply, mustDraft },
      };
      session.asking = null;
      return {
        sessionId: session.id,
        message: open.question,
        options: open.options,
        ...ARCHITECT,
      };
    }
    if (session.ruleQuestions >= MAX_RULE_QUESTIONS) {
      this.sessions.delete(session.id);
      return {
        sessionId: session.id,
        message: `I still can't settle this from your policy: ${open.question} A rule that depends on it would be tested against numbers nobody confirmed, so I haven't drafted one. Say it in your policy or in your description, then describe the job again.`,
        options: [],
        ended: true,
      };
    }
    session.ruleQuestions += 1;
    session.settling = open;
    session.asking = null;
    return { sessionId: session.id, message: open.question, options: open.options };
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
  ): { built: Built } | { problems: string[]; shown?: string[] } {
    const { attached } = session;
    if (attached.tasks !== null) {
      const seed = seedFrom([...digestOf(attached), 'attached']);
      const division = this.divideTasks(attached.tasks.tasks, seed, null, job.passRate);
      if (division.kind === 'unsafe') return refusal(division.faults);
      return {
        built: {
          job,
          source: 'attached',
          tasks: attached.tasks.tasks,
          generation: null,
          dropped: [],
          seed,
          divided: division.kind === 'divided' ? division : null,
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
    const generation = generateTasks(inputs, tables, seed, {
      shown: shownRowsOf(attached),
      passRate: job.passRate,
    });
    // What the teacher is told of each kind of task names columns and counts and says no value of
    // a row it was not shown; what the person is told of it, when it stays wrong, says them.
    const named = (type: { id: string; label: string }, text: string): string =>
      `Task type "${type.id}" (${type.label}): ${text}`;
    const problems = generation.rejected.flatMap((type) =>
      type.problems.map((problem) => named(type, problem)),
    );
    const shown = generation.rejected.flatMap((type) =>
      type.problems.map((problem) => named(type, type.inFull.get(problem) ?? problem)),
    );
    if (!final) {
      for (const type of generation.thin) {
        const thin = `Task type "${type.id}" (${type.label}) supports only ${type.available} different ${type.available === 1 ? 'request' : 'requests'}, and at least ${MIN_PER_TYPE} are needed. Use a column with more different values, or drop this type.`;
        problems.push(thin);
        shown.push(thin);
      }
    }
    if (problems.length > 0) return { problems, shown };
    // The sets as they are divided are held to the guard a rule is held to over all its cases, so
    // that what a copy could pass is known before the final test is sealed.
    const division = this.divideTasks(generation.tasks, seed, generation, job.passRate);
    if (division.kind === 'unsafe') return refusal(division.faults);
    return {
      built: {
        job,
        source: 'generated',
        tasks: generation.tasks,
        generation,
        dropped: generation.thin.map((type) => ({ label: type.label, available: type.available })),
        seed,
        divided: division.kind === 'divided' ? division : null,
      },
    };
  }

  /** The tasks divided into the job's sets, each of them safe from a copy, or what stops that. */
  private divideTasks(
    tasks: readonly Task[],
    seed: number,
    generation: Generation | null,
    passRate: number,
  ): Division {
    const { runtime } = this.options.deps;
    return divide(
      tasks,
      seed,
      (list, config) => runtime.splitTasks(list, config),
      (splits) => (generation === null ? [] : auditSplits(generation.types, splits, passRate)),
    );
  }

  /**
   * Records the drafted job, or ends the conversation when the files can't train one. `unasked`
   * are the marks it did not ask about, whose rows are left out and which the person is told of.
   */
  private async drafted(
    session: Session,
    teacher: MentorConfig,
    built: Built,
    unasked: readonly MarkAsked[],
  ): Promise<DraftTurn> {
    const fitted = built.divided;
    if (fitted === null) {
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
    const { tasks, splits } = fitted;
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
      // The seed that divided the tasks safely, which is the one the job divides them with again.
      splits: { seed: fitted.seed, ...sizes },
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
    const unresolved = [...drafted.unresolved, ...unasked.map(unaskedLine)];
    const specs = new Map<string, { rule: string; spec: TaskSpec; details?: RuleDetails }>(
      (built.generation?.types ?? []).map((type) => [
        type.id,
        {
          rule: type.rule,
          spec: type.spec,
          ...(type.outcome === undefined
            ? {}
            : { details: this.detailsOf(type.id, type.outcome, splits) }),
        },
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
      unresolved,
      notes,
      ...(session.answers.length > 0 ? { answers: session.answers } : {}),
      files: hashesOf(session.attached),
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
      message: this.draftMessage(unresolved, built.dropped),
      options: [],
      draft: created,
    };
  }

  /**
   * What a rule came to, with the examples a person confirms it by. They are chosen from the
   * practice and starting tasks of the job's own split, never the check tasks or the final test.
   */
  private detailsOf(id: string, outcome: RuleOutcome, splits: TaskSplits): RuleDetails {
    const visible = [...splits.train, ...splits.calibration].filter((task) => task.type === id);
    const byKey = new Map(outcome.cases.map((item) => [item.key, item]));
    const taskOf = new Map<string, string>();
    const cases: RuleCase[] = [];
    for (const task of visible) {
      const key = task.meta?.['key'];
      const found = typeof key === 'string' ? byKey.get(key) : undefined;
      if (found === undefined || typeof key !== 'string') continue;
      taskOf.set(key, task.id);
      cases.push(found);
    }
    return { ...outcome.details, ...chooseExamples(outcome, cases, taskOf) };
  }

  private draftMessage(unresolved: readonly string[], dropped: Built['dropped']): string {
    const parts: string[] = [];
    if (unresolved.length > 0) {
      const one = unresolved.length === 1;
      parts.push(
        [
          `I couldn't settle ${one ? 'this' : 'these'} from your files and answers, so I left ${one ? 'it' : 'them'} open:`,
          ...unresolved.map(sentence),
        ].join('\n'),
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
