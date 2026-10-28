import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { findHubToken, hubTokenFile, hubTokenResolver } from '../src/hub';

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'architect-hub-token-'));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

/** An environment whose token file is in the test's folder, written when `token` is given. */
function envWith(variables: Record<string, string>, token?: string): NodeJS.ProcessEnv {
  const home = join(dir, 'hf-home');
  if (token !== undefined) {
    mkdirSync(home, { recursive: true });
    writeFileSync(join(home, 'token'), token);
  }
  return { HF_HOME: home, ...variables };
}

const saved = (value: string | undefined) => async () => value;

describe('finding the Hugging Face token', () => {
  it("prefers the app's saved key, then HF_TOKEN, then the token file", async () => {
    const env = envWith({ HF_TOKEN: 'hf_from_env' }, 'hf_from_file\n');
    expect(await findHubToken({ saved: saved('hf_saved'), env })).toEqual({
      value: 'hf_saved',
      source: 'saved',
    });
    expect(await findHubToken({ saved: saved(undefined), env })).toEqual({
      value: 'hf_from_env',
      source: 'HF_TOKEN',
    });
    expect(await findHubToken({ env: envWith({}, '  hf_from_file\r\n') })).toEqual({
      value: 'hf_from_file',
      source: 'token_file',
    });
  });

  it('reads the older variable name, and passes over empty values', async () => {
    expect(
      await findHubToken({ env: envWith({ HF_TOKEN: '  ', HUGGING_FACE_HUB_TOKEN: 'hf_old' }) }),
    ).toEqual({ value: 'hf_old', source: 'HUGGING_FACE_HUB_TOKEN' });
    expect(await findHubToken({ env: envWith({ HF_TOKEN: '\n' }, '\n') })).toBeNull();
    expect(await findHubToken({ env: envWith({}) })).toBeNull();
  });

  it("never offers the saved key to an address that isn't the Hub's own", async () => {
    const env = envWith({ HF_TOKEN: 'hf_from_env' });
    for (const endpoint of [
      'http://127.0.0.1:4000',
      'https://hf-mirror.example',
      'http://huggingface.co',
    ]) {
      expect(await findHubToken({ saved: saved('hf_saved'), env, endpoint })).toMatchObject({
        source: 'HF_TOKEN',
      });
    }
    expect(
      await findHubToken({
        saved: saved('hf_saved'),
        env: envWith({}),
        endpoint: 'http://127.0.0.1:4000',
      }),
    ).toBeNull();
  });

  it('finds the token file where huggingface_hub does', () => {
    expect(hubTokenFile({ HF_TOKEN_PATH: '/keys/hf' })).toBe('/keys/hf');
    expect(hubTokenFile({ HF_HOME: '/data/hf' })).toBe(join('/data/hf', 'token'));
    expect(hubTokenFile({ XDG_CACHE_HOME: '/cache' })).toBe(join('/cache', 'huggingface', 'token'));
    expect(hubTokenFile({ HF_HOME: '~/hf' })).toBe(join(homedir(), 'hf', 'token'));
    expect(hubTokenFile({})).toBe(join(homedir(), '.cache', 'huggingface', 'token'));
  });

  it('looks again every time, so a token added later is used', async () => {
    const env = envWith({});
    const token = hubTokenResolver({ env });
    expect(await token()).toBeUndefined();
    envWith({}, 'hf_added_later');
    expect(await token()).toBe('hf_added_later');
  });
});
