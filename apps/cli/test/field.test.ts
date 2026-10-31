import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { importJobInto } from '@architect/engine/testing';
import { FieldExportManifestSchema, type Task } from '@architect/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { CLI_BIN, cleanUp, cli, tempDir, testEnv } from './support';

/** A Python 3 on this computer, or null: the client's test runs only where there is one. */
function findPython(): string | null {
  for (const name of ['python3', 'python']) {
    const probe = spawnSync(name, ['--version'], { encoding: 'utf8', windowsHide: true });
    if (probe.status === 0 && /Python 3/.test(`${probe.stdout}${probe.stderr}`)) return name;
  }
  return null;
}
const PYTHON = findPython();

let env: NodeJS.ProcessEnv;
let out: string;
let task: Task;
let answer: string;

beforeAll(async () => {
  env = await testEnv();
  await importJobInto(env['ARCHITECT_USER_DATA'] ?? '');
  out = join(await tempDir('field'), 'academy-desk');
  const exported = await cli(['field', 'export', 'Academy desk', '--out', out], { env });
  expect(exported.code, exported.stderr).toBe(0);
  task = readFileSync(join(out, 'env', 'tasks.jsonl'), 'utf8')
    .split('\n')
    .filter((line) => line !== '')
    .map((line) => JSON.parse(line) as Task)
    .find((candidate) => candidate.type === 'diagnose')!;
  const params = (task.expected as { params: Record<string, unknown> }).params;
  answer = `ANSWER: ${JSON.stringify({
    topic: params['topic'],
    correct: params['correct'],
    error: (params['errors'] as string[])[0],
  })}`;
}, 60_000);

afterAll(cleanUp);

describe('architect field export', () => {
  it('writes the export and says what it holds and left out', async () => {
    const manifest = FieldExportManifestSchema.parse(
      JSON.parse(readFileSync(join(out, 'MANIFEST.json'), 'utf8')),
    );
    expect(manifest.job.name).toBe('Academy desk');
    expect(manifest.counts.sealed_organizations).toBe(1);
    expect(existsSync(join(out, 'env', 'score_client.py'))).toBe(true);
    expect(existsSync(join(out, 'eval', 'manifest.json'))).toBe(true);
  });

  it('refuses a job it has not got, a folder that has files, and another action', async () => {
    expect((await cli(['field', 'export', 'nobody', '--out', join(out, 'x')], { env })).code).toBe(
      2,
    );
    expect((await cli(['field', 'export', 'Academy desk', '--out', out], { env })).code).toBe(2);
    expect(
      (await cli(['field', 'import', 'Academy desk', '--out', join(out, 'x')], { env })).code,
    ).toBe(2);
  });
});

describe('architect reward score', () => {
  it('reads requests line by line and writes one score per line, in order', async () => {
    const lines = [
      { id: 1, task_id: task.id, final_text: answer },
      { id: 2, task_id: task.id, final_text: 'ANSWER: {}' },
      { id: 3, task_id: 'not-a-task', final_text: answer },
    ];
    const run = await cli(['reward', 'score', '--env', join(out, 'env')], {
      env,
      stdin: `${lines.map((line) => JSON.stringify(line)).join('\n')}\n\n`,
    });
    expect(run.code, run.stderr).toBe(0);
    expect(run.guards).toBe(1);
    const scores = run.stdout
      .trimEnd()
      .split('\n')
      .map((line) => JSON.parse(line) as Record<string, unknown>);
    expect(scores).toMatchObject([
      { id: 1, reward: 1 },
      { id: 2, reward: 0 },
      { id: 3, reward: 0, error: { code: 'unknown_task' } },
    ]);
    expect(scores[1]).not.toHaveProperty('error');
  });

  it('refuses a folder that is not an env folder', async () => {
    expect((await cli(['reward', 'score', '--env', out], { env })).code).toBe(2);
  });

  it.skipIf(PYTHON === null)(
    'is reached from Python through the export’s own client',
    () => {
      const script = [
        'import json, sys',
        'sys.path.insert(0, sys.argv[1])',
        'from score_client import Scorer',
        'with Scorer(command=sys.argv[4:]) as scorer:',
        '    good = scorer.score(sys.argv[2], sys.argv[3], request_id="a")',
        '    bad = scorer.score(sys.argv[2], "ANSWER: {}", request_id="b")',
        'print(json.dumps([good, bad]))',
      ].join('\n');
      const envDir = join(out, 'env');
      const command = [process.execPath, CLI_BIN, 'reward', 'score', '--env', envDir];
      const run = spawnSync(
        PYTHON ?? 'python3',
        ['-c', script, envDir, task.id, answer, ...command],
        { encoding: 'utf8', env: { ...process.env, ...env }, windowsHide: true, timeout: 60_000 },
      );
      expect(run.status, run.stderr).toBe(0);
      expect(JSON.parse(run.stdout)).toMatchObject([
        { id: 'a', reward: 1 },
        { id: 'b', reward: 0 },
      ]);
    },
    90_000,
  );
});
