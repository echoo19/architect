import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { JsonValueSchema, type DataFile, type MentorView } from '@architect/shared';
import Papa from 'papaparse';
import { z } from 'zod';
import { clip } from './trace';

export type MentorDataFile = MentorView['job']['dataFiles'][number];

const SAMPLE_ROWS = 3;
/** Text files such as the policy are shown in full; this only stops a runaway file. */
const TEXT_MAX = 60_000;

const JsonRowSchema = z.record(z.string(), JsonValueSchema);

/** What the mentor sees of the job's data: each table's shape and a few rows, and every text file. */
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
