import type { AgentHostClient } from '@architect/engine/agent-host';
import type { GraduateSummary } from '@architect/shared';

export interface WorkspaceGraduatesOptions {
  /** Every graduate in Architect, from the engine. */
  listGraduates(): Promise<GraduateSummary[]>;
  /** Sends one request to the agent host. */
  call<T>(request: (host: AgentHostClient) => Promise<T>): Promise<T>;
}

/**
 * Keeps the agent host's open graduates in step with the engine's: all of them when the agent
 * host starts, then each one as it is accepted, imported, promoted, rolled back, rebound or
 * removed. The agent host opens a graduate's active version from its own folder and this
 * computer's installation, so nothing is copied here.
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

  /** Opens one graduate's active version. A failure is remembered and logged rather than thrown. */
  async open(graduate: GraduateSummary): Promise<void> {
    try {
      if (graduate.activeVersion === null) {
        throw new Error(
          graduate.reasons.join(' ') || `${graduate.name} has no version that can run yet.`,
        );
      }
      // Quiet mode's thread cap isn't sent here: the agent host follows the settings it was
      // configured with, at every request, so a change reaches agents already open.
      await this.options.call((host) => host.openGraduate(graduate.id));
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
}
