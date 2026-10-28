import { createEngineDeps, createEngineHost, type EngineHost } from '@architect/engine';
import {
  asEnginePort,
  askForSecrets,
  ParentMessageSchema,
  type EngineStart,
  type EngineStatus,
  type PortMain,
} from './link';

/*
 * The engine host's utility process: a thin wrapper that starts the engine with the real
 * dependencies when main says `start`, and closes it when main says `stop`.
 */

const parent = process.parentPort;
let starting: Promise<EngineHost> | null = null;
/** Quiet mode for local models; students made from now on use it. */
let localThreads: number | undefined;
let localCooldown: number | undefined;

function report(status: EngineStatus): void {
  parent.postMessage(status);
}

async function start(message: EngineStart, ports: readonly PortMain[]): Promise<EngineHost> {
  const [requests, secrets] = ports;
  if (!requests || !secrets) throw new Error('The engine was started without its ports.');
  localThreads = message.localThreads;
  localCooldown = message.localCooldown;
  const host = await createEngineHost({
    dataDir: message.dataDir,
    deps: createEngineDeps({
      dataDir: message.dataDir,
      sandboxEntryPath: message.sandboxEntryPath,
      sampleJobFile: message.sampleJobFile,
      getSecret: askForSecrets(asEnginePort(secrets)),
      localThreads: () => localThreads,
      localCooldown: () => localCooldown,
    }),
  });
  host.serve(asEnginePort(requests));
  return host;
}

/** Interrupted runs resume the next time the engine starts. */
async function stop(): Promise<void> {
  const host = await starting?.catch(() => null);
  await host?.close();
  process.exit(0);
}

parent.on('message', (event) => {
  const message = ParentMessageSchema.parse(event.data);
  if (message.type === 'settings') {
    localThreads = message.localThreads;
    localCooldown = message.localCooldown;
    return;
  }
  if (message.type === 'stop') {
    stop().catch((error: unknown) => {
      console.error('[engine] The engine did not close cleanly.', error);
      process.exit(1);
    });
    return;
  }
  if (starting) return;
  starting = start(message, event.ports);
  starting.then(
    () => report({ type: 'ready' }),
    (error: unknown) => {
      // Main stops this process when it hears why, then tries again later.
      report({ type: 'failed', message: error instanceof Error ? error.message : String(error) });
    },
  );
});
