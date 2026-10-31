import { useEffect, useRef } from 'react';
import type {
  ImportPreview,
  InstallCheck,
  PackageManifest,
  PackageProblemCode,
  TestedConfiguration,
} from '@architect/shared';
import {
  DetailList,
  Disclosure,
  Heading,
  SettingsRow,
  SettingsSection,
  SettingsValue,
  StatusMark,
  VersionTag,
  type MarkState,
} from '@architect/ui';
import { DownloadModelButton, SetUpLlamaButton } from '../install/InstallChecks';
import {
  AUTHOR_RESULT_TITLE,
  CHECK_LABELS,
  checkDetail,
  checkMark,
  installProblem,
  osName,
  runtimeName,
  WEIGHTS_BASE,
} from '../install/labels';
import { formatBytes, formatScore } from '../lib/format';
import { baseModelName, capitalized } from '../lib/names';
import { useUi } from '../state/ui';

type Previewed = Extract<ImportPreview, { ok: true }>;

/**
 * Checks the package again once Settings closes, since llama.cpp may have been set up there.
 * Nothing happens while `recheck` is null.
 */
function useRecheckAfterSettings(recheck: (() => void) | null): void {
  const open = useUi((state) => state.settingsOpen);
  const wasOpen = useRef(open);
  useEffect(() => {
    if (wasOpen.current && !open) recheck?.();
    wasOpen.current = open;
  }, [open, recheck]);
}

/** "Windows x64 with Ollama", or "with a hosted copy" for a test that didn't run locally. */
export function testedOn(config: TestedConfiguration): string {
  const backend = config.backend === 'hosted' ? 'a hosted copy' : runtimeName(config.backend);
  return `${osName(config.os)} ${config.arch} with ${backend}`;
}

/**
 * The package as checked before anything is installed: that it is whole and safe to open, whether
 * this computer can run it and has its model (and llama.cpp, for trained weights), where it would
 * go, and how it did on its author's computer.
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
  const { manifest, machine, model, checks, place, status } = preview;
  const fit = checks.find((check) => check.kind === 'compatibility');
  const server = checks.find((check) => check.kind === 'adapter_runtime');
  const served = checks.find((check) => check.kind === 'model_available');
  const mark = (check: InstallCheck | undefined): MarkState =>
    check ? checkMark(check, status) : 'off';
  const notChecked = "Not checked, since this computer can't run it";
  const failed = checks.filter((check) => check.status === 'failed');
  const modelName = baseModelName(model.model);
  const modelProblem =
    served?.status === 'failed'
      ? installProblem(
          { checks: [served] },
          { model: modelName, baseBytes: manifest.model.base?.sizeBytes },
        )?.cause
      : undefined;
  useRecheckAfterSettings(server?.status === 'failed' ? onRecheck : null);

  return (
    <>
      <header className="flex flex-col gap-2">
        <Heading as="h1" size="display-sm">
          {manifest.identity.name}
        </Heading>
        <p className="m-0 text-body text-fg text-pretty">
          {manifest.contract.summary ?? manifest.contract.description}
        </p>
        <p className="m-0 font-mono text-small text-fg">
          Version {manifest.identity.version} · {file}
        </p>
      </header>

      <div className="flex flex-col">
        <SettingsRow
          icon={<StatusMark state="ok" label="Passed" />}
          label="Safe to open"
          meta={`${preview.files} files · ${formatBytes(preview.bytes)} · checked without running any of it${
            preview.migratedFrom === undefined ? '' : ' · converted from an older format'
          }`}
        />
        {place.kind === 'version' && (
          <SettingsRow
            icon={<VersionTag version={place.version} />}
            label={`Joins ${place.name} as version ${place.version}`}
            meta="Waits until you choose to use it; its folders and permissions stay"
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
          icon={<StatusMark state={mark(fit)} />}
          label="This computer"
          meta={fit?.status === 'passed' ? 'Can run it' : fit?.detail}
        >
          <SettingsValue>
            {osName(machine.os)} · {formatBytes(machine.memoryBytes)} of memory
          </SettingsValue>
        </SettingsRow>
        {server && (
          <SettingsRow
            icon={<StatusMark state={mark(server)} />}
            label="llama.cpp"
            meta={
              server.status === 'skipped'
                ? notChecked
                : server.status === 'failed'
                  ? 'A free program that runs its trained weights. One more download.'
                  : checkDetail(server, preview)
            }
          >
            {server.status === 'failed' && <SetUpLlamaButton />}
          </SettingsRow>
        )}
        <SettingsRow
          icon={<StatusMark state={mark(served)} />}
          label="Model it needs"
          meta={
            served?.status === 'passed'
              ? server
                ? capitalized(WEIGHTS_BASE)
                : 'Downloaded'
              : served?.status === 'skipped'
                ? notChecked
                : (modelProblem ?? served?.detail)
          }
        >
          <div className="flex flex-wrap items-center justify-end gap-3">
            <SettingsValue>{modelName}</SettingsValue>
            {served?.status === 'failed' && model.runtime === 'ollama' && (
              <DownloadModelButton model={model.model} disabled={false} onDone={onRecheck} />
            )}
          </div>
        </SettingsRow>
        {failed.length > 0 && (
          <Disclosure label="Details" className="pt-1">
            <DetailList
              items={failed.map((check) => ({
                label: CHECK_LABELS[check.kind] ?? check.kind,
                value: check.detail,
              }))}
            />
          </Disclosure>
        )}
      </SettingsSection>

      <AuthorResult manifest={manifest} />
    </>
  );
}

/** Beside a button that waits for llama.cpp: why it does. */
export function WaitsForLlama() {
  return <span className="text-small text-fg">Set up llama.cpp to go on</span>;
}

/** The author's own final test result, labelled as theirs. */
export function AuthorResult({ manifest }: { manifest: PackageManifest }) {
  const summary = manifest.evidence.summary;
  const tested = manifest.requirements.tested[0];
  return (
    <SettingsSection title={AUTHOR_RESULT_TITLE} className="pt-0">
      {summary ? (
        <>
          <SettingsRow
            label="Final test"
            meta={`The job needed ${Math.round(summary.passRate.target * 100)}%`}
          >
            <SettingsValue>
              {summary.passRate.met ? 'Passed' : 'Below its target'}: {formatScore(summary.score)}
            </SettingsValue>
          </SettingsRow>
          {tested && (
            <Disclosure label="Details" className="pt-1">
              <DetailList items={[{ label: 'Tested on', value: testedOn(tested) }]} />
            </Disclosure>
          )}
        </>
      ) : (
        <SettingsRow label="Final test" meta="No final test measured this version">
          <SettingsValue>Not evaluated</SettingsValue>
        </SettingsRow>
      )}
    </SettingsSection>
  );
}

/**
 * Why a package was refused, in a sentence with what to do about it. Every refusal says that it
 * can't be used, and most are the sender's to put right.
 */
const REFUSALS: Record<PackageProblemCode, string> = {
  not_a_package: "This isn't an Architect agent package.",
  unsafe_path: "This package isn't safe to open. Ask whoever sent it for a new copy.",
  link: "This package isn't safe to open. Ask whoever sent it for a new copy.",
  too_large: 'This package is bigger than Architect will open.',
  too_many_files: 'This package holds more files than Architect will open.',
  archive: "Architect can't read this file. Ask whoever sent it for a new copy.",
  unknown_schema:
    'This package was made by a newer version of Architect. Update Architect to open it.',
  invalid_manifest: "This package's description is damaged. Ask whoever sent it for a new copy.",
  checksum: 'This package was edited after it was made. Ask whoever sent it for a new copy.',
  missing_file: 'This package is missing files it lists. Ask whoever sent it for a new copy.',
  unlisted_file: "This package holds files it doesn't list. Ask whoever sent it for a new copy.",
  incompatible: "This agent can't run in this version of Architect.",
  invalid_harness: "This package's setup is damaged. Ask whoever sent it for a new copy.",
};

/** A package the import refused: one sentence on why, then the engine's own reasons under Details. */
export function Refused({
  file,
  code,
  problems,
}: {
  file: string;
  code: PackageProblemCode;
  problems: string[];
}) {
  return (
    <>
      <header className="flex flex-col gap-2">
        <Heading as="h1" size="display-sm">
          This package can&apos;t be imported
        </Heading>
        <p className="m-0 font-mono text-small text-fg">{file}</p>
      </header>
      <div className="flex flex-col gap-2">
        <p className="m-0 flex items-start gap-2.5 text-body text-fg text-pretty">
          <StatusMark state="blocked" label="Problem" className="mt-1.5" />
          {REFUSALS[code]}
        </p>
        <p className="m-0 pl-[30px] text-fg">Nothing in it was installed or run.</p>
        <Disclosure label="Details" className="pl-[30px]">
          <ul aria-label="Problems" className="m-0 flex list-none flex-col gap-1.5 p-0 text-small">
            {problems.map((problem) => (
              <li key={problem} className="text-fg text-pretty">
                {problem}
              </li>
            ))}
          </ul>
        </Disclosure>
      </div>
    </>
  );
}
