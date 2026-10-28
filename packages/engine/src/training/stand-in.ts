import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  TRAINER_OUTPUT_FORMAT,
  TrainerJobSchema,
  TrainerOutputSchema,
  type TrainerOutput,
} from '@architect/shared';
import { z } from 'zod';
import { writeFileAtomic } from '../data/atomic-write';
import { standInLoraSpec, writeGgufFile, type GgufHeader } from '../gguf';
import { checkOutputs, hashFile } from './artifacts';
import type {
  BackendHandle,
  BackendStatus,
  BackendSubmission,
  FetchedArtifacts,
  HardwareFlavor,
  Submitted,
  TrainingBackend,
} from './backend';
import { JOB_FILE } from './recipe';

/** Said in every record, report and screen that shows a stand-in job. */
export const STAND_IN_LABEL = 'Stand-in: no model is trained';

const NO_HARDWARE: HardwareFlavor = {
  id: 'stand-in',
  label: 'no hardware (stand-in)',
  pricePerHourUsd: 0,
  gpuMemoryGb: 0,
};

/** The stand-in has no base model to look up, so its revision says so: all zeros. */
export const STAND_IN_REVISION = '0'.repeat(40);

const StateSchema = z.object({
  jobId: z.string(),
  submittedAt: z.number(),
  cancelled: z.boolean(),
  job: TrainerJobSchema,
});
type State = z.infer<typeof StateSchema>;

export interface StandInOptions {
  /** Where the stand-in keeps its pretend jobs, so they outlive a restart like real ones. */
  stateDir: string;
  /** The base model its adapters are shaped for. */
  baseHeader: () => GgufHeader;
  now?: () => number;
  /** How long a pretend job waits, then runs. Default 0 for both. */
  queueMs?: number;
  runMs?: number;
  /** Every job fails with this message, to test failure handling. */
  failWith?: string;
}

/**
 * A training backend that trains nothing. It follows the same lifecycle as a real one (queued,
 * running, finished, with outputs to download) and hands back a stand-in adapter: shaped for the
 * base model and labeled as a stand-in in its metadata, its manifest and its record. It exists so
 * the worker, the runtime and the screens can be tested; it never counts as training.
 */
export class StandInBackend implements TrainingBackend {
  readonly kind = 'stand-in' as const;
  readonly real = false;
  readonly label = STAND_IN_LABEL;

  constructor(private readonly options: StandInOptions) {}

  private now(): number {
    return this.options.now?.() ?? Date.now();
  }

  private stateFile(jobId: string): string {
    return join(this.options.stateDir, `${jobId}.json`);
  }

  private read(jobId: string): State | null {
    const file = this.stateFile(jobId);
    if (!existsSync(file)) return null;
    return StateSchema.parse(JSON.parse(readFileSync(file, 'utf8')));
  }

  private write(state: State): void {
    mkdirSync(this.options.stateDir, { recursive: true });
    writeFileAtomic(this.stateFile(state.jobId), JSON.stringify(state));
  }

  private stateOf(handle: BackendHandle): State {
    const jobId = typeof handle['jobId'] === 'string' ? handle['jobId'] : '';
    const state = this.read(jobId);
    if (!state) throw new Error(`The stand-in has no job ${jobId}.`);
    return state;
  }

  flavor(): HardwareFlavor {
    return NO_HARDWARE;
  }

  resolveRevision(): Promise<string> {
    return Promise.resolve(STAND_IN_REVISION);
  }

  outputRepo(): Promise<string | null> {
    return Promise.resolve(null);
  }

  submit(submission: BackendSubmission): Promise<Submitted> {
    const jobFile = submission.inputs.find((file) => file.name === JOB_FILE);
    if (!jobFile) throw new Error('The submission has no job.json.');
    const job = TrainerJobSchema.parse(JSON.parse(readFileSync(jobFile.path, 'utf8')));
    this.write({ jobId: submission.jobId, submittedAt: this.now(), cancelled: false, job });
    return Promise.resolve({ handle: { jobId: submission.jobId }, url: null });
  }

  recover(jobId: string): Promise<Submitted | null> {
    return Promise.resolve(this.read(jobId) ? { handle: { jobId }, url: null } : null);
  }

  status(handle: BackendHandle): Promise<BackendStatus> {
    const state = this.stateOf(handle);
    const elapsed = this.now() - state.submittedAt;
    const queueMs = this.options.queueMs ?? 0;
    const runMs = this.options.runMs ?? 0;
    let status: BackendStatus;
    if (state.cancelled) status = { state: 'cancelled' };
    else if (elapsed < queueMs) status = { state: 'queued' };
    else if (elapsed < queueMs + runMs) status = { state: 'running' };
    else if (this.options.failWith) status = { state: 'failed', message: this.options.failWith };
    else status = { state: 'succeeded' };
    return Promise.resolve({ ...status, createdAt: state.submittedAt });
  }

  logs(handle: BackendHandle): Promise<string> {
    const state = this.stateOf(handle);
    return Promise.resolve(
      `[stand-in] Job ${state.jobId}: ${state.job.dataset.example_count} examples received. No model is trained; this backend only exercises the worker.\n`,
    );
  }

  cancel(handle: BackendHandle): Promise<void> {
    this.write({ ...this.stateOf(handle), cancelled: true });
    return Promise.resolve();
  }

  fetchArtifacts(handle: BackendHandle, destDir: string): Promise<FetchedArtifacts> {
    const { job } = this.stateOf(handle);
    mkdirSync(join(destDir, 'peft'), { recursive: true });
    writeGgufFile(
      join(destDir, 'adapter.gguf'),
      standInLoraSpec(this.options.baseHeader(), {
        modules: ['attn_q'],
        rank: job.lora.r,
        alpha: job.lora.alpha,
        effect: 'none',
      }),
    );
    writeFileSync(
      join(destDir, 'peft', 'adapter_config.json'),
      `${JSON.stringify({ stand_in: true, note: STAND_IN_LABEL, r: job.lora.r, lora_alpha: job.lora.alpha }, null, 2)}\n`,
    );
    // A safetensors file with no tensors: an eight-byte header length, then the header.
    const header = Buffer.from(JSON.stringify({ __metadata__: { stand_in: 'true' } }));
    const length = Buffer.alloc(8);
    length.writeBigUInt64LE(BigInt(header.length));
    writeFileSync(
      join(destDir, 'peft', 'adapter_model.safetensors'),
      Buffer.concat([length, header]),
    );

    const listed = [
      { path: 'peft/adapter_config.json', kind: 'peft_config' as const },
      { path: 'peft/adapter_model.safetensors', kind: 'peft_weights' as const },
      { path: 'adapter.gguf', kind: 'gguf_lora' as const },
    ].map((file) => ({ ...file, ...hashFile(join(destDir, ...file.path.split('/'))) }));
    const manifest: TrainerOutput = TrainerOutputSchema.parse({
      format: TRAINER_OUTPUT_FORMAT,
      job_id: job.job_id,
      stand_in: true,
      base_model: job.base_model,
      dataset: {
        sha256: job.dataset.sha256,
        example_count: job.dataset.example_count,
        trained_examples: 0,
        trained_tokens: 0,
        skipped: [],
      },
      recipe: job.recipe,
      lora: { r: job.lora.r, alpha: job.lora.alpha, target_modules: job.lora.target_modules },
      converter: { commit: job.converter.commit, outtype: job.converter.outtype },
      versions: { 'stand-in': '1' },
      metrics: {
        steps: 0,
        loss_first: null,
        loss_last: null,
        train_seconds: 0,
        convert_seconds: 0,
        stopped_early: false,
      },
      files: listed,
    });
    writeFileAtomic(join(destDir, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
    return Promise.resolve({ revision: null, manifest, files: checkOutputs(manifest, destDir) });
  }
}
