import { createHash, randomBytes } from 'node:crypto';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';

/**
 * The parts of Hugging Face's API that training uses, on 127.0.0.1: whoami, private repos,
 * NDJSON commits, revisions, downloads (large files redirect to a second "download host", which
 * must never see the token), and Jobs with their logs. Tests drive jobs to an end by hand.
 */

export interface HubRequest {
  method: string;
  path: string;
  authorized: boolean;
  body: string;
}

interface Repo {
  private: boolean;
  /** Each commit's files, oldest first. */
  commits: { sha: string; files: Map<string, Buffer> }[];
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

export interface FakeHub {
  readonly url: string;
  readonly requests: HubRequest[];
  readonly repos: Map<string, Repo>;
  readonly jobs: Map<string, FakeJob>;
  /** Requests the download host received, and whether any carried a token. */
  readonly downloads: { path: string; authorized: boolean }[];
  /** Commits files to a repo's main branch, as a job uploading its outputs would. */
  commit(repo: string, files: Record<string, Buffer>): string;
  setStage(id: string, stage: string, message?: string): void;
  /** Fails the next request to a path that starts with this prefix, with this status. */
  failNext(prefix: string, status: number, error: string): void;
  close(): Promise<void>;
}

const TOKEN = 'hf_test_token_0123456789';
export const FAKE_HUB_TOKEN = TOKEN;

async function readBody(request: IncomingMessage): Promise<string> {
  const parts: Buffer[] = [];
  for await (const part of request) parts.push(part as Buffer);
  return Buffer.concat(parts).toString('utf8');
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

const LARGE = /\.(gguf|safetensors)$/;

export async function startFakeHub(): Promise<FakeHub> {
  const requests: HubRequest[] = [];
  const downloads: { path: string; authorized: boolean }[] = [];
  const repos = new Map<string, Repo>();
  const jobs = new Map<string, FakeJob>();
  const failures: { prefix: string; status: number; error: string }[] = [];
  const blobs = new Map<string, Buffer>();

  const cdn = createServer((request, response) => {
    const path = request.url ?? '';
    downloads.push({ path, authorized: request.headers.authorization !== undefined });
    const blob = blobs.get(path.replace(/^\/blob\//, '').split('?')[0] ?? '');
    if (!blob) {
      send(response, 404, { error: 'no such blob' });
      return;
    }
    response.writeHead(200, { 'content-type': 'application/octet-stream' });
    response.end(blob);
  });
  const cdnUrl = await listen(cdn);

  const commit = (repoId: string, files: Record<string, Buffer>): string => {
    const repo = repos.get(repoId);
    if (!repo) throw new Error(`no repo ${repoId}`);
    const previous = repo.commits.at(-1)?.files ?? new Map<string, Buffer>();
    const next = new Map(previous);
    for (const [path, content] of Object.entries(files)) next.set(path, content);
    const sha = createHash('sha1').update(randomBytes(16)).digest('hex');
    repo.commits.push({ sha, files: next });
    return sha;
  };

  const server = createServer((request, response) => {
    void (async () => {
      const body = await readBody(request);
      const path = request.url ?? '/';
      const method = request.method ?? 'GET';
      const authorized = request.headers.authorization === `Bearer ${TOKEN}`;
      requests.push({ method, path, authorized, body });
      if (!authorized) {
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

      if (method === 'GET' && path === '/api/whoami-v2') {
        send(response, 200, { name: 'jake', type: 'user' });
        return;
      }
      if (method === 'POST' && path === '/api/repos/create') {
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
      if (
        (match = /^\/api\/models\/([^/]+\/[^/]+)\/commit\/main$/.exec(path)) &&
        method === 'POST'
      ) {
        const lines = body
          .split('\n')
          .filter((line) => line !== '')
          .map(
            (line) =>
              JSON.parse(line) as { key: string; value: { path?: string; content?: string } },
          );
        if (lines[0]?.key !== 'header') {
          send(response, 400, { error: 'header first' });
          return;
        }
        const files: Record<string, Buffer> = {};
        for (const line of lines.slice(1)) {
          files[line.value.path ?? ''] = Buffer.from(line.value.content ?? '', 'base64');
        }
        const sha = commit(match[1] ?? '', files);
        send(response, 200, {
          success: true,
          commitOid: sha,
          commitUrl: `https://huggingface.co/${match[1]}/commit/${sha}`,
        });
        return;
      }
      if (
        (match = /^\/api\/models\/([^/]+\/[^/]+)\/revision\/(.+)$/.exec(path)) &&
        method === 'GET'
      ) {
        const repo = repos.get(match[1] ?? '');
        const head = repo?.commits.at(-1);
        if (!head) {
          send(response, 404, { error: 'Repository not found' });
          return;
        }
        send(response, 200, { id: match[1], sha: head.sha });
        return;
      }
      if (
        (match = /^\/([^/]+\/[^/]+)\/resolve\/([0-9a-f]{40})\/(.+)$/.exec(path)) &&
        method === 'GET'
      ) {
        const repo = repos.get(match[1] ?? '');
        const files = repo?.commits.find((entry) => entry.sha === match?.[2])?.files;
        const file = files?.get(decodeURIComponent(match[3] ?? ''));
        if (!file) {
          send(response, 404, { error: 'Entry not found' });
          return;
        }
        if (LARGE.test(match[3] ?? '')) {
          const key = createHash('sha256').update(file).digest('hex');
          blobs.set(key, file);
          response.writeHead(302, { location: `${cdnUrl}/blob/${key}?signature=abc` });
          response.end();
          return;
        }
        response.writeHead(200, { 'content-type': 'application/octet-stream' });
        response.end(file);
        return;
      }
      if ((match = /^\/api\/jobs\/([^/]+)$/.exec(path))) {
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
      if ((match = /^\/api\/jobs\/([^/]+)\/([^/]+)(\/cancel|\/logs)?$/.exec(path))) {
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
  const url = await listen(server);

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
    requests,
    repos,
    jobs,
    downloads,
    commit,
    setStage(id, stage, message) {
      const job = jobs.get(id);
      if (!job) throw new Error(`no job ${id}`);
      job.stage = stage;
      if (message !== undefined) job.message = message;
    },
    failNext(prefix, status, error) {
      failures.push({ prefix, status, error });
    },
    close: async () => {
      for (const target of [server, cdn]) {
        target.closeAllConnections();
        await new Promise<void>((done) => target.close(() => done()));
      }
    },
  };
}
