import type {
  AgentStep,
  Harness,
  JsonValue,
  StepView,
  ToolCall,
  TraceStep,
  WriteRecord,
} from '@architect/shared';
import { patchStats } from '../files/diff';

/** A step before the message gives it an id. */
export type NewStep = Omit<AgentStep, 'id'>;
type ToolTrace = Extract<TraceStep, { kind: 'tool' }>;
type JsonObject = { [key: string]: JsonValue };

const DETAIL_CHARS = 80;
const META_CHARS = 60;
const SKILL_FILE = /^\/?skills\/([^/]+)\/SKILL\.md$/;
/** Files code reads, as `files.read("data/orders.csv")` names them. */
const FILES_READ = /files\.read\(\s*(['"`])([^'"`]+)\1\s*\)/g;

/** A tool call that has started: the tool, or the skill a read of its SKILL.md opens. */
export function startedStep(call: ToolCall, harness: Harness): NewStep {
  const skill = skillRead(call, harness);
  if (skill !== undefined) {
    return { kind: 'skill', name: skill, detail: skill, status: 'running' };
  }
  return {
    kind: 'tool',
    name: call.name,
    detail: describeCall(call.name, call.arguments),
    status: 'running',
  };
}

/** The same step once its call has returned, with what it showed when there is more to see. */
export function finishedStep(step: NewStep, result: ToolTrace): NewStep {
  const view = stepView(result);
  return {
    ...step,
    status: result.error === undefined ? 'done' : 'error',
    meta:
      result.error === undefined
        ? describeResult(result.name, result.result, result.change)
        : clip(result.error.split('\n')[0] ?? '', META_CHARS),
    ms: result.latencyMs,
    ...(view === undefined ? {} : { view }),
  };
}

/** A skill a retrieval rule loaded for the request before the model ran. */
export function ruleSkillStep(name: string): NewStep {
  return { kind: 'skill', name, detail: name, meta: 'loaded', status: 'done' };
}

/** What a call acts on, e.g. `data/invoices.csv` or `/ORD-10042/ in data`. */
export function describeCall(name: string, args: Record<string, JsonValue>): string {
  return clip(actedOn(name, args), DETAIL_CHARS);
}

function actedOn(name: string, args: Record<string, JsonValue>): string {
  switch (name) {
    case 'read':
    case 'write':
    case 'edit':
    case 'append':
      return format(args.path);
    case 'ls':
      return args.path === undefined || args.path === '' ? 'your folders' : format(args.path);
    case 'glob':
      return format(args.pattern);
    case 'grep': {
      const where = args.path === undefined || args.path === '' ? '' : ` in ${format(args.path)}`;
      return `/${format(args.pattern)}/${where}`;
    }
    case 'run':
      return codeTarget(typeof args.code === 'string' ? args.code : '');
    default:
      return fields(args);
  }
}

/** The files code reads, or its first line when it reads none. */
function codeTarget(code: string): string {
  const read = [...new Set([...code.matchAll(FILES_READ)].map((match) => match[2] ?? ''))];
  if (read.length > 0) return read.join(', ');
  return code.trim().split('\n')[0] ?? '';
}

/** A short result, e.g. `596 lines`, `1 row added`, `3 matches` or `declined`. */
export function describeResult(
  name: string,
  result: JsonValue | null,
  change?: WriteRecord,
): string {
  if (change) return change.applied ? describeChange(change) : 'declined';
  if (typeof result !== 'string') return result === null ? '' : clip(summarize(result), META_CHARS);
  const lines = result.split('\n');
  switch (name) {
    case 'read': {
      const page = /^\[Lines (\d+)-(\d+) of (\d+)\./.exec(lines.at(-1) ?? '');
      if (page) return `lines ${page[1]}-${page[2]} of ${page[3]}`;
      if (/ is empty\.$/.test(result)) return 'empty';
      return count(lines.length, 'line');
    }
    case 'ls':
    case 'glob':
      if (result.startsWith('No files match')) return 'none';
      return count(
        lines.filter((line) => !line.startsWith('[')).length,
        name === 'ls' ? 'entry' : 'file',
        name === 'ls' ? 'entries' : 'files',
      );
    case 'grep': {
      if (result.startsWith('No lines match')) return 'no matches';
      const more = /^\[([\d,]+) matching lines?;/.exec(lines.at(-1) ?? '');
      return more ? `${more[1]} matches` : count(lines.length, 'match', 'matches');
    }
    case 'run':
      return clip(lines[0] ?? '', META_CHARS);
    default:
      return clip(result, META_CHARS);
  }
}

/** What a change did, e.g. `1 row added` or `3 lines added, 1 removed`. */
function describeChange(change: WriteRecord): string {
  if (change.rows) {
    const { added, changed, removed } = change.rows;
    const parts = [
      added.length > 0 && `${count(added.length, 'row')} added`,
      changed.length > 0 && `${count(changed.length, 'row')} changed`,
      removed.length > 0 && `${count(removed.length, 'row')} removed`,
    ].filter(Boolean);
    return parts.length > 0 ? parts.join(', ') : 'saved';
  }
  const { added, removed } = patchStats(change.patch);
  if (change.op === 'write' && change.patch.startsWith('--- /dev/null')) {
    return `created, ${count(added, 'line')}`;
  }
  // An append only adds lines; a "removed" line is the old last line gaining its line break.
  if (change.op === 'append') return `${count(added - removed, 'line')} added`;
  return removed === 0
    ? `${count(added, 'line')} added`
    : `${count(added, 'line')} added, ${removed} removed`;
}

/** The rows a table read showed, or the code `run` ran with its output. */
function stepView(result: ToolTrace): StepView | undefined {
  if (result.table && result.error === undefined) return { kind: 'table', ...result.table };
  if (result.name === 'run' && typeof result.arguments.code === 'string') {
    const output =
      result.error ??
      (typeof result.result === 'string' ? result.result : JSON.stringify(result.result));
    return { kind: 'code', code: result.arguments.code, output };
  }
  return undefined;
}

/** The skill a call reads, when it is a read of one of the harness's SKILL.md files. */
function skillRead(call: ToolCall, harness: Harness): string | undefined {
  if (call.name !== 'read' || typeof call.arguments.path !== 'string') return undefined;
  const name = SKILL_FILE.exec(call.arguments.path.trim())?.[1];
  return harness.skills.some((skill) => skill.name === name) ? name : undefined;
}

function fields(args: Record<string, JsonValue>): string {
  return Object.entries(args)
    .map(([key, value]) => `${key}: ${format(value)}`)
    .join(', ');
}

function summarize(value: JsonValue): string {
  if (Array.isArray(value)) return count(value.length, 'item');
  if (!isObject(value)) return format(value);
  const entries = Object.values(value);
  const flat =
    entries.length <= 3 && entries.every((entry) => !isObject(entry) && !Array.isArray(entry));
  return flat ? fields(value) : count(entries.length, 'field');
}

function format(value: JsonValue | undefined): string {
  if (value === undefined) return '';
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) return `[${value.map(format).join(', ')}]`;
  return isObject(value) ? JSON.stringify(value) : String(value);
}

function isObject(value: JsonValue | undefined): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function count(n: number, noun: string, plural = `${noun}s`): string {
  return `${n.toLocaleString('en-US')} ${n === 1 ? noun : plural}`;
}

function clip(text: string, limit: number): string {
  return text.length > limit ? `${text.slice(0, limit - 1)}…` : text;
}
