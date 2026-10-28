import { useState, type FormEvent, type ReactNode } from 'react';
import {
  ConnectionTestSchema,
  mentorPreset,
  PROVIDERS,
  type ConnectionTest,
  type MentorConfig,
} from '@architect/shared';
import {
  Button,
  Input,
  Panel,
  ProviderMark,
  RadioCard,
  RadioCardGroup,
  SettingsRow,
} from '@architect/ui';
import { CircleAlert, CircleCheck, ExternalLink, KeyRound, Plus } from 'lucide-react';
import { architect } from '../api/client';
import { toError, type QueryState } from '../api/query';
import { errorOf } from '../components/QueryValue';
import { shortModelName } from '../lib/names';
import { attempt } from '../lib/notify';
import { AddKeyDialog } from '../settings/models/AddKeyDialog';
import { mentorFromChoice, type Connection } from '../settings/models/connections';
import { useConnections } from '../settings/models/hooks';
import { ModelPicker } from '../settings/models/ModelPicker';
import { useOpenRouterSignIn } from '../settings/models/useSignIn';
import { mentorFromPreset, mentorProvider, routeOf, type MentorRoute } from './mentor';
import { StepIntro } from './SetupShell';

const ROUTES: readonly { value: MentorRoute; title: string; line: string }[] = [
  { value: 'meta', title: 'Muse Spark', line: "Meta's model, with a Meta key" },
  { value: 'openrouter', title: 'OpenRouter', line: 'Sign in, then pick any of its models' },
  { value: 'key', title: 'Another provider', line: 'OpenAI, Anthropic, Gemini or any API key' },
  { value: 'local', title: 'On this computer', line: 'A model in Ollama or LM Studio' },
];

/** Which connections each way's picker lists. */
const ROUTE_CONNECTIONS: Record<MentorRoute, (connection: Connection) => boolean> = {
  meta: (connection) => connection.provider === 'meta',
  openrouter: (connection) => connection.provider === 'openrouter',
  key: (connection) =>
    !connection.local && connection.provider !== 'meta' && connection.provider !== 'openrouter',
  local: (connection) => connection.local,
};

async function testMentor(config: MentorConfig): Promise<ConnectionTest> {
  const reply = ConnectionTestSchema.safeParse(await architect().connections.testMentor(config));
  if (reply.success) return reply.data;
  console.error("[setup] connections.testMentor returned data that doesn't match.", reply.error);
  return { ok: false, error: "Architect received a reply it couldn't read." };
}

function ConnectionResult({ result }: { result: ConnectionTest }) {
  const Icon = result.ok ? CircleCheck : CircleAlert;
  return (
    <div
      role={result.ok ? 'status' : 'alert'}
      className="flex items-start gap-2.5 border-t border-line py-3.5"
    >
      <Icon
        size={16}
        className={result.ok ? 'mt-0.5 shrink-0 text-student' : 'mt-0.5 shrink-0 text-danger'}
        aria-hidden
      />
      <div className="flex min-w-0 flex-col gap-0.5">
        <span className={result.ok ? undefined : 'text-fg-soft'}>
          {result.ok ? `Connected · ${result.latencyMs} ms` : result.error}
        </span>
        {!result.ok && result.hint && (
          <span className="text-sm text-fg-muted text-pretty">{result.hint}</span>
        )}
      </div>
    </div>
  );
}

function openPage(provider: 'meta' | 'ollama'): void {
  void attempt("Couldn't open the page", () => architect().app.openProviderPage(provider));
}

export interface MentorStepProps {
  mentor: MentorConfig;
  route: MentorRoute;
  onRoute: (route: MentorRoute) => void;
  onMentor: (mentor: MentorConfig) => void;
  /** Which secret refs have a stored key. */
  secrets: QueryState<Record<string, boolean>>;
  result: ConnectionTest | null;
  onResult: (result: ConnectionTest | null) => void;
}

/**
 * The mentor: Muse Spark with a Meta key by default, or a sign-in with OpenRouter, another
 * provider's key, or a model on this computer. Each way ends at a picker and a test.
 */
export function MentorStep({
  mentor,
  route,
  onRoute,
  onMentor,
  secrets,
  result,
  onResult,
}: MentorStepProps) {
  const { connections } = useConnections();
  const [testing, setTesting] = useState(false);
  const [adding, setAdding] = useState(false);
  const [key, setKey] = useState('');
  const signIn = useOpenRouterSignIn();
  const available = connections.filter(ROUTE_CONNECTIONS[route]);
  const model = mentor.kind === 'model' ? mentor : null;
  const chosenHere = model !== null && route === routeOf(model);
  const metaSaved = secrets.data?.['meta'] === true;
  const waiting = signIn.state.phase === 'waiting';

  const chooseRoute = (next: MentorRoute) => {
    onResult(null);
    onRoute(next);
    if (next === 'meta' && model?.provider !== 'meta') {
      onMentor(mentorFromPreset(mentorPreset('meta-spark'), mentor));
    }
  };

  const test = async (event?: FormEvent) => {
    event?.preventDefault();
    if (!model) return;
    setTesting(true);
    onResult(null);
    try {
      const value = key.trim();
      if (value && model.secretRef !== undefined) {
        await architect().secrets.set(model.secretRef, value);
        setKey('');
        secrets.reload();
      }
      onResult(await testMentor(model));
    } catch (error) {
      onResult({ ok: false, error: toError(error).message });
    } finally {
      setTesting(false);
    }
  };

  /** The way's connections in one picker, with a test of the mentor chosen from it. */
  const picker = (
    <SettingsRow label="Mentor">
      <span className="flex items-center gap-2">
        <ModelPicker
          role="mentor"
          aria-label="Mentor"
          only={ROUTE_CONNECTIONS[route]}
          current={chosenHere ? model : null}
          onChoose={(choice) => {
            onResult(null);
            onMentor(mentorFromChoice(choice, model?.reasoningEffort ?? 'medium'));
          }}
          className="w-64"
        >
          <span className="truncate">
            {chosenHere ? shortModelName(model.label) : 'Choose a model'}
          </span>
          {chosenHere && <span className="shrink-0 text-fg-muted">{mentorProvider(model)}</span>}
        </ModelPicker>
        {chosenHere && (
          <Button size="xs" loading={testing} onClick={() => void test()}>
            Test
          </Button>
        )}
      </span>
    </SettingsRow>
  );

  let body: ReactNode;
  if (route === 'meta') {
    body = (
      <form onSubmit={(event) => void test(event)}>
        <SettingsRow
          icon={<ProviderMark name="Meta" />}
          label="Meta API key"
          meta={metaSaved ? 'Saved' : undefined}
          error={errorOf(secrets)}
        >
          <div className="flex min-w-0 flex-[1_1_320px] gap-2">
            <Input
              type="password"
              aria-label="Meta API key"
              placeholder={metaSaved ? 'Paste a new key to replace it' : 'Paste your key'}
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
              disabled={!key.trim() && !metaSaved}
            >
              Test connection
            </Button>
          </div>
        </SettingsRow>
        {!metaSaved && (
          <SettingsRow label="No key yet?">
            <Button type="button" size="xs" variant="ghost" onClick={() => openPage('meta')}>
              <ExternalLink size={13} aria-hidden />
              Get one from Meta
            </Button>
          </SettingsRow>
        )}
      </form>
    );
  } else if (route === 'openrouter') {
    body =
      available.length > 0 ? (
        picker
      ) : (
        <SettingsRow
          icon={<ProviderMark name="OpenRouter" />}
          label={PROVIDERS.openrouter.label}
          error={signIn.state.phase === 'failed' ? signIn.state.message : undefined}
        >
          <span className="flex items-center gap-2">
            {waiting && (
              <Button size="xs" variant="ghost" onClick={signIn.cancel}>
                Cancel
              </Button>
            )}
            <Button size="xs" loading={waiting} onClick={() => void signIn.start()}>
              {!waiting && <KeyRound size={13} aria-hidden />}
              {waiting ? 'Waiting for your browser' : 'Sign in'}
            </Button>
          </span>
        </SettingsRow>
      );
  } else if (route === 'key') {
    body = (
      <>
        {available.length > 0 && picker}
        <SettingsRow label={available.length > 0 ? 'Another key' : 'API key'}>
          <Button size="xs" onClick={() => setAdding(true)}>
            <Plus size={13} aria-hidden />
            Add
          </Button>
        </SettingsRow>
        <AddKeyDialog open={adding} onOpenChange={setAdding} />
      </>
    );
  } else {
    body =
      available.length > 0 ? (
        picker
      ) : (
        <SettingsRow label="No model runtime found">
          <Button size="xs" variant="ghost" onClick={() => openPage('ollama')}>
            <ExternalLink size={13} aria-hidden />
            Get Ollama
          </Button>
        </SettingsRow>
      );
  }

  return (
    <>
      <StepIntro title="Choose a mentor">
        It coaches each new agent while it trains. Your agents never call it.
      </StepIntro>
      <div className="flex w-full max-w-[720px] flex-col gap-3.5">
        <RadioCardGroup<MentorRoute>
          aria-label="Mentor"
          value={route}
          onValueChange={chooseRoute}
          className="grid-cols-[repeat(auto-fit,minmax(min(320px,100%),1fr))]"
        >
          {ROUTES.map((option) => (
            <RadioCard
              key={option.value}
              value={option.value}
              title={option.title}
              disabled={testing}
            >
              <span>{option.line}</span>
            </RadioCard>
          ))}
        </RadioCardGroup>
        <Panel aria-label="Mentor connection" className="px-7 py-1 [&>*:first-child]:border-t-0">
          {body}
          {result && <ConnectionResult result={result} />}
        </Panel>
      </div>
    </>
  );
}
