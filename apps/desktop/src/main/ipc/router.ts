import { CodedError, type ArchitectApi } from '@architect/shared';
import { z } from 'zod';
import {
  channel,
  invokeChannels,
  invokeMethods,
  type Domain,
  type EventDomain,
  type EventMethod,
  type EventPayload,
  type InvokeArgs,
  type InvokeMethod,
  type IpcResult,
} from '../../common/ipc';

/** The parts of Electron's ipcMain and webContents the router uses, so tests can fake them. */
export interface IpcMainLike {
  handle(
    channel: string,
    listener: (event: IpcEventLike, ...args: unknown[]) => Promise<IpcResult<unknown>>,
  ): void;
}

export interface IpcEventLike {
  senderFrame: { url: string } | null;
}

export interface EventSink {
  send(channel: string, payload: unknown): void;
  isDestroyed(): boolean;
}

type Handler<F> = F extends (...args: infer A) => Promise<infer R>
  ? (...args: A) => R | Promise<R>
  : never;

/** One handler per request method of a domain, typed from ArchitectApi. */
export type DomainHandlers<D extends Domain> = {
  [M in InvokeMethod<D>]: Handler<ArchitectApi[D][M]>;
};

/** Optional zod tuples that incoming arguments must match before a handler runs. */
export type ArgSchemas<D extends Domain> = {
  [M in InvokeMethod<D>]?: z.ZodType<InvokeArgs<D, M>>;
};

type AnyHandler = (...args: unknown[]) => unknown;

export interface IpcRouterOptions {
  ipcMain: IpcMainLike;
  /** True for the app's own pages. Calls from anywhere else are refused. */
  isTrustedSender: (url: string) => boolean;
  /** Where events go: the web contents of every open window. */
  targets: () => EventSink[];
}

function failure(message: string, code?: string): IpcResult<never> {
  return { ok: false, error: code === undefined ? { message } : { message, code } };
}

function messageOf(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  return 'Something went wrong in the main process.';
}

/**
 * Routes `<domain>:<method>` channels to handlers. A dispatcher is installed on every channel
 * up front, so a domain that hasn't registered yet answers with a clear error instead of
 * leaving the renderer waiting.
 */
export class IpcRouter {
  private readonly handlers = new Map<string, AnyHandler>();

  constructor(private readonly options: IpcRouterOptions) {
    for (const name of invokeChannels()) {
      options.ipcMain.handle(name, (event, ...args) => this.dispatch(name, event, args));
    }
  }

  registerHandlers<D extends Domain>(
    domain: D,
    handlers: DomainHandlers<D>,
    schemas: ArgSchemas<D> = {},
  ): void {
    for (const method of invokeMethods(domain)) {
      const name = channel(domain, method);
      if (this.handlers.has(name)) throw new Error(`${name} already has a handler.`);
      const handler = handlers[method] as AnyHandler;
      const schema: z.ZodType<unknown[]> | undefined = schemas[method];
      this.handlers.set(
        name,
        schema ? (...args) => handler(...parseArgs(schema, args, `${domain}.${method}`)) : handler,
      );
    }
  }

  emit<D extends EventDomain, M extends EventMethod<D>>(
    domain: D,
    method: M,
    payload: EventPayload<D, M>,
  ): void {
    const name = channel(domain, method);
    for (const target of this.options.targets()) {
      if (!target.isDestroyed()) target.send(name, payload);
    }
  }

  private async dispatch(
    name: string,
    event: IpcEventLike,
    args: unknown[],
  ): Promise<IpcResult<unknown>> {
    if (!this.options.isTrustedSender(event.senderFrame?.url ?? '')) {
      return failure(`Refused ${name}: the request didn't come from Architect's own window.`);
    }
    const handler = this.handlers.get(name);
    if (!handler) {
      const label = name.replace(':', '.');
      return failure(`The engine isn't connected yet, so ${label} can't run.`, 'process_starting');
    }
    try {
      return { ok: true, value: await handler(...args) };
    } catch (error) {
      if (!(error instanceof ArgumentError)) console.error(`[ipc] ${name} failed:`, error);
      return failure(messageOf(error), error instanceof CodedError ? error.code : undefined);
    }
  }
}

class ArgumentError extends Error {
  override readonly name = 'ArgumentError';
}

function parseArgs(schema: z.ZodType<unknown[]>, args: unknown[], label: string): unknown[] {
  const result = schema.safeParse(args);
  if (result.success) return result.data;
  throw new ArgumentError(`Invalid arguments for ${label}: ${z.prettifyError(result.error)}`);
}
