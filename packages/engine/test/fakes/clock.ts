export const START = Date.UTC(2026, 9, 27, 14, 0, 0);

/** A clock that moves only when a test says so. */
export class ManualClock {
  constructor(public time = START) {}
  now = (): number => this.time;
  advance(ms: number): void {
    this.time += ms;
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
