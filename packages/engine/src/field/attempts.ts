import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { HarnessVersions, skillFiles } from '@architect/harness';
import {
  TraceSchema,
  VerifiedEpisodeSchema,
  type Harness,
  type Job,
  type Task,
  type VerifiedEpisode,
} from '@architect/shared';
import { openAgentFiles } from '../files/agent-files';
import { taskDataDir } from '../loop/organizations';
import type { DataPaths } from '../loop/paths';
import type { EngineStore } from '../store/engine-store';
import type { StoredAttempt } from '../store/records';
import { toolSpecs } from '../tools/toolbox';

/** One of the student's train attempts that the checker passed, with what it ran on. */
export interface PassedAttempt {
  attempt: StoredAttempt;
  /** The attempt's trace as stored, unread. */
  trace: unknown;
  /** The harness version it ran with, or null when that version can't be found. */
  harness: Harness | null;
  /** Whether the task's files offered the write tools, as the attempt opened them. */
  writable: boolean;
  /** Each data file's hash as the task's folder holds it now, to compare with the trace's. */
  dataHashes: Record<string, string>;
}

export interface AttemptEpisodes {
  episodes: VerifiedEpisode[];
  leftOut: { what: string; why: string }[];
}

const sameHashes = (a: Record<string, string>, b: Record<string, string>) =>
  Object.keys(a).length === Object.keys(b).length &&
  Object.entries(a).every(([path, hash]) => b[path] === hash);

/**
 * The student's own passing train attempts as verified episodes (decision 101). The checker's
 * verdict is what verifies them, as it verifies a lesson. An attempt goes in only when the
 * conversation is exactly what the student read: its trace is of the attempt's task, records the
 * setup it ran with, that
 * setup and the task's files are unchanged since, and no tool result was cleared from its view.
 * Its targets are the assistant turns the checker's outcome rests on: every turn but one whose
 * tool call failed, which a model shouldn't learn to repeat.
 */
export function attemptEpisodes(job: Job, attempts: readonly PassedAttempt[]): AttemptEpisodes {
  const episodes: VerifiedEpisode[] = [];
  const leftOut: AttemptEpisodes['leftOut'] = [];
  for (const { attempt, trace: raw, harness, writable, dataHashes } of attempts) {
    const skip = (why: string) => leftOut.push({ what: `attempt ${attempt.id}`, why });
    const parsed = TraceSchema.safeParse(raw);
    if (!parsed.success) {
      skip("its trace can't be read");
      continue;
    }
    const trace = parsed.data;
    const { replay } = trace;
    // The row names the task its checker graded; a trace of any other task isn't that attempt.
    if (trace.taskId !== attempt.taskId) {
      skip(`its trace is not of task ${attempt.taskId}`);
      continue;
    }
    if (replay === undefined) {
      skip('its trace was made before traces recorded what an attempt ran with');
      continue;
    }
    if (harness === null || harness.meta.hash !== replay.harnessHash) {
      skip(`its setup (version ${attempt.harnessVersion}) isn't the one it ran with any more`);
      continue;
    }
    if (!sameHashes(replay.data, dataHashes)) {
      skip("its task's files have changed since it ran");
      continue;
    }
    if ((trace.cleared ?? []).length > 0) {
      skip(
        'tool results were taken out of its view while it ran, so its trace is not what it read',
      );
      continue;
    }
    const failed = new Set(
      trace.steps.flatMap((step) =>
        step.kind === 'tool' && step.error !== undefined ? [step.callId] : [],
      ),
    );
    const targets = trace.messages.flatMap((message, index) =>
      message.role === 'assistant' && !(message.toolCalls ?? []).some((call) => failed.has(call.id))
        ? [index]
        : [],
    );
    episodes.push(
      VerifiedEpisodeSchema.parse({
        id: attempt.id,
        lessonId: attempt.id,
        kind: 'passed_attempt',
        category: attempt.taskType,
        origin: { kind: 'task', taskId: attempt.taskId, split: attempt.split },
        messages: trace.messages,
        tools: toolSpecs(harness, writable),
        verifiedTurns: targets,
        check: attempt.check,
        template: { reasoningStrength: replay.decoding.thinking, currentDate: replay.today },
        provenance: {
          jobId: job.id,
          runId: attempt.runId,
          attemptId: attempt.id,
          harnessVersion: attempt.harnessVersion,
          studentModel: trace.studentModel,
          inputHashes: Object.fromEntries(
            Object.entries(replay.data).map(([path, hash]) => [path, hash.replace(/^sha256-/, '')]),
          ),
          verifiedAt: attempt.createdAt,
        },
        sharing: { remoteTraining: job.sharing?.remoteTraining === true },
      }),
    );
  }
  return { episodes, leftOut };
}

/**
 * Every train attempt of the job's runs that the checker passed, by the job's own student with
 * no adapter, with its trace, its harness version and its task's files as they are now. Only the
 * train split is read: dev, calibration and the locked test never are.
 */
export async function loadPassedAttempts(
  store: Pick<EngineStore, 'runs' | 'attempts'>,
  paths: DataPaths,
  job: Job,
  trainTasks: readonly Task[],
): Promise<PassedAttempt[]> {
  const tasks = new Map(trainTasks.map((task) => [task.id, task]));
  const found: PassedAttempt[] = [];
  for (const { run } of store.runs.list(job.id)) {
    const versions = new HarnessVersions(paths.harnessDir(job.id, run.id));
    const harnesses = new Map<number, Harness | null>();
    for (const attempt of store.attempts.list({ runId: run.id, split: 'train' })) {
      const task = tasks.get(attempt.taskId);
      const own = attempt.config === undefined || attempt.config === 'student';
      if (!attempt.check.pass || !own || attempt.tracePath === null || task === undefined) continue;
      if (!harnesses.has(attempt.harnessVersion)) {
        harnesses.set(
          attempt.harnessVersion,
          await versions.load(attempt.harnessVersion).catch(() => null),
        );
      }
      const harness = harnesses.get(attempt.harnessVersion) ?? null;
      const files = await openAgentFiles({
        dataDir: taskDataDir(paths.jobDir(job.id), task),
        files: job.data.files,
        ...(job.data.output === undefined ? {} : { output: job.data.output }),
        skills: harness === null ? {} : skillFiles(harness),
        mode: 'scratch',
      });
      found.push({
        attempt,
        trace: JSON.parse(readFileSync(join(paths.root, ...attempt.tracePath.split('/')), 'utf8')),
        harness,
        writable: files.writable,
        dataHashes: files.dataHashes(),
      });
    }
  }
  return found;
}
