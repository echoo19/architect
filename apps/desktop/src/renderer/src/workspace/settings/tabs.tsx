import { useState } from 'react';
import type { GraduateSummary, PermissionMode } from '@architect/shared';
import {
  Button,
  Dialog,
  DialogClose,
  DialogContent,
  DialogFooter,
  Segmented,
  SettingsRow,
  SettingsValue,
  Skeleton,
  Switch,
  toast,
} from '@architect/ui';
import { FolderInput, FolderOutput } from 'lucide-react';
import { api, architect } from '../../api/client';
import { queryKeys, useJob } from '../../api/hooks';
import { fetchQuery } from '../../api/query';
import { errorOf, RetryButton } from '../../components/QueryValue';
import { formatBytes } from '../../lib/format';
import { attempt } from '../../lib/notify';
import { currentPlatform, deviceInSentence } from '../../lib/platform';
import { navigate, paths, type Route } from '../../lib/router';
import { workspaceApi } from '../api';
import { updateGraduateSettings, useGraduateSettings } from '../graduateSettings';
import { forgetAgent } from '../store';
import { useAgentSettingsUi } from './agentSettingsUi';

function formatDay(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

const pending = <Skeleton shape="pill" className="h-4 w-36" />;

export function GeneralTab({ agent, route }: { agent: GraduateSummary; route: Route }) {
  const job = useJob(agent.manifest.jobId);
  const [confirming, setConfirming] = useState(false);
  const { manifest } = agent;
  const model = manifest.student;

  return (
    <>
      <SettingsRow label="Name">
        <SettingsValue>{agent.name}</SettingsValue>
      </SettingsRow>
      <SettingsRow label="Job" error={errorOf(job)}>
        {job.status === 'success' ? (
          <span className="max-w-[340px] text-right text-fg-secondary text-pretty">
            {job.data.summary ?? job.data.description}
          </span>
        ) : job.status === 'error' ? (
          <RetryButton onClick={job.reload} />
        ) : (
          pending
        )}
      </SettingsRow>
      <SettingsRow
        label="Version"
        meta={`Graduated ${formatDay(manifest.acceptedAt ?? manifest.createdAt)}`}
      >
        <SettingsValue>
          v{manifest.harness.version} ·{' '}
          {manifest.requirements.passRate.met ? 'Ready' : 'Below target'}
        </SettingsValue>
      </SettingsRow>
      <SettingsRow
        label="Local model"
        meta={[model.quantization, model.sizeBytes && formatBytes(model.sizeBytes)]
          .filter(Boolean)
          .join(' · ')}
      >
        <span className="font-mono text-sm text-fg-secondary">{model.model}</span>
      </SettingsRow>
      <SettingsRow
        label="Delete agent"
        tone="danger"
        meta="Its chats are deleted too. The local model stays."
      >
        <Button variant="danger" size="xs" onClick={() => setConfirming(true)}>
          Delete
        </Button>
      </SettingsRow>
      <DeleteAgentDialog
        agent={agent}
        route={route}
        open={confirming}
        onOpenChange={setConfirming}
      />
    </>
  );
}

function DeleteAgentDialog({
  agent,
  route,
  open,
  onOpenChange,
}: {
  agent: GraduateSummary;
  route: Route;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const closeSettings = useAgentSettingsUi((state) => state.close);
  const [deleting, setDeleting] = useState(false);

  const remove = async () => {
    setDeleting(true);
    const removed = await attempt(`Couldn't delete ${agent.name}`, async () => {
      await architect().graduates.remove(agent.id);
      return true;
    });
    setDeleting(false);
    if (!removed) return;
    onOpenChange(false);
    closeSettings();
    forgetAgent(agent.id);
    // Start the refresh before leaving, so the home screen waits for the new list.
    const refreshed = fetchQuery(queryKeys.graduates, api.graduates);
    if (route.name === 'chat' && route.graduateId === agent.id) {
      navigate(paths.home(), { replace: true });
    }
    await refreshed;
    toast({ title: `Deleted ${agent.name}` });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        title={`Delete ${agent.name}?`}
        description="Its chats are deleted too, and this can't be undone. Export it first if you might want it back."
      >
        <DialogFooter>
          <DialogClose asChild>
            <Button size="md">Cancel</Button>
          </DialogClose>
          <Button variant="danger" size="md" loading={deleting} onClick={() => void remove()}>
            Delete agent
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

const WRITE_CHOICES = [
  { value: 'ask', label: 'Ask' },
  { value: 'allow', label: 'Allow' },
  { value: 'never', label: 'Never' },
] as const satisfies readonly { value: PermissionMode; label: string }[];

const WRITE_MEANING: Record<PermissionMode, string> = {
  ask: 'Asks in the chat before every write',
  allow: 'Writes without asking',
  never: 'Only reads your files',
};

export function PermissionsTab({ agent }: { agent: GraduateSummary }) {
  const settings = useGraduateSettings(agent.id);
  const job = useJob(agent.manifest.jobId);
  const writable =
    job.status === 'success'
      ? job.data.data.files.filter((file) => file.access === 'write').map((file) => file.name)
      : [];

  return (
    <>
      <SettingsRow
        label="Saving changes"
        meta={settings.status === 'success' ? WRITE_MEANING[settings.data.writeMode] : undefined}
        error={errorOf(settings)}
      >
        {settings.status === 'success' ? (
          <Segmented
            aria-label="Saving changes"
            options={WRITE_CHOICES}
            value={settings.data.writeMode}
            onValueChange={(writeMode) =>
              void attempt("Couldn't change the write setting", () =>
                updateGraduateSettings(agent.id, { writeMode }),
              )
            }
          />
        ) : settings.status === 'error' ? (
          <RetryButton onClick={settings.reload} />
        ) : (
          pending
        )}
      </SettingsRow>
      <SettingsRow
        label="Network access"
        meta={`Off. It only talks to the model on ${deviceInSentence(currentPlatform())}`}
      >
        <Switch
          aria-label="Network access"
          checked={false}
          disabled
          onCheckedChange={() => undefined}
        />
      </SettingsRow>
      <SettingsRow
        label="Files it can edit"
        meta="Set by the job it trained on"
        error={errorOf(job)}
      >
        {job.status === 'success' ? (
          writable.length > 0 ? (
            <span className="font-mono text-sm text-fg-secondary">{writable.join(', ')}</span>
          ) : (
            <SettingsValue>None</SettingsValue>
          )
        ) : job.status === 'error' ? (
          <RetryButton onClick={job.reload} />
        ) : (
          pending
        )}
      </SettingsRow>
    </>
  );
}

function folderName(path: string): string {
  return path.split(/[\\/]/).filter(Boolean).pop() ?? path;
}

export function ExportTab({ agent }: { agent: GraduateSummary }) {
  const [exporting, setExporting] = useState(false);
  const [importing, setImporting] = useState(false);

  const exportFolder = async () => {
    setExporting(true);
    const folder = await attempt(`Couldn't export ${agent.name}`, async () => {
      const [target] = await architect().files.pick({
        title: `Choose where to export ${agent.name}`,
        directory: true,
      });
      if (!target) return null;
      await architect().graduates.exportFolder(agent.id, target);
      return target;
    });
    setExporting(false);
    if (folder) toast({ title: `Exported ${agent.name}`, description: folder });
  };

  const importFolder = async () => {
    setImporting(true);
    const added = await attempt("Couldn't import that agent", async () => {
      const [source] = await architect().files.pick({
        title: 'Choose an agent folder to import',
        directory: true,
      });
      if (!source) return null;
      const graduate = await workspaceApi.importGraduate(source);
      await fetchQuery(queryKeys.graduates, api.graduates);
      return graduate;
    });
    setImporting(false);
    if (added) {
      toast({
        title: `Added ${added.name}`,
        description: 'It is in the sidebar with your agents.',
      });
    }
  };

  return (
    <>
      <SettingsRow
        label="Agent folder"
        meta={`${folderName(agent.path)} · harness, report card and lineage`}
      >
        <Button size="xs" loading={exporting} onClick={() => void exportFolder()}>
          {!exporting && <FolderOutput size={14} strokeWidth={1.7} aria-hidden />}
          Export
        </Button>
      </SettingsRow>
      <SettingsRow label="Import an agent" meta="A folder exported from Architect">
        <Button size="xs" loading={importing} onClick={() => void importFolder()}>
          {!importing && <FolderInput size={14} strokeWidth={1.7} aria-hidden />}
          Import
        </Button>
      </SettingsRow>
    </>
  );
}
