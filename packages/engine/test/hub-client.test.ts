import { createHash, randomBytes } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { gitBlobId, HubClient, HubError, type UploadFile } from '../src/hub/client';
import {
  FAKE_HUB_TOKEN,
  startFakeHub,
  type FakeHub,
  type FakeHubOptions,
} from './support/fake-hub';

const REPO = 'jake/desk-agent';

let dir: string;
let hub: FakeHub;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'architect-hub-client-'));
});
afterEach(async () => {
  await hub?.close();
  rmSync(dir, { recursive: true, force: true });
});

async function setUp(options: FakeHubOptions = {}, fetchImpl?: typeof fetch) {
  hub = await startFakeHub(options);
  const client = new HubClient({
    endpoint: hub.url,
    token: async () => FAKE_HUB_TOKEN,
    ...(fetchImpl ? { fetch: fetchImpl } : {}),
  });
  await client.createRepo(REPO, { private: true });
  return client;
}

const sha256 = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');

function onDisk(path: string, bytes: Buffer): UploadFile {
  const source = join(dir, path.replaceAll('/', '_'));
  writeFileSync(source, bytes);
  return { path, source, size: bytes.length, sha256: sha256(bytes) };
}

const adapterBytes = (size: number) => randomBytes(size);

describe('repositories', () => {
  it('creates a repository with the visibility asked for, and tells an existing one apart', async () => {
    const client = await setUp();
    expect(await client.repoInfo('jake/missing')).toBeNull();
    expect(await client.createRepo('jake/open', { private: false })).toBe('created');
    expect(await client.createRepo('jake/open', { private: true })).toBe('exists');
    expect(await client.repoInfo('jake/open')).toEqual({ private: false });
    expect(await client.repoInfo(REPO)).toEqual({ private: true });
  });

  it('refuses a repository name that would change the address it is sent to', async () => {
    const client = await setUp();
    await expect(client.repoInfo('jake/../../api/whoami-v2')).rejects.toBeInstanceOf(HubError);
    await expect(client.listFiles('jake', 'main')).rejects.toBeInstanceOf(HubError);
    expect(hub.requests.filter((request) => request.path.includes('..'))).toEqual([]);
  });
});

describe('uploading files', () => {
  it('commits small files inline and large ones through LFS, never sending the token to the upload host', async () => {
    const client = await setUp({ lfsThreshold: 1024 });
    const adapter = adapterBytes(4096);
    const result = await client.uploadFiles(
      REPO,
      [
        { path: 'graduate.json', content: Buffer.from('{"schema": 2}\n') },
        onDisk('harness/AGENTS.md', Buffer.from('# Desk\n')),
        onDisk('adapter/adapter.gguf', adapter),
      ],
      { summary: 'Publish version 1' },
    );

    expect(result.files).toEqual([
      { path: 'graduate.json', lfs: false },
      { path: 'harness/AGENTS.md', lfs: false },
      { path: 'adapter/adapter.gguf', lfs: true },
    ]);
    const files = hub.filesAt(REPO, result.commit);
    expect(files.get('adapter/adapter.gguf')).toEqual(adapter);
    expect(files.get('harness/AGENTS.md')?.toString()).toBe('# Desk\n');
    // The upload went to the second host, whole, with its length and without the token.
    expect(hub.uploads).toEqual([
      expect.objectContaining({
        method: 'PUT',
        authorized: false,
        contentLength: '4096',
        chunked: false,
      }),
    ]);
    // Every request to the Hub itself carried the token, and the upload confirmed itself there.
    expect(hub.requests.every((request) => request.authorized)).toBe(true);
    expect(hub.requests.some((request) => request.path.endsWith('/lfs/objects/verify'))).toBe(true);

    const listed = await client.listFiles(REPO, result.commit);
    expect(listed).toEqual([
      {
        path: 'adapter/adapter.gguf',
        size: 4096,
        oid: expect.any(String),
        lfs: { sha256: sha256(adapter), size: 4096 },
      },
      { path: 'graduate.json', size: 14, oid: gitBlobId(Buffer.from('{"schema": 2}\n')) },
      { path: 'harness/AGENTS.md', size: 7, oid: gitBlobId(Buffer.from('# Desk\n')) },
    ]);
  });

  it('sends a large object in the parts the Hub asks for and completes it without the token', async () => {
    const client = await setUp({ lfsThreshold: 1024, multipartThreshold: 10_000, partSize: 3000 });
    const adapter = adapterBytes(10_500);
    const progress: number[] = [];
    const result = await client.uploadFiles(REPO, [onDisk('adapter/adapter.gguf', adapter)], {
      summary: 'Publish',
      onProgress: (event) => progress.push(event.sent),
    });

    expect(hub.filesAt(REPO, result.commit).get('adapter/adapter.gguf')).toEqual(adapter);
    expect(hub.uploads.map((upload) => [upload.contentLength, upload.authorized])).toEqual([
      ['3000', false],
      ['3000', false],
      ['3000', false],
      ['1500', false],
    ]);
    const completion = hub.requests.find((request) =>
      request.path.startsWith('/api/complete_multipart'),
    );
    expect(completion?.authorized).toBe(false);
    expect(progress).toEqual([3000, 6000, 9000, 10_500]);
  });

  it('skips content the Hub already holds, so a retry sends only what is missing', async () => {
    const client = await setUp({ lfsThreshold: 1024 });
    const adapter = adapterBytes(2048);
    await client.uploadFiles(REPO, [onDisk('adapter/adapter.gguf', adapter)], { summary: 'First' });
    const sent = hub.uploads.length;
    const again = await client.uploadFiles(
      REPO,
      [onDisk('adapter/adapter.gguf', adapter), onDisk('adapter/copy.gguf', adapter)],
      { summary: 'Second' },
    );
    expect(hub.uploads).toHaveLength(sent);
    expect(hub.filesAt(REPO, again.commit).get('adapter/copy.gguf')).toEqual(adapter);
  });

  it('deletes files in the same commit, and refuses to commit on top of a branch that moved', async () => {
    const client = await setUp();
    const first = await client.uploadFiles(
      REPO,
      [
        { path: 'harness/old.md', content: Buffer.from('old') },
        { path: 'README.md', content: Buffer.from('card') },
      ],
      { summary: 'First' },
    );
    const second = await client.uploadFiles(
      REPO,
      [{ path: 'harness/new.md', content: Buffer.from('new') }],
      { summary: 'Second', parentCommit: first.commit, deletions: ['harness/old.md'] },
    );
    expect([...hub.filesAt(REPO, second.commit).keys()].sort()).toEqual([
      'README.md',
      'harness/new.md',
    ]);

    const stale = await client
      .uploadFiles(REPO, [{ path: 'harness/later.md', content: Buffer.from('later') }], {
        summary: 'Third',
        parentCommit: first.commit,
      })
      .catch((error: unknown) => error);
    expect(stale).toMatchObject({ name: 'HubError', code: 'conflict', status: 412 });
    expect(hub.repos.get(REPO)?.commits).toHaveLength(2);
  });

  it.each([500, 'drop'] as const)(
    'reports an upload that fails (%s) as a failure and leaves the repository as it was',
    async (failure) => {
      const client = await setUp({ lfsThreshold: 1024 });
      hub.failNextUpload(failure);
      const error = await client
        .uploadFiles(REPO, [onDisk('adapter/adapter.gguf', adapterBytes(2048))], {
          summary: 'Publish',
        })
        .catch((caught: unknown) => caught);
      expect(error).toBeInstanceOf(HubError);
      expect((error as HubError).message).toMatch(/The upload of adapter\/adapter\.gguf/);
      expect((error as HubError).retryable).toBe(true);
      expect(hub.repos.get(REPO)?.commits).toEqual([]);
    },
  );

  it('refuses an upload address that is neither HTTPS nor on this computer', async () => {
    const forged: typeof fetch = async (input, init) => {
      const url = String(input instanceof Request ? input.url : input);
      if (url.endsWith('/info/lfs/objects/batch')) {
        const asked = JSON.parse(String(init?.body)) as {
          objects: { oid: string; size: number }[];
        };
        return Response.json({
          objects: asked.objects.map((object) => ({
            ...object,
            actions: { upload: { href: 'http://uploads.example.com/put' } },
          })),
        });
      }
      return fetch(input, init);
    };
    const client = await setUp({ lfsThreshold: 1024 }, forged);
    await expect(
      client.uploadFiles(REPO, [onDisk('adapter/adapter.gguf', adapterBytes(2048))], {
        summary: 'x',
      }),
    ).rejects.toMatchObject({
      code: 'bad_response',
      message: expect.stringMatching(/insecure upload address/),
    });
    expect(hub.uploads).toEqual([]);
  });

  it('lists a repository across pages', async () => {
    const client = await setUp({ treePageSize: 2 });
    const files = Array.from({ length: 5 }, (_, index) => ({
      path: `harness/file-${index}.md`,
      content: Buffer.from(`file ${index}`),
    }));
    const { commit } = await client.uploadFiles(REPO, files, { summary: 'Five files' });
    expect((await client.listFiles(REPO, commit)).map((file) => file.path)).toEqual(
      files.map((file) => file.path),
    );
    expect(hub.requests.filter((request) => request.path.includes('/tree/'))).toHaveLength(3);
  });
});

describe('without a token', () => {
  it('reads a public repository, and asks for a token for a private one or any change', async () => {
    const client = await setUp();
    const { commit } = await client.uploadFiles(
      REPO,
      [{ path: 'graduate.json', content: Buffer.from('{}') }],
      { summary: 'One' },
    );
    await client.createRepo('jake/open', { private: false });
    const open = await client.uploadFiles(
      'jake/open',
      [{ path: 'graduate.json', content: Buffer.from('{"open": true}') }],
      { summary: 'Open' },
    );
    const anonymous = new HubClient({ endpoint: hub.url, token: async () => undefined });
    expect(await anonymous.revision('jake/open')).toBe(open.commit);
    expect((await anonymous.listFiles('jake/open', open.commit)).map((file) => file.path)).toEqual([
      'graduate.json',
    ]);
    const dest = join(dir, 'open.json');
    await anonymous.download('jake/open', open.commit, 'graduate.json', dest, null);
    expect(readFileSync(dest, 'utf8')).toBe('{"open": true}');
    expect(hub.requests.filter((request) => !request.authorized).length).toBeGreaterThan(0);

    await expect(anonymous.revision(REPO, commit)).rejects.toMatchObject({
      code: 'auth',
      message: expect.stringMatching(/needs a token/),
    });
    await expect(anonymous.createRepo('jake/new', { private: true })).rejects.toMatchObject({
      code: 'auth',
      message: 'No Hugging Face token is saved.',
    });
    expect(hub.repos.has('jake/new')).toBe(false);
  });
});

describe('addresses the Hub hands out', () => {
  /** A Hub on the internet, answered by `routes`, recording every address the client asks. */
  function hubAt(routes: (url: URL, init: RequestInit | undefined) => Response | null) {
    const asked: string[] = [];
    const fetchImpl: typeof fetch = async (input, init) => {
      const url = new URL(input instanceof Request ? input.url : String(input));
      asked.push(url.href);
      return routes(url, init) ?? new Response('not found', { status: 404 });
    };
    const client = new HubClient({
      endpoint: 'https://hub.example',
      token: async () => FAKE_HUB_TOKEN,
      fetch: fetchImpl,
    });
    return { client, asked };
  }

  it('never sends a file to plain HTTP on this computer from a Hub on the internet', async () => {
    const { client, asked } = hubAt((url, init) => {
      if (url.pathname.endsWith('/preupload/main')) {
        return Response.json({
          files: [{ path: 'adapter/adapter.gguf', uploadMode: 'lfs', shouldIgnore: false }],
        });
      }
      if (url.pathname.endsWith('/info/lfs/objects/batch')) {
        const object = (JSON.parse(String(init?.body)) as { objects: object[] }).objects[0];
        return Response.json({
          objects: [{ ...object, actions: { upload: { href: 'http://127.0.0.1:9/upload' } } }],
        });
      }
      return null;
    });
    await expect(
      client.uploadFiles(REPO, [onDisk('adapter/adapter.gguf', adapterBytes(64))], {
        summary: 'x',
      }),
    ).rejects.toMatchObject({ message: expect.stringMatching(/insecure upload address/) });
    expect(asked.some((href) => href.startsWith('http://127.0.0.1'))).toBe(false);
  });

  it('never follows a download from a Hub on the internet to plain HTTP on this computer', async () => {
    const { client, asked } = hubAt((url) =>
      url.pathname.includes('/resolve/')
        ? new Response(null, { status: 302, headers: { location: 'http://127.0.0.1:9/blob' } })
        : null,
    );
    await expect(
      client.download(REPO, 'a'.repeat(40), 'adapter/adapter.gguf', join(dir, 'x'), null),
    ).rejects.toMatchObject({ message: expect.stringMatching(/insecure address/) });
    expect(asked.some((href) => href.startsWith('http://127.0.0.1'))).toBe(false);
  });
});

describe('revisions and downloads', () => {
  it('resolves a branch to its commit, and a commit to itself', async () => {
    const client = await setUp();
    const { commit } = await client.uploadFiles(
      REPO,
      [{ path: 'a.md', content: Buffer.from('a') }],
      {
        summary: 'One',
      },
    );
    expect(await client.revision(REPO, 'main')).toBe(commit);
    expect(await client.revision(REPO, commit)).toBe(commit);
    await expect(client.revision(REPO, 'f'.repeat(40))).rejects.toMatchObject({
      code: 'not_found',
    });
  });

  it('refuses a download larger than it may be', async () => {
    const client = await setUp();
    const { commit } = await client.uploadFiles(
      REPO,
      [{ path: 'graduate.json', content: Buffer.alloc(5000, 32) }],
      { summary: 'Big manifest' },
    );
    const dest = join(dir, 'graduate.json');
    await expect(
      client.download(REPO, commit, 'graduate.json', dest, null, undefined, { maxBytes: 4096 }),
    ).rejects.toMatchObject({ code: 'too_large' });
    expect(() => readFileSync(dest)).toThrow();
    expect(await client.download(REPO, commit, 'graduate.json', dest, null)).toMatchObject({
      bytes: 5000,
    });
  });
});
