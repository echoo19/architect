import { parseArgs, type ParseArgsConfig } from 'node:util';
import { CliError } from './exit';

type Options = NonNullable<ParseArgsConfig['options']>;

export type CommandName = 'list' | 'install' | 'run' | 'inspect' | 'verify' | 'export' | 'publish';

interface CommandSpec {
  usage: string;
  summary: string;
  /** How many arguments it takes besides its options. */
  args: number;
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
};

export function isCommand(name: string): name is CommandName {
  return Object.hasOwn(COMMANDS, name);
}

export function usage(): string {
  const width = 9;
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
  if (!help && parsed.positionals.length !== spec.args) {
    throw new CliError(
      'invalid_input',
      'usage',
      parsed.positionals.length < spec.args
        ? `architect ${name} needs ${spec.args === 1 ? 'an argument' : `${spec.args} arguments`}.`
        : `architect ${name} takes ${spec.args === 0 ? 'no arguments' : 'one argument'}.`,
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
