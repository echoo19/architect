import { findHubToken, HF_ENDPOINT, HubClient, hubTokenResolver } from '@architect/engine';
import type { HubTokenStatus } from '@architect/shared';

/** Reads a saved key by its ref; only `huggingface` is asked for here. */
export type SavedKey = () => Promise<string | undefined>;

/**
 * The Hub the app publishes to and installs from: HF_ENDPOINT, as Hugging Face's own tools and
 * the architect command read it, else huggingface.co.
 */
export function hubEndpoint(env: NodeJS.ProcessEnv = process.env): string {
  return env['HF_ENDPOINT'] || HF_ENDPOINT;
}

/**
 * The Hub client the engine publishes and installs with. The token is looked up the standard way
 * whenever a request needs one, and the key saved in the app goes only to huggingface.co, never to
 * another Hub HF_ENDPOINT names. While a closed network is on (decision 098), a Hub outside it is
 * refused before anything is sent.
 */
export function hubClient(
  saved: SavedKey,
  allowedHosts: () => readonly string[] | undefined,
  env: NodeJS.ProcessEnv = process.env,
): HubClient {
  const endpoint = hubEndpoint(env);
  return new HubClient({
    endpoint,
    token: hubTokenResolver({ saved, env, endpoint }),
    allowedHosts,
  });
}

/**
 * Where the token that publishing would use comes from, found the way publishing finds it: the
 * saved key, then HF_TOKEN, then Hugging Face's token file. Never the token itself.
 */
export async function hubTokenStatus(
  saved: SavedKey,
  env: NodeJS.ProcessEnv = process.env,
): Promise<HubTokenStatus> {
  const token = await findHubToken({ saved, env, endpoint: hubEndpoint(env) });
  return { source: token?.source ?? null };
}
