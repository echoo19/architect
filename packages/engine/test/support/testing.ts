import { fileURLToPath } from 'node:url';

/**
 * The engine's test fakes and fixtures, for tests in other packages (the command line's) that
 * need the same ones: one fake Hub, one fake Ollama, one stand-in llama-server, one way to make a
 * graduate, and one computer to run on.
 */
export type { ObservedConnection } from '../agent-host/connection-observer';
export {
  startFakeOllama,
  type FakeOllama,
  type OllamaChatBody,
  type ScriptedTurn,
} from '../agent-host/fake-ollama';
export { addGraduate, type GraduateFixture, type GraduateOptions } from '../agent-host/graduates';
export {
  fakeLlamaCommand,
  recorded,
  standInAdapter,
  storeBase,
  type Recorded,
} from './adapter-runtime';
export { FAKE_HUB_TOKEN, startFakeHub, type FakeHub, type FakeHubOptions } from './fake-hub';
export { SAMPLE_CONTENT } from './fixtures';
export { ACADEMY_JOB_FILE, importJobInto } from './field';
export { experimentWorld, type ExperimentWorld } from './experiment-world';
export { THIS_MACHINE } from './machine';
export { openEngineStore } from '../../src/store/engine-store';

/** The agent host's process entry, as the desktop app starts it. */
export const AGENT_HOST_ENTRY = fileURLToPath(
  new URL('../../src/agent-host/main.ts', import.meta.url),
);

/**
 * The engine host as the desktop's utility process runs it, in a Node child that serves the
 * engine's protocol over its IPC channel (`fixtures/engine-host.ts`).
 */
export const ENGINE_HOST_FIXTURE = fileURLToPath(
  new URL('../fixtures/engine-host.ts', import.meta.url),
);

/**
 * A module to load with `--import` ahead of a process's entry: it writes every connection and
 * name lookup that gets past the network guard to the file in ARCHITECT_CONNECTION_LOG.
 */
export const CONNECTION_OBSERVER = new URL('../agent-host/connection-observer.ts', import.meta.url)
  .href;

/**
 * A module to load with `--import`, after tsx, ahead of a process's entry: as far as its
 * installation checks can tell, the process is on the computer in ARCHITECT_TEST_MACHINE (a
 * `Machine` as JSON), as an in-process test names THIS_MACHINE.
 */
export const STATED_MACHINE = new URL('../fixtures/stated-machine.ts', import.meta.url).href;
