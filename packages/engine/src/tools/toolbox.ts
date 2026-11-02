import {
  BUILTIN_TOOL_NAMES,
  isBuiltinTool,
  isWriteTool,
  type BuiltinToolName,
  type Harness,
  type HarnessTool,
  type JsonValue,
  type TableView,
  type ToolCall,
  type ToolSpec,
  type WriteRecord,
} from '@architect/shared';
import type { AgentFiles } from '../files/agent-files';
import type { Sandbox } from '../sandbox/types';
import { builtinExecutors, type ApproveWrite, type ExecutorResult } from './builtins';
import { isToolFailure, ToolError } from './errors';
import { DEFAULT_RESULT_BUDGET, MIN_RESULT_BUDGET, renderError, renderResult } from './results';
import { BUILTIN_TOOL_SPECS } from './specs';

export interface ToolOutcome {
  /** The result as the model saw it, or null when the call failed. */
  result: JsonValue | null;
  error?: string;
  /** The tool message content sent back to the model. */
  content: string;
  /** The name of the skill the call read. */
  loadedSkill?: string;
  /** The change a write tool made or asked for. */
  change?: WriteRecord;
  /** The rows a read of a table showed. */
  table?: TableView;
}

/** The tools one agent run offers, bound to that run's files, harness and sandbox. */
export interface Toolbox {
  readonly specs: readonly ToolSpec[];
  /** Runs one call. Mistakes come back as error outcomes; only bugs throw. */
  run(call: ToolCall, signal?: AbortSignal): Promise<ToolOutcome>;
  /** Helpers' results too long to show, by the path `run` code reads each one at. */
  kept(): Record<string, string>;
}

export interface ToolboxOptions {
  harness: Harness;
  files: AgentFiles;
  sandbox: Sandbox;
  /** The working date, YYYY-MM-DD, which `run` code sees as `today`. */
  today: string;
  approveWrite?: ApproveWrite;
  /** Characters a result may take; longer results are cut with a note. */
  resultBudget?: number;
  /** Helpers' results kept whole earlier in the attempt, for a run that continues it. */
  kept?: Readonly<Record<string, string>>;
  /**
   * Tools this run offers besides the built-in and harness ones, such as `ask_teammate` in a
   * team reply (decision 100). None may share a name with another tool.
   */
  extraTools?: readonly ExtraTool[];
  /**
   * Why every write tool fails at once, before its arguments are read: a teammate's run in a
   * consult (decision 107). Nothing is planned, asked or written.
   */
  refuseWrites?: string;
}

/** A tool the runner offers one run on its own terms, outside the harness and the sandbox. */
export interface ExtraTool {
  spec: ToolSpec;
  /** One line the system prompt adds while this tool is offered, on when to use it. */
  instruction?: string;
  /** Runs one call. Mistakes the model can fix throw a `ToolError`. */
  run(call: ToolCall, signal?: AbortSignal): Promise<ExecutorResult>;
}

/** What the table tools of the first runtime are called now, for harnesses written for them. */
const RENAMED: Readonly<Record<string, string>> = {
  list_files: 'ls',
  read_table: 'read, grep or run',
  read_text: 'read',
  calculate: 'run',
  append_rows: 'append',
  update_rows: 'edit',
  load_skill: 'read on skills/<name>/SKILL.md',
};

function offeredBuiltins(writable: boolean): BuiltinToolName[] {
  return BUILTIN_TOOL_NAMES.filter((name) => !isWriteTool(name) || writable);
}

/**
 * The tools a run on this harness offers, as the model sees them: the built-in ones (the write
 * tools only when some file may change) and the harness's own, without a run's extra tools.
 */
export function toolSpecs(harness: Harness, writable: boolean): ToolSpec[] {
  return [
    ...offeredBuiltins(writable).map((name) => BUILTIN_TOOL_SPECS[name]),
    ...harness.tools.map((tool) => ({
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters,
    })),
  ];
}

export function createToolbox(options: ToolboxOptions): Toolbox {
  const { harness, files, sandbox } = options;
  const budget = options.resultBudget ?? DEFAULT_RESULT_BUDGET;
  if (!Number.isInteger(budget) || budget < MIN_RESULT_BUDGET) {
    throw new Error(`resultBudget must be a whole number of at least ${MIN_RESULT_BUDGET}.`);
  }
  const clash = harness.tools.find((tool) => isBuiltinTool(tool.name));
  if (clash) throw new Error(`The harness tool ${clash.name} has the name of a built-in tool.`);
  const extra = new Map((options.extraTools ?? []).map((tool) => [tool.spec.name, tool]));
  for (const name of extra.keys()) {
    if (isBuiltinTool(name) || harness.tools.some((tool) => tool.name === name)) {
      throw new Error(`The tool ${name} has the name of another tool this run offers.`);
    }
  }

  // A harness tool can't be asked for less, so a result too long to show is kept whole for
  // `read` and `run` code, which can page it or pick out what it needs, until a later call of
  // that tool fits.
  const kept: Record<string, string> = { ...options.kept };
  const builtins = builtinExecutors({
    files,
    sandbox,
    today: options.today,
    approveWrite: options.approveWrite,
    budget,
    kept: () => kept,
  });
  const offered = offeredBuiltins(files.writable);
  const harnessTools = new Map(harness.tools.map((tool) => [tool.name, tool]));
  const specs: ToolSpec[] = [
    ...toolSpecs(harness, files.writable),
    ...[...extra.values()].map((tool) => tool.spec),
  ];

  async function runHarnessTool(
    tool: HarnessTool,
    args: Record<string, JsonValue>,
  ): Promise<ExecutorResult> {
    const missing = requiredKeys(tool).filter((key) => !Object.hasOwn(args, key));
    if (missing.length > 0) {
      throw new ToolError(`${tool.name} needs these arguments: ${missing.join(', ')}.`);
    }
    const outcome = await sandbox.runTool(tool, args, files.sandboxData());
    if (!outcome.ok) throw new ToolError(`${tool.name} failed: ${outcome.failure.message}`);
    return { value: outcome.value };
  }

  async function execute(call: ToolCall, signal?: AbortSignal): Promise<ExecutorResult> {
    if (options.refuseWrites !== undefined && isWriteTool(call.name)) {
      throw new ToolError(options.refuseWrites);
    }
    if (isBuiltinTool(call.name) && (offered as readonly BuiltinToolName[]).includes(call.name)) {
      return builtins[call.name](call.arguments, signal);
    }
    const offeredExtra = extra.get(call.name);
    if (offeredExtra) return offeredExtra.run(call, signal);
    const tool = harnessTools.get(call.name);
    if (tool) return runHarnessTool(tool, call.arguments);
    const names = specs.map((spec) => spec.name).join(', ');
    const renamed = RENAMED[call.name];
    const instead = renamed === undefined ? '' : ` Use ${renamed} instead.`;
    throw new ToolError(
      `There is no tool called "${call.name}".${instead} The tools are: ${names}.`,
    );
  }

  function render(name: string, value: JsonValue) {
    if (!harnessTools.has(name)) return renderResult(value, budget);
    const path = keptResultPath(name);
    if ((typeof value === 'string' ? value : JSON.stringify(value)).length <= budget) {
      delete kept[path];
      return renderResult(value, budget);
    }
    kept[path] = pagedJson(value);
    return renderResult(
      value,
      budget,
      `read ${path} shows it whole, a page at a time, and run code has it as JSON.parse(files.read("${path}"))`,
    );
  }

  return {
    specs,
    kept: () => ({ ...kept }),
    async run(call, signal) {
      try {
        const { value, ...extra } = await execute(call, signal);
        return { ...render(call.name, value), ...extra };
      } catch (error) {
        if (!isToolFailure(error)) throw error;
        const rendered = renderError(error.message);
        return { result: null, error: rendered.error, content: rendered.content };
      }
    },
  };
}

/** Where `read` and `run` code find a harness tool's latest result that was too long to show. */
export function keptResultPath(tool: string): string {
  return `results/${tool}.json`;
}

/**
 * JSON with each entry of the top level, and of any object or array in it, on a line of its
 * own, so `read` can page it by lines; anything deeper stays on its entry's line.
 */
function pagedJson(value: JsonValue, depth = 0): string {
  if (depth === 2 || value === null || typeof value !== 'object') return JSON.stringify(value);
  const entries = Array.isArray(value)
    ? value.map((item) => pagedJson(item, depth + 1))
    : Object.entries(value).map(
        ([key, item]) => `${JSON.stringify(key)}: ${pagedJson(item ?? null, depth + 1)}`,
      );
  const [open, close] = Array.isArray(value) ? ['[', ']'] : ['{', '}'];
  if (entries.length === 0) return `${open}${close}`;
  const pad = ' '.repeat(depth + 1);
  const body = entries.map((entry) => `${pad}${entry}`).join(',\n');
  return `${open}\n${body}\n${' '.repeat(depth)}${close}`;
}

function requiredKeys(tool: HarnessTool): string[] {
  const required = tool.parameters.required;
  return Array.isArray(required)
    ? required.filter((key): key is string => typeof key === 'string')
    : [];
}
