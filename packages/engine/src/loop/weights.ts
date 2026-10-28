import {
  GuardError,
  TERMINAL_TRAINING_STATES,
  type Intervention,
  type Lesson,
  type TrainedAdapter,
  type TrainingJobRecord,
  type VerifiedEpisode,
} from '@architect/shared';
import { hashFile } from '../training/artifacts';
import {
  buildTrainingDataset,
  DatasetError,
  readTrainingDataset,
  writeTrainingDataset,
} from '../training/dataset';
import { must } from './errors';
import { interventionOfRound } from './intervene';
import type { RunState } from './run-state';
import { deriveSeed, seededRandom, shuffle } from './seeds';

/** How long the run waits between checks of a training job. */
export const TRAINING_POLL_MS = 30_000;
/** Earlier lessons a dataset rehearses at most, against forgetting (spec section 6). */
export const MAX_REHEARSAL = 8;

/**
 * The episodes a round trains on: its own verified lessons, and a bounded sample of the run's
 * earlier ones so the adapter keeps what earlier rounds taught. The sample is drawn with the
 * round's seed, so a restart draws the same one.
 */
function datasetLessons(
  state: RunState,
  index: number,
): { targeted: Lesson[]; rehearsal: Lesson[] } {
  const verified = state.ctx.store.lessons.list({ runId: state.ctx.runId, status: 'verified' });
  const targeted = verified.filter((lesson) => lesson.round === index);
  const earlier = verified.filter((lesson) => lesson.round !== null && lesson.round < index);
  const size = Math.min(MAX_REHEARSAL, Math.max(1, Math.ceil(targeted.length / 2)));
  const random = seededRandom(deriveSeed(state.record.seeds.trainBatch, `rehearsal-${index}`));
  const rehearsal = shuffle(
    [...earlier].sort((a, b) => (a.id < b.id ? -1 : 1)),
    random,
  ).slice(0, size);
  return { targeted, rehearsal };
}

/**
 * A weights intervention's training job, once its teaching is done: a dataset of the round's
 * verified lessons with a bounded rehearsal of earlier ones, through the training worker with
 * the run as its compute scope. The worker keys a job by its dataset, so a restart that builds
 * the same dataset finds the job it already sent instead of sending a second.
 */
export async function startTraining(state: RunState, index: number): Promise<void> {
  const training = must(state.ctx.deps.training, 'The training worker');
  const intervention = interventionOfRound(state, index);
  const { targeted, rehearsal } = datasetLessons(state, index);
  if (targeted.length === 0) {
    state.closeRound(
      index,
      'No correction of the findings could be verified, so there was nothing to train on.',
      undefined,
      'invalid',
    );
    return;
  }
  const earlier = sentFor(state, training.datasetDir(state.ctx.runId, index));
  if (earlier !== null) {
    recordJob(state, index, intervention, earlier);
    return;
  }
  const backend = await training.backend();
  if (backend === null) {
    state.closeRound(index, 'No training backend is set up any more.', undefined, 'invalid');
    return;
  }
  const episodes: VerifiedEpisode[] = [...targeted, ...rehearsal].map((lesson) =>
    must(lesson.episode, `The episode of lesson ${lesson.id}`),
  );
  let dir: string;
  let datasetSha256: string;
  try {
    const dataset = buildTrainingDataset(episodes, {
      destination: backend.real ? 'remote' : 'local',
      leakDetector: await state.ctx.deps.vault.leakDetector(state.run.jobId),
      now: () => new Date(state.ctx.clock.now()),
    });
    dir = training.datasetDir(state.ctx.runId, index);
    writeTrainingDataset(dir, dataset);
    datasetSha256 = dataset.manifest.examples_sha256;
  } catch (error) {
    if (error instanceof DatasetError) {
      state.closeRound(
        index,
        `None of the lessons can be trained on: ${error.excluded[0]?.reason ?? error.message}.`,
        undefined,
        'invalid',
      );
      return;
    }
    if (error instanceof GuardError && error.guard === 'split') {
      state.closeRound(index, error.message, 'leak');
      return;
    }
    throw error;
  }
  // A job this run already sent for the same examples, on whatever backend it went to: the round
  // was interrupted after sending it, before recording it. It is the round's job, so a backend
  // that changed since (a token added or removed) can't make a second one (decision 045).
  const sent = training.worker
    .list()
    .find(
      (job) =>
        job.scope === state.ctx.runId &&
        job.dataset.sha256 === datasetSha256 &&
        job.state !== 'failed' &&
        job.state !== 'cancelled',
    );
  let record: TrainingJobRecord;
  if (sent !== undefined) {
    record = sent;
  } else {
    const maxMinutes = state.record.protocol?.maxJobMinutes;
    try {
      record = await training.worker.submit(
        {
          scope: state.ctx.runId,
          maxComputeUsd: state.job.budget.maxComputeUsd ?? 0,
          backend: backend.kind,
          datasetDir: dir,
          baseModel: training.baseModel,
          ...(maxMinutes === undefined ? {} : { maxSeconds: maxMinutes * 60 }),
        },
        state.signal,
      );
    } catch (error) {
      if (!(error instanceof GuardError)) throw error;
      state.closeRound(index, error.message, undefined, 'invalid');
      return;
    }
  }
  recordJob(state, index, intervention, record);
}

/**
 * A job this run already sent for the examples a round's dataset folder holds, on whatever
 * backend it went to, unless it failed or was cancelled; null when the round wrote no dataset or
 * sent nothing yet.
 */
function sentFor(state: RunState, dir: string): TrainingJobRecord | null {
  const training = must(state.ctx.deps.training, 'The training worker');
  let sha256: string;
  try {
    sha256 = readTrainingDataset(dir).manifest.examples_sha256;
  } catch {
    return null;
  }
  return (
    training.worker
      .list()
      .find(
        (job) =>
          job.scope === state.ctx.runId &&
          job.dataset.sha256 === sha256 &&
          job.state !== 'failed' &&
          job.state !== 'cancelled',
      ) ?? null
  );
}

/** Makes a job the round's, which moves the round to training. */
function recordJob(
  state: RunState,
  index: number,
  intervention: Intervention,
  record: TrainingJobRecord,
): void {
  const stored = state.round(index);
  state.ctx.store.transaction(() => {
    state.ctx.store.interventions.put({ ...intervention, trainingJobId: record.id });
    state.ctx.store.rounds.update({ ...stored, round: { ...stored.round, status: 'training' } });
  });
  state.announce('intervention', intervention.id, index);
  state.emit({ type: 'round.updated', round: { ...stored.round, status: 'training' } });
  state.log('info', `Round ${index}: training job ${record.id} on ${record.label}.`);
}

/**
 * A ready job's adapter, as the run records it, or why it can't be used: the file on disk must be
 * the one the worker downloaded and checked, byte for byte, as the job's artifact record lists it
 * (decision 045). A file that changed since is never measured or kept.
 */
function adapterOf(state: RunState, record: TrainingJobRecord): TrainedAdapter | string {
  const training = must(state.ctx.deps.training, 'The training worker');
  const artifacts = must(record.artifacts, "The job's artifacts");
  const listed = artifacts.files.find((file) => file.kind === 'gguf_lora');
  if (listed === undefined) return "The training job's record lists no GGUF adapter.";
  const path = training.adapterPath(record);
  let found: { sha256: string; bytes: number };
  try {
    found = hashFile(path);
  } catch {
    return `The adapter the training job downloaded is missing from ${state.ctx.paths.toStored(path)}.`;
  }
  if (found.sha256 !== listed.sha256 || found.bytes !== listed.bytes) {
    return `The adapter file isn't the one its training job downloaded and checked: its sha256 begins ${found.sha256.slice(0, 12)}, not ${listed.sha256.slice(0, 12)}.`;
  }
  return {
    id: record.id,
    path: state.ctx.paths.toStored(path),
    sha256: listed.sha256,
    standIn: artifacts.standIn || !record.real,
    label: record.label,
  };
}

/** Waits on the run's clock, or until the session is aborted. */
async function pause(state: RunState, ms: number): Promise<void> {
  const signal = AbortSignal.any([state.signal, state.ctx.clock.timeout(ms)]);
  if (signal.aborted) return;
  await new Promise<void>((resolve) => {
    signal.addEventListener('abort', () => resolve(), { once: true });
  });
}

/**
 * One check of the round's training job. A ready job's adapter becomes the round's candidate, on
 * the incumbent harness; a job that failed or was cancelled ends the round as invalid with the
 * job's own reason; one still running is checked again after a wait.
 */
export async function awaitTraining(state: RunState, index: number): Promise<void> {
  state.setPhase('training');
  const training = must(state.ctx.deps.training, 'The training worker');
  const intervention = interventionOfRound(state, index);
  const jobId = must(intervention.trainingJobId, "The round's training job");
  const record = await training.worker.poll(jobId, state.signal);
  if (record.state === 'ready') {
    const adapter = adapterOf(state, record);
    if (typeof adapter === 'string') {
      state.closeRound(index, adapter, undefined, 'invalid');
      return;
    }
    const stored = state.round(index);
    state.saveRound({
      ...stored,
      round: {
        ...stored.round,
        status: 'evaluating',
        candidateVersion: stored.baseVersion,
        candidateAdapter: adapter,
      },
    });
    return;
  }
  if (TERMINAL_TRAINING_STATES.has(record.state)) {
    const why = record.error?.message ?? `The training job was ${record.state}.`;
    state.closeRound(
      index,
      `The training job ended without an adapter: ${why}`,
      undefined,
      'invalid',
    );
    return;
  }
  await pause(state, TRAINING_POLL_MS);
  state.signal.throwIfAborted();
}

/** Asks the worker to stop a round's training job, when it has one still running. */
export async function cancelTraining(state: RunState, index: number): Promise<void> {
  const jobId = state.ctx.store.interventions.get(state.ctx.runId, index)?.trainingJobId;
  const worker = state.ctx.deps.training?.worker;
  if (jobId === undefined || worker === undefined) return;
  const record = worker.get(jobId);
  if (TERMINAL_TRAINING_STATES.has(record.state)) return;
  try {
    await worker.cancel(jobId);
  } catch (error) {
    state.log(
      'warn',
      `The training job ${jobId} couldn't be stopped: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}
