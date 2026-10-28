import { SignInError } from './openrouter';

/**
 * One browser sign-in at a time. Starting another replaces one still waiting, and cancel stops
 * the one in progress. A cancelled sign-in resolves with null rather than failing.
 */
export class SignIns {
  private current: AbortController | null = null;

  constructor(private readonly run: (signal: AbortSignal) => Promise<string>) {}

  async start(): Promise<string | null> {
    this.current?.abort();
    const controller = new AbortController();
    this.current = controller;
    try {
      return await this.run(controller.signal);
    } catch (error) {
      if (error instanceof SignInError && error.reason === 'cancelled') return null;
      throw error;
    } finally {
      if (this.current === controller) this.current = null;
    }
  }

  cancel(): void {
    this.current?.abort();
  }
}
