import { useState } from 'react';
import type { GraduateSummary, GraduateVersion, Installation } from '@architect/shared';
import {
  Badge,
  Button,
  Dialog,
  DialogClose,
  DialogContent,
  DialogFooter,
  Segmented,
  SettingsRow,
  SettingsValue,
  Skeleton,
  StatusMark,
  toast,
} from '@architect/ui';
import { FolderOpen } from 'lucide-react';
import { api, architect } from '../../api/client';
import {
  graduateKeys,
  graduatesApi,
  refreshAgent,
  useInstallation,
  useVersions,
} from '../../api/graduates';
import { queryKeys } from '../../api/hooks';
import { fetchQuery, setQueryData } from '../../api/query';
import { errorOf, RetryButton } from '../../components/QueryValue';
import { FixButtons } from '../../install/InstallChecks';
import { osName, STATUS_LABELS, statusMark } from '../../install/labels';
import { formatBytes, formatPercent, shortPath } from '../../lib/format';
import {
  capitalized,
  quantizationLabel,
  setupName,
  setupSource,
  shortModelName,
  STUDENT_ROLE,
} from '../../lib/names';
import { attempt } from '../../lib/notify';
import { currentPlatform, deviceInSentence } from '../../lib/platform';
import { navigate, paths, type Route } from '../../lib/router';
import { updateGraduateSettings, useGraduateSettings } from '../graduateSettings';
import { WRITE_MODE_LABELS, WRITE_MODE_MEANINGS, WRITE_MODES, WRITE_SETTING } from '../labels';
import { forgetAgent } from '../store';
import { useAgentSettingsUi } from './agentSettingsUi';
import { versionDate } from './versions';

const pending = <Skeleton shape="pill" className="h-4 w-36" />;

/** The version chats run on, once the versions have loaded. */
function useActiveVersion(graduateId: string) {
  const versions = useVersions(graduateId);
  const active = versions.data?.find((version) => version.active);
  return { versions, active };
}

export function GeneralTab({ agent, route }: { agent: GraduateSummary; route: Route }) {
  const { versions, active } = useActiveVersion(agent.id);
  const [confirming, setConfirming] = useState(false);
  const { manifest } = agent;
  const model = manifest.student;
  const mentor = shortModelName(manifest.mentor.label);
  const { score } = manifest.test;
  const { met, target } = manifest.requirements.passRate;
  const result = `${met ? 'Passed' : 'Below its target'}: ${score.pass} of ${score.total} (${formatPercent(score)})`;
  const contract = active?.manifest.contract;
  const evaluatedHere = active?.origin === undefined;
  const modelDetails = [
    model.quantization && quantizationLabel(model.quantization),
    model.sizeBytes && `${formatBytes(model.sizeBytes)} on disk`,
  ]
    .filter(Boolean)
    .join(' · ');

  return (
    <>
      <SettingsRow label="Job" error={errorOf(versions)}>
        {contract ? (
          <span className="max-w-[340px] text-right text-fg-secondary text-pretty">
            {contract.summary ?? contract.description}
          </span>
        ) : versions.status === 'error' ? (
          <RetryButton onClick={versions.reload} />
        ) : (
          pending
        )}
      </SettingsRow>
      <SettingsRow
        label="Setup"
        meta={`Its instructions, skills and tools. ${setupSource(manifest.harness, mentor)}`}
      >
        <SettingsValue>{capitalized(setupName(manifest.harness))}</SettingsValue>
      </SettingsRow>
      <SettingsRow
        label="Final test"
        meta={
          evaluatedHere
            ? `Tasks it had never seen. The job asked for ${Math.round(target * 100)}%. Tested on ${versionDate(manifest.createdAt)}. The Report tab has the full results.`
            : `Evaluated on the author's computer, on tasks it had never seen. The job asked for ${Math.round(target * 100)}%.`
        }
      >
        <SettingsValue>{result}</SettingsValue>
      </SettingsRow>
      <SettingsRow
        label={capitalized(STUDENT_ROLE)}
        meta={
          <>
            {modelDetails && `${modelDetails} · `}
            <span className="font-mono text-xs">{model.model}</span>
          </>
        }
      >
        <SettingsValue>{shortModelName(model.label)}</SettingsValue>
      </SettingsRow>
      <InstallRow agent={agent} active={active} />
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

/**
 * This computer's install checks of the version chats run on: their outcome, why when it isn't
 * ready, and the way to fix it. Never the author's result, which the Final test row shows.
 */
function InstallRow({
  agent,
  active,
}: {
  agent: GraduateSummary;
  active: GraduateVersion | undefined;
}) {
  const installation = useInstallation(agent.id);
  const checked = installation.data;
  const status = checked?.status ?? agent.status;
  const machine = checked?.machine;
  const meta =
    status === 'ready' && machine && checked?.checkedAt
      ? `${osName(machine.os)} ${machine.arch} · checked ${versionDate(checked.checkedAt)}`
      : (checked?.reasons ?? agent.reasons).join(' ');
  const changed = (next: Installation) => setQueryData(graduateKeys.installation(agent.id), next);

  return (
    <SettingsRow label="Install checks" meta={meta || undefined} error={errorOf(installation)}>
      {installation.status === 'error' ? (
        <RetryButton onClick={installation.reload} />
      ) : (
        <div className="flex flex-wrap items-center justify-end gap-3">
          <Badge
            tone={status === 'ready' ? 'student' : status === 'blocked' ? 'danger' : 'outline'}
            icon={<StatusMark state={statusMark(status)} size={14} />}
          >
            {STATUS_LABELS[status]}
          </Badge>
          {checked && active && status !== 'ready' && (
            <FixButtons
              graduateId={agent.id}
              installation={checked}
              manifest={active.manifest}
              onChanged={changed}
            />
          )}
        </div>
      )}
    </SettingsRow>
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

/** The same three choices, in the same words, as the menu under the message box. */
const WRITE_CHOICES = WRITE_MODES.map((value) => ({ value, label: WRITE_MODE_LABELS[value] }));

/**
 * The folder on this computer that each of the agent's folders is bound to, with a way to choose
 * another. Changing one runs the install checks again.
 */
function FolderRows({ agent, active }: { agent: GraduateSummary; active: GraduateVersion }) {
  const installation = useInstallation(agent.id);
  const [choosing, setChoosing] = useState<string | null>(null);
  const choose = async (name: string) => {
    setChoosing(name);
    const next = await attempt(`Couldn't change the folder for ${name}/`, async () => {
      const [folder] = await architect().files.pick({
        title: `Choose a folder for ${name}/`,
        directory: true,
      });
      if (!folder) return null;
      const bound = await graduatesApi.bind(agent.id, { bindings: { [name]: folder } });
      await refreshAgent(agent.id);
      return bound;
    });
    setChoosing(null);
    if (next) setQueryData(graduateKeys.installation(agent.id), next);
  };

  return active.manifest.resources.map((resource) => {
    const folder = installation.data?.bindings[resource.name];
    const unbound = resource.bundled
      ? "The package's copy"
      : resource.required
        ? 'Not chosen'
        : 'Optional';
    return (
      <SettingsRow
        key={resource.name}
        label={`${resource.name}/`}
        meta={folder === undefined ? unbound : shortPath(folder)}
        metaFont={folder ? 'code' : 'text'}
        error={errorOf(installation)}
      >
        <Button
          size="xs"
          loading={choosing === resource.name}
          disabled={choosing !== null || installation.status !== 'success'}
          onClick={() => void choose(resource.name)}
        >
          {choosing !== resource.name && <FolderOpen size={14} strokeWidth={1.7} aria-hidden />}
          {folder ? 'Change' : 'Choose'}
        </Button>
      </SettingsRow>
    );
  });
}

export function PermissionsTab({ agent }: { agent: GraduateSummary }) {
  const settings = useGraduateSettings(agent.id);
  const { versions, active } = useActiveVersion(agent.id);
  const contract = active?.manifest.contract;
  const files = contract?.inputs.files ?? [];
  const writable = files.filter((file) => file.access === 'write').map((file) => file.name);
  const device = deviceInSentence(currentPlatform());
  const savingNever = settings.data?.writeMode === 'never';
  const unavailable =
    versions.status === 'error' ? <RetryButton onClick={versions.reload} /> : pending;

  return (
    <>
      {active && <FolderRows agent={agent} active={active} />}
      <SettingsRow
        label={WRITE_SETTING}
        meta={
          settings.status === 'success' ? WRITE_MODE_MEANINGS[settings.data.writeMode] : undefined
        }
        error={errorOf(settings)}
      >
        {settings.status === 'success' ? (
          <Segmented
            aria-label={WRITE_SETTING}
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
        label="Internet access"
        meta={`Agents made in Architect only talk to the model on ${device}.`}
      >
        <SettingsValue>Never, by design</SettingsValue>
      </SettingsRow>
      <SettingsRow
        label="Opening a file the job doesn't list"
        meta="Set by its job when it was trained"
        error={errorOf(versions)}
      >
        {contract ? (
          <SettingsValue>{WRITE_MODE_LABELS[contract.boundaries.unseenFiles]}</SettingsValue>
        ) : (
          unavailable
        )}
      </SettingsRow>
      <SettingsRow
        label="Files it can read"
        meta="The files its job lists"
        error={errorOf(versions)}
      >
        {contract ? (
          <span className="max-w-[340px] text-right font-mono text-sm text-fg-secondary text-pretty">
            {files.map((file) => file.name).join(', ')}
          </span>
        ) : (
          unavailable
        )}
      </SettingsRow>
      <SettingsRow
        label="Files it can change"
        meta={
          savingNever
            ? 'Set by its job. Saving is set to Never, so it changes none of them now.'
            : 'Set by its job, and only as Saving changes allows'
        }
        error={errorOf(versions)}
      >
        {contract ? (
          writable.length > 0 ? (
            <span className="font-mono text-sm text-fg-secondary">{writable.join(', ')}</span>
          ) : (
            <SettingsValue>None</SettingsValue>
          )
        ) : (
          unavailable
        )}
      </SettingsRow>
    </>
  );
}
