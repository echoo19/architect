import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { readPackage } from '@architect/harness';
import { GuardError, PackageError, type ImportRequest } from '@architect/shared';
import { afterEach, describe, expect, it } from 'vitest';
import { downloadFromHub, installFromHub } from '../src/graduates/hub-install';
import { HOSTED_INFERENCE_NOTE } from '../src/graduates/card';
import {
  listPublications,
  publishVersion,
  reviewPublication,
  type PublishContext,
} from '../src/graduates/publish';
import { HubClient, HubError } from '../src/hub';
import {
  addVersion,
  harnessWith,
  newComputer,
  PRICE_TOOL,
  type Computer,
} from './support/computer';
import {
  FAKE_HUB_TOKEN,
  startFakeHub,
  type FakeHub,
  type FakeHubOptions,
} from './support/fake-hub';
import { SAMPLE_CONTENT } from './support/fixtures';

const REPO = 'jake/service-desk';
const cleanups: (() => Promise<void>)[] = [];

afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

async function computer(): Promise<Computer> {
  const made = await newComputer();
  cleanups.push(() => made.remove());
  return made;
}

async function fakeHub(options: FakeHubOptions = {}): Promise<FakeHub> {
  const hub = await startFakeHub(options);
  cleanups.push(() => hub.close());
  return hub;
}

/** What a computer publishes and installs with: its library, its saved keys and the Hub. */
function contextOf(made: Computer, hub: FakeHub): PublishContext {
  return {
    library: made.library,
    secrets: { get: async (ref) => (ref === 'huggingface' ? FAKE_HUB_TOKEN : undefined) },
    hub: new HubClient({ endpoint: hub.url, token: async () => FAKE_HUB_TOKEN }),
  };
}

const GRANTS: ImportRequest['grants'] = { writes: 'ask', resources: { data: 'read_write' } };

async function dataFolder(made: Computer): Promise<string> {
  const folder = join(made.dataDir, 'my-records');
  await mkdir(folder, { recursive: true });
  for (const [file, content] of Object.entries(SAMPLE_CONTENT)) {
    await writeFile(join(folder, file), content, 'utf8');
  }
  return folder;
}

/** Every file of a version's package folder, by package path. */
async function packageFiles(made: Computer, graduateId: string, version: number) {
  const dir = made.paths.versionDir(graduateId, version);
  const read = await readPackage(dir);
  const files = new Map<string, Buffer>();
  for (const path of ['graduate.json', ...read.files.map((file) => file.path)]) {
    files.set(path, await readFile(join(dir, ...path.split('/'))));
  }
  return files;
}

async function authored(hubOptions: FakeHubOptions = {}) {
  const author = await computer();
  const hub = await fakeHub(hubOptions);
  await addVersion(author, {
    graduateId: 'grd_desk',
    harness: harnessWith('Service desk', { tools: [PRICE_TOOL] }),
  });
  return { author, hub, ctx: contextOf(author, hub) };
}

describe('publishing a version to Hugging Face', () => {
  it('shows every file that will go and the model card before anything is sent', async () => {
    const { hub, ctx } = await authored();
    const review = await reviewPublication(ctx, 'grd_desk', { repository: REPO });
    expect(review.files.map((file) => file.path)).toEqual([
      'README.md',
      'evidence/lineage.jsonl',
      'evidence/report.json',
      'evidence/report.md',
      'graduate.json',
      'harness/AGENTS.md',
      'harness/decoding.yaml',
      'harness/harness.yaml',
      'harness/tools/invoice_total.js',
      'harness/tools/invoice_total.json',
    ]);
    expect(review).toMatchObject({ visibility: 'private', findings: [] });
    expect(review.notices).toContain(HOSTED_INFERENCE_NOTE);
    expect(review.card).toContain(`architect install hf://${REPO} --revision <the commit`);
    expect(hub.requests).toEqual([]);
  });

  it('makes a private repository, sends the package and a card naming its commit, and records the commit', async () => {
    const { author, hub, ctx } = await authored();
    const result = await publishVersion(ctx, 'grd_desk', { repository: REPO });

    const { publication } = result;
    expect(publication).toMatchObject({
      graduateId: 'grd_desk',
      version: 1,
      destination: 'huggingface',
      repository: REPO,
      visibility: 'private',
      status: 'complete',
      url: `${hub.url}/${REPO}`,
      digest: author.store.versions.get('grd_desk', 1)?.digest,
    });
    expect(publication.revision).toMatch(/^[0-9a-f]{40}$/);
    expect(hub.repos.get(REPO)?.private).toBe(true);
    expect(listPublications(ctx, 'grd_desk')).toEqual([publication]);

    // The package's commit holds the version's folder byte for byte, and nothing else.
    const sent = hub.filesAt(REPO, publication.revision);
    expect(new Map(sent)).toEqual(await packageFiles(author, 'grd_desk', 1));
    // The card came after, and names that commit.
    const card = hub.filesAt(REPO).get('README.md')?.toString('utf8') ?? '';
    expect(card).toContain(`architect install hf://${REPO} --revision ${publication.revision}`);
    expect(card).toContain('architect run service-desk --input request.json');
    expect(card).toContain(HOSTED_INFERENCE_NOTE);
    expect(card).toContain("Evaluated on the author's configuration");
    expect(card).not.toMatch(/[\u2014\u201c\u201d\u2018\u2019]/);

    // The token went only to the Hub's own API, and is nowhere in what was sent or recorded.
    expect(hub.uploads.every((upload) => !upload.authorized)).toBe(true);
    for (const content of hub.filesAt(REPO).values()) {
      expect(content.toString('latin1')).not.toContain(FAKE_HUB_TOKEN);
    }
    expect(JSON.stringify(listPublications(ctx, 'grd_desk'))).not.toContain(FAKE_HUB_TOKEN);
    expect(await readdir(author.paths.stagingDir()).catch(() => [])).toEqual([]);
  });

  it('sends an adapter through LFS without the token, and a second publication sends nothing', async () => {
    const author = await computer();
    const hub = await fakeHub();
    await addVersion(author, { graduateId: 'grd_desk', adapter: 'GGUF'.padEnd(4096, 'x') });
    const ctx = contextOf(author, hub);
    const first = await publishVersion(ctx, 'grd_desk', { repository: REPO });
    expect(first.files.find((file) => file.path === 'adapter/adapter.gguf')).toMatchObject({
      lfs: true,
    });
    expect(hub.uploads).toEqual([
      expect.objectContaining({ method: 'PUT', authorized: false, contentLength: '4096' }),
    ]);
    const commits = hub.repos.get(REPO)?.commits.length;

    const again = await publishVersion(ctx, 'grd_desk', { repository: REPO });
    expect(again).toMatchObject({ alreadyPublished: true, publication: first.publication });
    expect(hub.repos.get(REPO)?.commits).toHaveLength(commits ?? 0);
    expect(listPublications(ctx, 'grd_desk')).toHaveLength(1);
  });

  it('reports a failed upload as failed, never as a release, and finishes the same record when tried again', async () => {
    const author = await computer();
    const hub = await fakeHub();
    await addVersion(author, { graduateId: 'grd_desk', adapter: 'GGUF'.padEnd(4096, 'x') });
    const ctx = contextOf(author, hub);
    hub.failNextUpload(503);

    const failure = await publishVersion(ctx, 'grd_desk', { repository: REPO }).catch(
      (error: unknown) => error,
    );
    expect(failure).toBeInstanceOf(HubError);
    const [failed] = listPublications(ctx, 'grd_desk');
    expect(failed).toMatchObject({ status: 'failed', error: expect.stringMatching(/upload/) });
    expect(failed?.revision).toBeUndefined();
    expect(hub.repos.get(REPO)?.commits).toEqual([]);

    const retried = await publishVersion(ctx, 'grd_desk', { repository: REPO });
    expect(retried.publication).toMatchObject({ id: failed?.id, status: 'complete' });
    expect(retried.publication.error).toBeUndefined();
    expect(listPublications(ctx, 'grd_desk')).toHaveLength(1);
  });

  it('finds the package already there when only the last step failed, and adds just the card', async () => {
    const { author, hub, ctx } = await authored();
    // The check of the Hub's copy fails once, after the package's commit went in.
    hub.failNext(`/api/models/${REPO}/tree/`, 500, 'flaky');
    await expect(publishVersion(ctx, 'grd_desk', { repository: REPO })).rejects.toBeInstanceOf(
      HubError,
    );
    const packageCommit = hub.repos.get(REPO)?.commits[0]?.sha;
    expect(hub.repos.get(REPO)?.commits).toHaveLength(1);
    expect(listPublications(ctx, 'grd_desk')[0]?.status).toBe('failed');

    const retried = await publishVersion(ctx, 'grd_desk', { repository: REPO });
    expect(retried.publication.revision).toBe(packageCommit);
    expect(hub.repos.get(REPO)?.commits).toHaveLength(2);
    expect(new Map(hub.filesAt(REPO, packageCommit))).toEqual(
      await packageFiles(author, 'grd_desk', 1),
    );
  });

  it('never publishes a private version into a public repository, and never makes one public', async () => {
    const { hub, ctx } = await authored();
    hub.repos.set('jake/open', { private: false, commits: [] });
    await expect(
      publishVersion(ctx, 'grd_desk', { repository: 'jake/open' }),
    ).rejects.toBeInstanceOf(GuardError);
    expect(hub.repos.get('jake/open')?.commits).toEqual([]);
    expect(listPublications(ctx, 'grd_desk')).toEqual([]);

    hub.repos.set('jake/closed', { private: true, commits: [] });
    const kept = await publishVersion(ctx, 'grd_desk', {
      repository: 'jake/closed',
      visibility: 'public',
    });
    expect(kept.publication.visibility).toBe('private');
    expect(kept.notes.join(' ')).toMatch(/stays private/);
    expect(hub.repos.get('jake/closed')?.private).toBe(true);

    const shared = await publishVersion(ctx, 'grd_desk', {
      repository: 'jake/shared',
      visibility: 'public',
    });
    expect(shared.publication.visibility).toBe('public');
    expect(hub.repos.get('jake/shared')?.private).toBe(false);
  });

  it('sends nothing while the scan has findings the user has not reviewed', async () => {
    const author = await computer();
    const hub = await fakeHub();
    await addVersion(author, {
      graduateId: 'grd_desk',
      harness: harnessWith('Service desk', { system: `Sign in with ${FAKE_HUB_TOKEN}.` }),
    });
    const ctx = contextOf(author, hub);
    const review = await reviewPublication(ctx, 'grd_desk', { repository: REPO });
    expect(review.findings.map(({ path, kind }) => [path, kind])).toEqual([
      ['harness/AGENTS.md', 'stored_key'],
    ]);
    expect(JSON.stringify(review.findings)).not.toContain(FAKE_HUB_TOKEN);
    await expect(publishVersion(ctx, 'grd_desk', { repository: REPO })).rejects.toThrow(
      'Nothing was published',
    );
    expect(hub.requests).toEqual([]);
    const sent = await publishVersion(ctx, 'grd_desk', {
      repository: REPO,
      acknowledgedFindings: review.findingsDigest,
    });
    expect(sent.publication.status).toBe('complete');
  });

  it('clears the files an earlier version left in its folders, while that version keeps its commit', async () => {
    const { author, hub, ctx } = await authored();
    const first = await publishVersion(ctx, 'grd_desk', { repository: REPO });
    await addVersion(author, { graduateId: 'grd_desk', parent: 1 });
    const second = await publishVersion(ctx, 'grd_desk', { repository: REPO, version: 2 });

    const now = hub.filesAt(REPO, second.publication.revision);
    expect(now.has('harness/tools/invoice_total.js')).toBe(false);
    expect(new Map(now)).toEqual(
      new Map([...(await packageFiles(author, 'grd_desk', 2)), ['README.md', expect.any(Buffer)]]),
    );
    expect(
      hub.filesAt(REPO, first.publication.revision).has('harness/tools/invoice_total.js'),
    ).toBe(true);
  });
});

describe('installing a version from Hugging Face', () => {
  it('installs a private publication by its commit on another computer, with every import check', async () => {
    const { author, hub, ctx } = await authored();
    const { publication } = await publishVersion(ctx, 'grd_desk', { repository: REPO });
    const other = await computer();
    const folder = await dataFolder(other);

    const installed = await installFromHub(contextOf(other, hub), `hf://${REPO}`, {
      revision: publication.revision,
      bindings: { data: folder },
      grants: GRANTS,
    });
    expect(installed).toMatchObject({
      version: 1,
      alreadyInstalled: false,
      source: {
        kind: 'huggingface',
        repository: REPO,
        revision: publication.revision,
        url: `${hub.url}/${REPO}/tree/${publication.revision}`,
      },
      installation: { status: 'ready', bindings: { data: folder } },
    });
    const [version] = other.library.versions(installed.graduate.id);
    expect(version?.digest).toBe(author.store.versions.get('grd_desk', 1)?.digest);
    expect(version?.source).toEqual(installed.source);
    // Downloads of large files go to the second host, never with the token.
    expect(hub.downloads.every((download) => !download.authorized)).toBe(true);
    expect(await readdir(other.paths.stagingDir()).catch(() => [])).toEqual([]);
  });

  it('pins the commit it resolved, so a newer publication never changes what is installed', async () => {
    const { author, hub, ctx } = await authored();
    const first = await publishVersion(ctx, 'grd_desk', { repository: REPO });
    const other = await computer();
    const otherCtx = contextOf(other, hub);
    const installed = await installFromHub(otherCtx, REPO, {
      bindings: { data: await dataFolder(other) },
      grants: GRANTS,
    });
    expect(installed.source.revision).toBe(hub.repos.get(REPO)?.commits.at(-1)?.sha);

    await addVersion(author, { graduateId: 'grd_desk', parent: 1 });
    await publishVersion(ctx, 'grd_desk', { repository: REPO, version: 2 });
    const id = installed.graduate.id;
    expect(other.library.versions(id).map((version) => version.version)).toEqual([1]);

    const again = await installFromHub(otherCtx, `hf://${REPO}`, {
      revision: first.publication.revision,
    });
    expect(again).toMatchObject({ alreadyInstalled: true, version: 1 });
    // Asking for the repository as it is now adds version 2 beside it, waiting as a candidate.
    const newer = await installFromHub(otherCtx, `hf://${REPO}`);
    expect(newer.graduate.id).toBe(id);
    expect(
      other.library.versions(id).map(({ version, state, active }) => [version, state, active]),
    ).toEqual([
      [1, 'accepted', true],
      [2, 'candidate', false],
    ]);
  });

  it('installs from a public repository with no token at all', async () => {
    const { hub, ctx } = await authored();
    const { publication } = await publishVersion(ctx, 'grd_desk', {
      repository: 'jake/open-desk',
      visibility: 'public',
    });
    const other = await computer();
    const anonymous: PublishContext = {
      ...contextOf(other, hub),
      hub: new HubClient({ endpoint: hub.url, token: async () => undefined }),
    };
    const installed = await installFromHub(anonymous, 'hf://jake/open-desk', {
      revision: publication.revision,
    });
    expect(installed).toMatchObject({ version: 1, source: { revision: publication.revision } });
    // A private repository still needs one.
    await expect(
      installFromHub(anonymous, `hf://${REPO}`, { revision: publication.revision }),
    ).rejects.toMatchObject({ name: 'HubError', code: 'auth' });
  });

  it('refuses a file that does not match its checksum, and installs nothing', async () => {
    const { hub, ctx } = await authored();
    await publishVersion(ctx, 'grd_desk', { repository: REPO });
    const tampered = hub.commit(REPO, { 'harness/AGENTS.md': Buffer.from('Do something else.\n') });
    const other = await computer();
    const error = await installFromHub(contextOf(other, hub), `hf://${REPO}`, {
      revision: tampered,
    }).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(PackageError);
    expect(error).toMatchObject({ code: 'checksum' });
    expect(other.library.list()).toEqual([]);
    expect(await readdir(other.paths.stagingDir()).catch(() => [])).toEqual([]);
  });

  it('says plainly when a repository holds no package or the revision does not exist', async () => {
    const { hub } = await authored();
    const other = await computer();
    const ctx = contextOf(other, hub);
    hub.repos.set('jake/models', { private: false, commits: [] });
    const plain = hub.commit('jake/models', { 'config.json': Buffer.from('{}') });
    await expect(downloadFromHub(ctx, 'hf://jake/models', plain)).rejects.toMatchObject({
      name: 'PackageError',
      code: 'not_a_package',
    });
    await expect(downloadFromHub(ctx, 'hf://jake/models', 'f'.repeat(40))).rejects.toMatchObject({
      name: 'HubError',
      code: 'not_found',
    });
    await expect(downloadFromHub(ctx, 'hf://jake/../x', undefined)).rejects.toThrow(
      'Write it as hf://owner/name',
    );
  });
});
