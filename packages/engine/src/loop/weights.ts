import {
  GuardError,
  TERMINAL_TRAINING_STATES,
  type Lesson,
  type TrainedAdapter,
  type TrainingJobRecord,
  type VerifiedEpisode,
} from '@architect/shared';
import { hashFile } from '../training/artifacts';
import { buildTrainingDataset, DatasetError, writeTrainingDataset } from '../training/dataset';
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
  const backend = await training.backend();
  if (backend === null) {
    state.closeRound(index, 'No training backend is set up any more.', undefined, 'invalid');
    return;
  }
  const episodes: VerifiedEpisode[] = [...targeted, ...rehearsal].map((lesson) =>
    must(lesson.episode, `The episode of lesson ${lesson.id}`),
  );
  let dir: string;
  try {
    const dataset = buildTrainingDataset(episodes, {
      destination: backend.real ? 'remote' : 'local',
      leakDetector: await state.ctx.deps.vault.leakDetector(state.run.jobId),
      now: () => new Date(state.ctx.clock.now()),
    });
    dir = training.datasetDir(state.ctx.runId, index);
    writeTrainingDataset(dir, dataset);
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
  let record: TrainingJobRecord;
  try {
    record = await training.worker.submit(
      {
        scope: state.ctx.runId,
        maxComputeUsd: state.job.budget.maxComputeUsd ?? 0,
        backend: backend.kind,
        datasetDir: dir,
        baseModel: training.baseModel,
      },
      state.signal,
    );
  } catch (error) {
    if (!(error instanceof GuardError)) throw error;
    state.closeRound(index, error.message, undefined, 'invalid');
    return;
  }
  const stored = state.round(index);
  state.ctx.store.transaction(() => {
    state.ctx.store.interventions.put({ ...intervention, trainingJobId: record.id });
    state.ctx.store.rounds.update({ ...stored, round: { ...stored.round, status: 'training' } });
  });
  state.announce('intervention', intervention.id, index);
  state.emit({ type: 'round.updated', round: { ...stored.round, status: 'training' } });
  state.log('info', `Round ${index}: training job ${record.id} on ${record.label}.`);
}

/** A ready job's adapter, as the run records it. */
function adapterOf(state: RunState, record: TrainingJobRecord): TrainedAdapter {
  const training = must(state.ctx.deps.training, 'The training worker');
  const artifacts = must(record.artifacts, "The job's artifacts");
  const path = training.adapterPath(record);
  return {
    id: record.id,
    path: state.ctx.paths.toStored(path),
    sha256: hashFile(path).sha256,
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
    const stored = state.round(index);
    state.saveRound({
      ...stored,
      round: {
        ...stored.round,
        status: 'evaluating',
        candidateVersion: stored.baseVersion,
        candidateAdapter: adapterOf(state, record),
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
