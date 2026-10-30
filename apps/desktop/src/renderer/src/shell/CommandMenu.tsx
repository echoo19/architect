import { AgentAvatar, CommandGroup, CommandItem, CommandPalette, Shortcut } from '@architect/ui';
import { Plus, Settings } from 'lucide-react';
import { useShallow } from 'zustand/react/shallow';
import { api } from '../api/client';
import { createChat, useGraduates } from '../api/hooks';
import { attempt } from '../lib/notify';
import { isMac } from '../lib/platform';
import { navigate, paths } from '../lib/router';
import { SHORTCUT_KEYS } from '../lib/shortcuts';
import { useUi } from '../state/ui';
import { placesOf, useEdition } from './edition';

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
  const edition = useEdition();
  const places = edition ? placesOf(edition) : [];
  const mac = isMac();

  const run = (action: () => void) => {
    setOpen(false);
    action();
  };

  return (
    <CommandPalette open={open} onOpenChange={setOpen}>
      <CommandGroup heading="Actions">
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
        <CommandItem
          icon={<Settings aria-hidden />}
          shortcut={<Shortcut keys={SHORTCUT_KEYS.settings} mac={mac} />}
          keywords={['preferences', 'options']}
          onSelect={() => run(() => openSettings())}
        >
          Settings
        </CommandItem>
      </CommandGroup>
      {places.length > 0 && (
        <CommandGroup heading="Places">
          {places.map(({ id, label, Icon, path, keywords }) => (
            <CommandItem
              key={id}
              value={`place-${id}`}
              keywords={[label, 'go', ...keywords]}
              icon={<Icon aria-hidden />}
              onSelect={() => run(() => navigate(path))}
            >
              {label}
            </CommandItem>
          ))}
        </CommandGroup>
      )}
    </CommandPalette>
  );
}
