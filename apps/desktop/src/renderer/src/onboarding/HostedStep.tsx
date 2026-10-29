import { useState } from 'react';
import { PROVIDERS, STUDENT_PRESETS } from '@architect/shared';
import { Button, Panel, ProviderMark, SettingsRow } from '@architect/ui';
import { KeyRound } from 'lucide-react';
import { aboutUsd, typicalPracticeUsd } from '../flow/define/estimates';
import { currentPlatform, deviceInSentence } from '../lib/platform';
import { AddKeyDialog } from '../settings/models/AddKeyDialog';
import { useOpenRouterSignIn } from '../settings/models/useSignIn';
import { StepIntro } from './SetupShell';
import { StatusValue } from './StatusValue';

/** The online copy first-run setup offers: the one this app's own training runs use. */
const PRESET = STUDENT_PRESETS.find((preset) => preset.key === 'openrouter-glimmer');

export interface HostedStepProps {
  student: string;
  /** Whether the person has already connected the service that hosts the copy. */
  connected: boolean;
}

/**
 * An optional step: an online copy of the agent's model, so practice runs faster. The finished
 * agent never uses it; the final test and every chat run on this computer.
 */
export function HostedStep({ student, connected }: HostedStepProps) {
  const device = deviceInSentence(currentPlatform());
  const signIn = useOpenRouterSignIn();
  const [adding, setAdding] = useState(false);
  const waiting = signIn.state.phase === 'waiting';
  const host = PROVIDERS.openrouter.label;
  const price = PRESET?.pricing ? aboutUsd(typicalPracticeUsd(PRESET.pricing)) : null;

  return (
    <>
      <StepIntro title="Faster training">
        Optional: {student} can practice on an online copy of itself about ten times faster
        {price === null ? '' : `, for ${price.toLowerCase()} an agent`}. The finished agent still
        runs only on {device}.
      </StepIntro>
      <Panel
        aria-label={`${host} connection`}
        className="w-full max-w-[620px] px-7 py-1 [&>*:first-child]:border-t-0"
      >
        <SettingsRow
          icon={<ProviderMark name={host} />}
          label={host}
          meta="Runs the online copy and bills your account"
          error={signIn.state.phase === 'failed' ? signIn.state.message : undefined}
        >
          {connected ? (
            <StatusValue done>Connected</StatusValue>
          ) : (
            <span className="flex items-center gap-2">
              {waiting ? (
                <Button size="xs" variant="ghost" onClick={signIn.cancel}>
                  Cancel
                </Button>
              ) : (
                <Button size="xs" onClick={() => setAdding(true)}>
                  Use a key
                </Button>
              )}
              <Button size="xs" loading={waiting} onClick={() => void signIn.start()}>
                {!waiting && <KeyRound size={13} aria-hidden />}
                {waiting ? 'Waiting for your browser' : 'Sign in'}
              </Button>
            </span>
          )}
        </SettingsRow>
      </Panel>
      <AddKeyDialog open={adding} onOpenChange={setAdding} provider="openrouter" />
    </>
  );
}
