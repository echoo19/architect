import {
  fitsOnGpu,
  GLIMMER_BUILDS,
  recommendedBuild,
  type GpuInfo,
  type LocalRuntimes,
  type StudentBuild,
  type StudentEndpoint,
} from '@architect/shared';
import {
  Badge,
  Button,
  Panel,
  ProviderMark,
  RadioCard,
  RadioCardGroup,
  SettingsRow,
  Skeleton,
} from '@architect/ui';
import { Cpu, ExternalLink, RotateCw } from 'lucide-react';
import { architect } from '../api/client';
import type { QueryState } from '../api/query';
import { errorOf, RetryButton } from '../components/QueryValue';
import { formatBytes } from '../lib/format';
import { attempt } from '../lib/notify';
import { currentPlatform, deviceInSentence } from '../lib/platform';
import { localModelName, studentFromChoice } from '../settings/models/connections';
import { ModelPicker } from '../settings/models/ModelPicker';
import { isInstalled, PullControl } from '../settings/models/StudentRows';
import type { PullState } from './pull';
import { StepIntro } from './SetupShell';
import { StatusValue } from './StatusValue';

/** "2-bit" from "2-bit, sized for a 12 GB GPU". */
function bits(build: StudentBuild): string {
  return build.label.split(',')[0] ?? build.label;
}

/** Where a build runs here: entirely on the GPU, partly on the CPU, or unknown. */
function fitLine(build: StudentBuild, gpu: GpuInfo | null): string | null {
  if (!gpu) return null;
  return fitsOnGpu(build.gpuBytes, gpu) ? 'Runs on your GPU' : 'Part on the CPU';
}

export interface ModelStepProps {
  student: StudentEndpoint;
  local: QueryState<LocalRuntimes>;
  /** Makes this endpoint the agent's model. */
  onChoose: (student: StudentEndpoint) => void;
  /** The download of the chosen model, which setup keeps across its steps. */
  pull: PullState;
  onDownload: () => void;
}

/**
 * The model every agent runs on: Muse Glimmer through Ollama, in the build that suits this
 * computer's GPU, or another model already here.
 */
export function ModelStep({ student, local, onChoose, pull, onDownload }: ModelStepProps) {
  const device = deviceInSentence(currentPlatform());
  const ollama = local.data?.ollama;
  const gpu = local.data?.gpu ?? null;
  const running = ollama?.running === true;
  const recommended = recommendedBuild(gpu);
  const build = GLIMMER_BUILDS.find((candidate) => candidate.model === student.model);
  const ready = isInstalled(ollama, student.model);
  const name = localModelName(student.model);

  const chooseBuild = (model: string) =>
    onChoose({
      runtime: 'ollama',
      baseUrl: ollama?.baseUrl ?? student.baseUrl,
      model,
      contextLength: student.contextLength,
    });

  let runtime;
  if (local.status === 'error' && !local.data) runtime = <RetryButton onClick={local.reload} />;
  else if (!local.data) runtime = <Skeleton shape="pill" className="h-4 w-24" />;
  else if (running) {
    runtime = (
      <StatusValue done>Running{ollama?.version ? ` · ${ollama.version}` : ''}</StatusValue>
    );
  } else {
    runtime = (
      <span className="flex items-center gap-2">
        <Button
          size="xs"
          variant="ghost"
          onClick={() =>
            void attempt("Couldn't open the page", () => architect().app.openProviderPage('ollama'))
          }
        >
          <ExternalLink size={13} aria-hidden />
          Get Ollama
        </Button>
        <Button size="xs" loading={local.status === 'loading'} onClick={local.reload}>
          {local.status !== 'loading' && <RotateCw size={13} aria-hidden />}
          Check again
        </Button>
      </span>
    );
  }

  return (
    <>
      <StepIntro title="Welcome to Architect">
        Your agents run on a model on {device}, so what you ask them stays here.
      </StepIntro>
      <div className="flex w-full max-w-[720px] flex-col gap-3.5">
        <Panel aria-label="Ollama" className="px-7 py-1 [&>*:first-child]:border-t-0">
          <SettingsRow
            icon={<ProviderMark name="Ollama" icon={<Cpu aria-hidden />} />}
            label="Ollama"
            error={errorOf(local)}
          >
            {runtime}
          </SettingsRow>
        </Panel>
        <RadioCardGroup<string>
          aria-label="Muse Glimmer build"
          value={build ? build.model : ''}
          onValueChange={chooseBuild}
        >
          {GLIMMER_BUILDS.map((option) => (
            <RadioCard key={option.key} value={option.model} title={`Muse Glimmer ${bits(option)}`}>
              <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
                {[formatBytes(option.diskBytes), fitLine(option, gpu)].filter(Boolean).join(' · ')}
                {gpu && option.key === recommended.key && (
                  <Badge tone="student" className="h-6 px-2.5 text-xs">
                    Recommended
                  </Badge>
                )}
              </span>
            </RadioCard>
          ))}
        </RadioCardGroup>
        <Panel aria-label="Agent's model" className="px-7 py-1 [&>*:first-child]:border-t-0">
          <SettingsRow
            label={name}
            meta={name === student.model ? undefined : student.model}
            metaFont="code"
          >
            {student.runtime !== 'ollama' || ready || pull.phase === 'done' ? (
              <StatusValue done>Ready</StatusValue>
            ) : !running ? (
              <span className="text-fg-muted">Waiting for Ollama</span>
            ) : (
              <PullControl
                state={pull}
                onStart={onDownload}
                label={build ? `Download · ${formatBytes(build.downloadBytes)}` : 'Download'}
              />
            )}
          </SettingsRow>
          <SettingsRow label="Another model">
            <ModelPicker
              role="student"
              aria-label="Another model on this computer"
              current={build ? null : student}
              onChoose={(choice) => onChoose(studentFromChoice(choice, student.contextLength))}
              className="w-64"
            >
              <span className="truncate text-fg-muted">{build ? 'Choose a model' : name}</span>
            </ModelPicker>
          </SettingsRow>
        </Panel>
      </div>
    </>
  );
}
