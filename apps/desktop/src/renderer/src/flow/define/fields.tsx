import { useState, type ReactNode } from 'react';
import { Button, cn, Input, SettingsRow } from '@architect/ui';
import { CircleAlert, FolderOpen } from 'lucide-react';
import { flowApi } from '../../api/client';
import { useSecretsStatus } from '../../api/hooks';
import { KeyRow } from '../../components/KeyRow';
import { attempt } from '../../lib/notify';
import { fileName } from '../format';

interface NumberFieldProps {
  label: string;
  value: number;
  /** Called with every parseable value; the job's own checks decide whether it can be saved. */
  onChange: (value: number) => void;
  /** A problem with the value, from the job's checks, said under the row where it is. */
  issue?: string | undefined;
  /** A word after the box, such as "%" or "rounds". */
  unit?: string;
}

/**
 * A number in an inspector row: its label at the left, the box and its unit at the right, and a
 * problem with it right under them. The text is kept as typed, so it can be cleared and retyped.
 */
export function NumberField({ label, value, onChange, issue, unit }: NumberFieldProps) {
  const [text, setText] = useState(() => String(value));
  const [unreadable, setUnreadable] = useState(false);
  // A value changed elsewhere, such as by Undo, shows here, unless the box holds a typed draft.
  const [shown, setShown] = useState(value);
  if (shown !== value) {
    setShown(value);
    if (Number(text) !== value) {
      setText(String(value));
      setUnreadable(false);
    }
  }
  const error = unreadable ? 'Enter a number.' : issue;
  return (
    <InspectorRow label={label} error={error}>
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
        className="h-9 w-20 text-right tabular-nums"
      />
      {unit && <span className="w-14 text-small">{unit}</span>}
    </InspectorRow>
  );
}

interface InspectorRowProps {
  label: string;
  /** A problem with the row's value, with the danger mark. */
  error?: string | undefined;
  /** A plain line under the row, such as why a switch can't move. */
  note?: ReactNode;
  /** The control or value at the right. */
  children?: ReactNode;
  className?: string;
}

/** One setting in an inspector: a label and its control on a line, rows split by hairlines. */
export function InspectorRow({ label, error, note, children, className }: InspectorRowProps) {
  return (
    <div
      className={cn('flex flex-col gap-1 border-t border-line py-2 first:border-t-0', className)}
    >
      <div className="flex min-h-10 items-center justify-between gap-3">
        <span className="min-w-0 text-ui">{label}</span>
        {children !== undefined && (
          <div className="flex shrink-0 items-center gap-2">{children}</div>
        )}
      </div>
      <Issue error={error} />
      {!error && note && <p className="m-0 text-small text-pretty">{note}</p>}
    </div>
  );
}

/**
 * The row to save a provider's key, shown while the key is missing: once it is saved there is
 * nothing to do here, and Settings is where a key is replaced.
 */
export function KeyIfMissing({ secretRef, provider }: { secretRef: string; provider: string }) {
  const secrets = useSecretsStatus();
  if (secrets.data?.[secretRef] === true) return null;
  return <KeyRow secretRef={secretRef} provider={provider} />;
}

/** A titled group of rows in an inspector tab. */
export function Group({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section aria-label={title} className="flex flex-col">
      <h3 className="m-0 pb-1 text-small font-medium">{title}</h3>
      {children}
    </section>
  );
}

/** A problem with a value, said where the value is. */
export function Issue({ error }: { error?: string | undefined }) {
  if (!error) return null;
  return (
    <p role="alert" className="m-0 flex items-start gap-1.5 text-small text-pretty">
      <CircleAlert size={13} className="mt-[3px] shrink-0 text-danger" aria-hidden />
      {error}
    </p>
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
    <SettingsRow
      label={label}
      meta={path || 'Nothing chosen yet'}
      metaFont={path ? 'code' : 'text'}
      error={issue}
    >
      <div className="flex items-center gap-3">
        {path && <span className="max-w-40 truncate text-fg">{fileName(path)}</span>}
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
    <p className={cn('m-0 border-t border-line py-4 text-fg text-pretty', className)}>{children}</p>
  );
}
