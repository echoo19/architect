import {
  GuardError,
  type ActorAdapter,
  type Harness,
  type Job,
  type MentorAdapter,
  type StudentAdapter,
  type StudentTarget,
} from '@architect/shared';
import { describeDataFiles, type MentorDataFile } from '../mentor/data-files';
import { MentorGate } from '../mentor/gate';
import type { BudgetGuard } from './budget';
import { configurationKey, LLAMA_CPP, STUDENT_CONFIG, type AttemptConfig } from './configuration';
import type {
  HarnessVersionStore,
  LoopDeps,
  MentorReleased,
  TaskChecker,
  ToolSandbox,
} from './deps';
import { errorMessage } from './errors';
import { connectActor, connectMentor, connectStudent } from './setup';

export type LogLevel = 'info' | 'warn' | 'error';

function mentorReleased(): GuardError {
  return new GuardError(
    'split',
    'The mentor was released for the locked test; nothing in this session can reach one again.',
  );
}

export interface ResourceOptions {
  deps: LoopDeps;
  job: Job;
  jobDir: string;
  dataDir: string;
  runId: string;
  versions: HarnessVersionStore;
  budget: BudgetGuard;
  /** A path the database stores, relative to the app's data folder, made absolute. */
  fromStored(path: string): string;
  log(level: LogLevel, message: string): void;
}

/**
 * What one session of a run holds: created on first use, released when the session ends. A new
 * session after a pause or a restart starts with none of it.
 */
export class SessionResources {
  private sandboxCreated?: Promise<ToolSandbox>;
  private checkerCreated?: Promise<TaskChecker>;
  /** By target and configuration, so each configuration keeps its own student. */
  private readonly students = new Map<string, Promise<StudentAdapter>>();
  private mentorCreated?: Promise<MentorAdapter>;
  private actorCreated?: Promise<ActorAdapter>;
  private gateCreated?: Promise<MentorGate>;
  private dataFilesRead?: Promise<MentorDataFile[]>;
  private readonly harnesses = new Map<number, Promise<Harness>>();
  private released?: Promise<MentorReleased>;

  constructor(private readonly options: ResourceOptions) {}

  sandbox(): Promise<ToolSandbox> {
    this.sandboxCreated ??= Promise.resolve().then(() => this.options.deps.runtime.createSandbox());
    return this.sandboxCreated;
  }

  checker(): Promise<TaskChecker> {
    const { deps, job, jobDir } = this.options;
    this.checkerCreated ??= this.sandbox().then((sandbox) =>
      deps.runtime.createChecker(job, jobDir, sandbox),
    );
    return this.checkerCreated;
  }

  /**
   * The student on one of the job's endpoints, as a configuration asks: the job's own endpoint,
   * or llama.cpp serving the local base with the configuration's adapters.
   */
  student(target: StudentTarget, config: AttemptConfig = STUDENT_CONFIG): Promise<StudentAdapter> {
    const loaded = (config.loaded ?? []).map((adapter) => adapter.id).join(',');
    const key = `${target}|${configurationKey(config)}|${loaded}`;
    let student = this.students.get(key);
    if (!student) {
      student = this.connect(target, config);
      this.students.set(key, student);
    }
    return student;
  }

  private async connect(target: StudentTarget, config: AttemptConfig): Promise<StudentAdapter> {
    const { deps, job, fromStored } = this.options;
    if (config.actor !== 'student') {
      throw new Error(`A ${config.actor} attempt has no student to connect.`);
    }
    if (config.backend === 'job') return connectStudent(deps, job, target);
    if (config.backend !== LLAMA_CPP) {
      throw new Error(`Architect has no ${config.backend} backend for the student.`);
    }
    if (target !== 'local') {
      throw new Error("An adapter runs on the local base model; the hosted copy can't carry one.");
    }
    const create = deps.adapters.createAdapterStudent;
    if (!create) {
      throw new Error(
        "This build can't serve an adapter, so adapter candidates can't be measured.",
      );
    }
    const adapters = (config.loaded ?? []).map((adapter) => ({
      key: adapter.id,
      path: fromStored(adapter.path),
    }));
    const scales = config.adapter === null ? {} : { [config.adapter.id]: config.adapter.scale };
    return create(
      { model: job.student.local.model, adapters, scales },
      { label: job.student.label },
    );
  }

  /** The session's mentor, made on first use; refused once the mentor has been released. */
  mentor(): Promise<MentorAdapter> {
    if (this.released) return Promise.reject(mentorReleased());
    this.mentorCreated ??= connectMentor(this.options.deps, this.options.job);
    return this.mentorCreated;
  }

  /**
   * The mentor's model as an agent, for verified corrections; made on first use, and refused
   * once the mentor has been released, like the mentor itself. Its calls go through `gate()`.
   */
  actor(): Promise<ActorAdapter> {
    if (this.released) return Promise.reject(mentorReleased());
    this.actorCreated ??= connectActor(this.options.deps, this.options.job);
    return this.actorCreated;
  }

  /**
   * The gate every author call goes through: leak check, then the dollar cap. Refused once the
   * mentor has been released, so a fresh gate can't reopen what the released one closed.
   */
  gate(): Promise<MentorGate> {
    if (this.released) return Promise.reject(mentorReleased());
    const { deps, job, budget, log } = this.options;
    this.gateCreated ??= Promise.resolve()
      .then(() => deps.vault.leakDetector(job.id))
      .then(
        (leakDetector) =>
          new MentorGate({
            leakDetector,
            authorize: (maxUsd) => budget.authorizeMentorCall(maxUsd),
            onRefusal: (message) => log('error', message),
          }),
      );
    return this.gateCreated;
  }

  dataFiles(): Promise<MentorDataFile[]> {
    this.dataFilesRead ??= describeDataFiles(this.options.job.data.files, this.options.dataDir);
    return this.dataFilesRead;
  }

  harness(version: number): Promise<Harness> {
    let harness = this.harnesses.get(version);
    if (!harness) {
      harness = Promise.resolve().then(() => this.options.versions.load(version));
      this.harnesses.set(version, harness);
    }
    return harness;
  }

  /**
   * Releases the mentor: closes the gate, so no mentor call can start, drops the session's
   * adapter, and asks the runtime for the proof the vault requires before it opens the locked
   * test. Nothing is disposed; once dropped, the adapter is unreachable, and the session makes
   * no other. A session that never made one passes on none.
   */
  releaseMentor(): Promise<MentorReleased> {
    this.released ??= (async () => {
      await this.gateCreated?.then(
        (gate) => gate.release(),
        () => undefined,
      );
      const mentor = this.mentorCreated ? await this.mentorCreated.catch(() => null) : null;
      this.mentorCreated = undefined;
      this.actorCreated = undefined;
      return this.options.deps.runtime.releaseMentor({
        jobId: this.options.job.id,
        runId: this.options.runId,
        mentor,
      });
    })();
    return this.released;
  }

  /** Disposes the sandbox and frees the students' memory. A resource that never got made is skipped. */
  async close(): Promise<void> {
    const cleanups = [
      this.sandboxCreated?.then(
        (sandbox) => sandbox.dispose(),
        () => undefined,
      ),
      ...[...this.students.values()].map((student) =>
        student.then(
          (adapter) => adapter.release(),
          () => undefined,
        ),
      ),
    ];
    for (const result of await Promise.allSettled(cleanups)) {
      if (result.status === 'rejected') {
        this.options.log(
          'warn',
          `Cleaning up after the session failed: ${errorMessage(result.reason)}`,
        );
      }
    }
  }
}
