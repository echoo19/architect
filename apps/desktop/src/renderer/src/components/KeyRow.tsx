import { useState } from 'react';
import { Button, Input, SettingsRow } from '@architect/ui';
import { api, architect } from '../api/client';
import { queryKeys, useSecretsStatus } from '../api/hooks';
import { fetchQuery } from '../api/query';
import { attempt } from '../lib/notify';
import { currentPlatform, deviceInSentence } from '../lib/platform';
import { errorOf } from './QueryValue';

export interface KeyRowProps {
  /** The name the key is stored under. */
  secretRef: string;
  /** Who issued the key, as people know them: "Meta". */
  provider: string;
}

/** Saves a provider's API key in the app's encrypted store. A saved key is never shown again. */
export function KeyRow({ secretRef, provider }: KeyRowProps) {
  const secrets = useSecretsStatus();
  const [value, setValue] = useState('');
  const [saving, setSaving] = useState(false);
  const label = `${provider} API key`;
  const stored = secrets.status === 'success' && secrets.data[secretRef] === true;

  const save = async () => {
    setSaving(true);
    const saved = await attempt(`Couldn't save the ${label}`, async () => {
      await architect().secrets.set(secretRef, value.trim());
      await fetchQuery(queryKeys.secrets, api.secretsStatus);
      return true;
    });
    setSaving(false);
    if (saved) setValue('');
  };

  return (
    <SettingsRow
      label={label}
      meta={`${stored ? 'Saved. ' : ''}Encrypted on ${deviceInSentence(currentPlatform())}, and only ever sent to ${provider}.`}
      error={errorOf(secrets)}
    >
      <form
        className="flex items-center gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          if (value.trim()) void save();
        }}
      >
        <Input
          type="password"
          aria-label={label}
          placeholder={stored ? 'Paste to replace' : 'Paste a key'}
          value={value}
          onChange={(event) => setValue(event.target.value)}
          autoComplete="off"
          spellCheck={false}
          className="w-44"
        />
        <Button type="submit" size="xs" loading={saving} disabled={!value.trim()}>
          {stored ? 'Replace' : 'Save'}
        </Button>
      </form>
    </SettingsRow>
  );
}
