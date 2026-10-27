import { useState, type Ref } from 'react';
import type { GraduateSummary } from '@architect/shared';
import { Composer, IconButton, Skeleton, Tooltip } from '@architect/ui';
import { ArrowDown, Lock, LockOpen, RotateCw } from 'lucide-react';
import { attempt } from '../lib/notify';
import { updateGraduateSettings, useGraduateSettings } from './graduateSettings';
import { nextWriteMode, WRITE_MODE_LABELS } from './labels';
import { StatusBar } from './StatusBar';

const modeButton =
  'flex h-8 items-center gap-1.5 rounded-full px-2.5 text-sm text-fg-secondary transition-colors duration-150 hover:bg-hover hover:text-fg disabled:opacity-60 [&_svg]:shrink-0';

/** Steps through "Ask before writing", "Writes allowed" and "Read only" for this agent. */
function WriteModeButton({ graduateId }: { graduateId: string }) {
  const settings = useGraduateSettings(graduateId);
  const [saving, setSaving] = useState(false);

  if (settings.status === 'error') {
    return (
      <Tooltip content={settings.error.message}>
        <button type="button" className={modeButton} onClick={settings.reload}>
          <RotateCw size={13} strokeWidth={1.8} aria-hidden />
          Load write setting
        </button>
      </Tooltip>
    );
  }
  if (!settings.data) return <Skeleton shape="pill" className="ml-2.5 h-4 w-32" />;

  const mode = settings.data.writeMode;
  const cycle = async () => {
    setSaving(true);
    await attempt("Couldn't change the write setting", () =>
      updateGraduateSettings(graduateId, { writeMode: nextWriteMode(mode) }),
    );
    setSaving(false);
  };
  const Icon = mode === 'allow' ? LockOpen : Lock;
  return (
    <Tooltip content="Change what this agent may write">
      <button type="button" className={modeButton} disabled={saving} onClick={() => void cycle()}>
        <Icon size={14} strokeWidth={1.8} aria-hidden />
        {WRITE_MODE_LABELS[mode]}
      </button>
    </Tooltip>
  );
}

export interface ChatComposerProps {
  agent: GraduateSummary;
  draft: string;
  onDraftChange: (text: string) => void;
  onSend: (text: string) => void;
  onStop: () => void;
  /** The agent is replying: the send button becomes stop. */
  running: boolean;
  disabled: boolean;
  /** False once the reader scrolled up, which offers a way back to the newest message. */
  pinned: boolean;
  onJumpToLatest: () => void;
  /** Wraps the composer, so a suggestion can focus its text field. */
  fieldRef: Ref<HTMLDivElement>;
}

export function ChatComposer({
  agent,
  draft,
  onDraftChange,
  onSend,
  onStop,
  running,
  disabled,
  pinned,
  onJumpToLatest,
  fieldRef,
}: ChatComposerProps) {
  return (
    <div className="relative shrink-0 px-8 pb-2.5">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 -top-10 h-10 bg-linear-to-b from-transparent to-ground"
      />
      {!pinned && (
        <IconButton
          label="Jump to the latest message"
          variant="secondary"
          shape="round"
          size="sm"
          onClick={onJumpToLatest}
          className="absolute -top-12 left-1/2 z-10 -translate-x-1/2 bg-composer shadow-composer-sm"
        >
          <ArrowDown size={16} strokeWidth={1.8} aria-hidden />
        </IconButton>
      )}
      <div ref={fieldRef}>
        <Composer
          className="mx-auto"
          label={`Message ${agent.name}`}
          placeholder={`Ask ${agent.name}`}
          value={draft}
          onValueChange={onDraftChange}
          onSubmit={onSend}
          busy={running}
          onStop={onStop}
          disabled={disabled}
          autoFocus
          leading={<WriteModeButton graduateId={agent.id} />}
          trailing={
            <span className="text-sm text-fg-muted">
              {agent.name} v{agent.manifest.harness.version}
            </span>
          }
        />
      </div>
      <StatusBar manifest={agent.manifest} />
    </div>
  );
}
