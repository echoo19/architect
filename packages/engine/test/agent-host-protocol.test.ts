import {
  GuardError,
  type WorkspaceChat,
  type WorkspaceEvent,
  type WorkspaceMessage,
} from '@architect/shared';
import { describe, expect, it } from 'vitest';
import { connectAgentHost } from '../src/agent-host/client';
import type { BlockedConnection, LoopbackGuard } from '../src/agent-host/guard/install';
import type { AgentHost } from '../src/agent-host/host';
import type { AgentHostPort } from '../src/agent-host/protocol';
import { serveAgentHost, type ServeOptions } from '../src/agent-host/serve';
import { portPair } from './fakes/ports';

const CHAT: WorkspaceChat = {
  id: 'cht_1',
  graduateId: 'grd_1',
  title: 'New chat',
  createdAt: '2026-11-05T09:00:00.000Z',
  updatedAt: '2026-11-05T09:00:00.000Z',
  running: false,
  waiting: false,
};

const MESSAGE: WorkspaceMessage = {
  id: 'msg_1',
  chatId: 'cht_1',
  role: 'agent',
  createdAt: '2026-11-05T09:00:01.000Z',
  text: 'Two invoices are unpaid.',
  steps: [],
  blocks: [],
  status: 'done',
};

/** A host that records the calls it gets and answers with fixed values. */
function stubHost(overrides: Partial<AgentHost> = {}) {
  const calls: unknown[][] = [];
  const listeners = new Set<(event: WorkspaceEvent) => void>();
  const host: AgentHost = {
    async openGraduate(...args) {
      calls.push(['openGraduate', ...args]);
    },
    async closeGraduate(...args) {
      calls.push(['closeGraduate', ...args]);
    },
    listChats: async () => [CHAT],
    createChat: async () => CHAT,
    messages: async () => [MESSAGE],
    async send(...args) {
      calls.push(['send', ...args]);
    },
    async stop(...args) {
      calls.push(['stop', ...args]);
    },
    async decide(...args) {
      calls.push(['decide', ...args]);
    },
    onEvent(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    close: async () => undefined,
    ...overrides,
  };
  const emit = (event: WorkspaceEvent) => {
    for (const listener of listeners) listener(event);
  };
  return { host, calls, emit };
}

function connect(overrides: Partial<AgentHost> = {}, options: ServeOptions = {}) {
  const [hostPort, clientPort] = portPair();
  const stub = stubHost(overrides);
  serveAgentHost(hostPort, stub.host, options);
  const errors: unknown[] = [];
  const client = connectAgentHost(clientPort, (error) => errors.push(error));
  return { ...stub, client, hostPort, clientPort, errors };
}

/** Sends a raw message on the port and waits for the response with its id. */
function raw(port: AgentHostPort, message: { id: number } & Record<string, unknown>) {
  return new Promise<Record<string, unknown>>((resolve) => {
    port.onMessage((reply) => {
      const response = reply as Record<string, unknown>;
      if (response.kind === 'response' && response.id === message.id) resolve(response);
    });
    port.postMessage(message);
  });
}

describe('the agent host protocol', () => {
  it('carries the workspace API over a port', async () => {
    const { client, calls } = connect();
    await client.openGraduate('grd_1', '/graduates/grd_1', '/workspace/grd_1');
    expect(await client.listChats('grd_1')).toEqual([CHAT]);
    expect(await client.createChat('grd_1')).toEqual(CHAT);
    expect(await client.messages('cht_1')).toEqual([MESSAGE]);
    await client.send('cht_1', 'Which invoices are unpaid?');
    await client.decide('chg_1', 'always');
    await client.stop('cht_1');
    await client.closeGraduate('grd_1');
    expect(calls).toEqual([
      ['openGraduate', 'grd_1', '/graduates/grd_1', '/workspace/grd_1'],
      ['send', 'cht_1', 'Which invoices are unpaid?'],
      ['decide', 'chg_1', 'always'],
      ['stop', 'cht_1'],
      ['closeGraduate', 'grd_1'],
    ]);
  });

  it('passes a graduate its CPU thread cap only when there is one', async () => {
    const { client, calls } = connect();
    await client.openGraduate('grd_1', '/graduates/grd_1', '/workspace/grd_1', 6);
    expect(calls).toEqual([['openGraduate', 'grd_1', '/graduates/grd_1', '/workspace/grd_1', 6]]);
  });

  it('streams workspace events and drops malformed ones', async () => {
    const { client, emit, hostPort, errors } = connect();
    const events: WorkspaceEvent[] = [];
    client.onEvent((event) => events.push(event));
    await client.listChats('grd_1');
    emit({ type: 'chat.updated', chat: CHAT });
    emit({ type: 'message.updated', message: MESSAGE });
    hostPort.postMessage({ kind: 'event', event: { type: 'chat.updated', chat: { id: 7 } } });
    await client.listChats('grd_1');
    expect(events).toEqual([
      { type: 'chat.updated', chat: CHAT },
      { type: 'message.updated', message: MESSAGE },
    ]);
    expect(errors).toHaveLength(1);
  });

  it('checks requests before they reach the host', async () => {
    const { client, calls, clientPort } = connect();
    await expect(client.send('cht_1', '')).rejects.toThrow('The request was invalid');
    const unknown = await raw(clientPort, {
      kind: 'request',
      id: 99,
      method: 'workspace.delete',
      params: [],
    });
    expect(unknown).toMatchObject({
      ok: false,
      error: { message: 'There is no "workspace.delete" request.' },
    });
    expect(calls).toEqual([]);
  });

  it('keeps the kind of an error across the port', async () => {
    const { client } = connect({
      openGraduate: () => Promise.reject(new GuardError('network', 'Not on this computer.')),
    });
    const error = await client.openGraduate('grd_1', '/g', '/d').catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(GuardError);
    expect(error).toMatchObject({ guard: 'network', message: 'Not on this computer.' });
  });

  it('holds requests until the host says it is ready', async () => {
    const [hostPort, clientPort] = portPair();
    const client = connectAgentHost(clientPort);
    const listing = client.listChats('grd_1');
    await new Promise((resolve) => setTimeout(resolve, 20));
    serveAgentHost(hostPort, stubHost().host);
    expect(await listing).toEqual([CHAT]);
  });

  it("reports the blocked calls of the process's guard", async () => {
    const attempt: BlockedConnection = {
      api: 'fetch',
      target: 'example.com:443',
      at: '2026-11-05T09:00:00.000Z',
    };
    const guard: LoopbackGuard = { blocked: () => [attempt], onBlocked: () => () => undefined };
    expect(await connect({}, { guard }).client.blockedConnections()).toEqual([attempt]);
    await expect(connect().client.blockedConnections()).rejects.toThrow('without a network guard');
  });

  it('fails a request whose answer is garbled instead of leaving it waiting', async () => {
    const [hostPort, clientPort] = portPair();
    hostPort.onMessage((message) => {
      // A void answer sent as JSON loses its `result`, which no longer reads as a response.
      hostPort.postMessage({ kind: 'response', id: (message as { id: number }).id, ok: true });
    });
    const client = connectAgentHost(clientPort);
    hostPort.postMessage({ kind: 'ready' });
    await expect(client.stop('cht_1')).rejects.toThrow('was malformed');
  });

  it('fails the requests still waiting when the client closes', async () => {
    const { client } = connect({ send: () => new Promise(() => undefined) });
    const sending = client.send('cht_1', 'Hello');
    await client.listChats('grd_1');
    client.close();
    await expect(sending).rejects.toThrow('closed');
    await expect(client.listChats('grd_1')).rejects.toThrow('closed');
  });
});
