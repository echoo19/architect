import { join } from 'node:path';
import {
  CorrectionKindSchema,
  GuardError,
  IMPROVE_MAX_MENTOR_USD,
  IMPROVE_MAX_ROUNDS,
  INSTRUCTION_KINDS,
  mayIntervene,
  newId,
  TEACHABLE_KINDS,
  type Correction,
  type CorrectionProposal,
  type CorrectionRequest,
  type Harness,
  type Job,
  type JsonSchemaObject,
  type MentorCompletionRequest,
  type TeachingOverview,
} from '@architect/shared';
import { z } from 'zod';
import type { AdapterFile, VersionFacts } from '../graduates/build';
import type { KeyedLock } from '../graduates/library';
import { nextVersion, registerVersion, writeVersionFolder } from '../graduates/versions';
import { formatUsd } from '../loop/budget';
import type { Clock, EngineHostDeps } from '../loop/deps';
import { must } from '../loop/errors';
import type { JobLibrary } from '../loop/jobs';
import type { DataPaths } from '../loop/paths';
import { connectMentor } from '../loop/setup';
import { isoNow } from '../loop/time';
import { MentorGate } from '../mentor/gate';
import type { EngineStore } from '../store/engine-store';
import type { GraduateRecord, StoredVersion } from '../store/records';
import { exchangeIn, exchangeParts } from './exchange';

/** The most the mentor's reading of one correction may cost, shown beside the consent. */
export const CORRECTION_CAP_USD = 0.25;
const CORRECTION_MAX_OUTPUT_TOKENS = 1_500;

/** Where a lesson's standing instructions go in `AGENTS.md`. */
export const LESSONS_HEADING = "## From the person's corrections";

/**
 * The reply format: every key required, as constrained decoding wants, with the fields a kind
 * doesn't use left empty.
 */
const PROPOSAL_JSON_SCHEMA: JsonSchemaObject = {
  type: 'object',
  additionalProperties: false,
  required: ['kind', 'lesson', 'reason', 'instruction', 'question', 'taskType'],
  properties: {
    kind: { type: 'string', enum: CorrectionKindSchema.options },
    lesson: { type: 'string', description: 'The lesson in a sentence or two.' },
    reason: { type: 'string', description: 'Why you read the correction this way.' },
    instruction: {
      type: 'string',
      description: 'For procedure or source: the standing instruction to add. Otherwise empty.',
    },
    question: {
      type: 'string',
      description: 'For ambiguous: what the person could say to settle it. Otherwise empty.',
    },
    taskType: {
      type: 'string',
      description: "The job's task type the request belongs to, or empty when none fits.",
    },
  },
};

/**
 * The reply format for a job that may not ask the person questions: no `ambiguous` kind to
 * choose, and nothing to put in its question (decision 063).
 */
const PROPOSAL_JSON_SCHEMA_WITHOUT_QUESTIONS: JsonSchemaObject = {
  ...PROPOSAL_JSON_SCHEMA,
  properties: {
    ...(PROPOSAL_JSON_SCHEMA.properties as Record<string, unknown>),
    kind: {
      type: 'string',
      enum: CorrectionKindSchema.options.filter((kind) => kind !== 'ambiguous'),
    },
    question: {
      type: 'string',
      description: 'Always empty: the person asked not to be asked questions.',
    },
  },
};

const emptyAsAbsent = z
  .string()
  .transform((text) => text.trim())
  .transform((text) => (text === '' ? undefined : text));

const ProposalReplySchema = z.object({
  kind: CorrectionKindSchema,
  lesson: z.string().trim().min(1).max(1000),
  reason: z.string().trim().min(1).max(1000),
  instruction: emptyAsAbsent.pipe(z.string().max(2000).optional()),
  question: emptyAsAbsent.pipe(z.string().max(1000).optional()),
  taskType: emptyAsAbsent,
});

const CLASSIFY_SYSTEM = `You help a person correct a small local agent that does one job. They used the agent, it replied, and they say the reply was wrong. Read the exchange and their correction, and propose one lesson.

Classify the correction as exactly one kind:
- procedure: an explicit preference or procedure the agent should follow from now on. Write it as one standing instruction, general enough for other requests of the same kind, never an answer to this one request.
- source: a missing fact or source, such as which file or column holds the right information. Write the instruction that names it.
- weakness: the agent already had what it needed and still went wrong, such as choosing the wrong join despite clear instructions. It needs practice, not a new rule.
- ambiguous: the request could fairly mean more than one thing. Say what the person could add to settle it.
- invalid: the correction can't be checked against the exchange, or the exchange contradicts it.

Not every correction needs training. Only weakness asks for practice. Answer with one JSON object.`;

/** What the classification is told instead of the `ambiguous` kind, when the job asks no questions. */
const CLASSIFY_SYSTEM_WITHOUT_QUESTIONS = CLASSIFY_SYSTEM.replace(
  'Classify the correction as exactly one kind:',
  'The person asked not to be asked questions, so there is no kind for a request that could mean more than one thing, and you never ask what they meant. Take the reading their correction settles, or call the correction invalid when it settles none. Classify the correction as exactly one kind:',
).replace(/^- ambiguous: .*\n/m, '');

function classifyRequest(job: Job, parts: readonly { text: string }[]): MentorCompletionRequest {
  const types = job.taskTypes.map((type) => `- ${type.id}: ${type.label}`).join('\n');
  const asks = mayIntervene(job, 'clarification');
  return {
    system: asks ? CLASSIFY_SYSTEM : CLASSIFY_SYSTEM_WITHOUT_QUESTIONS,
    messages: [
      {
        role: 'user',
        content: `# The job\n${job.name}: ${job.description}\n\nTask types:\n${types}\n\n${parts.map((part) => part.text).join('\n\n')}`,
      },
    ],
    json: {
      name: 'correction',
      schema: asks ? PROPOSAL_JSON_SCHEMA : PROPOSAL_JSON_SCHEMA_WITHOUT_QUESTIONS,
    },
    maxOutputTokens: CORRECTION_MAX_OUTPUT_TOKENS,
  };
}

/**
 * The proposal as stored: instructions only where a kind uses one, a task type only if known.
 * A job that asks the person no questions never stores one: a reading of the request as unclear
 * that comes anyway is kept as a correction that can't be checked, with no question put to them.
 */
function proposalOf(reply: z.infer<typeof ProposalReplySchema>, job: Job): CorrectionProposal {
  const asks = mayIntervene(job, 'clarification');
  const kind = !asks && reply.kind === 'ambiguous' ? 'invalid' : reply.kind;
  const instruction = INSTRUCTION_KINDS.includes(kind) ? reply.instruction : undefined;
  if (INSTRUCTION_KINDS.includes(kind) && instruction === undefined) {
    throw new Error(`The mentor read this as a ${kind} lesson but wrote no instruction.`);
  }
  const question = kind === 'ambiguous' ? reply.question : undefined;
  const known = job.taskTypes.some((type) => type.id === reply.taskType);
  return {
    kind,
    lesson: reply.lesson,
    reason: reply.reason,
    ...(instruction === undefined ? {} : { instruction }),
    ...(question === undefined ? {} : { question }),
    ...(known && reply.taskType !== undefined ? { taskType: reply.taskType } : {}),
  };
}

/**
 * Whether an improvement of this job could train weights here, by the conditions the
 * intervention menu checks before a round (`menuOf`): the job lets the mentor train them, a
 * training worker and a backend that trains for real, a runtime that serves adapters, a mentor
 * that can act as the agent to make the verified lessons, and, for a backend that charges, a
 * compute budget and the job's leave to send lessons for remote training.
 */
async function trainingApplies(job: Job, deps: EngineHostDeps): Promise<boolean> {
  if (!mayIntervene(job, 'weights')) return false;
  const { training, adapters } = deps;
  if (!training || !adapters.createAdapterStudent || !adapters.createActor) return false;
  if (job.mentor.kind !== 'model' || adapters.canAct?.(job.mentor) === false) return false;
  const backend = await training.backend();
  if (backend === null) return false;
  if (!backend.real) return training.offersStandIn === true;
  return (job.budget.maxComputeUsd ?? 0) > 0 && job.sharing?.remoteTraining === true;
}

/** `AGENTS.md` with one more standing instruction under the lessons heading. */
export function withInstruction(system: string, instruction: string): string {
  const line = `- ${instruction.replace(/\s+/g, ' ').trim()}`;
  if (system.includes(LESSONS_HEADING)) return `${system.trimEnd()}\n${line}\n`;
  return `${system.trimEnd()}\n\n${LESSONS_HEADING}\n${line}\n`;
}

export interface TeachThisContext {
  store: EngineStore;
  paths: DataPaths;
  jobs: JobLibrary;
  deps: EngineHostDeps;
  clock: Clock;
  /** The graduate library's lock: one writer at a time for an agent's versions. */
  libraryLock: KeyedLock;
}

/**
 * Teach this (spec section 8). A person corrects one workspace reply; once they agree, the
 * mentor reads that exchange and what they wrote, and proposes a lesson; they queue it or
 * discard it. Nothing changes the active version: an instruction lesson can become a candidate
 * version at once, and queued lessons go to Improve agent.
 */
export class TeachThis {
  constructor(private readonly ctx: TeachThisContext) {}

  private now(): string {
    return isoNow(this.ctx.clock);
  }

  private agent(graduateId: string): GraduateRecord {
    return must(
      this.ctx.store.graduates.get(graduateId),
      `There is no graduate "${graduateId}" in Architect.`,
    );
  }

  /** The job an agent was made from on this computer; one imported from elsewhere has none. */
  async jobOf(agent: GraduateRecord): Promise<Job> {
    const origin = agent.runId === null ? null : this.ctx.store.runs.get(agent.runId);
    if (!origin) {
      throw new Error(
        `${agent.name} came from a package, so this computer has no job to teach it with. Teach this works on agents made here.`,
      );
    }
    return this.ctx.jobs.get(origin.run.jobId);
  }

  /**
   * What Teach this and the Teaching tab show before anything is offered: whether the agent can
   * be taught here and why not, who reads a flagged answer at what cap, and the budget Improve
   * agent keeps to, which is its job's. `studentBusy` says whether a run started now would wait.
   */
  async overview(graduateId: string, studentBusy: boolean): Promise<TeachingOverview> {
    const agent = this.agent(graduateId);
    const base = { graduateId, correctionCapUsd: CORRECTION_CAP_USD };
    if (agent.runId === null || !this.ctx.store.runs.get(agent.runId)) {
      return {
        ...base,
        sharesCorrections: false,
        unavailable: {
          reason: 'imported',
          message: `${agent.name} was made on another computer. It can be taught there, where its practice and check tasks are.`,
        },
      };
    }
    const job = await this.jobOf(agent);
    const sharesCorrections = job.sharing?.corrections === true;
    if (job.mentor.kind !== 'model') {
      return {
        ...base,
        sharesCorrections,
        mentor: job.mentor.label,
        unavailable: {
          reason: 'mentor',
          message: `${job.mentor.label} can't read a flagged answer in this build.`,
        },
      };
    }
    const training = await trainingApplies(job, this.ctx.deps);
    const { maxComputeUsd, maxWallMinutes } = job.budget;
    // The job's caps, within what one improvement may be given (`ImproveOptionsSchema`).
    const budget = {
      maxRounds: Math.min(job.budget.maxRounds, IMPROVE_MAX_ROUNDS),
      maxMentorUsd: Math.min(job.budget.maxMentorUsd, IMPROVE_MAX_MENTOR_USD),
      maxWallMinutes,
      ...(training && maxComputeUsd ? { maxComputeUsd } : {}),
    };
    return {
      ...base,
      sharesCorrections,
      mentor: job.mentor.label,
      ...(agent.activeVersion === null || budget.maxMentorUsd <= 0
        ? {}
        : { improve: { fromVersion: agent.activeVersion, budget, training, waits: studentBusy } }),
    };
  }

  /**
   * Lets the agent's job send flagged answers to the mentor, each one still only once the
   * person agrees to it, or keeps them on this computer again. Sharing isn't part of the job's
   * contract, so no new contract version comes of it, and a run already going keeps its copy.
   */
  async shareCorrections(graduateId: string, allowed: boolean): Promise<void> {
    const job = await this.jobOf(this.agent(graduateId));
    if ((job.sharing?.corrections === true) === allowed) return;
    await this.ctx.jobs.save({
      ...job,
      sharing: { remoteTraining: job.sharing?.remoteTraining === true, corrections: allowed },
    });
  }

  correction(id: string): Correction {
    return must(this.ctx.store.corrections.get(id), `There is no correction "${id}".`);
  }

  list(graduateId: string): Correction[] {
    this.agent(graduateId);
    return this.ctx.store.corrections.list(graduateId);
  }

  /**
   * The mentor reads one reply's exchange and the person's correction, and proposes a lesson.
   * It needs the job's permission to share corrections and the person's consent to this one;
   * every request passes the leak check against the locked test, under a cap of
   * `CORRECTION_CAP_USD`. Nothing is queued yet.
   */
  async propose(
    chatId: string,
    messageId: string,
    request: CorrectionRequest,
  ): Promise<Correction> {
    const { store, deps } = this.ctx;
    const chat = must(store.chats.get(chatId), `There is no chat "${chatId}".`);
    const agent = this.agent(chat.graduateId);
    const job = await this.jobOf(agent);
    if (job.sharing?.corrections !== true) {
      throw new GuardError(
        'permission',
        `${job.name} keeps corrections on this computer. Allow sharing corrections with the mentor in the job's data settings to use Teach this.`,
      );
    }
    if (!request.consent) {
      throw new GuardError(
        'permission',
        'Nothing was sent: the mentor reads this exchange only once you agree to share it.',
      );
    }
    if (job.mentor.kind !== 'model') {
      throw new Error(`${job.mentor.label} can't read a correction in this build.`);
    }
    const exchange = exchangeIn(store.messages.list(chatId), messageId);
    const version = exchange.reply.graduateVersion ?? chat.graduateVersion;
    if (version === undefined) throw new Error("That reply doesn't say which version wrote it.");
    const parts = exchangeParts(exchange, request);
    const gate = new MentorGate({
      leakDetector: await deps.vault.leakDetector(job.id),
      authorize: (maxUsd) => {
        if (maxUsd === null) {
          throw new GuardError(
            'budget',
            "The mentor's price isn't known, so the cap on reading a correction can't be kept.",
          );
        }
        if (maxUsd > CORRECTION_CAP_USD) {
          throw new GuardError(
            'budget',
            `Reading this exchange could cost up to ${formatUsd(maxUsd)}, more than the ${formatUsd(CORRECTION_CAP_USD)} a correction may. Shorten what you wrote, or correct a shorter reply.`,
          );
        }
        return maxUsd;
      },
      onRefusal: () => {},
    });
    const mentor = await connectMentor(deps, job);
    const sharedAt = this.now();
    const { completion, costUsd } = await gate.complete(mentor, classifyRequest(job, parts), {
      parts,
    });
    const reply = ProposalReplySchema.safeParse(completion.json);
    if (!reply.success) throw new Error("The mentor's reading of the correction wasn't usable.");
    const at = this.now();
    const correction: Correction = {
      id: newId('cor'),
      graduateId: agent.id,
      version,
      chatId,
      messageId,
      wrong: request.wrong,
      ...(request.wanted === undefined ? {} : { wanted: request.wanted }),
      ...(request.evidence === undefined ? {} : { evidence: request.evidence }),
      proposal: proposalOf(reply.data, job),
      status: 'proposed',
      mentorModel: completion.model,
      costUsd,
      sharedAt,
      createdAt: at,
      updatedAt: at,
    };
    store.corrections.put(correction);
    return correction;
  }

  /** Adds a proposed lesson to the agent's teaching queue. */
  queue(id: string): Correction {
    return this.ctx.store.transaction(() => {
      const correction = this.correction(id);
      if (correction.status === 'queued') return correction;
      if (correction.status !== 'proposed') {
        throw new Error(`This lesson is ${correction.status}, so it can't be queued.`);
      }
      const { kind, question } = correction.proposal;
      if (!TEACHABLE_KINDS.includes(kind)) {
        throw new Error(
          kind === 'ambiguous'
            ? `The request was ambiguous, so there is nothing to teach yet${question === undefined ? '' : `: ${question}`} Say what you meant and propose it again.`
            : "The mentor couldn't check this correction against the exchange, so it can't be taught.",
        );
      }
      return this.put({ ...correction, status: 'queued' });
    });
  }

  discard(id: string): Correction {
    return this.ctx.store.transaction(() => {
      const correction = this.correction(id);
      if (correction.status === 'discarded') return correction;
      if (correction.status !== 'proposed' && correction.status !== 'queued') {
        throw new Error(`This lesson is ${correction.status}, so it stays as it is.`);
      }
      if (correction.runId !== undefined && this.improving(correction.runId)) {
        throw new Error('An improvement is using this lesson. Stop it first.');
      }
      const { runId: _taken, ...rest } = correction;
      return this.put({ ...rest, status: 'discarded' });
    });
  }

  /**
   * Makes a candidate version from a procedure or source lesson: the active version with the
   * lesson's instruction added to its standing instructions, and nothing else changed. The
   * version says no locked test measured it; the active version stays until the person
   * accepts and promotes the candidate.
   */
  async apply(id: string): Promise<Correction> {
    const graduateId = this.correction(id).graduateId;
    return this.ctx.libraryLock.run(graduateId, () => this.applyNow(id));
  }

  private async applyNow(id: string): Promise<Correction> {
    const { store, paths, deps } = this.ctx;
    const correction = this.correction(id);
    if (correction.status !== 'proposed' && correction.status !== 'queued') {
      throw new Error(`This lesson is ${correction.status}, so it can't be applied again.`);
    }
    const { instruction, kind } = correction.proposal;
    if (instruction === undefined || !INSTRUCTION_KINDS.includes(kind)) {
      throw new Error(
        'Only a procedure or a source lesson can take effect as an instruction. Queue this one for Improve agent.',
      );
    }
    if (correction.runId !== undefined && this.improving(correction.runId)) {
      throw new Error('An improvement is using this lesson. Wait for it, or stop it first.');
    }
    const agent = this.agent(correction.graduateId);
    const active = must(
      agent.activeVersion === null ? null : store.versions.get(agent.id, agent.activeVersion),
      `${agent.name} has no active version.`,
    );
    const installation = must(
      store.installations.get(agent.id),
      `${agent.name} isn't installed on this computer.`,
    );
    const dir = paths.fromStored(active.path);
    const parent = await deps.harness.readPackaged(dir, active.manifest);
    const harness = deps.harness.applyEdits(parent, [
      { op: 'write', path: 'AGENTS.md', content: withInstruction(parent.system, instruction) },
    ]);
    const version = nextVersion(store, agent.id);
    const at = this.now();
    const facts = childFacts(
      agent,
      active,
      dir,
      version,
      {
        ...harness,
        meta: { ...harness.meta, version: parent.meta.version + 1, parent: parent.meta.version },
      },
      deps.harness.harnessToFiles,
      at,
    );
    const written = await writeVersionFolder(store, paths, facts);
    return store.transaction(() => {
      registerVersion(store, paths, {
        graduateId: agent.id,
        name: agent.name,
        version,
        written,
        parent: active.version,
        state: 'candidate',
        installation,
        at,
      });
      const { runId: _taken, ...rest } = this.correction(id);
      return this.put({ ...rest, status: 'applied', candidateVersion: version });
    });
  }

  /** Whether a run is still improving its agent. */
  private improving(runId: string): boolean {
    const run = this.ctx.store.runs.get(runId)?.run;
    return run !== undefined && !['finished', 'stopped', 'failed'].includes(run.status);
  }

  private put(correction: Correction): Correction {
    const updated = { ...correction, updatedAt: this.now() };
    this.ctx.store.corrections.put(updated);
    return updated;
  }
}

/**
 * The facts of a version made from another without a run: its harness changed, everything else
 * as the parent had it, the adapter included. No locked test measured it, so its evidence says
 * unevaluated, and its contract is the parent's.
 */
export function childFacts(
  agent: GraduateRecord,
  parent: StoredVersion,
  parentDir: string,
  version: number,
  harness: Harness,
  harnessToFiles: (harness: Harness) => Record<string, string>,
  at: string,
): VersionFacts {
  const { manifest } = parent;
  const adapter = manifest.model.adapter;
  const columns: Record<string, string[]> = {};
  for (const resource of manifest.resources) {
    for (const file of resource.files) {
      if (file.columns !== undefined) columns[file.name] = file.columns;
    }
  }
  const adapterFile: AdapterFile | undefined =
    adapter === undefined ? undefined : { ...adapter, source: join(parentDir, adapter.path) };
  return {
    agentId: agent.id,
    name: agent.name,
    version,
    parent: { agentId: agent.id, version: parent.version, digest: parent.digest },
    createdAt: at,
    method: manifest.identity.method,
    contract: manifest.contract,
    modelLabel: manifest.model.label,
    base: manifest.model.base,
    contextLength: manifest.model.inference.contextLength,
    runtime: must(manifest.model.runtime.compatible[0], 'The runtime it was made on'),
    ...(adapterFile === undefined ? {} : { adapter: adapterFile }),
    harness: { meta: harness.meta, files: harnessToFiles(harness) },
    report: null,
    lineage: [],
    columns,
    rounds: 0,
    keptChanges: 0,
    testMachine: null,
  };
}
