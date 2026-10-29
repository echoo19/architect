/**
 * The comparisons runner (decisions 037, 045 and 051). A developer tool; it is not part of the
 * app and never runs in CI. Keys come from the environment: OPENROUTER_API_KEY for the hosted
 * student, META_API_TOKEN for Spark, and HF_TOKEN (or `hf auth login`) for training compute.
 *
 *   pnpm --filter @architect/engine exec tsx scripts/comparisons.ts <command> <jobDir> --out <dir>
 *     [--arms bare,draft,targeted,reference,reference-targeted,repeat,fixed,weights-one-shot,
 *       weights-targeted]
 *     [--student-usd N] [--spark-usd N] [--compute-usd N] [--gpu-minutes N] [--rounds N]
 *     [--regression <jobDir>] [--local-ollama] [--compute] [--llama-server] [--meter]
 *     [--adapter-protocol four-cell|reduced] [--smoke-tasks N]
 *     [--providers DeepInfra|any] [--local-model <name>] [--headroom N] [--parallel N]
 *     [--concurrency N] [--confirm] [--tasks N]
 *
 * Commands:
 *   plan    prices an attempt on the calibration tasks (the only spending) and projects every arm
 *   run     plans, then runs the funded arms; stops for --confirm when the caps cut the plan down
 *   probe   times this computer's build on --tasks calibration tasks: uses the GPU, owner only
 *   report  rebuilds report.md and report.json from the output folder's records
 *
 * Money and the GPU are held at each request. Every hosted request is reserved against
 * --student-usd at the most it could cost and written to requests.jsonl before it is sent, so
 * what is paid and what is in flight never pass it. Work on this computer's GPU runs only within
 * --gpu-minutes, counted from the first local request; when they are up it stops at once, and
 * with 0 nothing runs there. The plan pins the job's files; a run on changed files is refused.
 *
 * Keep the app closed while a comparison uses this computer's GPU. The runner shares the app's
 * GPU lease (decision 046): it takes the GPU only when no process of the app has it. When its
 * plan works on this computer and a window is granted, it checks before anything is paid that the
 * GPU is free, and otherwise stops at once with the busy error, which names who has it.
 *
 * Run again after a crash, it repeats no recorded attempt, Spark reply or training job. An
 * attempt in flight when the process stopped is made again, and its cut-off requests count as
 * spent at their worst; a Spark call in flight is paid again. Exit codes: 0 done, 1 error, 2 bad
 * arguments, 3 waiting for --confirm, 4 incomplete (an arm paused, a test held, or a guard hit).
 */
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { AdapterProtocolSchema, ArmIdSchema, type ArmId } from '@architect/shared';
import { hubTokenResolver } from '../src/hub';
import { appDataDir, describeLlamaServer, LocalRuntimeError } from '../src/local-runtime';
import {
  ARM_ORDER,
  DEFAULT_CONFIG,
  DEFAULT_MODELS,
  probeLocal,
  realEnvironment,
  reportOnly,
  runComparison,
  type ComparisonConfig,
  type ComparisonRequest,
} from '../src/comparisons';

const TRAINER_DIR = resolve(import.meta.dirname, '..', '..', '..', 'trainer');
const COMMANDS = ['plan', 'run', 'probe', 'report'] as const;
type Command = (typeof COMMANDS)[number];

const USAGE =
  'Usage: tsx scripts/comparisons.ts <plan|run|probe|report> <jobDir> --out <dir> [--arms a,b] [--student-usd N] [--spark-usd N] [--compute-usd N] [--gpu-minutes N] [--rounds N] [--regression <jobDir>] [--local-ollama] [--compute] [--llama-server] [--meter] [--adapter-protocol four-cell|reduced] [--smoke-tasks N] [--providers <names>|any] [--local-model <name>] [--headroom N] [--parallel N] [--concurrency N] [--confirm] [--tasks N]';

class UsageError extends Error {}

interface Parsed {
  command: Command;
  request: ComparisonRequest;
  parallel: number;
  meter: boolean;
  tasks: number;
}

const FLAGS = new Set(['--local-ollama', '--compute', '--llama-server', '--meter', '--confirm']);

function parse(args: readonly string[]): Parsed {
  const positional: string[] = [];
  const values = new Map<string, string>();
  const flags = new Set<string>();
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index] ?? '';
    if (FLAGS.has(arg)) {
      flags.add(arg);
      continue;
    }
    if (!arg.startsWith('--')) {
      positional.push(arg);
      continue;
    }
    const value = args[index + 1];
    if (value === undefined) throw new UsageError(`${arg} needs a value.`);
    values.set(arg, value);
    index += 1;
  }
  const [command, jobDir] = positional;
  if (!COMMANDS.includes(command as Command) || jobDir === undefined || positional.length > 2) {
    throw new UsageError(USAGE);
  }
  const out = values.get('--out');
  if (out === undefined) throw new UsageError('--out names the output folder.');
  const number = (flag: string, fallback: number) => {
    const text = values.get(flag);
    if (text === undefined) return fallback;
    const value = Number(text);
    if (!Number.isFinite(value) || value < 0) throw new UsageError(`${flag} takes a number.`);
    return value;
  };
  const arms = (values.get('--arms') ?? ARM_ORDER.join(','))
    .split(',')
    .map((arm) => ArmIdSchema.safeParse(arm.trim()))
    .map((result) => {
      if (!result.success) throw new UsageError(`--arms takes arms of ${ARM_ORDER.join(', ')}.`);
      return result.data;
    }) as ArmId[];
  const providers = values.get('--providers');
  const protocol = values.get('--adapter-protocol') ?? DEFAULT_CONFIG.adapterProtocol;
  const adapterProtocol = AdapterProtocolSchema.safeParse(protocol);
  if (!adapterProtocol.success) {
    throw new UsageError('--adapter-protocol takes four-cell or reduced.');
  }
  if (adapterProtocol.data === 'reduced' && arms.includes('weights-targeted')) {
    throw new UsageError(
      'The reduced adapter protocol measures only the one-shot adapter; leave weights-targeted out of --arms.',
    );
  }
  const config: ComparisonConfig = {
    ...DEFAULT_CONFIG,
    arms,
    adapterProtocol: adapterProtocol.data,
    smokeTasks: Math.max(1, Math.floor(number('--smoke-tasks', DEFAULT_CONFIG.smokeTasks))),
    // Refinement rounds for the targeted and fixed arms; the plan records them, so a resume keeps them.
    rounds: Math.max(1, Math.floor(number('--rounds', DEFAULT_CONFIG.rounds))),
    caps: {
      studentUsd: number('--student-usd', 0),
      sparkUsd: number('--spark-usd', 0),
      computeUsd: number('--compute-usd', 0),
      localMinutes: number('--gpu-minutes', 0),
    },
    localOllama: flags.has('--local-ollama'),
    realCompute: flags.has('--compute'),
    llamaServer: flags.has('--llama-server'),
    concurrency: Math.max(1, Math.floor(number('--concurrency', DEFAULT_CONFIG.concurrency))),
    // Each arm's student cap is its worst-case projection times this.
    headroom: Math.max(1, number('--headroom', DEFAULT_CONFIG.headroom)),
  };
  const regression = values.get('--regression');
  const localModel = values.get('--local-model');
  return {
    command: command as Command,
    request: {
      jobDir: resolve(jobDir),
      ...(regression === undefined ? {} : { regressionJobDir: resolve(regression) }),
      out: resolve(out),
      config,
      models: {
        ...DEFAULT_MODELS,
        ...(localModel === undefined ? {} : { localModel }),
        ...(providers === undefined
          ? {}
          : providers === 'any'
            ? { providers: undefined }
            : { providers: providers.split(',').map((name) => name.trim()) }),
      },
      confirm: flags.has('--confirm'),
      planOnly: command === 'plan',
    },
    parallel: Math.max(1, Math.floor(number('--parallel', 2))),
    meter: flags.has('--meter'),
    tasks: Math.max(1, Math.floor(number('--tasks', 3))),
  };
}

function log(line: string): void {
  process.stdout.write(`${new Date().toISOString().slice(11, 19)}  ${line}\n`);
}

function commit(): string | null {
  try {
    return execFileSync('git', ['rev-parse', '--short', 'HEAD'], { encoding: 'utf8' }).trim();
  } catch {
    return null;
  }
}

async function main(): Promise<number> {
  let parsed: Parsed;
  try {
    parsed = parse(process.argv.slice(2));
  } catch (error) {
    if (!(error instanceof UsageError)) throw error;
    process.stderr.write(`${error.message}\n`);
    return 2;
  }
  const { request } = parsed;
  // What the weights arms need is checked before anything spends; reading them calls no model.
  if (request.config.realCompute && (await hubTokenResolver()()) === undefined) {
    process.stderr.write(
      '--compute needs a Hugging Face token with Jobs access: set HF_TOKEN or run `hf auth login`.\n',
    );
    return 2;
  }
  if (request.config.llamaServer) {
    const server = await describeLlamaServer();
    if (!server.ready) {
      process.stderr.write(`--llama-server needs llama-server: ${server.problem} ${server.hint}\n`);
      return 2;
    }
  }
  const { env, close } = realEnvironment({
    dataDir: resolve(request.out, 'data'),
    appDataDir: appDataDir(process.env),
    trainerDir: TRAINER_DIR,
    meter: parsed.meter,
    parallel: parsed.parallel,
    commit: commit(),
    log,
  });
  try {
    switch (parsed.command) {
      case 'probe': {
        const { meter } = env.deps;
        const result = await probeLocal(request, env, {
          tasks: parsed.tasks,
          meter: meter ?? null,
        });
        log(`Probe: ${result.attempts} local attempts recorded in ${request.out}.`);
        return 0;
      }
      case 'report': {
        await reportOnly(request, env);
        log(`Report written to ${request.out}.`);
        return 0;
      }
      default: {
        const { outcome, report } = await runComparison(request, env);
        const projection = report.projection;
        if (projection !== null) {
          for (const arm of projection.arms) {
            log(
              `${arm.arm}: ${arm.funded ? 'funded' : `not run (${arm.reason ?? ''})`}; student $${arm.studentUsd.toFixed(2)}, Spark $${arm.sparkUsd.toFixed(2)}, compute $${arm.computeUsd.toFixed(2)}, local ${Math.ceil(arm.localMinutes)} min, about ${Math.ceil(arm.wallMinutes)} min`,
            );
          }
          log(
            `Funded total: student $${projection.funded.studentUsd.toFixed(2)} of $${projection.caps.studentUsd.toFixed(2)}, Spark $${projection.funded.sparkUsd.toFixed(2)} of $${projection.caps.sparkUsd.toFixed(2)}, compute $${projection.funded.computeUsd.toFixed(2)} of $${projection.caps.computeUsd.toFixed(2)}.`,
          );
        }
        log(`Report written to ${request.out}: ${outcome}.`);
        if (outcome === 'needs_confirmation') {
          log(
            'The caps cut the plan down. Run it again with --confirm to go ahead with what fits.',
          );
          return 3;
        }
        return outcome === 'incomplete' ? 4 : 0;
      }
    }
  } finally {
    await close();
  }
}

main().then(
  (code) => {
    process.exitCode = code;
  },
  (error: unknown) => {
    // A local runtime's problem, such as the GPU in use, is said with what to do about it.
    process.stderr.write(
      `${
        error instanceof LocalRuntimeError
          ? `${error.message} ${error.hint}`
          : error instanceof Error
            ? (error.stack ?? error.message)
            : String(error)
      }\n`,
    );
    process.exitCode = 1;
  },
);
