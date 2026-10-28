import { createHash, randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { rm, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { PACKAGE_MANIFEST_FILE, scanText } from '@architect/harness';
import {
  GuardError,
  newId,
  PublishRequestSchema,
  type ExportFinding,
  type HubVisibility,
  type Publication,
  type PublicationReview,
  type PublishedFile,
  type PublishRequest,
  type PublishResult,
} from '@architect/shared';
import {
  gitBlobId,
  HubError,
  type HubClient,
  type RemoteFile,
  type UploadFile,
  type UploadProgress,
} from '../hub';
import { repositoryUrl } from '../hub/names';
import { isoNow } from '../loop/time';
import { HOSTED_INFERENCE_NOTE, renderModelCard } from './card';
import {
  assertReviewed,
  EXPORT_NOTICE,
  findingsDigest,
  listExport,
  scanOptions,
  stageExport,
  type ExportContext,
  type ExportListing,
} from './exporter';

/** The model card, at the root of the repository beside the package. */
export const CARD_FILE = 'README.md';

/**
 * The folders a package keeps its files in. A publication removes files there that the version
 * it sends doesn't have, left by an earlier version; nothing else in the repository is touched.
 */
const PACKAGE_FOLDERS = ['harness/', 'evidence/', 'adapter/', 'resources/'];

export interface PublishContext extends ExportContext {
  /** The Hub, with the token looked up whenever a request needs it. */
  hub: HubClient;
}

export interface PublishOptions {
  signal?: AbortSignal;
  onProgress?(progress: UploadProgress): void;
}

const byPath = (a: { path: string }, b: { path: string }): number =>
  a.path < b.path ? -1 : a.path > b.path ? 1 : 0;

function visibilityNotice(visibility: HubVisibility): string {
  return visibility === 'private'
    ? 'A new repository is made private: only the accounts you allow on the Hub can see it. An existing repository keeps its visibility, and a public one is refused.'
    : 'A new repository is made public: anyone can see and download it. A private repository stays private.';
}

interface Prepared {
  review: PublicationReview;
  listing: ExportListing;
}

/** Everything a publication would send, scanned, without sending anything. */
async function prepare(
  ctx: PublishContext,
  graduateId: string,
  request: ReturnType<typeof PublishRequestSchema.parse>,
): Promise<Prepared> {
  const listing = await listExport(ctx, graduateId, request.version, request.include);
  if (listing.files.some((file) => file.path === CARD_FILE)) {
    throw new Error(
      `This package already has a ${CARD_FILE}, which a publication writes as the model card. It can't be published.`,
    );
  }
  const card = renderModelCard(listing.manifest, {
    repository: request.repository,
    revision: null,
  });
  const cardFindings = scanText(CARD_FILE, card, await scanOptions(ctx, graduateId));
  const findings: ExportFinding[] = [...listing.findings, ...cardFindings];
  const files: PublishedFile[] = [
    ...listing.files,
    { path: CARD_FILE, bytes: Buffer.byteLength(card) },
  ].sort(byPath);
  return {
    listing,
    review: {
      graduateId,
      version: listing.version,
      name: listing.name,
      repository: request.repository,
      visibility: request.visibility,
      files,
      bytes: files.reduce((sum, file) => sum + file.bytes, 0),
      card,
      findings,
      findingsDigest: findingsDigest(findings),
      notices: [EXPORT_NOTICE, HOSTED_INFERENCE_NOTE, visibilityNotice(request.visibility)],
    },
  };
}

/**
 * What publishing a version would send to a repository: every file of its package and the model
 * card, and what the best-effort scan finds in all of them. Nothing leaves this computer.
 */
export async function reviewPublication(
  ctx: PublishContext,
  graduateId: string,
  input: PublishRequest,
): Promise<PublicationReview> {
  return (await prepare(ctx, graduateId, PublishRequestSchema.parse(input))).review;
}

/** The git id of a file on disk, read in chunks: what the Hub's tree lists for a regular file. */
async function gitBlobIdOf(path: string, size: number): Promise<string> {
  const hash = createHash('sha1').update(`blob ${size}\0`);
  for await (const chunk of createReadStream(path)) hash.update(chunk as Buffer);
  return hash.digest('hex');
}

/** Whether the Hub's listing holds exactly these files, byte for byte. */
async function holds(
  remote: readonly RemoteFile[],
  files: readonly UploadFile[],
): Promise<boolean> {
  const listed = new Map(remote.map((file) => [file.path, file]));
  for (const file of files) {
    const there = listed.get(file.path);
    if (!there) return false;
    if ('content' in file) {
      if (there.lfs || there.oid !== gitBlobId(file.content)) return false;
      continue;
    }
    if (there.lfs) {
      if (there.lfs.sha256 !== file.sha256 || there.lfs.size !== file.size) return false;
    } else if (
      there.size !== file.size ||
      there.oid !== (await gitBlobIdOf(file.source, file.size))
    ) {
      return false;
    }
  }
  return true;
}

function messageOf(error: unknown): string {
  if (error instanceof HubError) return `${error.message} ${error.hint}`;
  return error instanceof Error ? error.message : String(error);
}

/**
 * Publishes a version to a Hugging Face model repository: the package exactly as an export of it
 * would be, after the same review, then a model card made from its manifest. A new repository is
 * private unless the request says public; an existing one keeps its visibility, and a public one
 * is refused for a private publication. The package goes up in one commit (large files through
 * LFS), checked against the Hub's listing before the card names that commit, so a failure at any
 * step leaves a failed record, never a release. One record per version and repository: trying
 * again updates it, and a version already published there is not sent twice.
 */
export async function publishVersion(
  ctx: PublishContext,
  graduateId: string,
  input: PublishRequest,
  options: PublishOptions = {},
): Promise<PublishResult> {
  const request = PublishRequestSchema.parse(input);
  const { library, hub } = ctx;
  const { store, paths } = library.ctx;
  const { signal } = options;
  const repository = request.repository;
  return library.lock.run(graduateId, async () => {
    const { review, listing } = await prepare(ctx, graduateId, request);
    assertReviewed(review.findings, request.acknowledgedFindings, 'published');
    const version = listing.version;
    const existing = store.publications.find(graduateId, version, repository);
    if (existing?.status === 'complete') {
      if (existing.digest === listing.digest) {
        return { publication: existing, files: review.files, alreadyPublished: true, notes: [] };
      }
      throw new GuardError(
        'permission',
        `Version ${version} of ${listing.name} is already published to ${repository} with other files. Publish this selection to another repository.`,
      );
    }

    await hub.whoami(signal);
    let info = await hub.repoInfo(repository, signal);
    if (info === null) {
      await hub.createRepo(repository, { private: request.visibility === 'private' }, signal);
      info = await hub.repoInfo(repository, signal);
      if (info === null) {
        throw new HubError(
          'not_found',
          `Hugging Face made ${repository} but the token can't see it.`,
          'Check that the token can read the repositories it creates.',
        );
      }
    }
    const notes: string[] = [];
    if (!info.private && request.visibility === 'private') {
      throw new GuardError(
        'permission',
        `${repository} is public, so publishing there would make this version public. Choose another repository, or publish it as public.`,
      );
    }
    if (info.private && request.visibility === 'public') {
      notes.push(
        `${repository} is private and stays private: Architect never makes a repository more visible. Change its visibility on the Hub to share it.`,
      );
    }

    const save = (patch: Partial<Publication>, previous: Publication): Publication => {
      const next: Publication = { ...previous, ...patch, updatedAt: isoNow(library.ctx.clock) };
      if (patch.error === undefined) delete next.error;
      store.publications.update(next);
      return next;
    };
    const at = isoNow(library.ctx.clock);
    let publication: Publication;
    if (existing) {
      publication = save(
        {
          visibility: info.private ? 'private' : 'public',
          status: 'staged',
          digest: listing.digest,
        },
        existing,
      );
    } else {
      publication = {
        id: newId('pub'),
        graduateId,
        version,
        destination: 'huggingface',
        repository,
        visibility: info.private ? 'private' : 'public',
        digest: listing.digest,
        status: 'staged',
        createdAt: at,
        updatedAt: at,
      };
      store.publications.insert(publication);
    }

    const staging = join(paths.stagingDir(), `publish-${randomUUID()}`);
    try {
      const dir = join(staging, 'package');
      const staged = await stageExport(
        ctx,
        graduateId,
        {
          version,
          include: request.include,
          acknowledgedFindings: findingsDigest(listing.findings),
        },
        dir,
      );
      const { read } = staged;
      publication = save({ status: 'uploading', digest: read.digest }, publication);
      const manifestFile = join(dir, PACKAGE_MANIFEST_FILE);
      const files: UploadFile[] = [
        {
          path: PACKAGE_MANIFEST_FILE,
          source: manifestFile,
          size: (await stat(manifestFile)).size,
          sha256: read.digest,
        },
        ...read.manifest.integrity.files.map((entry) => ({
          path: entry.path,
          source: join(dir, ...entry.path.split('/')),
          size: entry.size,
          sha256: entry.sha256,
        })),
      ];

      const head = info.sha ?? null;
      const before = head === null ? [] : await hub.listFiles(repository, head, signal);
      const sending = new Set(files.map((file) => file.path));
      const leftovers = before
        .filter((file) => PACKAGE_FOLDERS.some((folder) => file.path.startsWith(folder)))
        .filter((file) => !sending.has(file.path))
        .map((file) => file.path);
      let revision: string;
      let viaLfs = new Map<string, boolean>();
      if (head !== null && leftovers.length === 0 && (await holds(before, files))) {
        // An earlier attempt sent it all already: that commit holds the package.
        revision = head;
      } else {
        const sent = await hub.uploadFiles(repository, files, {
          summary: `Publish ${listing.name}, version ${version}`,
          description: `Architect package. graduate.json sha256 ${read.digest}.`,
          ...(head === null ? {} : { parentCommit: head }),
          deletions: leftovers,
          ...(signal ? { signal } : {}),
          ...(options.onProgress ? { onProgress: options.onProgress } : {}),
        });
        revision = sent.commit;
        viaLfs = new Map(sent.files.map((file) => [file.path, file.lfs]));
      }
      const held = await hub.listFiles(repository, revision, signal);
      if (!(await holds(held, files))) {
        throw new HubError(
          'mismatch',
          `The Hub's copy of ${repository} at ${revision} doesn't match the package that was sent.`,
          'Publish again.',
        );
      }

      const card = Buffer.from(renderModelCard(read.manifest, { repository, revision }));
      const cardFile: UploadFile = { path: CARD_FILE, content: card };
      if (!(await holds(held, [cardFile]))) {
        await hub.uploadFiles(repository, [cardFile], {
          summary: `Describe ${listing.name}, version ${version}`,
          parentCommit: revision,
          ...(signal ? { signal } : {}),
        });
      }
      publication = save(
        { status: 'complete', revision, url: repositoryUrl(hub.endpoint, repository) },
        publication,
      );
      return {
        publication,
        files: review.files.map((file) => {
          if (file.path === CARD_FILE) return { path: CARD_FILE, bytes: card.length, lfs: false };
          const lfs = viaLfs.get(file.path);
          return lfs === undefined ? file : { ...file, lfs };
        }),
        alreadyPublished: false,
        notes,
      };
    } catch (error) {
      save(
        {
          status: 'failed',
          error: signal?.aborted ? 'Stopped before the upload finished.' : messageOf(error),
        },
        publication,
      );
      throw error;
    } finally {
      await rm(staging, { recursive: true, force: true });
    }
  });
}

/** Every publication of an agent's versions, oldest first. */
export function listPublications(
  ctx: Pick<ExportContext, 'library'>,
  graduateId: string,
): Publication[] {
  ctx.library.agent(graduateId);
  return ctx.library.ctx.store.publications.list(graduateId);
}
