import type { EnginePort } from '@architect/engine';

/** Two ends of an in-memory channel that deliver later and by copy, like a MessagePort. */
export function channel(): [EnginePort, EnginePort] {
  const listeners: [((message: unknown) => void)[], ((message: unknown) => void)[]] = [[], []];
  const end = (self: 0 | 1): EnginePort => ({
    postMessage(message) {
      const copy = structuredClone(message);
      setTimeout(() => listeners[self === 0 ? 1 : 0].forEach((listener) => listener(copy)));
    },
    onMessage: (listener) => listeners[self].push(listener),
  });
  return [end(0), end(1)];
}
