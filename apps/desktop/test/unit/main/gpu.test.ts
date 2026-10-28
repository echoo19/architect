import { describe, expect, it, vi } from 'vitest';
import { detectGpu, parseNvidiaSmi } from '../../../src/main/gpu';

describe('parseNvidiaSmi', () => {
  it("reads the card's name and memory in MiB", () => {
    expect(parseNvidiaSmi('NVIDIA GeForce RTX 4070 Ti, 12282\r\n')).toEqual({
      name: 'NVIDIA GeForce RTX 4070 Ti',
      memoryBytes: 12_282 * 1024 * 1024,
      shared: false,
    });
  });

  it('takes the card with the most memory, and nothing from output it can’t read', () => {
    expect(parseNvidiaSmi('NVIDIA T400, 2048\nNVIDIA RTX A6000, 49140\n')?.name).toBe(
      'NVIDIA RTX A6000',
    );
    expect(parseNvidiaSmi('')).toBeNull();
    expect(
      parseNvidiaSmi('NVIDIA-SMI has failed because it couldn’t talk to the driver.'),
    ).toBeNull();
  });
});

describe('detectGpu', () => {
  it('asks nvidia-smi for the name and memory, without a console window', async () => {
    const run = vi.fn(async () => 'NVIDIA GeForce RTX 4090, 24564\n');
    expect(await detectGpu({ platform: 'win32', arch: 'x64', run })).toMatchObject({
      name: 'NVIDIA GeForce RTX 4090',
      shared: false,
    });
    expect(run).toHaveBeenCalledWith('nvidia-smi', [
      '--query-gpu=name,memory.total',
      '--format=csv,noheader,nounits',
    ]);
  });

  it('counts most of an Apple chip’s memory, which its GPU shares', async () => {
    const run = vi.fn();
    expect(
      await detectGpu({ platform: 'darwin', arch: 'arm64', totalMemoryBytes: 32e9, run }),
    ).toEqual({ name: 'Apple silicon', memoryBytes: 22.4e9, shared: true });
    expect(run).not.toHaveBeenCalled();
  });

  it('knows no GPU when there is no NVIDIA driver', async () => {
    const run = vi.fn(async () => {
      throw Object.assign(new Error('spawn nvidia-smi ENOENT'), { code: 'ENOENT' });
    });
    expect(await detectGpu({ platform: 'linux', arch: 'x64', run })).toBeNull();
  });
});
