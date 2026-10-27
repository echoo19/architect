/**
 * A message channel to or from the engine host. Electron's `utilityProcess` port, a Node worker's
 * `parentPort` and an in-memory pair in tests all fit behind it. Messages are plain data that
 * structured clone can carry.
 */
export interface EnginePort {
  postMessage(message: unknown): void;
  onMessage(handler: (message: unknown) => void): void;
}
