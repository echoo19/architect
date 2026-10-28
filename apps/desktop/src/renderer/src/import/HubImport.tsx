import { useState, type ReactNode } from 'react';
import {
  HubRepositorySchema,
  type GraduateVersion,
  type HubInstallResult,
  type HubTokenStatus,
  type ImportPreview,
  type ImportResult,
  type Installation,
  type PermissionMode,
  type ResourceGrant,
} from '@architect/shared';
import {
  Button,
  ErrorState,
  Heading,
  Input,
  SettingsRow,
  SettingsValue,
  Skeleton,
  Spinner,
} from '@architect/ui';
import { Cloud, KeyRound, MessageSquarePlus } from 'lucide-react';
import { api, architect } from '../api/client';
import { graduatesApi, refreshAgent } from '../api/graduates';
import { queryKeys, useHubToken } from '../api/hooks';
import { fetchQuery, toError } from '../api/query';
import { shortCommit, tokenSourceText } from '../hub/labels';
import { needsAnotherModel } from '../install/labels';
import { attempt } from '../lib/notify';
import { navigate, paths } from '../lib/router';
import { FlowShell } from '../shell/FlowShell';
import { useUi } from '../state/ui';
import { useAgentSettingsUi } from '../workspace/settings/agentSettingsUi';
import { createChat, forgetAgent } from '../workspace/store';
import { CheckStep } from './CheckStep';
import { InstallStep } from './InstallStep';
import { FoldersStep, PermissionsStep } from './SetupSteps';

type Stage = 'Package' | 'Folders' | 'Permissions' | 'Install';

/** A new agent is set up in four steps; a new version of one already here keeps its setup. */
const NEW_AGENT: readonly Stage[] = ['Package', 'Folders', 'Permissions', 'Install'];
const NEW_VERSION: readonly Stage[] = ['Package', 'Install'];

/** What came down from the Hub: installed with nothing granted, and its version as recorded. */
interface Downloaded {
  result: HubInstallResult;
  version: GraduateVersion;
}

/** "jake/service-desk" from what was typed, `hf://jake/service-desk` included. */
function repositoryOf(typed: string): string {
  return typed
    .trim()
    .replace(/^hf:\/\//, '')
    .replace(/\/+$/, '');
}

function Footer({ children }: { children: ReactNode }) {
  return <div className="mx-auto flex max-w-[680px] justify-between gap-3">{children}</div>;
}

/**
 * The downloaded version as the Package step shows a package: whole and checked, where it went,
 * and this computer's fit and base model from the checks it already ran here.
 */
function asPreview({ result, version }: Downloaded): Extract<ImportPreview, { ok: true }> {
  const { installation, graduate } = result;
  const { manifest } = version;
  const place: Extract<ImportPreview, { ok: true }>['place'] = result.alreadyInstalled
    ? { kind: 'installed', graduateId: graduate.id, name: graduate.name, version: result.version }
    : version.state === 'candidate'
      ? {
          kind: 'version',
          graduateId: graduate.id,
          name: graduate.name,
          version: result.version,
          parent: version.parent ?? result.version - 1,
        }
      : { kind: 'new' };
  return {
    ok: true,
    manifest,
    digest: version.digest,
    files: manifest.integrity.files.length + 1,
    bytes: manifest.integrity.files.reduce((sum, file) => sum + file.size, 0),
    place,
    machine: installation.machine ?? { os: 'unknown', arch: 'unknown', memoryBytes: 1 },
    model: installation.model,
    checks: installation.checks.filter((check) =>
      ['compatibility', 'adapter_runtime', 'model_available'].includes(check.kind),
    ),
    status: installation.status,
    reasons: installation.reasons,
  };
}

/**
 * Install from Hugging Face: a repository and, if wanted, the commit to take. It downloads that
 * one commit, checks every file against its manifest, and installs it with nothing granted and no
 * model loaded, recording the commit; then the same steps as a package file: what it is and
 * whether this computer can run it, its folders, what it may do, and the install checks. Cancel
 * takes back what the download installed.
 */
export function HubImportFlow() {
  const token = useHubToken();
  const showSettings = useAgentSettingsUi((state) => state.show);
  const [typed, setTyped] = useState('');
  const [commit, setCommit] = useState('');
  const [downloading, setDownloading] = useState(false);
  const [downloadError, setDownloadError] = useState<Error | undefined>(undefined);
  const [downloaded, setDownloaded] = useState<Downloaded | null>(null);
  const [stage, setStage] = useState<Stage>('Package');
  const [bindings, setBindings] = useState<Record<string, string>>({});
  const [grants, setGrants] = useState<Record<string, ResourceGrant>>({});
  const [writes, setWrites] = useState<PermissionMode>('ask');
  const [installing, setInstalling] = useState(false);
  const [installError, setInstallError] = useState<Error | undefined>(undefined);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [leaving, setLeaving] = useState<'chat' | 'remove' | 'cancel' | null>(null);

  const repository = repositoryOf(typed);
  const valid = HubRepositorySchema.safeParse(repository).success;
  const preview = downloaded ? asPreview(downloaded) : null;
  const asVersion = preview?.place.kind === 'version';
  const steps = asVersion ? NEW_VERSION : NEW_AGENT;
  const next = (from: Stage): Stage => steps[steps.indexOf(from) + 1] ?? 'Install';
  const back = (from: Stage): Stage => steps[steps.indexOf(from) - 1] ?? 'Package';
  const graduateId = downloaded?.result.graduate.id ?? null;
  const name = downloaded ? downloaded.version.manifest.identity.name : 'Install from Hugging Face';
  const home = () => navigate(paths.home());

  const download = async () => {
    setDownloading(true);
    setDownloadError(undefined);
    try {
      const installed = await graduatesApi.installFromHub(repository, {
        ...(commit.trim() ? { revision: commit.trim() } : {}),
        loadModel: false,
      });
      const versions = await graduatesApi.versions(installed.graduate.id);
      const version = versions.find((entry) => entry.version === installed.version);
      if (!version) throw new Error(`Version ${installed.version} wasn't recorded.`);
      setDownloaded({ result: installed, version });
    } catch (failure) {
      setDownloadError(toError(failure));
    } finally {
      setDownloading(false);
    }
  };

  /** The checks again after something outside the flow changed, such as llama.cpp in Settings. */
  const recheck = () => {
    if (!downloaded || asVersion || graduateId === null) return;
    void attempt("Couldn't check it again", async () => {
      const installation = await graduatesApi.verify(graduateId, { loadModel: false });
      setDownloaded({ ...downloaded, result: { ...downloaded.result, installation } });
    });
  };

  /** Takes back what the download installed: the new agent, or the candidate it added. */
  const cancel = async () => {
    if (!downloaded || downloaded.result.alreadyInstalled || graduateId === null) {
      home();
      return;
    }
    setLeaving('cancel');
    const undone = await attempt(`Couldn't take back ${name}`, async () => {
      if (asVersion) {
        await graduatesApi.rejectVersion(graduateId, downloaded.result.version);
      } else {
        await architect().graduates.remove(graduateId);
        forgetAgent(graduateId);
      }
      await fetchQuery(queryKeys.graduates, api.graduates);
      return true;
    });
    setLeaving(null);
    if (undone) home();
  };

  /** Binds its folders and grants what was chosen, then runs the checks with the model. */
  const install = async () => {
    if (!downloaded || graduateId === null) return;
    setStage('Install');
    setInstalling(true);
    setInstallError(undefined);
    try {
      let installation: Installation = downloaded.result.installation;
      if (!asVersion) {
        await graduatesApi.bind(graduateId, {
          bindings,
          grants: { writes, resources: grants },
        });
        installation = await graduatesApi.verify(graduateId);
      }
      // Everything read about this id before, as for an agent removed and installed again.
      await refreshAgent(graduateId);
      setResult({ ...downloaded.result, installation });
    } catch (failure) {
      setInstallError(toError(failure));
    } finally {
      setInstalling(false);
    }
  };

  const startChat = async () => {
    if (!result) return;
    setLeaving('chat');
    const chat = await attempt(`Couldn't start a chat with ${name}`, () =>
      createChat(result.graduate.id),
    );
    setLeaving(null);
    if (chat) navigate(paths.chat(result.graduate.id, chat.id));
  };

  const remove = async () => {
    if (graduateId === null) return;
    setLeaving('remove');
    const removed = await attempt(`Couldn't remove ${name}`, async () => {
      await architect().graduates.remove(graduateId);
      forgetAgent(graduateId);
      await fetchQuery(queryKeys.graduates, api.graduates);
      return true;
    });
    setLeaving(null);
    if (removed) home();
  };

  let body: ReactNode;
  let footer: ReactNode;
  if (!downloaded || !preview) {
    if (downloading) {
      body = (
        <div role="status" className="flex min-h-[40vh] flex-col items-center justify-center gap-4">
          <Spinner size={20} tone="student" />
          <span className="text-fg-secondary">
            Downloading {repository} and checking every file
          </span>
        </div>
      );
    } else if (downloadError) {
      body = (
        <ErrorState
          title={`Couldn't install from ${repository}`}
          message={downloadError.message}
          onRetry={() => void download()}
          secondaryAction={
            <Button size="md" onClick={() => setDownloadError(undefined)}>
              Back
            </Button>
          }
          className="min-h-[50vh]"
        />
      );
    } else {
      body = (
        <SourceForm
          typed={typed}
          onTyped={setTyped}
          commit={commit}
          onCommit={setCommit}
          invalid={typed.trim() !== '' && !valid}
          token={token.status === 'success' ? token.data.source : undefined}
        />
      );
      footer = (
        <Footer>
          <Button size="lg" onClick={home}>
            Cancel
          </Button>
          <Button variant="primary" size="lg" disabled={!valid} onClick={() => void download()}>
            <Cloud size={16} strokeWidth={1.7} aria-hidden />
            Download
          </Button>
        </Footer>
      );
    }
  } else if (stage === 'Package') {
    const { result: installed } = downloaded;
    const stuck = preview.status === 'blocked' && !needsAnotherModel(installed.installation);
    body = (
      <CheckStep
        preview={preview}
        file={`${installed.source.repository} · commit ${shortCommit(installed.source.revision)}`}
        onRecheck={recheck}
      />
    );
    footer = (
      <Footer>
        <Button size="lg" loading={leaving === 'cancel'} onClick={() => void cancel()}>
          Cancel
        </Button>
        {preview.place.kind === 'installed' ? (
          <Button variant="primary" size="lg" onClick={home}>
            Go to {preview.place.name}
          </Button>
        ) : stuck ? (
          <Button
            variant="danger"
            size="lg"
            loading={leaving === 'remove'}
            onClick={() => void (asVersion ? cancel() : remove())}
          >
            Remove it from this computer
          </Button>
        ) : asVersion ? (
          <Button variant="primary" size="lg" onClick={() => void install()}>
            Keep version {preview.place.kind === 'version' ? preview.place.version : ''}
          </Button>
        ) : (
          <Button variant="primary" size="lg" onClick={() => setStage(next('Package'))}>
            Continue
          </Button>
        )}
      </Footer>
    );
  } else if (stage === 'Folders') {
    body = (
      <FoldersStep
        manifest={preview.manifest}
        bindings={bindings}
        onBind={(resource, folder) =>
          setBindings((current) => ({ ...current, [resource]: folder }))
        }
      />
    );
    footer = (
      <Footer>
        <Button size="lg" onClick={() => setStage(back('Folders'))}>
          Back
        </Button>
        <Button variant="primary" size="lg" onClick={() => setStage(next('Folders'))}>
          Continue
        </Button>
      </Footer>
    );
  } else if (stage === 'Permissions') {
    body = (
      <PermissionsStep
        manifest={preview.manifest}
        bindings={bindings}
        grants={grants}
        writes={writes}
        onGrant={(resource, grant) => setGrants((current) => ({ ...current, [resource]: grant }))}
        onWrites={setWrites}
      />
    );
    footer = (
      <Footer>
        <Button size="lg" onClick={() => setStage(back('Permissions'))}>
          Back
        </Button>
        <Button variant="primary" size="lg" onClick={() => void install()}>
          Install
        </Button>
      </Footer>
    );
  } else {
    body = (
      <InstallStep
        name={name}
        manifest={preview.manifest}
        installing={installing}
        error={installError}
        result={result}
        asVersion={asVersion}
        onRetry={() => void install()}
        onBack={() => setStage(back('Install'))}
        onChanged={(installation) =>
          setResult((current) => current && { ...current, installation })
        }
        onRemove={() => void remove()}
        removing={leaving === 'remove'}
      />
    );
    if (result) {
      footer = (
        <Footer>
          <Button size="lg" onClick={home}>
            Done
          </Button>
          {asVersion ? (
            <Button
              variant="primary"
              size="lg"
              onClick={() => {
                home();
                showSettings(result.graduate.id, 'teaching');
              }}
            >
              Open its versions
            </Button>
          ) : result.installation.status === 'ready' ? (
            <Button
              variant="primary"
              size="lg"
              loading={leaving === 'chat'}
              onClick={() => void startChat()}
            >
              {leaving !== 'chat' && <MessageSquarePlus size={16} strokeWidth={1.7} aria-hidden />}
              Start a chat
            </Button>
          ) : null}
        </Footer>
      );
    }
  }

  return (
    <FlowShell
      title={name}
      step={stage}
      steps={steps}
      footer={footer}
      // Leaving partway takes back what the download installed, as Cancel does.
      {...(downloaded && !result ? { onClose: () => void cancel() } : {})}
    >
      <div className="mx-auto box-content flex max-w-[680px] flex-col gap-10 px-8 pb-12 pt-14">
        {body}
      </div>
    </FlowShell>
  );
}

/** The repository to install from, the commit if a particular one is wanted, and the token. */
function SourceForm({
  typed,
  onTyped,
  commit,
  onCommit,
  invalid,
  token,
}: {
  typed: string;
  onTyped: (value: string) => void;
  commit: string;
  onCommit: (value: string) => void;
  invalid: boolean;
  /** Where the token comes from; undefined while that is being found out. */
  token: HubTokenStatus['source'] | undefined;
}) {
  return (
    <>
      <Heading as="h1" size="display-sm">
        Install from Hugging Face
      </Heading>
      <div className="flex flex-col">
        <SettingsRow label="Repository">
          <Input
            aria-label="Repository"
            aria-invalid={invalid || undefined}
            placeholder="owner/name"
            value={typed}
            onChange={(event) => onTyped(event.target.value)}
            autoComplete="off"
            spellCheck={false}
            autoFocus
            className="w-[400px] font-mono text-sm"
          />
        </SettingsRow>
        <SettingsRow label="Commit">
          <Input
            aria-label="Commit"
            placeholder="Latest on main"
            value={commit}
            onChange={(event) => onCommit(event.target.value)}
            autoComplete="off"
            spellCheck={false}
            className="w-[400px] font-mono text-sm"
          />
        </SettingsRow>
        <SettingsRow label="Token">
          {token === undefined ? (
            <Skeleton shape="pill" className="h-4 w-36" />
          ) : (
            <div className="flex items-center gap-3">
              <SettingsValue>
                {token === null ? 'No token, so public repositories only' : tokenSourceText(token)}
              </SettingsValue>
              {token === null && (
                <Button size="xs" onClick={() => useUi.getState().openSettings('models')}>
                  <KeyRound size={14} strokeWidth={1.7} aria-hidden />
                  Add in Settings
                </Button>
              )}
            </div>
          )}
        </SettingsRow>
      </div>
    </>
  );
}
