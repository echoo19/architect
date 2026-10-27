import type { EnginePort } from '../../src/host/port';

/**
 * Two connected ports in one process. Messages are structured-cloned and delivered on a later
 * tick, the way a real process boundary would.
 */
export function portPair(): [EnginePort, EnginePort] {
  const handlers: [Set<(message: unknown) => void>, Set<(message: unknown) => void>] = [
    new Set(),
    new Set(),
  ];
  const end = (side: 0 | 1): EnginePort => ({
    postMessage(message) {
      const copy = structuredClone(message);
      setImmediate(() => {
        for (const handler of handlers[side === 0 ? 1 : 0]) handler(copy);
      });
    },
    onMessage(handler) {
      handlers[side].add(handler);
    },
  });
  return [end(0), end(1)];
}
