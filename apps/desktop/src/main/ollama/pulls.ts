import { pullOllamaModel } from '@architect/adapters';
import type { PullProgress } from '@architect/shared';

/** Model downloads through Ollama, one at a time. Closing the window cancels the current one. */
export class ModelPulls {
  private current: { model: string; controller: AbortController } | null = null;

  constructor(private readonly onProgress: (progress: PullProgress) => void) {}

  /** Resolves once the model is ready. A failure is also reported as a last progress update. */
  async pull(baseUrl: string, model: string): Promise<void> {
    if (this.current) {
      throw new Error(`${this.current.model} is still downloading. Try again when it's done.`);
    }
    const controller = new AbortController();
    this.current = { model, controller };
    try {
      await pullOllamaModel(baseUrl, model, this.onProgress, controller.signal);
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
