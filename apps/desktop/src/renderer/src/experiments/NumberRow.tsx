import { useId, useState, type ReactNode } from 'react';
import { Input } from '@architect/ui';

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
}

/**
 * A number setting as an inspector row: its label at the left, the field and its unit at the
 * right. A value outside its range stays in the field, marked, and is not sent.
 */
export function NumberRow({
  label,
  value,
  onChange,
  unit,
  optional = false,
  placeholder,
  integer = false,
  min = 0,
  max,
}: NumberRowProps) {
  const id = useId();
  const [text, setText] = useState(value === undefined ? '' : String(value));
  const accepts = (raw: string): { ok: boolean; number: number | undefined } => {
    const number = raw.trim() === '' ? undefined : Number(raw);
    if (number === undefined) return { ok: optional, number };
    const ok =
      Number.isFinite(number) &&
      number >= min &&
      (max === undefined || number <= max) &&
      (!integer || Number.isInteger(number));
    return { ok, number };
  };
  const valid = accepts(text).ok;
  return (
    <div className="flex min-h-11 items-center gap-3 text-ui">
      <label htmlFor={id} className="min-w-0 flex-1 truncate font-medium">
        {label}
      </label>
      <Input
        id={id}
        inputMode={integer ? 'numeric' : 'decimal'}
        aria-invalid={!valid || undefined}
        value={text}
        placeholder={placeholder}
        className="h-9 w-24 text-right tabular-nums"
        onChange={(event) => {
          const next = event.target.value;
          setText(next);
          const { ok, number } = accepts(next);
          if (ok) onChange(number);
        }}
      />
      {unit !== undefined && <span className="w-9 shrink-0 text-small">{unit}</span>}
    </div>
  );
}
