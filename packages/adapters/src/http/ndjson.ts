import { badResponse } from './errors';
import { LineBuffer } from './lines';

/** Every JSON value in a newline-delimited stream, in order. Blank lines are skipped. */
export async function* readNdjson(
  chunks: AsyncIterable<Uint8Array>,
  service: string,
): AsyncGenerator<unknown> {
  const decoder = new TextDecoder();
  const lines = new LineBuffer();
  for await (const chunk of chunks) {
    for (const line of lines.push(decoder.decode(chunk, { stream: true }))) {
      yield* parseLine(line, service);
    }
  }
  for (const line of [...lines.push(decoder.decode()), ...lines.flush()]) {
    yield* parseLine(line, service);
  }
}

function parseLine(line: string, service: string): unknown[] {
  if (line.trim() === '') return [];
  try {
    return [JSON.parse(line)];
  } catch (cause) {
    throw badResponse(service, "a line that isn't valid JSON", cause);
  }
}
