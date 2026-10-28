import {
  AUTHOR_EVALUATION_LABEL,
  contractTerms,
  GraduateVersionSchema,
  ImportPreviewSchema,
  INSTALL_CHECKS_LABEL,
  JobContractSchema,
  PackageManifestSchema,
  type EvaluationStatus,
  type ExportReview,
  type GraduateSummary,
  type GraduateVersion,
  type ImportPreview,
  type ImportResult,
  type InstallCheck,
  type Installation,
  type Job,
  type LlamaServerStatus,
  type PackageManifest,
  type ResourceGrant,
  type Score,
} from '@architect/shared';
import type { ElectronApplication } from '@playwright/test';
import { at, FINAL_TEST, graduate, job, STORY } from './story';

/*
 * An agent with four versions, its installation on this computer, an export review, and
 * packages to import, for the versions, export and import screens. A stand-in engine (below)
 * keeps their state in the main process, so promoting, rolling back and importing change what
 * the screens read next, as the real engine would.
 */

export const hex = (digit: string) => digit.repeat(64);

export const MACHINE = { os: 'win32', arch: 'x64', memoryBytes: 32 * 1024 ** 3 };

export interface ManifestOptions {
  job: Job;
  agentId: string;
  version: number;
  parent?: number;
  createdAt: string;
  status: EvaluationStatus;
  score?: Score;
  tools?: string[];
  adapter?: boolean;
}

/** A package manifest the way the engine writes one, checked against the real schema. */
export function manifestFor(options: ManifestOptions): PackageManifest {
  const { job: madeFor, score } = options;
  const contract = JobContractSchema.parse({ ...contractTerms(madeFor), version: 1 });
  const harnessFiles = [
    'harness/AGENTS.md',
    'harness/harness.yaml',
    'harness/skills/price-a-job/SKILL.md',
    ...(options.tools ?? []).flatMap((tool) => [
      `harness/tools/${tool}.js`,
      `harness/tools/${tool}.json`,
    ]),
  ];
  const evidenceFiles = score
    ? ['evidence/lineage.jsonl', 'evidence/report.json', 'evidence/report.md']
    : [];
  const files = [
    ...(options.adapter ? ['adapter/adapter.gguf'] : []),
    ...evidenceFiles,
    ...harnessFiles,
  ].sort();
  const sizeOf = (path: string) => (path === 'adapter/adapter.gguf' ? 123_731_968 : 2_400);
  const resources = [
    {
      name: 'data',
      kind: 'folder' as const,
      required: true,
      description: `The job's own files: ${madeFor.data.files.map((file) => file.name).join(', ')}.`,
      accepts: ['text/csv', 'text/plain'],
      access: 'read_write' as const,
      files: madeFor.data.files.map(({ name, kind, access }) => ({ name, kind, access })),
    },
    {
      name: 'output',
      kind: 'folder' as const,
      required: false,
      description: madeFor.data.output?.description ?? 'Where files the agent creates are saved.',
      accepts: ['text/plain', 'text/csv', 'text/markdown'],
      access: 'read_write' as const,
      files: [],
    },
  ];
  return PackageManifestSchema.parse({
    schema: 2,
    kind: 'architect.graduate',
    identity: {
      agentId: options.agentId,
      name: madeFor.name,
      version: options.version,
      ...(options.parent === undefined
        ? {}
        : { parent: { agentId: options.agentId, version: options.parent, digest: hex('c') } }),
      createdAt: options.createdAt,
      method: 'architect',
    },
    contract,
    model: {
      label: 'Glimmer',
      base: {
        name: 'muse-glimmer:30b',
        digest: hex('a'),
        quantization: 'Q4_K_M',
        sizeBytes: 18 * 1024 ** 3,
      },
      ...(options.adapter
        ? {
            adapter: {
              path: 'adapter/adapter.gguf',
              format: 'gguf_lora',
              sha256: hex('d'),
              sizeBytes: sizeOf('adapter/adapter.gguf'),
              baseDigest: `sha256:${hex('a')}`,
              scale: 1,
            },
          }
        : {}),
      inference: { contextLength: 16_384 },
      runtime: { compatible: options.adapter ? ['llama.cpp'] : ['ollama'] },
    },
    harness: { format: 2, path: 'harness', hash: hex('b'), version: 8, round: 7 },
    resources,
    requirements: {
      tested: [
        {
          os: 'win32',
          arch: 'x64',
          backend: options.adapter ? 'llama.cpp' : 'ollama',
          target: 'local',
        },
      ],
      measured: score ? { latencyMs: { p50: 150_000, p95: 222_000 } } : {},
      minimum: { memoryBytes: 20 * 1024 ** 3, diskBytes: 18 * 1024 ** 3 },
      limitations: [],
    },
    evidence: {
      label: AUTHOR_EVALUATION_LABEL,
      status: options.status,
      contractVersion: 1,
      ...(score
        ? {
            summary: {
              score,
              perType: [],
              passRate: {
                target: madeFor.requirements.passRate,
                actual: score.pass / score.total,
                met: score.pass / score.total >= madeFor.requirements.passRate,
              },
            },
            files: {
              report: 'evidence/report.json',
              reportMarkdown: 'evidence/report.md',
              lineage: 'evidence/lineage.jsonl',
            },
          }
        : {}),
      counts: { testTasks: score?.total ?? 0, rounds: 7, keptChanges: 3 },
    },
    verification: { checks: [], fixtures: [] },
    integrity: {
      algorithm: 'sha256',
      files: files.map((path) => ({
        path,
        sha256: path === 'adapter/adapter.gguf' ? hex('d') : hex('e'),
        size: sizeOf(path),
      })),
    },
    terms: {
      baseModel: "Uses muse-glimmer:30b, which isn't included. Its own licence and terms apply.",
      notices: [],
    },
  });
}

function version(
  number: number,
  fields: Pick<GraduateVersion, 'state' | 'active'> & {
    parent?: number;
    imported?: boolean;
    status: EvaluationStatus;
    score?: Score;
    /** Trained weights on top of the base model. */
    adapter?: boolean;
    day: number;
  },
): GraduateVersion {
  const createdAt = at(180 + fields.day * 24 * 60);
  return GraduateVersionSchema.parse({
    graduateId: STORY.graduateId,
    version: number,
    ...(fields.parent === undefined ? {} : { parent: fields.parent }),
    ...(fields.imported
      ? { origin: { agentId: 'grd_servicedesk_dana', version: 2, digest: hex('f') } }
      : {}),
    state: fields.state,
    active: fields.active,
    evaluation: fields.status,
    contractVersion: 1,
    digest: hex(String(number)),
    path: `graduates/${STORY.graduateId}/versions/${number}`,
    manifest: manifestFor({
      job,
      agentId: STORY.graduateId,
      version: number,
      ...(fields.parent === undefined ? {} : { parent: fields.parent }),
      createdAt,
      status: fields.status,
      ...(fields.score ? { score: fields.score } : {}),
      ...(fields.adapter ? { adapter: true } : {}),
    }),
    createdAt,
    ...(fields.state === 'accepted' ? { acceptedAt: createdAt } : {}),
  });
}

/** The story's graduate as its one version: what the run made, active from the start. */
export const STORY_VERSION: GraduateVersion = version(1, {
  state: 'accepted',
  active: true,
  status: 'ready',
  score: { pass: 55, total: 60 },
  day: 0,
});

/**
 * One history for the agent, so every screen that names a version says the same score. Version 1
 * is what the run made: the story's 55 of 60. Version 2 is active, with trained weights on top of
 * its setup, and passed 57 of 60. Version 3, an improvement on it, waits as a candidate that took
 * 51 of 60, short of the job's 90%. Version 4 came from another computer and took no final test.
 */
export const VERSIONS: GraduateVersion[] = [
  version(1, {
    state: 'accepted',
    active: false,
    status: 'ready',
    score: { pass: 55, total: 60 },
    day: 0,
  }),
  version(2, {
    state: 'accepted',
    active: true,
    parent: 1,
    status: 'ready',
    score: { pass: 57, total: 60 },
    adapter: true,
    day: 1,
  }),
  version(3, {
    state: 'candidate',
    active: false,
    parent: 2,
    status: 'experimental',
    score: { pass: 51, total: 60 },
    adapter: true,
    day: 2,
  }),
  version(4, {
    state: 'candidate',
    active: false,
    parent: 2,
    imported: true,
    status: 'unevaluated',
    day: 2,
  }),
];

/**
 * The agent as the sidebar lists it, on version 2 of 4, whose final test its own record carries:
 * the same 57 of 60 the versions list shows beside it.
 */
export const AGENT_WITH_VERSIONS: GraduateSummary = {
  ...graduate,
  activeVersion: 2,
  versions: 4,
  manifest: {
    ...graduate.manifest,
    requirements: { passRate: { target: 0.9, actual: 57 / 60, met: true } },
    test: {
      score: { pass: 57, total: 60 },
      perType: FINAL_TEST.map((type) =>
        type.type === 'scheduling' ? { ...type, pass: type.pass + 2 } : type,
      ),
    },
  },
};

export const passed = (id: string, kind: string, detail: string, ms?: number): InstallCheck => ({
  id,
  kind,
  status: 'passed',
  detail,
  ...(ms === undefined ? {} : { ms }),
});

export const READY_CHECKS: InstallCheck[] = [
  passed(
    'compatibility',
    'compatibility',
    'win32/x64, 32 GB of memory, ollama at 127.0.0.1:11434.',
  ),
  passed('harness-valid', 'harness_valid', 'Harness version 8, as tested.'),
  passed('tools-load', 'tools_load', '1 tool loaded.'),
  passed(
    'resources-bound',
    'resources_bound',
    'Every folder is chosen and holds the files it should.',
  ),
  {
    ...passed(
      'model-available',
      'model_available',
      'muse-glimmer:30b on ollama, the same build that was tested.',
    ),
    sameBuild: true,
  },
  passed('model-responds', 'model_responds', 'Answered in 2.8 s, loading included.', 2_800),
];

export function installation(graduateId: string, fields: Partial<Installation> = {}): Installation {
  return {
    graduateId,
    version: 2,
    label: INSTALL_CHECKS_LABEL,
    model: { runtime: 'ollama', baseUrl: 'http://127.0.0.1:11434', model: 'muse-glimmer:30b' },
    bindings: {
      data: 'C:\\Users\\dana\\AppData\\Roaming\\Architect\\graduates\\grd_servicedesk\\data',
    },
    grants: { writes: 'ask', resources: { data: 'read_write', output: 'read_write' } },
    status: 'ready',
    reasons: [],
    checks: READY_CHECKS,
    machine: MACHINE,
    measurements: { firstReplyMs: 2_800 },
    checkedAt: at(200),
    ...fields,
  };
}

/** What exporting version 2 would carry: the package, the data folder to opt into, and the rest. */
export function exportReview(include: readonly string[]): ExportReview {
  const sharing = include.includes('resource:data');
  const findings = sharing
    ? [
        {
          path: 'resources/data/policy.md',
          line: 14,
          kind: 'stored_key' as const,
          excerpt: 'Card processor key: ••••••••••••',
        },
      ]
    : [];
  return {
    graduateId: STORY.graduateId,
    version: 2,
    name: 'Service desk',
    items: [
      {
        id: 'package',
        label: 'Service desk, version 2',
        included: true,
        optional: false,
        reason: 'Its harness, model reference, contract, evidence and checks.',
        files: ['graduate.json', 'adapter/adapter.gguf'],
        bytes: 123_781_481,
      },
      {
        id: 'resource:data',
        label: 'Your data/ files',
        included: sharing,
        optional: true,
        reason: 'Left out unless you choose to share them.',
        files: job.data.files.map((file) => file.name),
        bytes: 1_204_000,
      },
      ...[
        ['chats', '4 chats'],
        ['bindings', "This computer's folders and model endpoint"],
        ['credentials', 'Keys'],
        ['training_traces', "Training attempts and the mentor's diagnoses"],
      ].map(([id = '', label = '']) => ({
        id,
        label,
        included: false,
        optional: false,
        reason: '',
        files: [],
        bytes: 0,
      })),
    ],
    findings,
    findingsDigest: sharing ? hex('9') : hex('0'),
    notice: "Leaving files out of a package doesn't make it anonymous.",
    parts: [
      { part: 'harness', files: ['harness/AGENTS.md'], bytes: 21_400, findingsDigest: hex('0') },
      {
        part: 'adapter',
        files: ['adapter/adapter.gguf'],
        bytes: 123_731_968,
        findingsDigest: hex('0'),
      },
      { part: 'report', files: ['evidence/report.md'], bytes: 3_900, findingsDigest: hex('0') },
    ],
  };
}

/** The returns desk: another person's agent, packaged on their computer. */
export const returnsJob: Job = {
  ...job,
  id: 'job_returns',
  name: 'Returns desk',
  description: 'Records returns, answers order questions and books pickups.',
  summary: 'Records returns, answers order questions and books pickups.',
  data: {
    files: [
      { name: 'orders.csv', kind: 'table', access: 'read' },
      { name: 'returns.csv', kind: 'table', access: 'write' },
      { name: 'pickups.csv', kind: 'table', access: 'write' },
      { name: 'policy.md', kind: 'text', access: 'read' },
    ],
    output: { description: 'Return labels it prints' },
  },
};

const frontDeskJob: Job = { ...returnsJob, id: 'job_front', name: 'Front desk' };

export const PACKAGES = {
  ready: 'C:\\Users\\dana\\Downloads\\returns-desk-v1.architect.zip',
  /** The returns desk's next version, with trained weights that llama.cpp serves. */
  weights: 'C:\\Users\\dana\\Downloads\\returns-desk-v2.architect.zip',
  blocked: 'C:\\Users\\dana\\Downloads\\front-desk-v1.architect.zip',
  broken: 'C:\\Users\\dana\\Downloads\\service-desk-v2.architect.zip',
};

export const FOLDERS = {
  records: 'C:\\Users\\dana\\Documents\\Larchwood\\Records',
};

/** What the engine says when this computer has no llama-server (decision 041). */
const NO_LLAMA_SERVER =
  "llama-server isn't installed, or isn't on PATH. Install llama.cpp (build 10358 or newer), then choose its llama-server in Settings or add its folder to PATH.";

/** Settings › Models on this computer: no llama-server, as the checks found. */
export const LLAMA_SERVER_MISSING: LlamaServerStatus = {
  source: null,
  ready: false,
  problem: "llama-server isn't installed, or isn't on PATH.",
  hint: 'Install llama.cpp (build 10358 or newer), then choose its llama-server in Settings or add its folder to PATH.',
  minimumBuild: 10358,
};

/** The checks a version with trained weights gets where llama.cpp isn't installed. */
const WEIGHTS_CHECKS = {
  compatibility: passed(
    'compatibility',
    'compatibility',
    "win32/x64, 32 GB of memory, llama.cpp with its adapter, on its base from Ollama's store.",
  ),
  server: {
    id: 'adapter-runtime',
    kind: 'adapter_runtime',
    status: 'failed',
    detail: NO_LLAMA_SERVER,
  } satisfies InstallCheck,
  base: {
    ...passed(
      'model-available',
      'model_available',
      `muse-glimmer:30b in Ollama's store, the build its adapter was trained on (sha256:${'a'.repeat(12)}), and its adapter as installed.`,
    ),
    sameBuild: true,
  },
  responds: {
    id: 'model-responds',
    kind: 'model_responds',
    status: 'skipped',
    detail: "Skipped: llama-server can't run it yet.",
    skipped: 'after_failure',
  } satisfies InstallCheck,
};

function preview(madeFor: Job, agentId: string, tools: string[], weights = false): ImportPreview {
  return ImportPreviewSchema.parse({
    ok: true,
    manifest: manifestFor({
      job: madeFor,
      agentId,
      version: weights ? 2 : 1,
      createdAt: at(-3 * 24 * 60),
      status: 'ready',
      score: weights ? { pass: 58, total: 60 } : { pass: 56, total: 60 },
      tools,
      adapter: weights,
    }),
    digest: hex('7'),
    files: weights ? 15 : 14,
    bytes: weights ? 123_793_408 : 61_440,
    place: { kind: 'new' },
    machine: MACHINE,
    model: { runtime: 'ollama', baseUrl: 'http://127.0.0.1:11434', model: 'muse-glimmer:30b' },
    checks: weights
      ? [WEIGHTS_CHECKS.compatibility, WEIGHTS_CHECKS.server, WEIGHTS_CHECKS.base]
      : [
          passed(
            'compatibility',
            'compatibility',
            'win32/x64, 32 GB of memory, ollama at 127.0.0.1:11434.',
          ),
          {
            ...passed(
              'model-available',
              'model_available',
              'muse-glimmer:30b on ollama, the same build that was tested.',
            ),
            sameBuild: true,
          },
        ],
    status: weights ? 'needs_attention' : 'ready',
    reasons: weights ? [NO_LLAMA_SERVER] : [],
  });
}

const PREVIEWS: Record<string, ImportPreview> = {
  [PACKAGES.ready]: preview(returnsJob, 'grd_returns', ['label_for']),
  [PACKAGES.weights]: preview(returnsJob, 'grd_returns', ['label_for'], true),
  [PACKAGES.blocked]: preview(frontDeskJob, 'grd_front', ['lookup_order']),
  [PACKAGES.broken]: {
    ok: false,
    code: 'checksum',
    problems: [
      'harness/AGENTS.md has a different checksum than graduate.json lists, so it was changed after it was packaged.',
      "tools/price_job.js is in the package but graduate.json doesn't list it.",
    ],
  },
};

/** The agent an import adds, as the sidebar lists it. */
function importedAgent(
  madeFor: Job,
  agentId: string,
  status: GraduateSummary['status'],
): GraduateSummary {
  return {
    ...graduate,
    id: agentId,
    name: madeFor.name,
    manifest: { ...graduate.manifest, id: agentId, name: madeFor.name, jobId: madeFor.id },
    activeVersion: 1,
    versions: 1,
    status,
  };
}

/**
 * What installing each package gives: the returns desk is ready once its records folder is
 * bound and allowed, and needs attention otherwise; the front desk is blocked by a tool that
 * doesn't load, whatever its folders.
 */
function importResultFor(
  path: string,
  request: {
    bindings?: Record<string, string>;
    grants?: { resources?: Record<string, ResourceGrant> };
  },
): ImportResult {
  if (path === PACKAGES.blocked) {
    const blockedReason =
      "Its tool lookup_order doesn't load: SyntaxError: unexpected token on line 3";
    const checks: InstallCheck[] = READY_CHECKS.map((check) => {
      if (check.kind === 'tools_load') return { ...check, status: 'failed', detail: blockedReason };
      if (check.kind.startsWith('model_')) {
        return {
          ...check,
          status: 'skipped',
          detail: 'Skipped: this computer cannot run it as it is.',
          skipped: 'after_failure',
        };
      }
      return check;
    });
    return {
      graduate: importedAgent(frontDeskJob, 'grd_front', 'blocked'),
      version: 1,
      installation: installation('grd_front', {
        version: 1,
        status: 'blocked',
        reasons: [blockedReason],
        checks,
        bindings: request.bindings ?? {},
      }),
      alreadyInstalled: false,
    };
  }
  const data = request.bindings?.['data'];
  const granted = request.grants?.resources?.['data'] ?? 'none';
  const bound = data !== undefined && granted !== 'none';
  const reason = !data
    ? 'Choose a folder for data/: it should hold orders.csv, returns.csv, pickups.csv, policy.md.'
    : "data/ has a folder, but the agent isn't allowed to open it.";
  const problem = data ? ('not_allowed' as const) : ('not_chosen' as const);
  const folders = READY_CHECKS.map((check) =>
    check.kind === 'resources_bound' && !bound
      ? {
          ...check,
          status: 'failed' as const,
          detail: reason,
          folders: [{ name: 'data', problem }],
        }
      : check,
  );
  // With trained weights, llama.cpp serves it, and this computer has no llama-server yet.
  const weights = path === PACKAGES.weights;
  const checks = weights
    ? [
        WEIGHTS_CHECKS.compatibility,
        ...folders.filter((check) =>
          ['harness_valid', 'tools_load', 'resources_bound'].includes(check.kind),
        ),
        WEIGHTS_CHECKS.server,
        WEIGHTS_CHECKS.base,
        WEIGHTS_CHECKS.responds,
      ]
    : folders;
  const reasons = [...(bound ? [] : [reason]), ...(weights ? [NO_LLAMA_SERVER] : [])];
  const ready = reasons.length === 0;
  return {
    graduate: importedAgent(returnsJob, 'grd_returns', ready ? 'ready' : 'needs_attention'),
    version: 1,
    installation: installation('grd_returns', {
      version: 1,
      bindings: request.bindings ?? {},
      grants: {
        writes: 'ask',
        resources: { data: 'none', output: 'none', ...request.grants?.resources },
      },
      status: ready ? 'ready' : 'needs_attention',
      reasons,
      checks,
    }),
    alreadyInstalled: false,
  };
}

export interface PackagesSeed {
  versions: GraduateVersion[];
  installation: Installation;
}

/**
 * Answers the versions, installation, export and import channels in the main process, with
 * state: promoting, rolling back and importing change what the next read returns. Calls are
 * recorded alongside the workspace fake's. Folder and file pickers answer from a queue.
 */
export async function installPackagesFake(
  app: ElectronApplication,
  seed: PackagesSeed,
): Promise<void> {
  const data = {
    seed,
    agent: AGENT_WITH_VERSIONS,
    previews: PREVIEWS,
    packages: PACKAGES,
    llamaServer: LLAMA_SERVER_MISSING,
    results: Object.fromEntries(
      [PACKAGES.ready, PACKAGES.weights, PACKAGES.blocked].flatMap((path) => [
        [
          `${path}|ready`,
          importResultFor(path, {
            bindings: { data: FOLDERS.records },
            grants: { resources: { data: 'read_write' } },
          }),
        ],
        [`${path}|unbound`, importResultFor(path, {})],
      ]),
    ),
    reviews: { plain: exportReview([]), sharing: exportReview(['resource:data']) },
  };
  await app.evaluate(({ ipcMain }, data) => {
    type Fake = { calls: { channel: string; args: unknown[] }[]; picks?: string[] };
    const fake = (globalThis as unknown as { fakeEngine: Fake }).fakeEngine;
    const versions = data.seed.versions.map((item) => ({ ...item }));
    let installed = { ...data.seed.installation };
    let agents = [{ ...data.agent }];
    let chats = 0;
    fake.picks = [];

    const handle = (channel: string, reply: (...args: never[]) => unknown) => {
      ipcMain.removeHandler(channel);
      ipcMain.handle(channel, async (_event, ...args: unknown[]) => {
        fake.calls.push({ channel, args });
        try {
          return { ok: true, value: await reply(...(args as never[])) };
        } catch (error) {
          return {
            ok: false,
            error: { message: error instanceof Error ? error.message : 'Failed' },
          };
        }
      });
    };
    const activate = (number: number) => {
      for (const item of versions) item.active = item.version === number;
      agents = agents.map((agent) =>
        agent.id === data.agent.id ? { ...agent, activeVersion: number } : agent,
      );
      installed = { ...installed, version: number };
      return agents.find((agent) => agent.id === data.agent.id);
    };

    handle('files:pick', () => {
      const next = fake.picks?.shift();
      return next === undefined ? [] : [next];
    });
    // Settings › Models asks about llama-server; the real one on this computer never runs.
    handle('connections:llamaServer', () => data.llamaServer);
    handle('graduates:list', () => agents);
    handle('graduates:versions', () => versions);
    handle('graduates:history', () => []);
    handle('graduates:installation', () => installed);
    handle('graduates:verify', () => installed);
    handle('graduates:acceptVersion', (_id: string, number: number) => {
      const found = versions.find((item) => item.version === number);
      if (!found) throw new Error(`No version ${number}.`);
      found.state = 'accepted';
      return found;
    });
    handle('graduates:promote', (_id: string, number: number) => activate(number));
    handle('graduates:rollback', (_id: string, number: number) => activate(number));
    handle('graduates:reviewExport', (_id: string, _version: unknown, include: string[]) =>
      include.includes('resource:data') ? data.reviews.sharing : data.reviews.plain,
    );
    handle('graduates:exportPackage', (_id: string, request: { directory: string }) => ({
      folder: `${request.directory}\\service-desk-v2`,
      archive: `${request.directory}\\service-desk-v2.architect.zip`,
      files: ['graduate.json'],
      bytes: 123_781_481,
      digest: '1'.repeat(64),
      findings: [],
    }));
    handle('graduates:exportPart', (_id: string, request: { directory: string; part: string }) => ({
      path: `${request.directory}\\service-desk-v2-${request.part}`,
      files: [],
      bytes: 21_400,
      findings: [],
    }));
    handle('graduates:previewImport', (path: string) => {
      const found = data.previews[path];
      if (!found) throw new Error(`${path} isn't a file or a folder.`);
      return found;
    });
    handle(
      'graduates:importPackage',
      (
        path: string,
        request: {
          bindings?: Record<string, string>;
          grants?: { resources?: Record<string, string> };
        },
      ) => {
        const bound = request.bindings?.['data'] !== undefined;
        const granted = (request.grants?.resources?.['data'] ?? 'none') !== 'none';
        const key = `${path}|${bound && granted ? 'ready' : 'unbound'}`;
        const result = data.results[key];
        if (!result) throw new Error(`No package at ${path}.`);
        agents = [...agents.filter((agent) => agent.id !== result.graduate.id), result.graduate];
        return result;
      },
    );
    handle('graduates:remove', (graduateId: string) => {
      agents = agents.filter((agent) => agent.id !== graduateId);
    });
    // Binding the returns desk's records folder from its result makes it ready.
    handle('graduates:bind', () => data.results[`${data.packages.ready}|ready`]?.installation);
    handle('workspace:createChat', (graduateId: string) => {
      chats += 1;
      const at = new Date().toISOString();
      return {
        id: `cht_imported_${chats}`,
        graduateId,
        title: 'New chat',
        createdAt: at,
        updatedAt: at,
        running: false,
        waiting: false,
        graduateVersion: 1,
      };
    });
  }, data);
}

/** The files and folders the next pickers return, in order. */
export async function queuePicks(app: ElectronApplication, paths: string[]): Promise<void> {
  await app.evaluate((_electron, paths) => {
    const fake = (globalThis as unknown as { fakeEngine: { picks?: string[] } }).fakeEngine;
    fake.picks = [...(fake.picks ?? []), ...paths];
  }, paths);
}
