/**
 * Architect WSP's planted-fault benchmark: one experiment through the real runner for each
 * damaged copy that `examples/wsp-bench/make_bench.py` wrote, then a repair rate with its 95%
 * Wilson interval and each copy's sealed accuracy before and after. A developer tool; it is not
 * part of the app and never runs in CI.
 *
 *   pnpm --filter @architect/engine exec tsx scripts/wsp-bench.ts <benchDir> <dataDir> <envDir> \
 *     (--astra --total-usd 3.9 --per-usd 0.45 | --stand-in) [--only fault-01,fault-02]
 *
 * With --astra, GPT-6 Astra is the mentor through OPENAI_API_KEY (read by name, never printed);
 * each experiment's own cap is the smaller of --per-usd and what is left of the total, and none
 * starts once what is left can't pay for one call at its worst case (about $0.90). The mentor sees
 * only the damaged copy and the goal; `bench.json` (where each fault is) and the healthy
 * checkpoint are read here, for scoring, and never reach it. Results go to <dataDir>/bench.json.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { createMentor } from '@architect/adapters';
import {
  WSP_DEFAULT_LIMITS,
  type MentorConfig,
  type WspExample,
  type WspExperiment,
} from '@architect/shared';
import { wilson } from '../src/comparisons/stats';
import { Vault } from '../src/vault/vault';
import { connectWspMentor, standInMentor, WspService, wspMentorStatus } from '../src/wsp';

const [benchDir, dataDir, envDir] = process.argv.slice(2);
const flag = (name: string) => {
  const at = process.argv.indexOf(name);
  return at === -1 ? undefined : process.argv[at + 1];
};
const astra = process.argv.includes('--astra');
const totalUsd = Number(flag('--total-usd') ?? 0);
const perUsd = Number(flag('--per-usd') ?? 0);
const only = flag('--only')?.split(',');
if (
  !benchDir ||
  !dataDir ||
  !envDir ||
  (astra
    ? !(totalUsd > 0 && perUsd > 0) || !process.env['OPENAI_API_KEY']
    : !process.argv.includes('--stand-in'))
) {
  process.stderr.write(
    'Usage: tsx scripts/wsp-bench.ts <benchDir> <dataDir> <envDir> (--astra --total-usd N --per-usd N | --stand-in) [--only a,b]\n',
  );
  process.exit(2);
}
if (!astra) process.env['ARCHITECT_WSP_MENTOR'] = 'stand-in';

interface Fault {
  folder: string;
  kind: string;
  tensor: string;
  accuracy: number;
}
const bench = JSON.parse(readFileSync(join(benchDir, 'bench.json'), 'utf8')) as {
  task: string;
  healthy_accuracy: number;
  faults: Fault[];
};
const examples = JSON.parse(readFileSync(join(benchDir, 'examples.json'), 'utf8')) as WspExample[];

const deps = {
  secrets: {
    get: (ref: string) =>
      Promise.resolve(astra && ref === 'openai' ? process.env['OPENAI_API_KEY'] : undefined),
  },
  adapters: {
    createMentor: (config: MentorConfig, options: { apiKey?: string }) =>
      createMentor(config, options.apiKey === undefined ? {} : { apiKey: options.apiKey }),
  },
} as unknown as Parameters<typeof connectWspMentor>[0];

const root = resolve(dataDir);
const service = new WspService({
  dir: join(root, 'wsp'),
  sourceDir: resolve(import.meta.dirname, '..', '..', '..', 'trainer', 'wsp'),
  vault: new Vault(root),
  envDir: resolve(envDir),
  connectMentor: (effort) =>
    astra ? connectWspMentor(deps, effort) : Promise.resolve(standInMentor()),
  mentorStatus: () => wspMentorStatus(deps),
});

async function until(id: string, done: (experiment: WspExperiment) => boolean) {
  for (;;) {
    const experiment = service.get(id);
    if (done(experiment)) return experiment;
    await new Promise((r) => setTimeout(r, 2_000));
  }
}

function sealed(experiment: WspExperiment, arm: 'base' | 'candidate') {
  const item = experiment.measurements.find((m) => m.split === 'qualification' && m.arm === arm);
  return item === undefined || item.passed === null
    ? null
    : { passed: item.passed, of: item.checked };
}

const rows: Record<string, unknown>[] = [];
let spent = 0;
for (const fault of bench.faults) {
  if (only !== undefined && !only.includes(fault.folder)) continue;
  const cap = astra ? Math.min(perUsd, totalUsd - spent) : 0;
  if (astra && cap < 0.9) {
    rows.push({ fault: fault.folder, skipped: `$${spent.toFixed(2)} of $${totalUsd} spent` });
    continue;
  }
  process.stdout.write(`${fault.folder} (${fault.kind} in ${fault.tensor}) `);
  const drafted = await service.draft({
    modelPath: join(resolve(benchDir), fault.folder),
    goal: {
      task: `This small language model was trained to reverse a string of six letters: given "abcdef=" it answers "fedcba". Some of its weights have been damaged since, and it now gets most strings wrong. Find the damage in its weights and repair it, so it reverses strings correctly again.`,
      constraints: 'Answers are checked exactly. Change as few weights as the repair needs.',
      examples,
    },
    compute: 'local-cpu',
    limits: {
      ...WSP_DEFAULT_LIMITS,
      programs: 6,
      forwardPasses: 20,
      wallMinutes: 25,
      mentorUsd: cap,
      programSeconds: 120,
      maxChangedFraction: 0.1,
      memoryGb: 4,
    },
    reasoningEffort: 'medium',
  });
  const briefed = await until(drafted.id, (e) => e.status !== 'briefing');
  if (briefed.brief === null) {
    rows.push({ fault: fault.folder, experiment: drafted.id, error: briefed.error });
    spent += briefed.costs.mentorUsd;
    continue;
  }
  service.start(drafted.id);
  let experiment = await until(drafted.id, (e) => !['running', 'cancelling'].includes(e.status));
  if (experiment.status === 'evaluated' && experiment.frozen !== null) {
    await service.qualify(drafted.id);
    experiment = await until(drafted.id, (e) => e.status !== 'qualifying');
  }
  spent += experiment.costs.mentorUsd;
  const before = sealed(experiment, 'base');
  const after = sealed(experiment, 'candidate');
  const row = {
    fault: fault.folder,
    kind: fault.kind,
    tensor: fault.tensor,
    experiment: experiment.id,
    status: experiment.status,
    verdict: experiment.result?.verdict ?? null,
    programs: experiment.iterations.length,
    edited: experiment.iterations.flatMap((item) => (item.edits ?? []).map((edit) => edit.tensor)),
    foundTheTensor: experiment.iterations.some((item) =>
      (item.edits ?? []).some((edit) => edit.tensor === fault.tensor),
    ),
    /** The damaged copy on all 200 held-out strings, as the benchmark measured it. */
    heldOutBefore: fault.accuracy,
    sealedBefore: before,
    sealedAfter: after,
    repaired: after !== null && after.passed >= Math.ceil(0.9 * after.of),
    mentorUsd: experiment.costs.mentorUsd,
    minutes: experiment.costs.wallSeconds / 60,
    error: experiment.error ?? null,
  };
  rows.push(row);
  process.stdout.write(
    `${row.status} ${row.verdict} sealed ${before?.passed}/${before?.of} -> ${after?.passed ?? '-'}/${after?.of ?? '-'} $${row.mentorUsd.toFixed(2)}\n`,
  );
  writeFileSync(join(root, 'bench.json'), JSON.stringify({ rows, spent }, null, 2));
}

const tried = rows.filter((row) => row['experiment'] !== undefined);
const repaired = tried.filter((row) => row['repaired'] === true).length;
const interval = wilson(repaired, tried.length);
const summary = {
  mentor: astra ? 'GPT-6 Astra' : 'Stand-in mentor (scripted)',
  task: bench.task,
  healthyAccuracy: bench.healthy_accuracy,
  tried: tried.length,
  repaired,
  repairRate: tried.length === 0 ? null : repaired / tried.length,
  wilson95: interval,
  foundTheTensor: tried.filter((row) => row['foundTheTensor'] === true).length,
  spentUsd: spent,
  rows,
};
writeFileSync(join(root, 'bench.json'), JSON.stringify(summary, null, 2));
process.stdout.write(`${JSON.stringify({ ...summary, rows: undefined }, null, 2)}\n`);
