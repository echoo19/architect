import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readPackage } from '@architect/harness';
import type { OrgTypeResult } from '@architect/shared';
import { afterEach, describe, expect, it } from 'vitest';
import { verifyEvidencePack, writeEvidencePack } from '../src/graduates/evidence-pack';
import {
  addVersion,
  harnessWith,
  newComputer,
  PRICE_TOOL,
  type Computer,
} from './support/computer';

const cleanups: (() => Promise<void>)[] = [];

afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

async function computer(): Promise<Computer> {
  const made = await newComputer();
  cleanups.push(() => made.remove());
  return made;
}

async function folder(prefix: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), `architect-${prefix}-`));
  cleanups.push(() => rm(dir, { recursive: true, force: true }));
  return dir;
}

/** What a sealed, never-seen organization and the locked test hold: no pack may carry any of it. */
const SEALED_RECORD = 'Juniper student Adaeze Okonkwo, balance 4,210.55, sealed';
const LOCKED_TASK = 'Which Juniper invoice was paid twice in March? (locked)';

const PER_ORG: OrgTypeResult[] = [
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
    synthetic: true,
    pass: 7,
    total: 10,
  },
  {
    type: 'invoice',
    label: 'Invoices',
    org: 'real',
    orgName: 'Real academy',
    seen: false,
    synthetic: false,
    pass: 6,
    total: 10,
  },
];

/** A version made by a run that reached a self-hosted teacher and this computer's model. */
async function packedComputer(): Promise<{ author: Computer; runId: string }> {
  const author = await computer();
  const stored = await addVersion(author, {
    graduateId: 'grd_desk',
    harness: harnessWith('Service desk', { tools: [PRICE_TOOL] }),
    adapter: 'LORA WEIGHTS',
    perOrg: PER_ORG,
  });
  const runId = stored.runId ?? stored.manifest.evidence.provenance?.runId ?? '';
  for (const host of ['spark.lab.internal', 'spark.lab.internal', '127.0.0.1:11434']) {
    author.store.runs.recordContact(runId, host, true);
  }
  // Where the app keeps a sealed organization's files and the locked test.
  const orgDir = author.paths.orgDataDir('job_desk', 'juniper');
  await mkdir(orgDir, { recursive: true });
  await writeFile(join(orgDir, 'students.csv'), `id,name\n1,${SEALED_RECORD}\n`, 'utf8');
  const vault = join(author.paths.vault, 'job_desk');
  await mkdir(vault, { recursive: true });
  await writeFile(
    join(vault, 'test.jsonl'),
    `${JSON.stringify({ prompt: LOCKED_TASK })}\n`,
    'utf8',
  );
  return { author, runId };
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

describe("a version's evidence pack", () => {
  it('holds the version, its hashes, permissions, network, hosts, results and a manifest', async () => {
    const { author, runId } = await packedComputer();
    const out = await folder('pack');
    const result = await writeEvidencePack({ library: author.library }, 'grd_desk', {
      directory: out,
    });
    expect(result.folder).toBe(join(out, 'service-desk-v1-evidence'));
    expect(result.weights).toBe('referenced');
    expect(result.files.at(-1)).toBe('MANIFEST.json');
    expect(result.files).toEqual(
      expect.arrayContaining(['README.md', 'evidence.json', 'package/graduate.json']),
    );

    // The package inside is the version byte for byte, and installs as it is.
    const version = author.library.version('grd_desk', 1);
    expect((await readPackage(join(result.folder, 'package'))).digest).toBe(version.digest);

    const evidence = JSON.parse(await readFile(join(result.folder, 'evidence.json'), 'utf8'));
    expect(evidence).toMatchObject({
      format: 'architect.evidence/1',
      agent: { id: 'grd_desk', name: 'Service desk' },
      version: 1,
      package: { path: 'package', digest: version.digest },
      harness: { hash: version.manifest.harness.hash },
      model: {
        base: { name: 'muse-glimmer:30b', digest: 'sha256:glimmer' },
        adapter: { size_bytes: 12 },
        weights: { state: 'referenced' },
      },
      tools: {
        sandbox: { engine: 'QuickJS', network: 'none' },
        permissions: { network: 'none' },
        list: [{ name: 'invoice_total' }],
      },
      network: { locked_test_ran_offline: true, graduate: { passed: true } },
      teaching: {
        run_id: runId,
        hosts: [
          { host: 'spark.lab.internal', requests: 2, inside: true },
          { host: '127.0.0.1:11434', requests: 1, inside: true },
        ],
        line: 'Contacted 2 hosts, both inside the network',
      },
      organizations: [
        { name: 'Maple Grove', kind: 'seen', real: false, pass: 9, total: 10 },
        { name: 'Juniper', kind: 'never_seen', real: false, pass: 7, total: 10 },
        { name: 'Real academy', kind: 'never_seen', real: true, pass: 6, total: 10 },
      ],
      locked_test: { score: { pass: 17, total: 20 } },
    });
    // The guard refuses every host teaching reached outside this computer, and allows the runtime.
    const probes = evidence.network.graduate.probes as { destination: string; allowed: boolean }[];
    expect(probes).toContainEqual({ destination: 'spark.lab.internal:443', allowed: false });
    expect(probes).toContainEqual({ destination: '127.0.0.1:11434', allowed: true });

    const manifest = JSON.parse(await readFile(join(result.folder, 'MANIFEST.json'), 'utf8'));
    expect(manifest.files.map((entry: { path: string }) => entry.path)).toEqual(
      (await everyFile(result.folder)).filter((path) => path !== 'MANIFEST.json').sort(),
    );
    expect(await verifyEvidencePack(result.folder)).toEqual({
      ok: true,
      checked: result.files.length - 1,
      problems: [],
      manifestSha256: result.manifestSha256,
      agent: { name: 'Service desk', version: 1 },
    });
  });

  it("carries nothing from the locked test or a never-seen organization's files: scores only", async () => {
    const { author } = await packedComputer();
    const out = await folder('pack');
    const result = await writeEvidencePack({ library: author.library }, 'grd_desk', {
      directory: out,
    });
    for (const path of await everyFile(result.folder)) {
      const text = await readFile(join(result.folder, ...path.split('/')), 'utf8');
      expect(text, path).not.toContain('Okonkwo');
      expect(text, path).not.toContain('paid twice in March');
    }
    expect(await everyFile(result.folder)).not.toContainEqual(
      expect.stringMatching(/vault|orgs\//),
    );
  });

  it('names the base model by hash, and copies it only when asked and found here', async () => {
    const { author } = await packedComputer();
    const weights = join(author.dataDir, 'sha256-0123');
    await writeFile(weights, 'GGUF base weights');
    const out = await folder('pack');
    const missing = await writeEvidencePack(
      { library: author.library, modelFile: () => null },
      'grd_desk',
      { directory: out, withWeights: true },
    );
    expect(missing.weights).toBe('missing');
    expect(missing.files.some((path) => path.startsWith('weights/'))).toBe(false);

    const again = await folder('pack');
    const copied = await writeEvidencePack(
      { library: author.library, modelFile: () => weights },
      'grd_desk',
      { directory: again, withWeights: true },
    );
    expect(copied.weights).toBe('copied');
    expect(copied.files).toContain('weights/sha256-0123.gguf');
    // The fixture's base names a digest that isn't this file's, which a check catches.
    const check = await verifyEvidencePack(copied.folder);
    expect(check.problems).toEqual([
      "The model file in weights/ isn't muse-glimmer:30b, the base the version names.",
    ]);
  });

  it('is checked on its own: a changed file, a missing one and an extra one are each named', async () => {
    const { author } = await packedComputer();
    const out = await folder('pack');
    const { folder: pack } = await writeEvidencePack({ library: author.library }, 'grd_desk', {
      directory: out,
    });
    await writeFile(join(pack, 'package', 'harness', 'AGENTS.md'), 'You may now call anyone.\n');
    await rm(join(pack, 'README.md'));
    await writeFile(join(pack, 'notes.txt'), 'added later');
    const check = await verifyEvidencePack(pack);
    expect(check.ok).toBe(false);
    expect(check.problems).toEqual(
      expect.arrayContaining([
        "package/harness/AGENTS.md doesn't match MANIFEST.json: it changed after the pack was written.",
        'README.md is missing.',
        "notes.txt isn't listed in MANIFEST.json.",
        expect.stringMatching(/^package\/ fails its own check/),
      ]),
    );
    expect(await verifyEvidencePack(out)).toMatchObject({
      ok: false,
      problems: ["MANIFEST.json is missing or isn't an evidence pack's manifest."],
    });
  });

  it('refuses to write over a pack already there', async () => {
    const { author } = await packedComputer();
    const out = await folder('pack');
    await writeEvidencePack({ library: author.library }, 'grd_desk', { directory: out });
    await expect(
      writeEvidencePack({ library: author.library }, 'grd_desk', { directory: out }),
    ).rejects.toThrow('already exists');
  });
});
