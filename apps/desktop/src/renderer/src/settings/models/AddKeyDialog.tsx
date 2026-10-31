import { useState, type FormEvent } from 'react';
import {
  AddConnectionResultSchema,
  PROVIDERS,
  type AddConnectionResult,
  type ProviderId,
} from '@architect/shared';
import {
  Button,
  Dialog,
  DialogClose,
  DialogContent,
  DialogFooter,
  Input,
  Select,
} from '@architect/ui';
import { ExternalLink } from 'lucide-react';
import { api, architect } from '../../api/client';
import { queryKeys } from '../../api/hooks';
import { fetchQuery, toError } from '../../api/query';
import { attempt } from '../../lib/notify';
import { KEY_PROVIDERS } from './connections';
import { forgetModelList } from './hooks';

const PROVIDER_OPTIONS = [
  ...KEY_PROVIDERS.map((id) => ({ value: id, label: PROVIDERS[id].label })),
  { value: 'other' as const, label: 'OpenAI-compatible endpoint: vLLM, SGLang, TGI, llama-server' },
];

export interface AddKeyDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The provider the form starts on. */
  provider?: ProviderId;
  /** Told what was added, once the key checked out and was saved. */
  onAdded?: (provider: ProviderId, result: AddConnectionResult) => void;
}

/**
 * Adds a provider's key, or an endpoint by its address with a key if it needs one: a hosted API
 * or a server on a cluster node, since vLLM, SGLang, TGI and llama-server all answer the OpenAI
 * API. Main checks the key with the provider before saving it, so a key that is refused never
 * lands in the store.
 */
export function AddKeyDialog({ open, onOpenChange, provider, onAdded }: AddKeyDialogProps) {
  const [chosen, setChosen] = useState<ProviderId>(provider ?? 'openai');
  const [address, setAddress] = useState('');
  const [key, setKey] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const other = chosen === 'other';
  const page = PROVIDERS[chosen].page;

  const close = (next: boolean) => {
    if (!next) {
      setKey('');
      setError(null);
    }
    onOpenChange(next);
  };

  const save = async (event: FormEvent) => {
    event.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const result = AddConnectionResultSchema.parse(
        await architect().connections.add({
          provider: chosen,
          ...(other ? { baseUrl: address.trim() } : {}),
          ...(key.trim() ? { key: key.trim() } : {}),
        }),
      );
      // A new key can open up other models; an added endpoint has no list cached yet.
      if (!other) forgetModelList(chosen);
      await Promise.all([
        fetchQuery(queryKeys.secrets, api.secretsStatus),
        fetchQuery(queryKeys.settings, api.settings),
      ]);
      setAddress('');
      close(false);
      onAdded?.(chosen, result);
    } catch (failure) {
      setError(toError(failure).message);
    } finally {
      setSaving(false);
    }
  };

  const ready = other ? address.trim() !== '' : key.trim() !== '';

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent title="Add a provider or endpoint">
        <form onSubmit={(event) => void save(event)}>
          <div className="flex flex-col gap-3 px-7 pt-5">
            <Select<ProviderId>
              aria-label="Provider"
              options={PROVIDER_OPTIONS}
              value={chosen}
              onValueChange={(next) => {
                setChosen(next);
                setError(null);
              }}
              className="w-full"
            />
            {other && (
              <Input
                aria-label="Address"
                placeholder="http://gpu-node-7:8000/v1"
                value={address}
                onChange={(event) => setAddress(event.target.value)}
                autoComplete="off"
                spellCheck={false}
              />
            )}
            <Input
              type="password"
              aria-label="API key"
              placeholder={
                other ? 'API key, if it needs one' : `${PROVIDERS[chosen].label} API key`
              }
              value={key}
              onChange={(event) => setKey(event.target.value)}
              autoComplete="off"
              spellCheck={false}
            />
            {error && (
              <p role="alert" className="m-0 text-small text-danger text-pretty">
                {error}
              </p>
            )}
          </div>
          <DialogFooter>
            {page && (
              <Button
                type="button"
                variant="ghost"
                size="md"
                className="mr-auto"
                onClick={() =>
                  void attempt("Couldn't open the page", () =>
                    architect().app.openProviderPage(chosen),
                  )
                }
              >
                <ExternalLink size={14} aria-hidden />
                Get a key
              </Button>
            )}
            <DialogClose asChild>
              <Button size="md">Cancel</Button>
            </DialogClose>
            <Button type="submit" variant="primary" size="md" loading={saving} disabled={!ready}>
              Add
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
