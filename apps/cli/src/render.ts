import type { AgentStep, InstallCheck, Installation } from '@architect/shared';
import type { Failure } from './exit';
import type { Output } from './io';

/** A size as people read it. */
export function bytes(count: number): string {
  if (count >= 1024 ** 3) return `${(count / 1024 ** 3).toFixed(1)} GB`;
  if (count >= 1024 ** 2) return `${(count / 1024 ** 2).toFixed(1)} MB`;
  if (count >= 1024) return `${Math.ceil(count / 1024)} KB`;
  return `${count} B`;
}

/** Rows as aligned columns, two spaces apart. */
export function table(rows: readonly (readonly string[])[]): string {
  const widths: number[] = [];
  for (const row of rows) {
    row.forEach((cell, index) => {
      widths[index] = Math.max(widths[index] ?? 0, cell.length);
    });
  }
  return rows
    .map((row) =>
      row
        .map((cell, index) => (index === row.length - 1 ? cell : cell.padEnd(widths[index] ?? 0)))
        .join('  ')
        .trimEnd(),
    )
    .join('\n');
}

export function line(out: Output, text = ''): void {
  out.write(`${text}\n`);
}

/** A failure on stderr: what happened, then what to do about it. */
export function sayFailure(out: Output, failure: Failure): void {
  line(out, failure.message);
  if (failure.hint) line(out, failure.hint);
}

/** A tool step as one line: `read data/invoices.csv (4 lines)`. */
export function stepLine(step: Pick<AgentStep, 'name' | 'detail' | 'meta' | 'status'>): string {
  const about = step.detail && step.detail !== step.name ? ` ${step.detail}` : '';
  const result = step.meta ? ` (${step.meta})` : '';
  const failed = step.status === 'error' ? ' failed' : '';
  return `  ${step.name}${about}${failed}${result}`;
}

function checkLine(check: InstallCheck): string {
  return `  ${check.status.padEnd(7)} ${check.detail}`;
}

/**
 * Installation checks as the app labels them, so they are never taken for the author's
 * evaluation: they say whether the agent runs here, not how well.
 */
export function installationLines(installation: Installation, name: string): string[] {
  const status = installation.status.replace('_', ' ');
  return [
    `${installation.label} for ${name}, version ${installation.version}: ${status}.`,
    ...installation.checks.map(checkLine),
    ...installation.reasons.map((reason) => `  ${reason}`),
    'These checks show whether it runs on this computer. They are not an evaluation of it; its',
    "author's results are under `architect inspect`.",
  ];
}

/** Renames object keys from camelCase to snake_case, for JSON written for scripts. */
export function snakeKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(snakeKeys);
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, inner]) => [
        key.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`),
        snakeKeys(inner),
      ]),
    );
  }
  return value;
}

/** A JSON document on stdout: one per command, with its format. */
export function printJson(out: Output, format: string, body: Record<string, unknown>): void {
  out.write(`${JSON.stringify({ format, ...(snakeKeys(body) as object) }, null, 2)}\n`);
}
