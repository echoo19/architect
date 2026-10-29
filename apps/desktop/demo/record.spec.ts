import { mkdir } from 'node:fs/promises';
import { resolve, join, basename } from 'node:path';
import { pathToFileURL } from 'node:url';
import { test } from '@playwright/test';
import { assemble } from './assemble';
import { captureScene } from './capture';
import type { DemoScript } from './script';

test('record the scene script in a hidden window', async () => {
  // A scene with a local model's replies can take many minutes before they are sped up.
  test.setTimeout(Number(process.env.ARCHITECT_DEMO_MINUTES ?? 30) * 60_000);
  const scriptPath = resolve(process.env.ARCHITECT_DEMO_SCRIPT ?? 'demo/sample.ts');
  const output = resolve(process.env.ARCHITECT_DEMO_OUTPUT ?? 'demo/work/sample.mp4');
  const work = resolve('demo/work', basename(output, '.mp4'));
  const module = (await import(pathToFileURL(scriptPath).href)) as { default: DemoScript };
  const script = module.default;
  if (!script?.scenes?.length) throw new Error('The scene script is empty');
  if ((script.width ?? 1440) / (script.height ?? 900) !== 1.6) {
    throw new Error('The output must be 1440x900 or 1920x1200');
  }
  await mkdir(work, { recursive: true });
  await mkdir(resolve(output, '..'), { recursive: true });
  const captured = [];
  for (const [index, scene] of script.scenes.entries()) {
    const dir = join(work, `scene-${String(index + 1).padStart(2, '0')}`);
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
