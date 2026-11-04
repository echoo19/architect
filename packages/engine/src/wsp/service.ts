import { createHash, randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, rmSync, copyFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  CodedError,
  GuardError,
  WSP_CANDIDATE_FORMAT,
  WSP_EXPERIMENT_FORMAT,
  WSP_MIN_EXAMPLES,
  WSP_ZERO_COSTS,
  WspBriefSchema,
  WspCandidateSchema,
  WspDraftInputSchema,
  type WspArm,
  type WspBrief,
  type WspCandidate,
  type WspComputeTarget,
  type WspDecoding,
  type WspDraftInput,
  type WspEvent,
  type WspExample,
  type WspExperiment,
  type WspExport,
  type WspIteration,
  type WspMeasurement,
  type WspMentorStatus,
  type WspModel,
  type WspSplit,
  type WspWorkerStatus,
} from '@architect/shared';
import { z } from 'zod';
import { writeFileAtomic } from '../data/atomic-write';
import { releaseMentor, type MentorReleased } from '../vault/gate';
import type { Vault } from '../vault/vault';
import { checkProblem, measure, type WspOutput } from './metrics';
import { requestText, briefRequest, stepRequest, inventory, type WspMentorClient } from './mentor';
import {
  baseChanges,
  cachedModels,
  checkpointTensors,
  inspectModelFolder,
  pinBase,
  sha256File,
} from './models';
import { wspResult } from './result';
import { splitExamples, WspStore } from './store';
import {
  EvaluatorProcess,
  runKernel,
  setupWorker,
  totalMemoryGb,
  workerInfo,
  workerStatus,
  workerThreads,
  type WspWorkerPaths,
} from './worker';

const GB = 1024 ** 3;
const OutputsSchema = z.array(
  z.object({ text: z.string(), tokens: z.number(), cutOff: z.boolean() }),
);
const ComposeSchema = z.object({
  edits: z.array(
    z.object({
      tensor: z.string(),
      shape: z.array(z.number()),
      dtype: z.string(),
      sha256: z.string(),
      changed: z.number(),
      total: z.number(),
      relativeChange: z.number(),
    }),
  ),
  sha256: z.string(),
  parameters: z.number(),
});
const ReadSchema = z.object({ file: z.string(), sha256: z.string() });
const MaterializeSchema = z.object({
  files: z.array(z.object({ name: z.string(), bytes: z.number(), sha256: z.string() })),
});

export interface WspServiceOptions {
  /** `<data>/wsp`. */
  dir: string;
  /** The worker's source, `trainer/wsp`. */
  sourceDir: string;
  vault: Vault;
  /** Astra, or the scripted stand-in when the app is started with it. */
  connectMentor: (reasoningEffort: 'low' | 'medium' | 'high') => Promise<WspMentorClient>;
  mentorStatus: () => Promise<WspMentorStatus>;
  /** Where the Hugging Face cache is; the Hub's own default when absent. */
  hubCache?: string;
  /** The worker's Python environment; `<dir>/python` when absent. */
  envDir?: string;
  /** The evaluator and kernel processes; the real ones when absent. Tests pass stand-ins. */
  processes?: WspProcesses;
  now?: () => Date;
  onError?: (error: unknown) => void;
}

/** What the runner asks of the evaluator: one request at a time, then close. */
export interface WspEvaluator {
  info: { python?: string | undefined } | null;
  start(): Promise<void>;
  request<T>(op: string, payload: Record<string, unknown>, schema: z.ZodType<T>): Promise<T>;
  close(): void;
}

export interface WspProcesses {
  evaluator(
    paths: WspWorkerPaths,
    base: string,
    session: string,
    memoryBytes: number,
  ): WspEvaluator;
  kernel: typeof runKernel;
  /** Whether the worker's environment is ready. */
  status: typeof workerStatus;
}

const REAL_PROCESSES: WspProcesses = {
  evaluator: (paths, base, session, memoryBytes) =>
    new EvaluatorProcess(paths, base, session, memoryBytes),
  kernel: runKernel,
  status: workerStatus,
};

interface Active {
  abort: AbortController;
  evaluator: WspEvaluator | null;
}

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    return `{${Object.keys(value as object)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonical((value as Record<string, unknown>)[key])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

function sha256(text: string): string {
  return createHash('sha256').update(text).digest('hex');
}

const UNSUPPORTED: Omit<WspComputeTarget, 'status'>[] = [
  {
    id: 'hf-jobs',
    label: 'Hugging Face Jobs',
    reason:
      "A job runs as one batch, and a WSP experiment's kernel and evaluator answer the runner turn by turn, so it can't run there yet.",
  },
  {
    id: 'slurm',
    label: 'Slurm',
    reason:
      'Architect writes cluster bundles and never submits them, and a WSP experiment needs its worker to answer the runner while it runs.',
  },
  {
    id: 'kubernetes',
    label: 'Kubernetes',
    reason:
      'Architect writes cluster bundles and never submits them, and a WSP experiment needs its worker to answer the runner while it runs.',
  },
  {
    id: 'skypilot',
    label: 'SkyPilot',
    reason:
      'Architect writes cluster bundles and never submits them, and a WSP experiment needs its worker to answer the runner while it runs.',
  },
];

/**
 * Architect WSP's experiments (decision 109): drafting a brief with the mentor, the run (a
 * baseline, programs, candidates measured on dev), freezing, the sealed qualification and the
 * export. One experiment runs at a time; each keeps its records in its own folder.
 */
export class WspService {
  private readonly store: WspStore;
  private readonly paths: WspWorkerPaths;
  private readonly listeners = new Set<(event: WspEvent) => void>();
  private readonly active = new Map<string, Active>();
  private readonly released = new Map<string, MentorReleased>();
  private settingUp: Promise<WspWorkerStatus> | null = null;
  private readonly now: () => Date;
  private readonly onError: (error: unknown) => void;

  constructor(private readonly options: WspServiceOptions) {
    this.store = new WspStore(options.dir);
    this.paths = { sourceDir: options.sourceDir, envDir: options.envDir ?? this.store.envDir };
    this.now = options.now ?? (() => new Date());
    this.onError = options.onError ?? ((error) => console.error(error));
    this.processes = options.processes ?? REAL_PROCESSES;
  }

  private readonly processes: WspProcesses;

  /** At start: whatever was working when the app closed stops where it was, to resume. */
  recover(): void {
    for (const experiment of this.store.list()) {
      if (experiment.status === 'running' || experiment.status === 'cancelling') {
        this.save({
          ...experiment,
          status: experiment.status === 'cancelling' ? 'cancelled' : 'interrupted',
          activity:
            experiment.status === 'cancelling' ? 'Cancelled' : 'Stopped when Architect closed',
          iterations: experiment.iterations.filter((item) => item.endedAt !== undefined),
        });
      } else if (experiment.status === 'briefing') {
        this.save({
          ...experiment,
          status: 'brief',
          activity: '',
          error: 'Drafting stopped when Architect closed.',
        });
      } else if (experiment.status === 'qualifying') {
        this.save({
          ...experiment,
          status: 'evaluated',
          activity: '',
          measurements: experiment.measurements.filter((item) => item.split !== 'qualification'),
        });
      }
    }
  }

  onEvent(listener: (event: WspEvent) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private save(experiment: WspExperiment): WspExperiment {
    const saved = this.store.save(experiment);
    for (const listener of this.listeners) listener({ experimentId: saved.id });
    return saved;
  }

  /* Models, compute, worker, mentor */

  models(): WspModel[] {
    return cachedModels(this.options.hubCache, totalMemoryGb());
  }

  inspectModel(folder: string): WspModel {
    if (!existsSync(folder)) throw new Error(`There is no folder at ${folder}.`);
    return inspectModelFolder(folder, {}, totalMemoryGb());
  }

  worker(): WspWorkerStatus {
    if (this.settingUp !== null) return { status: 'setting-up' };
    return this.processes.status(this.paths);
  }

  setupWorker(): WspWorkerStatus {
    if (this.settingUp === null) {
      this.settingUp = setupWorker(this.paths)
        .catch((error: unknown) => {
          this.onError(error);
          return {
            status: 'needs-setup' as const,
            reason: `Setup failed: ${(error as Error).message.slice(0, 400)}`,
          };
        })
        .finally(() => {
          this.settingUp = null;
          for (const listener of this.listeners) listener({ experimentId: 'wsp-worker' });
        });
    }
    return { status: 'setting-up' };
  }

  computeTargets(): WspComputeTarget[] {
    const worker = this.worker();
    const local: WspComputeTarget = {
      id: 'local-cpu',
      label: 'This computer',
      status:
        worker.status === 'ready'
          ? 'ready'
          : worker.status === 'unavailable'
            ? 'unsupported'
            : 'needs-setup',
      ...(worker.reason === undefined ? {} : { reason: worker.reason }),
      threads: workerThreads(),
      memoryGb: Math.round(totalMemoryGb()),
    };
    return [local, ...UNSUPPORTED.map((target) => ({ ...target, status: 'unsupported' as const }))];
  }

  mentor(): Promise<WspMentorStatus> {
    return this.options.mentorStatus();
  }

  /* Drafting */

  async draft(raw: WspDraftInput): Promise<WspExperiment> {
    const input = WspDraftInputSchema.parse(raw);
    const model = this.inspectModel(input.modelPath);
    if (!model.compatibility.supported) throw new Error(model.compatibility.reasons.join(' '));
    if (input.compute !== 'local-cpu') {
      const target = UNSUPPORTED.find((item) => item.id === input.compute);
      throw new Error(target?.reason ?? 'That compute target is not supported.');
    }
    const examples = input.goal.examples;
    if (examples.length < WSP_MIN_EXAMPLES) {
      throw new Error(
        `Add at least ${WSP_MIN_EXAMPLES} examples: some to practice on, some for dev and some sealed.`,
      );
    }
    const problem = examples
      .map((example) => example.check && checkProblem(example.check))
      .find(Boolean);
    if (problem) throw new Error(problem);
    const prompts = new Set<string>();
    for (const example of examples) {
      const key = example.prompt.trim().toLowerCase();
      if (prompts.has(key))
        throw new Error(`The prompt "${example.prompt.slice(0, 60)}" is there twice.`);
      prompts.add(key);
    }
    const mentor = await this.options.mentorStatus();
    if (mentor.status !== 'ready') throw new Error(mentor.reason ?? 'GPT-6 Astra is not set up.');
    const id = `wsp-${Date.now().toString(36)}${randomBytes(3).toString('hex')}`;
    const seed = randomBytes(4).readUInt32LE(0);
    const split = splitExamples(examples, seed);
    const base = await pinBase(model);
    mkdirSync(this.store.dir(id), { recursive: true });
    this.store.saveExamples(id, { practice: split.practice, dev: split.dev });
    this.options.vault.sealWsp(id, split.qualification);
    const task = input.goal.task.trim().replace(/\s+/g, ' ');
    const experiment = this.save({
      format: WSP_EXPERIMENT_FORMAT,
      id,
      title: task.length > 72 ? `${task.slice(0, 71).trimEnd()}…` : task,
      createdAt: this.now().toISOString(),
      status: 'briefing',
      stage: 'baseline',
      activity: `${mentor.mentor.label} is drafting the brief`,
      base,
      goal: { ...input.goal, examples: [] },
      compute: input.compute,
      limits: input.limits,
      mentor: { ...mentor.mentor, reasoningEffort: input.reasoningEffort },
      brief: null,
      approval: null,
      split: {
        seed,
        practice: split.practice.length,
        dev: split.dev.length,
        qualification: split.qualification.length,
      },
      hypothesis: '',
      iterations: [],
      measurements: [],
      incumbent: null,
      frozen: null,
      costs: WSP_ZERO_COSTS,
      worker: null,
      result: null,
    });
    void this.writeBrief(id);
    return experiment;
  }

  async redraft(id: string): Promise<WspExperiment> {
    const experiment = this.store.get(id);
    if (experiment.status !== 'brief' || experiment.brief !== null) {
      throw new CodedError(
        'experiment_state',
        'Only a brief that failed to draft is drafted again.',
      );
    }
    const { error: _error, ...rest } = experiment;
    const saved = this.save({
      ...rest,
      status: 'briefing',
      activity: `${experiment.mentor.label} is drafting the brief`,
    });
    void this.writeBrief(id);
    return saved;
  }

  private tensorText(experiment: WspExperiment): string {
    const tensors = checkpointTensors(experiment.base.path);
    return inventory(
      [...tensors.keys()].sort(),
      new Map([...tensors].map(([name, info]) => [name, info.shape])),
    );
  }

  private async writeBrief(id: string): Promise<void> {
    try {
      const experiment = this.store.get(id);
      const mentor = await this.options.connectMentor(experiment.mentor.reasoningEffort);
      const context = {
        experiment,
        practice: this.store.examples(id).practice,
        tensors: this.tensorText(experiment),
      };
      const request = briefRequest(context);
      this.guardRequest(experiment, mentor, requestText(request), request.maxOutputTokens);
      const turn = await mentor.brief(context);
      const latest = this.store.get(id);
      this.save({
        ...latest,
        status: 'brief',
        activity: '',
        brief: turn.value,
        costs: this.charged(latest, turn.completion),
      });
      this.store.journal(id, { at: this.now().toISOString(), call: 'brief', ...turn.completion });
    } catch (error) {
      this.onError(error);
      const latest = this.store.get(id);
      this.save({
        ...latest,
        status: 'brief',
        activity: '',
        error: `The brief couldn't be drafted: ${(error as Error).message}`,
      });
    }
  }

  revise(id: string, brief: WspBrief, title: string): WspExperiment {
    const experiment = this.store.get(id);
    if (experiment.status !== 'brief') {
      throw new CodedError(
        'experiment_frozen',
        'The brief was approved when the experiment started; it no longer changes.',
      );
    }
    return this.save({
      ...experiment,
      brief: WspBriefSchema.parse(brief),
      title: z.string().trim().min(1).max(120).parse(title),
    });
  }

  /* Running */

  start(id: string): WspExperiment {
    const experiment = this.store.get(id);
    if (experiment.status !== 'brief' || experiment.brief === null) {
      throw new CodedError('experiment_state', 'Only an experiment with a drafted brief starts.');
    }
    this.oneAtATime();
    const { error: _error, ...rest } = experiment;
    const saved = this.save({
      ...rest,
      status: 'running',
      activity: 'Starting',
      approval: { briefSha256: sha256(canonical(experiment.brief)), at: this.now().toISOString() },
    });
    this.launch(id);
    return saved;
  }

  resume(id: string): WspExperiment {
    const experiment = this.store.get(id);
    if (experiment.status !== 'interrupted') {
      throw new CodedError('experiment_state', 'Only an interrupted experiment resumes.');
    }
    this.oneAtATime();
    const saved = this.save({
      ...experiment,
      status: 'running',
      activity: 'Resuming from its last finished program',
    });
    this.launch(id);
    return saved;
  }

  cancel(id: string): WspExperiment {
    const experiment = this.store.get(id);
    const active = this.active.get(id);
    if (active === undefined) {
      if (experiment.status === 'interrupted' || experiment.status === 'brief') {
        return this.save({
          ...experiment,
          status: 'cancelled',
          activity: 'Cancelled',
          endedAt: this.now().toISOString(),
        });
      }
      throw new CodedError('experiment_state', 'This experiment is not running.');
    }
    active.abort.abort();
    active.evaluator?.close();
    return this.save({ ...experiment, status: 'cancelling', activity: 'Cancelling' });
  }

  private oneAtATime(): void {
    if (this.active.size > 0) {
      throw new CodedError(
        'experiment_state',
        'Another experiment is running on this computer; wait for it or cancel it.',
      );
    }
  }

  private launch(id: string): void {
    const active: Active = { abort: new AbortController(), evaluator: null };
    this.active.set(id, active);
    void this.run(id, active).finally(() => {
      active.evaluator?.close();
      this.active.delete(id);
    });
  }

  /** The wall clock: what earlier runs used plus this one so far. */
  private clock(experiment: WspExperiment, since: number, before: number): WspExperiment {
    return {
      ...experiment,
      costs: { ...experiment.costs, wallSeconds: before + (Date.now() - since) / 1000 },
    };
  }

  private charged(
    experiment: WspExperiment,
    completion: {
      usage: { inputTokens: number; outputTokens: number; reasoningTokens?: number };
      costUsd: number | null;
    },
  ): WspExperiment['costs'] {
    const output = completion.usage.outputTokens + (completion.usage.reasoningTokens ?? 0);
    const cost = completion.costUsd ?? 0;
    return {
      ...experiment.costs,
      mentorUsd: experiment.costs.mentorUsd + cost,
      mentorCalls: experiment.costs.mentorCalls + 1,
      inputTokens: experiment.costs.inputTokens + completion.usage.inputTokens,
      outputTokens: experiment.costs.outputTokens + output,
    };
  }

  /** Refuses a request that would carry a sealed example or could pass the mentor's cap. */
  private guardRequest(
    experiment: WspExperiment,
    mentor: WspMentorClient,
    text: string,
    maxOutput: number,
  ): void {
    if (this.options.vault.wspLeaks(experiment.id, text)) {
      throw new GuardError(
        'split',
        'The request to the mentor carried a sealed example, so it was not sent.',
      );
    }
    const worst = mentor.worstCaseUsd(text.length, maxOutput);
    if (experiment.costs.mentorUsd + worst > experiment.limits.mentorUsd) {
      throw new GuardError(
        'budget',
        `The next call to ${experiment.mentor.label} could cost up to $${worst.toFixed(2)}, past the $${experiment.limits.mentorUsd.toFixed(2)} cap.`,
      );
    }
  }

  private async run(id: string, active: Active): Promise<void> {
    const since = Date.now();
    const before = this.store.get(id).costs.wallSeconds;
    const update = (change: (experiment: WspExperiment) => WspExperiment) =>
      this.save(this.clock(change(this.store.get(id)), since, before));
    try {
      const start = this.store.get(id);
      const changed = await baseChanges(start.base);
      if (changed.length > 0) {
        throw new Error(
          `The base checkpoint changed since the experiment was made (${changed.join(', ')}); start a new experiment.`,
        );
      }
      const worker = this.processes.status(this.paths);
      if (worker.status !== 'ready')
        throw new Error(worker.reason ?? 'The WSP worker is not set up.');
      update((experiment) => ({ ...experiment, activity: 'Loading the model' }));
      const evaluator = this.processes.evaluator(
        this.paths,
        start.base.path,
        this.store.dir(id),
        start.limits.memoryGb * GB,
      );
      active.evaluator = evaluator;
      await evaluator.start();
      update((experiment) => ({
        ...experiment,
        worker: workerInfo(this.paths, evaluator.info?.python ?? 'unknown'),
      }));
      await this.baseline(id, active, update);
      await this.investigate(id, active, update, since, before);
      this.finish(id, update);
    } catch (error) {
      const latest = this.store.get(id);
      if (active.abort.signal.aborted) {
        this.save(
          this.clock(
            {
              ...latest,
              status: 'cancelled',
              activity: 'Cancelled',
              endedAt: this.now().toISOString(),
            },
            since,
            before,
          ),
        );
      } else {
        this.onError(error);
        this.save(
          this.clock(
            {
              ...latest,
              status: 'failed',
              activity: 'Failed',
              error: (error as Error).message,
              endedAt: this.now().toISOString(),
            },
            since,
            before,
          ),
        );
      }
    }
  }

  private evaluated(
    experiment: WspExperiment,
    arm: WspArm,
    split: WspSplit,
    candidateId?: string,
  ): WspMeasurement | undefined {
    return experiment.measurements.find(
      (item) => item.arm === arm && item.split === split && item.candidateId === candidateId,
    );
  }

  private candidatePath(id: string, candidateId: string): string {
    return this.store.sub(id, 'candidates', candidateId, 'tensors.safetensors');
  }

  /** One arm on one split: the evaluator's outputs, kept, and scored. */
  private async evaluate(
    id: string,
    active: Active,
    arm: WspArm,
    split: WspSplit,
    examples: readonly WspExample[],
    candidateId?: string,
  ): Promise<WspMeasurement> {
    const experiment = this.store.get(id);
    const brief = experiment.brief!;
    const decoding: WspDecoding =
      arm === 'decoding'
        ? brief.controls.decoding
        : { ...brief.controls.decoding, temperature: 0, topP: 1, repetitionPenalty: 1 };
    const system = arm === 'instructions' ? brief.controls.instructions : null;
    let candidate: string | null = null;
    if (candidateId !== undefined) {
      candidate = this.candidatePath(id, candidateId);
      const manifest = this.candidate(id, candidateId);
      if ((await sha256File(candidate)) !== manifest.tensorsSha256) {
        throw new Error(`Candidate ${candidateId}'s tensors changed after it was made.`);
      }
    }
    const reply = await active.evaluator!.request(
      'generate',
      {
        candidate,
        prompts: examples.map((example) => example.prompt),
        system,
        decoding,
        seed: experiment.split.seed,
        batch: 8,
      },
      z.object({ outputs: OutputsSchema, seconds: z.number() }),
    );
    const name = `${arm}-${split}${candidateId === undefined ? '' : `-${candidateId}`}`;
    this.store.saveOutputs(id, name, reply.outputs);
    const result = measure(
      arm,
      split,
      examples,
      reply.outputs as WspOutput[],
      reply.seconds,
      candidateId,
    );
    const latest = this.store.get(id);
    this.save({
      ...latest,
      measurements: [...latest.measurements, result],
      costs: {
        ...latest.costs,
        computeSeconds: latest.costs.computeSeconds + reply.seconds,
        forwardPasses: latest.costs.forwardPasses + (split === 'qualification' ? 0 : 1),
      },
    });
    return result;
  }

  private async baseline(
    id: string,
    active: Active,
    update: (change: (e: WspExperiment) => WspExperiment) => WspExperiment,
  ): Promise<void> {
    const { practice, dev } = this.store.examples(id);
    const plan: [WspArm, WspSplit, WspExample[], string][] = [
      ['base', 'practice', practice, 'Measuring the base on practice'],
      ['base', 'dev', dev, 'Measuring the base on dev'],
      ['decoding', 'dev', dev, 'Measuring the decoding control on dev'],
    ];
    if (this.store.get(id).brief!.controls.instructions !== null) {
      plan.push(['instructions', 'dev', dev, 'Measuring the instruction control on dev']);
    }
    for (const [arm, split, examples, activity] of plan) {
      if (active.abort.signal.aborted) throw new Error('Cancelled.');
      if (this.evaluated(this.store.get(id), arm, split) !== undefined) continue;
      update((experiment) => ({ ...experiment, stage: 'baseline', activity }));
      await this.evaluate(id, active, arm, split, examples);
    }
  }

  private practiceView(id: string, candidateId: string | null) {
    const { practice } = this.store.examples(id);
    const experiment = this.store.get(id);
    const measured =
      candidateId === null
        ? this.evaluated(experiment, 'base', 'practice')
        : this.evaluated(experiment, 'candidate', 'practice', candidateId);
    const outputs =
      this.store.outputs(
        id,
        candidateId === null ? 'base-practice' : `candidate-practice-${candidateId}`,
        OutputsSchema,
      ) ?? [];
    return practice.map((example, index) => ({
      prompt: example.prompt,
      output: outputs[index]?.text ?? '',
      passed: measured?.outcomes[index]?.passed ?? null,
      looped: measured?.outcomes[index]?.looped ?? false,
    }));
  }

  /** Why the run can't go on, or null while every cap leaves room. */
  private exhausted(experiment: WspExperiment, since: number, before: number): string | null {
    const limits = experiment.limits;
    const wall = before + (Date.now() - since) / 1000;
    if (experiment.iterations.length >= limits.programs)
      return `It ran all ${limits.programs} programs.`;
    if (experiment.costs.forwardPasses + 2 > limits.forwardPasses)
      return `It used its ${limits.forwardPasses} forward passes.`;
    // The mentor's cap is held before each call, against the most that call could cost.
    if (wall >= limits.wallMinutes * 60) return `It ran for its ${limits.wallMinutes} minutes.`;
    return null;
  }

  private async investigate(
    id: string,
    active: Active,
    update: (change: (e: WspExperiment) => WspExperiment) => WspExperiment,
    since: number,
    before: number,
  ): Promise<void> {
    const start = this.store.get(id);
    const mentor = await this.options.connectMentor(start.mentor.reasoningEffort);
    const tensors = this.tensorText(start);
    const { practice, dev } = this.store.examples(id);
    for (;;) {
      if (active.abort.signal.aborted) throw new Error('Cancelled.');
      const experiment = this.store.get(id);
      const stop = this.exhausted(experiment, since, before);
      if (stop !== null) {
        update((latest) => ({ ...latest, activity: stop }));
        return;
      }
      const n = experiment.iterations.length + 1;
      const wall = before + (Date.now() - since) / 1000;
      const context = {
        experiment,
        tensors,
        practice: this.practiceView(id, experiment.incumbent),
        baseDev: this.evaluated(experiment, 'base', 'dev'),
        decodingDev: this.evaluated(experiment, 'decoding', 'dev'),
        instructionsDev: this.evaluated(experiment, 'instructions', 'dev'),
        currentDev:
          experiment.incumbent === null
            ? this.evaluated(experiment, 'base', 'dev')
            : this.evaluated(experiment, 'candidate', 'dev', experiment.incumbent),
        programs: this.store.programs(id),
        remaining: {
          programs: experiment.limits.programs - experiment.iterations.length,
          forwardPasses: experiment.limits.forwardPasses - experiment.costs.forwardPasses,
          minutes: experiment.limits.wallMinutes - wall / 60,
          mentorUsd: experiment.limits.mentorUsd - experiment.costs.mentorUsd,
        },
      };
      update((latest) => ({
        ...latest,
        stage: latest.incumbent === null ? 'investigation' : 'edit',
        activity: `${latest.mentor.label} is writing program ${n}`,
      }));
      const request = stepRequest(context);
      try {
        this.guardRequest(experiment, mentor, requestText(request), request.maxOutputTokens);
      } catch (error) {
        // The cap ends the investigation where it is; what was measured stands.
        if (error instanceof GuardError && error.guard === 'budget') {
          update((latest) => ({ ...latest, activity: error.message }));
          return;
        }
        throw error;
      }
      const turn = await mentor.step(context, active.abort.signal);
      this.store.journal(id, {
        at: this.now().toISOString(),
        call: `step ${n}`,
        ...turn.completion,
      });
      const step = turn.value;
      const startedAt = this.now().toISOString();
      if (step.action === 'finish' || step.program.trim().length === 0) {
        update((latest) => ({
          ...latest,
          hypothesis: step.hypothesis,
          activity: step.summary,
          costs: this.charged(latest, turn.completion),
        }));
        return;
      }
      const cost = turn.completion.costUsd ?? 0;
      this.store.saveProgram(id, n, step.program);
      const iteration: WspIteration = {
        n,
        hypothesis: step.hypothesis,
        expected: step.expected,
        programSha256: sha256(step.program),
        outcome: 'inspected',
        output: '',
        mentorUsd: cost,
        startedAt,
      };
      update((latest) => ({
        ...latest,
        hypothesis: step.hypothesis,
        activity: `Running program ${n}`,
        iterations: [...latest.iterations, iteration],
        costs: { ...this.charged(latest, turn.completion), programs: latest.costs.programs + 1 },
      }));
      const finished = await this.runProgram(id, active, n, iteration, practice, dev);
      update((latest) => ({
        ...latest,
        iterations: latest.iterations.map((item) =>
          item.n === n ? { ...finished, endedAt: this.now().toISOString() } : item,
        ),
        incumbent: finished.decision === 'kept' ? finished.candidateId! : latest.incumbent,
      }));
    }
  }

  private async runProgram(
    id: string,
    active: Active,
    n: number,
    iteration: WspIteration,
    practice: readonly WspExample[],
    dev: readonly WspExample[],
  ): Promise<WspIteration> {
    const experiment = this.store.get(id);
    const out = this.store.sub(id, 'kernel', String(n));
    rmSync(out, { recursive: true, force: true });
    mkdirSync(out, { recursive: true });
    const incumbent =
      experiment.incumbent === null ? null : this.candidatePath(id, experiment.incumbent);
    const outcome = await this.processes.kernel(
      this.paths,
      {
        base: experiment.base.path,
        program: this.store.programFile(id, n),
        incumbent,
        out,
        scratch: this.store.sub(id, 'scratch'),
        reads: this.store.sub(id, 'reads'),
        practice: this.practiceView(id, experiment.incumbent),
        memoryBytes: experiment.limits.memoryGb * GB,
      },
      join(out, '..', `${n}.request.json`),
      {
        timeoutMs: experiment.limits.programSeconds * 1000,
        tempDir: this.store.sub(id, 'tmp'),
        signal: active.abort.signal,
      },
    );
    this.addCompute(id, outcome.seconds);
    if (active.abort.signal.aborted) throw new Error('Cancelled.');
    if (outcome.kind === 'timeout') {
      return {
        ...iteration,
        outcome: 'timeout',
        reason: `It ran past its ${experiment.limits.programSeconds} seconds.`,
        output: '',
      };
    }
    if (outcome.kind === 'failed')
      return { ...iteration, outcome: 'error', reason: outcome.reason, output: '' };
    const result = outcome.result;
    const output = this.screened(id, result.output);
    if (result.status === 'error') {
      return {
        ...iteration,
        outcome: 'error',
        reason: result.error ?? 'The program failed.',
        output,
      };
    }
    let current: WspIteration = {
      ...iteration,
      output,
      outcome: result.reads.length > 0 ? 'read' : 'inspected',
    };
    for (const read of result.reads) {
      if (this.store.get(id).costs.forwardPasses + 1 > experiment.limits.forwardPasses) {
        return { ...current, reason: 'A read was left out: the forward passes were used up.' };
      }
      this.updateActivity(id, `Reading hidden states for "${read.name}"`);
      const reply = await active.evaluator!.request(
        'read',
        {
          candidate: incumbent,
          texts: read.texts,
          layers: read.layers,
          out: join(this.store.sub(id, 'reads'), `${read.name}.npz`),
        },
        ReadSchema.extend({ seconds: z.number() }),
      );
      const latest = this.store.get(id);
      this.save({
        ...latest,
        costs: {
          ...latest.costs,
          forwardPasses: latest.costs.forwardPasses + 1,
          computeSeconds: latest.costs.computeSeconds + reply.seconds,
        },
      });
    }
    if (result.edits === null) {
      return result.refused.length > 0
        ? { ...current, outcome: 'refused', reason: result.refused.join(' ') }
        : current;
    }
    this.updateActivity(id, `Checking the edits of program ${n}`);
    let composed: z.infer<typeof ComposeSchema>;
    const staged = join(out, 'candidate.safetensors');
    try {
      composed = await active.evaluator!.request(
        'compose',
        { folder: out, files: result.edits.files, incumbent, out: staged },
        ComposeSchema,
      );
    } catch (error) {
      return { ...current, outcome: 'refused', reason: (error as Error).message };
    }
    const changed = composed.edits.reduce((sum, edit) => sum + edit.changed, 0);
    if (changed > experiment.limits.maxChangedFraction * composed.parameters) {
      return {
        ...current,
        outcome: 'refused',
        reason: `It changes ${changed.toLocaleString('en-US')} weights, past the cap of ${(experiment.limits.maxChangedFraction * 100).toFixed(2)}% of the model.`,
      };
    }
    const candidate = this.writeCandidate(
      id,
      experiment,
      iteration.programSha256,
      composed,
      staged,
      changed,
    );
    current = { ...current, outcome: 'edit', candidateId: candidate.id, edits: candidate.edits };
    this.updateActivity(id, `Measuring candidate ${candidate.id.slice(5, 13)}`, 'evaluation');
    await this.evaluate(id, active, 'candidate', 'practice', practice, candidate.id);
    const measured = await this.evaluate(id, active, 'candidate', 'dev', dev, candidate.id);
    const latest = this.store.get(id);
    const metric = latest.brief!.target.metric;
    const reference =
      latest.incumbent === null
        ? this.evaluated(latest, 'base', 'dev')
        : this.evaluated(latest, 'candidate', 'dev', latest.incumbent);
    const score = (item: WspMeasurement | undefined) => {
      if (item === undefined) return null;
      const value =
        metric === 'loop_rate'
          ? item.looped / Math.max(1, item.n)
          : item.passed === null
            ? null
            : item.passed / Math.max(1, item.checked);
      return value === null ? null : metric === 'loop_rate' ? -value : value;
    };
    const mine = score(measured);
    const theirs = score(reference);
    const kept = mine !== null && theirs !== null && mine > theirs;
    return { ...current, dev: measured, decision: kept ? 'kept' : 'discarded' };
  }

  /** What a program printed, with any sealed example taken out before the mentor sees it. */
  private screened(id: string, output: string): string {
    return this.options.vault.wspLeaks(id, output)
      ? '[The output was withheld: it carried text from a sealed example.]'
      : output;
  }

  private updateActivity(id: string, activity: string, stage?: WspExperiment['stage']): void {
    const latest = this.store.get(id);
    this.save({ ...latest, activity, ...(stage === undefined ? {} : { stage }) });
  }

  private addCompute(id: string, seconds: number): void {
    const latest = this.store.get(id);
    this.save({
      ...latest,
      costs: { ...latest.costs, computeSeconds: latest.costs.computeSeconds + seconds },
    });
  }

  private writeCandidate(
    id: string,
    experiment: WspExperiment,
    programSha256: string,
    composed: z.infer<typeof ComposeSchema>,
    staged: string,
    changed: number,
  ): WspCandidate {
    const body = {
      format: WSP_CANDIDATE_FORMAT,
      method: 'weight_program' as const,
      baseDigest: experiment.base.digest,
      parent: experiment.incumbent,
      programSha256,
      edits: composed.edits,
      changed,
      tensorsSha256: composed.sha256,
    };
    const digest = sha256(canonical(body));
    const candidate = WspCandidateSchema.parse({
      ...body,
      id: `wspc-${digest.slice(0, 20)}`,
      digest,
    });
    const dir = this.store.sub(id, 'candidates', candidate.id);
    if (!existsSync(join(dir, 'manifest.json'))) {
      mkdirSync(dir, { recursive: true });
      copyFileSync(staged, join(dir, 'tensors.safetensors'));
      writeFileAtomic(join(dir, 'manifest.json'), JSON.stringify(candidate, null, 2));
    }
    return candidate;
  }

  private candidate(id: string, candidateId: string): WspCandidate {
    return WspCandidateSchema.parse(
      JSON.parse(
        readFileSync(this.store.sub(id, 'candidates', candidateId, 'manifest.json'), 'utf8'),
      ),
    );
  }

  /** Freezes the incumbent, releases the mentor and files the dev result. */
  private finish(
    id: string,
    update: (change: (e: WspExperiment) => WspExperiment) => WspExperiment,
  ): void {
    const experiment = this.store.get(id);
    const frozen =
      experiment.incumbent === null
        ? null
        : {
            candidateId: experiment.incumbent,
            digest: this.candidate(id, experiment.incumbent).digest,
            at: this.now().toISOString(),
          };
    update((latest) => {
      const done = { ...latest, frozen };
      return {
        ...done,
        status: 'evaluated',
        stage: 'results',
        activity: '',
        result: wspResult(done, 'dev'),
        endedAt: this.now().toISOString(),
      };
    });
  }

  /* Qualification and export */

  async qualify(id: string): Promise<WspExperiment> {
    const experiment = this.store.get(id);
    if (experiment.status !== 'evaluated' || experiment.frozen === null) {
      throw new CodedError(
        'experiment_state',
        'Only an evaluated experiment with a frozen candidate is qualified.',
      );
    }
    this.oneAtATime();
    const candidate = this.candidate(id, experiment.frozen.candidateId);
    if (candidate.digest !== experiment.frozen.digest) {
      throw new Error('The frozen candidate changed after it was frozen.');
    }
    const saved = this.save({
      ...experiment,
      status: 'qualifying',
      activity: 'Opening the sealed examples',
    });
    const active: Active = { abort: new AbortController(), evaluator: null };
    this.active.set(id, active);
    void (async () => {
      try {
        const proof = this.released.get(id) ?? (await releaseMentor({ dispose: () => undefined }));
        this.released.set(id, proof);
        const sealed = this.options.vault.openWsp(id, proof);
        const evaluator = this.processes.evaluator(
          this.paths,
          experiment.base.path,
          this.store.dir(id),
          experiment.limits.memoryGb * GB,
        );
        active.evaluator = evaluator;
        await evaluator.start();
        const arms: [WspArm, string | undefined][] = [
          ['base', undefined],
          ['decoding', undefined],
          ...(experiment.brief?.controls.instructions === null
            ? []
            : [['instructions', undefined] as [WspArm, undefined]]),
          ['candidate', experiment.frozen!.candidateId],
        ];
        for (const [arm, candidateId] of arms) {
          this.updateActivity(
            id,
            `Qualifying: ${arm === 'candidate' ? 'the candidate' : `the ${arm} arm`}`,
          );
          await this.evaluate(id, active, arm, 'qualification', sealed, candidateId);
        }
        const latest = this.store.get(id);
        this.save({
          ...latest,
          status: 'qualified',
          activity: '',
          result: wspResult(latest, 'qualification'),
        });
      } catch (error) {
        this.onError(error);
        const latest = this.store.get(id);
        this.save({
          ...latest,
          status: 'evaluated',
          activity: '',
          error: `Qualification stopped: ${(error as Error).message}`,
          measurements: latest.measurements.filter((item) => item.split !== 'qualification'),
        });
      } finally {
        active.evaluator?.close();
        this.active.delete(id);
      }
    })();
    return saved;
  }

  async exportCandidate(id: string, parentDir: string): Promise<WspExport> {
    const experiment = this.store.get(id);
    if (experiment.frozen === null)
      throw new CodedError('experiment_state', 'There is no frozen candidate to export.');
    const folder = join(
      parentDir,
      `${experiment.base.name.split('/').pop()}-${experiment.frozen.candidateId}`,
    );
    if (existsSync(folder)) throw new Error(`${folder} already exists.`);
    const evaluator = this.processes.evaluator(
      this.paths,
      experiment.base.path,
      this.store.dir(id),
      experiment.limits.memoryGb * GB,
    );
    try {
      await evaluator.start();
      const written = await evaluator.request(
        'materialize',
        { candidate: this.candidatePath(id, experiment.frozen.candidateId), out: folder },
        MaterializeSchema,
      );
      const provenance = {
        format: 'architect.wsp-provenance/1',
        experiment: experiment.id,
        method: 'weight_program',
        base: experiment.base,
        candidate: this.candidate(id, experiment.frozen.candidateId),
        mentor: experiment.mentor,
        approval: experiment.approval,
        worker: experiment.worker,
        programs: experiment.iterations.map((item) => ({
          n: item.n,
          sha256: item.programSha256,
          source: this.store.program(id, item.n),
        })),
        measurements: experiment.measurements,
        result: experiment.result,
        costs: experiment.costs,
      };
      writeFileAtomic(join(folder, 'architect-wsp.json'), JSON.stringify(provenance, null, 2));
      return {
        folder,
        files: [
          ...written.files,
          {
            name: 'architect-wsp.json',
            bytes: Buffer.byteLength(JSON.stringify(provenance, null, 2)),
            sha256: await sha256File(join(folder, 'architect-wsp.json')),
          },
        ],
      };
    } finally {
      evaluator.close();
    }
  }

  program(id: string, n: number): string {
    return this.store.program(id, n);
  }

  list(): WspExperiment[] {
    return this.store.list();
  }

  get(id: string): WspExperiment {
    return this.store.get(id);
  }

  /** Stops whatever runs; it resumes as interrupted on the next start. */
  close(): void {
    for (const active of this.active.values()) active.evaluator?.close();
  }
}
