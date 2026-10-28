import {
  AdapterError,
  type Job,
  type StudentAdapter,
  type StudentTarget,
  type Task,
  type Trace,
  type Usage,
} from '@architect/shared';
import { studentPrice } from '../loop/attempts';
import type { Clock, LoopDeps, MeterReading } from '../loop/deps';
import { connectStudent, studentEndpoint } from '../loop/setup';
import { waitOnClock } from '../loop/time';
import type { ComparisonFiles, SweepAttempt } from './records';

/** A reply that failed in passing is tried again this long after, at most this often in a row. */
const RETRY_WAIT_MS = 30_000;
const RETRIES = 3;

export interface SweepOptions {
  name: 'calibration' | 'regression' | 'probe';
  job: Job;
  jobDir: string;
  tasks: readonly Task[];
  target: StudentTarget;
  seed: number;
  concurrency: number;
  deps: LoopDeps;
  clock: Clock;
  files: ComparisonFiles;
  /** Watches the runtime on this computer, for the local probe. */
  onStudent?(student: StudentAdapter): Promise<(() => Promise<MeterReading>) | null>;
  log(line: string): void;
}

/** Waits on the clock the comparison runs on. */
function wait(clock: Clock, ms: number): Promise<void> {
  return waitOnClock(clock, ms);
}

/**
 * What an attempt's model calls cost: what the provider billed for each call that said, the
 * listed price of the usage the others reported. A call that reported neither a charge nor any
 * usage has no known cost, and neither has the attempt: it never counts as zero.
 */
export function attemptCost(
  trace: Trace,
  price: (usage: Usage) => number | null,
  isLocal: boolean,
): Pick<SweepAttempt, 'usd' | 'listedUsd' | 'calls' | 'billedCalls' | 'billedUsd'> {
  let usd: number | null = 0;
  let listedUsd: number | null = 0;
  let calls = 0;
  let billedCalls = 0;
  let billedUsd = 0;
  for (const step of trace.steps) {
    if (step.kind !== 'model') continue;
    calls += 1;
    const listed = price(step.usage);
    listedUsd = listedUsd === null || listed === null ? null : listedUsd + listed;
    if (step.costUsd !== undefined) {
      billedCalls += 1;
      billedUsd += step.costUsd;
      if (usd !== null) usd += step.costUsd;
      continue;
    }
    const known = isLocal || step.usage.inputTokens > 0 ? listed : null;
    usd = usd === null || known === null ? null : usd + known;
  }
  return { usd, listedUsd, calls, billedCalls, billedUsd };
}

/**
 * The bare student on a fixed set of tasks outside any run, in a blank harness: the calibration
 * tasks that price an attempt before any arm spends, the regression check on another job, or the
 * local probe that times this computer. Each attempt is written as it finishes, so a restart
 * attempts only the tasks left; a reply that fails in passing is tried again after a wait. An
 * attempt in flight when the process stops is attempted again: its requests are in the request
 * journal, written before each was sent, so what it may have cost still counts (decision 051).
 */
export async function sweep(options: SweepOptions): Promise<{
  attempts: SweepAttempt[];
  reading: MeterReading | null;
}> {
  const { deps, job, files, name } = options;
  const done = new Set(files.readSweep(name).map((attempt) => attempt.taskId));
  const left = () => options.tasks.filter((task) => !done.has(task.id));
  if (left().length === 0) return { attempts: files.readSweep(name), reading: null };
  const student = await connectStudent(deps, job, options.target);
  const price = studentPrice(studentEndpoint(job, options.target), student.isLocal);
  const sandbox = await deps.runtime.createSandbox();
  const stopMeter = (await options.onStudent?.(student)) ?? null;
  let reading: MeterReading | null = null;
  const writes: Promise<void>[] = [];
  try {
    const checker = await deps.runtime.createChecker(job, options.jobDir, sandbox);
    const context = {
      job,
      jobDir: options.jobDir,
      harness: deps.harness.blankHarness(job.name, job.description),
      student,
      sandbox,
      checker,
      today: deps.runtime.today(job, new Date(options.clock.now())),
    };
    let failures = 0;
    for (;;) {
      const tasks = left();
      if (tasks.length === 0) break;
      const before = done.size;
      try {
        await deps.runtime.evaluateTasks(tasks, context, {
          seed: options.seed,
          concurrency: options.concurrency,
          onAttempt: (item) => {
            const attempt: SweepAttempt = {
              taskId: item.task.id,
              taskType: item.task.type,
              target: options.target,
              pass: item.result.check.pass,
              refused: item.result.outcome.stopReason === 'refused',
              latencyMs: item.result.trace.latencyMs,
              usage: item.result.trace.usage,
              ...attemptCost(item.result.trace, price, student.isLocal),
              seed: options.seed,
              at: new Date(options.clock.now()).toISOString(),
            };
            done.add(item.task.id);
            writes.push(files.appendSweep(name, attempt));
          },
        });
      } catch (error) {
        failures = done.size > before ? 1 : failures + 1;
        const passing = error instanceof AdapterError && error.retryable && error.status !== 504;
        if (!passing || failures > RETRIES) throw error;
        options.log(`${name}: ${error.message} Trying the tasks left again in 30 s.`);
        await wait(options.clock, RETRY_WAIT_MS);
      }
    }
  } finally {
    await Promise.all(writes);
    if (stopMeter !== null) reading = await stopMeter();
    await sandbox.dispose();
    await student.release();
  }
  return { attempts: files.readSweep(name), reading };
}
