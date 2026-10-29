/**
 * One drafting conversation, headless, with a real teacher: the same conversation the Describe
 * screen holds (decision 058), printed turn by turn, then the drafted job. A developer tool; it is
 * not part of the app and never runs in CI.
 *
 *   pnpm --filter @architect/engine exec tsx scripts/draft.ts "<description>" <file>...
 *     [--answer "<text>"]... [--data <dir>] [--mentor meta-spark] [--confirm-rules]
 *
 * Each question is answered with the next --answer, or with its first option when none is left.
 * The drafted job stays in --data (a new folder when absent), ready for scripts/run.ts or the app.
 * A rule is printed with its passages and examples; --confirm-rules is the person saying they read
 * it and it is right, which training waits for.
 * Keys come from the environment, as for scripts/run.ts: META_API_TOKEN for Spark.
 */
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import {
  mentorPreset,
  passageSource,
  type MentorConfig,
  type MentorPresetKey,
} from '@architect/shared';
import { createEngineDeps, createEngineHost } from '../src';

const SECRET_ENV: Record<string, string> = {
  meta: 'META_API_TOKEN',
  openrouter: 'OPENROUTER_API_KEY',
  together: 'TOGETHER_API_KEY',
  deepinfra: 'DEEPINFRA_API_KEY',
};

/** Questions answered before the script asks for the draft itself, as "Draft it now" does. */
const MAX_TURNS = 4;

function write(text: string): void {
  process.stdout.write(text);
}

function teacherOf(key: MentorPresetKey): MentorConfig {
  const preset = mentorPreset(key);
  return {
    kind: 'model',
    provider: preset.provider,
    label: preset.label,
    baseUrl: preset.baseUrl,
    model: preset.model,
    reasoningEffort: 'medium',
    secretRef: preset.secretRef,
  } as MentorConfig;
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const answers: string[] = [];
  const positional: string[] = [];
  let dataArg: string | undefined;
  let mentorKey = 'meta-spark';
  let confirmRules = false;
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i] ?? '';
    if (arg === '--answer') answers.push(args[++i] ?? '');
    else if (arg === '--data') dataArg = args[++i];
    else if (arg === '--mentor') mentorKey = args[++i] ?? mentorKey;
    else if (arg === '--confirm-rules') confirmRules = true;
    else positional.push(arg);
  }
  const [description, ...files] = positional;
  if (!description || files.length === 0) {
    write('Usage: tsx scripts/draft.ts "<description>" <file>... [--answer "<text>"]...\n');
    process.exitCode = 2;
    return;
  }
  const dataDir = dataArg ? resolve(dataArg) : await mkdtemp(join(tmpdir(), 'architect-draft-'));
  const host = await createEngineHost({
    dataDir,
    deps: createEngineDeps({
      dataDir,
      getSecret: async (ref) => {
        const name = SECRET_ENV[ref];
        return name === undefined ? undefined : process.env[name] || undefined;
      },
    }),
  });
  const teacher = teacherOf(mentorKey as MentorPresetKey);
  try {
    let turn = await host.api.jobs.draftStart(
      description,
      files.map((file) => resolve(file)),
      teacher,
    );
    for (let turns = 0; ; turns += 1) {
      write(`\n${teacher.kind === 'model' ? teacher.label : 'Teacher'}: ${turn.message}\n`);
      if (turn.options.length > 0) write(`  options: ${turn.options.join(' | ')}\n`);
      if (turn.draft !== undefined || turn.ended === true) break;
      const answer =
        turns + 1 >= MAX_TURNS
          ? 'Draft it now'
          : (answers.shift() ??
            turn.options.find((option) => option !== 'Draft it now') ??
            'Draft it now');
      write(`You: ${answer}\n`);
      turn = await host.api.jobs.draftReply(turn.sessionId, answer, teacher);
    }
    const job = turn.draft;
    if (job === undefined) return;
    write(`\nDrafted "${job.name}" (${job.id}): ${job.description}\n`);
    for (const line of job.does) write(`  does: ${line}\n`);
    for (const line of job.doesNot) write(`  won't: ${line}\n`);
    for (const file of job.data.files) write(`  file: ${file.name} (${file.access})\n`);
    const drafting = JSON.parse(
      await readFile(join(dataDir, 'jobs', job.id, 'drafting.json'), 'utf8'),
    ) as unknown;
    write(`\ndrafting.json:\n${JSON.stringify(drafting, null, 2)}\n`);

    // A rule is read before it is trained on, as it is on the Define screen (decision 061).
    const plan = await host.api.jobs.taskPlan(job.id);
    for (const type of plan.types) {
      const { details } = type;
      if (details === undefined) continue;
      write(`\nRule "${type.label}", version ${details.version}:\n${details.statement}\n`);
      for (const passage of details.passages) {
        write(`  from ${passageSource(passage.file)}: ${passage.passage}\n`);
      }
      for (const example of details.examples) {
        write(`\n  ${example.request}  ->  ${example.answer}\n`);
        for (const covered of example.covers) write(`    shows: ${covered}\n`);
        for (const step of example.steps) write(`    ${step.text}: ${step.value}\n`);
      }
      for (const note of [...details.flags, ...details.uncovered]) write(`  note: ${note}\n`);
      for (const left of details.excluded) {
        write(
          `  left out: ${left.count} rows, ${left.reason} (for example ${left.example ?? ''})\n`,
        );
      }
    }
    if (plan.confirmation?.state === 'needed') {
      if (confirmRules) {
        await host.api.jobs.confirmRules(job.id, plan.confirmation.token);
        write('\nConfirmed the rule over these records, because --confirm-rules was given.\n');
      } else {
        write(
          '\nThe rule is not confirmed, so training will not start. Read it above, then confirm it in the app,\n' +
            'or train with scripts/run.ts --job <id> --confirm-rules.\n',
        );
      }
    }
    write(`\nData folder: ${dataDir}\n`);
  } finally {
    await host.close();
  }
}

await main();
