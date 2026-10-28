import { existsSync } from 'node:fs';
import { join } from 'node:path';
import type { CliOutcome, GraduateSummary } from '@architect/shared';
import { agentSlug } from '../agents';
import { flag, type Parsed } from '../args';
import type { CliContext } from '../context';
import { line, printJson, table } from '../render';

/** Every agent on this computer, with the name to run it by and whether it can run here. */
export async function list(ctx: CliContext, parsed: Parsed): Promise<CliOutcome> {
  const { io } = ctx;
  const agents: GraduateSummary[] = existsSync(join(ctx.dataDir, 'architect.db'))
    ? ctx.library().library.list()
    : [];
  if (flag(parsed.values, 'json')) {
    printJson(io.stdout, 'architect.list/1', {
      dataDir: ctx.dataDir,
      agents: agents.map((agent) => ({
        id: agent.id,
        name: agent.name,
        slug: agentSlug(agent),
        activeVersion: agent.activeVersion,
        versions: agent.versions,
        status: agent.status,
        reasons: agent.reasons,
      })),
    });
    return 'succeeded';
  }
  if (agents.length === 0) {
    line(io.stderr, `No agents in ${ctx.dataDir}. Install one with \`architect install\`.`);
    return 'succeeded';
  }
  line(
    io.stdout,
    table([
      ['NAME', 'ID', 'VERSION', 'STATUS'],
      ...agents.map((agent) => [
        agentSlug(agent),
        agent.id,
        agent.activeVersion === null ? '-' : `v${agent.activeVersion}`,
        agent.status.replace('_', ' '),
      ]),
    ]),
  );
  return 'succeeded';
}
