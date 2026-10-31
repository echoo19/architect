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
  ClosedNetworkSchema,
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
  closedNetwork: ClosedNetworkSchema.optional().catch(undefined),
});

/**
 * What this command's llama-server starts with, from the app's own settings file, the way the app
 * gives its hosts theirs: the program chosen in Settings, quiet mode's thread cap, and the
 * default student's Ollama when it is on this computer. A missing or unreadable file means the
 * app's defaults, as when the app starts.
 */
function storedSettings(dataDir: string): z.infer<typeof StoredSchema> {
  let raw: unknown = {};
  try {
    raw = JSON.parse(readFileSync(join(dataDir, 'settings.json'), 'utf8'));
  } catch {
    // No settings yet, or a file the app would start from defaults over too.
  }
  return StoredSchema.parse(typeof raw === 'object' && raw !== null ? raw : {});
}

export function appRuntimeSettings(
  dataDir: string,
  logicalCores: number = cpus().length,
): LocalRuntimeSettings {
  const settings = storedSettings(dataDir);
  return runtimeSettingsOf(settings, quietThreadCap(settings.quietLocalModels, logicalCores));
}

/**
 * The closed network's hosts from the app's settings (decision 098), or undefined while none is
 * on: a command teaches inside the same walls the app does.
 */
export function appAllowedHosts(dataDir: string): string[] | undefined {
  return allowedHostsOf(storedSettings(dataDir).closedNetwork);
}
