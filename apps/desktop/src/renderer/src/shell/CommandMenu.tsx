import { AgentAvatar, CommandGroup, CommandItem, CommandPalette, Shortcut } from '@architect/ui';
import type { Edition, GraduateSummary } from '@architect/shared';
import {
  ClipboardList,
  FlaskConical,
  Library,
  MessageSquare,
  Plus,
  Settings,
  Trophy,
} from 'lucide-react';
import { useShallow } from 'zustand/react/shallow';
import { useExperiments } from '../api/experiments';
import { useGraduates, useJobs } from '../api/hooks';
import { useWspExperiments } from '../api/wsp';
import { isMac } from '../lib/platform';
import { chatPath, navigate, paths } from '../lib/router';
import { SHORTCUT_KEYS } from '../lib/shortcuts';
import { useUi } from '../state/ui';
import { useAgentSettingsUi } from '../workspace/settings/agentSettingsUi';
import { useAgentChats } from '../workspace/store';
import { placesOf, useEdition } from './edition';
import { TRAINING_ROW_WORDS, trainingRows } from './training-rows';

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

  const run = (action: () => void) => {
    setOpen(false);
    action();
  };

  return (
    <CommandPalette
      open={open}
      onOpenChange={setOpen}
      {...(edition === 'lab'
        ? { placeholder: 'Search actions, agents, fields and experiments' }
        : edition === 'wsp'
          ? { placeholder: 'Search actions and experiments' }
          : {})}
    >
      {edition === 'wsp' ? (
        <WspItems run={run} onSettings={openSettings} />
      ) : (
        <AgentItems
          edition={edition}
          graduates={graduates.status === 'success' ? graduates.data : null}
          run={run}
          onSettings={openSettings}
        />
      )}
    </CommandPalette>
  );
}

/** Architect WSP's palette: a new experiment, Settings, and each experiment by its title. */
function WspItems({
  run,
  onSettings,
}: {
  run: (action: () => void) => void;
  onSettings: () => void;
}) {
  const experiments = useWspExperiments();
  const mac = isMac();
  return (
    <>
      <CommandGroup heading="Actions">
        <CommandItem
          icon={<Plus aria-hidden />}
          shortcut={<Shortcut keys={SHORTCUT_KEYS['new-agent']} mac={mac} />}
          keywords={['create', 'weights', 'program']}
          onSelect={() => run(() => navigate(paths.wspNew()))}
        >
          New experiment
        </CommandItem>
        <CommandItem
          icon={<Settings aria-hidden />}
          shortcut={<Shortcut keys={SHORTCUT_KEYS.settings} mac={mac} />}
          keywords={['preferences', 'options']}
          onSelect={() => run(onSettings)}
        >
          Settings
        </CommandItem>
      </CommandGroup>
      {experiments.data && experiments.data.length > 0 && (
        <CommandGroup heading="Experiments">
          {experiments.data.map((experiment) => (
            <CommandItem
              key={experiment.id}
              value={`wsp-${experiment.id}`}
              keywords={[experiment.title, experiment.base.name, 'experiment']}
              icon={<FlaskConical aria-hidden />}
              onSelect={() => run(() => navigate(paths.wspExperiment(experiment.id)))}
            >
              {experiment.title}
            </CommandItem>
          ))}
        </CommandGroup>
      )}
    </>
  );
}

/** The agents' palette, in the personal edition and the Lab. */
function AgentItems({
  edition,
  graduates,
  run,
  onSettings,
}: {
  edition: Edition | null;
  graduates: GraduateSummary[] | null;
  run: (action: () => void) => void;
  onSettings: () => void;
}) {
  const places = edition ? placesOf(edition) : [];
  const mac = isMac();
  return (
    <>
      <CommandGroup heading="Actions">
        <CommandItem
          icon={<Plus aria-hidden />}
          shortcut={<Shortcut keys={SHORTCUT_KEYS['new-agent']} mac={mac} />}
          keywords={['create', 'train', 'job']}
          onSelect={() => run(() => navigate(paths.newAgent()))}
        >
          New agent
        </CommandItem>
        {graduates?.map((graduate) => (
          <CommandItem
            key={graduate.id}
            value={`open-${graduate.id}`}
            keywords={[graduate.name, 'open', 'home', 'sessions']}
            icon={<AgentAvatar name={graduate.name} size="md" />}
            onSelect={() => run(() => navigate(paths.agent(graduate.id)))}
          >
            Open {graduate.name}
          </CommandItem>
        ))}
        {graduates?.map((graduate) => (
          <CommandItem
            key={graduate.id}
            value={`results-${graduate.id}`}
            keywords={[graduate.name, 'results', 'report', 'training', 'score', 'final test']}
            icon={<Trophy aria-hidden />}
            onSelect={() => run(() => useAgentSettingsUi.getState().show(graduate.id, 'report'))}
          >
            Results of {graduate.name}
          </CommandItem>
        ))}
        <CommandItem
          icon={<Settings aria-hidden />}
          shortcut={<Shortcut keys={SHORTCUT_KEYS.settings} mac={mac} />}
          keywords={['preferences', 'options']}
          onSelect={() => run(onSettings)}
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
      {edition === 'lab' ? <LabItems run={run} /> : <JobItems run={run} />}
      {graduates && graduates.length > 0 && (
        <CommandGroup heading="Chats">
          {graduates.map((graduate) => (
            <ChatItems key={graduate.id} graduate={graduate} run={run} />
          ))}
        </CommandGroup>
      )}
    </>
  );
}

/** The Lab's fields and experiments, found by name. */
function LabItems({ run }: { run: (action: () => void) => void }) {
  const jobs = useJobs();
  const experiments = useExperiments();
  return (
    <>
      {jobs.data && jobs.data.length > 0 && (
        <CommandGroup heading="Fields">
          {jobs.data.map((job) => (
            <CommandItem
              key={job.id}
              value={`field-${job.id}`}
              keywords={[job.name, 'field']}
              icon={<Library aria-hidden />}
              onSelect={() => run(() => navigate(paths.field(job.id)))}
            >
              {job.name}
            </CommandItem>
          ))}
        </CommandGroup>
      )}
      {experiments.data && experiments.data.length > 0 && (
        <CommandGroup heading="Experiments">
          {experiments.data.map((record) => (
            <CommandItem
              key={record.id}
              value={`experiment-${record.id}`}
              keywords={[record.input.name, record.job.name, 'experiment']}
              icon={<FlaskConical aria-hidden />}
              onSelect={() => run(() => navigate(paths.experiment(record.id)))}
            >
              {record.input.name}
            </CommandItem>
          ))}
        </CommandGroup>
      )}
    </>
  );
}

/**
 * The jobs agents were trained for, found by name: each opens where it stands, its run while it
 * trains and otherwise its Define page, where training it again and its budget are.
 */
function JobItems({ run }: { run: (action: () => void) => void }) {
  const jobs = useJobs();
  if (!jobs.data || jobs.data.length === 0) return null;
  const rows = new Map(trainingRows(jobs.data).map((row) => [row.jobId, row]));
  return (
    <CommandGroup heading="Jobs">
      {jobs.data.map((job) => {
        const row = rows.get(job.id);
        return (
          <CommandItem
            key={job.id}
            value={`job-${job.id}`}
            keywords={[job.name, 'job', 'budget', 'training', 'train again', 'define']}
            icon={<ClipboardList aria-hidden />}
            onSelect={() => run(() => navigate(row?.path ?? paths.define(job.id)))}
          >
            {row ? `${job.name}: ${TRAINING_ROW_WORDS[row.kind]}` : `Job and budget of ${job.name}`}
          </CommandItem>
        );
      })}
    </CommandGroup>
  );
}

/** An agent's past chats, found by title or by the agent's name. */
function ChatItems({
  graduate,
  run,
}: {
  graduate: GraduateSummary;
  run: (action: () => void) => void;
}) {
  const chats = useAgentChats(graduate.id);
  return chats.entry.data?.map((chat) => (
    <CommandItem
      key={chat.id}
      value={`chat-${chat.id}`}
      keywords={[chat.title, graduate.name, 'chat']}
      icon={<MessageSquare aria-hidden />}
      shortcut={<span className="shrink-0 text-small">{graduate.name}</span>}
      onSelect={() => run(() => navigate(chatPath(chat)))}
    >
      {chat.title}
    </CommandItem>
  ));
}
