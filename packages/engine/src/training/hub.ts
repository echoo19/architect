import { createHash, randomBytes } from 'node:crypto';
import { closeSync, fsyncSync, mkdirSync, openSync, renameSync, rmSync, writeSync } from 'node:fs';
import { dirname } from 'node:path';
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
  /** Per request, downloads aside. Default 60 seconds. */
  timeoutMs?: number;
}

/** Files above this go through LFS, which this client doesn't speak. */
export const MAX_COMMIT_FILE_BYTES = 10 * 1024 * 1024;

const WhoamiSchema = z.object({ name: z.string().min(1) });
const CommitSchema = z.object({ commitOid: z.string().regex(/^[0-9a-f]{40}$/) });
const RevisionSchema = z.object({ sha: z.string().regex(/^[0-9a-f]{40}$/) });

const encodePath = (path: string) => path.split('/').map(encodeURIComponent).join('/');

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
        'Use a token with write access to the account or organization that runs the jobs.',
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
      return new HubError(
        'conflict',
        `Hugging Face reported a conflict.${said}`,
        'Try again.',
        status,
      );
    case 413:
      return new HubError(
        'too_large',
        `Hugging Face refused a file as too large.${said}`,
        'Train on fewer examples at a time.',
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

/**
 * The few Hugging Face endpoints training needs: who the token belongs to, private repositories,
 * small commits, revisions, downloads and Jobs. The token goes only to the Hub's own address,
 * never along a redirect to a download host.
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

  private async send(
    method: 'GET' | 'POST',
    path: string,
    options: { body?: string; contentType?: string; signal?: AbortSignal; timeoutMs?: number } = {},
  ): Promise<Response> {
    const token = await this.token();
    const timeout = AbortSignal.timeout(options.timeoutMs ?? this.options.timeoutMs ?? 60_000);
    const signal = options.signal ? AbortSignal.any([options.signal, timeout]) : timeout;
    let response: Response;
    try {
      response = await this.fetch(this.endpoint + path, {
        method,
        headers: {
          authorization: `Bearer ${token}`,
          accept: 'application/json',
          ...(options.contentType ? { 'content-type': options.contentType } : {}),
        },
        ...(options.body === undefined ? {} : { body: options.body }),
        signal,
      });
    } catch (error) {
      const why = error instanceof Error ? error.message : String(error);
      throw new HubError(
        'network',
        `Hugging Face could not be reached: ${why}`,
        'Check the internet connection, then try again.',
      );
    }
    if (!response.ok) throw failure(response.status, await this.detail(response, token));
    return response;
  }

  /** The error the Hub gave, without the token in it. */
  private async detail(response: Response, token: string): Promise<string> {
    const text = (await response.text().catch(() => '')).slice(0, 500);
    let detail = text;
    try {
      const parsed = JSON.parse(text) as { error?: unknown };
      if (typeof parsed.error === 'string') detail = parsed.error;
    } catch {
      // Plain text is shown as it is.
    }
    return detail.split(token).join('[token]').trim();
  }

  private async json<S extends z.ZodType>(
    schema: S,
    method: 'GET' | 'POST',
    path: string,
    options: { body?: string; contentType?: string; signal?: AbortSignal } = {},
  ): Promise<z.output<S>> {
    const response = await this.send(method, path, options);
    const parsed = schema.safeParse(await response.json().catch(() => null));
    if (!parsed.success) {
      throw new HubError(
        'bad_response',
        `Hugging Face answered ${path} in an unexpected shape.`,
        'Try again; if it keeps happening, the Hub may have changed.',
      );
    }
    return parsed.data;
  }

  /** The account the token belongs to. */
  async whoami(signal?: AbortSignal): Promise<string> {
    return (await this.json(WhoamiSchema, 'GET', '/api/whoami-v2', signal ? { signal } : {})).name;
  }

  /** Creates a private model repository; one that exists already is fine. */
  async createPrivateRepo(repoId: string, signal?: AbortSignal): Promise<void> {
    const [owner, name] = repoId.split('/');
    try {
      await this.send('POST', '/api/repos/create', {
        body: JSON.stringify({ name, organization: owner, private: true, type: 'model' }),
        contentType: 'application/json',
        ...(signal ? { signal } : {}),
      });
    } catch (error) {
      if (!(error instanceof HubError && error.code === 'conflict')) throw error;
    }
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
    const lines = [
      { key: 'header', value: { summary, description: '' } },
      ...files.map((file) => ({
        key: 'file',
        value: {
          content: Buffer.from(file.content).toString('base64'),
          path: file.path,
          encoding: 'base64',
        },
      })),
    ];
    const reply = await this.json(CommitSchema, 'POST', `/api/models/${repoId}/commit/main`, {
      body: lines.map((line) => `${JSON.stringify(line)}\n`).join(''),
      contentType: 'application/x-ndjson',
      ...(signal ? { signal } : {}),
    });
    return reply.commitOid;
  }

  /** The commit a branch or tag points at now. */
  async revision(repoId: string, ref = 'main', signal?: AbortSignal): Promise<string> {
    const path = `/api/models/${repoId}/revision/${encodeURIComponent(ref)}`;
    return (await this.json(RevisionSchema, 'GET', path, signal ? { signal } : {})).sha;
  }

  /**
   * Downloads one file at a revision into `dest`, checking its hash and size when they're
   * known. Follows the Hub's redirects to its download hosts without the token.
   */
  async download(
    repoId: string,
    revision: string,
    path: string,
    dest: string,
    expect: { sha256: string; bytes: number } | null,
    signal?: AbortSignal,
  ): Promise<{ sha256: string; bytes: number }> {
    let url = new URL(`${this.endpoint}/${repoId}/resolve/${revision}/${encodePath(path)}`);
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
        const why = error instanceof Error ? error.message : String(error);
        throw new HubError(
          'network',
          `The download of ${path} failed: ${why}`,
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
        throw failure(response.status, token ? await this.detail(response, token) : '');
      }
      return this.save(response.body, path, dest, expect);
    }
  }

  private async save(
    body: ReadableStream<Uint8Array>,
    path: string,
    dest: string,
    expect: { sha256: string; bytes: number } | null,
  ): Promise<{ sha256: string; bytes: number }> {
    mkdirSync(dirname(dest), { recursive: true });
    const temporary = `${dest}.${randomBytes(6).toString('hex')}.part`;
    const hash = createHash('sha256');
    let bytes = 0;
    const fd = openSync(temporary, 'w');
    try {
      for await (const chunk of body) {
        writeSync(fd, chunk);
        hash.update(chunk);
        bytes += chunk.length;
        if (expect && bytes > expect.bytes) break;
      }
      fsyncSync(fd);
    } catch (error) {
      closeSync(fd);
      rmSync(temporary, { force: true });
      const why = error instanceof Error ? error.message : String(error);
      throw new HubError('network', `The download of ${path} broke off: ${why}`, 'Try again.');
    }
    closeSync(fd);
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
