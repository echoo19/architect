import type { Job } from '@architect/shared';

/** Where the trained agent is able to save a change. */
export interface Changeable {
  /** The data files the job lets it write. */
  files: string[];
  /** Whether the job gives it an output folder to make files in. */
  folder: boolean;
}

/**
 * What the trained agent can change, or null when it can change nothing. A data file the job lets
 * it write and its output folder are the only places its write tools reach, so they are the only
 * places the saving setting (`permissions.writes`, which becomes the agent's own "Saving files"
 * setting) can matter. A job with neither has nothing to ask first about, so a choice about it
 * would be a choice about something that cannot happen.
 */
export function changeableOf(job: Job): Changeable | null {
  const files = job.data.files.filter((file) => file.access === 'write').map((file) => file.name);
  const folder = job.data.output !== undefined;
  return files.length === 0 && !folder ? null : { files, folder };
}
