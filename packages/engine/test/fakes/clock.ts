export const START = Date.UTC(2026, 9, 27, 14, 0, 0);

/** A clock that moves only when a test says so. Its timeouts fire as it passes them. */
export class ManualClock {
  private readonly timers: { at: number; controller: AbortController }[] = [];

  constructor(public time = START) {}

  now = (): number => this.time;

  timeout = (ms: number): AbortSignal => {
    const controller = new AbortController();
    this.timers.push({ at: this.time + ms, controller });
    this.fire();
    return controller.signal;
  };

  advance(ms: number): void {
    this.time += ms;
    this.fire();
  }

  private fire(): void {
    for (const timer of this.timers.filter(({ at }) => at <= this.time)) {
      this.timers.splice(this.timers.indexOf(timer), 1);
      timer.controller.abort(new DOMException('The time ran out.', 'TimeoutError'));
    }
  }
}

export interface Deferred<T = void> {
  promise: Promise<T>;
  resolve(value: T): void;
}

export function deferred<T = void>(): Deferred<T> {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => (resolve = done));
  return { promise, resolve };
}
