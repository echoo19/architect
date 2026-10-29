import { spawn } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import { assemble } from './assemble';
import type { CapturedScene } from './capture';

function run(program: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(program, args, { windowsHide: true });
    let output = '';
    child.stdout.on('data', (chunk: Buffer) => (output += chunk.toString()));
    child.on('error', reject);
    child.on('close', (code) =>
      code === 0 ? resolve(output) : reject(new Error(`${program} exited ${code}`)),
    );
  });
}

test('assembles measured JPEG durations and a scene cross-fade as 30 fps H.264', async ({
  request: _request,
}, testInfo) => {
  test.setTimeout(60_000);
  const scenes: { dir: string; capture: CapturedScene }[] = [];
  for (const [index, color] of ['#101114', '#82B6F5'].entries()) {
    const dir = testInfo.outputPath(`scene-${index}`);
    await mkdir(join(dir, 'frames'), { recursive: true });
    const frames = [];
    for (let frame = 0; frame < 3; frame++) {
      const file = `frames/${frame}.jpg`;
      await run('ffmpeg', [
        '-y',
        '-hide_banner',
        '-loglevel',
        'error',
        '-f',
        'lavfi',
        '-i',
        `color=c=${color}:s=1440x900:d=0.1`,
        '-frames:v',
        '1',
        join(dir, file),
      ]);
      frames.push({ file, timestampMs: frame * 400, kind: 'app' as const });
    }
    scenes.push({
      dir,
      capture: {
        name: `scene-${index}`,
        frames,
        speedIntervals: index === 0 ? [{ startMs: 400, endMs: 800, factor: 4 }] : [],
      },
    });
  }
  const output = testInfo.outputPath('assembly.mp4');
  await assemble(scenes, output, { width: 1440, height: 900 }, 0.2);
  const probe = JSON.parse(
    await run('ffprobe', [
      '-v',
      'error',
      '-select_streams',
      'v:0',
      '-show_entries',
      'stream=codec_name,r_frame_rate,width,height:format=duration',
      '-of',
      'json',
      output,
    ]),
  ) as {
    streams: { codec_name: string; r_frame_rate: string; width: number; height: number }[];
    format: { duration: string };
  };
  expect(probe.streams[0]).toMatchObject({
    codec_name: 'h264',
    r_frame_rate: '30/1',
    width: 1440,
    height: 900,
  });
  expect(Number(probe.format.duration)).toBeGreaterThan(1);
  expect(Number(probe.format.duration)).toBeLessThan(3);
});
