import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  JsonValueSchema,
  trainOrganizations,
  type DataFile,
  type Job,
  type MentorView,
} from '@architect/shared';
import Papa from 'papaparse';
import { z } from 'zod';
import { orgDataDir } from '../loop/organizations';
import { clip } from './trace';

export type MentorDataFile = MentorView['job']['dataFiles'][number];

const SAMPLE_ROWS = 3;
/** Text files such as the policy are shown in full; this only stops a runaway file. */
const TEXT_MAX = 60_000;

const JsonRowSchema = z.record(z.string(), JsonValueSchema);

/**
 * What the mentor sees of the job's data: each table's shape and a few rows, and every text file,
 * each by its name in the job (the student sees it as `data/<name>`).
 */
export async function describeDataFiles(
  files: readonly DataFile[],
  dataDir: string,
): Promise<MentorDataFile[]> {
  return Promise.all(
    files.map(async (file): Promise<MentorDataFile> => {
      const content = await readFile(join(dataDir, file.name), 'utf8');
      const base = { name: file.name, kind: file.kind, access: file.access };
      if (file.kind === 'text') return { ...base, text: clip(content, TEXT_MAX) };
      const table = Papa.parse<Record<string, unknown>>(content, {
        header: true,
        skipEmptyLines: true,
        dynamicTyping: true,
      });
      return {
        ...base,
        columns: table.meta.fields ?? [],
        rowCount: table.data.length,
        sampleRows: table.data
          .slice(0, SAMPLE_ROWS)
          .map((row) => JsonRowSchema.parse(JSON.parse(JSON.stringify(row)))),
      };
    }),
  );
}

/**
 * What the mentor sees of a job's data: its `data/`, or each organization's files that the job
 * trains on, each marked with its organization. A sealed organization's files are not in the job
 * folder, so they can't be shown.
 */
export async function describeJobData(
  job: Job,
  jobDir: string,
  dataDir: string,
): Promise<MentorDataFile[]> {
  const orgs = trainOrganizations(job);
  if (orgs.length === 0) return describeDataFiles(job.data.files, dataDir);
  const each = await Promise.all(
    orgs.map(async (org) =>
      (await describeDataFiles(job.data.files, orgDataDir(jobDir, org.id))).map((file) => ({
        ...file,
        org: org.id,
      })),
    ),
  );
  return each.flat();
}

/**
 * The whole text of each data file of every organization the job trains on, by organization,
 * for the runner's check that a change set holds no one organization's facts. None for a job
 * without organizations.
 */
export async function organizationTexts(
  job: Job,
  jobDir: string,
): Promise<{ org: string; text: string }[]> {
  return Promise.all(
    trainOrganizations(job).map(async (org) => ({
      org: org.id,
      text: (
        await Promise.all(
          job.data.files.map((file) =>
            readFile(join(orgDataDir(jobDir, org.id), file.name), 'utf8'),
          ),
        )
      ).join('\n'),
    })),
  );
}
