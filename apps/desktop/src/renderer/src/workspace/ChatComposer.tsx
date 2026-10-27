import { useState, type Ref } from 'react';
import type { GraduateSummary, PermissionMode } from '@architect/shared';
import {
  Composer,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
  IconButton,
  Skeleton,
  Tooltip,
} from '@architect/ui';
import { ArrowDown, Check, ChevronDown, Lock, LockOpen, PenOff, RotateCw } from 'lucide-react';
import { attempt } from '../lib/notify';
import { updateGraduateSettings, useGraduateSettings } from './graduateSettings';
import { WRITE_MODE_LABELS, WRITE_MODE_MEANINGS, WRITE_MODES } from './labels';
import { StatusBar } from './StatusBar';

const modeButton =
  'flex h-8 items-center gap-1.5 rounded-full border border-line-control px-3 text-sm text-fg-secondary transition-colors duration-150 hover:bg-hover hover:text-fg disabled:opacity-60 [&_svg]:shrink-0';

const MODE_ICONS: Record<PermissionMode, typeof Lock> = {
  ask: Lock,
  allow: LockOpen,
  never: PenOff,
};

/** Chooses whether this agent asks before writing, writes freely, or only reads. */
function WriteModeMenu({ agent }: { agent: GraduateSummary }) {
  const settings = useGraduateSettings(agent.id);
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
  const choose = async (next: PermissionMode) => {
    if (next === mode) return;
    setSaving(true);
    await attempt("Couldn't change the write setting", () =>
      updateGraduateSettings(agent.id, { writeMode: next }),
    );
    setSaving(false);
  };
  const Icon = MODE_ICONS[mode];
  return (
    <DropdownMenu>
      <Tooltip content={`Whether ${agent.name} asks before saving changes to your files`}>
        <DropdownMenuTrigger asChild>
          <button type="button" className={modeButton} disabled={saving}>
            <Icon size={14} strokeWidth={1.8} aria-hidden />
            Saving: {WRITE_MODE_LABELS[mode]}
            <ChevronDown size={13} strokeWidth={1.8} aria-hidden />
          </button>
        </DropdownMenuTrigger>
      </Tooltip>
      <DropdownMenuContent side="top" className="w-80">
        <DropdownMenuLabel>Saving changes to your files</DropdownMenuLabel>
        {WRITE_MODES.map((option) => {
          const OptionIcon = MODE_ICONS[option];
          return (
            <DropdownMenuItem
              key={option}
              onSelect={() => void choose(option)}
              icon={<OptionIcon strokeWidth={1.8} aria-hidden />}
              description={WRITE_MODE_MEANINGS[option]}
              shortcut={option === mode ? <Check strokeWidth={2} aria-label="Current" /> : null}
            >
              {WRITE_MODE_LABELS[option]}
            </DropdownMenuItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
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
          leading={<WriteModeMenu agent={agent} />}
        />
      </div>
      <StatusBar agent={agent} />
    </div>
  );
}
