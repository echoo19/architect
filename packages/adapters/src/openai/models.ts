import { AdapterError } from '@architect/shared';
import type { HttpClient } from '../http/client';
import { ModelListWire } from './wire';

type ModelProbe =
  { kind: 'listed' } | { kind: 'missing'; available: string[] } | { kind: 'unavailable' };

/** Errors that mean "this host has no model list" rather than "this host is unreachable". */
const NO_LIST = new Set(['not_found', 'bad_request', 'bad_response']);

/** A model id as requests name it. Google lists its models as `models/<id>`. */
export function modelId(listed: string): string {
  return listed.replace(/^models\//, '');
}

/** Asks `GET /models`, which costs nothing, whether the host offers `model`. */
export async function probeModel(
  http: HttpClient,
  model: string,
  signal?: AbortSignal,
): Promise<ModelProbe> {
  let ids: string[];
  try {
    const list = await http.getJson('/models', ModelListWire, { signal });
    ids = (Array.isArray(list) ? list : list.data).map((entry) => modelId(entry.id));
  } catch (error) {
    if (error instanceof AdapterError && NO_LIST.has(error.code)) return { kind: 'unavailable' };
    throw error;
  }
  return ids.includes(modelId(model)) ? { kind: 'listed' } : { kind: 'missing', available: ids };
}

/** A hint for a model the host doesn't list: a likely spelling, or what it does offer. */
export function describeMissingModel(model: string, available: readonly string[]): string {
  // Providers publish dated snapshots (`-1026`) that may not be listed under the dated name.
  const undated = model.replace(/-\d{3,8}$/, '');
  if (undated !== model && available.includes(undated)) {
    return `It lists "${undated}" instead. Try that id.`;
  }
  if (available.length === 0) return 'Its model list is empty.';
  const shown = available.slice(0, 5).join(', ');
  return available.length > 5
    ? `It offers ${shown}, and ${available.length - 5} more.`
    : `It offers ${shown}.`;
}
