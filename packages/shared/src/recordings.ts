import { z } from 'zod';

/*
 * An organization's recordings, such as support calls, staff meetings or lesson walkthroughs,
 * read by the study as text (decision 087). Muse Voice Transcribe turns each into a transcript,
 * which is kept as a text file of that organization and quoted like any other file.
 */

/** One recording's transcript, kept as a text file in the organization's `data/` folder. */
export const TranscriptSchema = z.object({
  /** The organization the recording belongs to: always one the job is taught on. */
  org: z.string().min(1),
  /** The recording's file name, as the person added it. */
  source: z.string().min(1),
  /** The hash of the recording's bytes, so the same recording is never transcribed twice. */
  sourceSha256: z.string().regex(/^[0-9a-f]{64}$/),
  /** The transcript's file name in the organization's `data/` folder. */
  file: z.string().min(1),
  /** The audio billed, in whole seconds. */
  seconds: z.number().int().min(0),
  usd: z.number().min(0),
  model: z.string().min(1),
  createdAt: z.iso.datetime(),
});
export type Transcript = z.infer<typeof TranscriptSchema>;

/** What transcribing left beside the job (`recordings.json`). */
export const RecordingsRecordSchema = z.object({
  format: z.literal(1),
  transcripts: z.array(TranscriptSchema),
});
export type RecordingsRecord = z.infer<typeof RecordingsRecordSchema>;

/** What transcribing some recordings would cost, shown before anything is sent. */
export const RecordingQuoteSchema = z.object({
  org: z.string().min(1),
  files: z.array(
    z.object({
      path: z.string().min(1),
      name: z.string().min(1),
      seconds: z.number().int().min(0),
      usd: z.number().min(0),
      /** Transcribed before: it is not sent again and costs nothing. */
      done: z.boolean(),
    }),
  ),
  seconds: z.number().int().min(0),
  usd: z.number().min(0),
  /** The most one batch may cost. */
  capUsd: z.number().positive(),
});
export type RecordingQuote = z.infer<typeof RecordingQuoteSchema>;

/** Transcribing these recordings for this organization, once the person has read the quote. */
export const TranscribeRequestSchema = z.object({
  org: z.string().min(1),
  paths: z.array(z.string().min(1)).min(1).max(20),
  /** The person agreed, for these files, that they go to Meta to be transcribed. */
  consent: z.boolean(),
});
export type TranscribeRequest = z.infer<typeof TranscribeRequestSchema>;

/** A field job's recordings as the Define screen shows them. */
export const RecordingsViewSchema = z.object({
  /** The job's data-sharing setting lets recordings go to Meta to be transcribed. */
  allowed: z.boolean(),
  capUsd: z.number().positive(),
  transcripts: z.array(TranscriptSchema),
});
export type RecordingsView = z.infer<typeof RecordingsViewSchema>;
