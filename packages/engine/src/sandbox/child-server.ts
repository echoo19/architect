import { getQuickJS } from 'quickjs-emscripten';
import { BlobCache } from './blob-cache';
import {
  referencedHashes,
  RunRequestSchema,
  type ChildMessage,
  type ChildOutcome,
  type SandboxFailure,
} from './protocol';
import { runJob } from './vm';

/** Raw characters of table and text data the child keeps between jobs. */
const CACHE_LIMIT_CHARS = 16 * 1024 * 1024;

/**
 * Serves sandbox jobs over the IPC channel, one at a time. Each job runs in a fresh QuickJS
 * runtime. If the VM itself breaks, the child reports it and exits so the engine starts a fresh
 * process for the next job.
 */
export async function startSandboxChild(): Promise<void> {
  if (!process.send) throw new Error('The sandbox child must be started with child_process.fork.');
  process.on('disconnect', () => process.exit(0));
  const quickjs = await getQuickJS();
  const cache = new BlobCache(CACHE_LIMIT_CHARS);

  process.on('message', (raw: unknown) => {
    const parsed = RunRequestSchema.safeParse(raw);
    if (!parsed.success) {
      process.stderr.write(`The sandbox received a malformed request: ${parsed.error.message}\n`);
      process.exit(2);
    }
    const request = parsed.data;
    for (const [hash, content] of Object.entries(request.blobs)) cache.add(hash, content);
    const needed = referencedHashes(request.job);
    const missing = needed.filter((hash) => !cache.has(hash));
    if (missing.length > 0) {
      send({ type: 'missing', id: request.id, hashes: missing });
      return;
    }
    cache.retain(needed);

    let outcome: ChildOutcome;
    try {
      outcome = runJob(quickjs, request.job, request.limits, cache);
    } catch (error) {
      send(
        { type: 'result', id: request.id, outcome: { ok: false, failure: vmFailure(error) } },
        () => process.exit(1),
      );
      return;
    }
    send({ type: 'result', id: request.id, outcome });
  });

  send({ type: 'ready' });
}

function send(message: ChildMessage, then?: () => void): void {
  process.send?.(message, undefined, undefined, then);
}

function vmFailure(error: unknown): SandboxFailure {
  if (error instanceof RangeError && /call stack/i.test(error.message)) {
    return { kind: 'error', message: 'The code recursed too deeply (stack overflow).' };
  }
  const detail = error instanceof Error ? error.message : String(error);
  return { kind: 'crashed', message: `The sandbox broke while running the code: ${detail}` };
}
