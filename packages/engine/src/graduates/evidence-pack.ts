import { randomUUID } from 'node:crypto';
import {
  copyFile,
  cp,
  mkdir,
  readdir,
  readFile,
  rename,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';
import {
  camelToSnake,
  mapKeys,
  PACKAGE_MANIFEST_FILE,
  parseLineageJsonl,
  parseReportJson,
  readPackage,
  sha256Bytes,
  sha256File,
  snakeToCamel,
} from '@architect/harness';
import {
  CodedError,
  contactsLine,
  EVIDENCE_FILE,
  EVIDENCE_FORMAT,
  EVIDENCE_MANIFEST_FILE,
  EVIDENCE_MANIFEST_FORMAT,
  EVIDENCE_PACKAGE_DIR,
  EVIDENCE_README_FILE,
  EVIDENCE_WEIGHTS_DIR,
  EvidenceManifestSchema,
  EvidencePackSchema,
  EvidenceRequestSchema,
  isLoopbackUrl,
  PackageError,
  slugify,
  type Certificate,
  type EvidenceCheck,
  type EvidencePack,
  type EvidenceRequest,
  type EvidenceResult,
  type IntegrityEntry,
  type NetworkProbe,
  type OrganizationEvidence,
  type PackageManifest,
  type ReportCard,
  type RunContact,
  type WeightsState,
} from '@architect/shared';
import {
  describeDestination,
  dnsQueryDestination,
  fetchDestination,
  isAllowed,
} from '../agent-host/guard/destinations';
import { resolveOllamaModel } from '../local-runtime';
import { DEFAULT_MEMORY_LIMIT_BYTES, DEFAULT_TIMEOUT_MS } from '../sandbox/sandbox';
import type { GraduateLibrary } from './library';
import { exists } from './versions';

/*
 * The evidence pack (decision 095): records that already exist about one version, put in one
 * folder a security reviewer can read and an offline computer can install from, every file hashed.
 * The locked test's tasks and a never-seen organization's files never come into it: the version's
 * package holds none (it is what an export ships), and everything else here is a score, a hash or
 * a host name.
 */

export interface EvidenceContext {
  library: GraduateLibrary;
  /** The base model's file on this computer, or null when it isn't here; Ollama's store by default. */
  modelFile?: (name: string) => string | null;
}

/** What a graduate reaches, in the words the pack and the README use. */
const GRADUATE_RULE =
  'A graduate reaches only the model runtime on this computer (127.0.0.0/8, ::1, localhost). Every other connection and every name lookup is refused before a byte leaves.';

/** Destinations outside this computer every pack asks the guard about, besides its run's hosts. */
const OUTSIDE_PROBES = ['https://huggingface.co/', 'https://api.openai.com/v1'];
const RUNTIME_PROBE = 'http://127.0.0.1:11434/api/chat';

function ollamaModelFile(name: string): string | null {
  try {
    return resolveOllamaModel(name).modelPath;
  } catch {
    // Not in Ollama's store here: the pack names it by hash and says it wasn't copied.
    return null;
  }
}

/** JSON as an Architect file holds it: snake_case keys, two-space indent, a final newline. */
function fileJson(value: unknown): string {
  return `${JSON.stringify(mapKeys(value, camelToSnake), null, 2)}\n`;
}

function readFileJson(text: string): unknown {
  return mapKeys(JSON.parse(text), snakeToCamel);
}

const byPath = (a: { path: string }, b: { path: string }): number =>
  a.path < b.path ? -1 : a.path > b.path ? 1 : 0;

/** Every file under `dir`, as forward-slash paths relative to it. */
async function filesUnder(dir: string, prefix = ''): Promise<string[]> {
  const found: string[] = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = prefix === '' ? entry.name : `${prefix}/${entry.name}`;
    if (entry.isDirectory()) found.push(...(await filesUnder(join(dir, entry.name), path)));
    else found.push(path);
  }
  return found;
}

/** Each organization's final test, its task types summed: taught on or never seen, real or not. */
export function organizationsOf(report: ReportCard | null): OrganizationEvidence[] {
  const byOrg = new Map<string, OrganizationEvidence>();
  for (const row of report?.test.perOrg ?? []) {
    const known = byOrg.get(row.org);
    if (known) {
      known.pass += row.pass;
      known.total += row.total;
      continue;
    }
    byOrg.set(row.org, {
      org: row.org,
      name: row.orgName,
      kind: row.seen ? 'seen' : 'never_seen',
      real: !row.synthetic,
      pass: row.pass,
      total: row.total,
    });
  }
  return [...byOrg.values()];
}

/**
 * The graduates' network guard asked, without installing it, about where a graduate might try to
 * go: this computer's runtime, every host the version's teaching reached, two well-known hosts
 * outside and a name lookup. It passes when only this computer is allowed.
 */
export function graduateProbes(hosts: readonly RunContact[]): {
  probes: NetworkProbe[];
  passed: boolean;
} {
  const urls = [RUNTIME_PROBE, ...hosts.map((contact) => `https://${contact.host}/`)];
  for (const outside of OUTSIDE_PROBES) if (!urls.includes(outside)) urls.push(outside);
  const asked = [
    ...urls.map((url) => ({ destination: fetchDestination(url), expected: isLoopbackUrl(url) })),
    { destination: dnsQueryDestination(['huggingface.co']), expected: false },
  ];
  const probes = asked.map(({ destination }) => ({
    destination: describeDestination(destination),
    allowed: isAllowed(destination),
  }));
  const passed = asked.every(({ destination, expected }) => isAllowed(destination) === expected);
  return { probes, passed };
}

function toolsOf(manifest: PackageManifest): EvidencePack['tools']['list'] {
  const prefix = `${manifest.harness.path}/tools/`;
  const byName = new Map<string, IntegrityEntry[]>();
  for (const entry of manifest.integrity.files) {
    if (!entry.path.startsWith(prefix)) continue;
    const name = entry.path.slice(prefix.length).replace(/\.(js|json)$/, '');
    byName.set(name, [...(byName.get(name) ?? []), entry]);
  }
  return [...byName].map(([name, files]) => ({ name, files }));
}

function certificateOf(
  ctx: EvidenceContext,
  graduateId: string,
  version: number,
  report: ReportCard | null,
): Certificate | null {
  if (report?.certificate) return report.certificate;
  const certified = ctx.library.ctx.store.certifications
    .list(graduateId, version)
    .filter((item) => item.status === 'finished' && item.certificate !== undefined)
    .at(-1);
  return certified?.certificate ?? null;
}

function readme(pack: EvidencePack, weights: WeightsState): string {
  const { model, organizations } = pack;
  const base = model.base.digest ? `${model.base.name} (${model.base.digest})` : model.base.name;
  const lines = [
    `# ${pack.agent.name}, version ${pack.version}: evidence`,
    '',
    `Every file in this folder is listed with its SHA-256 in ${EVIDENCE_MANIFEST_FILE}. To check them on a computer with no network: \`architect verify --pack <this folder>\`. To install the version offline: \`architect install ${EVIDENCE_PACKAGE_DIR}\`.`,
    '',
    `- ${EVIDENCE_PACKAGE_DIR}/: the version as it was made, harness ${pack.harness.hash}.`,
    `- ${EVIDENCE_FILE}: the model, the tools and their permissions, the network, the teaching hosts, the changes it kept and its results.`,
    '',
    `Model: ${base}, ${weights === 'copied' ? `copied into ${EVIDENCE_WEIGHTS_DIR}/` : weights === 'missing' ? 'not on the computer that wrote this pack, so named by hash only' : 'named by hash, not copied'}.`,
    `Tools: run in QuickJS in a child process, with no network; changes to files are ${pack.tools.permissions.writes === 'allow' ? 'allowed' : pack.tools.permissions.writes === 'never' ? 'never allowed' : 'asked for first'}.`,
    `Network: ${GRADUATE_RULE} The guard ${pack.network.graduate.passed ? 'passed' : 'failed'} its probe of ${pack.network.graduate.probes.length} destinations.`,
    `Teaching: ${pack.teaching.line}.`,
    `Changes: ${pack.lineage.kept} kept, ${pack.lineage.reverted} reverted.`,
    ...(organizations.length === 0
      ? []
      : [
          '',
          'Final test by organization (scores only):',
          ...organizations.map(
            (org) =>
              `- ${org.name}: ${org.pass} of ${org.total}, ${org.kind === 'seen' ? 'taught on' : 'never seen'}${org.real ? ', real' : ''}.`,
          ),
        ]),
    '',
  ];
  return lines.join('\n');
}

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
 * Writes `<name>-v<n>-evidence/` into the request's folder: the version's package byte for byte,
 * `evidence.json`, a README and MANIFEST.json. The base model's weights are named by hash, and
 * copied only when asked and found here. It is written in staging and moved into place whole.
 */
export async function writeEvidencePack(
  ctx: EvidenceContext,
  graduateId: string,
  input: EvidenceRequest,
): Promise<EvidenceResult> {
  const request = EvidenceRequestSchema.parse(input);
  const { library } = ctx;
  const { store, paths } = library.ctx;
  const agent = library.agent(graduateId);
  const number = request.version ?? agent.activeVersion;
  if (number === null) throw new Error(`${agent.name} has no version to write evidence for.`);
  const stored = library.version(graduateId, number);
  const dir = paths.fromStored(stored.path);
  const changed = `Version ${number} of ${agent.name} changed on disk after it was made, so its evidence can't be written.`;
  const read = await readPackage(dir).catch((error: unknown) => {
    if (!(error instanceof PackageError)) throw error;
    throw new CodedError('version_modified', [changed, ...error.problems].join(' '), {
      cause: error,
    });
  });
  if (read.digest !== stored.digest) throw new CodedError('version_modified', changed);
  const { manifest } = read;

  const directory = resolve(request.directory);
  const name = `${slugify(agent.name)}-v${number}-evidence`;
  const target = join(directory, name);
  if (await exists(target)) throw new Error(`${target} already exists. Choose another folder.`);

  const files = manifest.evidence.files;
  const report = files ? parseReportJson(await readFile(join(dir, files.report), 'utf8')) : null;
  const lineage = files ? parseLineageJsonl(await readFile(join(dir, files.lineage), 'utf8')) : [];
  const runId = stored.runId ?? manifest.evidence.provenance?.runId ?? null;
  const hosts = runId === null ? [] : store.runs.contacts(runId);
  const guard = graduateProbes(hosts);
  const kept = lineage.filter((entry) => entry.decision === 'kept').length;
  const { boundaries } = manifest.contract;

  const staging = join(paths.stagingDir(), `evidence-${randomUUID()}`);
  const staged = join(staging, name);
  try {
    for (const path of [PACKAGE_MANIFEST_FILE, ...read.files.map((file) => file.path)]) {
      const to = join(staged, EVIDENCE_PACKAGE_DIR, ...path.split('/'));
      await mkdir(dirname(to), { recursive: true });
      await copyFile(join(dir, ...path.split('/')), to);
    }

    let weights: EvidencePack['model']['weights'] = { state: 'referenced' };
    if (request.withWeights === true) {
      const source = (ctx.modelFile ?? ollamaModelFile)(manifest.model.base.name);
      if (source === null) {
        weights = { state: 'missing' };
      } else {
        const file = basename(source).endsWith('.gguf')
          ? basename(source)
          : `${basename(source)}.gguf`;
        const path = `${EVIDENCE_WEIGHTS_DIR}/${file}`;
        await mkdir(join(staged, EVIDENCE_WEIGHTS_DIR), { recursive: true });
        await copyFile(source, join(staged, ...path.split('/')));
        weights = { state: 'copied', path, sha256: await sha256File(source) };
      }
    }

    const { adapter } = manifest.model;
    const pack: EvidencePack = EvidencePackSchema.parse({
      format: EVIDENCE_FORMAT,
      agent: { id: graduateId, name: agent.name },
      version: number,
      createdAt: manifest.identity.createdAt,
      packedAt: new Date().toISOString(),
      package: { path: EVIDENCE_PACKAGE_DIR, digest: read.digest, files: read.files.length + 1 },
      harness: {
        hash: manifest.harness.hash,
        format: manifest.harness.format,
        version: manifest.harness.version,
        ...(manifest.harness.round === undefined ? {} : { round: manifest.harness.round }),
      },
      model: {
        label: manifest.model.label,
        base: manifest.model.base,
        adapter:
          adapter === undefined
            ? null
            : {
                sha256: adapter.sha256,
                sizeBytes: adapter.sizeBytes,
                baseDigest: adapter.baseDigest,
                scale: adapter.scale,
                ...(adapter.standIn ? { standIn: true } : {}),
              },
        weights,
      },
      tools: {
        sandbox: {
          engine: 'QuickJS',
          process: 'child process',
          timeoutMs: DEFAULT_TIMEOUT_MS,
          memoryBytes: DEFAULT_MEMORY_LIMIT_BYTES,
          network: 'none',
        },
        permissions: {
          writes: boundaries.writes,
          unseenFiles: boundaries.unseenFiles,
          network: boundaries.network,
          reads: manifest.contract.inputs.files.map((file) => file.name),
          changes: manifest.contract.outputs.files,
          folders: manifest.resources.map((resource) => ({
            name: resource.name,
            access: resource.access,
          })),
        },
        list: toolsOf(manifest),
      },
      network: {
        lockedTestRanOffline: report === null ? null : report.test.ranOffline,
        graduate: { rule: GRADUATE_RULE, ...guard },
      },
      teaching: {
        runId,
        hosts,
        line:
          hosts.length > 0
            ? contactsLine(hosts)
            : 'No hosts are recorded for its teaching on this computer',
      },
      lineage: {
        changes: lineage.length,
        kept,
        reverted: lineage.length - kept,
        entries: lineage.map((entry) => ({
          round: entry.round,
          title: entry.title,
          decision: entry.decision,
          devBefore: entry.measured.devBefore,
          devAfter: entry.measured.devAfter,
        })),
      },
      organizations: organizationsOf(report),
      lockedTest:
        report === null
          ? null
          : {
              score: report.test.score,
              passRate: report.requirements.passRate.actual,
              target: report.requirements.passRate.target,
              met: report.requirements.passRate.met,
            },
      certificate: certificateOf(ctx, graduateId, number, report),
    });
    await writeFile(join(staged, EVIDENCE_FILE), fileJson(pack), { flag: 'wx' });
    await writeFile(join(staged, EVIDENCE_README_FILE), readme(pack, weights.state), {
      flag: 'wx',
    });

    const entries: IntegrityEntry[] = [];
    for (const path of (await filesUnder(staged)).sort()) {
      const file = join(staged, ...path.split('/'));
      entries.push({ path, sha256: await sha256File(file), size: (await stat(file)).size });
    }
    const manifestText = fileJson(
      EvidenceManifestSchema.parse({
        format: EVIDENCE_MANIFEST_FORMAT,
        algorithm: 'sha256',
        files: entries.sort(byPath),
      }),
    );
    await writeFile(join(staged, EVIDENCE_MANIFEST_FILE), manifestText, { flag: 'wx' });

    await mkdir(directory, { recursive: true });
    await moveFolder(staged, target);
    return {
      folder: target,
      version: number,
      files: [...entries.map((entry) => entry.path), EVIDENCE_MANIFEST_FILE],
      bytes: entries.reduce((sum, entry) => sum + entry.size, 0) + Buffer.byteLength(manifestText),
      manifestSha256: sha256Bytes(manifestText),
      weights: weights.state,
    };
  } finally {
    await rm(staging, { recursive: true, force: true });
  }
}

/**
 * Checks a pack where it is, reading nothing but its own files: every file MANIFEST.json lists is
 * there with its size and SHA-256, nothing else is, `evidence.json` reads, the package inside
 * passes its own integrity check and is the one `evidence.json` names, and copied weights are the
 * base model the version names. Each problem is said in plain words.
 */
export async function verifyEvidencePack(dir: string): Promise<EvidenceCheck> {
  const problems: string[] = [];
  let manifest;
  let manifestSha256;
  try {
    const text = await readFile(join(dir, EVIDENCE_MANIFEST_FILE), 'utf8');
    manifest = EvidenceManifestSchema.parse(readFileJson(text));
    manifestSha256 = sha256Bytes(text);
  } catch {
    return {
      ok: false,
      checked: 0,
      problems: [`${EVIDENCE_MANIFEST_FILE} is missing or isn't an evidence pack's manifest.`],
    };
  }

  const listed = new Set(manifest.files.map((entry) => entry.path));
  for (const entry of manifest.files) {
    const file = join(dir, ...entry.path.split('/'));
    const info = await stat(file).catch(() => null);
    if (!info?.isFile()) {
      problems.push(`${entry.path} is missing.`);
    } else if (info.size !== entry.size || (await sha256File(file)) !== entry.sha256) {
      problems.push(
        `${entry.path} doesn't match ${EVIDENCE_MANIFEST_FILE}: it changed after the pack was written.`,
      );
    }
  }
  for (const path of await filesUnder(dir)) {
    if (path !== EVIDENCE_MANIFEST_FILE && !listed.has(path)) {
      problems.push(`${path} isn't listed in ${EVIDENCE_MANIFEST_FILE}.`);
    }
  }

  let pack: EvidencePack | null = null;
  try {
    pack = EvidencePackSchema.parse(readFileJson(await readFile(join(dir, EVIDENCE_FILE), 'utf8')));
  } catch {
    problems.push(`${EVIDENCE_FILE} is missing or doesn't read as an evidence pack's.`);
  }
  if (pack !== null) {
    const read = await readPackage(join(dir, EVIDENCE_PACKAGE_DIR)).catch((error: unknown) => {
      problems.push(
        error instanceof PackageError
          ? `${EVIDENCE_PACKAGE_DIR}/ fails its own check: ${error.problems.join(' ')}`
          : `${EVIDENCE_PACKAGE_DIR}/ couldn't be read.`,
      );
      return null;
    });
    if (read !== null && read.digest !== pack.package.digest) {
      problems.push(`${EVIDENCE_PACKAGE_DIR}/ isn't the version ${EVIDENCE_FILE} names.`);
    }
    const { weights, base } = pack.model;
    if (
      weights.state === 'copied' &&
      base.digest?.startsWith('sha256:') === true &&
      weights.sha256 !== base.digest.slice('sha256:'.length)
    ) {
      problems.push(
        `The model file in ${EVIDENCE_WEIGHTS_DIR}/ isn't ${base.name}, the base the version names.`,
      );
    }
  }
  return {
    ok: problems.length === 0,
    checked: manifest.files.length,
    problems,
    manifestSha256,
    ...(pack === null ? {} : { agent: { name: pack.agent.name, version: pack.version } }),
  };
}
