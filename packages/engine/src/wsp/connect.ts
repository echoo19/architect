import { GuardError, WSP_MENTOR, keyDestinationProblem, type WspMentorStatus } from '@architect/shared';
import type { EngineHostDeps } from '../loop/deps';
import { astraClient, type WspMentorClient } from './mentor';
import { standInMentor } from './stand-in';

/*
 * Architect WSP's mentor (decision 109): GPT-6 Astra through the stored OpenAI key, the only key
 * it may use and the only host that key may reach. A development build started with
 * ARCHITECT_WSP_MENTOR=stand-in uses the scripted stand-in instead, which every record marks.
 */

const standIn = () => process.env['ARCHITECT_WSP_MENTOR'] === 'stand-in';

export async function wspMentorStatus(deps: Pick<EngineHostDeps, 'secrets'>): Promise<WspMentorStatus> {
  const mentor = {
    label: standIn() ? 'Stand-in mentor' : WSP_MENTOR.label,
    provider: WSP_MENTOR.provider,
    model: standIn() ? 'scripted' : WSP_MENTOR.model,
    reasoningEffort: 'high' as const,
    standIn: standIn(),
  };
  if (standIn()) return { mentor, status: 'ready' };
  const key = await deps.secrets.get(WSP_MENTOR.secretRef);
  return key
    ? { mentor, status: 'ready' }
    : {
        mentor,
        status: 'missing-key',
        reason: `${WSP_MENTOR.label} needs an OpenAI key. Add it in Settings, Keys.`,
      };
}

export async function connectWspMentor(
  deps: Pick<EngineHostDeps, 'secrets' | 'adapters'>,
  reasoningEffort: 'low' | 'medium' | 'high',
): Promise<WspMentorClient> {
  if (standIn()) return standInMentor();
  const problem = keyDestinationProblem(WSP_MENTOR.secretRef, WSP_MENTOR.baseUrl);
  if (problem !== null) throw new GuardError('permission', problem);
  const apiKey = await deps.secrets.get(WSP_MENTOR.secretRef);
  if (!apiKey) throw new Error(`${WSP_MENTOR.label} needs an OpenAI key. Add it in Settings, Keys.`);
  const adapter = deps.adapters.createMentor(
    {
      kind: 'model',
      provider: WSP_MENTOR.provider,
      label: WSP_MENTOR.label,
      baseUrl: WSP_MENTOR.baseUrl,
      model: WSP_MENTOR.model,
      reasoningEffort,
      secretRef: WSP_MENTOR.secretRef,
      pricing: WSP_MENTOR.pricing,
    },
    { apiKey },
  );
  return astraClient(adapter, reasoningEffort, WSP_MENTOR.pricing);
}
