import type {
  AgentStep,
  CellValue,
  GraduateManifest,
  PermissionMode,
  WorkspaceMessage,
} from '@architect/shared';

/** The order the composer's write button steps through. */
export const WRITE_MODES = ['ask', 'allow', 'never'] as const satisfies readonly PermissionMode[];

export const WRITE_MODE_LABELS: Record<PermissionMode, string> = {
  ask: 'Ask before writing',
  allow: 'Writes allowed',
  never: 'Read only',
};

export function nextWriteMode(mode: PermissionMode): PermissionMode {
  return WRITE_MODES[(WRITE_MODES.indexOf(mode) + 1) % WRITE_MODES.length]!;
}

/** "Worked for 3s", "Worked for 1m 12s", or the step count when no time was recorded. */
export function workedLabel(message: WorkspaceMessage): string {
  const timed = message.steps.filter((step) => step.ms !== undefined);
  const ms =
    message.workedMs ??
    (timed.length > 0 ? timed.reduce((sum, step) => sum + (step.ms ?? 0), 0) : undefined);
  if (ms === undefined) {
    return message.steps.length === 1 ? '1 step' : `${message.steps.length} steps`;
  }
  const seconds = Math.max(1, Math.round(ms / 1000));
  if (seconds < 60) return `Worked for ${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  return rest === 0 ? `Worked for ${minutes}m` : `Worked for ${minutes}m ${rest}s`;
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

/** Up to three things to ask, from the task types the agent passed its test on. */
export function suggestionsFor(manifest: GraduateManifest, limit = 3): string[] {
  const labels = manifest.test.perType.filter((type) => !type.refused).map((type) => type.label);
  return [...new Set(labels)].slice(0, limit);
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
