import type { ImportPreview, PackageManifest, TestedConfiguration } from '@architect/shared';
import {
  Heading,
  SettingsRow,
  SettingsSection,
  SettingsValue,
  StatusMark,
  VersionTag,
  type MarkState,
} from '@architect/ui';
import { DownloadModelButton } from '../install/InstallChecks';
import { AUTHOR_RESULT_TITLE, osName, runtimeName } from '../install/labels';
import { formatBytes, formatPercent } from '../lib/format';

type Previewed = Extract<ImportPreview, { ok: true }>;

/** "Windows x64 with Ollama", or "with a hosted copy" for a test that didn't run locally. */
export function testedOn(config: TestedConfiguration): string {
  const backend = config.backend === 'hosted' ? 'a hosted copy' : runtimeName(config.backend);
  return `${osName(config.os)} ${config.arch} with ${backend}`;
}

/**
 * The package as checked before anything is installed: that it is whole and safe to install,
 * whether this computer can run it and has its model, where it would go, and how it did on the
 * author's computer.
 */
export function CheckStep({
  preview,
  file,
  onRecheck,
}: {
  preview: Previewed;
  file: string;
  onRecheck: () => void;
}) {
  const { manifest, machine, model, checks, place } = preview;
  const fit = checks.find((check) => check.kind === 'compatibility');
  const served = checks.find((check) => check.kind === 'model_available');
  const failedMark: MarkState = preview.status === 'blocked' ? 'blocked' : 'attention';
  const host = new URL(model.baseUrl).host;

  return (
    <>
      <header className="flex flex-col gap-2">
        <Heading as="h1" size="display-sm">
          {manifest.identity.name}
        </Heading>
        <p className="m-0 font-mono text-sm text-fg-muted">{file}</p>
      </header>

      <div className="flex flex-col">
        <SettingsRow
          icon={<StatusMark state="ok" label="Passed" />}
          label="Package"
          meta={`${preview.files} files · ${formatBytes(preview.bytes)} · checked without running any of it${
            preview.migratedFrom === undefined ? '' : ' · converted from an older format'
          }`}
        >
          <SettingsValue>Version {manifest.identity.version}</SettingsValue>
        </SettingsRow>
        {place.kind === 'version' && (
          <SettingsRow
            icon={<VersionTag version={place.version} />}
            label={`Joins ${place.name} as version ${place.version}`}
            meta="Waits as a candidate until you promote it; its folders and permissions stay"
          />
        )}
        {place.kind === 'installed' && (
          <SettingsRow
            icon={<StatusMark state="ok" />}
            label="Already installed"
            meta={`Version ${place.version} of ${place.name}`}
          />
        )}
      </div>

      <SettingsSection title="On this computer" className="pt-0">
        <SettingsRow
          icon={<StatusMark state={fit?.status === 'passed' ? 'ok' : failedMark} />}
          label="This computer"
          meta={fit?.status === 'passed' ? `${runtimeName(model.runtime)} at ${host}` : fit?.detail}
        >
          <SettingsValue>
            {osName(machine.os)} {machine.arch} · {formatBytes(machine.memoryBytes)}
          </SettingsValue>
        </SettingsRow>
        <SettingsRow
          icon={
            <StatusMark
              state={
                served?.status === 'passed'
                  ? 'ok'
                  : served?.status === 'skipped'
                    ? 'off'
                    : 'attention'
              }
            />
          }
          label="Base model"
          meta={
            served?.status === 'passed'
              ? `On this computer, served by ${runtimeName(model.runtime)}`
              : served?.status === 'skipped'
                ? "Not checked, since this computer can't run it"
                : served?.detail
          }
        >
          <div className="flex flex-wrap items-center justify-end gap-3">
            <span className="font-mono text-sm text-fg-secondary">{model.model}</span>
            {served?.status === 'failed' && model.runtime === 'ollama' && (
              <DownloadModelButton model={model.model} disabled={false} onDone={onRecheck} />
            )}
          </div>
        </SettingsRow>
      </SettingsSection>

      <AuthorResult manifest={manifest} />
    </>
  );
}

/** The author's own locked-test result, labelled as theirs. */
export function AuthorResult({ manifest }: { manifest: PackageManifest }) {
  const summary = manifest.evidence.summary;
  const tested = manifest.requirements.tested[0];
  return (
    <SettingsSection title={AUTHOR_RESULT_TITLE} className="pt-0">
      {summary ? (
        <SettingsRow
          label="Final test"
          meta={[
            `The job asked for ${Math.round(summary.passRate.target * 100)}%`,
            tested && testedOn(tested),
          ]
            .filter(Boolean)
            .join(' · ')}
        >
          <SettingsValue>
            {summary.passRate.met ? 'Passed' : 'Below its target'}: {summary.score.pass} of{' '}
            {summary.score.total} ({formatPercent(summary.score)})
          </SettingsValue>
        </SettingsRow>
      ) : (
        <SettingsRow label="Final test" meta="No locked test measured this version">
          <SettingsValue>Not evaluated</SettingsValue>
        </SettingsRow>
      )}
    </SettingsSection>
  );
}

/** A package the import refused, with every reason; nothing in it was installed or run. */
export function Refused({ file, problems }: { file: string; problems: string[] }) {
  return (
    <>
      <header className="flex flex-col gap-2">
        <Heading as="h1" size="display-sm">
          This package can&apos;t be imported
        </Heading>
        <p className="m-0 font-mono text-sm text-fg-muted">{file}</p>
      </header>
      <ul aria-label="Problems" className="m-0 flex list-none flex-col p-0">
        {problems.map((problem) => (
          <li key={problem}>
            <SettingsRow icon={<StatusMark state="blocked" label="Problem" />} label={problem} />
          </li>
        ))}
        <li>
          <SettingsRow
            icon={<StatusMark state="off" />}
            label="Nothing in it was installed or run"
          />
        </li>
      </ul>
    </>
  );
}
