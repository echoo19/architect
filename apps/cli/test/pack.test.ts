import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { openEngineStore } from '@architect/engine/testing';
import { afterEach, describe, expect, it } from 'vitest';
import { cleanUp, cli, machineWith, tempDir, testEnv, type Machine } from './support';

afterEach(cleanUp);

const SEALED_RECORD = 'Juniper student Adaeze Okonkwo, balance 4,210.55';

/** A computer whose graduate was taught by a run that reached a self-hosted teacher and its model. */
async function taughtInside(): Promise<Machine> {
  const machine = await machineWith([], {
    perOrg: [
      {
        type: 'invoice',
        label: 'Invoices',
        org: 'maple',
        orgName: 'Maple Grove',
        seen: true,
        synthetic: true,
        pass: 9,
        total: 10,
      },
      {
        type: 'invoice',
        label: 'Invoices',
        org: 'juniper',
        orgName: 'Juniper',
        seen: false,
        synthetic: false,
        pass: 7,
        total: 10,
      },
    ],
  });
  const store = openEngineStore(join(machine.dataDir, 'architect.db'));
  try {
    const version = store.versions.get('grd_desk', 1);
    const runId = version?.runId ?? version?.manifest.evidence.provenance?.runId ?? '';
    store.runs.recordContact(runId, 'spark.lab.internal', true);
    store.runs.recordContact(runId, '127.0.0.1:11434', true);
  } finally {
    store.close();
  }
  // A never-seen organization's files, where the app keeps them: no pack carries them.
  const orgDir = join(machine.dataDir, 'jobs', machine.graduate.job.id, 'orgs', 'juniper', 'data');
  await mkdir(orgDir, { recursive: true });
  await writeFile(join(orgDir, 'students.csv'), `id,name\n1,${SEALED_RECORD}\n`, 'utf8');
  return machine;
}

async function everyFile(dir: string, prefix = ''): Promise<string[]> {
  const found: string[] = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) found.push(...(await everyFile(join(dir, entry.name), path)));
    else found.push(path);
  }
  return found;
}

describe('architect pack and verify --pack', () => {
  it('writes a pack, and a computer with nothing of Architect checks every file of it', async () => {
    const machine = await taughtInside();
    const out = await tempDir('pack');
    const packed = await cli(['pack', 'service-desk', '--out', out], { env: machine.env });
    expect(packed.code, packed.stderr).toBe(0);
    expect(packed.guards).toBe(1);
    expect(packed.stdout).toMatch(
      /^Wrote service-desk-v1-evidence: Service desk version 1, \d+ files/,
    );
    expect(packed.stdout).toContain('The base model is named by its hash, not copied.');
    const folder = join(out, 'service-desk-v1-evidence');
    const evidence = JSON.parse(await readFile(join(folder, 'evidence.json'), 'utf8'));
    expect(evidence.teaching.line).toBe('Contacted 2 hosts, both inside the network');
    expect(evidence.organizations).toEqual([
      { org: 'maple', name: 'Maple Grove', kind: 'seen', real: false, pass: 9, total: 10 },
      { org: 'juniper', name: 'Juniper', kind: 'never_seen', real: true, pass: 7, total: 10 },
    ]);
    for (const path of await everyFile(folder)) {
      expect(await readFile(join(folder, ...path.split('/')), 'utf8'), path).not.toContain(
        'Okonkwo',
      );
    }

    // The reviewer's computer: no data folder, no agents, the network guard on.
    const reviewer = await testEnv();
    const checked = await cli(['verify', '--pack', folder], { env: reviewer });
    expect(checked.code, checked.stdout).toBe(0);
    expect(checked.guards).toBe(1);
    expect(checked.stdout).toMatch(
      /^The evidence pack for Service desk, version 1: all \d+ files match its MANIFEST\.json\./,
    );
    const manifestLine = /sha256 of its MANIFEST\.json: ([0-9a-f]{64})/;
    expect(checked.stdout.match(manifestLine)?.[1]).toBe(packed.stdout.match(manifestLine)?.[1]);

    const json = await cli(['pack', 'service-desk', '--out', await tempDir('pack'), '--json'], {
      env: machine.env,
    });
    expect(JSON.parse(json.stdout)).toMatchObject({
      format: 'architect.pack/1',
      agent: { slug: 'service-desk' },
      version: 1,
      weights: 'referenced',
    });
  });

  it('names a changed file and exits 3', async () => {
    const machine = await taughtInside();
    const out = await tempDir('pack');
    expect((await cli(['pack', 'service-desk', '--out', out], { env: machine.env })).code).toBe(0);
    const folder = join(out, 'service-desk-v1-evidence');
    await writeFile(join(folder, 'evidence.json'), '{"format":"architect.evidence/1"}\n');
    const checked = await cli(['verify', '--pack', folder], { env: await testEnv() });
    expect(checked.code).toBe(3);
    expect(checked.stdout).toContain("doesn't check out");
    expect(checked.stdout).toContain(
      "evidence.json doesn't match MANIFEST.json: it changed after the pack was written.",
    );
    const json = await cli(['verify', '--pack', folder, '--json'], { env: await testEnv() });
    expect(JSON.parse(json.stdout)).toMatchObject({ format: 'architect.verify-pack/1', ok: false });
  });

  it('asks for an agent or a pack, and for where to write one', async () => {
    const machine = await taughtInside();
    const bare = await cli(['verify'], { env: machine.env });
    expect(bare.code).toBe(2);
    expect(bare.stderr).toContain('or an evidence pack with --pack <folder>');
    const nowhere = await cli(['pack', 'service-desk'], { env: machine.env });
    expect(nowhere.code).toBe(2);
    expect(nowhere.stderr).toContain('--out <folder>');
  });
});
