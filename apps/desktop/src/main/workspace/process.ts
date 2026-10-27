import { connectAgentHost, type AgentHostClient } from '@architect/engine/agent-host';
import { utilityProcess } from 'electron';
import { z } from 'zod';
import type { SupervisedProcess } from '../processes/supervisor';

/** The agent host's name in the system's process list and in `app.getAppMetrics()`. */
const AGENT_HOST_SERVICE_NAME = 'Architect workspace';

/** What the host sends once it is listening. */
const ReadySchema = z.object({ kind: z.literal('ready') });

export interface AgentHostLaunch {
  /** The built agent host entry. */
  entryPath: string;
  /** The app's data folder, whose database the host shares with the engine. */
  dataDir: string;
  /** The built sandbox child, for the graduates' tools. */
  sandboxEntryPath: string;
  env: NodeJS.ProcessEnv;
}

/**
 * Starts the agent host, which runs workspace chats with graduates, in a utility process of its
 * own. It installs its loopback-only network guard before anything else loads and talks to main
 * over the process's parent port.
 */
export function launchAgentHostProcess(
  launch: AgentHostLaunch,
): SupervisedProcess<AgentHostClient> {
  const child = utilityProcess.fork(
    launch.entryPath,
    ['--data-dir', launch.dataDir, '--sandbox-entry', launch.sandboxEntryPath],
    { serviceName: AGENT_HOST_SERVICE_NAME, env: launch.env },
  );
  const port = {
    postMessage: (message: unknown) => child.postMessage(message),
    onMessage(handler: (message: unknown) => void) {
      child.on('message', handler);
    },
  };

  return {
    client: connectAgentHost(port, (error) => console.error('[workspace]', error)),
    onStatus(listener) {
      child.on('message', (message: unknown) => {
        if (ReadySchema.safeParse(message).success) listener({ type: 'ready' });
      });
    },
    onExit(listener) {
      child.on('exit', listener);
    },
    // The host keeps nothing in memory that needs saving: a reply cut short is closed off the
    // next time its graduate is opened.
    requestStop() {
      child.kill();
    },
    kill() {
      child.kill();
    },
  };
}
