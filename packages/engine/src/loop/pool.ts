/**
 * Runs `work` over `items` with up to `concurrency` in flight. `mayStart` is asked before each
 * item; once it says no, nothing new starts and the call resolves when the work in flight has
 * settled, which is how a pause waits for the attempt in progress. The first failure also stops
 * new starts, and is rethrown once the rest have settled.
 */
export async function runPool<T>(
  items: readonly T[],
  concurrency: number,
  mayStart: () => boolean,
  work: (item: T) => Promise<void>,
): Promise<void> {
  const queue = [...items];
  const failures: unknown[] = [];
  const worker = async (): Promise<void> => {
    while (failures.length === 0 && queue.length > 0 && mayStart()) {
      const item = queue.shift() as T;
      try {
        await work(item);
      } catch (error) {
        failures.push(error);
      }
    }
  };
  const workers = Math.max(1, Math.min(concurrency, queue.length));
  await Promise.all(Array.from({ length: workers }, worker));
  if (failures.length > 0) throw failures[0];
}
