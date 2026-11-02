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
import { ArrowDown, Check, Lock, LockOpen, PenOff, RotateCw } from 'lucide-react';
import { attempt } from '../lib/notify';
import { updateGraduateSettings, useGraduateSettings } from './graduateSettings';
import { WRITE_MODE_LABELS, WRITE_MODE_MEANINGS, WRITE_MODES, WRITE_SETTING } from './labels';

const modeButton =
  'flex h-8 items-center gap-1.5 rounded-full px-2.5 text-small text-fg transition-colors duration-150 hover:bg-hover disabled:opacity-60 [&_svg]:shrink-0';

const MODE_ICONS: Record<PermissionMode, typeof Lock> = {
  ask: Lock,
  allow: LockOpen,
  never: PenOff,
};

/**
 * Chooses whether this agent asks before writing, writes freely, or only reads. The usual answer,
 * asking first, is just its icon; any other answer is named beside it, since it changes what the
 * agent does without asking.
 */
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
  if (!settings.data) return <Skeleton shape="pill" className="ml-2.5 h-4 w-8" />;

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
      <Tooltip content={`${WRITE_SETTING}: ${WRITE_MODE_LABELS[mode]}`} side="top">
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            className={modeButton}
            disabled={saving}
            aria-label={`${WRITE_SETTING}: ${WRITE_MODE_LABELS[mode]}`}
          >
            <Icon size={15} strokeWidth={1.8} aria-hidden />
            {mode !== 'ask' && WRITE_MODE_LABELS[mode]}
          </button>
        </DropdownMenuTrigger>
      </Tooltip>
      <DropdownMenuContent side="top" className="w-80">
        <DropdownMenuLabel>{WRITE_SETTING}</DropdownMenuLabel>
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
  /** The agent that answers: in a team chat, the team's lead. */
  agent: GraduateSummary;
  /**
   * In a team chat, the team's name. Each agent of a team asks before writing as its own setting
   * says, so the composer has no write setting of its own there.
   */
  team?: string;
  draft: string;
  onDraftChange: (text: string) => void;
  onSend: (text: string) => void;
  onStop: () => void;
  /** The agent is replying: the send button becomes stop. */
  running: boolean;
  /**
   * The reply is held until a write it wants to make is allowed or declined: nothing runs, so
   * there is nothing to stop, and the field says what the reply waits for.
   */
  approving: boolean;
  disabled: boolean;
  /** False once the reader scrolled up, which offers a way back to the newest message. */
  pinned: boolean;
  onJumpToLatest: () => void;
  /** Wraps the composer, so a suggestion can focus its text field. */
  fieldRef: Ref<HTMLDivElement>;
}

export function ChatComposer({
  agent,
  team,
  draft,
  onDraftChange,
  onSend,
  onStop,
  running,
  approving,
  disabled,
  pinned,
  onJumpToLatest,
  fieldRef,
}: ChatComposerProps) {
  return (
    // A footer, so a toast rises above the send button instead of covering it.
    <footer className="relative shrink-0 px-8 pb-5">
      {/* On the message box's top edge, so it covers as little of the thread as it can. */}
      {!pinned && (
        <IconButton
          label="Jump to the latest message"
          variant="secondary"
          shape="round"
          size="sm"
          onClick={onJumpToLatest}
          className="absolute -top-4 left-1/2 z-10 -translate-x-1/2 surface-float"
        >
          <ArrowDown size={16} strokeWidth={1.8} aria-hidden />
        </IconButton>
      )}
      <div ref={fieldRef}>
        <Composer
          className="mx-auto"
          label={`Message ${team ?? agent.name}`}
          placeholder={approving ? 'Allow or deny the change above' : `Ask ${agent.name}`}
          value={draft}
          onValueChange={onDraftChange}
          onSubmit={onSend}
          busy={running && !approving}
          onStop={onStop}
          disabled={disabled || approving}
          autoFocus
          leading={team === undefined ? <WriteModeMenu agent={agent} /> : undefined}
        />
      </div>
    </footer>
  );
}
