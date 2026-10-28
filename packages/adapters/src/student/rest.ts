/**
 * Waits `ms`, or less when the signal aborts first. Quiet mode rests a local model's GPU after
 * each reply with it; a stopped request needs no rest, so an abort ends it early without an error.
 */
export function rest(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal?.aborted) {
      resolve();
      return;
    }
    const done = () => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', done);
      resolve();
    };
    const timer = setTimeout(done, ms);
    signal?.addEventListener('abort', done, { once: true });
  });
}
