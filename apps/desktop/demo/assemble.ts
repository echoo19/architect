import { spawn } from 'node:child_process';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { CapturedScene } from './capture';
import { frameDurations } from './timeline';

async function command(program: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(program, args, { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk: Buffer) => (stdout += chunk.toString()));
    child.stderr.on('data', (chunk: Buffer) => (stderr += chunk.toString()));
    child.on('error', reject);
    child.on('close', (code) =>
      code === 0
        ? resolve(stdout)
        : reject(new Error(`${program} exited ${code}: ${stderr.slice(-3000)}`)),
    );
  });
}

function concatFile(scene: CapturedScene): string {
  const timestamps = scene.frames.map((frame) => frame.timestampMs);
  const durations = frameDurations(timestamps, scene.speedIntervals, 1000 / 30);
  const lines: string[] = [];
  for (const [index, frame] of scene.frames.entries()) {
    lines.push(`file '${frame.file}'`);
    lines.push(`duration ${((durations[index] ?? 1000 / 30) / 1000).toFixed(6)}`);
  }
  const last = scene.frames.at(-1);
  if (!last) throw new Error(`Scene ${scene.name} has no frames`);
  lines.push(`file '${last.file}'`);
  return `${lines.join('\n')}\n`;
}

async function duration(file: string): Promise<number> {
  const output = await command('ffprobe', [
    '-v',
    'error',
    '-show_entries',
    'format=duration',
    '-of',
    'default=noprint_wrappers=1:nokey=1',
    file,
  ]);
  const seconds = Number(output.trim());
  if (!Number.isFinite(seconds) || seconds <= 0) throw new Error(`Invalid video duration: ${file}`);
  return seconds;
}

export async function assemble(
  scenes: { dir: string; capture: CapturedScene }[],
  output: string,
  size: { width: number; height: number },
  crossfadeSeconds: number,
): Promise<void> {
  if (!scenes.length) throw new Error('A demo needs at least one scene');
  const segments: string[] = [];
  for (const [index, scene] of scenes.entries()) {
    const list = join(scene.dir, 'frames.ffconcat');
    const segment = join(scene.dir, 'segment.mp4');
    await writeFile(list, `ffconcat version 1.0\n${concatFile(scene.capture)}`);
    await command('ffmpeg', [
      '-y',
      '-hide_banner',
      '-loglevel',
      'error',
      '-safe',
      '0',
      '-f',
      'concat',
      '-i',
      list,
      '-vf',
      `fps=30,scale=${size.width}:${size.height}:flags=lanczos,format=yuv420p`,
      '-an',
      '-c:v',
      'libx264',
      '-preset',
      'medium',
      '-crf',
      '18',
      '-r',
      '30',
      '-movflags',
      '+faststart',
      segment,
    ]);
    segments[index] = segment;
  }
  if (segments.length === 1) {
    await command('ffmpeg', [
      '-y',
      '-hide_banner',
      '-loglevel',
      'error',
      '-i',
      segments[0]!,
      '-c',
      'copy',
      output,
    ]);
    return;
  }

  const durations = await Promise.all(segments.map(duration));
  const fade = Math.max(
    0.1,
    Math.min(crossfadeSeconds, ...durations.map((seconds) => seconds / 3)),
  );
  const filters: string[] = segments.map(
    (_, index) => `[${index}:v]settb=AVTB,setpts=PTS-STARTPTS[v${index}]`,
  );
  let prior = 'v0';
  let elapsed = durations[0]!;
  for (let index = 1; index < segments.length; index++) {
    const next = `fade${index}`;
    filters.push(
      `[${prior}][v${index}]xfade=transition=fade:duration=${fade.toFixed(3)}:offset=${(elapsed - fade).toFixed(3)}[${next}]`,
    );
    prior = next;
    elapsed += durations[index]! - fade;
  }
  await command('ffmpeg', [
    '-y',
    '-hide_banner',
    '-loglevel',
    'error',
    ...segments.flatMap((segment) => ['-i', segment]),
    '-filter_complex',
    filters.join(';'),
    '-map',
    `[${prior}]`,
    '-an',
    '-c:v',
    'libx264',
    '-preset',
    'medium',
    '-crf',
    '18',
    '-pix_fmt',
    'yuv420p',
    '-r',
    '30',
    '-movflags',
    '+faststart',
    output,
  ]);
}
