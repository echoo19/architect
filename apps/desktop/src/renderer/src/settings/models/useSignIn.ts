import { useState } from 'react';
import { SignInResultSchema } from '@architect/shared';
import { api, architect } from '../../api/client';
import { queryKeys } from '../../api/hooks';
import { fetchQuery, toError } from '../../api/query';
import { attempt } from '../../lib/notify';
import { forgetModelList } from './hooks';

export type SignInState =
  { phase: 'idle' } | { phase: 'waiting' } | { phase: 'failed'; message: string };

/**
 * Signing in with OpenRouter in the browser. While it waits, the browser has the sign-in page
 * open; cancelling stops the wait. A finished sign-in saves the key in main, and the key list
 * here is read again.
 */
export function useOpenRouterSignIn(onSignedIn?: () => void) {
  const [state, setState] = useState<SignInState>({ phase: 'idle' });

  const start = async () => {
    setState({ phase: 'waiting' });
    try {
      const reply = SignInResultSchema.parse(await architect().connections.signIn('openrouter'));
      setState({ phase: 'idle' });
      if (reply.status === 'signed_in') {
        forgetModelList('openrouter');
        await fetchQuery(queryKeys.secrets, api.secretsStatus);
        onSignedIn?.();
      }
    } catch (error) {
      setState({ phase: 'failed', message: toError(error).message });
    }
  };

  const cancel = () => {
    void attempt("Couldn't stop the sign-in", () => architect().connections.cancelSignIn());
  };

  return { state, start, cancel };
}
