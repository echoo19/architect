import { existsSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { appDataDir } from '@architect/engine/local-runtime';
import { openEngineStore, SAMPLE_CONTENT } from '@architect/engine/testing';
import { afterEach, describe, expect, it } from 'vitest';
import { cleanUp, cli, machineWith, spawnCli, tempDir, testEnv } from './support';

afterEach(cleanUp);

describe("finding the app's data", () => {
  it('uses the folder the desktop app uses, unless ARCHITECT_USER_DATA names another', () => {
    expect(appDataDir({ APPDATA: 'C:\\Users\\a\\AppData\\Roaming' }, 'win32', 'C:\\Users\\a')).toBe(
      join('C:\\Users\\a\\AppData\\Roaming', 'Architect'),
    );
    expect(appDataDir({}, 'darwin', '/Users/a')).toBe(
      join('/Users/a', 'Library', 'Application Support', 'Architect'),
    );
    expect(appDataDir({}, 'linux', '/home/a')).toBe(join('/home/a', '.config', 'Architect'));
    expect(appDataDir({ XDG_CONFIG_HOME: '/cfg' }, 'linux', '/home/a')).toBe(
      join('/cfg', 'Architect'),
    );
    expect(appDataDir({ ARCHITECT_USER_DATA: '/tmp/profile' }, 'win32', 'C:\\Users\\a')).toMatch(
      /profile$/,
    );
  });

  it('lists nothing, and creates nothing, where the app has no data yet', async () => {
    const env = await testEnv();
    const run = await cli(['list'], { env });
    expect(run).toMatchObject({ code: 0, stdout: '' });
    expect(run.stderr).toContain('No agents in');
    expect(existsSync(join(env['ARCHITECT_USER_DATA'] ?? '', 'architect.db'))).toBe(false);
    const inspected = await cli(['inspect', 'service-desk'], { env });
    expect(inspected.code).toBe(2);
    expect(inspected.stderr).toContain('Architect has no agents in');
  });
});

describe('the commands', () => {
  it('lists agents by the name to run them by', async () => {
    const machine = await machineWith([]);
    const listed = await cli(['list'], { env: machine.env });
    expect(listed.code).toBe(0);
    expect(listed.stdout).toMatch(/service-desk\s+grd_desk\s+v1\s+unchecked/);
    const json = await cli(['list', '--json'], { env: machine.env });
    expect(JSON.parse(json.stdout)).toMatchObject({
      format: 'architect.list/1',
      agents: [{ id: 'grd_desk', name: 'Service desk', slug: 'service-desk', active_version: 1 }],
    });
  });

  it("keeps the author's evaluation and this computer's checks apart", async () => {
    // The check that the model answers sends it one short request.
    const machine = await machineWith([{ text: 'Ready.' }]);
    const verified = await cli(['verify', 'service-desk'], { env: machine.env });
    expect(verified.code, verified.stdout).toBe(0);
    expect(verified.stdout).toContain(
      'Installation checks on this computer for Service desk, version 1: ready.',
    );
    expect(verified.stdout).toContain('They are not an evaluation of it');
    expect(verified.stdout).not.toMatch(/graduat|locked test|passed \d+ of/i);
    expect(verified.guards).toBe(1);

    const inspected = await cli(['inspect', 'grd_desk'], { env: machine.env });
    expect(inspected.code).toBe(0);
    expect(inspected.stdout).toContain(
      "Evaluated on the author's configuration, version 1: 17 of 20 locked-test tasks passed",
    );
    expect(inspected.stdout).toContain('Installation checks on this computer');
  });

  it('says what a verification found when the model is not there, with exit 3', async () => {
    const machine = await machineWith([]);
    await machine.model.close();
    const verified = await cli(['verify', 'service-desk'], { env: machine.env });
    expect(verified.code).toBe(3);
    expect(verified.stdout).toContain('needs attention');
  });

  it('exports a package, and a clean computer installs it with its own folder', async () => {
    const machine = await machineWith([{ text: 'Ready.' }]);
    const out = await tempDir('export');
    const archive = join(out, 'desk.architect.zip');
    const exported = await cli(['export', 'service-desk', '--output', archive], {
      env: machine.env,
    });
    expect(exported.code, exported.stderr).toBe(0);
    expect(existsSync(archive)).toBe(true);
    expect(exported.stdout).toContain('desk.architect.zip: Service desk version 1');
    const again = await cli(['export', 'service-desk', '--output', archive], { env: machine.env });
    expect(again.code).toBe(2);

    const env = await testEnv();
    const records = await tempDir('records');
    for (const [name, content] of Object.entries(SAMPLE_CONTENT)) {
      await writeFile(join(records, name), content, 'utf8');
    }
    const inspected = await cli(['inspect', archive], { env });
    expect(inspected.code).toBe(0);
    expect(inspected.stdout).toContain('Nothing in it has run.');
    // Looking at a package doesn't start the app's data folder.
    expect(existsSync(join(env['ARCHITECT_USER_DATA'] ?? '', 'architect.db'))).toBe(false);
    const installed = await cli(
      [
        'install',
        archive,
        '--bind',
        `data=${records}`,
        '--grant',
        'data=read',
        '--model',
        'muse-glimmer:30b',
        '--model-url',
        machine.model.url,
      ],
      { env },
    );
    expect(installed.code, installed.stderr).toBe(0);
    expect(installed.stdout).toContain('Installed Service desk as version 1');
    expect(installed.stderr).toContain('Installation checks on this computer');
    const store = openEngineStore(join(env['ARCHITECT_USER_DATA'] ?? '', 'architect.db'));
    const installation = store.installations.get('grd_desk');
    store.close();
    // Exactly what the command named: reading data/, and writes asked about.
    expect(installation?.grants).toEqual({ writes: 'ask', resources: { data: 'read' } });
  });

  it('stops an export the scan finds something in, until the finding is accepted', async () => {
    const machine = await machineWith([], {
      harness: { system: 'Our files live in C:\\Users\\dana\\Documents\\desk.' },
    });
    const out = await tempDir('export');
    const archive = join(out, 'desk.architect.zip');
    const stopped = await cli(['export', 'service-desk', '--output', archive], {
      env: machine.env,
    });
    expect(stopped.code).toBe(3);
    expect(stopped.stderr).toContain('harness/AGENTS.md line 1 (private_path)');
    expect(existsSync(archive)).toBe(false);
    const digest = /--accept-findings ([0-9a-f]{64})/.exec(stopped.stderr)?.[1] ?? '';
    const accepted = await cli(
      ['export', 'service-desk', '--output', archive, '--accept-findings', digest],
      { env: machine.env },
    );
    expect(accepted.code, accepted.stderr).toBe(0);
    expect(existsSync(archive)).toBe(true);
  });

  it.each([
    [['frobnicate'], 'architect has no command called "frobnicate"'],
    [['run'], 'architect run needs an argument'],
    [['list', '--colour'], "Unknown option '--colour'"],
    [['install', 'x.zip', '--grant', 'data=everything'], '--grant takes read, read_write or none'],
    [['publish', 'service-desk', '--repo', 'not a repo'], "isn't a repository name"],
    [['run', 'service-desk', '--timeout', '5'], '--timeout goes with --input'],
    [['run', 'service-desk', '--input', '-', '--timeout', '2147484'], '--timeout takes at most'],
    [['install', 'hf://not-a-repo'], 'hf://owner/name'],
    [['install', 'hf://a/b--c'], 'hf://owner/name'],
    [['export', 'service-desk', '--output', 'x.zip', '--version', '99'], 'has no version 99'],
    [['export', 'service-desk', '--output', 'x.zip', '--include', 'bogus'], '"bogus"'],
    [['publish', 'service-desk', '--repo', 'jake/desk', '--include', 'bogus'], '"bogus"'],
  ])('refuses %j with exit 2', async (argv, message) => {
    const machine = await machineWith([]);
    const run = await cli(argv, { env: machine.env, cwd: await tempDir('cwd') });
    expect(run.code, run.stderr).toBe(2);
    expect(run.stderr).toContain(message);
    expect(machine.model.requests).toEqual([]);
  });

  it('prints its help and version with exit 0', async () => {
    const env = await testEnv();
    const help = await cli(['--help'], { env });
    expect(help).toMatchObject({ code: 0 });
    expect(help.stdout).toContain('Usage: architect <command> [options]');
    const runHelp = await cli(['run', '--help'], { env });
    expect(runHelp.stdout).toContain('--non-interactive');
    const version = await spawnCli(['--version'], { env });
    expect(version).toMatchObject({ code: 0, stdout: expect.stringMatching(/^\d+\.\d+\.\d+\n$/) });
  }, 30_000);

  it('reads a relative path from where the command was typed', async () => {
    const machine = await machineWith([]);
    const where = await tempDir('cwd');
    await mkdir(join(where, 'exports'));
    const run = await cli(['export', 'service-desk', '--output', 'exports/desk.architect.zip'], {
      env: machine.env,
      cwd: where,
    });
    expect(run.code, run.stderr).toBe(0);
    expect(existsSync(join(where, 'exports', 'desk.architect.zip'))).toBe(true);
  });
});
