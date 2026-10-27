import type { RequestGuard } from './guard';

/** The response body as it arrives. The guard's watchdog runs only while we wait for the network. */
export async function* readChunks(
  response: Response,
  guard: RequestGuard,
  idleMs: number,
): AsyncGenerator<Uint8Array> {
  if (!response.body) return;
  const reader = response.body.getReader();
  try {
    for (;;) {
      guard.arm(idleMs);
      const { done, value } = await reader.read();
      guard.disarm();
      if (done) return;
      yield value;
    }
  } catch (error) {
    throw guard.classify(error);
  } finally {
    guard.disarm();
  }
}

/** The body as text, stopping early once `limit` bytes have arrived. */
export async function readText(
  response: Response,
  guard: RequestGuard,
  idleMs: number,
  limit = Number.POSITIVE_INFINITY,
): Promise<string> {
  const decoder = new TextDecoder();
  let text = '';
  let size = 0;
  for await (const chunk of readChunks(response, guard, idleMs)) {
    size += chunk.byteLength;
    text += decoder.decode(chunk, { stream: true });
    if (size >= limit) break;
  }
  return text + decoder.decode();
}
