import type { OllamaStatus } from '@architect/shared';
import {
  Button,
  Panel,
  Progress,
  SettingsRow,
  SettingsValue,
  Skeleton,
  Spinner,
} from '@architect/ui';
import { Download, RotateCw } from 'lucide-react';
import type { QueryState } from '../api/query';
import { errorOf, RetryButton } from '../components/QueryValue';
import { shortModelName } from '../lib/names';
import { currentPlatform, deviceInSentence, type Platform } from '../lib/platform';
import { pullBytes, pullPercent, pullStage, type PullState } from './pull';
import { StepIntro } from './SetupShell';
import { StatusValue } from './StatusValue';

const START_OLLAMA: Record<Platform, string> = {
  darwin: 'Install Ollama from ollama.com and open it from Applications, then check again.',
  win32:
    "Install Ollama from ollama.com. It starts on its own after installing; if it doesn't, open it from the Start menu. Then check again.",
  linux: 'Install Ollama from ollama.com and run "ollama serve" to start it, then check again.',
};

export interface ModelStepProps {
  /** Ollama's name for the model, e.g. `muse-glimmer:30b`. */
  model: string;
  /** The model's name for people, e.g. "Muse Glimmer". */
  label: string;
  /** What the download involves, e.g. "Runs locally through Ollama. 18 GB download." */
  note?: string;
  ollama: QueryState<OllamaStatus>;
  pull: PullState;
  onDownload: () => void;
  ready: boolean;
}

export function ModelStep({ model, label, note, ollama, pull, onDownload, ready }: ModelStepProps) {
  const platform = currentPlatform();
  const running = ollama.data?.running === true;
  const downloading = pull.phase === 'starting' || pull.phase === 'pulling';
  const percent = pullPercent(pull);
  const bytes = pullBytes(pull);

  let runtime;
  if (ollama.status === 'error' && !ollama.data) runtime = <RetryButton onClick={ollama.reload} />;
  else if (!ollama.data) runtime = <Skeleton shape="pill" className="h-4 w-24" />;
  else if (running) {
    runtime = (
      <StatusValue done>
        Running{ollama.data.version ? ` · ${ollama.data.version}` : ''}
      </StatusValue>
    );
  } else {
    runtime = (
      <Button size="xs" loading={ollama.status === 'loading'} onClick={ollama.reload}>
        {ollama.status !== 'loading' && <RotateCw size={13} aria-hidden />}
        Check again
      </Button>
    );
  }

  let download;
  if (ready) download = <StatusValue done>Ready</StatusValue>;
  else if (!running) download = <SettingsValue>Waiting for Ollama</SettingsValue>;
  else if (downloading) {
    download = (
      <span className="flex items-center gap-2 font-mono text-fg-secondary">
        <Spinner tone="student" size={13} />
        {percent === null ? '' : `${percent}%`}
      </span>
    );
  } else {
    download = (
      <Button size="xs" onClick={onDownload}>
        {pull.phase === 'failed' ? (
          <RotateCw size={13} aria-hidden />
        ) : (
          <Download size={14} strokeWidth={1.8} aria-hidden />
        )}
        {pull.phase === 'failed' ? 'Try again' : 'Download'}
      </Button>
    );
  }

  return (
    <>
      <StepIntro title="Welcome to Architect">
        The agents you make run on {shortModelName(label)}, an open model from Meta, through Ollama
        on {deviceInSentence(platform)}. Nothing you ask them goes online.
      </StepIntro>
      <Panel
        aria-label="Local model"
        className="w-full max-w-[620px] px-7 py-1 [&>*:first-child]:border-t-0"
      >
        <SettingsRow label="Ollama" meta="Runs the model locally" error={errorOf(ollama)}>
          {runtime}
        </SettingsRow>
        {ollama.data && !running && (
          <p className="m-0 border-t border-line py-4 text-fg-secondary text-pretty">
            {START_OLLAMA[platform]}
          </p>
        )}
        <SettingsRow
          label={label}
          meta={model}
          error={pull.phase === 'failed' ? pull.error : undefined}
        >
          {download}
        </SettingsRow>
        {downloading && !ready && (
          <div className="flex flex-col gap-2.5 border-t border-line pb-4 pt-3.5">
            <Progress
              label={`Downloading ${label}`}
              value={percent === null ? undefined : percent / 100}
              valueText={bytes ?? undefined}
            />
            <div className="flex items-baseline justify-between gap-3 text-sm">
              <span className="text-fg-secondary">{pullStage(pull)}</span>
              {bytes && <span className="font-mono text-fg-muted">{bytes}</span>}
            </div>
          </div>
        )}
      </Panel>
      {running && !ready && note && (
        <p className="-mt-4 text-sm text-fg-muted">
          {downloading ? 'You can carry on while it downloads.' : note}
        </p>
      )}
    </>
  );
}
