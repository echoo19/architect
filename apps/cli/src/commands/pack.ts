import { statSync } from 'node:fs';
import { basename } from 'node:path';
import { writeEvidencePack } from '@architect/engine/graduates';
import type { CliOutcome, WeightsState } from '@architect/shared';
import { agentSlug, resolveAgent } from '../agents';
import { countOption, flag, stringOption, type Parsed } from '../args';
import type { CliContext } from '../context';
import { asRefusal, CliError } from '../exit';
import { bytes, line, printJson } from '../render';

const WEIGHTS: Record<WeightsState, string> = {
  referenced: 'The base model is named by its hash, not copied. Add --with-weights to copy it.',
  copied: "The base model's file is in weights/.",
  missing: "The base model isn't on this computer, so it is named by its hash only.",
};

/**
 * Writes a version's evidence pack (decision 095): one folder for a security reviewer and an
 * offline install, every file hashed in its MANIFEST.json. Nothing in it reaches the network.
 */
export async function pack(ctx: CliContext, parsed: Parsed): Promise<CliOutcome> {
  const { io } = ctx;
  const { values } = parsed;
  const target = stringOption(values, 'out');
  if (target === undefined) {
    throw new CliError('invalid_input', 'usage', 'Say where to write it with --out <folder>.');
  }
  const directory = ctx.path(target);
  const info = statSync(directory, { throwIfNoEntry: false });
  if (info !== undefined && !info.isDirectory()) {
    throw new CliError('invalid_input', 'not_a_folder', `${directory} isn't a folder.`);
  }
  const { library } = ctx.library();
  const agent = resolveAgent(library, parsed.args[0] ?? '');
  io.installGuard();
  const version = countOption(values, 'version');
  const result = await writeEvidencePack({ library }, agent.id, {
    directory,
    ...(version === undefined ? {} : { version }),
    ...(flag(values, 'with-weights') ? { withWeights: true } : {}),
  }).catch((error: unknown) => {
    throw asRefusal(error, 'invalid_request');
  });
  if (flag(values, 'json')) {
    printJson(io.stdout, 'architect.pack/1', {
      agent: { id: agent.id, name: agent.name, slug: agentSlug(agent) },
      ...result,
    });
  } else {
    line(
      io.stdout,
      `Wrote ${basename(result.folder)}: ${agent.name} version ${result.version}, ${result.files.length} files, ${bytes(result.bytes)}.`,
    );
    line(io.stdout, WEIGHTS[result.weights]);
    line(io.stdout, `sha256 of its MANIFEST.json: ${result.manifestSha256}`);
    line(io.stdout, `Check it anywhere with: architect verify --pack ${result.folder}`);
  }
  return 'succeeded';
}
