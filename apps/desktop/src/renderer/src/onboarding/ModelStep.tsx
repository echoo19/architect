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
  Button,
  Disclosure,
  Panel,
  Progress,
  RadioCard,
  RadioCardGroup,
  SettingsRow,
} from '@architect/ui';
import { ExternalLink, RotateCw } from 'lucide-react';
import { architect } from '../api/client';
import type { QueryState } from '../api/query';
import { errorOf, RetryButton } from '../components/QueryValue';
import { formatBytes } from '../lib/format';
import { baseModelName } from '../lib/names';
import { attempt } from '../lib/notify';
import { currentPlatform, deviceInSentence } from '../lib/platform';
import { localModelName, studentFromChoice } from '../settings/models/connections';
import { ModelPicker } from '../settings/models/ModelPicker';
import { isInstalled } from '../settings/models/StudentRows';
import { sizeWord, tradeoff } from './builds';
import { pullBytes, pullPercent, pullStage, type PullState } from './pull';
import { StepIntro } from './SetupShell';
import { StatusValue } from './StatusValue';

/** Where a build runs here: entirely on the graphics card, partly on the processor, or unknown. */
function fitLine(build: StudentBuild, gpu: GpuInfo | null): string | null {
  if (!gpu) return null;
  return fitsOnGpu(build.gpuBytes, gpu)
    ? 'Runs on your graphics card'
    : 'Part runs on the processor, so it is slower';
}

export interface ModelStepProps {
  student: StudentEndpoint;
  /** The two models by their short names: who teaches, and who is taught. */
  names: { mentor: string; student: string };
  local: QueryState<LocalRuntimes>;
  /** Makes this endpoint the agent's model. */
  onChoose: (student: StudentEndpoint) => void;
  /** The download of the chosen model, which setup keeps across its steps. */
  pull: PullState;
}

/**
 * The first step: what Architect does in a line, then the model every agent runs on, in the size
 * that suits this computer. The download button is in the footer, the one primary action. Ollama,
 * which serves the model, shows only when it isn't running.
 */
export function ModelStep({ student, names, local, onChoose, pull }: ModelStepProps) {
  const device = deviceInSentence(currentPlatform());
  const ollama = local.data?.ollama;
  const gpu = local.data?.gpu ?? null;
  const recommended = recommendedBuild(gpu);
  const build = GLIMMER_BUILDS.find((candidate) => candidate.model === student.model);
  const ready =
    pull.phase === 'done' || student.runtime !== 'ollama' || isInstalled(ollama, student.model);
  /** Whether a build is here already: found in Ollama, or the one whose download just ended. */
  const downloaded = (model: string) =>
    isInstalled(ollama, model) || (pull.phase === 'done' && model === student.model);
  const name = localModelName(student.model);
  const downloading = pull.phase === 'starting' || pull.phase === 'pulling';
  const percent = pullPercent(pull);
  const bytes = pullBytes(pull);

  const chooseBuild = (model: string) =>
    onChoose({
      runtime: 'ollama',
      baseUrl: ollama?.baseUrl ?? student.baseUrl,
      model,
      contextLength: student.contextLength,
    });

  return (
    <>
      <StepIntro title="Welcome to Architect">
        Architect trains an agent for any job you describe. {names.mentor}, a large AI, teaches{' '}
        {names.student}, a small one that runs on {device}, so your agent works offline.
      </StepIntro>
      <div className="flex w-full max-w-[720px] flex-col gap-3.5">
        {local.status === 'error' && !local.data && (
          <Panel aria-label="Ollama" className="px-7 py-1 [&>*:first-child]:border-t-0">
            <SettingsRow label="Couldn't look for Ollama" error={errorOf(local)}>
              <RetryButton onClick={local.reload} />
            </SettingsRow>
          </Panel>
        )}
        {ollama && !ollama.running && (
          <Panel aria-label="Ollama" className="px-7 py-1 [&>*:first-child]:border-t-0">
            <SettingsRow
              label="Ollama isn't running"
              meta={`${names.student} runs through Ollama, a free app. Install it and open it, then check again.`}
            >
              <span className="flex items-center gap-2">
                <Button
                  size="xs"
                  variant="ghost"
                  onClick={() =>
                    void attempt("Couldn't open the page", () =>
                      architect().app.openProviderPage('ollama'),
                    )
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
            </SettingsRow>
          </Panel>
        )}
        <RadioCardGroup<string>
          aria-label={`Size of ${names.student}`}
          value={build ? build.model : ''}
          onValueChange={chooseBuild}
        >
          {GLIMMER_BUILDS.map((option) => (
            <RadioCard
              key={option.key}
              value={option.model}
              title={`${baseModelName(option.model)} · ${sizeWord(option, recommended)}`}
              disabled={downloading && option.model !== student.model}
            >
              <span>
                {downloaded(option.model)
                  ? 'Downloaded'
                  : `${formatBytes(option.downloadBytes)} download`}
                {' · '}
                {tradeoff(option)}
              </span>
              {fitLine(option, gpu) && <span>{fitLine(option, gpu)}</span>}
            </RadioCard>
          ))}
        </RadioCardGroup>
        {downloading && (
          <div className="flex flex-col gap-2.5 px-1">
            <Progress
              label={`Downloading ${names.student}`}
              value={percent === null ? undefined : percent / 100}
              valueText={bytes ?? undefined}
            />
            <div className="flex items-baseline justify-between gap-3 text-small">
              <span className="text-fg">
                {pullStage(pull)}. You can carry on with setup meanwhile.
              </span>
              {bytes && <span className="font-mono text-fg">{bytes}</span>}
            </div>
          </div>
        )}
        {pull.phase === 'failed' && (
          <p role="alert" className="m-0 px-1 text-fg text-pretty">
            {pull.error}
          </p>
        )}
        {ready && !downloading && !build && (
          <p className="m-0 px-1">
            <StatusValue done>{names.student} is on this computer</StatusValue>
          </p>
        )}
        <Disclosure label="Use a different model" defaultOpen={!build} className="px-1">
          <div className="flex items-center justify-between gap-4 pt-2">
            <span className="text-fg">A model already on this computer</span>
            <ModelPicker
              role="student"
              aria-label="Another model on this computer"
              current={build ? null : student}
              onChoose={(choice) => onChoose(studentFromChoice(choice, student.contextLength))}
              disabled={downloading}
              className="w-64"
            >
              <span className="truncate text-fg">{build ? 'Choose a model' : name}</span>
            </ModelPicker>
          </div>
        </Disclosure>
      </div>
    </>
  );
}
