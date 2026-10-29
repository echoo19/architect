import { mkdir, readFile } from 'node:fs/promises';
import { resolve, join, basename } from 'node:path';
import { pathToFileURL } from 'node:url';
import { test } from '@playwright/test';
import { assemble } from './assemble';
import { captureScene, recaptureTitle, type CapturedScene } from './capture';
import type { DemoScript } from './script';

/** Scene names from a comma-separated environment variable. */
function sceneNames(name: string): Set<string> {
  return new Set(
    (process.env[name] ?? '')
      .split(',')
      .map((scene) => scene.trim())
      .filter((scene) => scene.length > 0),
  );
}

test('record the scene script in a hidden window', async () => {
  // A scene with a local model's replies can take many minutes before they are sped up.
  test.setTimeout(Number(process.env.ARCHITECT_DEMO_MINUTES ?? 30) * 60_000);
  const scriptPath = resolve(process.env.ARCHITECT_DEMO_SCRIPT ?? 'demo/sample.ts');
  const output = resolve(process.env.ARCHITECT_DEMO_OUTPUT ?? 'demo/work/sample.mp4');
  const work = resolve('demo/work', basename(output, '.mp4'));
  const module = (await import(pathToFileURL(scriptPath).href)) as { default: DemoScript };
  const script = module.default;
  if (!script?.scenes?.length) throw new Error('The scene script is empty');
  // ARCHITECT_DEMO_ONLY names the scenes to record, ARCHITECT_DEMO_REUSE the ones whose earlier
  // capture under the same output name is used again rather than recorded, and
  // ARCHITECT_DEMO_RETITLE the ones reused with their title card recorded again.
  const only = sceneNames('ARCHITECT_DEMO_ONLY');
  const reuse = sceneNames('ARCHITECT_DEMO_REUSE');
  const retitle = sceneNames('ARCHITECT_DEMO_RETITLE');
  for (const name of [...only, ...reuse, ...retitle]) {
    if (!script.scenes.some((scene) => scene.name === name)) {
      throw new Error(`The script has no scene named ${name}`);
    }
  }
  if ((script.width ?? 1440) / (script.height ?? 900) !== 1.6) {
    throw new Error('The output must be 1440x900 or 1920x1200');
  }
  await mkdir(work, { recursive: true });
  await mkdir(resolve(output, '..'), { recursive: true });
  const captured = [];
  // A scene keeps its folder number from its place in the whole script, so a capture made on
  // its own can be reused in the full film.
  for (const [index, scene] of script.scenes.entries()) {
    const named = only.has(scene.name) || reuse.has(scene.name) || retitle.has(scene.name);
    if (only.size > 0 && !named) continue;
    const dir = join(work, `scene-${String(index + 1).padStart(2, '0')}`);
    if (retitle.has(scene.name)) {
      process.stdout.write(`Recording the title of ${scene.name} again\n`);
      captured.push({ dir, capture: await recaptureTitle(scene, dir) });
      continue;
    }
    if (reuse.has(scene.name)) {
      process.stdout.write(`Reusing ${scene.name}\n`);
      const capture = JSON.parse(await readFile(join(dir, 'frames.json'), 'utf8')) as CapturedScene;
      captured.push({ dir, capture });
      continue;
    }
    process.stdout.write(`Capturing ${scene.name}\n`);
    captured.push({ dir, capture: await captureScene(scene, dir) });
  }
  await assemble(
    captured,
    output,
    { width: script.width ?? 1440, height: script.height ?? 900 },
    script.crossfadeSeconds ?? 0.35,
  );
  process.stdout.write(`Wrote ${output}\n`);
});
