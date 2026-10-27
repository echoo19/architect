import {
  mentorPreset,
  type MentorConfig,
  type ReasoningEffort,
  type Theme,
} from '@architect/shared';
import { Segmented, SettingsRow, SettingsValue, Skeleton, Switch } from '@architect/ui';
import { useAppInfo, useGraduates, useOllamaStatus, useSecretsStatus } from '../api/hooks';
import { errorOf, QueryValue, RetryButton } from '../components/QueryValue';
import { formatBytes } from '../lib/format';
import {
  capitalized,
  MENTOR_ROLE_DETAIL,
  mentorName,
  STUDENT_ROLE,
  studentLabel,
} from '../lib/names';
import { currentPlatform, deviceInSentence, deviceLabel } from '../lib/platform';
import type { TabProps } from './SettingsModal';

const THEMES = [
  { value: 'dark', label: 'Dark' },
  { value: 'light', label: 'Light' },
  { value: 'system', label: 'System' },
] as const satisfies readonly { value: Theme; label: string }[];

const STEPS = [
  { value: 'collapsed', label: 'Collapsed' },
  { value: 'expanded', label: 'Expanded' },
] as const;

const EFFORTS = [
  { value: 'low', label: 'Low' },
  { value: 'medium', label: 'Medium' },
  { value: 'high', label: 'High' },
] as const satisfies readonly { value: ReasoningEffort; label: string }[];

const TIERS = [
  { value: 'meta-spark', label: 'Standard' },
  { value: 'meta-spark-contributor', label: 'Contributor' },
] as const;
type Tier = (typeof TIERS)[number]['value'];

export function GeneralTab({ settings, update }: TabProps) {
  return (
    <>
      <SettingsRow label="Appearance">
        <Segmented
          aria-label="Appearance"
          options={THEMES}
          value={settings.theme}
          onValueChange={(theme) => update({ theme })}
        />
      </SettingsRow>
      <SettingsRow
        label="Tool steps"
        meta="Whether the tools and skills a reply used start open or folded in a chat"
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

function tierOf(mentor: MentorConfig): Tier | null {
  if (mentor.kind !== 'model' || mentor.provider !== 'meta') return null;
  return mentor.model === mentorPreset('meta-spark-contributor').model
    ? 'meta-spark-contributor'
    : 'meta-spark';
}

export function ModelsTab({ settings, update }: TabProps) {
  const secrets = useSecretsStatus();
  const ollama = useOllamaStatus();
  const mentor = settings.defaultMentor;
  const student = settings.defaultStudent;
  const tier = tierOf(mentor);
  const device = deviceInSentence(currentPlatform());

  return (
    <>
      <SettingsRow label="Mentor" meta={`${capitalized(MENTOR_ROLE_DETAIL)}, for new agents`}>
        <SettingsValue>{mentor.label}</SettingsValue>
      </SettingsRow>
      {mentor.kind === 'model' && tier && (
        <SettingsRow label="Mentor tier" meta={mentorPreset(tier).note}>
          <Segmented
            aria-label="Mentor tier"
            options={TIERS}
            value={tier}
            onValueChange={(next) => {
              const preset = mentorPreset(next);
              update({ defaultMentor: { ...mentor, label: preset.label, model: preset.model } });
            }}
          />
        </SettingsRow>
      )}
      {mentor.kind === 'model' && (
        <SettingsRow
          label={`${mentorName(mentor)} key`}
          meta={`Encrypted on ${device}`}
          error={errorOf(secrets)}
        >
          <QueryValue query={secrets}>
            {(stored) => (stored[mentor.secretRef] ? 'Saved' : 'Not set')}
          </QueryValue>
        </SettingsRow>
      )}
      <SettingsRow label={capitalized(STUDENT_ROLE)} meta={`Every agent runs on it, on ${device}`}>
        <SettingsValue>{studentLabel(student)}</SettingsValue>
      </SettingsRow>
      <SettingsRow
        label="Local model runtime"
        meta={`Ollama · ${student.baseUrl}`}
        metaFont="code"
        error={errorOf(ollama)}
      >
        <QueryValue query={ollama}>
          {(status) =>
            status.running
              ? `Running${status.version ? ` · ${status.version}` : ''}`
              : 'Not running'
          }
        </QueryValue>
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
          meta="More thinking can find subtler fixes but costs more per round"
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
        meta="Also trains three simpler versions of each agent, so its report can compare them"
      >
        <Switch
          aria-label="Comparison mode"
          checked={settings.comparisonMode}
          onCheckedChange={(comparisonMode) => update({ comparisonMode })}
        />
      </SettingsRow>
    </>
  );
}

export function PrivacyTab({ settings }: TabProps) {
  const device = deviceInSentence(currentPlatform());
  return (
    <>
      <SettingsRow label="Agents" meta={`An agent only talks to the model on ${device}`}>
        <SettingsValue>Never online</SettingsValue>
      </SettingsRow>
      <SettingsRow
        label={mentorName(settings.defaultMentor)}
        meta="Sees training attempts, never the final test or your chats"
      >
        <SettingsValue>During training only</SettingsValue>
      </SettingsRow>
      <SettingsRow label="API keys">
        <SettingsValue>Encrypted on {device}</SettingsValue>
      </SettingsRow>
      <SettingsRow label="Usage data">
        <SettingsValue>Never collected</SettingsValue>
      </SettingsRow>
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
