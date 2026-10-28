import { statSync } from 'node:fs';
import {
  downloadFromHub,
  hubRepository,
  importPackage,
  type DownloadedPackage,
} from '@architect/engine/graduates';
import { HUB_SCHEME } from '@architect/engine/hub';
import {
  OLLAMA_BASE_URL,
  PermissionModeSchema,
  ResourceGrantSchema,
  type CliOutcome,
  type ImportRequest,
  type ImportResult,
  type VersionSource,
} from '@architect/shared';
import { agentSlug } from '../agents';
import { flag, pairs, stringOption, type Parsed } from '../args';
import type { CliContext } from '../context';
import { CliError } from '../exit';
import { installationLines, line, printJson } from '../render';

const RUNTIMES = ['ollama', 'openai_compatible'] as const;

/** The import request the options describe; nothing is granted that they don't name. */
function importRequest(ctx: CliContext, parsed: Parsed): ImportRequest {
  const { values } = parsed;
  const bindings = Object.fromEntries(
    Object.entries(pairs(values, 'bind')).map(([name, folder]) => {
      const path = ctx.path(folder);
      if (!statSync(path, { throwIfNoEntry: false })?.isDirectory()) {
        throw new CliError('invalid_input', 'not_a_folder', `${path} isn't a folder.`);
      }
      return [name, path];
    }),
  );
  const resources = Object.fromEntries(
    Object.entries(pairs(values, 'grant')).map(([name, access]) => {
      const grant = ResourceGrantSchema.safeParse(access);
      if (!grant.success) {
        throw new CliError(
          'invalid_input',
          'usage',
          `--grant takes read, read_write or none, not "${access}".`,
        );
      }
      return [name, grant.data];
    }),
  );
  const writesText = stringOption(values, 'writes');
  const writes = writesText === undefined ? undefined : PermissionModeSchema.safeParse(writesText);
  if (writes && !writes.success) {
    throw new CliError('invalid_input', 'usage', `--writes takes ask, allow or never.`);
  }
  const model = stringOption(values, 'model');
  const modelUrl = stringOption(values, 'model-url');
  const runtime = stringOption(values, 'runtime');
  if ((modelUrl !== undefined || runtime !== undefined) && model === undefined) {
    throw new CliError('invalid_input', 'usage', 'Name the model with --model as well.');
  }
  if (runtime !== undefined && !(RUNTIMES as readonly string[]).includes(runtime)) {
    throw new CliError('invalid_input', 'usage', `--runtime takes ${RUNTIMES.join(' or ')}.`);
  }
  return {
    bindings,
    ...(Object.keys(resources).length > 0 || writes
      ? { grants: { ...(writes ? { writes: writes.data } : {}), resources } }
      : {}),
    ...(model === undefined
      ? {}
      : {
          model: {
            runtime: (runtime ?? 'ollama') as (typeof RUNTIMES)[number],
            baseUrl: modelUrl ?? OLLAMA_BASE_URL,
            model,
          },
        }),
    loadModel: !flag(values, 'no-model-check'),
  };
}

/** An import the engine refused for what the request asked, rather than for a fault. */
function refused(error: unknown): unknown {
  const plain = error instanceof Error && error.constructor === Error && !('code' in error);
  return plain ? new CliError('invalid_input', 'install_refused', error.message) : error;
}

/**
 * Installs a package from a file, a folder, or a Hugging Face repository at one commit. The
 * download comes first; then the network guard goes up, and the import checks everything
 * before any of the package's code loads, binds what the options name and runs its checks.
 */
export async function install(
  ctx: CliContext,
  parsed: Parsed,
  signal: AbortSignal,
): Promise<CliOutcome> {
  const { io } = ctx;
  const [source = ''] = parsed.args;
  const revision = stringOption(parsed.values, 'revision');
  const request = importRequest(ctx, parsed);
  const { library } = ctx.library({ create: true });

  let downloaded: DownloadedPackage | null = null;
  let path: string;
  if (source.startsWith(HUB_SCHEME)) {
    const repository = hubRepository(source);
    line(
      io.stderr,
      revision === undefined
        ? `Looking up the commit ${repository} is at now. It is recorded, and never updated without you.`
        : `Fetching ${repository} at ${revision}.`,
    );
    downloaded = await downloadFromHub({ library, hub: ctx.hub() }, source, revision, signal);
    line(io.stderr, `Downloaded and checked commit ${downloaded.source.revision}.`);
    path = downloaded.dir;
  } else {
    if (revision !== undefined) {
      throw new CliError(
        'invalid_input',
        'usage',
        `--revision is for ${HUB_SCHEME} sources; a file is installed as it is.`,
      );
    }
    path = ctx.path(source);
    if (!statSync(path, { throwIfNoEntry: false })) {
      throw new CliError('invalid_input', 'not_found', `${path} doesn't exist.`);
    }
  }

  let result: ImportResult;
  let origin: VersionSource | undefined;
  try {
    io.installGuard();
    origin = downloaded?.source;
    result = await importPackage(
      { library },
      path,
      request,
      origin ? { source: origin } : {},
    ).catch((error: unknown) => {
      throw refused(error);
    });
  } finally {
    await downloaded?.discard();
  }

  const { graduate, installation } = result;
  if (flag(parsed.values, 'json')) {
    printJson(io.stdout, 'architect.install/1', {
      agent: { id: graduate.id, name: graduate.name, slug: agentSlug(graduate) },
      version: result.version,
      alreadyInstalled: result.alreadyInstalled,
      ...(origin ? { source: origin } : {}),
      installation,
    });
  } else {
    line(
      io.stdout,
      result.alreadyInstalled
        ? `${graduate.name} version ${result.version} was already installed (${graduate.id}).`
        : `Installed ${graduate.name} as version ${result.version} (${graduate.id}). Run it with \`architect run ${agentSlug(graduate)}\`.`,
    );
    if (origin) line(io.stdout, `From ${HUB_SCHEME}${origin.repository} at ${origin.revision}.`);
    for (const text of installationLines(installation, graduate.name)) line(io.stderr, text);
  }
  return installation.status === 'ready' ? 'succeeded' : 'not_permitted';
}
