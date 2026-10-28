import type {
  AgentStep,
  CellValue,
  GraduateManifest,
  PermissionMode,
  TaskTypeInfo,
  WorkspaceMessage,
} from '@architect/shared';

/** The composer's write choices, in the order its menu lists them. */
export const WRITE_MODES = ['ask', 'allow', 'never'] as const satisfies readonly PermissionMode[];

/** The three answers to "Saving changes to your files", in the same words on every screen. */
export const WRITE_MODE_LABELS: Record<PermissionMode, string> = {
  ask: 'Ask first',
  allow: 'Allow',
  never: 'Never',
};

/** What each write choice means, in one line. */
export const WRITE_MODE_MEANINGS: Record<PermissionMode, string> = {
  ask: 'Shows each change and waits for your OK',
  allow: 'Saves without asking; each change still shows in the chat',
  never: "Can't change your files",
};

/** The built-in tools, said the way a person would: while working, and once done. */
const TOOL_WORDS: Record<string, [string, string]> = {
  list_files: ['Listing', 'Listed'],
  read_table: ['Reading', 'Read'],
  read_text: ['Reading', 'Read'],
  append_rows: ['Adding rows to', 'Added rows to'],
  update_rows: ['Updating', 'Updated'],
  calculate: ['Calculating', 'Calculated'],
};

/**
 * A step in plain words: "Read jobs.csv", "Loaded the skill price-a-job", or "Ran the tool
 * invoice_total" for a tool written during training, with what it acted on.
 */
export function stepWords(step: AgentStep): { action: string; target: string } {
  const working = step.status === 'running';
  if (step.kind === 'skill') {
    return { action: working ? 'Loading the skill' : 'Loaded the skill', target: step.detail };
  }
  const words = TOOL_WORDS[step.name];
  if (words) return { action: working ? words[0] : words[1], target: step.detail };
  return { action: `${working ? 'Running' : 'Ran'} the tool ${step.name}`, target: step.detail };
}

/** "1 step", "3 steps". */
export function stepCount(count: number): string {
  return count === 1 ? '1 step' : `${count} steps`;
}

/** "Worked for 3s", "Worked for 1m 12s", or the step count when no time was recorded. */
export function workedLabel(message: WorkspaceMessage): string {
  const timed = message.steps.filter((step) => step.ms !== undefined);
  const ms =
    message.workedMs ??
    (timed.length > 0 ? timed.reduce((sum, step) => sum + (step.ms ?? 0), 0) : undefined);
  if (ms === undefined) return stepCount(message.steps.length);
  const seconds = Math.max(1, Math.round(ms / 1000));
  if (seconds < 60) return `Worked for ${seconds} s`;
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  return rest === 0 ? `Worked for ${minutes} min` : `Worked for ${minutes} min ${rest} s`;
}

/** The step to name while the agent works: the one running, else the latest. */
export function currentStep(steps: AgentStep[]): AgentStep | undefined {
  return steps.find((step) => step.status === 'running') ?? steps.at(-1);
}

/** What a table cell shows. */
export function cellText(value: CellValue): string {
  if (value === null) return '';
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  return String(value);
}

/** A row that sums the others, such as "Total" or "Grand total", which tables set in bold. */
export function isTotalRow(row: readonly CellValue[]): boolean {
  const first = row[0];
  return typeof first === 'string' && /^(grand\s+)?totals?$/i.test(first.trim());
}

/**
 * The rows a chat table shows before "Show all": the first few, and a closing total row, which
 * stays in view because it is the row people look for.
 */
export function previewRows<Row extends readonly CellValue[]>(
  rows: readonly Row[],
  limit: number,
): Row[] {
  const last = rows.at(-1);
  if (rows.length <= limit || !last) return [...rows];
  return isTotalRow(last) ? [...rows.slice(0, limit - 1), last] : rows.slice(0, limit);
}

/** "invoices, overdue balances or scheduling": labels joined the way a sentence lists them. */
export function listInSentence(labels: readonly string[], last = 'or'): string {
  const words = labels.map(inSentence);
  if (words.length <= 1) return words.join('');
  return `${words.slice(0, -1).join(', ')} ${last} ${words.at(-1)}`;
}

/**
 * Up to three things to ask, from the task types the agent passed its test on: each type's
 * description from the job when it has one, since it reads as a request, else its label.
 */
export function suggestionsFor(
  manifest: GraduateManifest,
  taskTypes: readonly TaskTypeInfo[] = [],
  limit = 3,
): string[] {
  const asks = manifest.test.perType
    .filter((type) => !type.refused)
    .map((type) => taskTypes.find((info) => info.id === type.type)?.description ?? type.label);
  return [...new Set(asks)].slice(0, limit);
}

/** A label as it reads mid-sentence: "Overdue balances" → "overdue balances", "VAT" stays. */
export function inSentence(label: string): string {
  const firstWord = label.split(/\s/, 1)[0] ?? '';
  if (/^[A-Z0-9]{2,}$/.test(firstWord)) return label;
  return label.charAt(0).toLowerCase() + label.slice(1);
}

/** A task type's name for people: its report-card label, else the id made readable. */
export function taskTypeLabel(manifest: GraduateManifest, taskType: string): string {
  const known = manifest.test.perType.find((type) => type.type === taskType)?.label;
  if (known) return known;
  const words = taskType.replace(/[_-]+/g, ' ').trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
}
