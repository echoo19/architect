import { existsSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { trainOrganizations, type FieldFile, type FieldView, type Job } from '@architect/shared';
import { parseCsv } from '../data/csv';
import { orgDataDir } from '../loop/organizations';
import type { DataPaths } from '../loop/paths';
import { Vault } from '../vault/vault';

/** Rows under a table's header, read as every attempt reads it. */
function tableRows(name: string, path: string): number {
  return parseCsv(name, readFileSync(path, 'utf8')).rows.length;
}

/** The job's declared files present in one folder, each with its size and, for a table, rows. */
function filesIn(job: Job, folder: string): FieldFile[] {
  return job.data.files.flatMap((file) => {
    const path = join(folder, file.name);
    if (!existsSync(path)) return [];
    return [
      {
        name: file.name,
        bytes: statSync(path).size,
        rows: file.name.toLowerCase().endsWith('.csv') ? tableRows(file.name, path) : null,
      },
    ];
  });
}

/**
 * What a field is made of, for the person's own page (decision 075): each organization the job
 * trains on with its files, and each sealed one by name and kind with how many files it holds.
 * The vault says only that much of a sealed organization; this view goes to the app, never to a
 * mentor.
 */
export function fieldView(job: Job, paths: DataPaths): FieldView {
  const jobDir = paths.jobDir(job.id);
  const vault = new Vault(paths.root);
  const orgs = trainOrganizations(job);
  return {
    jobId: job.id,
    organizations:
      orgs.length === 0
        ? [{ id: null, name: null, synthetic: null, files: filesIn(job, paths.dataDir(job.id)) }]
        : orgs.map((org) => ({
            id: org.id,
            name: org.name,
            synthetic: org.synthetic,
            files: filesIn(job, orgDataDir(jobDir, org.id)),
          })),
    sealed: vault.sealedOrganizations(job.id),
    lockedTestTasks: vault.isSealed(job.id) ? vault.count(job.id) : null,
  };
}
