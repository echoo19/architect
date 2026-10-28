import { createHash, randomBytes } from 'node:crypto';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';

/**
 * The parts of Hugging Face's API that Architect uses, on 127.0.0.1: whoami, repositories and
 * their visibility, commits (inline files, LFS files and deletions, with an optional parent
 * commit), preupload, the LFS batch API with basic and multipart transfers to a second "upload
 * host", LFS verification, revisions, tree listings in pages, downloads (large files redirect to
 * that second host, which must never see the token), and Jobs with their logs. Tests drive jobs
 * to an end by hand.
 */

export interface HubRequest {
  method: string;
  path: string;
  authorized: boolean;
  body: string;
}

/** A request the upload and download host received. */
export interface HostRequest {
  method: string;
  path: string;
  authorized: boolean;
  /** The Content-Length header an upload came with, if any. */
  contentLength?: string;
  chunked: boolean;
}

export interface RepoCommit {
  sha: string;
  files: Map<string, Buffer>;
  /** Paths whose content is kept in LFS. */
  lfs?: Set<string>;
  summary?: string;
}

interface Repo {
  private: boolean;
  /** Each commit's files, oldest first. */
  commits: RepoCommit[];
}

export interface FakeJob {
  id: string;
  namespace: string;
  stage: string;
  message?: string;
  createdAt: string;
  spec: Record<string, unknown>;
  logs: string[];
}

export interface FakeHubOptions {
  /** Files at least this large are told to go through LFS. Default 10 MB, as on the Hub. */
  lfsThreshold?: number;
  /** LFS objects at least this large are sent in parts. Default: never. */
  multipartThreshold?: number;
  /** The size of each part. Default 5 bytes short of the threshold's half, so parts are uneven. */
  partSize?: number;
  /** Files per page of a tree listing. Default 1000. */
  treePageSize?: number;
}

export interface FakeHub {
  readonly url: string;
  /** The second host: downloads of large files and LFS uploads go there. */
  readonly hostUrl: string;
  readonly requests: HubRequest[];
  readonly repos: Map<string, Repo>;
  readonly jobs: Map<string, FakeJob>;
  /** LFS objects the Hub holds, by sha256. */
  readonly lfs: Map<string, Buffer>;
  /** Requests the download host received, and whether any carried a token. */
  readonly downloads: { path: string; authorized: boolean }[];
  /** Requests the upload host received: none may carry the token. */
  readonly uploads: HostRequest[];
  /** Commits files to a repo's main branch, as a job uploading its outputs would. */
  commit(repo: string, files: Record<string, Buffer>): string;
  /** The files of a repository at a revision (its head when none is named). */
  filesAt(repo: string, revision?: string): Map<string, Buffer>;
  setStage(id: string, stage: string, message?: string): void;
  /** Fails the next request to a path that starts with this prefix, with this status. */
  failNext(prefix: string, status: number, error: string): void;
  /** Fails the next upload to the upload host with this status, or drops its connection. */
  failNextUpload(status: number | 'drop'): void;
  close(): Promise<void>;
}

const TOKEN = 'hf_test_token_0123456789';
export const FAKE_HUB_TOKEN = TOKEN;

async function readBody(request: IncomingMessage): Promise<Buffer> {
  const parts: Buffer[] = [];
  for await (const part of request) parts.push(part as Buffer);
  return Buffer.concat(parts);
}

function send(response: ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, { 'content-type': 'application/json' });
  response.end(JSON.stringify(body));
}

function listen(server: Server): Promise<string> {
  return new Promise((resolve) =>
    server.listen(0, '127.0.0.1', () => {
      resolve(`http://127.0.0.1:${(server.address() as AddressInfo).port}`);
    }),
  );
}

const sha256 = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');

/** What git calls a blob's id: sha1 over a short header and the bytes. */
function blobId(bytes: Buffer): string {
  return createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex');
}

function pointerOf(content: Buffer): Buffer {
  return Buffer.from(
    `version https://git-lfs.github.com/spec/v1\noid sha256:${sha256(content)}\nsize ${content.length}\n`,
  );
}

const LARGE = /\.(gguf|safetensors)$/;
const HEX40 = /^[0-9a-f]{40}$/;

export async function startFakeHub(options: FakeHubOptions = {}): Promise<FakeHub> {
  const lfsThreshold = options.lfsThreshold ?? 10 * 1024 * 1024;
  const multipartThreshold = options.multipartThreshold ?? Number.POSITIVE_INFINITY;
  const partSize =
    options.partSize ??
    (Number.isFinite(multipartThreshold) ? Math.max(1, Math.floor(multipartThreshold / 2) - 5) : 1);
  const treePageSize = options.treePageSize ?? 1000;

  const requests: HubRequest[] = [];
  const downloads: { path: string; authorized: boolean }[] = [];
  const uploads: HostRequest[] = [];
  const repos = new Map<string, Repo>();
  const jobs = new Map<string, FakeJob>();
  const failures: { prefix: string; status: number; error: string }[] = [];
  const uploadFailures: (number | 'drop')[] = [];
  const blobs = new Map<string, Buffer>();
  const lfs = new Map<string, Buffer>();
  /** Multipart uploads in progress: the parts received, by number, with their ETags. */
  const multipart = new Map<
    string,
    { oid: string; size: number; parts: Map<number, { bytes: Buffer; etag: string }> }
  >();
  let url = '';

  const host = createServer((request, response) => {
    void (async () => {
      const path = request.url ?? '';
      const method = request.method ?? 'GET';
      const authorized = request.headers.authorization !== undefined;
      if (method === 'GET') {
        downloads.push({ path, authorized });
        const blob = blobs.get(path.replace(/^\/blob\//, '').split('?')[0] ?? '');
        if (!blob) {
          send(response, 404, { error: 'no such blob' });
          return;
        }
        response.writeHead(200, { 'content-type': 'application/octet-stream' });
        response.end(blob);
        return;
      }
      uploads.push({
        method,
        path,
        authorized,
        ...(request.headers['content-length'] === undefined
          ? {}
          : { contentLength: request.headers['content-length'] }),
        chunked: request.headers['transfer-encoding'] === 'chunked',
      });
      const failure = uploadFailures.shift();
      if (failure === 'drop') {
        request.socket.destroy();
        return;
      }
      const body = await readBody(request);
      if (failure !== undefined) {
        response.writeHead(failure, { 'content-type': 'application/xml' });
        response.end('<Error><Code>InternalError</Code></Error>');
        return;
      }
      let match: RegExpExecArray | null;
      if (method === 'PUT' && (match = /^\/upload\/([0-9a-f]{64})$/.exec(path))) {
        const oid = match[1] ?? '';
        if (sha256(body) !== oid) {
          send(response, 400, { error: 'content does not match its oid' });
          return;
        }
        lfs.set(oid, body);
        response.writeHead(200);
        response.end();
        return;
      }
      if (method === 'PUT' && (match = /^\/upload\/([0-9a-f]+)\/part\/(\d+)$/.exec(path))) {
        const upload = multipart.get(match[1] ?? '');
        if (!upload) {
          send(response, 404, { error: 'no such upload' });
          return;
        }
        const etag = `"${createHash('md5').update(body).digest('hex')}"`;
        upload.parts.set(Number(match[2]), { bytes: body, etag });
        response.writeHead(200, { etag });
        response.end();
        return;
      }
      send(response, 404, { error: `no route ${method} ${path}` });
    })();
  });
  const hostUrl = await listen(host);

  const repoOf = (id: string): Repo => {
    const repo = repos.get(id);
    if (!repo) throw new Error(`no repo ${id}`);
    return repo;
  };

  const headOf = (repo: Repo): RepoCommit | undefined => repo.commits.at(-1);

  const commitTo = (
    repoId: string,
    files: Record<string, Buffer>,
    extra: { lfs?: readonly string[]; deleted?: readonly string[]; summary?: string } = {},
  ): string => {
    const repo = repoOf(repoId);
    const previous = headOf(repo);
    const next = new Map(previous?.files ?? new Map<string, Buffer>());
    const lfsPaths = new Set(previous?.lfs ?? []);
    for (const path of extra.deleted ?? []) {
      next.delete(path);
      lfsPaths.delete(path);
    }
    for (const [path, content] of Object.entries(files)) {
      next.set(path, content);
      lfsPaths.delete(path);
    }
    for (const path of extra.lfs ?? []) lfsPaths.add(path);
    const sha = createHash('sha1').update(randomBytes(16)).digest('hex');
    repo.commits.push({
      sha,
      files: next,
      lfs: lfsPaths,
      ...(extra.summary === undefined ? {} : { summary: extra.summary }),
    });
    return sha;
  };

  const commitAt = (repo: Repo, revision: string): RepoCommit | undefined =>
    revision === 'main' ? headOf(repo) : repo.commits.find((entry) => entry.sha === revision);

  const isLfs = (commit: RepoCommit, path: string): boolean =>
    commit.lfs?.has(path) === true || LARGE.test(path);

  const server = createServer((request, response) => {
    void (async () => {
      const raw = await readBody(request);
      const body = raw.toString('utf8');
      const path = request.url ?? '/';
      const parsed = new URL(path, url);
      const route = parsed.pathname;
      const method = request.method ?? 'GET';
      const authorized = request.headers.authorization === `Bearer ${TOKEN}`;
      requests.push({ method, path, authorized, body });

      // A multipart upload is completed at a signed address, which needs no token.
      if (method === 'POST' && route === '/api/complete_multipart') {
        const upload = multipart.get(parsed.searchParams.get('upload') ?? '');
        const reply = JSON.parse(body) as {
          oid: string;
          parts: { partNumber: number; etag: string }[];
        };
        if (!upload || reply.oid !== upload.oid) {
          send(response, 400, { error: 'unknown upload' });
          return;
        }
        const pieces: Buffer[] = [];
        for (const [index, part] of reply.parts.entries()) {
          const stored = upload.parts.get(part.partNumber);
          if (part.partNumber !== index + 1 || !stored || stored.etag !== part.etag) {
            send(response, 400, { error: `part ${part.partNumber} does not match` });
            return;
          }
          pieces.push(stored.bytes);
        }
        const whole = Buffer.concat(pieces);
        if (whole.length !== upload.size || sha256(whole) !== upload.oid) {
          send(response, 400, { error: 'the parts do not make the object' });
          return;
        }
        lfs.set(upload.oid, whole);
        send(response, 200, {});
        return;
      }

      // As on the Hub: a wrong token is refused, and no token reads only public repositories.
      const presented = request.headers.authorization !== undefined;
      const repoMatch = /^\/api\/models\/([^/]+\/[^/]+)(?:\/|$)|^\/([^/]+\/[^/]+)\/resolve\//.exec(
        route,
      );
      const publicRead =
        method === 'GET' && repos.get(repoMatch?.[1] ?? repoMatch?.[2] ?? '')?.private === false;
      if (presented ? !authorized : !publicRead) {
        send(response, 401, { error: 'Invalid credentials in Authorization header' });
        return;
      }
      const failure = failures.findIndex((entry) => path.startsWith(entry.prefix));
      if (failure !== -1) {
        const [entry] = failures.splice(failure, 1);
        send(response, entry?.status ?? 500, { error: entry?.error ?? 'failure' });
        return;
      }
      let match: RegExpExecArray | null;

      if (method === 'GET' && route === '/api/whoami-v2') {
        send(response, 200, { name: 'jake', type: 'user' });
        return;
      }
      if (method === 'POST' && route === '/api/repos/create') {
        const {
          name,
          organization,
          private: isPrivate,
        } = JSON.parse(body) as {
          name: string;
          organization: string;
          private: boolean;
        };
        const id = `${organization}/${name}`;
        if (repos.has(id)) {
          send(response, 409, { error: 'You already created this model repo' });
          return;
        }
        repos.set(id, { private: isPrivate, commits: [] });
        send(response, 200, { url: `https://huggingface.co/${id}` });
        return;
      }
      if (method === 'GET' && (match = /^\/api\/models\/([^/]+\/[^/]+)$/.exec(route))) {
        const repo = repos.get(match[1] ?? '');
        if (!repo) {
          send(response, 404, { error: 'Repository not found' });
          return;
        }
        send(response, 200, {
          id: match[1],
          private: repo.private,
          sha: headOf(repo)?.sha ?? null,
        });
        return;
      }
      if (method === 'POST' && /^\/api\/models\/[^/]+\/[^/]+\/preupload\/.+$/.test(route)) {
        const asked = JSON.parse(body) as {
          files: { path: string; size: number; sample: string }[];
        };
        send(response, 200, {
          files: asked.files.map((file) => {
            const sample = Buffer.from(file.sample, 'base64');
            const binary = sample.includes(0);
            const viaLfs = LARGE.test(file.path) || file.size >= lfsThreshold || binary;
            return { path: file.path, uploadMode: viaLfs ? 'lfs' : 'regular', shouldIgnore: false };
          }),
        });
        return;
      }
      if (
        method === 'POST' &&
        (match = /^\/([^/]+\/[^/]+)\.git\/info\/lfs\/objects\/batch$/.exec(route))
      ) {
        if (!repos.has(match[1] ?? '')) {
          send(response, 404, { error: 'Repository not found' });
          return;
        }
        const asked = JSON.parse(body) as {
          operation: string;
          objects: { oid: string; size: number }[];
        };
        const repoPath = match[1] ?? '';
        send(response, 200, {
          transfer: 'basic',
          objects: asked.objects.map((object) => {
            if (lfs.has(object.oid)) return { oid: object.oid, size: object.size };
            const verify = { href: `${url}/${repoPath}.git/info/lfs/objects/verify` };
            if (object.size < multipartThreshold) {
              return {
                oid: object.oid,
                size: object.size,
                authenticated: true,
                actions: { upload: { href: `${hostUrl}/upload/${object.oid}` }, verify },
              };
            }
            const id = randomBytes(8).toString('hex');
            multipart.set(id, { oid: object.oid, size: object.size, parts: new Map() });
            const count = Math.ceil(object.size / partSize);
            const header: Record<string, string> = { chunk_size: String(partSize) };
            for (let part = 1; part <= count; part++) {
              header[String(part).padStart(5, '0')] = `${hostUrl}/upload/${id}/part/${part}`;
            }
            return {
              oid: object.oid,
              size: object.size,
              authenticated: true,
              actions: {
                upload: {
                  href: `${url}/api/complete_multipart?upload=${id}&signature=abc`,
                  header,
                },
                verify,
              },
            };
          }),
        });
        return;
      }
      if (method === 'POST' && /^\/[^/]+\/[^/]+\.git\/info\/lfs\/objects\/verify$/.test(route)) {
        const asked = JSON.parse(body) as { oid: string; size: number };
        if (lfs.get(asked.oid)?.length !== asked.size) {
          send(response, 404, { error: 'Object not found' });
          return;
        }
        send(response, 200, {});
        return;
      }
      if (
        method === 'POST' &&
        (match = /^\/api\/models\/([^/]+\/[^/]+)\/commit\/(.+)$/.exec(route))
      ) {
        const repo = repos.get(match[1] ?? '');
        if (!repo) {
          send(response, 404, { error: 'Repository not found' });
          return;
        }
        const lines = body
          .split('\n')
          .filter((line) => line !== '')
          .map((line) => JSON.parse(line) as { key: string; value: Record<string, unknown> });
        const [header, ...operations] = lines;
        if (header?.key !== 'header') {
          send(response, 400, { error: 'header first' });
          return;
        }
        const parent = header.value['parentCommit'];
        if (typeof parent === 'string' && parent !== headOf(repo)?.sha) {
          send(response, 412, {
            error: 'A commit has happened since. Please refresh and try again.',
          });
          return;
        }
        const files: Record<string, Buffer> = {};
        const lfsPaths: string[] = [];
        const deleted: string[] = [];
        for (const operation of operations) {
          const value = operation.value;
          const filePath = String(value['path'] ?? '');
          if (operation.key === 'file') {
            files[filePath] = Buffer.from(String(value['content'] ?? ''), 'base64');
          } else if (operation.key === 'lfsFile') {
            const stored = lfs.get(String(value['oid']));
            if (!stored || stored.length !== value['size']) {
              send(response, 422, { error: `LFS object for ${filePath} not found` });
              return;
            }
            files[filePath] = stored;
            lfsPaths.push(filePath);
          } else if (operation.key === 'deletedFile') {
            deleted.push(filePath);
          } else {
            send(response, 400, { error: `unknown operation ${operation.key}` });
            return;
          }
        }
        const summary = String(header.value['summary'] ?? '');
        const sha = commitTo(match[1] ?? '', files, { lfs: lfsPaths, deleted, summary });
        send(response, 200, {
          success: true,
          commitOid: sha,
          commitUrl: `https://huggingface.co/${match[1]}/commit/${sha}`,
        });
        return;
      }
      if (
        method === 'GET' &&
        (match = /^\/api\/models\/([^/]+\/[^/]+)\/revision\/(.+)$/.exec(route))
      ) {
        const repo = repos.get(match[1] ?? '');
        const ref = decodeURIComponent(match[2] ?? '');
        const found = repo ? commitAt(repo, ref) : undefined;
        if (!found) {
          send(response, 404, { error: repo ? 'Revision not found' : 'Repository not found' });
          return;
        }
        send(response, 200, { id: match[1], sha: found.sha });
        return;
      }
      if (
        method === 'GET' &&
        (match = /^\/api\/models\/([^/]+\/[^/]+)\/tree\/([^/]+)$/.exec(route))
      ) {
        const repo = repos.get(match[1] ?? '');
        const found = repo ? commitAt(repo, decodeURIComponent(match[2] ?? '')) : undefined;
        if (!found) {
          send(response, 404, { error: 'Revision not found' });
          return;
        }
        const entries = [...found.files.entries()]
          .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
          .map(([filePath, content]) =>
            isLfs(found, filePath)
              ? {
                  type: 'file',
                  oid: blobId(pointerOf(content)),
                  size: content.length,
                  lfs: {
                    oid: sha256(content),
                    size: content.length,
                    pointerSize: pointerOf(content).length,
                  },
                  path: filePath,
                }
              : { type: 'file', oid: blobId(content), size: content.length, path: filePath },
          );
        const cursor = Number(parsed.searchParams.get('cursor') ?? '0');
        const page = entries.slice(cursor, cursor + treePageSize);
        const headers: Record<string, string> = { 'content-type': 'application/json' };
        if (cursor + treePageSize < entries.length) {
          const next = new URL(parsed.href);
          next.searchParams.set('cursor', String(cursor + treePageSize));
          headers['link'] = `<${next.href}>; rel="next"`;
        }
        response.writeHead(200, headers);
        response.end(JSON.stringify(page));
        return;
      }
      if (method === 'GET' && (match = /^\/([^/]+\/[^/]+)\/resolve\/([^/]+)\/(.+)$/.exec(route))) {
        const repo = repos.get(match[1] ?? '');
        const revision = decodeURIComponent(match[2] ?? '');
        const found = repo && HEX40.test(revision) ? commitAt(repo, revision) : undefined;
        const filePath = decodeURIComponent(match[3] ?? '');
        const file = found?.files.get(filePath);
        if (!found || !file) {
          send(response, 404, { error: 'Entry not found' });
          return;
        }
        if (isLfs(found, filePath)) {
          const key = sha256(file);
          blobs.set(key, file);
          response.writeHead(302, { location: `${hostUrl}/blob/${key}?signature=abc` });
          response.end();
          return;
        }
        response.writeHead(200, { 'content-type': 'application/octet-stream' });
        response.end(file);
        return;
      }
      if ((match = /^\/api\/jobs\/([^/]+)$/.exec(route))) {
        const namespace = match[1] ?? '';
        if (method === 'POST') {
          const spec = JSON.parse(body) as Record<string, unknown>;
          const id = randomBytes(12).toString('hex');
          const job: FakeJob = {
            id,
            namespace,
            stage: 'RUNNING',
            createdAt: new Date().toISOString(),
            spec,
            logs: ['===== Job started =====', 'Installing packages'],
          };
          jobs.set(id, job);
          send(response, 200, info(job));
          return;
        }
        send(
          response,
          200,
          [...jobs.values()].filter((job) => job.namespace === namespace).map(info),
        );
        return;
      }
      if ((match = /^\/api\/jobs\/([^/]+)\/([^/]+)(\/cancel|\/logs)?$/.exec(route))) {
        const job = jobs.get(match[2] ?? '');
        if (!job) {
          send(response, 404, { error: 'Job not found' });
          return;
        }
        if (match[3] === '/cancel' && method === 'POST') {
          job.stage = 'CANCELED';
          send(response, 200, {});
          return;
        }
        if (match[3] === '/logs') {
          response.writeHead(200, { 'content-type': 'text/event-stream' });
          for (const line of job.logs) {
            response.write(
              `data: ${JSON.stringify({ data: line, timestamp: new Date().toISOString() })}\n\n`,
            );
          }
          // A running job's log stays open; a finished one ends.
          if (job.stage !== 'RUNNING') response.end();
          return;
        }
        send(response, 200, info(job));
        return;
      }
      send(response, 404, { error: `no route ${method} ${path}` });
    })();
  });
  url = await listen(server);

  function info(job: FakeJob) {
    const environment = job.spec['environment'] as Record<string, string>;
    return {
      id: job.id,
      createdAt: job.createdAt,
      dockerImage: job.spec['dockerImage'],
      command: job.spec['command'],
      environment,
      secrets: Object.keys((job.spec['secrets'] as Record<string, string>) ?? {}),
      flavor: job.spec['flavor'],
      status: { stage: job.stage, message: job.message ?? null },
      owner: { id: 'u1', name: job.namespace, type: 'user' },
    };
  }

  return {
    url,
    hostUrl,
    requests,
    repos,
    jobs,
    lfs,
    downloads,
    uploads,
    commit: (repo, files) => commitTo(repo, files),
    filesAt(repo, revision) {
      const found =
        revision === undefined ? headOf(repoOf(repo)) : commitAt(repoOf(repo), revision);
      if (!found) throw new Error(`no revision ${revision ?? 'main'} in ${repo}`);
      return found.files;
    },
    setStage(id, stage, message) {
      const job = jobs.get(id);
      if (!job) throw new Error(`no job ${id}`);
      job.stage = stage;
      if (message !== undefined) job.message = message;
    },
    failNext(prefix, status, error) {
      failures.push({ prefix, status, error });
    },
    failNextUpload(status) {
      uploadFailures.push(status);
    },
    close: async () => {
      for (const target of [server, host]) {
        target.closeAllConnections();
        await new Promise<void>((done) => target.close(() => done()));
      }
    },
  };
}
