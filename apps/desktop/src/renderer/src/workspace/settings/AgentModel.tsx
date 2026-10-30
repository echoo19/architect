import { useState } from 'react';
import type { GraduateSummary, GraduateVersion, ModelBinding } from '@architect/shared';
import { SettingsRow, Spinner, toast } from '@architect/ui';
import { useShallow } from 'zustand/react/shallow';
import { graduateKeys, graduatesApi, refreshAgent, useInstallation } from '../../api/graduates';
import { setQueryData } from '../../api/query';
import { errorOf, RetryButton } from '../../components/QueryValue';
import { STATUS_LABELS, WORKS_HERE_TITLE } from '../../install/labels';
import { formatBytes } from '../../lib/format';
import { capitalized, quantizationLabel, STUDENT_ROLE } from '../../lib/names';
import { attempt } from '../../lib/notify';
import {
  localModelName,
  type Connection,
  type ModelChoice,
} from '../../settings/models/connections';
import { ModelPicker } from '../../settings/models/ModelPicker';
import { useAgentSettingsUi } from './agentSettingsUi';

/** Where this computer serves a model chosen in the picker: Ollama's API, or an OpenAI one. */
export function bindingFor(choice: ModelChoice): ModelBinding {
  return {
    runtime: choice.connection.provider === 'ollama' ? 'ollama' : 'openai_compatible',
    baseUrl: choice.connection.baseUrl,
    model: choice.id,
  };
}

/** llama.cpp loads a version's base from Ollama's store, so trained weights need Ollama's models. */
const onOllama = (connection: Connection) => connection.provider === 'ollama';

/**
 * The agent's model on this computer, chosen from the models here. Choosing one binds it and runs
 * the checks on this computer again, whose outcome the General tab shows. A version with trained
 * weights is offered only Ollama's models. A fix that needs another model opens the picker.
 */
export function AgentModelRow({
  agent,
  active,
}: {
  agent: GraduateSummary;
  active: GraduateVersion | undefined;
}) {
  const installation = useInstallation(agent.id);
  const { choosing, setChoosing } = useAgentSettingsUi(
    useShallow((state) => ({ choosing: state.choosingModel, setChoosing: state.setChoosingModel })),
  );
  const [saving, setSaving] = useState(false);
  const binding = installation.data?.model;
  const weights = active?.manifest.model.adapter !== undefined;
  // The package's own base: its build and size only describe that model.
  const base = active?.manifest.model.base;
  const details =
    base && binding?.model === base.name
      ? [
          base.quantization && quantizationLabel(base.quantization),
          base.sizeBytes && `${formatBytes(base.sizeBytes)} on disk`,
        ]
          .filter(Boolean)
          .join(' · ')
      : '';

  const choose = async (choice: ModelChoice) => {
    const next = bindingFor(choice);
    if (binding && next.model === binding.model && next.baseUrl === binding.baseUrl) return;
    setSaving(true);
    const bound = await attempt(`Couldn't change the model of ${agent.name}`, async () => {
      const checked = await graduatesApi.bind(agent.id, { model: next });
      setQueryData(graduateKeys.installation(agent.id), checked);
      await refreshAgent(agent.id);
      return checked;
    });
    setSaving(false);
    if (bound) {
      toast({
        title: `Changed the model of ${agent.name}`,
        description: `${WORKS_HERE_TITLE}: ${STATUS_LABELS[bound.status]}`,
      });
    }
  };

  return (
    <SettingsRow
      label={capitalized(STUDENT_ROLE)}
      meta={
        binding && (
          <>
            {details && `${details} · `}
            <span className="font-mono text-small">{binding.model}</span>
          </>
        )
      }
      error={errorOf(installation)}
    >
      {installation.status === 'error' ? (
        <RetryButton onClick={installation.reload} />
      ) : (
        <ModelPicker
          role="student"
          aria-label={capitalized(STUDENT_ROLE)}
          current={binding ? { baseUrl: binding.baseUrl, model: binding.model } : null}
          {...(weights ? { only: onOllama } : {})}
          open={choosing}
          onOpenChange={setChoosing}
          disabled={saving || !binding}
          onChoose={(choice) => void choose(choice)}
          className="w-64"
        >
          {saving && <Spinner size={13} tone="student" label="Checking" />}
          <span className="truncate">{binding ? localModelName(binding.model) : ''}</span>
        </ModelPicker>
      )}
    </SettingsRow>
  );
}
