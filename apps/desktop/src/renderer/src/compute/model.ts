import {
  GPU_TYPES,
  type ModelConfigRead,
  type TrainingPlanRequest,
  type TrainMethod,
  type TrainPrecision,
} from '@architect/shared';

/** The settings a plan is sized with, beside the config it sizes; the CLI's defaults. */
export interface PlanSettings {
  method: TrainMethod;
  precision: TrainPrecision;
  /** A key of GPU_TYPES. */
  gpu: string;
  gpusPerNode: number;
  seqLen: number;
  microBatch: number;
  loraRank: number;
}

export const DEFAULT_SETTINGS: PlanSettings = {
  method: 'lora',
  precision: 'bf16',
  gpu: 'h100-80gb',
  gpusPerNode: 8,
  seqLen: 4096,
  microBatch: 1,
  loraRank: 16,
};

/** Each GPU type as it is sold. */
const GPU_NAMES: Readonly<Record<string, string>> = {
  'h100-80gb': 'H100 80GB',
  h200: 'H200 141GB',
  'a100-80gb': 'A100 80GB',
  'a100-40gb': 'A100 40GB',
  l40s: 'L40S 48GB',
  b200: 'B200 180GB',
};

export const GPU_OPTIONS = Object.keys(GPU_TYPES).map((key) => ({
  value: key,
  label: GPU_NAMES[key] ?? key,
}));

export function planRequest(read: ModelConfigRead, settings: PlanSettings): TrainingPlanRequest {
  const { gpu, ...rest } = settings;
  return {
    ...read,
    ...rest,
    gpu: { name: GPU_NAMES[gpu] ?? gpu, memoryGb: GPU_TYPES[gpu] ?? 80 },
  };
}

/** Bytes in GB (10^9), as the engine's plans write them: 61.2 GB, 4.85 GB. */
export function gbText(bytes: number): string {
  const gb = bytes / 1e9;
  return `${gb.toFixed(gb >= 10 ? 1 : 2)} GB`;
}

/** A number of parameters as people read it: 235.1B, 72.4M. */
export function paramsText(count: number): string {
  if (count >= 1e9) return `${(count / 1e9).toFixed(1)}B`;
  if (count >= 1e6) return `${(count / 1e6).toFixed(1)}M`;
  if (count >= 1e3) return `${(count / 1e3).toFixed(1)}K`;
  return String(count);
}

/** Why a bundle can't be written yet, or null when it can. */
export function bundleBlocker(
  read: ModelConfigRead | null,
  fits: boolean,
  folders: { exportDir: string | null; parentDir: string | null },
): string | null {
  if (read === null) return 'Plan a model first.';
  if (read.model.repo === null) return 'A bundle needs a model on Hugging Face, read at a commit.';
  if (!fits) return "The plan doesn't fit.";
  if (folders.exportDir === null) return 'Choose a field export.';
  if (folders.parentDir === null) return 'Choose where to write it.';
  return null;
}
