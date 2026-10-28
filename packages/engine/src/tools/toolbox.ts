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

export function createToolbox(options: ToolboxOptions): Toolbox {
  const { harness, files, sandbox } = options;
  const budget = options.resultBudget ?? DEFAULT_RESULT_BUDGET;
  if (!Number.isInteger(budget) || budget < MIN_RESULT_BUDGET) {
    throw new Error(`resultBudget must be a whole number of at least ${MIN_RESULT_BUDGET}.`);
  }
  const clash = harness.tools.find((tool) => isBuiltinTool(tool.name));
  if (clash) throw new Error(`The harness tool ${clash.name} has the name of a built-in tool.`);

  const builtins = builtinExecutors({
    files,
    sandbox,
    today: options.today,
    approveWrite: options.approveWrite,
    budget,
  });
  const offered = BUILTIN_TOOL_NAMES.filter((name) => !isWriteTool(name) || files.writable);
  const harnessTools = new Map(harness.tools.map((tool) => [tool.name, tool]));
  const specs: ToolSpec[] = [
    ...offered.map((name) => BUILTIN_TOOL_SPECS[name]),
    ...harness.tools.map((tool) => ({
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters,
    })),
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
    if (isBuiltinTool(call.name) && (offered as readonly BuiltinToolName[]).includes(call.name)) {
      return builtins[call.name](call.arguments, signal);
    }
    const tool = harnessTools.get(call.name);
    if (tool) return runHarnessTool(tool, call.arguments);
    const names = specs.map((spec) => spec.name).join(', ');
    const renamed = RENAMED[call.name];
    const instead = renamed === undefined ? '' : ` Use ${renamed} instead.`;
    throw new ToolError(
      `There is no tool called "${call.name}".${instead} The tools are: ${names}.`,
    );
  }

  return {
    specs,
    async run(call, signal) {
      try {
        const { value, ...extra } = await execute(call, signal);
        return { ...renderResult(value, budget), ...extra };
      } catch (error) {
        if (!isToolFailure(error)) throw error;
        const rendered = renderError(error.message);
        return { result: null, error: rendered.error, content: rendered.content };
      }
    },
  };
}

function requiredKeys(tool: HarnessTool): string[] {
  const required = tool.parameters.required;
  return Array.isArray(required)
    ? required.filter((key): key is string => typeof key === 'string')
    : [];
}
