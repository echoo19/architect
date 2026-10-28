import type { TrainingJobRecord } from '@architect/shared';
import { formatUsd } from '../loop/budget';

/**
 * Whether a job counts as real training (acceptance test A01): a real backend, outputs
 * downloaded and checked, and an adapter that doesn't carry the stand-in label. A stand-in job
 * never does, whatever else its record says.
 */
export function countsAsRealTraining(record: TrainingJobRecord): boolean {
  return (
    record.real &&
    record.backend !== 'stand-in' &&
    record.state === 'ready' &&
    record.artifacts !== null &&
    !record.artifacts.standIn
  );
}

const STATE_WORDS: Record<TrainingJobRecord['state'], string> = {
  submitting: 'Sending',
  queued: 'Waiting for hardware',
  running: 'Training',
  cancelling: 'Stopping',
  succeeded: 'Downloading the adapter',
  ready: 'Adapter ready',
  failed: 'Failed',
  cancelled: 'Cancelled',
};

/**
 * One line a screen or report can show for a job: its state, its compute and what it cost. A
 * stand-in job always says it is a stand-in, so its adapter is never taken for a trained one.
 */
export function describeTrainingJob(record: TrainingJobRecord): string {
  const state = STATE_WORDS[record.state];
  if (record.backend === 'stand-in' || !record.real) {
    return `${state}. Stand-in: no model is trained, and its adapter changes nothing.`;
  }
  const minutes = Math.round(record.compute.seconds / 60);
  const parts = [
    `${state} on ${record.label}`,
    `${record.dataset.exampleCount} examples`,
    `${minutes} min on ${record.compute.flavor}, ${formatUsd(record.compute.usd)} of ${formatUsd(record.compute.authorizedUsd)} allowed`,
  ];
  if (record.error) parts.push(record.error.message);
  return `${parts.join('. ')}.`;
}
