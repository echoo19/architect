import type { ImportResult, InstallStatus, Installation, PackageManifest } from '@architect/shared';
import { Button, Disclosure, Heading, SettingsSection, Spinner, StatusMark } from '@architect/ui';
import { Trash2 } from 'lucide-react';
import { ProblemState } from '../components/ProblemState';
import { CheckRows, FixButtons } from '../install/InstallChecks';
import {
  installProblem,
  needsAnotherModel,
  statusMark,
  STATUS_LABELS,
  WORKS_HERE_TITLE,
} from '../install/labels';
import { baseModelName } from '../lib/names';
import { navigate, paths } from '../lib/router';
import { useAgentSettingsUi } from '../workspace/settings/agentSettingsUi';

function titleOf(status: InstallStatus, name: string): string {
  if (status === 'ready') return `${name} is ready`;
  if (status === 'blocked') return `${name} can't run`;
  return `${name} needs attention`;
}

export interface InstallStepProps {
  name: string;
  /** The package's manifest, as the check step read it. */
  manifest: PackageManifest;
  installing: boolean;
  error: Error | undefined;
  result: ImportResult | null;
  /** True when the package joined an agent here as a new version. */
  asVersion: boolean;
  onRetry: () => void;
  onBack: () => void;
  onChanged: (installation: Installation) => void;
  onRemove: () => void;
  removing: boolean;
}

/**
 * Step four: installing, then whether it works on this computer, with the outcome (ready, needs
 * attention or blocked), why in one sentence, and a way out of each. Each check's own row waits
 * under Details. A fix that needs another model opens the agent's settings on General, with its
 * model picker open.
 */
export function InstallStep({
  name,
  manifest,
  installing,
  error,
  result,
  asVersion,
  onRetry,
  onBack,
  onChanged,
  onRemove,
  removing,
}: InstallStepProps) {
  if (installing) {
    return (
      <div role="status" className="flex min-h-[40vh] flex-col items-center justify-center gap-4">
        <Spinner size={20} tone="student" />
        <span className="text-fg-secondary">Installing {name} and checking that it works here</span>
      </div>
    );
  }
  if (error || !result) {
    return (
      <ProblemState
        error={error ?? new Error(`${name} wasn't installed.`)}
        title={`Couldn't install ${name}`}
        onRetry={onRetry}
        exit={{ label: 'Back', onClick: onBack }}
        className="min-h-[50vh]"
      />
    );
  }

  const { installation, graduate } = result;
  const { status } = installation;
  const label = asVersion ? `Version ${result.version} of ${name}` : name;
  const fixable = status === 'needs_attention' || needsAnotherModel(installation);
  const problem =
    status === 'ready'
      ? null
      : installProblem(installation, {
          model: baseModelName(installation.model.model),
          baseBytes: manifest.model.base?.sizeBytes,
        });
  // A tool or a setup that doesn't load is the sender's to mend; nothing here can.
  const sendersFix = status === 'blocked' && !needsAnotherModel(installation);
  return (
    <>
      <header className="flex items-center gap-3">
        <StatusMark state={statusMark(status)} size={24} />
        <Heading as="h1" size="display-sm">
          {titleOf(status, label)}
        </Heading>
      </header>
      <SettingsSection title={WORKS_HERE_TITLE} className="pt-0">
        <div className="flex flex-col gap-1.5 pt-1">
          <p className="m-0 flex items-start gap-2.5 text-lg text-fg-soft text-pretty">
            <StatusMark state={statusMark(status)} className="mt-1.5" />
            {problem ? problem.cause : STATUS_LABELS[status]}
          </p>
          {sendersFix && (
            <p className="m-0 pl-[26px] text-fg-secondary">Ask whoever sent it for a fixed copy.</p>
          )}
          <Disclosure label="Details" className="pl-[26px]">
            <CheckRows installation={installation} />
          </Disclosure>
        </div>
      </SettingsSection>
      {!asVersion && fixable && (
        <FixButtons
          graduateId={graduate.id}
          installation={installation}
          manifest={manifest}
          onChanged={onChanged}
          onChooseModel={() => {
            navigate(paths.home());
            useAgentSettingsUi.getState().chooseModel(graduate.id);
          }}
        />
      )}
      {!asVersion && status === 'blocked' && (
        <div className="flex flex-wrap gap-2">
          <Button variant="danger" size="md" loading={removing} onClick={onRemove}>
            {!removing && <Trash2 size={15} strokeWidth={1.7} aria-hidden />}
            Remove it from this computer
          </Button>
        </div>
      )}
    </>
  );
}
