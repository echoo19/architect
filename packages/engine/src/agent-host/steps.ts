import type { AgentStep, Harness, JsonValue, Skill, ToolCall, TraceStep } from '@architect/shared';

/** A step before the message gives it an id. */
export type NewStep = Omit<AgentStep, 'id'>;
type ToolTrace = Extract<TraceStep, { kind: 'tool' }>;
type JsonObject = { [key: string]: JsonValue };

const DETAIL_CHARS = 80;
const META_CHARS = 60;
/** Built-in reads whose result comes back as text only when it was too long and got cut. */
const READS = new Set(['list_files', 'read_table', 'read_text']);

/** A tool call that has started: the tool, or the skill a `load_skill` call asks for. */
export function startedStep(call: ToolCall, harness: Harness): NewStep {
  const requested = call.arguments.name;
  if (call.name === 'load_skill' && typeof requested === 'string') {
    const skill = findSkill(harness, requested);
    return {
      kind: 'skill',
      name: skill?.slug ?? requested,
      detail: skill?.name ?? requested,
      status: 'running',
    };
  }
  return {
    kind: 'tool',
    name: call.name,
    detail: describeCall(call.name, call.arguments),
    status: 'running',
  };
}

/** The same step once its call has returned. */
export function finishedStep(step: NewStep, result: ToolTrace): NewStep {
  return {
    ...step,
    status: result.error === undefined ? 'done' : 'error',
    meta:
      result.error === undefined
        ? describeResult(result.name, result.result)
        : clip(result.error.split('\n')[0] ?? '', META_CHARS),
    ms: result.latencyMs,
  };
}

/** A skill a retrieval rule loaded for the request before the model ran. */
export function ruleSkillStep(slug: string, harness: Harness): NewStep {
  const skill = harness.skills.find((candidate) => candidate.slug === slug);
  return { kind: 'skill', name: slug, detail: skill?.name ?? slug, meta: 'loaded', status: 'done' };
}

/** What a call acts on, e.g. `invoices.csv` or `invoices.csv, status = open`. */
export function describeCall(name: string, args: Record<string, JsonValue>): string {
  return clip(actedOn(name, args), DETAIL_CHARS);
}

function actedOn(name: string, args: Record<string, JsonValue>): string {
  switch (name) {
    case 'list_files':
      return 'the data files';
    case 'read_table':
    case 'update_rows':
      return [format(args.file), ...conditions(args.where)].join(', ');
    case 'read_text':
    case 'append_rows':
      return format(args.file);
    case 'calculate':
      return format(args.expression);
    default:
      return fields(args);
  }
}

/** A short result, e.g. `412 rows`, `1 row added` or `declined`. */
export function describeResult(name: string, result: JsonValue | null): string {
  if (result === null) return '';
  if (typeof result === 'string' && READS.has(name)) return 'cut to fit';
  const value = isObject(result) ? result : undefined;
  const declined = value?.declined === true;
  switch (name) {
    case 'list_files':
      if (Array.isArray(value?.files)) return count(value.files.length, 'file');
      break;
    case 'read_table':
      if (typeof value?.total === 'number') return count(value.total, 'row');
      break;
    case 'read_text':
      if (typeof value?.text === 'string') {
        const lines = count(value.text.split('\n').length, 'line');
        return value.next_offset === undefined ? lines : `${lines}, more to read`;
      }
      break;
    case 'calculate':
      if (value?.result !== undefined) return clip(`= ${format(value.result)}`, META_CHARS);
      break;
    case 'append_rows':
      if (declined) return 'declined';
      if (typeof value?.appended === 'number') return `${count(value.appended, 'row')} added`;
      break;
    case 'update_rows':
      if (declined) return 'declined';
      if (typeof value?.changed === 'number') {
        return value.changed > 0 ? `${count(value.changed, 'row')} changed` : 'no change';
      }
      break;
    case 'load_skill':
      return 'loaded';
  }
  return clip(summarize(result), META_CHARS);
}

function findSkill(harness: Harness, requested: string): Skill | undefined {
  const wanted = requested.trim().toLowerCase();
  return (
    harness.skills.find((skill) => skill.slug === wanted) ??
    harness.skills.find((skill) => skill.name.trim().toLowerCase() === wanted)
  );
}

/** `where` conditions as people write them: `status = open`, `id in [A, B]`. */
function conditions(where: JsonValue | undefined): string[] {
  const list = Array.isArray(where) ? where : where === undefined ? [] : [where];
  return list.map((clause) =>
    isObject(clause)
      ? [clause.column, clause.op, clause.value].map(format).join(' ')
      : format(clause),
  );
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

function count(n: number, noun: string): string {
  return `${n.toLocaleString('en-US')} ${noun}${n === 1 ? '' : 's'}`;
}

function clip(text: string, limit: number): string {
  return text.length > limit ? `${text.slice(0, limit - 1)}…` : text;
}
