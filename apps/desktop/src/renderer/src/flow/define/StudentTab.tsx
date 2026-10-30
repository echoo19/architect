import { studentPricing, type StudentTarget } from '@architect/shared';
import { ChoiceTiles, type ChoiceTile } from '@architect/ui';
import { Cloud, Laptop } from 'lucide-react';
import { currentPlatform, deviceLabel } from '../../lib/platform';
import {
  hostedFromChoice,
  localModelName,
  studentFromChoice,
} from '../../settings/models/connections';
import { ModelPicker, priceText } from '../../settings/models/ModelPicker';
import { modelNames } from '../names';
import { InspectorRow, Issue, KeyIfMissing, NumberField } from './fields';
import { presetOf, providerName } from './hosted';
import type { InspectorTabProps } from './inspector-tabs';
import { TYPING_PAUSE_MS } from './use-job-editor';

/**
 * The agent's model: the one it runs on here, where it practices, the online copy that practices
 * faster, and how much it reads at once.
 */
export function StudentTab({ editor, change }: InspectorTabProps) {
  const { job, issues } = editor;
  const { local, hosted, trainOn } = job.student;
  const { student } = modelNames(job);
  const hostedPreset = hosted ? presetOf(hosted) : undefined;
  const hostedPrice = hosted ? studentPricing(hosted) : undefined;
  const places: readonly ChoiceTile<StudentTarget>[] = [
    { value: 'local', label: deviceLabel(currentPlatform()), icon: <Laptop strokeWidth={1.7} /> },
    {
      value: 'hosted',
      label: 'Online copy',
      icon: <Cloud strokeWidth={1.7} />,
      disabled: hosted === undefined,
    },
  ];
  return (
    <div className="flex flex-col gap-6">
      <section aria-label={`${student} on this computer`} className="flex flex-col gap-2">
        <ModelPicker
          role="student"
          aria-label="Model"
          current={local}
          onChoose={(choice) =>
            change('Model', (current) => ({
              ...current,
              student: {
                ...current.student,
                local: studentFromChoice(choice, current.student.local.contextLength),
              },
            }))
          }
          className="w-full"
        >
          <span className="truncate">{localModelName(local.model)}</span>
        </ModelPicker>
        <p className="m-0 break-all font-mono text-small">{local.model}</p>
        <Issue error={issues['student.local.model']} />
      </section>
      <section aria-label="Practices on" className="flex flex-col gap-2">
        <h3 className="m-0 text-small font-medium">Practices on</h3>
        <ChoiceTiles
          aria-label="Practices on"
          columns={2}
          options={places}
          value={trainOn}
          onValueChange={(next) =>
            change('Where it practices', (current) => ({
              ...current,
              student: { ...current.student, trainOn: next },
            }))
          }
        />
      </section>
      <section aria-label="Online copy" className="flex flex-col gap-2">
        <h3 className="m-0 text-small font-medium">Online copy</h3>
        <ModelPicker
          role="hosted"
          aria-label="Online copy for practice"
          current={hosted ?? null}
          none={{
            label: 'None',
            onChoose: () =>
              change('Online copy', (current) => {
                const { hosted: _previous, ...rest } = current.student;
                return { ...current, student: { ...rest, trainOn: 'local' } };
              }),
          }}
          onChoose={(choice) =>
            change('Online copy', (current) => ({
              ...current,
              student: {
                ...current.student,
                hosted: hostedFromChoice(choice, current.student.local.contextLength),
              },
            }))
          }
          className="w-full"
        >
          <span className="truncate">
            {hosted
              ? (hostedPreset?.label ?? `${hosted.model} on ${providerName(hosted)}`)
              : 'None'}
          </span>
        </ModelPicker>
        {hostedPreset && <p className="m-0 text-small text-pretty">{hostedPreset.note}</p>}
        <Issue error={issues['student.hosted']} />
        {(hostedPrice || hosted?.secretRef) && (
          <div className="flex flex-col">
            {hostedPrice && (
              <InspectorRow label="Price per million tokens">
                <span className="text-ui tabular-nums">{priceText(hostedPrice)}</span>
              </InspectorRow>
            )}
            {hosted?.secretRef && (
              <KeyIfMissing secretRef={hosted.secretRef} provider={providerName(hosted)} />
            )}
          </div>
        )}
      </section>
      <NumberField
        label="Context"
        unit="tokens"
        value={local.contextLength}
        issue={issues['student.local.contextLength']}
        onChange={(contextLength) =>
          change(
            'Context',
            (current) => ({
              ...current,
              student: { ...current.student, local: { ...current.student.local, contextLength } },
            }),
            TYPING_PAUSE_MS,
          )
        }
      />
    </div>
  );
}
