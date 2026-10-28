import type { CliOutcome } from '@architect/shared';
import { agentSlug, resolveAgent } from '../agents';
import { flag, type Parsed } from '../args';
import type { CliContext } from '../context';
import { installationLines, line, printJson } from '../render';

/**
 * Runs the active version's installation checks again: does it run on this computer, with its
 * folders, permissions and model. Never a new evaluation, and never shown as one.
 */
export async function verify(ctx: CliContext, parsed: Parsed): Promise<CliOutcome> {
  const { io } = ctx;
  const { library } = ctx.library();
  const agent = resolveAgent(library, parsed.args[0] ?? '');
  io.installGuard();
  const installation = await library.verify(agent.id, {
    loadModel: !flag(parsed.values, 'no-model-check'),
  });
  if (flag(parsed.values, 'json')) {
    printJson(io.stdout, 'architect.verify/1', {
      agent: { id: agent.id, name: agent.name, slug: agentSlug(agent) },
      installation,
    });
  } else {
    for (const text of installationLines(installation, agent.name)) line(io.stdout, text);
  }
  return installation.status === 'ready' ? 'succeeded' : 'not_permitted';
}
