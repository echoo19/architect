import { useState } from 'react';
import type { Installation, PackageManifest } from '@architect/shared';
import { Button, SettingsRow, StatusMark } from '@architect/ui';
import { Cpu, Download, FolderOpen, RotateCw, ShieldCheck } from 'lucide-react';
import { architect } from '../api/client';
import { graduatesApi, refreshAgent } from '../api/graduates';
import { attempt } from '../lib/notify';
import { pullPercent } from '../onboarding/pull';
import { useModelPull } from '../onboarding/useModelPull';
import { useUi } from '../state/ui';
import { useAgentSettingsUi } from '../workspace/settings/agentSettingsUi';
import { CHECK_LABELS, checkDetail, checkMark, fixesFor, type Fix } from './labels';

const CHECK_OUTCOMES = { passed: 'Passed', failed: 'Failed', skipped: 'Skipped' } as const;

/** This computer's install checks, one row each, with what each found. */
export function CheckRows({ installation }: { installation: Installation }) {
  return (
    <ul aria-label="Install checks" className="m-0 flex list-none flex-col p-0">
      {installation.checks.map((check) => (
        <li key={check.id}>
          <SettingsRow
            icon={
              <StatusMark
                state={checkMark(check, installation.status)}
                label={CHECK_OUTCOMES[check.status]}
              />
            }
            label={CHECK_LABELS[check.kind] ?? check.kind}
            meta={checkDetail(check, installation)}
          />
        </li>
      ))}
    </ul>
  );
}

export interface FixButtonsProps {
  graduateId: string;
  installation: Installation;
  manifest: PackageManifest;
  /** The installation once a fix ran and the checks ran again. */
  onChanged: (installation: Installation) => void;
}

/**
 * Opens Settings at Models, where llama.cpp is chosen or its build shown. The agent's settings
 * close first, so the two never stack.
 */
export function SetUpLlamaButton({ disabled = false }: { disabled?: boolean }) {
  return (
    <Button
      size="xs"
      disabled={disabled}
      onClick={() => {
        useAgentSettingsUi.getState().close();
        useUi.getState().openSettings('models');
      }}
    >
      <Cpu size={14} strokeWidth={1.7} aria-hidden />
      Set up llama.cpp in Settings
    </Button>
  );
}

/**
 * A button for each way out of what the checks found: choose a folder, allow one, set up
 * llama.cpp, download the model, or check again. Each one but llama.cpp's runs the checks again
 * and hands back what they found; after Settings, Check again does.
 */
export function FixButtons({ graduateId, installation, manifest, onChanged }: FixButtonsProps) {
  const fixes = fixesFor(installation, manifest);
  const [running, setRunning] = useState<string | null>(null);

  const run = async (key: string, title: string, fix: () => Promise<Installation | null>) => {
    setRunning(key);
    const changed = await attempt(title, async () => {
      const next = await fix();
      if (next) await refreshAgent(graduateId);
      return next;
    });
    setRunning(null);
    if (changed) onChanged(changed);
  };

  const apply = (fix: Exclude<Fix, { kind: 'llama' }>): Promise<Installation | null> => {
    switch (fix.kind) {
      case 'choose':
        return (async () => {
          const [folder] = await architect().files.pick({
            title: `Choose a folder for ${fix.resource}/`,
            directory: true,
          });
          if (!folder) return null;
          return graduatesApi.bind(graduateId, { bindings: { [fix.resource]: folder } });
        })();
      case 'allow':
        return graduatesApi.bind(graduateId, {
          grants: { resources: { [fix.resource]: fix.grant } },
        });
      case 'check':
      case 'download':
        return graduatesApi.verify(graduateId);
    }
  };

  if (fixes.length === 0) return null;
  return (
    <div className="flex flex-wrap items-center gap-2">
      {fixes.map((fix) => {
        const key =
          fix.kind === 'choose' || fix.kind === 'allow' ? `${fix.kind}:${fix.resource}` : fix.kind;
        if (fix.kind === 'llama') return <SetUpLlamaButton key={key} disabled={running !== null} />;
        if (fix.kind === 'download') {
          return (
            <DownloadModelButton
              key={key}
              model={fix.model}
              disabled={running !== null}
              onDone={() => void run(key, "Couldn't check it again", () => apply(fix))}
            />
          );
        }
        const Icon =
          fix.kind === 'choose' ? FolderOpen : fix.kind === 'allow' ? ShieldCheck : RotateCw;
        return (
          <Button
            key={key}
            size="xs"
            variant={fix.kind === 'check' && fixes.length > 1 ? 'ghost' : 'secondary'}
            loading={running === key}
            disabled={running !== null}
            onClick={() => void run(key, "Couldn't fix that", () => apply(fix))}
          >
            {running !== key && <Icon size={14} strokeWidth={1.7} aria-hidden />}
            {fixLabel(fix)}
          </Button>
        );
      })}
    </div>
  );
}

function fixLabel(fix: Exclude<Fix, { kind: 'download' | 'llama' }>): string {
  switch (fix.kind) {
    case 'choose':
      return fix.again
        ? `Choose another folder for ${fix.resource}/`
        : `Choose a folder for ${fix.resource}/`;
    case 'allow':
      return `Allow ${fix.resource}/`;
    case 'check':
      return 'Check again';
  }
}

/** Downloads the base model through Ollama, with its progress, then hands over to a new check. */
export function DownloadModelButton({
  model,
  disabled,
  onDone,
}: {
  model: string;
  disabled: boolean;
  onDone: () => void;
}) {
  const { state, start } = useModelPull(model);
  const percent = pullPercent(state);
  const working = state.phase === 'starting' || state.phase === 'pulling';
  return (
    <Button
      size="xs"
      loading={working}
      disabled={disabled || working}
      onClick={() =>
        void start().then((ready) => {
          if (ready) onDone();
        })
      }
    >
      {!working && <Download size={14} strokeWidth={1.7} aria-hidden />}
      {working
        ? `Downloading${percent === null ? '' : ` · ${percent}%`}`
        : state.phase === 'failed'
          ? 'Try the download again'
          : `Download ${model}`}
    </Button>
  );
}
