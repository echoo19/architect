import { appendFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';

/**
 * Plays llama-server for the process manager's tests: the same flags, log lines, health check,
 * key check, adapter list and streamed chat replies, with no model behind it. Its own flags come
 * first: `--fake-record <file>` appends what it was started with and every chat request as JSON
 * lines, `--fake-mode <mode>` picks a failure, `--fake-load-ms <ms>` how long "loading" takes,
 * `--fake-reply-ms <ms>` how long each reply takes. Each start also records which stand-ins
 * started earlier on the same record are still running: two servers on one GPU would show there.
 */

const argv = process.argv.slice(2);
const values = (flag: string) =>
  argv.flatMap((arg, index) => (arg === flag ? [argv[index + 1] ?? ''] : []));
const value = (flag: string) => values(flag)[0];

const record = value('--fake-record');
const mode = value('--fake-mode') ?? 'ok';
const loadMs = Number(value('--fake-load-ms') ?? '150');
const replyMs = Number(value('--fake-reply-ms') ?? '0');
const note = (entry: unknown) => {
  if (record) appendFileSync(record, `${JSON.stringify(entry)}\n`);
};

const running = (pid: number) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

/** Stand-ins started earlier on this record that haven't exited. */
function alongside(): number[] {
  if (!record || !existsSync(record)) return [];
  return readFileSync(record, 'utf8')
    .split('\n')
    .filter((line) => line !== '')
    .map((line) => JSON.parse(line) as { kind: string; pid?: number })
    .filter((entry) => entry.kind === 'start' && entry.pid !== undefined)
    .map((entry) => entry.pid ?? 0)
    .filter((pid) => pid !== process.pid && running(pid));
}
const log = (line: string) => process.stderr.write(`${line}\n`);

if (argv.includes('--version')) {
  log(`version: ${value('--fake-build') ?? '10472'} (60eeeb6)`);
  log('built with a test double for testing');
  process.exit(0);
}

const port = Number(value('--port'));
const host = value('--host') ?? '127.0.0.1';
const model = value('--model') ?? '';
const adapters = values('--lora');
const unapplied = argv.includes('--lora-init-without-apply');
const keyFile = value('--api-key-file');
const apiKey = keyFile ? readFileSync(keyFile, 'utf8').trim() : null;

note({
  kind: 'start',
  pid: process.pid,
  argv,
  llamaEnv: Object.keys(process.env).filter((key) => key.toUpperCase().startsWith('LLAMA_ARG_')),
  alongside: alongside(),
});
log(`load_model: loading model '${model}'`);

if (mode === 'crash') {
  log('llama_model_load: error loading model: unknown model architecture');
  process.exit(1);
}
if (mode === 'oom') {
  log(
    'ggml_backend_cuda_buffer_type_alloc_buffer: allocating 9000.00 MiB on device 0: cudaMalloc failed: out of memory',
  );
  process.exit(1);
}
if (mode === 'bad-lora') {
  log(`llama_adapter_lora_init_impl: failed to load lora adapter '${adapters[0] ?? ''}'`);
  process.exit(1);
}
const marker = record ? `${record}.port-taken` : null;
if (mode === 'port-taken-once' && marker && !existsSync(marker)) {
  writeFileSync(marker, 'taken');
  log(`couldn't bind HTTP server socket, hostname: ${host}, port: ${port}`);
  process.exit(1);
}

const startedAt = Date.now();
const loaded = () => mode !== 'never-ready' && Date.now() - startedAt >= loadMs;

const send = (response: ServerResponse, status: number, body: unknown) => {
  response.writeHead(status, { 'content-type': 'application/json' });
  response.end(JSON.stringify(body));
};

async function readBody(request: IncomingMessage): Promise<string> {
  const parts: Buffer[] = [];
  for await (const part of request) parts.push(part as Buffer);
  return Buffer.concat(parts).toString('utf8');
}

const server = createServer((request, response) => {
  void (async () => {
    const path = request.url ?? '/';
    if (path === '/health') {
      if (loaded()) send(response, 200, { status: 'ok' });
      else
        send(response, 503, {
          error: { code: 503, message: 'Loading model', type: 'unavailable_error' },
        });
      return;
    }
    if (apiKey !== null && request.headers.authorization !== `Bearer ${apiKey}`) {
      send(response, 401, {
        error: { code: 401, message: 'Invalid API Key', type: 'authentication_error' },
      });
      return;
    }
    if (path === '/lora-adapters' && request.method === 'GET') {
      const list = mode === 'drop-lora' ? [] : adapters;
      send(
        response,
        200,
        list.map((file, id) => ({ id, path: file, scale: unapplied ? 0 : 1 })),
      );
      return;
    }
    if (path === '/v1/chat/completions' && request.method === 'POST') {
      const body = JSON.parse(await readBody(request)) as Record<string, unknown>;
      note({ kind: 'chat', body });
      if (replyMs > 0) await new Promise((done) => setTimeout(done, replyMs));
      response.writeHead(200, { 'content-type': 'text/event-stream' });
      const chunk = (delta: Record<string, unknown>, finish: string | null = null) =>
        response.write(
          `data: ${JSON.stringify({ choices: [{ index: 0, delta, finish_reason: finish }] })}\n\n`,
        );
      chunk({ reasoning_content: 'Thinking it over.' });
      const tools = (body['tools'] as { function: { name: string } }[] | undefined) ?? [];
      const messages = (body['messages'] as { role: string }[] | undefined) ?? [];
      // Asked with tools after a user turn, it calls the first tool, as Glimmer reads first.
      if (tools.length > 0 && messages.at(-1)?.role === 'user') {
        chunk({
          tool_calls: [
            {
              index: 0,
              id: 'call_fake_1',
              type: 'function',
              function: { name: tools[0]?.function.name, arguments: '{"path":"data/orders.csv"}' },
            },
          ],
        });
        chunk({}, 'tool_calls');
      } else {
        chunk({ content: `lora=${JSON.stringify(body['lora'] ?? null)}` });
        chunk({}, 'stop');
      }
      response.write(
        `data: ${JSON.stringify({ choices: [], usage: { prompt_tokens: 12, completion_tokens: 7 } })}\n\n`,
      );
      response.end('data: [DONE]\n\n');
      return;
    }
    send(response, 404, {
      error: { code: 404, message: 'File Not Found', type: 'not_found_error' },
    });
  })();
});

server.listen(port, host, () => {
  log(`main: server is listening on http://${host}:${port}`);
});
const stop = () => {
  server.close();
  process.exit(0);
};
process.on('SIGTERM', stop);
process.on('SIGINT', stop);
