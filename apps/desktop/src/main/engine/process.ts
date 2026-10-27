import { MessageChannelMain, utilityProcess } from 'electron';
import {
  asEnginePort,
  EngineStatusSchema,
  type EngineStart,
  type ParentMessage,
} from '../../utility/link';
import type { EngineProcess } from './supervisor';

/** The engine process's name in the system's process list and in `app.getAppMetrics()`. */
const ENGINE_SERVICE_NAME = 'Architect engine';

/** Starts the engine host in a utility process and hands it its two ports. */
export function launchEngineProcess(
  entryPath: string,
  start: Omit<EngineStart, 'type'>,
): EngineProcess {
  const child = utilityProcess.fork(entryPath, [], { serviceName: ENGINE_SERVICE_NAME });
  const requests = new MessageChannelMain();
  const secrets = new MessageChannelMain();
  const message: ParentMessage = { type: 'start', ...start };
  child.postMessage(message, [requests.port2, secrets.port2]);
  child.once('exit', () => {
    requests.port1.close();
    secrets.port1.close();
  });

  return {
    requests: asEnginePort(requests.port1),
    secrets: asEnginePort(secrets.port1),
    onStatus(listener) {
      child.on('message', (raw: unknown) => {
        const status = EngineStatusSchema.safeParse(raw);
        if (status.success) listener(status.data);
        else console.error('[engine] The engine process sent a status Architect does not know.');
      });
    },
    onExit(listener) {
      child.on('exit', listener);
    },
    requestStop() {
      const stop: ParentMessage = { type: 'stop' };
      child.postMessage(stop);
    },
    kill() {
      child.kill();
    },
  };
}
