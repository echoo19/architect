import { useState, type ReactNode } from 'react';
import { Button, cn, Input, SettingsRow } from '@architect/ui';
import { FolderOpen } from 'lucide-react';
import { flowApi } from '../../api/client';
import { attempt } from '../../lib/notify';
import { fileName } from '../format';

interface NumberFieldProps {
  label: string;
  meta?: ReactNode;
  value: number;
  /** Called with every parseable value; the job's own checks decide whether it can be saved. */
  onChange: (value: number) => void;
  /** A problem with the saved value, from the job's checks. */
  issue?: string;
  /** A word after the box, such as "%" or "rounds". */
  unit?: string;
}

/** A number in a settings row. The text is kept as typed, so the user can clear it and retype. */
export function NumberField({ label, meta, value, onChange, issue, unit }: NumberFieldProps) {
  const [text, setText] = useState(() => String(value));
  const [unreadable, setUnreadable] = useState(false);
  const error = unreadable ? 'Enter a number.' : issue;
  return (
    <SettingsRow label={label} meta={meta} error={error}>
      <div className="flex items-center gap-2">
        <Input
          aria-label={label}
          aria-invalid={error ? true : undefined}
          inputMode="decimal"
          value={text}
          onChange={(event) => {
            const next = event.target.value;
            setText(next);
            const parsed = Number(next);
            const readable = next.trim() !== '' && Number.isFinite(parsed);
            setUnreadable(!readable);
            if (readable) onChange(parsed);
          }}
          className="w-24 text-right font-mono tabular-nums"
        />
        {unit && <span className="min-w-12 text-fg-muted">{unit}</span>}
      </div>
    </SettingsRow>
  );
}

interface TextFieldProps {
  label: string;
  meta?: ReactNode;
  value: string;
  onChange: (value: string) => void;
  issue?: string;
}

export function TextField({ label, meta, value, onChange, issue }: TextFieldProps) {
  return (
    <SettingsRow label={label} meta={meta} error={issue}>
      <Input
        aria-label={label}
        aria-invalid={issue ? true : undefined}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        spellCheck={false}
        className="w-60 font-mono text-sm"
      />
    </SettingsRow>
  );
}

interface PathFieldProps {
  label: string;
  path: string;
  /** "file" picks one file with the given extensions; "folder" picks a folder. */
  kind: 'file' | 'folder';
  extensions?: string[];
  onPick: (path: string) => void;
  issue?: string;
}

/** A file or folder chosen with the system picker, shown by name with its full path. */
export function PathField({ label, path, kind, extensions, onPick, issue }: PathFieldProps) {
  const pick = async () => {
    const picked = await attempt("Couldn't open the file picker", () =>
      flowApi.pickFiles({
        title: label,
        ...(kind === 'folder' ? { directory: true } : {}),
        ...(extensions ? { filters: [{ name: label, extensions }] } : {}),
      }),
    );
    const first = picked?.[0];
    if (first) onPick(first);
  };
  return (
    <SettingsRow label={label} meta={path || 'Nothing chosen yet'} error={issue}>
      <div className="flex items-center gap-3">
        {path && <span className="max-w-40 truncate text-fg-secondary">{fileName(path)}</span>}
        <Button size="xs" onClick={() => void pick()}>
          <FolderOpen size={13} aria-hidden />
          {path ? 'Change' : kind === 'folder' ? 'Choose folder' : 'Choose file'}
        </Button>
      </div>
    </SettingsRow>
  );
}

/** A plain line of text inside a tab, between rows. */
export function TabNote({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <p className={cn('m-0 border-t border-line py-4 text-fg-secondary text-pretty', className)}>
      {children}
    </p>
  );
}
