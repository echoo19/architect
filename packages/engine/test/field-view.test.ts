import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FieldViewSchema, type Job } from '@architect/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildFieldExport, exportField, fieldSource } from '../src/field/export';
import { fieldView } from '../src/field/view';
import { DataPaths } from '../src/loop/paths';
import { openEngineStore, type EngineStore } from '../src/store/engine-store';
import { importJobInto } from './support/field';

/*
 * The field's page (decision 075) on the Academy desk's job as it ships: three academies it trains on
 * and one sealed. The page gets each train academy's files with their rows, and the sealed one
 * by name, kind and file count only; the assets are the export's own manifest, built with
 * nothing written.
 */

let root: string;
let paths: DataPaths;
let store: EngineStore;
let job: Job;

beforeAll(async () => {
  root = mkdtempSync(join(tmpdir(), 'architect-field-view-'));
  const dataDir = join(root, 'data');
  job = await importJobInto(dataDir);
  paths = new DataPaths(dataDir);
  store = openEngineStore(paths.database);
});

afterAll(() => {
  store.close();
  rmSync(root, { recursive: true, force: true });
});

describe("a field's view", () => {
  it('lists the train academies with their files and the sealed one by name and count only', () => {
    const view = FieldViewSchema.parse(fieldView(job, paths));
    expect(view.organizations.map((org) => org.id)).toEqual([
      'copperfield',
      'thistlewood',
      'bramble',
    ]);
    const copperfield = view.organizations[0]!;
    const students = copperfield.files.find((file) => file.name === 'students.csv');
    const lines = readFileSync(
      join(paths.jobDir(job.id), 'orgs', 'copperfield', 'data', 'students.csv'),
      'utf8',
    )
      .split('\n')
      .filter((line) => line.trim() !== '');
    expect(students?.rows).toBe(lines.length - 1);
    expect(copperfield.files.find((file) => file.name === 'policy.md')?.rows).toBeNull();

    expect(view.sealed).toEqual([
      { name: 'Juniper Study House', synthetic: true, files: expect.any(Number) },
    ]);
    expect(view.sealed[0]!.files).toBeGreaterThan(0);
    expect(JSON.stringify(view.sealed)).not.toContain('juniper');
    expect(view.lockedTestTasks).toBeGreaterThan(0);
  });

  it('shows a job without organizations as its one data folder', () => {
    const single = { ...job, organizations: undefined };
    const view = fieldView(single, paths);
    expect(view.organizations).toEqual([{ id: null, name: null, synthetic: null, files: [] }]);
  });
});

describe("a field's assets", () => {
  it('counts what an export would hold and writes nothing', async () => {
    const source = await fieldSource(store, paths, job.id);
    const before = readdirSync(root).sort();
    const { manifest } = buildFieldExport(source);
    expect(readdirSync(root).sort()).toEqual(before);
    expect(manifest.counts.train_organizations).toBe(3);
    expect(manifest.counts.sealed_organizations).toBe(1);
    expect(manifest.counts.demonstrations).toBe(0);

    const out = join(mkdtempSync(join(root, 'out-')), 'export');
    const written = exportField(source, out);
    expect(written.counts).toEqual(manifest.counts);
    expect(written.files).toEqual(manifest.files);
  });
});
