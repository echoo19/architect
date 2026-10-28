import type { AgentHostClient } from '@architect/engine/agent-host';
import type { GraduateSummary } from '@architect/shared';
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { WorkspaceGraduates } from '../../../src/main/workspace/graduates';

let errors: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  errors = vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

afterEach(() => {
  errors.mockRestore();
});

function graduate(id: string, activeVersion: number | null = 1): GraduateSummary {
  return {
    id,
    name: `Agent ${id}`,
    path: `/data/graduates/${id}/versions/v0001`,
    manifest: {} as GraduateSummary['manifest'],
    activeVersion,
    versions: 1,
    status: activeVersion === null ? 'blocked' : 'unchecked',
    reasons:
      activeVersion === null ? ["Its folder from before versions couldn't be converted."] : [],
  };
}

type OpenGraduate = AgentHostClient['openGraduate'];

function setup(
  graduates: GraduateSummary[],
  openGraduate: Mock<OpenGraduate> = vi.fn<OpenGraduate>(async () => undefined),
  threads?: number,
) {
  const host = { openGraduate, closeGraduate: vi.fn(async () => undefined) };
  const workspace = new WorkspaceGraduates({
    listGraduates: async () => graduates,
    call: (request) => request(host as unknown as AgentHostClient),
    localThreads: () => threads,
  });
  return { host, workspace };
}

describe('WorkspaceGraduates', () => {
  it('opens every graduate by id; the agent host finds its version and installation', async () => {
    const { host, workspace } = setup([graduate('grd_1'), graduate('grd_2')]);
    workspace.openAll();
    await workspace.settled();
    expect(host.openGraduate).toHaveBeenCalledWith('grd_1', undefined);
    expect(host.openGraduate).toHaveBeenCalledWith('grd_2', undefined);
  });

  it('opens a graduate with the quiet thread cap when there is one', async () => {
    const { host, workspace } = setup([graduate('grd_1')], undefined, 6);
    workspace.openAll();
    await workspace.settled();
    expect(host.openGraduate).toHaveBeenCalledWith('grd_1', 6);
  });

  it("remembers why a graduate couldn't be opened, and opens the others", async () => {
    const openGraduate = vi.fn<OpenGraduate>(async (graduateId) => {
      if (graduateId === 'grd_remote') throw new Error("Its model isn't on this computer.");
    });
    const { workspace } = setup(
      [graduate('grd_1'), graduate('grd_unconverted', null), graduate('grd_remote')],
      openGraduate,
    );
    workspace.openAll();
    await workspace.settled();

    expect(workspace.failure('grd_1')).toBeUndefined();
    expect(workspace.failure('grd_unconverted')).toBe(
      "Its folder from before versions couldn't be converted.",
    );
    expect(workspace.failure('grd_remote')).toBe("Its model isn't on this computer.");
    expect(openGraduate).not.toHaveBeenCalledWith('grd_unconverted', undefined);
  });

  it('closes a graduate and forgets why it failed', async () => {
    const { host, workspace } = setup([graduate('grd_unconverted', null)]);
    workspace.openAll();
    await workspace.settled();
    expect(workspace.failure('grd_unconverted')).toBeDefined();
    await workspace.close('grd_unconverted');
    expect(host.closeGraduate).toHaveBeenCalledWith('grd_unconverted');
    expect(workspace.failure('grd_unconverted')).toBeUndefined();
  });

  it('settles even when the graduates cannot be listed', async () => {
    const workspace = new WorkspaceGraduates({
      localThreads: () => undefined,
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
