import { STUDENT_PRESETS } from '@architect/shared';
import { Panel } from '@architect/ui';
import { KeyRow } from '../components/KeyRow';
import { aboutUsd, typicalPracticeUsd } from '../flow/define/estimates';
import { hostedEndpoint, providerName } from '../flow/define/hosted';
import { currentPlatform, deviceInSentence } from '../lib/platform';
import { StepIntro } from './SetupShell';

/** The hosted copy first-run setup offers: the one this app's own training runs use. */
const PRESET = STUDENT_PRESETS.find((preset) => preset.key === 'openrouter-glimmer');

/**
 * An optional step: a key for a hosted copy of the agent's model, so practice runs faster. The
 * finished agent never uses it; the final test and every chat run on this computer.
 */
export function HostedStep({ student }: { student: string }) {
  const device = deviceInSentence(currentPlatform());
  if (!PRESET) return null;
  const endpoint = hostedEndpoint(PRESET, 0);
  const host = providerName(endpoint);
  return (
    <>
      <StepIntro title={`Faster training: a hosted copy of ${student}`}>
        {student} can practice on {host} about ten times faster than on {device}. While an agent
        trains, its practice tasks and the data they read go to {host}; the finished agent still
        runs only here.
      </StepIntro>
      <div className="flex w-full max-w-[620px] flex-col gap-3">
        <p className="m-0 text-center text-fg-secondary text-pretty">
          {PRESET.pricing
            ? `${aboutUsd(typicalPracticeUsd(PRESET.pricing))} per agent, billed by ${host}.`
            : `Billed by ${host}.`}{' '}
          Optional: skip it and agents practice on {device}.
        </p>
        {endpoint.secretRef && (
          <Panel aria-label={`${host} key`} className="px-7 py-1 [&>*:first-child]:border-t-0">
            <KeyRow secretRef={endpoint.secretRef} provider={host} />
          </Panel>
        )}
      </div>
    </>
  );
}
