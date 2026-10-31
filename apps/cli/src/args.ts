import { parseArgs, type ParseArgsConfig } from 'node:util';
import { CliError } from './exit';

type Options = NonNullable<ParseArgsConfig['options']>;

export type CommandName =
  | 'list'
  | 'install'
  | 'run'
  | 'serve'
  | 'inspect'
  | 'verify'
  | 'export'
  | 'publish'
  | 'field'
  | 'experiment'
  | 'reward'
  | 'train'
  | 'certify';

interface CommandSpec {
  usage: string;
  summary: string;
  /** How many arguments it takes besides its options. */
  args: number;
  /** The most it takes, for a command whose last arguments depend on its action. */
  maxArgs?: number;
  options: Options;
  /** One line per option, for its help. */
  help: string[];
}

const json = { json: { type: 'boolean' } } as const satisfies Options;
const JSON_HELP = '  --json                  print the result as JSON';

export const COMMANDS: Readonly<Record<CommandName, CommandSpec>> = {
  list: {
    usage: 'architect list [--json]',
    summary: 'List the agents on this computer.',
    args: 0,
    options: { ...json },
    help: [JSON_HELP],
  },
  install: {
    usage: 'architect install <file.architect.zip | folder | hf://owner/name> [options]',
    summary: 'Install an agent from a package or a Hugging Face repository.',
    args: 1,
    options: {
      revision: { type: 'string' },
      bind: { type: 'string', multiple: true },
      grant: { type: 'string', multiple: true },
      writes: { type: 'string' },
      model: { type: 'string' },
      'model-url': { type: 'string' },
      runtime: { type: 'string' },
      'no-model-check': { type: 'boolean' },
      ...json,
    },
    help: [
      '  --revision <commit>     for hf://, the commit (or a branch or tag, looked up once)',
      '  --bind <name>=<folder>  bind one of its folders, such as data, to a folder here',
      '  --grant <name>=<access> grant read or read_write on one of its folders',
      '  --writes <mode>         ask (default), allow or never, for changes to files',
      '  --model <name>          the local model to run it on, if not its own base name',
      '  --model-url <url>       where that model is served on this computer',
      '  --runtime <name>        ollama (default) or openai_compatible',
      '  --no-model-check        skip the check that loads the model once',
      JSON_HELP,
    ],
  },
  run: {
    usage:
      'architect run <agent> [--input request.json] [--output result.json] [--non-interactive]',
    summary: 'Chat with an agent, or run one task from a JSON request.',
    args: 1,
    options: {
      input: { type: 'string' },
      output: { type: 'string' },
      'non-interactive': { type: 'boolean' },
      save: { type: 'boolean' },
      timeout: { type: 'string' },
    },
    help: [
      '  --input <file>          a JSON request (docs/CLI.md); - reads it from stdin',
      '  --output <file>         where the JSON result goes; stdout when absent',
      '  --non-interactive       never ask: a change that needs approval fails the run',
      '  --save                  keep the conversation in the app, as a chat',
      '  --timeout <seconds>     stop the run after this long',
    ],
  },
  serve: {
    usage: 'architect serve <agent> [--port N] [--version N] [--token-file <file>]',
    summary: 'Serve an agent to other apps on this computer, as a chat completions endpoint.',
    args: 1,
    options: {
      port: { type: 'string' },
      version: { type: 'string' },
      'token-file': { type: 'string' },
      host: { type: 'string' },
    },
    help: [
      '  --port <n>              the port on 127.0.0.1 (default 8420; 0 picks a free one)',
      '  --version <n>           serve only while this is the active version',
      '  --token-file <file>     the bearer token callers send, instead of a new one',
    ],
  },
  inspect: {
    usage: 'architect inspect <agent | file.architect.zip | folder> [--json]',
    summary: "Show an agent's versions, model, folders, permissions and evidence.",
    args: 1,
    options: { ...json },
    help: [JSON_HELP],
  },
  verify: {
    usage: 'architect verify <agent> [--no-model-check] [--json]',
    summary: 'Run the installation checks again on this computer.',
    args: 1,
    options: { 'no-model-check': { type: 'boolean' }, ...json },
    help: ['  --no-model-check        skip the check that loads the model once', JSON_HELP],
  },
  export: {
    usage: 'architect export <agent> --output <file.architect.zip> [options]',
    summary: 'Write a version as a package file.',
    args: 1,
    options: {
      output: { type: 'string' },
      version: { type: 'string' },
      include: { type: 'string', multiple: true },
      'accept-findings': { type: 'string' },
      ...json,
    },
    help: [
      '  --output <file>         the .architect.zip to write',
      '  --version <n>           a version other than the active one',
      '  --include resource:<n>  also share one of its folders, such as resource:data',
      '  --accept-findings <id>  go ahead despite the scan findings with this id',
      JSON_HELP,
    ],
  },
  publish: {
    usage: 'architect publish <agent> --repo owner/name [--private | --public] [options]',
    summary: 'Publish a version to a Hugging Face repository, private by default.',
    args: 1,
    options: {
      repo: { type: 'string' },
      private: { type: 'boolean' },
      public: { type: 'boolean' },
      version: { type: 'string' },
      include: { type: 'string', multiple: true },
      'accept-findings': { type: 'string' },
      'dry-run': { type: 'boolean' },
      ...json,
    },
    help: [
      '  --repo owner/name       the model repository to publish to',
      '  --private               make a new repository private (the default)',
      '  --public                make a new repository public',
      '  --version <n>           a version other than the active one',
      '  --include resource:<n>  also share one of its folders, such as resource:data',
      '  --accept-findings <id>  go ahead despite the scan findings with this id',
      '  --dry-run               show what would be sent, and send nothing',
      JSON_HELP,
    ],
  },
  field: {
    usage:
      'architect field list | status <field> | add-org <field> --folder <dir> --name <n> --never-seen | export <field> --out <folder> [--json]',
    summary: 'List fields, show one, add a never-seen organization to it, or export it.',
    args: 1,
    maxArgs: 2,
    options: {
      out: { type: 'string' },
      folder: { type: 'string' },
      name: { type: 'string' },
      'never-seen': { type: 'boolean' },
      generated: { type: 'boolean' },
      ...json,
    },
    help: [
      '  --folder <dir>          add-org: the folder with its records and tasks.jsonl',
      '  --name <name>           add-org: what to call the organization',
      '  --never-seen            add-org: confirm it is kept for the final test, never taught on',
      '  --generated             add-org: its records were generated; real by default',
      '  --out <folder>          export: the folder to write, new or empty',
      JSON_HELP,
    ],
  },
  experiment: {
    usage:
      'architect experiment plan <field> --arms a,b --hypothesis "..." --primary a-b:group [options] | preregister|start|resume|pause|stop|status|report <id> | list',
    summary: 'Plan, preregister, run and read an experiment on a field.',
    args: 1,
    maxArgs: 2,
    options: {
      name: { type: 'string' },
      arms: { type: 'string' },
      hypothesis: { type: 'string' },
      primary: { type: 'string' },
      seeds: { type: 'string' },
      'mentoring-seed': { type: 'string' },
      rounds: { type: 'string' },
      'student-usd': { type: 'string' },
      'spark-usd': { type: 'string' },
      'compute-usd': { type: 'string' },
      'wall-minutes': { type: 'string' },
      confirm: { type: 'boolean' },
      'confirm-study': { type: 'string' },
      'student-cap-usd': { type: 'string' },
      'drop-arm': { type: 'string', multiple: true },
      ...json,
    },
    help: [
      '  --name <name>           plan: a name for it (the field name by default)',
      '  --arms <a,b,...>        plan: the arms to compare, such as bare,draft,targeted',
      '  --hypothesis "<text>"   plan: what you expect and why, in your words',
      '  --primary <a-b:group>   plan: arm a less arm b, on all, seen (taught on) or unseen (never seen); all by default',
      '  --seeds <n,n,...>       plan: decoding seeds of the final test (101 by default)',
      '  --mentoring-seed <n>    plan: the mentoring seed (1 by default)',
      '  --rounds <n>            plan: refinement rounds at most (4 by default)',
      '  --student-usd <n>       plan: the most hosted Glimmer may cost (15 by default)',
      '  --spark-usd <n>         plan: the most Spark may cost (10 by default)',
      '  --compute-usd <n>       plan: the most training compute may cost (0 by default)',
      '  --wall-minutes <n>      plan: the longest it may run (720 by default)',
      '  --confirm               start, resume: go ahead with the arms the caps leave room for',
      '  --confirm-study <token> start, resume: confirm the brief you read, by its token',
      "  --student-cap-usd <n>   resume: raise Glimmer's cap, the answer to needs_funding",
      '  --drop-arm <arm>        resume: drop an arm, the other answer; repeat for more',
      JSON_HELP,
    ],
  },
  reward: {
    usage: 'architect reward score [--env <folder>]',
    summary: "Score attempts at a field's train tasks: JSON lines in on stdin, scores out.",
    args: 1,
    options: { env: { type: 'string' } },
    help: ["  --env <folder>          a field export's env folder; the current folder by default"],
  },
  train: {
    usage:
      'architect train plan --model owner/name [options] | architect train bundle --target slurm|kubernetes --model owner/name --output <folder> [options]',
    summary: 'Size a training job for a cluster, or write its launch bundle (experimental).',
    args: 1,
    options: {
      model: { type: 'string' },
      revision: { type: 'string' },
      config: { type: 'string' },
      method: { type: 'string' },
      precision: { type: 'string' },
      gpu: { type: 'string' },
      'gpu-memory': { type: 'string' },
      'gpus-per-node': { type: 'string' },
      'seq-len': { type: 'string' },
      'micro-batch': { type: 'string' },
      'lora-rank': { type: 'string' },
      target: { type: 'string' },
      export: { type: 'string' },
      output: { type: 'string' },
      ...json,
    },
    help: [
      '  --model owner/name      the model on Hugging Face; its config.json is read once',
      '  --revision <ref>        a branch, tag or commit (default main), resolved to a commit',
      '  --config <file>         size from a config.json on this computer instead of the Hub',
      '  --method <m>            lora (default), qlora or full',
      '  --precision <p>         bf16 (default), fp16 or fp32',
      '  --gpu <type>            h100-80gb (default), h200, a100-80gb, a100-40gb, l40s or b200',
      '  --gpu-memory <GB>       any other GPU, by its memory',
      '  --gpus-per-node <n>     GPUs in one node (default 8)',
      '  --seq-len <n>           tokens per example (default 4096)',
      '  --micro-batch <n>       examples per GPU per step (default 1)',
      '  --lora-rank <n>         the adapter rank (default 16)',
      '  --target <t>            bundle: slurm or kubernetes',
      '  --export <folder>       bundle: a field export, whose sft/*.jsonl become the data',
      '  --output <folder>       bundle: an empty or new folder to write it to',
      JSON_HELP,
    ],
  },
  certify: {
    usage:
      'architect certify <agent> --version <n> --job <job> [--k 5] [--epsilon 0.10] [--delta 0.05] [options]',
    summary: 'Certify a version after the fact, on tasks its run never saw.',
    args: 1,
    options: {
      version: { type: 'string' },
      job: { type: 'string' },
      k: { type: 'string' },
      epsilon: { type: 'string' },
      delta: { type: 'string' },
      'calibration-size': { type: 'string' },
      check: { type: 'string', multiple: true },
      student: { type: 'string' },
      'max-usd': { type: 'string' },
      'max-minutes': { type: 'string' },
      ...json,
    },
    help: [
      '  --version <n>           the frozen version to certify',
      '  --job <job>             the job whose taught organizations give the tasks',
      '  --k <n>                 attempts per task, 1 to 9 (default 5)',
      '  --epsilon <share>       the most it may be wrong when it answers (default 0.10)',
      '  --delta <share>         the chance the bound is wrong (default 0.05)',
      '  --calibration-size <n>  calibration tasks (default 60)',
      '  --check <org>           an organization to check the bound at; repeat for more',
      "  --student <preset>      a hosted Glimmer preset instead of this computer's model",
      '  --max-usd <dollars>     the most it may spend (default 0)',
      '  --max-minutes <n>       the longest it may take (default 1440)',
      JSON_HELP,
    ],
  },
};

export function isCommand(name: string): name is CommandName {
  return Object.hasOwn(COMMANDS, name);
}

export function usage(): string {
  const width = 12;
  return [
    'Usage: architect <command> [options]',
    '',
    'Commands:',
    ...Object.entries(COMMANDS).map(([name, spec]) => `  ${name.padEnd(width)}${spec.summary}`),
    '',
    'Run `architect <command> --help` for its options. Exit codes are in docs/CLI.md:',
    '0 done, 1 runtime error, 2 invalid input, 3 not permitted, 4 task failed, 130 cancelled.',
    '',
  ].join('\n');
}

export function commandUsage(name: CommandName): string {
  const spec = COMMANDS[name];
  return [`Usage: ${spec.usage}`, '', spec.summary, '', 'Options:', ...spec.help, ''].join('\n');
}

export type Values = Record<string, string | boolean | string[] | undefined>;

export interface Parsed {
  values: Values;
  args: string[];
  help: boolean;
}

/** A command's options and arguments, checked: an unknown option or a missing argument is refused. */
export function parseCommand(name: CommandName, argv: readonly string[]): Parsed {
  const spec = COMMANDS[name];
  let parsed;
  try {
    parsed = parseArgs({
      args: [...argv],
      options: { ...spec.options, help: { type: 'boolean', short: 'h' } },
      allowPositionals: true,
      strict: true,
    });
  } catch (error) {
    throw new CliError(
      'invalid_input',
      'usage',
      error instanceof Error ? error.message : String(error),
      `Usage: ${spec.usage}`,
    );
  }
  const help = parsed.values.help === true;
  const most = spec.maxArgs ?? spec.args;
  if (!help && (parsed.positionals.length < spec.args || parsed.positionals.length > most)) {
    throw new CliError(
      'invalid_input',
      'usage',
      parsed.positionals.length < spec.args
        ? `architect ${name} needs ${spec.args === 1 ? 'an argument' : `${spec.args} arguments`}.`
        : `architect ${name} takes ${most === 0 ? 'no arguments' : most === 1 ? 'one argument' : `at most ${most} arguments`}.`,
      `Usage: ${spec.usage}`,
    );
  }
  return { values: parsed.values, args: parsed.positionals, help };
}

export function stringOption(values: Values, name: string): string | undefined {
  const value = values[name];
  return typeof value === 'string' ? value : undefined;
}

export function listOption(values: Values, name: string): string[] {
  const value = values[name];
  return Array.isArray(value) ? value : [];
}

export function flag(values: Values, name: string): boolean {
  return values[name] === true;
}

/** A whole number at least 1, from an option. */
export function countOption(values: Values, name: string): number | undefined {
  const text = stringOption(values, name);
  if (text === undefined) return undefined;
  const number = Number(text);
  if (!Number.isSafeInteger(number) || number < 1) {
    throw new CliError('invalid_input', 'usage', `--${name} takes a whole number, not "${text}".`);
  }
  return number;
}

/** `name=value` pairs from a repeated option, such as `--bind data=./records`. */
export function pairs(values: Values, name: string): Record<string, string> {
  const result: Record<string, string> = {};
  for (const entry of listOption(values, name)) {
    const at = entry.indexOf('=');
    if (at <= 0 || at === entry.length - 1) {
      throw new CliError('invalid_input', 'usage', `--${name} takes name=value, not "${entry}".`);
    }
    result[entry.slice(0, at)] = entry.slice(at + 1);
  }
  return result;
}
