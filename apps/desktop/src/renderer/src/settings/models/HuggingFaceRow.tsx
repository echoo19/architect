import { useState, type FormEvent } from 'react';
import type { HubTokenStatus } from '@architect/shared';
import {
  Button,
  Dialog,
  DialogClose,
  DialogContent,
  DialogFooter,
  Input,
  ProviderMark,
  SettingsRow,
  Skeleton,
} from '@architect/ui';
import { ExternalLink, KeyRound } from 'lucide-react';
import { api, architect } from '../../api/client';
import { queryKeys, useHubToken } from '../../api/hooks';
import { fetchQuery, toError } from '../../api/query';
import { errorOf, RetryButton } from '../../components/QueryValue';
import { HUB_TOKENS_PAGE, tokenSourceText } from '../../hub/labels';
import { attempt } from '../../lib/notify';

/** Reads again where the token comes from, and which keys are saved. */
async function refreshToken(): Promise<void> {
  await Promise.all([
    fetchQuery(queryKeys.hubToken, api.hubToken),
    fetchQuery(queryKeys.secrets, api.secretsStatus),
  ]);
}

/**
 * Hugging Face, beside the other keys: where its token comes from (the key saved here, an
 * environment variable or `hf auth login`'s file, never the token itself), a way to save one,
 * and a way to remove the saved one. A saved token is used before the others.
 */
export function HuggingFaceRow() {
  const token = useHubToken();
  const [adding, setAdding] = useState(false);
  const source = token.data?.source;

  return (
    <>
      <SettingsRow
        icon={<ProviderMark name="Hugging Face" />}
        label="Hugging Face"
        meta={token.status === 'success' ? tokenSourceText(token.data.source) : undefined}
        error={errorOf(token)}
      >
        {token.status === 'error' ? (
          <RetryButton onClick={token.reload} />
        ) : token.status === 'loading' ? (
          <Skeleton shape="pill" className="h-4 w-20" />
        ) : source === 'saved' ? (
          <Button
            size="xs"
            variant="ghost"
            onClick={() =>
              void attempt("Couldn't remove the Hugging Face token", async () => {
                await architect().secrets.clear('huggingface');
                await refreshToken();
              })
            }
          >
            Remove token
          </Button>
        ) : (
          <Button size="xs" onClick={() => setAdding(true)}>
            <KeyRound size={14} aria-hidden />
            Add token
          </Button>
        )}
      </SettingsRow>
      <HubTokenDialog open={adding} onOpenChange={setAdding} source={source ?? null} />
    </>
  );
}

/** What the dialog says of a token saved here: what it needs, where it's kept, what it replaces. */
function tokenNote(source: HubTokenStatus['source']): string {
  const kept = 'Publishing needs write access. It is kept encrypted on this computer';
  if (source === 'HF_TOKEN' || source === 'HUGGING_FACE_HUB_TOKEN') {
    return `${kept}, and used instead of ${source}.`;
  }
  if (source === 'token_file') return `${kept}, and used instead of the token from hf auth login.`;
  return `${kept}.`;
}

/** Saves a Hugging Face token in the app's encrypted store. It is never shown again. */
function HubTokenDialog({
  open,
  onOpenChange,
  source,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Where the token comes from now. */
  source: HubTokenStatus['source'];
}) {
  const [value, setValue] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const close = (next: boolean) => {
    if (!next) {
      setValue('');
      setError(null);
    }
    onOpenChange(next);
  };

  const save = async (event: FormEvent) => {
    event.preventDefault();
    setSaving(true);
    setError(null);
    try {
      await architect().secrets.set('huggingface', value.trim());
      await refreshToken();
      close(false);
    } catch (failure) {
      setError(toError(failure).message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent title="Add a Hugging Face token" description={tokenNote(source)}>
        <form onSubmit={(event) => void save(event)}>
          <div className="flex flex-col gap-3 px-7 pt-5">
            <Input
              type="password"
              aria-label="Hugging Face token"
              placeholder="hf_..."
              value={value}
              onChange={(event) => setValue(event.target.value)}
              autoComplete="off"
              spellCheck={false}
            />
            {error && (
              <p role="alert" className="m-0 text-sm text-danger text-pretty">
                {error}
              </p>
            )}
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="ghost"
              size="md"
              className="mr-auto"
              onClick={() =>
                void attempt("Couldn't open the page", () =>
                  architect().app.openLink(HUB_TOKENS_PAGE),
                )
              }
            >
              <ExternalLink size={14} aria-hidden />
              Get a token
            </Button>
            <DialogClose asChild>
              <Button size="md">Cancel</Button>
            </DialogClose>
            <Button
              type="submit"
              variant="primary"
              size="md"
              loading={saving}
              disabled={!value.trim()}
            >
              Save
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
