import { type ReasoningEffort } from '@architect/shared';
import {
  IconButton,
  Segmented,
  SettingsRow,
  SettingsValue,
  Skeleton,
  Switch,
  Tooltip,
} from '@architect/ui';
import { FolderOpen } from 'lucide-react';
import { architect } from '../api/client';
import { useAppInfo, useGraduates, useOllamaStatus } from '../api/hooks';
import { CopyButton } from '../components/CopyButton';
import { errorOf, QueryValue, RetryButton } from '../components/QueryValue';
import { formatBytes } from '../lib/format';
import { attempt } from '../lib/notify';
import { mentorName } from '../lib/names';
import { currentPlatform, deviceInSentence, deviceLabel } from '../lib/platform';
import { EDITIONS } from '../shell/edition';
import { ExperimentalBadge } from '../shell/ExperimentalBadge';
import { ClosedNetworkRows } from './ClosedNetwork';
import type { TabProps } from './SettingsModal';

const STEPS = [
  { value: 'collapsed', label: 'Collapsed' },
  { value: 'expanded', label: 'Expanded' },
] as const;

const EDITION_OPTIONS = [
  { value: 'personal', label: EDITIONS.personal.name },
  { value: 'lab', label: EDITIONS.lab.name },
  { value: 'wsp', label: EDITIONS.wsp.name, badge: <ExperimentalBadge edition="wsp" /> },
] as const;

const EFFORTS = [
  { value: 'low', label: 'Low' },
  { value: 'medium', label: 'Medium' },
  { value: 'high', label: 'High' },
] as const satisfies readonly { value: ReasoningEffort; label: string }[];

export function GeneralTab({ settings, update }: TabProps) {
  return (
    <>
      <SettingsRow
        label="Edition"
        info="Architect teaches an agent one job. Architect Lab is an R&D platform for specialist models: fields, experiments, LoRA fine-tuning plans and cluster launch bundles. Your agents and their training stay in both. Architect WSP, an experiment of its own, edits a model's weights through programs and measures every change."
      >
        <Segmented
          aria-label="Edition"
          options={EDITION_OPTIONS}
          value={settings.edition}
          onValueChange={(edition) => update({ edition })}
        />
      </SettingsRow>
      <SettingsRow
        label="Tool steps"
        info="Whether the tools and skills a reply used start open or folded in a chat."
      >
        <Segmented
          aria-label="Tool steps"
          options={STEPS}
          value={settings.steps}
          onValueChange={(steps) => update({ steps })}
        />
      </SettingsRow>
    </>
  );
}

export function TrainingTab({ settings, update }: TabProps) {
  const mentor = settings.defaultMentor;
  return (
    <>
      {mentor.kind === 'model' && (
        <SettingsRow
          label={`How hard ${mentorName(mentor)} thinks`}
          info="More thinking can find subtler fixes but costs more per round."
        >
          <Segmented
            aria-label={`How hard ${mentorName(mentor)} thinks`}
            options={EFFORTS}
            value={mentor.reasoningEffort}
            onValueChange={(reasoningEffort) =>
              update({ defaultMentor: { ...mentor, reasoningEffort } })
            }
          />
        </SettingsRow>
      )}
      <SettingsRow
        label="Comparison mode"
        info="Also trains three simpler versions of each agent, so its report can compare them."
      >
        <Switch
          aria-label="Comparison mode"
          checked={settings.comparisonMode}
          onCheckedChange={(comparisonMode) => update({ comparisonMode })}
        />
      </SettingsRow>
      <SettingsRow
        label="Quiet local models"
        info="Fewer CPU cores and short rests: slower, but quieter."
      >
        <Switch
          aria-label="Quiet local models"
          checked={settings.quietLocalModels}
          onCheckedChange={(quietLocalModels) => update({ quietLocalModels })}
        />
      </SettingsRow>
    </>
  );
}

export function PrivacyTab({ settings, update }: TabProps) {
  const device = deviceInSentence(currentPlatform());
  const teacher = mentorName(settings.defaultMentor);
  return (
    <>
      <SettingsRow label="Agents" info={`An agent only talks to the model on ${device}.`}>
        <SettingsValue>
          {settings.edition === 'lab' ? 'On-premise only' : 'Never online'}
        </SettingsValue>
      </SettingsRow>
      <SettingsRow
        label={teacher}
        info="Sees practice attempts and samples of your files while it trains, never the final test."
      >
        <SettingsValue>During training</SettingsValue>
      </SettingsRow>
      <SettingsRow
        label="Your chats"
        info={`${teacher} never sees them. The one exception is Teach this: after you confirm, it sends the one exchange you flag, with its steps and your notes.`}
      >
        <SettingsValue>Only what you share</SettingsValue>
      </SettingsRow>
      <SettingsRow label="API keys">
        <SettingsValue>Encrypted on {device}</SettingsValue>
      </SettingsRow>
      <SettingsRow label="Usage data">
        <SettingsValue>Never collected</SettingsValue>
      </SettingsRow>
      {/* The Lab's; shown in either edition while it is on, so it can always be turned off. */}
      {(settings.edition === 'lab' || settings.closedNetwork?.on === true) && (
        <ClosedNetworkRows settings={settings} update={update} />
      )}
    </>
  );
}

export function StorageTab() {
  const info = useAppInfo();
  const graduates = useGraduates();
  const ollama = useOllamaStatus();
  return (
    <>
      <SettingsRow
        label="Location"
        error={errorOf(info)}
        meta={
          info.status === 'success' ? info.data.dataPath : <Skeleton className="mt-1 h-3 w-56" />
        }
        metaFont="code"
      >
        {info.status === 'error' && <RetryButton onClick={info.reload} />}
        {info.status === 'success' && (
          <div className="flex items-center gap-1">
            <Tooltip content="Show in folder" side="bottom">
              <IconButton
                label="Show in folder"
                size="sm"
                onClick={() =>
                  void attempt("Couldn't show the folder", () =>
                    architect().files.show(info.data.dataPath),
                  )
                }
              >
                <FolderOpen size={15} strokeWidth={1.7} aria-hidden />
              </IconButton>
            </Tooltip>
            <CopyButton text={info.data.dataPath} label="Copy the location" />
          </div>
        )}
      </SettingsRow>
      <SettingsRow label="Agents" error={errorOf(graduates)}>
        <QueryValue query={graduates}>
          {(list) => (list.length === 1 ? '1 agent' : `${list.length} agents`)}
        </QueryValue>
      </SettingsRow>
      <SettingsRow label="Local models" meta="Shared by every agent" error={errorOf(ollama)}>
        <QueryValue query={ollama}>
          {(status) => formatBytes(status.models.reduce((sum, model) => sum + model.sizeBytes, 0))}
        </QueryValue>
      </SettingsRow>
    </>
  );
}

export function AboutTab() {
  const info = useAppInfo();
  return (
    <>
      <SettingsRow label="Version" error={errorOf(info)}>
        <QueryValue query={info}>{(data) => `Architect ${data.version}`}</QueryValue>
      </SettingsRow>
      <SettingsRow label={deviceLabel(currentPlatform())} error={errorOf(info)}>
        <QueryValue query={info}>
          {(data) => `${formatBytes(data.totalMemoryBytes)} memory`}
        </QueryValue>
      </SettingsRow>
      <SettingsRow label="Licence">
        <SettingsValue>MIT</SettingsValue>
      </SettingsRow>
    </>
  );
}
