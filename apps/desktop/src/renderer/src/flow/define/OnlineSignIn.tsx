import { useState } from 'react';
import { PROVIDERS, STUDENT_PRESETS, type StudentEndpoint } from '@architect/shared';
import { Button } from '@architect/ui';
import { KeyRound } from 'lucide-react';
import { useSecretsStatus } from '../../api/hooks';
import { AddKeyDialog } from '../../settings/models/AddKeyDialog';
import { useOpenRouterSignIn } from '../../settings/models/useSignIn';
import { InspectorRow } from './fields';

/** The online copy setup offers, which a sign-in here gives the job too. */
const PRESET = STUDENT_PRESETS.find((preset) => preset.key === 'openrouter-glimmer');

/** The online copy on OpenRouter, as the job keeps it. */
export function openRouterCopy(contextLength: number): StudentEndpoint | null {
  if (!PRESET) return null;
  const { runtime, baseUrl, model, secretRef } = PRESET;
  return { runtime, baseUrl, model, ...(secretRef ? { secretRef } : {}), contextLength };
}

/**
 * The way to an online copy that setup offers: sign in with OpenRouter, or use a key. It shows
 * while OpenRouter has no key here; once it has one, a job with no copy yet is given setup's.
 */
export function OnlineSignIn({ onConnected }: { onConnected: () => void }) {
  const secrets = useSecretsStatus();
  const signIn = useOpenRouterSignIn(onConnected);
  const [adding, setAdding] = useState(false);
  if (secrets.data === undefined || secrets.data['openrouter'] === true) return null;
  const waiting = signIn.state.phase === 'waiting';
  const host = PROVIDERS.openrouter.label;
  return (
    <InspectorRow
      label={host}
      error={signIn.state.phase === 'failed' ? signIn.state.message : undefined}
    >
      {waiting ? (
        <Button size="xs" variant="ghost" onClick={signIn.cancel}>
          Cancel
        </Button>
      ) : (
        <Button size="xs" onClick={() => setAdding(true)}>
          <KeyRound size={13} aria-hidden />
          Use a key
        </Button>
      )}
      <Button size="xs" loading={waiting} onClick={() => void signIn.start()}>
        {waiting ? 'Waiting for your browser' : 'Sign in'}
      </Button>
      <AddKeyDialog
        open={adding}
        onOpenChange={setAdding}
        provider="openrouter"
        onAdded={(provider) => {
          if (provider === 'openrouter') onConnected();
        }}
      />
    </InspectorRow>
  );
}
