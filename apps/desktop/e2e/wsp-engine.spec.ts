import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import type { WspExperiment } from '@architect/shared';
import { goTo, launchApp } from './app';

/*
 * Architect WSP on the real engine (decision 109), with nothing stubbed: a model found in a
 * Hugging Face cache, a draft whose brief the scripted stand-in mentor writes, the sealed split
 * kept in the vault, and a start that, with no worker set up on this profile, stops with the
 * reason on the experiment's screen. No model runs and nothing is paid for.
 */

const REVISION = '0123456789abcdef0123456789abcdef01234567';

/** A tiny checkpoint: a safetensors file of float32 tensors and a config, in a cache snapshot. */
async function tinyCache(root: string): Promise<string> {
  const folder = join(root, 'hub', 'models--test--tiny-lm', 'snapshots', REVISION);
  await mkdir(folder, { recursive: true });
  const tensors: [string, number[]][] = [
    ['model.embed_tokens.weight', [8, 4]],
    ['model.layers.0.mlp.down_proj.weight', [4, 6]],
  ];
  const header: Record<string, unknown> = {};
  const parts: Buffer[] = [];
  let offset = 0;
  for (const [name, shape] of tensors) {
    const count = shape.reduce((a, b) => a * b, 1);
    const data = Buffer.from(new Float32Array(count).fill(0.5).buffer);
    header[name] = { dtype: 'F32', shape, data_offsets: [offset, offset + data.length] };
    offset += data.length;
    parts.push(data);
  }
  let json = JSON.stringify(header);
  while (json.length % 8 !== 0) json += ' ';
  const size = Buffer.alloc(8);
  size.writeBigUInt64LE(BigInt(json.length));
  await writeFile(
    join(folder, 'model.safetensors'),
    Buffer.concat([size, Buffer.from(json), ...parts]),
  );
  await writeFile(
    join(folder, 'config.json'),
    JSON.stringify({ architectures: ['TinyForCausalLM'], num_hidden_layers: 1 }),
  );
  return join(root, 'hub');
}

test('finds a cached model, drafts with the stand-in mentor, seals the split and says why a start stops', async () => {
  const cache = await tinyCache(await mkdtemp(join(tmpdir(), 'architect-wsp-cache-')));
  const launched = await launchApp({
    settings: { edition: 'wsp', onboarded: true },
    env: { ARCHITECT_WSP_MENTOR: 'stand-in', HF_HUB_CACHE: cache },
  });
  const { page } = launched;
  try {
    const mentor = await page.evaluate(() => window.architect.wsp.mentor());
    expect(mentor).toMatchObject({
      status: 'ready',
      mentor: { standIn: true, label: 'Stand-in mentor' },
    });
    const targets = await page.evaluate(() => window.architect.wsp.computeTargets());
    expect(targets.map((target) => [target.id, target.status])).toEqual([
      ['local-cpu', 'needs-setup'],
      ['hf-jobs', 'unsupported'],
      ['slurm', 'unsupported'],
      ['kubernetes', 'unsupported'],
      ['skypilot', 'unsupported'],
    ]);
    const models = await page.evaluate(() => window.architect.wsp.models());
    const tiny = models.find((model) => model.repo === 'test/tiny-lm');
    expect(tiny?.compatibility.supported).toBe(true);
    expect(tiny?.revision).toBe(REVISION);
    const examples = Array.from({ length: 14 }, (_, i) => ({
      prompt: `Question ${1000 + i}: what is ${i} plus ${i}?`,
      check: { kind: 'number' as const, value: String(2 * i) },
    }));
    const drafted = await page.evaluate((input) => window.architect.wsp.draft(input), {
      modelPath: tiny!.path,
      goal: { task: 'Add two numbers.', examples },
      compute: 'local-cpu' as const,
      limits: {
        programs: 4,
        forwardPasses: 12,
        wallMinutes: 10,
        mentorUsd: 0,
        computeUsd: 0,
        programSeconds: 60,
        maxChangedFraction: 0.01,
        memoryGb: 4,
      },
      reasoningEffort: 'high' as const,
    });
    const until = async (done: (experiment: WspExperiment) => boolean) => {
      for (let i = 0; i < 200; i += 1) {
        const experiment = await page.evaluate((id) => window.architect.wsp.get(id), drafted.id);
        if (done(experiment)) return experiment;
        await page.waitForTimeout(100);
      }
      throw new Error('The experiment never got there.');
    };
    const brief = await until((experiment) => experiment.status === 'brief');
    expect(brief.brief?.target.metric).toBe('pass_rate');
    expect(brief.mentor.standIn).toBe(true);
    expect(brief.split.qualification).toBeGreaterThanOrEqual(4);
    expect(brief.goal.examples).toEqual([]);
    expect(brief.base.files.map((file) => file.name)).toEqual(['config.json', 'model.safetensors']);

    await goTo(page, `/wsp/${drafted.id}`);
    await expect(page.getByRole('button', { name: 'Start experiment' })).toBeVisible();
    await page.getByRole('button', { name: 'Start experiment' }).click();
    const failed = await until((experiment) => experiment.status === 'failed');
    expect(failed.approval?.briefSha256).toMatch(/^[0-9a-f]{64}$/);
    expect(failed.error).toMatch(/worker/i);
    await goTo(page, `/wsp/${drafted.id}`);
    await expect(page.getByText('It stopped on an error')).toBeVisible();
  } finally {
    await launched.close();
  }
});
