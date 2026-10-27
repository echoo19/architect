import type { Theme } from '@architect/shared';
import { AgentAvatar, CommandGroup, CommandItem, CommandPalette, Shortcut } from '@architect/ui';
import { Check, Monitor, Moon, Plus, Settings, Sun } from 'lucide-react';
import { useShallow } from 'zustand/react/shallow';
import { api } from '../api/client';
import { createChat, useGraduates, useSettings } from '../api/hooks';
import { attempt } from '../lib/notify';
import { isMac } from '../lib/platform';
import { navigate, paths } from '../lib/router';
import { SHORTCUT_KEYS } from '../lib/shortcuts';
import { useUi } from '../state/ui';

const THEME_ACTIONS: { theme: Theme; label: string; icon: typeof Moon }[] = [
  { theme: 'dark', label: 'Use the dark theme', icon: Moon },
  { theme: 'light', label: 'Use the light theme', icon: Sun },
  { theme: 'system', label: 'Match the system theme', icon: Monitor },
];

/** Opens an agent at its most recent chat, starting one if it has none. */
async function openAgent(graduateId: string): Promise<void> {
  const chats = await api.chats(graduateId);
  const latest = [...chats].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0];
  const chat = latest ?? (await createChat(graduateId));
  navigate(paths.chat(graduateId, chat.id));
}

export function CommandMenu() {
  const { open, setOpen, openSettings } = useUi(
    useShallow((state) => ({
      open: state.paletteOpen,
      setOpen: state.setPaletteOpen,
      openSettings: state.openSettings,
    })),
  );
  const graduates = useGraduates();
  const settings = useSettings();
  const mac = isMac();

  const run = (action: () => void) => {
    setOpen(false);
    action();
  };

  return (
    <CommandPalette open={open} onOpenChange={setOpen}>
      <CommandGroup heading="Agents">
        <CommandItem
          icon={<Plus aria-hidden />}
          shortcut={<Shortcut keys={SHORTCUT_KEYS['new-agent']} mac={mac} />}
          keywords={['create', 'train', 'job']}
          onSelect={() => run(() => navigate(paths.newAgent()))}
        >
          New agent
        </CommandItem>
        {graduates.status === 'success' &&
          graduates.data.map((graduate) => (
            <CommandItem
              key={graduate.id}
              value={`open-${graduate.id}`}
              keywords={[graduate.name, 'open', 'chat']}
              icon={<AgentAvatar name={graduate.name} size="md" />}
              onSelect={() =>
                run(
                  () =>
                    void attempt(`Couldn't open ${graduate.name}`, () => openAgent(graduate.id)),
                )
              }
            >
              Open {graduate.name}
            </CommandItem>
          ))}
      </CommandGroup>
      <CommandGroup heading="App">
        <CommandItem
          icon={<Settings aria-hidden />}
          shortcut={<Shortcut keys={SHORTCUT_KEYS.settings} mac={mac} />}
          keywords={['preferences', 'options']}
          onSelect={() => run(() => openSettings())}
        >
          Settings
        </CommandItem>
        {THEME_ACTIONS.map(({ theme, label, icon: Icon }) => (
          <CommandItem
            key={theme}
            icon={<Icon aria-hidden />}
            keywords={['theme', 'appearance', theme]}
            shortcut={
              settings.status === 'success' && settings.data.theme === theme ? (
                <Check aria-label="Current" />
              ) : undefined
            }
            onSelect={() =>
              run(() => void attempt("Couldn't change the theme", () => settings.update({ theme })))
            }
          >
            {label}
          </CommandItem>
        ))}
      </CommandGroup>
    </CommandPalette>
  );
}
