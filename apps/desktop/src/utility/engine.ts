import {
  createEngineDeps,
  createEngineHost,
  DataPaths,
  GpuLease,
  hostAdapterRuntime,
  hubTokenResolver,
  RUN_PURPOSE,
  type EngineHost,
} from '@architect/engine';
import { hubClient } from './hub';
import {
  asEnginePort,
  askForSecrets,
  ParentMessageSchema,
  type EngineSettings,
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
/** The engine's share of the GPU lease, which the workspace and the command take too. */
let gpu: GpuLease | null = null;
/** Quiet mode and llama-server's settings; students and servers started from now on use them. */
let followed: Omit<EngineSettings, 'type'> = {};

function report(status: EngineStatus): void {
  parent.postMessage(status);
}

function follow(settings: Omit<EngineSettings, 'type'>): void {
  const { localThreads, localCooldown, llamaServerPath, ollamaUrl } = settings;
  followed = { localThreads, localCooldown, llamaServerPath, ollamaUrl };
}

async function start(message: EngineStart, ports: readonly PortMain[]): Promise<EngineHost> {
  const [requests, secrets] = ports;
  if (!requests || !secrets) throw new Error('The engine was started without its ports.');
  follow(message);
  // The GPU goes to one of Architect's processes at a time (decision 046): a run takes it for each
  // request and a check for its one, after any reply someone is reading.
  const lease = new GpuLease({
    dataDir: message.dataDir,
    owner: 'engine',
    onError: (error) => console.error('[engine] The GPU lease:', error),
  });
  gpu = lease;
  // One llama-server for the whole engine: its runs' adapter students and its install checks.
  const adapterRuntime = hostAdapterRuntime({
    runtimeDir: new DataPaths(message.dataDir).runtimeDir('engine'),
    settings: () => ({
      ...(followed.llamaServerPath === undefined
        ? {}
        : { llamaServerPath: followed.llamaServerPath }),
      ...(followed.localThreads === undefined ? {} : { threads: followed.localThreads }),
      ...(followed.ollamaUrl === undefined ? {} : { ollamaUrl: followed.ollamaUrl }),
    }),
    gpu: lease,
    purpose: RUN_PURPOSE,
    ...(message.llamaServerCommand === undefined ? {} : { command: message.llamaServerCommand }),
  });
  const getSecret = askForSecrets(asEnginePort(secrets));
  const savedHubKey = () => getSecret('huggingface');
  const host = await createEngineHost({
    dataDir: message.dataDir,
    // Publishing and installing go to the Hub HF_ENDPOINT names, huggingface.co by default.
    hub: hubClient(savedHubKey),
    deps: createEngineDeps({
      dataDir: message.dataDir,
      sandboxEntryPath: message.sandboxEntryPath,
      sampleJobFile: message.sampleJobFile,
      trainerDir: message.trainerDir,
      getSecret,
      // Training finds the Hugging Face token the way publishing does: the saved key, then
      // HF_TOKEN, then Hugging Face's token file.
      huggingFaceToken: hubTokenResolver({ saved: savedHubKey }),
      localThreads: () => followed.localThreads,
      localCooldown: () => followed.localCooldown,
      adapterRuntime,
    }),
    adapterRuntime,
    gpu: lease,
  });
  host.serve(asEnginePort(requests));
  return host;
}

/** Interrupted runs resume the next time the engine starts. */
async function stop(): Promise<void> {
  const host = await starting?.catch(() => null);
  await host?.close();
  await gpu?.close();
  process.exit(0);
}

parent.on('message', (event) => {
  const message = ParentMessageSchema.parse(event.data);
  if (message.type === 'settings') {
    follow(message);
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
