import { readFileSync } from 'node:fs';
import { cpus } from 'node:os';
import { join } from 'node:path';
import {
  quietThreadCap,
  runtimeSettingsOf,
  type LocalRuntimeSettings,
} from '@architect/engine/local-runtime';
import {
  allowedHostsOf,
  readClosedNetwork,
  unreadableClosedNetwork,
  type StoredClosedNetwork,
  DEFAULT_STUDENT,
  StudentEndpointSchema,
} from '@architect/shared';
import { z } from 'zod';

/**
 * The parts of the app's `settings.json` a llama-server follows, read leniently as the app reads
 * them: a field that is missing or no longer valid falls back to the app's default.
 */
const StoredSchema = z.object({
  llamaServerPath: z.string().min(1).optional().catch(undefined),
  quietLocalModels: z.boolean().catch(false),
  defaultStudent: StudentEndpointSchema.catch(() => ({
    runtime: DEFAULT_STUDENT.runtime,
    baseUrl: DEFAULT_STUDENT.baseUrl,
    model: DEFAULT_STUDENT.model,
    contextLength: DEFAULT_STUDENT.contextLength,
  })),
});

/**
 * What this command's llama-server starts with, from the app's own settings file, the way the app
 * gives its hosts theirs: the program chosen in Settings, quiet mode's thread cap, and the
 * default student's Ollama when it is on this computer. A missing or unreadable file means the
 * app's defaults, as when the app starts.
 */
/** Errors a reader on Windows sees for a moment while the app replaces the file by a rename. */
const BUSY = new Set(['EPERM', 'EBUSY', 'EACCES']);

function pause(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

/**
 * The settings file's text: null when there is none, undefined when it is there but couldn't be
 * read even after a few tries.
 */
function settingsText(dataDir: string): string | null | undefined {
  const file = join(dataDir, 'settings.json');
  for (let attempt = 0; ; attempt++) {
    try {
      return readFileSync(file, 'utf8');
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code ?? '';
      if (code === 'ENOENT') return null;
      if (!BUSY.has(code) || attempt >= 4) return undefined;
      pause(50);
    }
  }
}

interface Stored {
  settings: z.infer<typeof StoredSchema>;
  network: StoredClosedNetwork;
}

function storedSettings(dataDir: string): Stored {
  const text = settingsText(dataDir);
  if (text === undefined) {
    return { settings: StoredSchema.parse({}), network: unreadableClosedNetwork() };
  }
  let raw: unknown;
  try {
    raw = text === null ? {} : JSON.parse(text);
  } catch {
    // A file that isn't JSON: the app's defaults, but a closed network it may hold fails closed.
    return {
      settings: StoredSchema.parse({}),
      network: text?.includes('closedNetwork') === true ? unreadableClosedNetwork() : {},
    };
  }
  const record = typeof raw === 'object' && raw !== null ? (raw as Record<string, unknown>) : {};
  return {
    settings: StoredSchema.parse(record),
    network: readClosedNetwork(record['closedNetwork']),
  };
}

export function appRuntimeSettings(
  dataDir: string,
  logicalCores: number = cpus().length,
): LocalRuntimeSettings {
  const { settings } = storedSettings(dataDir);
  return runtimeSettingsOf(settings, quietThreadCap(settings.quietLocalModels, logicalCores));
}

/**
 * The closed network's hosts from the app's settings (decision 098), or undefined while none is
 * on: a command teaches inside the same walls the app does.
 */
export function appAllowedHosts(dataDir: string): string[] | undefined {
  return allowedHostsOf(storedSettings(dataDir).network.network);
}

/** What couldn't be read of the app's closed network, which then stays on (decision 098). */
export function appClosedNetworkProblem(dataDir: string): string | undefined {
  return storedSettings(dataDir).network.problem;
}
