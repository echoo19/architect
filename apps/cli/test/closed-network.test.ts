import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { appAllowedHosts, appClosedNetworkProblem } from '../src/runtime-settings';
import { cleanUp, cli, machineWith, tempDir } from './support';

afterEach(cleanUp);

describe("the app's closed network, as the command reads it", () => {
  it('follows a closed network, and is off where the app has none', async () => {
    const dir = await tempDir('settings');
    expect(appAllowedHosts(dir)).toBeUndefined();
    await writeFile(
      join(dir, 'settings.json'),
      JSON.stringify({ closedNetwork: { on: true, hosts: ['spark.lab.internal'] } }),
    );
    expect(appAllowedHosts(dir)).toEqual(['spark.lab.internal']);
    expect(appClosedNetworkProblem(dir)).toBeUndefined();
  });

  it('fails closed on a damaged one, with the hosts that read, and on a file that is not JSON', async () => {
    const dir = await tempDir('settings');
    const file = join(dir, 'settings.json');
    await writeFile(
      file,
      JSON.stringify({ closedNetwork: { on: false, hosts: ['spark.lab.internal', 42] } }),
    );
    expect(appAllowedHosts(dir)).toEqual(['spark.lab.internal']);
    expect(appClosedNetworkProblem(dir)).toContain('so it stays on with spark.lab.internal');
    await writeFile(file, '{"closedNetwork": {"on": true, "hosts": ["spark');
    expect(appAllowedHosts(dir)).toEqual([]);
    expect(appClosedNetworkProblem(dir)).toContain('the settings file could not be read');
  });

  it('says so once on stderr when a command teaches from a damaged one', async () => {
    const machine = await machineWith([]);
    await writeFile(
      join(machine.dataDir, 'settings.json'),
      JSON.stringify({ closedNetwork: { on: true, hosts: 'spark.lab.internal' } }),
    );
    const listed = await cli(['field', 'list'], { env: machine.env });
    expect(listed.stderr).toContain(
      "The saved closed network couldn't be read in full (its hosts), so it stays on with this computer alone.",
    );
    expect(listed.stderr.match(/couldn't be read in full/g)).toHaveLength(1);
  });
});
