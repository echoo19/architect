import { importJobInto } from '@architect/engine/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { cleanUp, cli, machineWith, type Machine } from './support';

/*
 * `architect certify` (decision 079). The engine's own tests certify a trained version with fake
 * models; here the command reads its options, finds the agent and the job, and says why a version
 * can't be certified, without any model.
 */

let machine: Machine;

beforeAll(async () => {
  machine = await machineWith([]);
  await importJobInto(machine.dataDir);
});

afterAll(cleanUp);

describe('architect certify', () => {
  it('prints its help', async () => {
    const result = await cli(['certify', '--help'], { env: machine.env });
    expect(result.code).toBe(0);
    expect(result.stdout).toContain('--calibration-size <n>');
    expect(result.stdout).toContain('--max-usd <dollars>');
  });

  it('needs a version and a job, with exit 2', async () => {
    const result = await cli(['certify', 'grd_desk'], { env: machine.env });
    expect(result.code).toBe(2);
    expect(result.stderr).toContain('--version <n>');
  });

  it('refuses a share that is not between 0 and 1', async () => {
    const result = await cli(
      ['certify', 'grd_desk', '--version', '1', '--job', 'Tutor', '--epsilon', '10'],
      { env: machine.env },
    );
    expect(result.code).toBe(2);
    expect(result.stderr).toContain('--epsilon takes a share between 0 and 1');
  });

  it('says when the job is not there', async () => {
    const result = await cli(['certify', 'grd_desk', '--version', '1', '--job', 'nowhere'], {
      env: machine.env,
    });
    expect(result.code).toBe(2);
    expect(result.stderr).toContain('There is no job called nowhere here.');
  });

  it('refuses a version installed from a package: its run is not known here', async () => {
    const result = await cli(['certify', 'grd_desk', '--version', '1', '--job', 'Tutor'], {
      env: machine.env,
    });
    expect(result.code, result.stderr).toBe(2);
    expect(result.stderr).toContain('was installed, not trained here');
  });
});
