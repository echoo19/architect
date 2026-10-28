import { createHash, randomBytes } from 'node:crypto';
import {
  closeSync,
  createReadStream,
  fsyncSync,
  mkdirSync,
  openSync,
  renameSync,
  rmSync,
  writeSync,
} from 'node:fs';
import { open } from 'node:fs/promises';
import { dirname } from 'node:path';
import { Readable } from 'node:stream';
import { isLoopbackUrl } from '@architect/shared';
import { z } from 'zod';

export const HF_ENDPOINT = 'https://huggingface.co';

export type HubErrorCode =
  | 'auth'
  | 'forbidden'
  | 'billing'
  | 'not_found'
  | 'conflict'
  | 'too_large'
  | 'rate_limit'
  | 'server'
  | 'network'
  | 'bad_response'
  | 'mismatch';

/** A Hugging Face request that failed, said for the person using the app, with what to do. */
export class HubError extends Error {
  constructor(
    readonly code: HubErrorCode,
    message: string,
    readonly hint: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = 'HubError';
  }

  get retryable(): boolean {
    return this.code === 'network' || this.code === 'server' || this.code === 'rate_limit';
  }
}

export const JobInfoSchema = z.object({
  id: z.string().min(1),
  createdAt: z.string().nullish(),
  status: z.object({ stage: z.string(), message: z.string().nullish() }),
  environment: z.record(z.string(), z.string()).nullish(),
});
export type JobInfo = z.infer<typeof JobInfoSchema>;

/** The body of `POST /api/jobs/<namespace>`, as huggingface_hub's run_job builds it. */
export interface JobSpec {
  dockerImage: string;
  command: string[];
  arguments: string[];
  environment: Record<string, string>;
  /** Encrypted by the Hub and given to the job as environment variables. */
  secrets: Record<string, string>;
  flavor: string;
  timeoutSeconds: number;
}

export interface HubClientOptions {
  /** https://huggingface.co; tests use a server on this computer. */
  endpoint?: string;
  /** Read from the app's secret store when a request needs it; never logged or saved. */
  token: () => Promise<string | undefined>;
  fetch?: typeof fetch;
  /** Per request, downloads and uploads aside. Default 60 seconds. */
  timeoutMs?: number;
}

/** The largest file `commit` sends inline. Larger files go through `uploadFiles`, which uses LFS. */
export const MAX_COMMIT_FILE_BYTES = 10 * 1024 * 1024;

/** A file in a repository at one revision, as the Hub's tree lists it. */
export interface RemoteFile {
  path: string;
  size: number;
  /** The git blob id of what the repository stores: the file itself, or its LFS pointer. */
  oid: string;
  /** For a file kept in LFS: the sha256 of its content and its size. */
  lfs?: { sha256: string; size: number };
}

/** A file to upload: one on disk, already hashed, or bytes in memory. */
export type UploadFile =
  | { path: string; source: string; size: number; sha256: string }
  | { path: string; content: Uint8Array };

export interface UploadProgress {
  path: string;
  /** Bytes of this file sent so far. */
  sent: number;
  size: number;
}

export interface UploadOptions {
  /** The commit's title. */
  summary: string;
  description?: string;
  /** The branch to commit to. Default `main`. */
  branch?: string;
  /** The commit the branch must still point at, or the commit is refused (412). */
  parentCommit?: string;
  /** Files to delete in the same commit. */
  deletions?: readonly string[];
  signal?: AbortSignal;
  onProgress?(progress: UploadProgress): void;
}

export interface UploadResult {
  commit: string;
  /** Each file and whether it went through LFS, in the order given. */
  files: { path: string; lfs: boolean }[];
}

const WhoamiSchema = z.object({ name: z.string().min(1) });
const CommitSchema = z.object({ commitOid: z.string().regex(/^[0-9a-f]{40}$/) });
const RevisionSchema = z.object({ sha: z.string().regex(/^[0-9a-f]{40}$/) });
const RepoInfoSchema = z.object({
  private: z.boolean(),
  sha: z
    .string()
    .regex(/^[0-9a-f]{40}$/)
    .nullish(),
});
const PreuploadSchema = z.object({
  files: z.array(
    z.object({
      path: z.string(),
      uploadMode: z.enum(['lfs', 'regular']),
      shouldIgnore: z.boolean().nullish(),
    }),
  ),
});
const LfsActionSchema = z.object({
  href: z.string().min(1),
  header: z.record(z.string(), z.union([z.string(), z.number()])).nullish(),
});
const LfsBatchSchema = z.object({
  objects: z.array(
    z.object({
      oid: z.string(),
      size: z.number().int().nonnegative(),
      actions: z
        .object({ upload: LfsActionSchema.nullish(), verify: LfsActionSchema.nullish() })
        .nullish(),
      error: z.object({ code: z.number(), message: z.string() }).nullish(),
    }),
  ),
});
const TreeSchema = z.array(
  z.object({
    type: z.string(),
    path: z.string(),
    size: z.number().int().nonnegative().nullish(),
    oid: z.string().nullish(),
    lfs: z.object({ oid: z.string(), size: z.number().int().nonnegative() }).nullish(),
  }),
);

type LfsAction = z.infer<typeof LfsActionSchema>;

const LFS_HEADERS = {
  accept: 'application/vnd.git-lfs+json',
  'content-type': 'application/vnd.git-lfs+json',
};

/** How many files one preupload or LFS batch request names, as huggingface_hub sends them. */
const BATCH_FILES = 256;
/** How many pages of a tree listing are read before giving up: far more than a package has. */
const MAX_TREE_PAGES = 50;
/** Uploads get a minute plus the time to send their bytes at 256 KiB a second. */
const UPLOAD_BYTES_PER_SECOND = 256 * 1024;

const encodePath = (path: string) => path.split('/').map(encodeURIComponent).join('/');

/** The git id of a blob: what the Hub's tree lists as a regular file's `oid`. */
export function gitBlobId(content: Uint8Array): string {
  return createHash('sha1').update(`blob ${content.length}\0`).update(content).digest('hex');
}

function failure(status: number, detail: string): HubError {
  const said = detail ? ` ${detail}` : '';
  switch (status) {
    case 401:
      return new HubError(
        'auth',
        `Hugging Face refused the token.${said}`,
        'Check the Hugging Face token in Settings; it needs write access.',
        status,
      );
    case 402:
      return new HubError(
        'billing',
        `Hugging Face needs a payment method or credits for this.${said}`,
        'Add billing to the Hugging Face account, then try again.',
        status,
      );
    case 403:
      return new HubError(
        'forbidden',
        `The token isn't allowed to do this.${said}`,
        'Use a token with write access to that account or organization.',
        status,
      );
    case 404:
      return new HubError(
        'not_found',
        `Hugging Face has no such repository, file or job.${said}`,
        'Check the names, and that the token can see them.',
        status,
      );
    case 409:
    case 412:
      return new HubError(
        'conflict',
        `Hugging Face reported a conflict: the repository may have changed meanwhile.${said}`,
        'Try again.',
        status,
      );
    case 413:
      return new HubError(
        'too_large',
        `Hugging Face refused a file as too large.${said}`,
        'Send fewer or smaller files at a time.',
        status,
      );
    case 429:
      return new HubError(
        'rate_limit',
        `Hugging Face is limiting requests.${said}`,
        'Wait a minute, then try again.',
        status,
      );
    default:
      return new HubError(
        'server',
        `Hugging Face answered with an error (${status}).${said}`,
        'Try again in a few minutes.',
        status,
      );
  }
}

/** A repository id as the Hub names it, before it goes into a URL. */
function checkRepoId(repoId: string): void {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*\/[A-Za-z0-9][A-Za-z0-9._-]*$/.test(repoId)) {
    throw new HubError(
      'bad_response',
      `"${repoId}" isn't a repository name.`,
      'Name it as owner/name.',
    );
  }
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * The Hugging Face endpoints Architect uses: who the token belongs to, repositories, commits
 * (small files inline, large ones through LFS), revisions, file listings, downloads and Jobs.
 * The token goes only to the Hub's own address for the API calls that need it: never to an
 * upload or download host, never along a redirect, and never to a signed address.
 */
export class HubClient {
  readonly endpoint: string;
  private readonly origin: string;

  constructor(private readonly options: HubClientOptions) {
    this.endpoint = (options.endpoint ?? HF_ENDPOINT).replace(/\/+$/, '');
    const url = new URL(this.endpoint);
    if (url.protocol !== 'https:' && !isLoopbackUrl(url)) {
      throw new Error('Hugging Face must be reached over HTTPS.');
    }
    this.origin = url.origin;
  }

  private get fetch(): typeof fetch {
    return this.options.fetch ?? ((input, init) => fetch(input, init));
  }

  private async token(): Promise<string> {
    const token = await this.options.token();
    if (!token) {
      throw new HubError(
        'auth',
        'No Hugging Face token is saved.',
        'Add a Hugging Face token with write access in Settings.',
      );
    }
    return token;
  }

  private signalFor(signal: AbortSignal | undefined, timeoutMs: number): AbortSignal {
    const timeout = AbortSignal.timeout(timeoutMs);
    return signal ? AbortSignal.any([signal, timeout]) : timeout;
  }

  /** A request to the Hub's own API, with the token. `path` is a path, or a URL on the Hub. */
  private async send(
    method: 'GET' | 'POST',
    path: string,
    options: {
      body?: string;
      contentType?: string;
      headers?: Record<string, string>;
      signal?: AbortSignal;
      timeoutMs?: number;
    } = {},
  ): Promise<Response> {
    const token = await this.token();
    const url = path.startsWith('/') ? this.endpoint + path : path;
    if (new URL(url).origin !== this.origin) {
      throw new HubError(
        'bad_response',
        'Hugging Face pointed a request at another address.',
        'Try again later.',
      );
    }
    let response: Response;
    try {
      response = await this.fetch(url, {
        method,
        headers: {
          authorization: `Bearer ${token}`,
          accept: 'application/json',
          ...(options.contentType ? { 'content-type': options.contentType } : {}),
          ...options.headers,
        },
        ...(options.body === undefined ? {} : { body: options.body }),
        signal: this.signalFor(
          options.signal,
          options.timeoutMs ?? this.options.timeoutMs ?? 60_000,
        ),
      });
    } catch (error) {
      throw new HubError(
        'network',
        `Hugging Face could not be reached: ${messageOf(error)}`,
        'Check the internet connection, then try again.',
      );
    }
    if (!response.ok) throw failure(response.status, await this.detail(response, token));
    return response;
  }

  /** The error the Hub gave, without the token in it. */
  private async detail(response: Response, token: string | null): Promise<string> {
    const text = (await response.text().catch(() => '')).slice(0, 500);
    let detail = text;
    try {
      const parsed = JSON.parse(text) as { error?: unknown };
      if (typeof parsed.error === 'string') detail = parsed.error;
    } catch {
      // Plain text is shown as it is.
    }
    return (token ? detail.split(token).join('[token]') : detail).trim();
  }

  private async parse<S extends z.ZodType>(
    schema: S,
    response: Response,
    what: string,
  ): Promise<z.output<S>> {
    const parsed = schema.safeParse(await response.json().catch(() => null));
    if (!parsed.success) {
      throw new HubError(
        'bad_response',
        `Hugging Face answered ${what} in an unexpected shape.`,
        'Try again; if it keeps happening, the Hub may have changed.',
      );
    }
    return parsed.data;
  }

  private async json<S extends z.ZodType>(
    schema: S,
    method: 'GET' | 'POST',
    path: string,
    options: {
      body?: string;
      contentType?: string;
      headers?: Record<string, string>;
      signal?: AbortSignal;
    } = {},
  ): Promise<z.output<S>> {
    const response = await this.send(method, path, options);
    return this.parse(schema, response, new URL(path, this.endpoint).pathname);
  }

  /** The account the token belongs to. */
  async whoami(signal?: AbortSignal): Promise<string> {
    return (await this.json(WhoamiSchema, 'GET', '/api/whoami-v2', signal ? { signal } : {})).name;
  }

  /**
   * A model repository's visibility and the commit its main branch points at, or null when the
   * Hub has no such repository the token can see.
   */
  async repoInfo(
    repoId: string,
    signal?: AbortSignal,
  ): Promise<{ private: boolean; sha?: string } | null> {
    checkRepoId(repoId);
    try {
      const info = await this.json(
        RepoInfoSchema,
        'GET',
        `/api/models/${repoId}`,
        signal ? { signal } : {},
      );
      return { private: info.private, ...(info.sha ? { sha: info.sha } : {}) };
    } catch (error) {
      if (error instanceof HubError && error.code === 'not_found') return null;
      throw error;
    }
  }

  /** Creates a model repository with the given visibility; says whether it was there already. */
  async createRepo(
    repoId: string,
    visibility: { private: boolean },
    signal?: AbortSignal,
  ): Promise<'created' | 'exists'> {
    const [owner, name] = repoId.split('/');
    try {
      await this.send('POST', '/api/repos/create', {
        body: JSON.stringify({
          name,
          organization: owner,
          private: visibility.private,
          type: 'model',
        }),
        contentType: 'application/json',
        ...(signal ? { signal } : {}),
      });
      return 'created';
    } catch (error) {
      if (error instanceof HubError && error.code === 'conflict') return 'exists';
      throw error;
    }
  }

  /** Creates a private model repository; one that exists already is fine. */
  async createPrivateRepo(repoId: string, signal?: AbortSignal): Promise<void> {
    await this.createRepo(repoId, { private: true }, signal);
  }

  /** Adds small files to a repository's main branch in one commit; returns the commit. */
  async commit(
    repoId: string,
    files: readonly { path: string; content: Uint8Array }[],
    summary: string,
    signal?: AbortSignal,
  ): Promise<string> {
    for (const file of files) {
      if (file.content.length > MAX_COMMIT_FILE_BYTES) {
        throw new HubError(
          'too_large',
          `${file.path} is larger than 10 MB, which this upload can't send.`,
          'Train on fewer examples at a time.',
        );
      }
    }
    return this.commitLines(
      repoId,
      'main',
      { summary, description: '' },
      files.map((file) => ({
        key: 'file',
        value: {
          content: Buffer.from(file.content).toString('base64'),
          path: file.path,
          encoding: 'base64',
        },
      })),
      signal,
    );
  }

  /** One commit of NDJSON operations: the header first, then each file or deletion. */
  private async commitLines(
    repoId: string,
    branch: string,
    header: { summary: string; description: string; parentCommit?: string },
    operations: readonly { key: string; value: Record<string, unknown> }[],
    signal?: AbortSignal,
  ): Promise<string> {
    const lines = [{ key: 'header', value: header }, ...operations];
    const reply = await this.json(
      CommitSchema,
      'POST',
      `/api/models/${repoId}/commit/${encodeURIComponent(branch)}`,
      {
        body: lines.map((line) => `${JSON.stringify(line)}\n`).join(''),
        contentType: 'application/x-ndjson',
        ...(signal ? { signal } : {}),
      },
    );
    return reply.commitOid;
  }

  /** The commit a branch or tag points at now, or the commit itself when given one. */
  async revision(repoId: string, ref = 'main', signal?: AbortSignal): Promise<string> {
    const path = `/api/models/${repoId}/revision/${encodeURIComponent(ref)}`;
    return (await this.json(RevisionSchema, 'GET', path, signal ? { signal } : {})).sha;
  }

  /**
   * Every file in a repository at a revision, following the Hub's pages. Folders aren't listed;
   * a file kept in LFS carries the sha256 of its content.
   */
  async listFiles(repoId: string, revision: string, signal?: AbortSignal): Promise<RemoteFile[]> {
    checkRepoId(repoId);
    let next: string | null =
      `${this.endpoint}/api/models/${repoId}/tree/${encodeURIComponent(revision)}?recursive=true&expand=false`;
    const files: RemoteFile[] = [];
    for (let page = 0; next !== null; page++) {
      if (page >= MAX_TREE_PAGES) {
        throw new HubError(
          'too_large',
          `${repoId} holds more files than Architect lists.`,
          'Publish to a repository of its own.',
        );
      }
      const response = await this.send('GET', next, signal ? { signal } : {});
      for (const entry of await this.parse(TreeSchema, response, 'the file list')) {
        if (entry.type !== 'file') continue;
        files.push({
          path: entry.path,
          size: entry.lfs?.size ?? entry.size ?? 0,
          oid: entry.oid ?? '',
          ...(entry.lfs ? { lfs: { sha256: entry.lfs.oid, size: entry.lfs.size } } : {}),
        });
      }
      next = /<([^>]+)>;\s*rel="next"/.exec(response.headers.get('link') ?? '')?.[1] ?? null;
    }
    return files;
  }

  /**
   * Commits files to a branch, as huggingface_hub's create_commit does: the Hub says which files
   * go through LFS; those are sent to the upload addresses it gives (without the token) and
   * confirmed, then one commit adds every file and makes the deletions. The commit is all or
   * nothing: a failure before it changes nothing in the repository, and an upload already made
   * is kept by the Hub, so trying again skips it.
   */
  async uploadFiles(
    repoId: string,
    files: readonly UploadFile[],
    options: UploadOptions,
  ): Promise<UploadResult> {
    checkRepoId(repoId);
    const branch = options.branch ?? 'main';
    const { signal } = options;
    const prepared: PreparedUpload[] = [];
    for (const file of files) prepared.push(await describeUpload(file));
    const modes = new Map<string, 'lfs' | 'regular'>();
    for (let at = 0; at < prepared.length; at += BATCH_FILES) {
      const chunk = prepared.slice(at, at + BATCH_FILES);
      const reply = await this.json(
        PreuploadSchema,
        'POST',
        `/api/models/${repoId}/preupload/${encodeURIComponent(branch)}`,
        {
          body: JSON.stringify({
            files: chunk.map((file) => ({
              path: file.path,
              sample: Buffer.from(file.sample).toString('base64'),
              size: file.size,
            })),
          }),
          contentType: 'application/json',
          ...(signal ? { signal } : {}),
        },
      );
      for (const file of reply.files) {
        if (file.shouldIgnore) {
          throw new HubError(
            'conflict',
            `The repository's .gitignore leaves out ${file.path}, so it can't hold this upload.`,
            "Change the repository's .gitignore, or publish to another repository.",
          );
        }
        modes.set(file.path, file.uploadMode);
      }
    }
    for (const file of prepared) {
      if (!modes.has(file.path)) {
        throw new HubError(
          'bad_response',
          `Hugging Face didn't say how to upload ${file.path}.`,
          'Try again; if it keeps happening, the Hub may have changed.',
        );
      }
    }

    // An empty file never goes through LFS, as in huggingface_hub. Content that appears twice
    // is sent once.
    const lfs = prepared.filter((file) => modes.get(file.path) === 'lfs' && file.size > 0);
    const objects = [...new Map(lfs.map((file) => [file.sha256, file])).values()];
    for (let at = 0; at < objects.length; at += BATCH_FILES) {
      await this.sendLfsObjects(repoId, branch, objects.slice(at, at + BATCH_FILES), options);
    }

    const viaLfs = new Set(lfs.map((file) => file.path));
    const operations: { key: string; value: Record<string, unknown> }[] = [];
    for (const file of prepared) {
      if (viaLfs.has(file.path)) {
        operations.push({
          key: 'lfsFile',
          value: { path: file.path, algo: 'sha256', oid: file.sha256, size: file.size },
        });
      } else {
        operations.push({
          key: 'file',
          value: {
            content: Buffer.from(await file.bytes()).toString('base64'),
            path: file.path,
            encoding: 'base64',
          },
        });
      }
    }
    for (const path of options.deletions ?? []) {
      operations.push({ key: 'deletedFile', value: { path } });
    }
    const commit = await this.commitLines(
      repoId,
      branch,
      {
        summary: options.summary,
        description: options.description ?? '',
        ...(options.parentCommit ? { parentCommit: options.parentCommit } : {}),
      },
      operations,
      signal,
    );
    return {
      commit,
      files: prepared.map((file) => ({ path: file.path, lfs: viaLfs.has(file.path) })),
    };
  }

  /** Asks the LFS batch API where each object goes, then sends and confirms the new ones. */
  private async sendLfsObjects(
    repoId: string,
    branch: string,
    files: readonly PreparedUpload[],
    options: UploadOptions,
  ): Promise<void> {
    const { signal } = options;
    const batch = await this.json(LfsBatchSchema, 'POST', `/${repoId}.git/info/lfs/objects/batch`, {
      body: JSON.stringify({
        operation: 'upload',
        transfers: ['basic', 'multipart'],
        objects: files.map((file) => ({ oid: file.sha256, size: file.size })),
        hash_algo: 'sha256',
        ref: { name: branch },
      }),
      headers: LFS_HEADERS,
      ...(signal ? { signal } : {}),
    });
    for (const file of files) {
      const object = batch.objects.find(
        (entry) => entry.oid === file.sha256 && entry.size === file.size,
      );
      if (!object) {
        throw new HubError(
          'bad_response',
          `Hugging Face didn't answer for ${file.path} when asked where to upload it.`,
          'Try again; if it keeps happening, the Hub may have changed.',
        );
      }
      if (object.error) {
        throw new HubError(
          object.error.code === 422 ? 'mismatch' : 'server',
          `Hugging Face refused to take ${file.path}: ${object.error.message}`,
          'Try again; if it keeps happening, check the file.',
        );
      }
      const upload = object.actions?.upload;
      // No upload action means the Hub has this content already.
      if (!upload) {
        options.onProgress?.({ path: file.path, sent: file.size, size: file.size });
        continue;
      }
      const chunkSize = upload.header?.['chunk_size'];
      if (chunkSize === undefined) {
        await this.putSingle(upload, file, options);
      } else {
        await this.putMultipart(upload, Number(chunkSize), file, options);
      }
      const verify = object.actions?.verify;
      if (verify) await this.verifyLfs(verify, file, signal);
    }
  }

  /** An address the Hub handed out for an upload: HTTPS, or this computer in tests. */
  private uploadAddress(href: string, path: string): URL {
    let url: URL;
    try {
      url = new URL(href, this.endpoint);
    } catch {
      throw new HubError(
        'bad_response',
        `Hugging Face gave an upload address for ${path} that can't be read.`,
        'Try again later.',
      );
    }
    if (url.protocol !== 'https:' && !isLoopbackUrl(url)) {
      throw new HubError(
        'bad_response',
        `Hugging Face gave an insecure upload address for ${path}.`,
        'Try again later.',
      );
    }
    return url;
  }

  /** A request to an upload host: never with the token. */
  private async transfer(
    url: URL,
    init: {
      method: 'PUT' | 'POST';
      headers: Record<string, string>;
      body: NonNullable<RequestInit['body']>;
    },
    path: string,
    bytes: number,
    signal: AbortSignal | undefined,
  ): Promise<Response> {
    let response: Response;
    try {
      response = await this.fetch(url, {
        ...init,
        ...(init.body instanceof ReadableStream ? { duplex: 'half' } : {}),
        signal: this.signalFor(
          signal,
          60_000 + Math.ceil((bytes / UPLOAD_BYTES_PER_SECOND) * 1000),
        ),
      } as RequestInit);
    } catch (error) {
      throw new HubError(
        'network',
        `The upload of ${path} broke off: ${messageOf(error)}`,
        'Try again; parts that already arrived are kept.',
      );
    }
    if (!response.ok) {
      const detail = await this.detail(response, null);
      throw new HubError(
        response.status >= 500 || response.status === 429 ? 'server' : 'bad_response',
        `The upload of ${path} failed (${response.status}).${detail ? ` ${detail.slice(0, 200)}` : ''}`,
        'Try again; parts that already arrived are kept.',
        response.status,
      );
    }
    return response;
  }

  private async putSingle(
    action: LfsAction,
    file: PreparedUpload,
    options: UploadOptions,
  ): Promise<void> {
    const url = this.uploadAddress(action.href, file.path);
    const response = await this.transfer(
      url,
      {
        method: 'PUT',
        headers: { 'content-length': String(file.size) },
        body: file.stream(0, file.size),
      },
      file.path,
      file.size,
      options.signal,
    );
    await response.body?.cancel();
    options.onProgress?.({ path: file.path, sent: file.size, size: file.size });
  }

  /**
   * Sends a large object in the parts the Hub asked for, each to its own signed address, then
   * completes the upload with every part's ETag at the address the Hub gave for that.
   */
  private async putMultipart(
    action: LfsAction,
    chunkSize: number,
    file: PreparedUpload,
    options: UploadOptions,
  ): Promise<void> {
    const header = action.header ?? {};
    const parts = Object.entries(header)
      .filter(([key]) => /^\d+$/.test(key))
      .map(([key, href]) => ({ number: Number.parseInt(key, 10), href: String(href) }))
      .sort((a, b) => a.number - b.number);
    if (
      !Number.isSafeInteger(chunkSize) ||
      chunkSize <= 0 ||
      parts.length !== Math.ceil(file.size / chunkSize) ||
      parts.some((part, index) => part.number !== index + 1)
    ) {
      throw new HubError(
        'bad_response',
        `Hugging Face asked for ${file.path} in parts that don't fit its size.`,
        'Try again later.',
      );
    }
    const etags: { partNumber: number; etag: string }[] = [];
    for (const part of parts) {
      const start = (part.number - 1) * chunkSize;
      const length = Math.min(chunkSize, file.size - start);
      const response = await this.transfer(
        this.uploadAddress(part.href, file.path),
        {
          method: 'PUT',
          headers: { 'content-length': String(length) },
          body: await file.slice(start, length),
        },
        file.path,
        length,
        options.signal,
      );
      await response.body?.cancel();
      const etag = response.headers.get('etag');
      if (!etag) {
        throw new HubError(
          'bad_response',
          `Part ${part.number} of ${file.path} came back without an ETag.`,
          'Try again later.',
        );
      }
      etags.push({ partNumber: part.number, etag });
      options.onProgress?.({ path: file.path, sent: start + length, size: file.size });
    }
    const body = JSON.stringify({ oid: file.sha256, parts: etags });
    const done = await this.transfer(
      this.uploadAddress(action.href, file.path),
      { method: 'POST', headers: LFS_HEADERS, body },
      file.path,
      body.length,
      options.signal,
    );
    await done.body?.cancel();
  }

  /** Asks the Hub to confirm it holds an object it just received. */
  private async verifyLfs(
    action: LfsAction,
    file: PreparedUpload,
    signal: AbortSignal | undefined,
  ): Promise<void> {
    const url = this.uploadAddress(action.href, file.path);
    const body = JSON.stringify({ oid: file.sha256, size: file.size });
    if (url.origin === this.origin) {
      await this.send('POST', url.href, {
        body,
        contentType: 'application/json',
        ...(signal ? { signal } : {}),
      });
      return;
    }
    const response = await this.transfer(
      url,
      { method: 'POST', headers: { 'content-type': 'application/json' }, body },
      file.path,
      body.length,
      signal,
    );
    await response.body?.cancel();
  }

  /**
   * Downloads one file at a revision into `dest`, checking its hash and size when they're
   * known, and refusing a file larger than `limits.maxBytes`. Follows the Hub's redirects to its
   * download hosts without the token.
   */
  async download(
    repoId: string,
    revision: string,
    path: string,
    dest: string,
    expect: { sha256: string; bytes: number } | null,
    signal?: AbortSignal,
    limits?: { maxBytes: number },
  ): Promise<{ sha256: string; bytes: number }> {
    let url = new URL(
      `${this.endpoint}/${repoId}/resolve/${encodeURIComponent(revision)}/${encodePath(path)}`,
    );
    let token: string | null = await this.token();
    for (let hop = 0; ; hop++) {
      let response: Response;
      try {
        response = await this.fetch(url, {
          headers: token ? { authorization: `Bearer ${token}` } : {},
          redirect: 'manual',
          ...(signal ? { signal } : {}),
        });
      } catch (error) {
        throw new HubError(
          'network',
          `The download of ${path} failed: ${messageOf(error)}`,
          'Check the internet connection, then try again.',
        );
      }
      const location = response.headers.get('location');
      if (response.status >= 300 && response.status < 400 && location) {
        await response.body?.cancel();
        if (hop >= 5)
          throw new HubError(
            'bad_response',
            `The download of ${path} redirected too often.`,
            'Try again later.',
          );
        url = new URL(location, url);
        if (url.protocol !== 'https:' && !isLoopbackUrl(url)) {
          throw new HubError(
            'bad_response',
            `The download of ${path} was sent to an insecure address.`,
            'Try again later.',
          );
        }
        // The token is the Hub's; a download host gets a signed address instead.
        if (url.origin !== this.origin) token = null;
        continue;
      }
      if (!response.ok || !response.body) {
        throw failure(response.status, await this.detail(response, token));
      }
      return this.save(response.body, path, dest, expect, limits?.maxBytes);
    }
  }

  private async save(
    body: ReadableStream<Uint8Array>,
    path: string,
    dest: string,
    expect: { sha256: string; bytes: number } | null,
    maxBytes: number | undefined,
  ): Promise<{ sha256: string; bytes: number }> {
    mkdirSync(dirname(dest), { recursive: true });
    const temporary = `${dest}.${randomBytes(6).toString('hex')}.part`;
    const hash = createHash('sha256');
    let bytes = 0;
    let tooLarge = false;
    const fd = openSync(temporary, 'w');
    try {
      for await (const chunk of body) {
        writeSync(fd, chunk);
        hash.update(chunk);
        bytes += chunk.length;
        if (expect && bytes > expect.bytes) break;
        if (maxBytes !== undefined && bytes > maxBytes) {
          tooLarge = true;
          break;
        }
      }
      fsyncSync(fd);
    } catch (error) {
      closeSync(fd);
      rmSync(temporary, { force: true });
      throw new HubError(
        'network',
        `The download of ${path} broke off: ${messageOf(error)}`,
        'Try again.',
      );
    }
    closeSync(fd);
    if (tooLarge) {
      rmSync(temporary, { force: true });
      throw new HubError(
        'too_large',
        `${path} is larger than the ${maxBytes} bytes it may be.`,
        "Check the repository: this isn't what Architect publishes.",
      );
    }
    const sha256 = hash.digest('hex');
    if (expect && (sha256 !== expect.sha256 || bytes !== expect.bytes)) {
      rmSync(temporary, { force: true });
      throw new HubError(
        'mismatch',
        `${path} doesn't match the hash its job recorded.`,
        'Download it again; if it keeps failing, the outputs were changed after the job.',
      );
    }
    renameSync(temporary, dest);
    return { sha256, bytes };
  }

  async createJob(namespace: string, spec: JobSpec, signal?: AbortSignal): Promise<JobInfo> {
    return this.json(JobInfoSchema, 'POST', `/api/jobs/${namespace}`, {
      body: JSON.stringify(spec),
      contentType: 'application/json',
      ...(signal ? { signal } : {}),
    });
  }

  async listJobs(namespace: string, signal?: AbortSignal): Promise<JobInfo[]> {
    return this.json(
      z.array(JobInfoSchema),
      'GET',
      `/api/jobs/${namespace}`,
      signal ? { signal } : {},
    );
  }

  async getJob(namespace: string, id: string, signal?: AbortSignal): Promise<JobInfo> {
    return this.json(
      JobInfoSchema,
      'GET',
      `/api/jobs/${namespace}/${id}`,
      signal ? { signal } : {},
    );
  }

  async cancelJob(namespace: string, id: string, signal?: AbortSignal): Promise<void> {
    await this.send('POST', `/api/jobs/${namespace}/${id}/cancel`, signal ? { signal } : {});
  }

  /** The job's log so far. The Hub streams it as server-sent events and holds the stream open while the job runs. */
  async jobLogs(
    namespace: string,
    id: string,
    waitMs = 5000,
    signal?: AbortSignal,
  ): Promise<string> {
    const stop = new AbortController();
    const timer = setTimeout(() => stop.abort(), waitMs);
    const lines: string[] = [];
    try {
      const response = await this.send('GET', `/api/jobs/${namespace}/${id}/logs`, {
        signal: signal ? AbortSignal.any([signal, stop.signal]) : stop.signal,
        timeoutMs: waitMs + 5000,
      });
      if (!response.body) return '';
      let partial = '';
      const decoder = new TextDecoder();
      for await (const chunk of response.body) {
        const pieces = (partial + decoder.decode(chunk, { stream: true })).split('\n');
        partial = pieces.pop() ?? '';
        for (const piece of pieces) {
          if (!piece.startsWith('data: ')) continue;
          try {
            const event = JSON.parse(piece.slice(6)) as { data?: unknown };
            if (typeof event.data === 'string') lines.push(event.data);
          } catch {
            // A line that isn't an event is not part of the log.
          }
        }
      }
    } catch (error) {
      if (!stop.signal.aborted) throw error;
    } finally {
      clearTimeout(timer);
    }
    return lines.map((line) => `${line.replace(/\n$/, '')}\n`).join('');
  }
}

/** A file ready to upload: its size, sha256, the sample preupload sends, and how to read it. */
interface PreparedUpload {
  path: string;
  size: number;
  sha256: string;
  sample: Uint8Array;
  bytes(): Promise<Bytes>;
  slice(start: number, length: number): Promise<Bytes>;
  stream(start: number, length: number): ReadableStream<Bytes> | Bytes;
}

/** Bytes in an ArrayBuffer of their own, which every fetch body type accepts. */
type Bytes = Uint8Array<ArrayBuffer>;

const SAMPLE_BYTES = 512;

async function describeUpload(file: UploadFile): Promise<PreparedUpload> {
  if ('content' in file) {
    const content: Bytes = new Uint8Array(file.content);
    return {
      path: file.path,
      size: content.length,
      sha256: createHash('sha256').update(content).digest('hex'),
      sample: content.subarray(0, SAMPLE_BYTES),
      bytes: async () => content,
      slice: async (start, length) => content.subarray(start, start + length),
      stream: (start, length) => content.subarray(start, start + length),
    };
  }
  const { source, size } = file;
  const slice = async (start: number, length: number): Promise<Bytes> => {
    const handle = await open(source, 'r');
    try {
      const buffer = Buffer.alloc(length);
      let read = 0;
      while (read < length) {
        const { bytesRead } = await handle.read(buffer, read, length - read, start + read);
        if (bytesRead === 0) break;
        read += bytesRead;
      }
      if (read !== length) throw new Error(`${file.path} is shorter than ${size} bytes.`);
      return buffer;
    } finally {
      await handle.close();
    }
  };
  return {
    path: file.path,
    size,
    sha256: file.sha256,
    sample: await slice(0, Math.min(SAMPLE_BYTES, size)),
    bytes: () => slice(0, size),
    slice,
    stream: (start, length) =>
      length === 0
        ? new Uint8Array()
        : (Readable.toWeb(
            createReadStream(source, { start, end: start + length - 1 }),
          ) as ReadableStream<Bytes>),
  };
}
