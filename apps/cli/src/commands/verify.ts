import { verifyEvidencePack } from '@architect/engine/graduates';
import type { CliOutcome } from '@architect/shared';
import { agentSlug, resolveAgent } from '../agents';
import { flag, stringOption, type Parsed } from '../args';
import type { CliContext } from '../context';
import { CliError } from '../exit';
import { installationLines, line, printJson } from '../render';

/**
 * Runs the active version's installation checks again: does it run on this computer, with its
 * folders, permissions and model. Never a new evaluation, and never shown as one. With --pack,
 * checks an evidence pack instead, reading nothing but its own files.
 */
export async function verify(ctx: CliContext, parsed: Parsed): Promise<CliOutcome> {
  const { io } = ctx;
  const packDir = stringOption(parsed.values, 'pack');
  if (packDir !== undefined) return verifyPack(ctx, ctx.path(packDir), flag(parsed.values, 'json'));
  const named = parsed.args[0];
  if (named === undefined) {
    throw new CliError(
      'invalid_input',
      'usage',
      'Name the agent to check, or an evidence pack with --pack <folder>.',
    );
  }
  const { library } = ctx.library();
  const agent = resolveAgent(library, named);
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

/**
 * Checks every file of an evidence pack against its MANIFEST.json, with the network guard on: it
 * needs no data folder, no agent and no network, so it runs on a reviewer's air-gapped computer.
 */
async function verifyPack(ctx: CliContext, dir: string, json: boolean): Promise<CliOutcome> {
  const { io } = ctx;
  io.installGuard();
  const check = await verifyEvidencePack(dir);
  if (json) {
    printJson(io.stdout, 'architect.verify-pack/1', { pack: dir, ...check });
  } else {
    const what = check.agent
      ? `The evidence pack for ${check.agent.name}, version ${check.agent.version}`
      : `The evidence pack at ${dir}`;
    if (check.ok) {
      line(io.stdout, `${what}: all ${check.checked} files match its MANIFEST.json.`);
    } else {
      const count = check.problems.length;
      line(io.stdout, `${what} doesn't check out: ${count} problem${count === 1 ? '' : 's'}.`);
      for (const problem of check.problems) line(io.stdout, `  ${problem}`);
    }
    if (check.manifestSha256 !== undefined) {
      line(io.stdout, `sha256 of its MANIFEST.json: ${check.manifestSha256}`);
    }
  }
  return check.ok ? 'succeeded' : 'not_permitted';
}
