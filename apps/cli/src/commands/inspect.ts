import { existsSync, statSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { inspectPackage, listPublications, openLocalLibrary } from '@architect/engine/graduates';
import { HUB_SCHEME } from '@architect/engine/hub';
import type {
  CliOutcome,
  GraduateVersion,
  PackageInspection,
  PackageManifest,
} from '@architect/shared';
import { agentSlug, resolveAgent } from '../agents';
import { flag, type Parsed } from '../args';
import type { CliContext } from '../context';
import { CliError } from '../exit';
import { bytes, installationLines, line, printJson, table } from '../render';

/** A path someone means as a package rather than an agent's name. */
function packagePath(ctx: CliContext, named: string): string | null {
  const path = ctx.path(named);
  const info = statSync(path, { throwIfNoEntry: false });
  if (info?.isFile()) return path;
  if (info?.isDirectory()) {
    return existsSync(join(path, 'graduate.json')) || existsSync(join(path, 'graduate.yaml'))
      ? path
      : null;
  }
  return null;
}

function evidenceLine(manifest: PackageManifest): string {
  const { evidence } = manifest;
  const summary = evidence.summary;
  const result = summary
    ? `${summary.score.pass} of ${summary.score.total} locked-test tasks passed (the contract asks for ${Math.round(summary.passRate.target * 100)}%)`
    : 'no locked test measured it';
  return `${evidence.label}, version ${manifest.identity.version}: ${result}; status ${evidence.status}.`;
}

function versionRow(version: GraduateVersion): string[] {
  const from = version.source
    ? `${HUB_SCHEME}${version.source.repository} at ${version.source.revision.slice(0, 12)}`
    : version.origin
      ? 'imported'
      : version.runId
        ? `run ${version.runId}`
        : '';
  return [
    `v${version.version}`,
    version.state,
    version.active ? 'active' : '',
    version.evaluation,
    version.createdAt.slice(0, 10),
    from,
  ];
}

/**
 * Checks a package as an install would, in a staging folder. Where the app has no data yet, that
 * is a temporary folder, so looking at a package never starts the app's data folder.
 */
async function inspectionOf(ctx: CliContext, path: string): Promise<PackageInspection> {
  if (existsSync(join(ctx.dataDir, 'architect.db'))) {
    return inspectPackage({ library: ctx.library().library }, path);
  }
  const scratch = await mkdtemp(join(tmpdir(), 'architect-inspect-'));
  const local = openLocalLibrary({ dataDir: scratch });
  try {
    return await inspectPackage({ library: local.library }, path);
  } finally {
    local.close();
    await rm(scratch, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  }
}

async function inspectFile(ctx: CliContext, path: string, json: boolean): Promise<CliOutcome> {
  const { io } = ctx;
  const inspection = await inspectionOf(ctx, path);
  if (json) {
    printJson(io.stdout, 'architect.inspect-package/1', { path, inspection });
    return inspection.ok ? 'succeeded' : 'invalid_input';
  }
  if (!inspection.ok) {
    throw new CliError(
      'invalid_input',
      `package_${inspection.code}`,
      inspection.problems.join(' '),
    );
  }
  const { manifest } = inspection;
  line(io.stdout, `${manifest.identity.name}, version ${manifest.identity.version}`);
  line(io.stdout, `sha256 of graduate.json: ${inspection.digest}`);
  line(io.stdout, `${inspection.files} files, ${bytes(inspection.bytes)}. Nothing in it has run.`);
  line(io.stdout, `Model: ${manifest.model.label}, ${manifest.model.base.name}`);
  line(io.stdout, evidenceLine(manifest));
  return 'succeeded';
}

/**
 * An agent's versions, model, folders and permissions here, the author's evidence and this
 * computer's installation checks (labelled apart), and its publications. Or, for a package
 * file or folder, what it holds, checked without installing it.
 */
export async function inspect(ctx: CliContext, parsed: Parsed): Promise<CliOutcome> {
  const { io } = ctx;
  const [named = ''] = parsed.args;
  const json = flag(parsed.values, 'json');
  const file = packagePath(ctx, named);
  if (file !== null) return inspectFile(ctx, file, json);

  const { library } = ctx.library();
  const agent = resolveAgent(library, named);
  const versions = library.versions(agent.id);
  const active = versions.find((version) => version.active) ?? versions.at(-1);
  const installation = active ? library.installation(agent.id, active.version) : null;
  const publications = listPublications({ library }, agent.id);
  if (json) {
    printJson(io.stdout, 'architect.inspect/1', {
      agent: {
        id: agent.id,
        name: agent.name,
        slug: agentSlug(agent),
        activeVersion: agent.activeVersion,
      },
      versions: versions.map(({ manifest: _manifest, ...version }) => version),
      evidence: active?.manifest.evidence ?? null,
      installation,
      publications,
    });
    return 'succeeded';
  }

  line(io.stdout, `${agent.name} (${agentSlug(agent)}, id ${agent.id})`);
  line(io.stdout);
  line(io.stdout, table(versions.map(versionRow)));
  if (active && installation) {
    const { manifest } = active;
    line(io.stdout);
    line(
      io.stdout,
      `Model: ${manifest.model.label}, ${installation.model.model} on ${installation.model.runtime} at ${installation.model.baseUrl}`,
    );
    line(io.stdout, `Harness: format ${manifest.harness.format}, hash ${manifest.harness.hash}`);
    line(io.stdout, `Writes: ${installation.grants.writes}`);
    line(
      io.stdout,
      table(
        manifest.resources.map((resource) => [
          `  ${resource.name}/`,
          installation.bindings[resource.name] ?? 'not bound',
          installation.grants.resources[resource.name] ?? 'none',
          resource.required ? 'needed' : 'optional',
        ]),
      ),
    );
    line(io.stdout);
    line(io.stdout, evidenceLine(manifest));
    for (const text of installationLines(installation, agent.name)) line(io.stdout, text);
  }
  if (publications.length > 0) {
    line(io.stdout);
    line(io.stdout, 'Publications:');
    for (const publication of publications) {
      const state =
        publication.status === 'complete'
          ? `complete at ${publication.revision ?? ''}`
          : publication.status === 'failed'
            ? `failed: ${publication.error ?? ''}`
            : publication.status;
      line(
        io.stdout,
        `  v${publication.version} to ${publication.repository} (${publication.visibility}), ${state}`,
      );
    }
  }
  return 'succeeded';
}
