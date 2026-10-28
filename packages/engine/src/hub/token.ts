import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { keyMayGoTo } from '@architect/shared';
import { HF_ENDPOINT } from './client';

/** Where a Hugging Face token was found. Never the token itself. */
export type HubTokenSource = 'saved' | 'HF_TOKEN' | 'HUGGING_FACE_HUB_TOKEN' | 'token_file';

export interface HubToken {
  value: string;
  source: HubTokenSource;
}

export interface HubTokenOptions {
  /** The key saved in the app (desktop only). */
  saved?: () => Promise<string | undefined>;
  /** Where HF_TOKEN and the token file's location are read. Default `process.env`. */
  env?: NodeJS.ProcessEnv;
  /** The address the token goes to. The saved key goes only to the Hub's own host. */
  endpoint?: string;
}

/** What the token sources say about it, never its value. */
export const HUB_TOKEN_SOURCES: Readonly<Record<HubTokenSource, string>> = {
  saved: 'the key saved in Architect',
  HF_TOKEN: 'HF_TOKEN',
  HUGGING_FACE_HUB_TOKEN: 'HUGGING_FACE_HUB_TOKEN',
  token_file: "Hugging Face's token file",
};

/** A token as huggingface_hub cleans one: no line breaks, no surrounding space; empty is none. */
function clean(value: string | undefined): string | undefined {
  const token = value?.replace(/[\r\n]/g, '').trim();
  return token ? token : undefined;
}

function expandHome(path: string): string {
  return path === '~' || path.startsWith('~/') || path.startsWith('~\\')
    ? join(homedir(), path.slice(1))
    : path;
}

/**
 * Where Hugging Face's own tools keep the token on this computer, as huggingface_hub finds it:
 * HF_TOKEN_PATH, else `token` in HF_HOME, which defaults to `huggingface` in XDG_CACHE_HOME or
 * `~/.cache`. `hf auth login` writes it there.
 */
export function hubTokenFile(env: NodeJS.ProcessEnv = process.env): string {
  if (env['HF_TOKEN_PATH']) return expandHome(env['HF_TOKEN_PATH']);
  const home = env['HF_HOME']
    ? expandHome(env['HF_HOME'])
    : join(
        env['XDG_CACHE_HOME'] ? expandHome(env['XDG_CACHE_HOME']) : join(homedir(), '.cache'),
        'huggingface',
      );
  return join(home, 'token');
}

/**
 * Finds the Hugging Face token the standard way, nearest first: the key saved in the app (only
 * when the token goes to the Hub itself), then HF_TOKEN (and the older HUGGING_FACE_HUB_TOKEN),
 * then Hugging Face's token file. Says where it came from, so a message can name the source
 * without ever showing the value.
 */
export async function findHubToken(options: HubTokenOptions = {}): Promise<HubToken | null> {
  const env = options.env ?? process.env;
  if (options.saved && keyMayGoTo('huggingface', options.endpoint ?? HF_ENDPOINT)) {
    const saved = clean(await options.saved());
    if (saved) return { value: saved, source: 'saved' };
  }
  for (const name of ['HF_TOKEN', 'HUGGING_FACE_HUB_TOKEN'] as const) {
    const value = clean(env[name]);
    if (value) return { value, source: name };
  }
  let text: string;
  try {
    text = await readFile(hubTokenFile(env), 'utf8');
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === 'ENOENT' || code === 'ENOTDIR') return null;
    throw new Error(
      `Hugging Face's token file at ${hubTokenFile(env)} can't be read: ${code ?? String(error)}.`,
      { cause: error },
    );
  }
  const value = clean(text);
  return value ? { value, source: 'token_file' } : null;
}

/** The token as a `HubClient` asks for it: looked up afresh each time a request needs it. */
export function hubTokenResolver(options: HubTokenOptions = {}): () => Promise<string | undefined> {
  return async () => (await findHubToken(options))?.value;
}
