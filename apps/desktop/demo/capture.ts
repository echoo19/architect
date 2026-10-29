import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { performance } from 'node:perf_hooks';
import { expect, type Locator, type Page } from '@playwright/test';
import { goTo, launchApp } from '../e2e/app';
import { drawPointer, hideTitle, setSpeedMark, showTitle, type PointerState } from './overlay';
import type { DemoScene, DemoStep } from './script';
import type { SpeedInterval } from './timeline';

export interface CapturedFrame {
  file: string;
  timestampMs: number;
  kind: 'title' | 'app';
}

export interface CapturedScene {
  name: string;
  frames: CapturedFrame[];
  speedIntervals: SpeedInterval[];
}

const FRAME_MS = 1000 / 30;
const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** Moves the drawn pointer to a target, clicks it and starts the click's ripple. */
async function clickWithPointer(page: Page, target: Locator, pointer: PointerState, what: string) {
  const box = await target.boundingBox();
  if (!box) throw new Error(`Click target is not visible: ${what}`);
  pointer.x = box.x + box.width / 2;
  pointer.y = box.y + box.height / 2;
  await page.mouse.move(pointer.x, pointer.y);
  await target.click();
  pointer.rippleAt = performance.now();
}

async function executeStep(
  step: DemoStep,
  page: Page,
  app: Awaited<ReturnType<typeof launchApp>>['app'],
  pointer: PointerState,
): Promise<void> {
  switch (step.kind) {
    case 'route':
      await goTo(page, step.path);
      break;
    case 'click':
      await clickWithPointer(
        page,
        page.getByRole(step.role, { name: step.name, exact: true }),
        pointer,
        `${step.role} ${step.name}`,
      );
      break;
    case 'run':
      await step.run({
        page,
        app,
        click: (target) => clickWithPointer(page, target, pointer, step.label),
      });
      break;
    case 'type':
      await page
        .getByRole(step.role, { name: step.name, exact: true })
        .pressSequentially(step.text, {
          delay: step.delayMs ?? 80,
        });
      break;
    case 'visible':
      await expect(page.getByRole(step.role, { name: step.name, exact: true })).toBeVisible();
      break;
    case 'text':
      await expect(page.getByText(step.text, { exact: false }).first()).toBeVisible();
      break;
    case 'wait':
      await sleep(step.ms);
      break;
    case 'scroll':
      pointer.x = step.x ?? (await page.evaluate(() => window.innerWidth / 2));
      pointer.y = await page.evaluate(() => window.innerHeight / 2);
      await page.mouse.move(pointer.x, pointer.y);
      await page.mouse.wheel(0, step.y);
      await sleep(250);
      break;
    case 'answerFileDialog':
      await app.evaluate(({ dialog }, picked) => {
        dialog.showOpenDialog = async () => ({ canceled: false, filePaths: picked });
      }, step.files);
      break;
    case 'resize': {
      const visible = await app.evaluate(({ BrowserWindow }, size) => {
        const [window] = BrowserWindow.getAllWindows();
        if (!window) throw new Error('Architect window is missing');
        window.setContentSize(size.width, size.height);
        return window.isVisible();
      }, step);
      if (visible) throw new Error('Demo window became visible');
      await page.waitForFunction(
        ({ width, height }) => window.innerWidth === width && window.innerHeight === height,
        step,
      );
      break;
    }
  }
}

export async function captureScene(scene: DemoScene, sceneDir: string): Promise<CapturedScene> {
  const framesDir = join(sceneDir, 'frames');
  await mkdir(framesDir, { recursive: true });
  process.stdout.write('Launching hidden Electron window\n');
  const launched = await launchApp(scene.launch);
  process.stdout.write('Hidden Electron window ready\n');
  const { app, page } = launched;
  const epoch = performance.now();
  const frames: CapturedFrame[] = [];
  const speedIntervals: SpeedInterval[] = [];
  const pointer: PointerState = { x: 140, y: 130 };
  let count = 0;
  const capture = async (kind: CapturedFrame['kind']) => {
    const now = performance.now();
    if (kind === 'app') await drawPointer(page, pointer, now);
    const file = `${String(count++).padStart(6, '0')}.jpg`;
    await page.screenshot({
      path: join(framesDir, file),
      type: 'jpeg',
      quality: 90,
      timeout: 15000,
    });
    frames.push({ file: `frames/${file}`, timestampMs: now - epoch, kind });
  };
  try {
    const visible = await app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows().some((window) => window.isVisible()),
    );
    if (visible) throw new Error('Architect window is visible');
    await app.evaluate(({ BrowserWindow }) => {
      const [window] = BrowserWindow.getAllWindows();
      window?.setContentSize(1440, 900);
    });
    await scene.setup?.(launched);
    await page.evaluate(() => document.fonts.ready.then(() => undefined));
    if (scene.title) {
      const start = performance.now();
      const durationMs = scene.title.seconds * 1000;
      let frameIndex = 0;
      while (performance.now() - start < durationMs) {
        const progress = (performance.now() - start) / durationMs;
        const fade = Math.min(1, progress / 0.17, (1 - progress) / 0.17);
        await showTitle(page, scene.title, Math.max(0, fade));
        await capture('title');
        frameIndex++;
        await sleep(Math.max(0, start + frameIndex * FRAME_MS - performance.now()));
      }
      await hideTitle(page);
    }

    let stopped = false;
    const captureLoop = (async () => {
      const start = performance.now();
      let frameIndex = 0;
      do {
        await capture('app');
        frameIndex++;
        await sleep(Math.max(0, start + frameIndex * FRAME_MS - performance.now()));
      } while (!stopped);
    })();
    try {
      for (const [index, step] of scene.steps.entries()) {
        const starting = scene.speedups?.find((speed) => speed.fromStep === index);
        if (starting) {
          speedIntervals.push({
            startMs: performance.now() - epoch,
            endMs: Infinity,
            factor: starting.factor,
          });
          await setSpeedMark(page, starting.factor);
        }
        await executeStep(step, page, app, pointer);
        const ending = scene.speedups?.find((speed) => speed.throughStep === index);
        if (ending) {
          const interval = speedIntervals.find(
            (candidate) => candidate.factor === ending.factor && candidate.endMs === Infinity,
          );
          if (!interval) throw new Error(`Speed interval ending at step ${index} was not started`);
          interval.endMs = performance.now() - epoch;
          await setSpeedMark(page);
        }
      }
      await sleep(scene.tailMs ?? 350);
    } finally {
      stopped = true;
      await captureLoop;
    }
    const result = { name: scene.name, frames, speedIntervals };
    await writeFile(join(sceneDir, 'frames.json'), JSON.stringify(result, null, 2));
    return result;
  } finally {
    await launched.close();
  }
}
