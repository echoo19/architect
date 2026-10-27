import type { EnginePort } from '@architect/engine';
import { z } from 'zod';

/*
 * How the main process and the engine's utility process talk. Main sends `start` with two ports:
 * the first carries engine requests, answers and run events; the second carries the engine's
 * secret lookups, which only main can answer. Messages are checked on arrival in both processes.
 */

export const EngineStartSchema = z.object({
  type: z.literal('start'),
  /** The app's data folder. */
  dataDir: z.string().min(1),
  /** The built sandbox child, in a real folder the engine can fork it from. */
  sandboxEntryPath: z.string().min(1),
  sampleJobFile: z.string().min(1),
});
export type EngineStart = z.infer<typeof EngineStartSchema>;

/** Main to the engine process. */
export const ParentMessageSchema = z.discriminatedUnion('type', [
  EngineStartSchema,
  z.object({ type: z.literal('stop') }),
]);
export type ParentMessage = z.infer<typeof ParentMessageSchema>;

/** The engine process to main: it is serving, or it could not start and why. */
export const EngineStatusSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('ready') }),
  z.object({ type: z.literal('failed'), message: z.string() }),
]);
export type EngineStatus = z.infer<typeof EngineStatusSchema>;

const SecretRequestSchema = z.object({
  id: z.number().int().nonnegative(),
  ref: z.string().min(1),
});

const SecretReplySchema = z.discriminatedUnion('ok', [
  z.object({
    id: z.number().int().nonnegative(),
    ok: z.literal(true),
    value: z.string().nullable(),
  }),
  z.object({ id: z.number().int().nonnegative(), ok: z.literal(false), error: z.string() }),
]);
type SecretReply = z.infer<typeof SecretReplySchema>;

/** Long enough for any keychain prompt; main answers lookups straight from its store. */
const SECRET_TIMEOUT_MS = 30_000;

/** The parts of Electron's `MessagePortMain` the link uses. */
export interface PortMain {
  postMessage(message: unknown): void;
  on(event: 'message', listener: (event: { data: unknown }) => void): unknown;
  start(): void;
}

export function asEnginePort(port: PortMain): EnginePort {
  return {
    postMessage: (message) => port.postMessage(message),
    onMessage(handler) {
      port.on('message', (event) => handler(event.data));
      port.start();
    },
  };
}

/** The engine process's side: looks up a secret by asking main over the port. */
export function askForSecrets(
  port: EnginePort,
  timeoutMs = SECRET_TIMEOUT_MS,
): (ref: string) => Promise<string | undefined> {
  const pending = new Map<number, (reply: SecretReply) => void>();
  let nextId = 1;

  port.onMessage((message) => {
    const reply = SecretReplySchema.safeParse(message);
    if (!reply.success) return;
    const settle = pending.get(reply.data.id);
    pending.delete(reply.data.id);
    settle?.(reply.data);
  });

  return (ref) =>
    new Promise((resolve, reject) => {
      const id = nextId++;
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(new Error(`Architect didn't answer the lookup of the "${ref}" key in time.`));
      }, timeoutMs);
      pending.set(id, (reply) => {
        clearTimeout(timer);
        if (reply.ok) resolve(reply.value ?? undefined);
        else reject(new Error(reply.error));
      });
      port.postMessage({ id, ref });
    });
}

/** Main's side: answers the engine's secret lookups from the store. */
export function answerSecretLookups(
  port: EnginePort,
  lookup: (ref: string) => Promise<string | undefined>,
): void {
  port.onMessage((message) => {
    const request = SecretRequestSchema.safeParse(message);
    if (!request.success) return;
    const { id, ref } = request.data;
    lookup(ref).then(
      (value) => port.postMessage({ id, ok: true, value: value ?? null }),
      (error: unknown) =>
        port.postMessage({
          id,
          ok: false,
          error: error instanceof Error ? error.message : `The "${ref}" key could not be read.`,
        }),
    );
  });
}
