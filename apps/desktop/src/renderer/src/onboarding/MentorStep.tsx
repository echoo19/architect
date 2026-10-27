import { useState, type FormEvent } from 'react';
import {
  MENTOR_PRESETS,
  type ConnectionTest,
  type MentorConfig,
  type MentorPreset,
} from '@architect/shared';
import { Button, Input, Panel, RadioCard, RadioCardGroup, SettingsRow } from '@architect/ui';
import { CircleAlert, CircleCheck } from 'lucide-react';
import { architect } from '../api/client';
import { toError, type QueryState } from '../api/query';
import { errorOf } from '../components/QueryValue';
import { shortModelName } from '../lib/names';
import { currentPlatform, deviceInSentence } from '../lib/platform';
import { ConnectionTestSchema, formatPricing, presetFor, providerName } from './mentor';
import { StepIntro } from './SetupShell';

async function testMentor(config: MentorConfig): Promise<ConnectionTest> {
  const reply = ConnectionTestSchema.safeParse(await architect().connections.testMentor(config));
  if (reply.success) return reply.data;
  console.error("[setup] connections.testMentor returned data that doesn't match.", reply.error);
  return { ok: false, error: "Architect received a reply it couldn't read." };
}

function ConnectionResult({ result, mentor }: { result: ConnectionTest; mentor: string }) {
  if (result.ok) {
    return (
      <div role="status" className="flex items-start gap-2.5 border-t border-line py-3.5">
        <CircleCheck size={16} className="mt-0.5 shrink-0 text-student" aria-hidden />
        <div className="flex min-w-0 flex-col gap-0.5">
          <span>Connected to {mentor}</span>
          <span className="font-mono text-xs text-fg-muted">
            {result.detail} · {result.latencyMs} ms
          </span>
        </div>
      </div>
    );
  }
  return (
    <div role="alert" className="flex items-start gap-2.5 border-t border-line py-3.5">
      <CircleAlert size={16} className="mt-0.5 shrink-0 text-danger" aria-hidden />
      <div className="flex min-w-0 flex-col gap-0.5">
        <span className="text-fg-soft">{result.error}</span>
        {result.hint && <span className="text-sm text-fg-muted text-pretty">{result.hint}</span>}
      </div>
    </div>
  );
}

export interface MentorStepProps {
  mentor: MentorConfig;
  onChoose: (preset: MentorPreset) => void;
  /** Which secret refs have a stored key. */
  secrets: QueryState<Record<string, boolean>>;
  result: ConnectionTest | null;
  onResult: (result: ConnectionTest | null) => void;
}

export function MentorStep({ mentor, onChoose, secrets, result, onResult }: MentorStepProps) {
  const [key, setKey] = useState('');
  const [testing, setTesting] = useState(false);
  const preset = presetFor(mentor);
  const provider = preset ? providerName(preset.provider) : 'Mentor';
  const stored = mentor.kind === 'model' && secrets.data?.[mentor.secretRef] === true;
  const device = deviceInSentence(currentPlatform());

  const test = async (event: FormEvent) => {
    event.preventDefault();
    if (mentor.kind !== 'model') return;
    setTesting(true);
    onResult(null);
    try {
      const value = key.trim();
      if (value) {
        await architect().secrets.set(mentor.secretRef, value);
        setKey('');
        secrets.reload();
      }
      onResult(await testMentor(mentor));
    } catch (error) {
      onResult({ ok: false, error: toError(error).message });
    } finally {
      setTesting(false);
    }
  };

  return (
    <>
      <StepIntro title="Choose a mentor">
        The mentor watches a new agent practice and fixes its mistakes, only while training and
        under a spending cap. It never sees your chats.
      </StepIntro>
      <div className="flex w-full max-w-[720px] flex-col gap-4">
        <RadioCardGroup
          aria-label="Mentor"
          value={preset?.key ?? ''}
          onValueChange={(next) => {
            const chosen = MENTOR_PRESETS.find((option) => option.key === next);
            if (!chosen) return;
            onResult(null);
            onChoose(chosen);
          }}
        >
          {MENTOR_PRESETS.map((option) => (
            // Locked while a test runs, so its result can't land under another mentor.
            <RadioCard key={option.key} value={option.key} title={option.label} disabled={testing}>
              <span className="font-mono text-xs text-fg-muted">
                {formatPricing(option.pricing)}
              </span>
              <span className="text-pretty">{option.note}</span>
            </RadioCard>
          ))}
        </RadioCardGroup>
        {mentor.kind === 'model' && (
          <Panel aria-label="Mentor key" className="px-7 py-1 [&>*:first-child]:border-t-0">
            <form onSubmit={(event) => void test(event)}>
              <SettingsRow
                label={`${provider} API key`}
                meta={
                  stored
                    ? `Saved, encrypted on ${device}`
                    : `Encrypted on ${device}, never shown again`
                }
                error={errorOf(secrets)}
              >
                <div className="flex min-w-0 flex-[1_1_340px] gap-2">
                  <Input
                    type="password"
                    aria-label={`${provider} API key`}
                    placeholder={stored ? 'Paste a new key to replace it' : 'Paste your key'}
                    value={key}
                    onChange={(event) => setKey(event.target.value)}
                    autoComplete="off"
                    spellCheck={false}
                    className="min-w-0 flex-1"
                  />
                  <Button
                    type="submit"
                    size="md"
                    className="h-[38px]"
                    loading={testing}
                    disabled={!key.trim() && !stored}
                  >
                    Test connection
                  </Button>
                </div>
              </SettingsRow>
            </form>
            {result && <ConnectionResult result={result} mentor={shortModelName(mentor.label)} />}
          </Panel>
        )}
      </div>
    </>
  );
}
