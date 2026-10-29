import { useEffect, useState, type ReactNode } from 'react';
import type { ImportPreview, ImportResult, PermissionMode, ResourceGrant } from '@architect/shared';
import { Button, EmptyState, Skeleton } from '@architect/ui';
import { Cloud, FolderOpen, MessageSquarePlus, PackageOpen } from 'lucide-react';
import { api, architect } from '../api/client';
import { graduatesApi, refreshAgent } from '../api/graduates';
import { queryKeys } from '../api/hooks';
import { fetchQuery, toError } from '../api/query';
import { ProblemState } from '../components/ProblemState';
import { needsLlama, stepsNeedingAttention } from '../install/labels';
import { attempt } from '../lib/notify';
import { navigate, paths } from '../lib/router';
import { FlowShell } from '../shell/FlowShell';
import { useAgentSettingsUi } from '../workspace/settings/agentSettingsUi';
import { createChat, forgetAgent } from '../workspace/store';
import { CheckStep, Refused, WaitsForLlama } from './CheckStep';
import { HubImportFlow } from './HubImport';
import { InstallStep } from './InstallStep';
import { FoldersStep, PermissionsStep } from './SetupSteps';
import { chooseFromHub, chooseImport, useImportSession } from './session';

type Stage = 'Package' | 'Folders' | 'Permissions' | 'Install';

/** A new agent is set up in four steps; a new version of one already here keeps its setup. */
const NEW_AGENT: readonly Stage[] = ['Package', 'Folders', 'Permissions', 'Install'];
const NEW_VERSION: readonly Stage[] = ['Package', 'Install'];

interface PreviewState {
  preview?: ImportPreview;
  error?: Error;
  loading: boolean;
}

/** The package checked as an import would check it, read again on request. */
function usePreview(path: string | null) {
  const [state, setState] = useState<PreviewState>({ loading: path !== null });
  const [round, setRound] = useState(0);
  useEffect(() => {
    if (path === null) return;
    let live = true;
    setState({ loading: true });
    graduatesApi.previewImport(path).then(
      (preview) => {
        if (live) setState({ preview, loading: false });
      },
      (error: unknown) => {
        if (live) setState({ error: toError(error), loading: false });
      },
    );
    return () => {
      live = false;
    };
  }, [path, round]);
  return { ...state, reload: () => setRound((value) => value + 1) };
}

/**
 * Import agent: a package checked, set up for this computer, installed, and its checks run; or
 * a version installed from Hugging Face, which goes through the same steps.
 */
export function ImportScreen() {
  const source = useImportSession((state) => state.source);
  if (source?.kind === 'hub') return <HubImportFlow key={source.started} />;
  const path = source?.path ?? null;
  return <ImportFlow key={path ?? 'none'} path={path} folders={source?.bindings} />;
}

/** The name a chosen file or folder goes by. */
function baseName(path: string): string {
  return path.split(/[\\/]/).filter(Boolean).at(-1) ?? path;
}

function Footer({ children }: { children: ReactNode }) {
  return <div className="mx-auto flex max-w-[680px] justify-between gap-3">{children}</div>;
}

/**
 * `folders` are the folders a package that comes with Architect is already set to use, by
 * resource name. The Folders step still shows them, and each can be changed there.
 */
function ImportFlow({
  path,
  folders,
}: {
  path: string | null;
  folders: Readonly<Record<string, string>> | undefined;
}) {
  const { preview, error, loading, reload } = usePreview(path);
  const showSettings = useAgentSettingsUi((state) => state.show);
  const [stage, setStage] = useState<Stage>('Package');
  const [bindings, setBindings] = useState<Record<string, string>>({ ...folders });
  const [grants, setGrants] = useState<Record<string, ResourceGrant>>({});
  const [writes, setWrites] = useState<PermissionMode>('ask');
  const [installing, setInstalling] = useState(false);
  const [installError, setInstallError] = useState<Error | undefined>(undefined);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [leaving, setLeaving] = useState<'chat' | 'remove' | null>(null);

  const ok = preview?.ok ? preview : null;
  const steps = ok && ok.place.kind !== 'new' ? NEW_VERSION : NEW_AGENT;
  const next = (from: Stage): Stage => steps[steps.indexOf(from) + 1] ?? 'Install';
  const back = (from: Stage): Stage => steps[steps.indexOf(from) - 1] ?? 'Package';
  const close = () => navigate(paths.home());
  const name = ok ? ok.manifest.identity.name : 'Import agent';

  /** Installs the package with what this flow chose, then reads the agent list again. */
  const install = async () => {
    if (path === null || !ok) return;
    setStage('Install');
    setInstalling(true);
    setInstallError(undefined);
    try {
      const installed = await graduatesApi.importPackage(
        path,
        ok.place.kind === 'new'
          ? { bindings, grants: { writes, resources: grants }, loadModel: true }
          : {},
      );
      // Everything read about this id before, as for an agent removed and imported again.
      await refreshAgent(installed.graduate.id);
      setResult(installed);
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
    if (!result) return;
    setLeaving('remove');
    const removed = await attempt(`Couldn't remove ${name}`, async () => {
      await architect().graduates.remove(result.graduate.id);
      forgetAgent(result.graduate.id);
      await fetchQuery(queryKeys.graduates, api.graduates);
      return true;
    });
    setLeaving(null);
    if (removed) close();
  };

  let body: ReactNode;
  let footer: ReactNode;
  if (path === null) {
    body = (
      <EmptyState
        icon={<PackageOpen aria-hidden />}
        title="Import an agent"
        description="An agent someone sent you as a file or a folder, or one shared on Hugging Face"
        actions={
          <>
            <Button variant="primary" size="md" onClick={() => void chooseImport()}>
              Choose a file
            </Button>
            <Button size="md" onClick={() => void chooseImport(true)}>
              <FolderOpen size={15} strokeWidth={1.7} aria-hidden />
              Choose a folder
            </Button>
            <Button size="md" onClick={chooseFromHub}>
              <Cloud size={15} strokeWidth={1.7} aria-hidden />
              From Hugging Face
            </Button>
          </>
        }
        className="min-h-[56vh]"
      />
    );
  } else if (loading) {
    body = <PreviewSkeleton />;
  } else if (error || !preview) {
    body = (
      <ProblemState
        error={error ?? new Error("The package couldn't be checked.")}
        title="Couldn't check this package"
        onRetry={reload}
        exit={{ label: 'Choose another file', onClick: () => void chooseImport() }}
        className="min-h-[56vh]"
      />
    );
  } else if (!preview.ok) {
    body = <Refused file={baseName(path)} code={preview.code} problems={preview.problems} />;
    footer = (
      <Footer>
        <Button size="lg" onClick={close}>
          Cancel
        </Button>
        <Button variant="primary" size="lg" onClick={() => void chooseImport()}>
          Choose another file
        </Button>
      </Footer>
    );
  } else if (stage === 'Package') {
    body = <CheckStep preview={preview} file={baseName(path)} onRecheck={reload} />;
    // Trained weights run on llama.cpp, so the way on waits until it is set up, and says so.
    const waitsForLlama = needsLlama(preview);
    footer = (
      <Footer>
        <Button size="lg" onClick={close}>
          Cancel
        </Button>
        {preview.place.kind === 'installed' ? (
          <Button variant="primary" size="lg" onClick={close}>
            Go to {preview.place.name}
          </Button>
        ) : preview.status === 'blocked' ? (
          <Button variant="primary" size="lg" onClick={() => void chooseImport()}>
            Choose another file
          </Button>
        ) : (
          <div className="flex items-center gap-4">
            {waitsForLlama && <WaitsForLlama />}
            {preview.place.kind === 'version' ? (
              <Button
                variant="primary"
                size="lg"
                disabled={waitsForLlama}
                onClick={() => void install()}
              >
                Install version {preview.place.version}
              </Button>
            ) : (
              <Button
                variant="primary"
                size="lg"
                disabled={waitsForLlama}
                onClick={() => setStage(next('Package'))}
              >
                Continue
              </Button>
            )}
          </div>
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
    const asVersion = preview.place.kind === 'version';
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
          <Button size="lg" onClick={close}>
            {result.installation.status === 'ready' || asVersion ? 'Done' : 'Not now'}
          </Button>
          {asVersion ? (
            <Button
              variant="primary"
              size="lg"
              onClick={() => {
                close();
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
      attention={stage === 'Install' ? stepsNeedingAttention(result?.installation) : []}
    >
      <div className="mx-auto box-content flex max-w-[680px] flex-col gap-10 px-8 pb-12 pt-14">
        {body}
      </div>
    </FlowShell>
  );
}

function PreviewSkeleton() {
  return (
    <div aria-busy="true" aria-label="Checking the package" className="flex flex-col gap-10">
      <div className="flex flex-col gap-3">
        <Skeleton className="h-9 w-56" />
        <Skeleton className="h-4 w-72" />
      </div>
      <div className="flex flex-col gap-5">
        {[0, 1, 2].map((row) => (
          <div key={row} className="flex items-center gap-3">
            <Skeleton shape="circle" className="size-4" />
            <Skeleton className="h-4 w-64" />
          </div>
        ))}
      </div>
    </div>
  );
}
