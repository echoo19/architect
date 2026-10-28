import {
  fitsOnGpu,
  GLIMMER_BUILDS,
  gpuFit,
  recommendedBuild,
  type GpuInfo,
  type LocalRuntime,
  type StudentEndpoint,
} from '@architect/shared';
import { Button, SettingsRow, Spinner } from '@architect/ui';
import { Download, RotateCw } from 'lucide-react';
import { api } from '../../api/client';
import { queryKeys } from '../../api/hooks';
import { fetchQuery } from '../../api/query';
import { formatBytes } from '../../lib/format';
import { pullPercent } from '../../onboarding/pull';
import { useModelPull } from '../../onboarding/useModelPull';
import { localModelName } from './connections';

/** Ollama writes `muse-glimmer` and `muse-glimmer:latest` for the same model. */
export function sameOllamaModel(a: string, b: string): boolean {
  const tagged = (name: string) => (name.includes(':') ? name : `${name}:latest`);
  return tagged(a) === tagged(b);
}

export function isInstalled(ollama: LocalRuntime | undefined, model: string): boolean {
  return ollama?.models.some((entry) => sameOllamaModel(entry.id, model)) === true;
}

export interface DownloadButtonProps {
  model: string;
  /** What the button says before the download starts. */
  label?: string;
  /** Called once the model is ready, after the list of local models is read again. */
  onReady?: () => void;
}

/** Downloads a model through Ollama, showing the percent as it goes and a retry if it fails. */
export function DownloadButton({ model, label = 'Download', onReady }: DownloadButtonProps) {
  const pull = useModelPull(model);
  const { phase } = pull.state;
  if (phase === 'starting' || phase === 'pulling') {
    const percent = pullPercent(pull.state);
    return (
      <span role="status" className="flex items-center gap-2 font-mono text-fg-secondary">
        <Spinner tone="student" size={13} />
        {percent === null ? '' : `${percent}%`}
      </span>
    );
  }
  const start = async () => {
    if (!(await pull.start())) return;
    await fetchQuery(queryKeys.local, api.localRuntimes);
    onReady?.();
  };
  return (
    <span className="flex items-center gap-3">
      {phase === 'failed' && (
        <span role="alert" className="max-w-64 text-sm text-danger text-pretty">
          {pull.state.error}
        </span>
      )}
      <Button size="xs" onClick={() => void start()}>
        {phase === 'failed' ? (
          <RotateCw size={13} aria-hidden />
        ) : (
          <Download size={14} strokeWidth={1.8} aria-hidden />
        )}
        {phase === 'failed' ? 'Try again' : label}
      </Button>
    </span>
  );
}

export interface StudentRowsProps {
  student: StudentEndpoint;
  ollama: LocalRuntime | undefined;
  gpu: GpuInfo | null;
  /** Makes an Ollama model the agent's model. */
  onUse: (model: string) => void;
}

/**
 * What the agent's model still needs: a download when it isn't on this computer yet, and the
 * Glimmer build sized for this GPU when the chosen model would run partly on the CPU.
 */
export function StudentRows({ student, ollama, gpu, onUse }: StudentRowsProps) {
  if (student.runtime !== 'ollama' || !ollama?.running) return null;
  const missing = !isInstalled(ollama, student.model);
  const build = GLIMMER_BUILDS.find((candidate) => candidate.model === student.model);
  const current = ollama.models.find((entry) => sameOllamaModel(entry.id, student.model));
  const fit = gpuFit(current ?? { id: student.model, sizeBytes: build?.diskBytes }, gpu);
  const better = recommendedBuild(gpu);
  const suggest =
    gpu !== null &&
    fit === 'partial' &&
    better.model !== student.model &&
    fitsOnGpu(better.gpuBytes, gpu);

  return (
    <>
      {missing && (
        <SettingsRow
          label="Not downloaded yet"
          meta={build ? `${formatBytes(build.downloadBytes)} download` : undefined}
        >
          <DownloadButton model={student.model} />
        </SettingsRow>
      )}
      {suggest && (
        <SettingsRow
          label={`${localModelName(better.model)} fits your GPU`}
          meta={`Runs entirely on the ${gpu.name}, several times faster`}
        >
          {isInstalled(ollama, better.model) ? (
            <Button size="xs" onClick={() => onUse(better.model)}>
              Use it
            </Button>
          ) : (
            <DownloadButton
              model={better.model}
              label={`Download · ${formatBytes(better.downloadBytes)}`}
              onReady={() => onUse(better.model)}
            />
          )}
        </SettingsRow>
      )}
    </>
  );
}
