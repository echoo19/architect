import { connectEngine, type EngineClient } from '@architect/engine';
import { MessageChannelMain, utilityProcess } from 'electron';
import {
  answerSecretLookups,
  asEnginePort,
  EngineStatusSchema,
  type EngineSettings,
  type EngineStart,
  type ParentMessage,
} from '../../utility/link';
import type { SupervisedProcess } from '../processes/supervisor';

/** The engine process's name in the system's process list and in `app.getAppMetrics()`. */
const ENGINE_SERVICE_NAME = 'Architect engine';

/**
 * Starts the engine host in a utility process and hands it two ports: one for engine requests,
 * answers and run events, and one on which it asks main for secrets, so keys are decrypted only
 * in main and the engine process.
 */
/** The engine process, which also follows setting changes while it runs. */
export interface EngineProcess extends SupervisedProcess<EngineClient> {
  applySettings(settings: Omit<EngineSettings, 'type'>): void;
}

export function launchEngineProcess(
  entryPath: string,
  start: Omit<EngineStart, 'type'>,
  getSecret: (ref: string) => Promise<string | undefined>,
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
  answerSecretLookups(asEnginePort(secrets.port1), getSecret);
  const report = (error: unknown) => console.error('[engine]', error);

  return {
    client: connectEngine(asEnginePort(requests.port1), report),
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
    applySettings(settings) {
      const message: ParentMessage = { type: 'settings', ...settings };
      child.postMessage(message);
    },
    kill() {
      child.kill();
    },
  };
}
