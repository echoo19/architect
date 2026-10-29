import { useState } from 'react';
import { PROVIDERS } from '@architect/shared';
import { Button, Disclosure, ProviderMark, SettingsRow, Spinner } from '@architect/ui';
import { Cpu, ExternalLink, KeyRound, Plus } from 'lucide-react';
import { api, architect } from '../../api/client';
import { queryKeys } from '../../api/hooks';
import { fetchQuery } from '../../api/query';
import { attempt } from '../../lib/notify';
import { AddKeyDialog } from './AddKeyDialog';
import type { Connection } from './connections';
import { forgetModelList } from './hooks';
import { HuggingFaceRow } from './HuggingFaceRow';
import { LlamaServerRow } from './LlamaServerRow';
import { useOpenRouterSignIn } from './useSignIn';

function statusOf(connection: Connection): string {
  const { runtime } = connection;
  if (runtime) {
    if (!runtime.running) return connection.provider === 'ollama' ? 'Not running' : 'Not found';
    const count = runtime.models.length;
    const models = `${count} ${count === 1 ? 'model' : 'models'}`;
    return runtime.version ? `Running · ${runtime.version} · ${models}` : `Running · ${models}`;
  }
  if (connection.provider === 'other') {
    return connection.secretRef ? `${connection.baseUrl} · key saved` : connection.baseUrl;
  }
  return 'Connected';
}

async function forget(connection: Connection): Promise<void> {
  await architect().connections.remove({
    provider: connection.provider,
    baseUrl: connection.baseUrl,
  });
  forgetModelList(connection.id);
  await Promise.all([
    fetchQuery(queryKeys.secrets, api.secretsStatus),
    fetchQuery(queryKeys.settings, api.settings),
  ]);
}

export interface ConnectionsSectionProps {
  connections: readonly Connection[];
  /** Whether the runtimes here are still being looked for. */
  detecting: boolean;
}

/**
 * Where models come from: keys and sign-ins for hosted providers and endpoints added by address,
 * up front, each with a Disconnect. The runtimes on this computer (llama.cpp's among them) and
 * the Hugging Face token are for few people, so they wait under Advanced, which opens itself when
 * Ollama isn't running, since that is what a local model needs.
 */
export function ConnectionsSection({ connections, detecting }: ConnectionsSectionProps) {
  const [adding, setAdding] = useState(false);
  const signIn = useOpenRouterSignIn();
  const signedIn = connections.some((connection) => connection.provider === 'openrouter');
  const waiting = signIn.state.phase === 'waiting';

  const keyed = connections.filter((connection) => !connection.local);
  const here = connections.filter((connection) => connection.local);
  const ollamaDown = here.some(
    (connection) => connection.provider === 'ollama' && connection.runtime?.running === false,
  );

  return (
    <section aria-label="Connections" className="flex flex-col">
      <h3 className="m-0 border-t border-line pb-2 pt-6 text-md font-medium">Connections</h3>
      {keyed.map(row)}
      <div className="flex flex-wrap items-center gap-2 border-t border-line pt-4">
        {!signedIn && (
          <Button size="sm" loading={waiting} onClick={() => void signIn.start()}>
            {!waiting && <KeyRound size={14} aria-hidden />}
            {waiting ? 'Waiting for your browser' : `Sign in with ${PROVIDERS.openrouter.label}`}
          </Button>
        )}
        {waiting && (
          <Button size="sm" variant="ghost" onClick={signIn.cancel}>
            Cancel
          </Button>
        )}
        <Button size="sm" onClick={() => setAdding(true)}>
          <Plus size={14} aria-hidden />
          Add API key
        </Button>
      </div>
      {signIn.state.phase === 'failed' && (
        <p role="alert" className="m-0 pt-3 text-sm text-danger text-pretty">
          {signIn.state.message}
        </p>
      )}
      <Disclosure label="Advanced" defaultOpen={ollamaDown} className="pt-5">
        <div className="flex flex-col">
          <HuggingFaceRow />
          {here.map(row)}
          <LlamaServerRow />
          {detecting && (
            <div className="flex min-h-[60px] items-center gap-2.5 border-t border-line text-fg-muted">
              <Spinner size={13} />
              Looking for models on this computer
            </div>
          )}
        </div>
      </Disclosure>
      <AddKeyDialog open={adding} onOpenChange={setAdding} />
    </section>
  );
}

/** One connection's row: what it is, how it stands, and a way to remove or get it. */
function row(connection: Connection) {
  return (
    <SettingsRow
      key={connection.id}
      icon={
        <ProviderMark
          name={connection.label}
          icon={connection.local ? <Cpu aria-hidden /> : undefined}
        />
      }
      label={connection.label}
      meta={statusOf(connection)}
      metaFont={connection.provider === 'other' ? 'code' : 'text'}
    >
      {connection.runtime ? (
        !connection.runtime.running &&
        connection.provider === 'ollama' && (
          <Button
            size="xs"
            variant="ghost"
            onClick={() =>
              void attempt("Couldn't open the page", () =>
                architect().app.openProviderPage('ollama'),
              )
            }
          >
            <ExternalLink size={13} aria-hidden />
            Get Ollama
          </Button>
        )
      ) : (
        <Button
          size="xs"
          variant="ghost"
          onClick={() =>
            void attempt(`Couldn't disconnect ${connection.label}`, () => forget(connection))
          }
        >
          {connection.provider === 'other' ? 'Remove' : 'Disconnect'}
        </Button>
      )}
    </SettingsRow>
  );
}
