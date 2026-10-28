import type { ModelEntry } from '@architect/shared';
import { ModelPageWire } from '../anthropic/wire';
import type { HttpClient } from '../http/client';

/** Pages to read at most; Anthropic lists a few dozen models. */
const MAX_PAGES = 10;

/** Every model in Anthropic's list, newest first, with its name for people and its context window. */
export async function listAnthropicModels(
  http: HttpClient,
  signal?: AbortSignal,
): Promise<ModelEntry[]> {
  const models: ModelEntry[] = [];
  let after: string | undefined;
  for (let page = 0; page < MAX_PAGES; page++) {
    const query = after === undefined ? '' : `&after_id=${encodeURIComponent(after)}`;
    const result = await http.getJson(`/models?limit=1000${query}`, ModelPageWire, { signal });
    for (const model of result.data) {
      const entry: ModelEntry = { id: model.id };
      if (model.display_name) entry.label = model.display_name;
      if (model.max_input_tokens) entry.contextLength = model.max_input_tokens;
      models.push(entry);
    }
    if (!result.has_more || !result.last_id) break;
    after = result.last_id;
  }
  return models;
}
