import { makeTextOnlyModel, pullOllamaModel } from '@architect/adapters';
import type { PullProgress, StudentBuild } from '@architect/shared';

/** What the last step of the GPU-sized build is called while it runs. */
const PREPARING = 'Preparing it for your GPU';

/** Model downloads through Ollama, one at a time. Closing the window cancels the current one. */
export class ModelPulls {
  private current: { model: string; controller: AbortController } | null = null;

  constructor(private readonly onProgress: (progress: PullProgress) => void) {}

  /** Resolves once the model is ready. A failure is also reported as a last progress update. */
  async pull(baseUrl: string, model: string): Promise<void> {
    await this.run(model, (signal) => pullOllamaModel(baseUrl, model, this.onProgress, signal));
  }

  /**
   * Installs one of Glimmer's builds. The GPU-sized one is pulled from Hugging Face, then made
   * text-only, so the vision projector the pull brings doesn't take GPU memory; its progress is
   * reported under the build's own model name throughout.
   */
  async install(baseUrl: string, build: StudentBuild): Promise<void> {
    const { source } = build;
    if (source.kind === 'library') {
      await this.pull(baseUrl, build.model);
      return;
    }
    await this.run(build.model, async (signal) => {
      await pullOllamaModel(
        baseUrl,
        source.pull,
        (progress) =>
          this.onProgress({
            ...progress,
            model: build.model,
            // The download finishing is not the end: the model is made next.
            done: false,
            status: progress.done ? PREPARING : progress.status,
          }),
        signal,
      );
      this.onProgress({ model: build.model, status: PREPARING, done: false });
      await makeTextOnlyModel(
        baseUrl,
        {
          from: source.pull,
          model: build.model,
          renderer: source.renderer,
          parser: source.parser,
          parameters: source.parameters,
        },
        signal,
      );
      this.onProgress({ model: build.model, status: 'Done', done: true });
    });
  }

  private async run(model: string, work: (signal: AbortSignal) => Promise<void>): Promise<void> {
    if (this.current) {
      throw new Error(`${this.current.model} is still downloading. Try again when it's done.`);
    }
    const controller = new AbortController();
    this.current = { model, controller };
    try {
      await work(controller.signal);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.onProgress({ model, status: 'Stopped', done: true, error: message });
      throw error;
    } finally {
      this.current = null;
    }
  }

  cancel(): void {
    this.current?.controller.abort();
  }
}
