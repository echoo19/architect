import type { Usage } from '@architect/shared';

/** A usage record that leaves out the counts an endpoint didn't report instead of filling in zeros. */
export function makeUsage(
  inputTokens: number,
  outputTokens: number,
  extra: { reasoningTokens?: number; cachedInputTokens?: number } = {},
): Usage {
  const usage: Usage = { inputTokens, outputTokens };
  if (extra.reasoningTokens !== undefined) usage.reasoningTokens = extra.reasoningTokens;
  if (extra.cachedInputTokens !== undefined) usage.cachedInputTokens = extra.cachedInputTokens;
  return usage;
}
