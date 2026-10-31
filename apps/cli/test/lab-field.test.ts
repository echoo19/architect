import { cpSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { importJobInto, ACADEMY_JOB_FILE } from '@architect/engine/testing';
import { FieldListSchema, FieldStatusSchema } from '@architect/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { cleanUp, cli, tempDir, testEnv } from './support';

/*
 * `architect field list | status | add-org` (decision 090) on the Academy desk's field: the
 * same engine calls the Fields place makes, with no model behind them.
 */

let env: NodeJS.ProcessEnv;
let folder: string;

beforeAll(async () => {
  env = await testEnv();
  await importJobInto(env['ARCHITECT_USER_DATA'] ?? '');
  folder = await tempDir('new-org');
}, 60_000);

afterAll(cleanUp);

/**
 * A folder a field accepts as a new organization: Bramble Hill's files, its tasks as Maple's,
 * each asked in words and a family of its own, since a copy of a task the teacher sees is
 * refused (decision 089).
 */
function mapleFolder(dir: string): string {
  const jobDir = join(ACADEMY_JOB_FILE, '..');
  const target = join(dir, 'maple');
  mkdirSync(target, { recursive: true });
  cpSync(join(jobDir, 'orgs', 'bramble', 'data'), target, { recursive: true });
  const tasks = readFileSync(join(jobDir, 'tasks.jsonl'), 'utf8')
    .split('\n')
    .filter((text) => text !== '')
    .map((text) => JSON.parse(text) as { id: string; org: string; family: string; prompt: string })
    .filter((task) => task.org === 'bramble')
    .map(({ org: _org, ...task }) => ({
      ...task,
      id: task.id.replace('bramble', 'maple'),
      family: `maple-${task.family}`,
      prompt: `At Maple Grove: ${task.prompt}`,
    }));
  writeFileSync(join(target, 'tasks.jsonl'), tasks.map((task) => JSON.stringify(task)).join('\n'));
  return target;
}

describe('architect field list', () => {
  it('lists the fields with what they are made of, as JSON the shared schema reads', async () => {
    const run = await cli(['field', 'list', '--json'], { env });
    expect(run.code, run.stderr).toBe(0);
    const list = FieldListSchema.parse(JSON.parse(run.stdout));
    const desk = list.fields.find((item) => item.name === 'Academy desk');
    expect(desk).toMatchObject({
      organizations: { taughtOn: 3, neverSeen: 1, real: 0 },
      versions: 0,
      best: null,
      certificates: 0,
    });
  });

  it('prints a table of them', async () => {
    const run = await cli(['field', 'list'], { env });
    expect(run.code, run.stderr).toBe(0);
    expect(run.stdout).toContain('TAUGHT ON');
    expect(run.stdout).toContain('Academy desk');
  });
});

describe('architect field status', () => {
  it('shows the organizations taught on and never seen, by id or by name', async () => {
    const byName = await cli(['field', 'status', 'Academy desk', '--json'], { env });
    expect(byName.code, byName.stderr).toBe(0);
    const status = FieldStatusSchema.parse(JSON.parse(byName.stdout));
    expect(status.field.organizations.map((org) => org.name)).toHaveLength(3);
    expect(status.field.sealed).toEqual([
      expect.objectContaining({ name: 'Juniper Study House', synthetic: true }),
    ]);
    const byId = await cli(['field', 'status', status.jobId], { env });
    expect(byId.code, byId.stderr).toBe(0);
    expect(byId.stdout).toContain('Never seen:');
    expect(byId.stdout).toContain('Juniper Study House');
  });

  it('says when the field is not there, with exit 2', async () => {
    const run = await cli(['field', 'status', 'nowhere'], { env });
    expect(run.code).toBe(2);
    expect(run.stderr).toContain('There is no field called nowhere here.');
    expect((await cli(['field', 'status'], { env })).code).toBe(2);
  });
});

describe('architect field add-org', () => {
  it('needs a folder, a name and --never-seen', async () => {
    const base = ['field', 'add-org', 'Academy desk'];
    expect((await cli([...base, '--name', 'Maple', '--never-seen'], { env })).code).toBe(2);
    expect((await cli([...base, '--folder', folder, '--never-seen'], { env })).code).toBe(2);
    const unsealed = await cli([...base, '--folder', folder, '--name', 'Maple'], { env });
    expect(unsealed.code).toBe(2);
    expect(unsealed.stderr).toContain('--never-seen');
  });

  it("refuses what the app refuses: no folder, a folder without the field's files, a name in use", async () => {
    const base = ['field', 'add-org', 'Academy desk', '--never-seen'];
    const missing = await cli([...base, '--folder', join(folder, 'nope'), '--name', 'Maple'], {
      env,
    });
    expect(missing.code).toBe(2);
    expect(missing.stderr).toContain("isn't a folder");
    const empty = await cli([...base, '--folder', folder, '--name', 'Maple'], { env });
    expect(empty.code).toBe(2);
    expect(empty.stderr).toContain("doesn't hold what");
    const used = await cli([...base, '--folder', folder, '--name', 'Juniper Study House'], {
      env,
    });
    expect(used.code).toBe(2);
    expect(used.stderr).toContain('already has an organization');
  });

  it('adds a never-seen organization to the final test', async () => {
    const run = await cli(
      [
        'field',
        'add-org',
        'Academy desk',
        '--folder',
        mapleFolder(folder),
        '--name',
        'Maple Grove',
        '--never-seen',
        '--generated',
        '--json',
      ],
      { env },
    );
    expect(run.code, run.stderr).toBe(0);
    const status = FieldStatusSchema.parse(JSON.parse(run.stdout));
    expect(status.organizations).toMatchObject({ taughtOn: 3, neverSeen: 2 });
    expect(status.field.sealed).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: 'Maple Grove', synthetic: true, addedLater: true }),
      ]),
    );
    const again = await cli(
      [
        'field',
        'add-org',
        'Academy desk',
        '--folder',
        mapleFolder(folder),
        '--name',
        'Maple Grove',
        '--never-seen',
      ],
      { env },
    );
    expect(again.code).toBe(2);
  }, 60_000);
});
