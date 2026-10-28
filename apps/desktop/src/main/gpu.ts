import { execFile } from 'node:child_process';
import { totalmem } from 'node:os';
import type { GpuInfo } from '@architect/shared';

/**
 * The share of an Apple chip's memory its GPU may use. macOS lets the GPU have about two thirds
 * to three quarters of it, so a little under three quarters is a fair working figure.
 */
const SHARED_GPU_SHARE = 0.7;

const MIB = 1024 * 1024;

/** Runs a program and resolves with what it printed. */
export type RunProgram = (file: string, args: readonly string[]) => Promise<string>;

/** Runs a program without a console window, which Windows would otherwise flash. */
const runProgram: RunProgram = (file, args) =>
  new Promise((resolve, reject) => {
    execFile(file, args, { timeout: 4_000, windowsHide: true }, (error, stdout) => {
      if (error) reject(error);
      else resolve(stdout);
    });
  });

/** The card with the most memory, from `nvidia-smi --query-gpu=name,memory.total` in MiB. */
export function parseNvidiaSmi(output: string): GpuInfo | null {
  let best: GpuInfo | null = null;
  for (const line of output.split(/\r?\n/)) {
    const match = /^(.+?),\s*(\d+)\s*$/.exec(line.trim());
    if (!match?.[1] || !match[2]) continue;
    const memoryBytes = Number(match[2]) * MIB;
    if (!best || memoryBytes > best.memoryBytes) {
      best = { name: match[1].trim(), memoryBytes, shared: false };
    }
  }
  return best;
}

export interface GpuProbe {
  platform?: NodeJS.Platform;
  arch?: string;
  totalMemoryBytes?: number;
  run?: RunProgram;
}

/**
 * The GPU local models can run on: an NVIDIA card, as its driver reports it, or an Apple chip,
 * whose GPU shares the computer's memory. Null when neither is found: the GPU, if any, is
 * unknown, and the app says nothing about fitting on it.
 */
export async function detectGpu(probe: GpuProbe = {}): Promise<GpuInfo | null> {
  const platform = probe.platform ?? process.platform;
  const arch = probe.arch ?? process.arch;
  if (platform === 'darwin' && arch === 'arm64') {
    const total = probe.totalMemoryBytes ?? totalmem();
    return {
      name: 'Apple silicon',
      memoryBytes: Math.floor(total * SHARED_GPU_SHARE),
      shared: true,
    };
  }
  const run = probe.run ?? runProgram;
  let output: string;
  try {
    output = await run('nvidia-smi', [
      '--query-gpu=name,memory.total',
      '--format=csv,noheader,nounits',
    ]);
  } catch {
    // No NVIDIA driver here, or it didn't answer in time; the GPU is unknown, which is an answer.
    return null;
  }
  return parseNvidiaSmi(output);
}
