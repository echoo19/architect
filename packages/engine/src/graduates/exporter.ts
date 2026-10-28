import { randomUUID } from 'node:crypto';
import { copyFile, cp, mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import {
  looksLikeText,
  PACKAGE_MANIFEST_FILE,
  readPackage,
  scanText,
  serializeManifest,
  sha256Bytes,
  sha256File,
  writeZip,
  type ReadPackage,
  type ScanOptions,
} from '@architect/harness';
import {
  ExportRequestSchema,
  GuardError,
  SECRET_REFS,
  slugify,
  type ExportFinding,
  type ExportItem,
  type ExportRequest,
  type ExportResult,
  type ExportReview,
  type IntegrityEntry,
  type PackageManifest,
} from '@architect/shared';
import type { SecretDeps } from '../loop/deps';
import { absoluteFolder } from './bindings';
import type { GraduateLibrary } from './library';
import { exists } from './versions';

/** Shown before anything leaves this computer. */
export const EXPORT_NOTICE =
  "Leaving files out of a package doesn't make it anonymous: the harness is written from your tasks and can quote them, and trained weights may keep traces of the data they learned from. The scan is a best effort, not a guarantee.";

/** Text files over this size aren't scanned line by line; packages rarely hold any. */
const MAX_SCANNED_BYTES = 8 * 1024 ** 2;

export interface ExportContext {
  library: GraduateLibrary;
  secrets: SecretDeps;
}

const byPath = (a: { path: string }, b: { path: string }): number =>
  a.path < b.path ? -1 : a.path > b.path ? 1 : 0;

/** A resource's files that its binding holds and its contract names: what sharing it would ship. */
interface Shareable {
  folder: string;
  files: { name: string; size: number }[];
}

/**
 * Exactly what an export of a version would write: `graduate.json` as it would read, and every
 * other file with where it comes from. The review scans this, and the export writes it, so what
 * the user is shown is what leaves.
 */
interface ExportPlan {
  graduateId: string;
  version: number;
  name: string;
  manifest: PackageManifest;
  manifestText: string;
  entries: { path: string; source: string }[];
  shareable: Map<string, Shareable>;
  chosen: Set<string>;
  bytes: number;
}

async function shareableResources(
  ctx: ExportContext,
  graduateId: string,
  manifest: PackageManifest,
): Promise<Map<string, Shareable>> {
  const installation = ctx.library.ctx.store.installations.get(graduateId);
  const found = new Map<string, Shareable>();
  for (const resource of manifest.resources) {
    const stored = installation?.bindings[resource.name];
    if (stored === undefined || resource.files.length === 0) continue;
    const folder = absoluteFolder(ctx.library.ctx.paths, stored);
    const files: { name: string; size: number }[] = [];
    for (const file of resource.files) {
      const info = await stat(join(folder, file.name)).catch(() => null);
      if (info?.isFile()) files.push({ name: file.name, size: info.size });
    }
    if (files.length > 0) found.set(resource.name, { folder, files });
  }
  return found;
}

async function planExport(
  ctx: ExportContext,
  graduateId: string,
  version: number | undefined,
  include: readonly string[],
): Promise<ExportPlan> {
  const { library } = ctx;
  const agent = library.agent(graduateId);
  const number = version ?? agent.activeVersion;
  if (number === null) throw new Error(`${agent.name} has no version to export.`);
  const stored = library.version(graduateId, number);
  const dir = library.ctx.paths.fromStored(stored.path);
  const read = await readPackage(dir);
  if (read.digest !== stored.digest) {
    throw new Error(
      `Version ${number} of ${agent.name} changed on disk after it was made, so it won't be exported.`,
    );
  }
  const shareable = await shareableResources(ctx, graduateId, read.manifest);
  const chosen = new Set<string>();
  for (const id of include) {
    const name = id.startsWith('resource:') ? id.slice('resource:'.length) : '';
    if (!shareable.has(name)) throw new Error(`"${id}" isn't something this export can include.`);
    chosen.add(name);
  }
  const entries = read.files.map((file) => ({
    path: file.path,
    source: join(dir, ...file.path.split('/')),
  }));
  const plan = { graduateId, version: number, name: agent.name, shareable, chosen };
  if (chosen.size === 0) {
    return {
      ...plan,
      manifest: read.manifest,
      manifestText: await readFile(join(dir, PACKAGE_MANIFEST_FILE), 'utf8'),
      entries,
      bytes: read.bytes,
    };
  }

  const added: { path: string; source: string }[] = [];
  const integrity: IntegrityEntry[] = [...read.manifest.integrity.files];
  for (const name of chosen) {
    const found = shareable.get(name);
    for (const file of found?.files ?? []) {
      const source = join(found?.folder ?? '', file.name);
      const path = `resources/${name}/${file.name}`;
      added.push({ path, source });
      integrity.push({ path, sha256: await sha256File(source), size: (await stat(source)).size });
    }
  }
  const manifest: PackageManifest = {
    ...read.manifest,
    resources: read.manifest.resources.map((resource) =>
      chosen.has(resource.name)
        ? {
            ...resource,
            bundled: {
              path: `resources/${resource.name}`,
              // No date: the same files make the same package, whenever it is written.
              provenance: `Shared by the author from their ${resource.name}/ folder.`,
            },
          }
        : resource,
    ),
    integrity: { algorithm: 'sha256', files: integrity.sort(byPath) },
  };
  const manifestText = serializeManifest(manifest);
  return {
    ...plan,
    manifest,
    manifestText,
    entries: [...entries, ...added].sort(byPath),
    bytes: integrity.reduce((sum, entry) => sum + entry.size, 0) + Buffer.byteLength(manifestText),
  };
}

/**
 * What the scan looks for in an agent's files: every key stored here, and the folders that name
 * this computer's user, the app's data and the agent's own bindings.
 */
export async function scanOptions(ctx: ExportContext, graduateId: string): Promise<ScanOptions> {
  const storedKeys: string[] = [];
  for (const ref of SECRET_REFS) {
    const value = await ctx.secrets.get(ref);
    if (value) storedKeys.push(value);
  }
  const installation = ctx.library.ctx.store.installations.get(graduateId);
  return {
    storedKeys,
    privateFolders: [
      homedir(),
      ctx.library.ctx.paths.root,
      ...Object.values(installation?.bindings ?? {}).map((stored) =>
        absoluteFolder(ctx.library.ctx.paths, stored),
      ),
    ],
  };
}

/** The findings in everything a plan would write, in path order. Never a key's value. */
async function scanPlan(ctx: ExportContext, plan: ExportPlan): Promise<ExportFinding[]> {
  const options = await scanOptions(ctx, plan.graduateId);
  const texts: { path: string; read: () => Promise<Buffer | null> }[] = [
    { path: PACKAGE_MANIFEST_FILE, read: async () => Buffer.from(plan.manifestText, 'utf8') },
    ...plan.entries.map((entry) => ({
      path: entry.path,
      read: async () =>
        (await stat(entry.source)).size > MAX_SCANNED_BYTES ? null : readFile(entry.source),
    })),
  ].sort(byPath);
  const findings: ExportFinding[] = [];
  for (const text of texts) {
    const bytes = await text.read();
    if (bytes === null || !looksLikeText(bytes)) continue;
    findings.push(...scanText(text.path, bytes.toString('utf8'), options));
  }
  return findings;
}

/** Names a set of findings, so a confirmation covers exactly the ones the user saw. */
export function findingsDigest(findings: readonly ExportFinding[]): string {
  return sha256Bytes(JSON.stringify(findings));
}

/** Refuses to go on when the scan found something the request doesn't name as reviewed. */
export function assertReviewed(
  findings: readonly ExportFinding[],
  acknowledged: string | undefined,
  what: string,
): void {
  if (findings.length === 0 || acknowledged === findingsDigest(findings)) return;
  const listed = findings
    .slice(0, 5)
    .map((finding) => `${finding.path} line ${finding.line}: ${finding.excerpt}`)
    .join('; ');
  throw new GuardError(
    'permission',
    `The scan found ${findings.length} thing${findings.length === 1 ? '' : 's'} that look like keys or private paths (${listed}). Nothing was ${what}. Review them, then try again with the review you saw.`,
  );
}

/** Every file an export of a version would write, with its size, and what the scan finds. */
export interface ExportListing {
  graduateId: string;
  version: number;
  name: string;
  manifest: PackageManifest;
  /** sha256 of the `graduate.json` it would write. */
  digest: string;
  /** `graduate.json` and every other file, in path order. */
  files: { path: string; bytes: number }[];
  findings: ExportFinding[];
}

export async function listExport(
  ctx: ExportContext,
  graduateId: string,
  version?: number,
  include: readonly string[] = [],
): Promise<ExportListing> {
  const plan = await planExport(ctx, graduateId, version, include);
  const files = [{ path: PACKAGE_MANIFEST_FILE, bytes: Buffer.byteLength(plan.manifestText) }];
  for (const entry of plan.entries) {
    files.push({ path: entry.path, bytes: (await stat(entry.source)).size });
  }
  return {
    graduateId,
    version: plan.version,
    name: plan.name,
    manifest: plan.manifest,
    digest: sha256Bytes(plan.manifestText),
    files: files.sort(byPath),
    findings: await scanPlan(ctx, plan),
  };
}

/** A package written for a publication, checked whole before anything uses it. */
export interface StagedExport {
  name: string;
  read: ReadPackage;
  findings: ExportFinding[];
}

/** Writes exactly what a plan holds into `dir`, which must not exist yet, and reads it back. */
async function writePlan(plan: ExportPlan, dir: string): Promise<ReadPackage> {
  for (const entry of plan.entries) {
    const target = join(dir, ...entry.path.split('/'));
    await mkdir(dirname(target), { recursive: true });
    await copyFile(entry.source, target);
  }
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, PACKAGE_MANIFEST_FILE), plan.manifestText, { flag: 'wx' });
  return readPackage(dir);
}

/**
 * Writes the package an export would write into `dir`, for a publication to send, after the
 * same review: nothing is written when the scan finds something the request doesn't name.
 */
export async function stageExport(
  ctx: ExportContext,
  graduateId: string,
  request: { version?: number; include?: readonly string[]; acknowledgedFindings?: string },
  dir: string,
): Promise<StagedExport> {
  const plan = await planExport(ctx, graduateId, request.version, request.include ?? []);
  const findings = await scanPlan(ctx, plan);
  assertReviewed(findings, request.acknowledgedFindings, 'sent');
  return { name: plan.name, read: await writePlan(plan, dir), findings };
}

/**
 * What an export of a version would carry and leave out, with the reason for each, and what a
 * best-effort scan finds in exactly what it would write, the chosen resources included. Chats,
 * bindings, keys and training traces are never in a package; a resource's own files only when
 * the user opts in.
 */
export async function reviewExport(
  ctx: ExportContext,
  graduateId: string,
  version?: number,
  include: readonly string[] = [],
): Promise<ExportReview> {
  const plan = await planExport(ctx, graduateId, version, include);
  const { store } = ctx.library.ctx;
  const items: ExportItem[] = [
    {
      id: 'package',
      label: `${plan.name}, version ${plan.manifest.identity.version}`,
      included: true,
      optional: false,
      reason:
        'Its harness, model reference, contract, evidence and checks: what makes it this graduate.',
      files: [PACKAGE_MANIFEST_FILE, ...plan.entries.map((entry) => entry.path)].filter(
        (path) => !path.startsWith('resources/'),
      ),
      bytes: plan.bytes,
    },
  ];
  for (const [name, found] of plan.shareable) {
    items.push({
      id: `resource:${name}`,
      label: `Your ${name}/ files`,
      included: plan.chosen.has(name),
      optional: true,
      reason: `Left out unless you choose to share them. Whoever installs ${plan.name} binds ${name}/ to their own folder.`,
      files: found.files.map((file) => file.name),
      bytes: found.files.reduce((sum, file) => sum + file.size, 0),
    });
  }
  const chats = store.chats.list(graduateId).length;
  items.push(
    {
      id: 'chats',
      label: chats === 1 ? '1 chat' : `${chats} chats`,
      included: false,
      optional: false,
      reason: 'Chats never leave this computer.',
      files: [],
      bytes: 0,
    },
    {
      id: 'bindings',
      label: "This computer's folders and model endpoint",
      included: false,
      optional: false,
      reason: 'They belong to this computer; whoever installs it chooses their own.',
      files: [],
      bytes: 0,
    },
    {
      id: 'credentials',
      label: 'Keys',
      included: false,
      optional: false,
      reason: "Keys stay in this computer's encrypted store and are never written into a package.",
      files: [],
      bytes: 0,
    },
    {
      id: 'training_traces',
      label: "Training attempts and the mentor's diagnoses",
      included: false,
      optional: false,
      reason:
        'They stay with the run. The package keeps what each change was and what it measured.',
      files: [],
      bytes: 0,
    },
  );
  const findings = await scanPlan(ctx, plan);
  return {
    graduateId,
    version: plan.version,
    name: plan.name,
    items,
    findings,
    findingsDigest: findingsDigest(findings),
    notice: EXPORT_NOTICE,
  };
}

/** Moves a folder, copying it when the target is on another drive. */
async function moveFolder(from: string, to: string): Promise<void> {
  try {
    await rename(from, to);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EXDEV') throw error;
    await cp(from, to, { recursive: true, errorOnExist: true, force: false });
    await rm(from, { recursive: true, force: true });
  }
}

/**
 * Writes `<name>-v<n>.architect.zip` and the `<name>-v<n>/` folder into the request's folder.
 * With nothing optional chosen the package is the version's folder byte for byte, so its digest
 * is the version's own; sharing a resource adds its files under `resources/` and a manifest that
 * lists them. When the scan finds anything, nothing is written unless the request names the
 * findings the user reviewed. The package is checked whole in staging first, and the archive is
 * written before the folder moves, so a failure leaves nothing behind.
 */
export async function exportPackage(
  ctx: ExportContext,
  graduateId: string,
  input: ExportRequest,
): Promise<ExportResult> {
  const request = ExportRequestSchema.parse(input);
  const plan = await planExport(ctx, graduateId, request.version, request.include);
  const findings = await scanPlan(ctx, plan);
  assertReviewed(findings, request.acknowledgedFindings, 'exported');

  const directory = resolve(request.directory);
  const base = `${slugify(plan.name)}-v${plan.manifest.identity.version}`;
  const folder = join(directory, base);
  const archive = join(directory, `${base}.architect.zip`);
  for (const target of [folder, archive]) {
    if (await exists(target)) throw new Error(`${target} already exists. Choose another folder.`);
  }

  const staging = join(ctx.library.ctx.paths.stagingDir(), `export-${randomUUID()}`);
  const staged = join(staging, base);
  try {
    const read = await writePlan(plan, staged);
    const files = [PACKAGE_MANIFEST_FILE, ...read.files.map((file) => file.path)];
    await mkdir(directory, { recursive: true });
    await writeZip(archive, staged, files);
    try {
      await moveFolder(staged, folder);
    } catch (error) {
      await rm(archive, { force: true });
      throw error;
    }
    return { folder, archive, files, bytes: read.bytes, digest: read.digest, findings };
  } finally {
    await rm(staging, { recursive: true, force: true });
  }
}
