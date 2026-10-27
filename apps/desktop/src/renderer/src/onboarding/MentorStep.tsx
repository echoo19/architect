import { useState, type FormEvent } from 'react';
import {
  MENTOR_PRESETS,
  type ConnectionTest,
  type MentorConfig,
  type MentorPreset,
  ConnectionTestSchema,
} from '@architect/shared';
import {
  Button,
  Heading,
  Input,
  Panel,
  RadioCard,
  RadioCardGroup,
  SettingsRow,
} from '@architect/ui';
import { CircleAlert, CircleCheck } from 'lucide-react';
import { architect } from '../api/client';
import { toError, type QueryState } from '../api/query';
import { CopyButton } from '../components/CopyButton';
import { errorOf } from '../components/QueryValue';
import { aboutUsd, mentorUsdFor, TYPICAL_ROUNDS } from '../flow/define/estimates';
import { shortModelName } from '../lib/names';
import { currentPlatform, deviceInSentence } from '../lib/platform';
import { KEY_PAGES, mentorNote, presetFor, providerName } from './mentor';
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

/** Mentors on Meta's own API, and the open-weight model through a host the user picks. */
const MENTOR_GROUPS = [
  { title: "Meta's API", presets: MENTOR_PRESETS.filter((preset) => preset.provider === 'meta') },
  {
    title: 'The open version of Spark, through a host you choose',
    presets: MENTOR_PRESETS.filter((preset) => preset.provider !== 'meta'),
  },
];

/** What a mentor usually costs per agent, and who bills it when that isn't Meta. */
function costLine(preset: MentorPreset): string {
  const cost = `${aboutUsd(mentorUsdFor(preset.pricing, TYPICAL_ROUNDS))} to train an agent`;
  return preset.provider === 'meta' ? cost : `${cost}, billed by ${providerName(preset.provider)}`;
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
        The mentor is a paid cloud model that coaches each new agent while it trains, round by round
        improving its instructions. Once training ends, your agents never call it.
      </StepIntro>
      <div className="flex w-full max-w-[720px] flex-col gap-3.5">
        {MENTOR_GROUPS.map((group) => (
          <section key={group.title} className="flex flex-col gap-2">
            <Heading as="h2" className="text-fg-secondary">
              {group.title}
            </Heading>
            <RadioCardGroup
              aria-label={group.title}
              value={preset?.key ?? ''}
              onValueChange={(next) => {
                const chosen = MENTOR_PRESETS.find((option) => option.key === next);
                if (!chosen) return;
                onResult(null);
                onChoose(chosen);
              }}
            >
              {group.presets.map((option) => (
                // Locked while a test runs, so its result can't land under another mentor.
                <RadioCard
                  key={option.key}
                  value={option.key}
                  title={option.label}
                  disabled={testing}
                >
                  <span className="text-fg text-pretty">{mentorNote(option)}</span>
                  <span>{costLine(option)}</span>
                </RadioCard>
              ))}
            </RadioCardGroup>
          </section>
        ))}
        <p className="m-0 text-sm text-fg-muted text-pretty">
          Costs are for training one agent over up to {TYPICAL_ROUNDS} rounds; in each, the mentor
          studies the agent&apos;s mistakes and improves its instructions. You set a spending cap
          for every agent you train.
        </p>
        {mentor.kind === 'model' && (
          <Panel aria-label="Mentor key" className="px-7 py-1 [&>*:first-child]:border-t-0">
            <form onSubmit={(event) => void test(event)}>
              <SettingsRow
                label={`${provider} API key`}
                meta={
                  stored
                    ? `Saved, encrypted on ${device}`
                    : `Each host has its own key; this one is for ${provider}. Encrypted on ${device}, never shown again.`
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
        {preset && !stored && <KeySource page={KEY_PAGES[preset.provider]} />}
      </div>
    </>
  );
}

/**
 * Where to make a key, and that the step can wait. Architect doesn't open web pages itself, so
 * the address is there to copy into a browser.
 */
function KeySource({ page }: { page: { url: string; where: string } }) {
  return (
    <p className="m-0 flex flex-wrap items-center justify-center gap-x-1 text-sm text-fg-muted">
      No key yet? Make one {page.where} at
      <span className="font-mono text-fg-secondary">{page.url}</span>
      <CopyButton text={page.url} label="Copy the address" className="-my-1" />
      or skip this step and add one later in Settings.
    </p>
  );
}
