import { useEffect, useId, useState, type ReactNode } from 'react';
import { Collapse, Input } from '@architect/ui';

export interface NumberRowProps {
  label: string;
  /** Absent when the setting is left to the runner's own value. */
  value: number | undefined;
  onChange: (value: number | undefined) => void;
  /** What the number is in, at the row's right: "USD", "h", "Seed". None where the label says. */
  unit?: ReactNode;
  /** Empty means the runner's own value, which the placeholder names. */
  optional?: boolean;
  placeholder?: string;
  integer?: boolean;
  min?: number;
  max?: number;
  /**
   * Told, by the row's own id, what is wrong with what is typed, and null once it is fixed or the
   * row is gone, so the screen can hold what would act on the value it still has.
   */
  onProblem?: (row: string, problem: string | null) => void;
}

const figure = (value: number) => value.toLocaleString('en-US');

/** What is wrong with a typed value, or null when it is a number the row takes. */
export function numberProblem(
  raw: string,
  {
    optional = false,
    integer = false,
    min = 0,
    max,
  }: Omit<NumberRowProps, 'label' | 'value' | 'onChange'>,
): string | null {
  if (raw.trim() === '') return optional ? null : 'Enter a number';
  const number = Number(raw);
  if (!Number.isFinite(number)) return 'Enter a number';
  if (integer && !Number.isInteger(number)) return 'Use a whole number';
  if (number < min) return min === 0 ? "Can't be negative" : `At least ${figure(min)}`;
  if (max !== undefined && number > max) return `At most ${figure(max)}`;
  return null;
}

/**
 * A number setting as an inspector row: its label at the left, the field and its unit at the
 * right. A value outside its range stays in the field, marked, with what is wrong under it, and is
 * not sent.
 */
export function NumberRow({ label, value, onChange, unit, onProblem, ...range }: NumberRowProps) {
  const id = useId();
  const [text, setText] = useState(value === undefined ? '' : String(value));
  const problem = numberProblem(text, range);
  useEffect(() => {
    onProblem?.(id, problem);
  }, [onProblem, id, problem]);
  useEffect(() => () => onProblem?.(id, null), [onProblem, id]);
  return (
    <div className="flex flex-col">
      <div className="flex min-h-11 items-center gap-3 text-ui">
        <label htmlFor={id} className="min-w-0 flex-1 truncate font-medium">
          {label}
        </label>
        <Input
          id={id}
          inputMode={range.integer ? 'numeric' : 'decimal'}
          aria-invalid={problem !== null || undefined}
          aria-describedby={problem === null ? undefined : `${id}-problem`}
          value={text}
          placeholder={range.placeholder}
          className="h-9 w-24 text-right tabular-nums"
          onChange={(event) => {
            const next = event.target.value;
            setText(next);
            if (numberProblem(next, range) !== null) return;
            onChange(next.trim() === '' ? undefined : Number(next));
          }}
        />
        {unit !== undefined && <span className="w-9 shrink-0 text-small">{unit}</span>}
      </div>
      <Collapse open={problem !== null}>
        {problem !== null && (
          <p
            id={`${id}-problem`}
            role="alert"
            className="m-0 pb-2 text-right text-small text-danger"
          >
            {problem}
          </p>
        )}
      </Collapse>
    </div>
  );
}
