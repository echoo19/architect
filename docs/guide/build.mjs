// Builds docs/Architect-Guide.pdf from docs/guide/index.html and docs/guide/guide.css.
//
//   node docs/guide/build.mjs
//
// It works offline. The screens come from docs/screenshots/*.png as they are when it runs, so it
// can be run again after they are recaptured. The fonts are the installed @fontsource-variable
// packages; Chromium is the one Playwright already has for the end-to-end tests.
//
// index.html holds the text. It uses three small tags this script replaces:
//   <chapter id="" title="">...</chapter>   a chapter that starts a page, numbered in order
//   <fig id="" src="" x="0 1" y="0 1" alt="" />   a screen from docs/screenshots, cropped by
//                                                 fractions of its width (x) and height (y);
//                                                 span="text" sets it in the text column
//   <figpair>two <fig /> tags</figpair>     two screens side by side
//   <ref to="" />                           "Figure N" for the figure with that id

import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { chromium } from '@playwright/test';

const here = dirname(fileURLToPath(import.meta.url));
const docs = resolve(here, '..');
const screenshots = join(docs, 'screenshots');
const output = join(docs, 'Architect-Guide.pdf');

const say = (line) => process.stdout.write(`${line}\n`);

/** Finds a file inside node_modules, looking in this folder's ancestors like Node does. */
function fromNodeModules(...parts) {
  for (let folder = here; ; folder = dirname(folder)) {
    const candidate = join(folder, 'node_modules', ...parts);
    if (existsSync(candidate)) return candidate;
    if (dirname(folder) === folder) {
      throw new Error(`${parts.join('/')} is not installed. Run pnpm install first.`);
    }
  }
}

const LATIN =
  'U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+0304,U+0308,U+0329,U+2000-206F,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD';
const LATIN_EXT =
  'U+0100-02BA,U+02BD-02C5,U+02C7-02CC,U+02CE-02D7,U+02DD-02FF,U+0304,U+0308,U+0329,U+1D00-1DBF,U+1E00-1E9F,U+1EF2-1EFF,U+2020,U+20A0-20AB,U+20AD-20C0,U+2113,U+2C60-2C7F,U+A720-A7FF';

/** The three families as @font-face rules with the files inlined, so the page needs no network. */
function fontFaces() {
  const families = [
    ['Inter', 'inter'],
    ['Inter Tight', 'inter-tight'],
    ['Geist Mono', 'geist-mono'],
  ];
  const subsets = [
    ['latin', LATIN],
    ['latin-ext', LATIN_EXT],
  ];
  return families
    .flatMap(([name, folder]) =>
      subsets.map(([subset, range]) => {
        const file = fromNodeModules(
          '@fontsource-variable',
          folder,
          'files',
          `${folder}-${subset}-wght-normal.woff2`,
        );
        const data = readFileSync(file).toString('base64');
        return `@font-face{font-family:'${name}';font-style:normal;font-weight:100 900;font-display:block;src:url(data:font/woff2;base64,${data}) format('woff2');unicode-range:${range};}`;
      }),
    )
    .join('\n');
}

/** Width and height of a PNG, read from its header. */
function pngSize(file) {
  const head = readFileSync(file).subarray(0, 24);
  if (head.toString('latin1', 1, 4) !== 'PNG') throw new Error(`${file} is not a PNG file.`);
  return { width: head.readUInt32BE(16), height: head.readUInt32BE(20) };
}

function attributes(source) {
  const found = {};
  for (const [, name, value] of source.matchAll(/([\w-]+)="([^"]*)"/g)) found[name] = value;
  return found;
}

const escapeAttribute = (text) => text.replaceAll('&', '&amp;').replaceAll('"', '&quot;');

/** Replaces each <fig /> with a plate and numbers them in order; returns the numbers by id. */
function plates(html) {
  const numbers = new Map();
  const missing = [];
  let count = 0;
  const done = html.replace(/<fig\s([^>]*?)\/>/g, (_, source) => {
    const { id, src, x = '0 1', y = '0 1', alt = '', span = '' } = attributes(source);
    const file = join(screenshots, src ?? '');
    if (!id || !src || !existsSync(file)) {
      missing.push(src ?? '(no src)');
      return '';
    }
    const [x0, x1] = x.split(/\s+/).map(Number);
    const [y0, y1] = y.split(/\s+/).map(Number);
    const { width, height } = pngSize(file);
    const cropWidth = (x1 - x0) * width;
    const cropHeight = (y1 - y0) * height;
    const percent = (value) => `${(value * 100).toFixed(4)}%`;
    count += 1;
    numbers.set(id, count);
    const style = `aspect-ratio:${cropWidth.toFixed(1)}/${cropHeight.toFixed(1)}`;
    const place = `width:${percent(1 / (x1 - x0))};left:${percent(-x0 / (x1 - x0))};top:${percent(-y0 / (y1 - y0))}`;
    return (
      `<figure class="plate${span === 'text' ? ' text' : ''}" id="fig-${id}"><div class="frame" style="${style}">` +
      `<img src="${pathToFileURL(file).href}" alt="${escapeAttribute(alt)}" style="${place}"></div>` +
      `<p class="n">Figure ${count}</p></figure>`
    );
  });
  if (missing.length > 0) {
    throw new Error(`Screens missing from docs/screenshots: ${[...new Set(missing)].join(', ')}`);
  }
  return { html: done, numbers };
}

function references(html, numbers) {
  return html.replace(/<ref\s+to="([^"]+)"\s*\/>/g, (_, id) => {
    const number = numbers.get(id);
    if (number === undefined) throw new Error(`<ref to="${id}" /> names no figure.`);
    return `<a class="ref" href="#fig-${id}">Figure ${number}</a>`;
  });
}

/** Turns each <chapter> into a numbered section with its heading; returns them for the contents. */
function chapters(html) {
  const list = [];
  const done = html.replace(
    /<chapter\s+id="([^"]+)"\s+title="([^"]+)"\s*>([\s\S]*?)<\/chapter\s*>/g,
    (_, id, title, body) => {
      const number = list.length + 1;
      list.push({ id: `ch-${id}`, number, title });
      return (
        `<section class="chapter" id="ch-${id}"><header class="chapter-head">` +
        `<span class="num">${number}</span><h1>${title}</h1></header>${body}</section>`
      );
    },
  );
  return { html: done, list };
}

function contents(list, pages) {
  const rows = list
    .map(
      ({ id, number, title }) =>
        `<li><span class="n">${number}</span><a class="t" href="#${id}">${title}</a>` +
        `<span class="p">${pages?.get(id) ?? ''}</span></li>`,
    )
    .join('');
  return `<ol>${rows}</ol>`;
}

/** The number of pages in a PDF Chromium wrote. */
function pageCount(pdf) {
  const found = pdf.toString('latin1').match(/\/Type\s*\/Page(?![s\w])/g);
  if (!found) throw new Error('Could not count the pages of a PDF.');
  return found.length;
}

const pdfOptions = { format: 'Letter', printBackground: true, preferCSSPageSize: true };

async function main() {
  const template = readFileSync(join(here, 'index.html'), 'utf8');
  const css = readFileSync(join(here, 'guide.css'), 'utf8');

  const withChapters = chapters(template);
  const withPlates = plates(
    withChapters.html
      .replaceAll('<figpair>', '<div class="plates">')
      .replaceAll('</figpair>', '</div>'),
  );
  const body = references(withPlates.html, withPlates.numbers);
  const style = `<style>\n${fontFaces()}\n${css}</style>`;
  const link = /<link\s+rel="stylesheet"\s+href="guide\.css"\s*\/?>/;
  if (!link.test(body) || !body.includes('<!--toc-->')) {
    throw new Error('index.html needs its guide.css link and a <!--toc--> marker.');
  }
  const assemble = (pages, extra = '') =>
    body
      .replace('<!--toc-->', () => contents(withChapters.list, pages))
      .replace(link, () => `${style}${extra}`);

  const work = mkdtempSync(join(tmpdir(), 'architect-guide-'));
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    const open = async (html) => {
      const file = join(work, 'guide.html');
      writeFileSync(file, html);
      await page.goto(pathToFileURL(file).href, { waitUntil: 'load' });
      await page.evaluate('document.fonts.ready');
      await page.emulateMedia({ media: 'print' });
    };

    // The contents lists page numbers, so each part is printed alone first to count its pages.
    // Every chapter starts a page, so a chapter has the same pages alone as in the whole.
    const hide = (selector) => `<style>${selector}{display:none !important}</style>`;
    const everyChapter = withChapters.list.map(({ id }) => `#${id}`);
    await open(assemble(null, hide(everyChapter.join(','))));
    const front = pageCount(await page.pdf(pdfOptions));
    const pages = new Map();
    let next = front + 1;
    for (const { id, title } of withChapters.list) {
      const others = everyChapter.filter((selector) => selector !== `#${id}`);
      await open(assemble(null, hide(['.cover', '.contents', ...others].join(','))));
      pages.set(id, next);
      const length = pageCount(await page.pdf(pdfOptions));
      say(`${String(next).padStart(3)}  ${title} (${length} ${length === 1 ? 'page' : 'pages'})`);
      next += length;
    }

    await open(assemble(pages));
    mkdirSync(dirname(output), { recursive: true });
    const pdf = await page.pdf({ ...pdfOptions, path: output });
    const total = pageCount(pdf);
    if (total !== next - 1) {
      throw new Error(`The guide has ${total} pages, but its parts add up to ${next - 1}.`);
    }
    say(`Wrote ${output} (${total} pages)`);
  } finally {
    await browser.close();
    rmSync(work, { recursive: true, force: true });
  }
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
