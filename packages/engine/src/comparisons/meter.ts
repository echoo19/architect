import { execFile } from 'node:child_process';
import { DecodingSchema, type StudentAdapter } from '@architect/shared';
import type { MeterReading, MeterSession, RuntimeMeter } from '../loop/deps';

/** Runs a program and gives its standard output. */
export type RunProgram = (file: string, args: readonly string[]) => Promise<string>;

const runProgram: RunProgram = (file, args) =>
  new Promise((resolve, reject) => {
    execFile(file, [...args], { windowsHide: true, timeout: 10_000 }, (error, stdout) => {
      if (error) reject(error);
      else resolve(stdout);
    });
  });

/** The memory each named process holds, from `tasklist` on Windows or `ps` elsewhere, in bytes. */
export function parseProcessMemory(
  output: string,
  platform: NodeJS.Platform,
  names: readonly string[],
): number | null {
  const wanted = new Set(names.map((name) => name.toLowerCase()));
  let total = 0;
  let found = false;
  for (const line of output.split(/\r?\n/)) {
    if (line.trim() === '') continue;
    let name: string;
    let bytes: number;
    if (platform === 'win32') {
      // "ollama.exe","1234","Console","1","1,234,567 K"
      const cells = [...line.matchAll(/"([^"]*)"/g)].map((match) => match[1] ?? '');
      if (cells.length < 5) continue;
      name = (cells[0] ?? '').replace(/\.exe$/i, '');
      bytes = 1024 * Number((cells[4] ?? '').replace(/[^0-9]/g, ''));
    } else {
      // "  123456 /usr/local/bin/ollama"
      const match = /^\s*(\d+)\s+(.+)$/.exec(line);
      if (!match) continue;
      name = (match[2] ?? '').split('/').pop() ?? '';
      bytes = 1024 * Number(match[1]);
    }
    if (!wanted.has(name.toLowerCase()) || !Number.isFinite(bytes)) continue;
    total += bytes;
    found = true;
  }
  return found ? total : null;
}

/** GPU memory in use across the cards `nvidia-smi` reports, in bytes; null without a reading. */
export function parseGpuMemory(output: string): number | null {
  const values = output
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => /^\d+(\.\d+)?$/.test(line))
    .map(Number);
  return values.length === 0 ? null : values.reduce((sum, mib) => sum + mib * 1024 * 1024, 0);
}

/** The processes a backend's model lives in. */
export const SERVER_PROCESSES: Record<string, readonly string[]> = {
  ollama: ['ollama', 'ollama_llama_server'],
  'llama.cpp': ['llama-server'],
};

export interface SystemMeterOptions {
  /** Unloads a backend's model before its cold start is timed, by backend. */
  unload: Partial<Record<string, (signal: AbortSignal) => Promise<void>>>;
  intervalMs?: number;
  platform?: NodeJS.Platform;
  run?: RunProgram;
  now?: () => number;
}

/** How long a first reply takes to begin: the model loads, then reads the request. */
async function firstReply(student: StudentAdapter, signal: AbortSignal): Promise<void> {
  const reply = student.chat(
    {
      messages: [{ role: 'user', content: 'Reply with OK.' }],
      tools: [],
      decoding: DecodingSchema.parse({ maxOutputTokens: 64, thinking: 'low' }),
      seed: 1,
    },
    signal,
  );
  for await (const _event of reply) return;
}

/**
 * Watches the runtime serving a local student (decision 045): before the evaluation it unloads
 * the model and times a first reply, the cold start; during it, it reads the server's resident
 * memory and the GPU's memory in use every few seconds and keeps the most of each. A hosted copy
 * has nothing here to watch.
 */
export function systemMeter(options: SystemMeterOptions): RuntimeMeter {
  const platform = options.platform ?? process.platform;
  const run = options.run ?? runProgram;
  const now = options.now ?? (() => performance.now());
  const intervalMs = options.intervalMs ?? 2_000;
  return {
    start: async ({ backend, target, student, signal }): Promise<MeterSession | null> => {
      if (target !== 'local') return null;
      const names = SERVER_PROCESSES[backend] ?? [];
      let peakProcessBytes: number | null = null;
      let peakGpuBytes: number | null = null;
      let samples = 0;
      const sample = async () => {
        const [processes, gpu] = await Promise.all([
          (platform === 'win32'
            ? run('tasklist', ['/FO', 'CSV', '/NH'])
            : run('ps', ['-A', '-o', 'rss=,comm='])
          ).then(
            (output) => parseProcessMemory(output, platform, names),
            () => null,
          ),
          run('nvidia-smi', ['--query-gpu=memory.used', '--format=csv,noheader,nounits']).then(
            parseGpuMemory,
            () => null,
          ),
        ]);
        if (processes !== null) peakProcessBytes = Math.max(peakProcessBytes ?? 0, processes);
        if (gpu !== null) peakGpuBytes = Math.max(peakGpuBytes ?? 0, gpu);
        samples += 1;
      };
      let coldStartMs: number | null = null;
      const unload = options.unload[backend];
      if (unload !== undefined) {
        await unload(signal);
        const started = now();
        await firstReply(student, signal);
        coldStartMs = Math.round(now() - started);
      }
      await sample();
      const timer = setInterval(() => void sample(), intervalMs);
      return {
        stop: async (): Promise<MeterReading> => {
          clearInterval(timer);
          await sample();
          return {
            peakProcessBytes,
            peakGpuBytes,
            coldStartMs,
            samples,
            sampler: `${platform === 'win32' ? 'tasklist' : 'ps'} (${names.join(', ')}) and nvidia-smi every ${intervalMs / 1000} s; cold start after unloading the model`,
          };
        },
      };
    },
  };
}
