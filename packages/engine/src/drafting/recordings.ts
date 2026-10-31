import { createHash } from 'node:crypto';
import { mkdir, readdir, readFile, stat, writeFile } from 'node:fs/promises';
import { basename, extname, join } from 'node:path';
import {
  GuardError,
  MUSE_VOICE_TRANSCRIBE,
  RecordingsRecordSchema,
  type Job,
  type Organization,
  type RecordingQuote,
  type RecordingsRecord,
  type RecordingsView,
  type TaskPlan,
  type TranscribeRequest,
  type Transcript,
  type Transcription,
} from '@architect/shared';
import { formatUsd } from '../loop/budget';
import type { Clock, LoopDeps } from '../loop/deps';
import { readJsonFile, writeJsonFile } from '../loop/files';
import type { JobLibrary } from '../loop/jobs';
import type { DataPaths } from '../loop/paths';
import { connectTranscriber } from '../loop/setup';
import { isoNow } from '../loop/time';
import { trainOrganizations } from './study';
import { piecesOf, readWav, secondsOf, type Piece } from './wav';

/*
 * A taught organization's recordings, read by the study (decision 087). Muse Voice Transcribe
 * turns each into text, kept as a text file of that organization beside its other files, which
 * the study then reads and quotes like any other. Recordings go to Meta only when the job's
 * data-sharing setting allows it and the person agreed for these files, never past the cap,
 * and never for an organization kept for the final test, whose files the teacher never reads.
 */

/** The most one batch of recordings may cost to transcribe, in dollars, as a study may. */
export const RECORDINGS_CAP_USD = 1;

/**
 * The longest recording Architect transcribes. The study reads a text file of at most 30,000
 * characters whole, which is about half an hour of speech.
 */
export const MAX_RECORDING_SECONDS = 30 * 60;

/** The largest recording file read: half an hour of 48 kHz stereo 24-bit audio fits. */
const MAX_FILE_BYTES = 1024 * 1024 * 1024;

/** What a recording that isn't WAV takes before it can be added. */
const EXPORT_HINT =
  'Architect reads WAV recordings. Export its audio as a WAV file (a recorder, an audio editor or a video editor can), then add that.';

/** Dollars for whole seconds of audio, at Muse Voice Transcribe's hourly price. */
export function transcriptionUsd(seconds: number): number {
  return (seconds * MUSE_VOICE_TRANSCRIBE.usdPerHour) / 3600;
}

/** What transcribing left beside a job: none before anything was transcribed. */
export async function recordingsRecord(paths: DataPaths, jobId: string): Promise<RecordingsRecord> {
  try {
    return RecordingsRecordSchema.parse(await readJsonFile(paths.recordingsFile(jobId)));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { format: 1, transcripts: [] };
    throw error;
  }
}

/** A field job's recordings as the Define screen shows them. */
export async function recordingsView(job: Job, paths: DataPaths): Promise<RecordingsView> {
  const taught = new Set(trainOrganizations(job).map((org) => org.id));
  const { transcripts } = await recordingsRecord(paths, job.id);
  return {
    allowed: job.sharing?.recordings === true,
    capUsd: RECORDINGS_CAP_USD,
    transcripts: transcripts.filter((transcript) => taught.has(transcript.org)),
  };
}

/** A recording read and made ready to send. */
interface Prepared {
  path: string;
  name: string;
  sha256: string;
  pieces: Piece[];
  seconds: number;
  done: boolean;
}

/** A transcript's file name: the recording's, made plain, unlike any file the folder has. */
function transcriptName(source: string, taken: ReadonlySet<string>): string {
  const stem =
    basename(source, extname(source))
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'recording';
  for (let n = 1; ; n += 1) {
    const name = `${stem}${n === 1 ? '' : `-${n}`}.transcript.txt`;
    if (!taken.has(name)) return name;
  }
}

/** A clock time in a recording, as m:ss. */
function clockTime(seconds: number): string {
  const whole = Math.floor(seconds);
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, '0')}`;
}

/** A transcript as the study reads it: who said what, turn by turn. */
function transcriptText(source: string, parts: { start: number; text: Transcription }[]): string {
  const lines = [`Transcript of the recording ${source}.`, ''];
  if (parts.every((part) => part.text.turns.length === 0)) lines.push('(No speech was heard.)');
  for (const part of parts) {
    if (parts.length > 1) lines.push(`[from ${clockTime(part.start)}]`, '');
    for (const turn of part.text.turns) {
      lines.push(turn.speaker === undefined ? turn.text : `${turn.speaker}: ${turn.text}`, '');
    }
  }
  return `${lines.join('\n').trimEnd()}\n`;
}

export interface RecordingsOptions {
  jobs: JobLibrary;
  paths: DataPaths;
  deps: Pick<LoopDeps, 'adapters' | 'secrets' | 'vault'>;
  clock: Clock;
  /** Dollars one batch may cost, at most. */
  capUsd?: number;
}

/** Transcribing a field job's recordings into its taught organizations' material. */
export class JobRecordings {
  private readonly busy = new Set<string>();

  constructor(private readonly options: RecordingsOptions) {}

  private get cap(): number {
    return this.options.capUsd ?? RECORDINGS_CAP_USD;
  }

  /**
   * The taught organization a recording may be added to. One kept for the final test is refused
   * before any file is read: its material never reaches the teacher, so it is never studied and
   * its recordings have nothing to be transcribed for (invariant 1).
   */
  private async taughtOrg(job: Job, orgId: string): Promise<Organization> {
    const sealed = await this.options.deps.vault.transferIdentifiers(job.id);
    const isSealed =
      sealed.some((org) => org.id === orgId) ||
      (job.organizations ?? []).some((org) => org.id === orgId && org.role === 'transfer');
    if (isSealed) {
      throw new GuardError(
        'split',
        "This organization is kept for the final test, so the teacher never reads its material. Its recordings aren't transcribed; add recordings to an organization Architect is taught on.",
      );
    }
    const org = trainOrganizations(job).find((item) => item.id === orgId);
    if (org === undefined)
      throw new Error(`"${orgId}" isn't an organization this job is taught on.`);
    return org;
  }

  private async prepare(
    job: Job,
    org: Organization,
    paths: readonly string[],
  ): Promise<Prepared[]> {
    const { transcripts } = await recordingsRecord(this.options.paths, job.id);
    const done = new Set(
      transcripts.filter((item) => item.org === org.id).map((item) => item.sourceSha256),
    );
    const prepared: Prepared[] = [];
    for (const path of paths) {
      const name = basename(path);
      if (extname(name).toLowerCase() !== '.wav') {
        throw new Error(`${name} isn't a WAV file. ${EXPORT_HINT}`);
      }
      const size = (await stat(path)).size;
      if (size > MAX_FILE_BYTES) {
        throw new Error(`${name} is larger than the 1 GB Architect reads from one recording.`);
      }
      const bytes = await readFile(path);
      const audio = readWav(bytes, name);
      const length = secondsOf(audio);
      if (length > MAX_RECORDING_SECONDS) {
        throw new Error(
          `${name} lasts ${clockTime(length)}, longer than the ${MAX_RECORDING_SECONDS / 60} minutes Architect transcribes from one recording, since the study reads a transcript whole. Cut out the part the job needs and add that.`,
        );
      }
      const sha256 = createHash('sha256').update(bytes).digest('hex');
      if (prepared.some((item) => item.sha256 === sha256)) continue;
      const pieces = piecesOf(audio);
      prepared.push({
        path,
        name,
        sha256,
        pieces,
        seconds: pieces.reduce((sum, piece) => sum + piece.billedSeconds, 0),
        done: done.has(sha256),
      });
    }
    return prepared;
  }

  private quoteOf(org: Organization, prepared: readonly Prepared[]): RecordingQuote {
    const files = prepared.map((item) => ({
      path: item.path,
      name: item.name,
      seconds: item.seconds,
      usd: item.done ? 0 : transcriptionUsd(item.seconds),
      done: item.done,
    }));
    const due = files.filter((file) => !file.done);
    const seconds = due.reduce((sum, file) => sum + file.seconds, 0);
    return { org: org.id, files, seconds, usd: transcriptionUsd(seconds), capUsd: this.cap };
  }

  /** What transcribing these recordings would cost, with nothing sent. */
  async quote(jobId: string, orgId: string, paths: readonly string[]): Promise<RecordingQuote> {
    const job = await this.options.jobs.get(jobId);
    const org = await this.taughtOrg(job, orgId);
    return this.quoteOf(org, await this.prepare(job, org, paths));
  }

  /** Lets the job's recordings go to Meta to be transcribed, or keeps them here again. */
  async share(jobId: string, allowed: boolean): Promise<TaskPlan> {
    const { jobs } = this.options;
    const job = await jobs.get(jobId);
    if ((job.sharing?.recordings === true) !== allowed) {
      await jobs.save({
        ...job,
        sharing: {
          remoteTraining: job.sharing?.remoteTraining === true,
          corrections: job.sharing?.corrections === true,
          recordings: allowed,
        },
      });
    }
    return jobs.taskPlan(jobId);
  }

  /**
   * Transcribes the recordings into the organization's files: one text file each, named after
   * it, kept with the hash of the recording so it is never sent twice. The quote is held to the
   * cap before anything is sent, and each request to it again before it is sent.
   */
  async transcribe(jobId: string, request: TranscribeRequest): Promise<TaskPlan> {
    const { jobs, paths, deps, clock } = this.options;
    const job = await jobs.get(jobId);
    const org = await this.taughtOrg(job, request.org);
    if (job.sharing?.recordings !== true) {
      throw new GuardError(
        'permission',
        `${job.name} keeps its recordings on this computer. Allow sending recordings to Meta for transcription first.`,
      );
    }
    if (!request.consent) {
      throw new GuardError(
        'permission',
        'Nothing was sent: recordings go to Meta to be transcribed only once you agree to it.',
      );
    }
    if (this.busy.has(jobId))
      throw new Error('Recordings for this job are already being transcribed.');
    this.busy.add(jobId);
    try {
      const prepared = await this.prepare(job, org, request.paths);
      const quote = this.quoteOf(org, prepared);
      if (quote.usd > this.cap + 1e-9) {
        throw new GuardError(
          'budget',
          `Transcribing these recordings would cost ${formatUsd(quote.usd)}, more than the ${formatUsd(this.cap)} one batch may cost. Add fewer at a time.`,
        );
      }
      const due = prepared.filter((item) => !item.done);
      if (due.length === 0) return await jobs.taskPlan(jobId);
      const transcriber = await connectTranscriber(deps);
      const dir = paths.orgDataDir(jobId, org.id);
      await mkdir(dir, { recursive: true });
      let spent = 0;
      for (const item of due) {
        const parts: { start: number; text: Transcription }[] = [];
        let seconds = 0;
        for (const piece of item.pieces) {
          const next = transcriptionUsd(piece.billedSeconds);
          if (spent + next > this.cap + 1e-9) {
            throw new GuardError(
              'budget',
              `Transcribing may cost at most ${formatUsd(this.cap)}, and ${formatUsd(spent)} is spent. ${item.name} wasn't kept.`,
            );
          }
          const text = await transcriber.transcribe(piece.wav);
          const billed = Math.floor(text.durationMs / 1000);
          seconds += billed;
          spent += transcriptionUsd(billed);
          parts.push({ start: piece.startSeconds, text });
        }
        const record = await recordingsRecord(paths, jobId);
        const taken = new Set([
          ...record.transcripts.filter((entry) => entry.org === org.id).map((entry) => entry.file),
          ...(await readdir(dir)),
        ]);
        const file = transcriptName(item.name, taken);
        await writeFile(join(dir, file), transcriptText(item.name, parts), 'utf8');
        const transcript: Transcript = {
          org: org.id,
          source: item.name,
          sourceSha256: item.sha256,
          file,
          seconds,
          usd: transcriptionUsd(seconds),
          model: transcriber.model,
          createdAt: isoNow(clock),
        };
        await writeJsonFile(paths.recordingsFile(jobId), {
          format: 1,
          transcripts: [...record.transcripts, transcript],
        } satisfies RecordingsRecord);
      }
      return await jobs.taskPlan(jobId);
    } finally {
      this.busy.delete(jobId);
    }
  }
}
