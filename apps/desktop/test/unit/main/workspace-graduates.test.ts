import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AgentHostClient } from '@architect/engine/agent-host';
import type { GraduateSummary } from '@architect/shared';
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { WorkspaceGraduates } from '../../../src/main/workspace/graduates';

let dataDir: string;
let errors: ReturnType<typeof vi.spyOn>;

beforeEach(async () => {
  dataDir = await mkdtemp(join(tmpdir(), 'architect-workspace-'));
  errors = vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

afterEach(async () => {
  errors.mockRestore();
  await rm(dataDir, { recursive: true, force: true });
});

function graduate(id: string, jobId: string): GraduateSummary {
  return {
    id,
    name: `Agent ${id}`,
    path: join(dataDir, 'graduates', id),
    manifest: { jobId } as GraduateSummary['manifest'],
  };
}

async function jobData(jobId: string, files: Record<string, string>): Promise<void> {
  const folder = join(dataDir, 'jobs', jobId, 'data');
  await mkdir(folder, { recursive: true });
  for (const [name, content] of Object.entries(files)) {
    await writeFile(join(folder, name), content);
  }
}

type OpenGraduate = AgentHostClient['openGraduate'];

function setup(
  graduates: GraduateSummary[],
  openGraduate: Mock<OpenGraduate> = vi.fn<OpenGraduate>(async () => undefined),
) {
  const host = { openGraduate, closeGraduate: vi.fn(async () => undefined) };
  const workspace = new WorkspaceGraduates({
    dataDir,
    listGraduates: async () => graduates,
    call: (request) => request(host as unknown as AgentHostClient),
  });
  return { host, workspace };
}

describe('WorkspaceGraduates', () => {
  it("opens every graduate on its own copy of its job's data", async () => {
    await jobData('job_1', { 'invoices.csv': 'id\n1\n', 'policy.md': '# Policy\n' });
    const first = graduate('grd_1', 'job_1');
    const second = graduate('grd_2', 'job_1');
    const { host, workspace } = setup([first, second]);

    workspace.openAll();
    await workspace.settled();

    const folder = join(dataDir, 'workspace', 'grd_1');
    expect(host.openGraduate).toHaveBeenCalledWith('grd_1', first.path, folder);
    expect(host.openGraduate).toHaveBeenCalledWith(
      'grd_2',
      second.path,
      join(dataDir, 'workspace', 'grd_2'),
    );
    expect((await readdir(folder)).sort()).toEqual(['invoices.csv', 'policy.md']);
    expect(await readdir(join(dataDir, 'workspace'))).toEqual(['grd_1', 'grd_2']);
  });

  it('keeps workspace changes when the graduate is opened again', async () => {
    await jobData('job_1', { 'invoices.csv': 'id\n1\n' });
    const { workspace } = setup([graduate('grd_1', 'job_1')]);
    workspace.openAll();
    await workspace.settled();
    const file = join(dataDir, 'workspace', 'grd_1', 'invoices.csv');
    await writeFile(file, 'id\n1\n2\n');

    workspace.openAll();
    await workspace.settled();
    expect(await readFile(file, 'utf8')).toBe('id\n1\n2\n');
    expect(await readFile(join(dataDir, 'jobs', 'job_1', 'data', 'invoices.csv'), 'utf8')).toBe(
      'id\n1\n',
    );
  });

  it("remembers why a graduate couldn't be opened, and opens the others", async () => {
    await jobData('job_1', { 'invoices.csv': 'id\n1\n' });
    const openGraduate = vi.fn<OpenGraduate>(async (graduateId) => {
      if (graduateId === 'grd_remote') throw new Error("Its model isn't on this computer.");
    });
    const { workspace } = setup(
      [
        graduate('grd_1', 'job_1'),
        graduate('grd_orphan', 'job_gone'),
        graduate('grd_remote', 'job_1'),
      ],
      openGraduate,
    );
    workspace.openAll();
    await workspace.settled();

    expect(workspace.failure('grd_1')).toBeUndefined();
    expect(workspace.failure('grd_orphan')).toBe(
      "The data of the job it was trained for isn't in Architect.",
    );
    expect(workspace.failure('grd_remote')).toBe("Its model isn't on this computer.");
    expect(openGraduate).not.toHaveBeenCalledWith(
      'grd_orphan',
      expect.anything(),
      expect.anything(),
    );
  });

  it('closes a graduate and forgets why it failed', async () => {
    const { host, workspace } = setup([graduate('grd_orphan', 'job_gone')]);
    workspace.openAll();
    await workspace.settled();
    expect(workspace.failure('grd_orphan')).toBeDefined();
    await workspace.close('grd_orphan');
    expect(host.closeGraduate).toHaveBeenCalledWith('grd_orphan');
    expect(workspace.failure('grd_orphan')).toBeUndefined();
  });

  it('settles even when the graduates cannot be listed', async () => {
    const workspace = new WorkspaceGraduates({
      dataDir,
      listGraduates: async () => {
        throw new Error('The engine stopped unexpectedly and is restarting.');
      },
      call: async () => {
        throw new Error('unreachable');
      },
    });
    workspace.openAll();
    await expect(workspace.settled()).resolves.toBeUndefined();
    expect(errors).toHaveBeenCalledOnce();
  });
});
