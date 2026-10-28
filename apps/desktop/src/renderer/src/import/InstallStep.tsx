import type { ImportResult, InstallStatus, Installation, PackageManifest } from '@architect/shared';
import { Button, ErrorState, Heading, SettingsSection, Spinner, StatusMark } from '@architect/ui';
import { Trash2 } from 'lucide-react';
import { CheckRows, FixButtons } from '../install/InstallChecks';
import { INSTALL_CHECKS_TITLE, statusMark } from '../install/labels';

function titleOf(status: InstallStatus, name: string): string {
  if (status === 'ready') return `${name} is ready`;
  if (status === 'blocked') return `${name} can't run on this computer`;
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
 * Step four: installing, then this computer's install checks, labelled as this computer's, with
 * the outcome (ready, needs attention or blocked), why, and a way out of each.
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
        <span className="text-fg-secondary">Installing {name} and running its install checks</span>
      </div>
    );
  }
  if (error || !result) {
    return (
      <ErrorState
        title={`Couldn't install ${name}`}
        message={error?.message}
        onRetry={onRetry}
        secondaryAction={
          <Button size="md" onClick={onBack}>
            Back
          </Button>
        }
        className="min-h-[50vh]"
      />
    );
  }

  const { installation, graduate } = result;
  const { status } = installation;
  const label = asVersion ? `Version ${result.version} of ${name}` : name;
  return (
    <>
      <header className="flex items-center gap-3">
        <StatusMark state={statusMark(status)} size={24} />
        <Heading as="h1" size="display-sm">
          {titleOf(status, label)}
        </Heading>
      </header>
      <SettingsSection title={INSTALL_CHECKS_TITLE}>
        <CheckRows installation={installation} />
      </SettingsSection>
      {!asVersion && status === 'needs_attention' && (
        <FixButtons
          graduateId={graduate.id}
          installation={installation}
          manifest={manifest}
          onChanged={onChanged}
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
