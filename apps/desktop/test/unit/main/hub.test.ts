import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { hubEndpoint, hubTokenStatus } from '../../../src/utility/hub';

const folders: string[] = [];

afterEach(async () => {
  for (const folder of folders.splice(0)) await rm(folder, { recursive: true, force: true });
});

/** An environment with no Hugging Face token anywhere but what the test names. */
async function environment(extra: Record<string, string> = {}): Promise<NodeJS.ProcessEnv> {
  const folder = await mkdtemp(join(tmpdir(), 'architect-hub-token-'));
  folders.push(folder);
  return { HF_TOKEN_PATH: join(folder, 'token'), ...extra };
}

const SAVED = 'hf_saved_value_0123456789';
const saved = async () => SAVED;
const none = async () => undefined;

describe('where the Hugging Face token comes from', () => {
  it('names the saved key first, then HF_TOKEN, then the token file, and never the value', async () => {
    const env = await environment({ HF_TOKEN: 'hf_environment_0123456789' });
    const fromSaved = await hubTokenStatus(saved, env);
    expect(fromSaved).toEqual({ source: 'saved' });
    expect(JSON.stringify(fromSaved)).not.toContain(SAVED);

    expect(await hubTokenStatus(none, env)).toEqual({ source: 'HF_TOKEN' });

    const file = await environment();
    await writeFile(file['HF_TOKEN_PATH'] ?? '', 'hf_file_0123456789\n');
    expect(await hubTokenStatus(none, file)).toEqual({ source: 'token_file' });
    expect(await hubTokenStatus(none, await environment())).toEqual({ source: null });
  });

  it('keeps the saved key for huggingface.co, so another Hub uses HF_TOKEN', async () => {
    const env = await environment({
      HF_ENDPOINT: 'http://127.0.0.1:5173',
      HF_TOKEN: 'hf_environment_0123456789',
    });
    expect(hubEndpoint(env)).toBe('http://127.0.0.1:5173');
    expect(await hubTokenStatus(saved, env)).toEqual({ source: 'HF_TOKEN' });
    expect(hubEndpoint({})).toBe('https://huggingface.co');
  });
});
