import type { HarnessTool } from '@architect/shared';
import type { Sandbox } from './types';

/**
 * Why a tool's code doesn't load in the sandbox, or null when it does. A sandbox that crashed
 * says nothing about the tool, so that is thrown instead, for the caller to stop on.
 */
export async function toolLoadProblem(
  sandbox: Sandbox,
  tool: Pick<HarnessTool, 'name' | 'code'>,
): Promise<string | null> {
  const outcome = await sandbox.checkTool(tool);
  if (outcome.ok) return null;
  if (outcome.failure.kind === 'crashed') {
    throw new Error(`The tool sandbox stopped while loading a tool: ${outcome.failure.message}`);
  }
  return outcome.failure.message;
}
