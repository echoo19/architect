import type { Harness, Job, MentorAdapter, StudentAdapter, StudentTarget } from '@architect/shared';
import { describeDataFiles, type MentorDataFile } from '../mentor/data-files';
import { MentorGate } from '../mentor/gate';
import type { BudgetGuard } from './budget';
import type {
  HarnessVersionStore,
  LoopDeps,
  MentorReleased,
  TaskChecker,
  ToolSandbox,
} from './deps';
import { errorMessage } from './errors';
import { connectMentor, connectStudent } from './setup';

export type LogLevel = 'info' | 'warn' | 'error';

export interface ResourceOptions {
  deps: LoopDeps;
  job: Job;
  jobDir: string;
  dataDir: string;
  runId: string;
  versions: HarnessVersionStore;
  budget: BudgetGuard;
  log(level: LogLevel, message: string): void;
}

/**
 * What one session of a run holds: created on first use, released when the session ends. A new
 * session after a pause or a restart starts with none of it.
 */
export class SessionResources {
  private sandboxCreated?: Promise<ToolSandbox>;
  private checkerCreated?: Promise<TaskChecker>;
  private readonly students = new Map<StudentTarget, Promise<StudentAdapter>>();
  private mentorCreated?: Promise<MentorAdapter>;
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

  student(target: StudentTarget): Promise<StudentAdapter> {
    let student = this.students.get(target);
    if (!student) {
      student = connectStudent(this.options.deps, this.options.job, target);
      this.students.set(target, student);
    }
    return student;
  }

  mentor(): Promise<MentorAdapter> {
    this.mentorCreated ??= connectMentor(this.options.deps, this.options.job);
    return this.mentorCreated;
  }

  /** The gate every author call goes through: leak check, then the dollar cap. */
  gate(): Promise<MentorGate> {
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
   * test. Nothing is disposed; once dropped, the adapter is unreachable.
   */
  releaseMentor(): Promise<MentorReleased> {
    this.released ??= (async () => {
      await this.gateCreated?.then(
        (gate) => gate.release(),
        () => undefined,
      );
      const mentor = this.mentorCreated ? await this.mentorCreated.catch(() => null) : null;
      this.mentorCreated = undefined;
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
