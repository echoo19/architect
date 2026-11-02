import { appendFile, mkdir } from 'node:fs/promises';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import type { Locator, Page } from '@playwright/test';
import { goTo, settle } from '../e2e/app';
import { startWorld, WORLDS, type World, type WorldName } from './worlds';

/*
 * Keeps the built app open, hidden, in a world, and lets a tester use it over a small JSON API on
 * 127.0.0.1. See qa/README.md.
 *
 *   node --import tsx qa/driver.ts --world lab --port 4801 --out <dir>
 *   node --import tsx qa/driver.ts --world live --port 4804 --out <dir> [--data <kept profile>]
 */

type Target =
  | { role: string; name?: string; exact?: boolean; nth?: number }
  | { text: string; nth?: number }
  | { label: string; nth?: number }
  | { placeholder: string; nth?: number }
  | { testid: string; nth?: number }
  | { css: string; nth?: number };

interface Act {
  action: string;
  target?: Target;
  value?: unknown;
}

const SNAPSHOT_CHARS = 15_000;
/** How long a person waits at most for a step or for the screen to settle. */
const STEP_MS = 10_000;
const KEY_DELAY_MS = 60;

const { values } = parseArgs({
  options: {
    world: { type: 'string' },
    port: { type: 'string', default: '4801' },
    out: { type: 'string' },
    data: { type: 'string' },
  },
});
const worldName = values.world as WorldName;
if (!WORLDS.includes(worldName)) {
  throw new Error(`Name a world with --world: ${WORLDS.join(', ')}.`);
}
if (values.data !== undefined && worldName !== 'live') {
  throw new Error(
    '--data starts the live world on a kept profile; the other worlds make their own.',
  );
}
const port = Number(values.port);
const out = resolve(values.out ?? join(tmpdir(), `architect-qa-${worldName}-${Date.now()}`));
const shots = join(out, 'shots');
const log = join(out, 'actions.log');
await mkdir(shots, { recursive: true });

const world: World = await startWorld(worldName, out, values.data && resolve(values.data));
const { app, page } = world.launched;
page.setDefaultTimeout(STEP_MS);
await resize(page, { width: 1440, height: 900 });
await settleFor(page);

const errors: { at: string; kind: string; text: string }[] = [];
page.on('pageerror', (error) => {
  errors.push({ at: new Date().toISOString(), kind: 'page', text: error.stack ?? error.message });
});
page.on('console', (message) => {
  if (message.type() === 'error') {
    errors.push({ at: new Date().toISOString(), kind: 'console', text: message.text() });
  }
});

function locate(target: Target): Locator {
  let locator: Locator;
  if ('role' in target) {
    locator = page.getByRole(target.role as Parameters<Page['getByRole']>[0], {
      ...(target.name === undefined ? {} : { name: target.name }),
      ...(target.exact === undefined ? {} : { exact: target.exact }),
    });
  } else if ('text' in target) locator = page.getByText(target.text);
  else if ('label' in target) locator = page.getByLabel(target.label);
  else if ('placeholder' in target) locator = page.getByPlaceholder(target.placeholder);
  else if ('testid' in target) locator = page.getByTestId(target.testid);
  else locator = page.locator(target.css);
  return target.nth === undefined ? locator : locator.nth(target.nth);
}

function needTarget(act: Act): Locator {
  if (!act.target) throw new Error(`"${act.action}" needs a target.`);
  return locate(act.target);
}

function text(value: unknown): string {
  if (typeof value !== 'string') throw new Error('This act needs a string value.');
  return value;
}

async function resize(on: Page, size: { width: number; height: number }): Promise<void> {
  await app.evaluate(({ BrowserWindow }, next) => {
    const [main] = BrowserWindow.getAllWindows();
    if (!main) throw new Error('No window');
    main.setContentSize(next.width, next.height);
  }, size);
  await on.waitForFunction((height) => window.innerHeight === height, size.height);
}

/** Waits until nothing on screen is loading, for STEP_MS at most; says whether it got there. */
async function settleFor(on: Page): Promise<boolean> {
  let timer: NodeJS.Timeout | undefined;
  const late = new Promise<false>((done) => {
    timer = setTimeout(() => done(false), STEP_MS);
  });
  const settled = await Promise.race([settle(on).then(() => true), late]).catch(() => false);
  clearTimeout(timer);
  return settled;
}

/** The next file dialog chooses these paths, and later ones are cancelled again. */
async function answerFileDialog(paths: string[]): Promise<void> {
  await app.evaluate(({ dialog }, picked) => {
    const open = dialog.showOpenDialog;
    const save = dialog.showSaveDialog;
    const restore = () => {
      dialog.showOpenDialog = open;
      dialog.showSaveDialog = save;
    };
    dialog.showOpenDialog = async () => {
      restore();
      return { canceled: false, filePaths: picked };
    };
    dialog.showSaveDialog = async () => {
      restore();
      return { canceled: false, filePath: picked[0] ?? '' };
    };
  }, paths);
}

async function perform(act: Act): Promise<void> {
  switch (act.action) {
    case 'click':
      return needTarget(act).click();
    case 'dblclick':
      return needTarget(act).dblclick();
    case 'hover':
      return needTarget(act).hover();
    case 'fill':
      return needTarget(act).fill(text(act.value));
    case 'type': {
      const typed = text(act.value);
      // Typing takes its own time on top of a step's: a long text would outlast STEP_MS alone.
      const timeout = STEP_MS + typed.length * KEY_DELAY_MS;
      if (act.target)
        return needTarget(act).pressSequentially(typed, { delay: KEY_DELAY_MS, timeout });
      return page.keyboard.type(typed, { delay: KEY_DELAY_MS });
    }
    case 'press':
      if (act.target) return needTarget(act).press(text(act.value));
      return page.keyboard.press(text(act.value));
    case 'select':
      await needTarget(act).selectOption(act.value as string | string[]);
      return;
    case 'check':
      return needTarget(act).setChecked(act.value !== false);
    case 'scroll': {
      // With a number, the wheel moves by it, over the target if one is named; without one, the
      // target is scrolled into view.
      if (typeof act.value !== 'number') return needTarget(act).scrollIntoViewIfNeeded();
      if (act.target) await needTarget(act).hover();
      return page.mouse.wheel(0, act.value);
    }
    case 'route':
      return goTo(page, text(act.value));
    case 'resize': {
      const size = act.value as { width?: unknown; height?: unknown } | undefined;
      if (typeof size?.width !== 'number' || typeof size.height !== 'number') {
        throw new Error('"resize" needs a value of { width, height }.');
      }
      return resize(page, { width: size.width, height: size.height });
    }
    case 'wait':
      if (act.target) return needTarget(act).waitFor({ state: 'visible' });
      return page.waitForTimeout(Math.min(Number(act.value ?? 1000), 30_000));
    case 'file': {
      const paths = Array.isArray(act.value) ? act.value.map(String) : [text(act.value)];
      return answerFileDialog(paths.map((path) => resolve(path)));
    }
    default:
      throw new Error(`There is no action "${act.action}".`);
  }
}

function route(): string {
  return new URL(page.url()).hash.replace(/^#/, '') || '/';
}

async function snapshot(): Promise<object> {
  const aria = await page.locator('body').ariaSnapshot({ timeout: STEP_MS });
  const truncated = aria.length > SNAPSHOT_CHARS;
  return { route: route(), truncated, snapshot: truncated ? aria.slice(0, SNAPSHOT_CHARS) : aria };
}

async function act(request: Act): Promise<object> {
  const started = performance.now();
  try {
    await perform(request);
    const settled = await settleFor(page);
    return {
      ok: true,
      ms: Math.round(performance.now() - started),
      route: route(),
      ...(settled ? {} : { busy: 'Still loading after 10 s.' }),
    };
  } catch (error) {
    return {
      ok: false,
      ms: Math.round(performance.now() - started),
      route: route(),
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

async function shot(name: unknown): Promise<object> {
  const safe = String(name ?? 'shot').replace(/[^\w.-]+/g, '-') || 'shot';
  const path = join(shots, safe.endsWith('.png') ? safe : `${safe}.png`);
  await page.screenshot({ path, animations: 'disabled', timeout: 15_000 });
  return { ok: true, path, route: route() };
}

async function systemNotes(): Promise<string[]> {
  return app.evaluate(() => (globalThis as { qaSystem?: string[] }).qaSystem ?? []);
}

async function readBody(request: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(chunk as Buffer);
  const body = Buffer.concat(chunks).toString('utf8');
  return body === '' ? {} : (JSON.parse(body) as Record<string, unknown>);
}

function send(response: ServerResponse, status: number, value: object): void {
  response.writeHead(status, { 'content-type': 'application/json' });
  response.end(JSON.stringify(value));
}

let closing = false;
async function quit(): Promise<void> {
  if (closing) return;
  closing = true;
  server.close();
  await world.close().catch((error: unknown) => console.error(error));
  process.exit(0);
}

/** One request at a time, as one person works one screen. */
let queue: Promise<unknown> = Promise.resolve();

async function answer(request: IncomingMessage, response: ServerResponse): Promise<void> {
  const where = `${request.method} ${request.url}`;
  const body = request.method === 'POST' ? await readBody(request) : {};
  let reply: object;
  if (where === 'GET /snapshot') reply = await snapshot();
  else if (where === 'POST /act') reply = await act(body as unknown as Act);
  else if (where === 'POST /shot') reply = await shot(body.name);
  else if (where === 'GET /errors') reply = { errors, system: await systemNotes() };
  else if (where === 'POST /quit') {
    send(response, 200, { ok: true });
    await appendFile(log, `${JSON.stringify({ at: new Date().toISOString(), quit: true })}\n`);
    await quit();
    return;
  } else {
    send(response, 404, { ok: false, error: `No ${where}.` });
    return;
  }
  if (where !== 'GET /snapshot' && where !== 'GET /errors') {
    const entry = { at: new Date().toISOString(), request: where, body, reply };
    await appendFile(log, `${JSON.stringify(entry)}\n`);
  }
  send(response, 200, reply);
}

const server = createServer((request, response) => {
  queue = queue.then(() =>
    answer(request, response).catch((error: unknown) => {
      send(response, 500, {
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }),
  );
});

app.on('close', () => {
  if (!closing) {
    console.error('The app closed on its own.');
    void quit();
  }
});
process.on('SIGINT', () => void quit());
process.on('SIGTERM', () => void quit());

server.listen(port, '127.0.0.1', () => {
  process.stdout.write(
    [
      `Architect is open in the ${worldName} world, hidden, at http://127.0.0.1:${port}`,
      `Output: ${out}`,
      ...world.notes,
      '',
    ].join('\n'),
  );
});
