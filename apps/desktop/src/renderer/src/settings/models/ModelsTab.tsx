import { gpuFit, mentorPricing } from '@architect/shared';
import { SettingsRow, SettingsValue } from '@architect/ui';
import { KeyRow } from '../../components/KeyRow';
import { mentorProvider } from '../../onboarding/mentor';
import type { TabProps } from '../SettingsModal';
import { localModelName, mentorFromChoice, studentFromChoice } from './connections';
import { useConnections } from './hooks';
import { GpuMark, ModelPicker } from './ModelPicker';
import { PriceRow } from './PriceRow';
import { sameOllamaModel, StudentRows } from './StudentRows';
import { ConnectionsSection } from './ConnectionsSection';

/**
 * Settings › Models: the default mentor and agent's model, each picked from every connection,
 * then the connections themselves.
 */
export function ModelsTab({ settings, update }: TabProps) {
  const { connections, gpu, local, secrets } = useConnections();
  const mentor = settings.defaultMentor;
  const student = settings.defaultStudent;
  const ollama = local.data?.ollama;
  const installed = ollama?.models.find((entry) => sameOllamaModel(entry.id, student.model));
  const pricing = mentor.kind === 'model' ? mentorPricing(mentor) : undefined;

  return (
    <>
      <SettingsRow
        label="Mentor"
        meta={mentor.kind === 'model' ? mentor.model : undefined}
        metaFont="code"
      >
        {mentor.kind === 'model' ? (
          <ModelPicker
            role="mentor"
            aria-label="Mentor"
            current={mentor}
            onChoose={(choice) =>
              update({ defaultMentor: mentorFromChoice(choice, mentor.reasoningEffort) })
            }
            className="w-72"
          >
            <span className="truncate">{mentor.label}</span>
            <span className="shrink-0 text-fg-muted">{mentorProvider(mentor)}</span>
          </ModelPicker>
        ) : (
          <SettingsValue>{mentor.label}</SettingsValue>
        )}
      </SettingsRow>
      {mentor.kind === 'model' &&
        mentor.secretRef !== undefined &&
        secrets.status === 'success' &&
        secrets.data[mentor.secretRef] !== true && (
          <KeyRow secretRef={mentor.secretRef} provider={mentorProvider(mentor)} />
        )}
      {mentor.kind === 'model' && pricing === undefined && (
        <PriceRow onSave={(saved) => update({ defaultMentor: { ...mentor, pricing: saved } })} />
      )}
      <SettingsRow label="Agent's model" meta={student.model} metaFont="code">
        <ModelPicker
          role="student"
          aria-label="Agent's model"
          current={student}
          onChoose={(choice) =>
            update({ defaultStudent: studentFromChoice(choice, student.contextLength) })
          }
          className="w-72"
        >
          <span className="truncate">{localModelName(student.model)}</span>
          {installed && (
            <span className="shrink-0 text-sm text-fg-muted">
              <GpuMark fit={gpuFit(installed, gpu)} />
            </span>
          )}
        </ModelPicker>
      </SettingsRow>
      <StudentRows
        student={student}
        ollama={ollama}
        gpu={gpu}
        onUse={(model) =>
          update({
            defaultStudent: {
              runtime: 'ollama',
              baseUrl: ollama?.baseUrl ?? student.baseUrl,
              model,
              contextLength: student.contextLength,
            },
          })
        }
      />
      <ConnectionsSection connections={connections} detecting={local.status === 'loading'} />
    </>
  );
}
