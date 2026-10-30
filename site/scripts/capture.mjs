/**
 * Headless captures of the page, for looking at it the way a visitor does. Nothing opens on the
 * desktop. Each chapter plays when it scrolls into view, so a full-page capture first walks down
 * the page and lets every chapter reach its last frame. It drives Chromium (Playwright's, or an
 * installed Chrome) and reads the page from an address: build it, then serve it with
 * `pnpm --filter @architect/site preview`.
 *
 *   node scripts/capture.mjs                      the standard set into screenshots/
 *   node scripts/capture.mjs --only hero,page     only the named kinds
 *   node scripts/capture.mjs --widths 1280        only these widths
 *   node scripts/capture.mjs --height 1200        a taller window than the width's usual one
 *   node scripts/capture.mjs --url <address>      a different address (default: the preview server)
 *   node scripts/capture.mjs --url <address>/results/ --only page --prefix results
 *       the results page, whole, as results-page-1280.png
 *   node scripts/capture.mjs --out <folder>       a different folder
 *   node scripts/capture.mjs --selector '[data-stage="train"]' --widths 1280 --name train
 *       one element, scrolled into view and captured after its chapter has played
 *
 * Kinds: hero (the first screen), page (the whole page), chapters (each mock on its own),
 * sections (each chapter whole: its claim, its line and its mock), reduced (the whole page with
 * reduced motion on), slices (the whole page in screen-high pieces).
 */
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

const here = path.dirname(fileURLToPath(import.meta.url));

function readArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i += 1) {
    const key = argv[i];
    if (!key.startsWith('--')) continue;
    const next = argv[i + 1];
    if (next === undefined || next.startsWith('--')) out[key.slice(2)] = true;
    else {
      out[key.slice(2)] = next;
      i += 1;
    }
  }
  return out;
}

const args = readArgs(process.argv.slice(2));
const url = String(args.url ?? 'http://127.0.0.1:4173/');
const outDir = path.resolve(String(args.out ?? path.join(here, '..', 'screenshots')));
const widths = String(args.widths ?? '1280,375')
  .split(',')
  .map(Number);
/** A word put before every file's name, for a page other than the home page. */
const prefix = args.prefix ? `${args.prefix}-` : '';
const only = args.only ? String(args.only).split(',') : null;
const wanted = (kind) => only === null || only.includes(kind);
const HEIGHTS = { 375: 812, 768: 1024, 1280: 800, 1920: 1080 };

async function launch() {
  try {
    return await chromium.launch({ headless: true });
  } catch {
    return chromium.launch({ channel: 'chrome', headless: true });
  }
}

const browser = await launch();
await mkdir(outDir, { recursive: true });
const problems = [];

async function open(width, { reducedMotion = false } = {}) {
  const context = await browser.newContext({
    viewport: { width, height: Number(args.height ?? HEIGHTS[width] ?? 900) },
    deviceScaleFactor: 1,
    reducedMotion: reducedMotion ? 'reduce' : 'no-preference',
  });
  const page = await context.newPage();
  page.on('pageerror', (error) => problems.push(`${width}: ${error.message}`));
  page.on('console', (message) => {
    if (message.type() === 'error') problems.push(`${width}: ${message.text()}`);
  });
  page.on('requestfailed', (request) => problems.push(`${width}: failed ${request.url()}`));
  await page.goto(url, { waitUntil: 'networkidle' });
  await page.evaluate(() => document.fonts.ready);
  return { context, page };
}

/**
 * Brings every chapter into view and lets it play to its last frame, then returns to the top.
 * Animations are sped up through the browser's own animation clock, so a chapter that takes
 * eight seconds on screen is done in about one; nothing about the page changes.
 */
async function playEverything(context, page) {
  const client = await context.newCDPSession(page);
  await client.send('Animation.enable');
  await client.send('Animation.setPlaybackRate', { playbackRate: 12 });
  const stages = await page.locator('[data-stage]:not([data-stage="hero"])').all();
  for (const stage of stages) {
    await stage.scrollIntoViewIfNeeded();
    await stage.evaluate(
      (node) =>
        new Promise((resolve) => {
          const check = () =>
            node.hasAttribute('data-played') ? resolve() : setTimeout(check, 50);
          check();
        }),
    );
    await page.waitForTimeout(900);
  }
  // The page's words rise into place as they come into view, so the way down is walked once more.
  const total = await page.evaluate(() => document.documentElement.scrollHeight);
  const view = page.viewportSize()?.height ?? 800;
  for (let y = 0; y < total; y += Math.round(view * 0.6)) {
    await page.evaluate((top) => window.scrollTo({ top, behavior: 'instant' }), y);
    await page.waitForTimeout(120);
  }
  await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }));
  await page.waitForTimeout(1200);
}

async function save(page, name, options = {}) {
  const file = path.join(outDir, `${prefix}${name}.png`);
  // A shot of more than the screen starts the page's animations over, so they are let finish first.
  await page.screenshot({ path: file, animations: 'disabled', ...options });
  console.log(file);
}

if (args.selector) {
  for (const width of widths) {
    const { context, page } = await open(width);
    const target = page.locator(String(args.selector)).first();
    // The bar that follows the page would sit over the top of an element.
    await page.addStyleTag({ content: 'header.sticky { position: static !important; }' });
    await target.scrollIntoViewIfNeeded();
    await page.waitForTimeout(Number(args.wait ?? 11000));
    await target.screenshot({ path: path.join(outDir, `${args.name ?? 'element'}-${width}.png`) });
    console.log(path.join(outDir, `${args.name ?? 'element'}-${width}.png`));
    await context.close();
  }
} else {
  for (const width of widths) {
    if (wanted('hero')) {
      const { context, page } = await open(width);
      await page.waitForTimeout(Number(args.wait ?? 7500));
      await save(page, `hero-${width}`);
      await context.close();
    }
    if (wanted('page') || wanted('slices') || wanted('chapters') || wanted('sections')) {
      const { context, page } = await open(width);
      await playEverything(context, page);
      if (wanted('page')) await save(page, `page-${width}`, { fullPage: true });
      if (wanted('slices')) {
        const total = await page.evaluate(() => document.documentElement.scrollHeight);
        const view = page.viewportSize()?.height ?? 800;
        let index = 1;
        for (let y = 0; y < total; y += view) {
          await page.evaluate((top) => window.scrollTo({ top, behavior: 'instant' }), y);
          await page.waitForTimeout(150);
          await save(page, `slice-${width}-${String(index).padStart(2, '0')}`);
          index += 1;
        }
      }
      if (wanted('sections')) {
        // The bar that follows the page would sit over the top of a section.
        await page.addStyleTag({ content: 'header.sticky { position: static !important; }' });
        const sections = await page.locator('section[id]').all();
        for (const section of sections) {
          const id = await section.getAttribute('id');
          await section.scrollIntoViewIfNeeded();
          await page.waitForTimeout(250);
          // A section taller than the screen is captured beyond it, which starts the page's
          // animations again, so they are let finish before the shot.
          await section.screenshot({
            path: path.join(outDir, `section-${id}-${width}.png`),
            animations: 'disabled',
          });
          console.log(path.join(outDir, `section-${id}-${width}.png`));
        }
      }
      if (wanted('chapters')) {
        // The bar that follows the page would sit over the top of a picture.
        await page.addStyleTag({ content: 'header.sticky { position: static !important; }' });
        const stages = await page.locator('[data-stage]').all();
        for (const stage of stages) {
          const id = await stage.getAttribute('data-stage');
          await stage.scrollIntoViewIfNeeded();
          await page.waitForTimeout(250);
          await stage.screenshot({
            path: path.join(outDir, `chapter-${id}-${width}.png`),
            animations: 'disabled',
          });
          console.log(path.join(outDir, `chapter-${id}-${width}.png`));
        }
      }
      await context.close();
    }
    if (wanted('reduced')) {
      const { context, page } = await open(width, { reducedMotion: true });
      await page.waitForTimeout(500);
      await save(page, `page-${width}-reduced`, { fullPage: true });
      await context.close();
    }
  }
}

await browser.close();
if (problems.length > 0) {
  console.warn(`\n${problems.length} problem(s) while capturing:`);
  for (const problem of new Set(problems)) console.warn(`  ${problem}`);
}
