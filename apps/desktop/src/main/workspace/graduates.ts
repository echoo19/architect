import { randomUUID } from 'node:crypto';
import { cp, rename, rm, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { DataPaths } from '@architect/engine';
import type { AgentHostClient } from '@architect/engine/agent-host';
import type { GraduateSummary } from '@architect/shared';

export interface WorkspaceGraduatesOptions {
  /** The app's data folder. */
  dataDir: string;
  /** Every graduate in Architect, from the engine. */
  listGraduates(): Promise<GraduateSummary[]>;
  /** Sends one request to the agent host. */
  call<T>(request: (host: AgentHostClient) => Promise<T>): Promise<T>;
  /** The CPU-thread cap for local models when quiet mode is on. */
  localThreads(): number | undefined;
}

/**
 * Keeps the agent host's open graduates in step with the engine's: all of them when the agent
 * host starts, then each one as it is accepted, imported or removed. A graduate works on its
 * own copy of its job's data, in `<userData>/workspace/<graduateId>/`, so workspace writes never
 * touch the data training used.
 */
export class WorkspaceGraduates {
  /** Why a graduate couldn't be opened in the current agent host, by id. */
  private readonly failures = new Map<string, string>();
  private opening: Promise<void> = Promise.resolve();

  constructor(private readonly options: WorkspaceGraduatesOptions) {}

  /** Opens every graduate in a newly started agent host. */
  openAll(): void {
    this.failures.clear();
    this.opening = this.options.listGraduates().then(
      async (graduates) => {
        await Promise.all(graduates.map((graduate) => this.open(graduate)));
      },
      (error: unknown) =>
        console.error('[workspace] The graduates to open could not be listed.', error),
    );
  }

  /** Resolves once the graduates the agent host started with are open, or known not to open. */
  settled(): Promise<void> {
    return this.opening;
  }

  /** Why a graduate couldn't be opened, if it couldn't. */
  failure(graduateId: string): string | undefined {
    return this.failures.get(graduateId);
  }

  /** Opens one graduate. A failure is remembered and logged rather than thrown. */
  async open(graduate: GraduateSummary): Promise<void> {
    try {
      const data = await this.workspaceData(graduate);
      const threads = this.options.localThreads();
      await this.options.call((host) =>
        host.openGraduate(graduate.id, graduate.path, data, threads),
      );
      this.failures.delete(graduate.id);
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      this.failures.set(graduate.id, reason);
      console.error(`[workspace] ${graduate.name} (${graduate.id}) was not opened. ${reason}`);
    }
  }

  /** Stops the graduate's replies and unloads it. A failure is logged rather than thrown. */
  async close(graduateId: string): Promise<void> {
    this.failures.delete(graduateId);
    try {
      await this.options.call((host) => host.closeGraduate(graduateId));
    } catch (error) {
      console.error(`[workspace] ${graduateId} could not be closed.`, error);
    }
  }

  /** The graduate's workspace data folder, copied from its job's data the first time. */
  private async workspaceData(graduate: GraduateSummary): Promise<string> {
    const folder = join(this.options.dataDir, 'workspace', graduate.id);
    if (await exists(folder)) return folder;
    const source = new DataPaths(this.options.dataDir).dataDir(graduate.manifest.jobId);
    if (!(await exists(source))) {
      throw new Error("The data of the job it was trained for isn't in Architect.");
    }
    // A copy is finished only once it is renamed into place, so one cut short is never used.
    const staging = `${folder}.${randomUUID()}.partial`;
    try {
      await cp(source, staging, { recursive: true });
      await rename(staging, folder);
    } catch (error) {
      if (!(await exists(folder))) throw error;
    } finally {
      await rm(staging, { recursive: true, force: true });
    }
    return folder;
  }
}

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
    throw error;
  }
}
