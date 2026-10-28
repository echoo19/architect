import { useState } from 'react';
import { PROVIDERS, STUDENT_PRESETS } from '@architect/shared';
import { Button, Panel, ProviderMark, SettingsRow } from '@architect/ui';
import { KeyRound } from 'lucide-react';
import { aboutUsd, typicalPracticeUsd } from '../flow/define/estimates';
import { currentPlatform, deviceInSentence } from '../lib/platform';
import { AddKeyDialog } from '../settings/models/AddKeyDialog';
import { useConnections } from '../settings/models/hooks';
import { useOpenRouterSignIn } from '../settings/models/useSignIn';
import { StepIntro } from './SetupShell';
import { StatusValue } from './StatusValue';

/** The hosted copy first-run setup offers: the one this app's own training runs use. */
const PRESET = STUDENT_PRESETS.find((preset) => preset.key === 'openrouter-glimmer');

/**
 * An optional step: OpenRouter for a hosted copy of the agent's model, so practice runs faster.
 * The finished agent never uses it; the final test and every chat run on this computer.
 */
export function HostedStep({ student }: { student: string }) {
  const device = deviceInSentence(currentPlatform());
  const { connections } = useConnections();
  const signIn = useOpenRouterSignIn();
  const [adding, setAdding] = useState(false);
  const connected = connections.some((connection) => connection.provider === 'openrouter');
  const waiting = signIn.state.phase === 'waiting';
  const host = PROVIDERS.openrouter.label;

  return (
    <>
      <StepIntro title="Faster training">
        {student} can practice on a hosted copy about ten times faster. The finished agent still
        runs only on {device}.
      </StepIntro>
      <Panel
        aria-label={`${host} connection`}
        className="w-full max-w-[620px] px-7 py-1 [&>*:first-child]:border-t-0"
      >
        <SettingsRow
          icon={<ProviderMark name={host} />}
          label={host}
          meta={
            PRESET?.pricing
              ? `${aboutUsd(typicalPracticeUsd(PRESET.pricing))} per agent`
              : undefined
          }
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
                <Button size="xs" variant="ghost" onClick={() => setAdding(true)}>
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
