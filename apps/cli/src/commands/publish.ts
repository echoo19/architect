import {
  listPublications,
  publishVersion,
  reviewPublication,
  type PublishContext,
} from '@architect/engine/graduates';
import {
  findHubToken,
  HUB_SCHEME,
  HUB_TOKEN_SOURCES,
  type UploadProgress,
} from '@architect/engine/hub';
import { HubRepositorySchema, type CliOutcome, type PublishRequest } from '@architect/shared';
import { agentSlug, resolveAgent } from '../agents';
import { countOption, flag, listOption, stringOption, type Parsed } from '../args';
import type { CliContext } from '../context';
import { CliError, TOKEN_HINT } from '../exit';
import { bytes, line, printJson, table } from '../render';
import { cliSecrets, stopOnFindings } from './export';

/** Progress on stderr: each file once it is sent, and every tenth of a large one. */
function progressReporter(ctx: CliContext): (progress: UploadProgress) => void {
  const shown = new Map<string, number>();
  return ({ path, sent, size }) => {
    const tenth = size === 0 ? 10 : Math.floor((sent / size) * 10);
    if ((shown.get(path) ?? -1) >= tenth) return;
    shown.set(path, tenth);
    line(ctx.io.stderr, `  sent ${path}: ${bytes(sent)} of ${bytes(size)}`);
  };
}

/**
 * Publishes a version to a Hugging Face model repository: shows exactly what will go and what
 * the scan found, then sends the package and a model card. Private unless --public; an existing
 * repository keeps its visibility, and a public one is refused for a private publication.
 */
export async function publish(
  ctx: CliContext,
  parsed: Parsed,
  signal: AbortSignal,
): Promise<CliOutcome> {
  const { io } = ctx;
  const { values } = parsed;
  const repository = stringOption(values, 'repo');
  if (repository === undefined) {
    throw new CliError('invalid_input', 'usage', 'Name the repository with --repo owner/name.');
  }
  if (!HubRepositorySchema.safeParse(repository).success) {
    throw new CliError(
      'invalid_input',
      'usage',
      `"${repository}" isn't a repository name.`,
      'Name it as owner/name.',
    );
  }
  if (flag(values, 'private') && flag(values, 'public')) {
    throw new CliError('invalid_input', 'usage', 'Choose --private or --public, not both.');
  }
  const { library } = ctx.library();
  const agent = resolveAgent(library, parsed.args[0] ?? '');
  const version = countOption(values, 'version');
  const accepted = stringOption(values, 'accept-findings');
  const request: PublishRequest = {
    repository,
    visibility: flag(values, 'public') ? 'public' : 'private',
    ...(version === undefined ? {} : { version }),
    include: listOption(values, 'include'),
    ...(accepted === undefined ? {} : { acknowledgedFindings: accepted }),
  };
  const packages: PublishContext = { library, secrets: cliSecrets(ctx), hub: ctx.hub() };
  const review = await reviewPublication(packages, agent.id, request);
  const json = flag(values, 'json');

  line(
    io.stderr,
    `${agent.name} version ${review.version} to ${repository} (${review.visibility}):`,
  );
  line(io.stderr, table(review.files.map((file) => [`  ${file.path}`, bytes(file.bytes)])));
  line(io.stderr, `${review.files.length} files, ${bytes(review.bytes)}.`);
  for (const notice of review.notices) line(io.stderr, notice);
  // Trying again finishes the version that didn't go; a newer active version is another one.
  for (const unfinished of listPublications({ library }, agent.id)) {
    if (
      unfinished.repository === repository &&
      unfinished.status !== 'complete' &&
      unfinished.version !== review.version
    ) {
      line(
        io.stderr,
        `Version ${unfinished.version}'s publication to ${repository} didn't finish. To finish it instead of sending version ${review.version}, run this again with --version ${unfinished.version}.`,
      );
    }
  }
  stopOnFindings(ctx, review.findings, review.findingsDigest, accepted, 'published');

  if (flag(values, 'dry-run')) {
    if (json) printJson(io.stdout, 'architect.publish-review/1', { review });
    else line(io.stdout, 'Nothing was sent: this was a dry run.');
    return 'succeeded';
  }
  const token = await findHubToken({ env: io.env });
  if (!token) {
    throw new CliError(
      'not_permitted',
      'no_token',
      'There is no Hugging Face token on this computer.',
      TOKEN_HINT,
    );
  }
  line(io.stderr, `Using the Hugging Face token from ${HUB_TOKEN_SOURCES[token.source]}.`);
  const result = await publishVersion(packages, agent.id, request, {
    signal,
    onProgress: progressReporter(ctx),
  });
  const { publication } = result;
  const install = `architect install ${HUB_SCHEME}${repository} --revision ${publication.revision ?? ''}`;
  if (json) {
    printJson(io.stdout, 'architect.publish/1', {
      agent: { id: agent.id, name: agent.name, slug: agentSlug(agent) },
      ...result,
      install,
    });
  } else {
    line(
      io.stdout,
      result.alreadyPublished
        ? `Version ${publication.version} was already published to ${repository} at ${publication.revision ?? ''}.`
        : `Published ${agent.name} version ${publication.version} to ${repository} (${publication.visibility}) at commit ${publication.revision ?? ''}.`,
    );
    if (publication.url) line(io.stdout, publication.url);
    line(io.stdout, `Install it with: ${install}`);
    for (const note of result.notes) line(io.stderr, note);
  }
  return 'succeeded';
}
