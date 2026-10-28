import { renderModelCard } from '@architect/engine/graduates';
import {
  GraduateVersionSchema,
  HubInstallResultSchema,
  InstallationSchema,
  LMSTUDIO_BASE_URL,
  OLLAMA_BASE_URL,
  PublicationReviewSchema,
  PublicationSchema,
  type GraduateSummary,
  type HubInstallResult,
  type HubTokenStatus,
  type InstallCheck,
  type Installation,
  type LocalRuntimes,
  type Publication,
  type PublicationReview,
  type PublishProgress,
} from '@architect/shared';
import type { ElectronApplication } from '@playwright/test';
import {
  AGENT_WITH_VERSIONS,
  hex,
  installation,
  manifestFor,
  passed,
  READY_CHECKS,
  returnsJob,
  VERSIONS,
} from './fixtures-versions';
import { at, graduate, STORY } from './story';

/*
 * Hugging Face for the screens: a publication's review, its progress and its outcome, the
 * agent's publications, where the token comes from, a version installed from the Hub, and a
 * change of the agent's model. A stand-in engine (below) keeps their state in the main process,
 * as the versions fixtures do; the real engine against the fake Hub is `hub.spec.ts`.
 */

export const HUB = {
  repository: 'dana/service-desk',
  /** Where the returns desk was published by its author. */
  returns: 'dana/returns-desk',
  /** The commit a publication of version 2 makes, and the one version 1 went up at. */
  commit: '3f1c9e2a8d4b6c0e1f2a3b4c5d6e7f8091a2b3c4',
  earlierCommit: '9b2e41d07c5a3f8e6d1c2b0a9f8e7d6c5b4a3921',
  /** The commit the returns desk is installed at. */
  returnsCommit: 'c41d8a2e6f0b9d3c7a5e1f2b4d6c8a0e9f1b3d57',
};

const ACTIVE = VERSIONS.find((version) => version.active) ?? VERSIONS[1];

/** The card a publication writes, for a repository; its install command names the commit. */
function cardFor(repository: string, revision: string | null): string {
  if (!ACTIVE) throw new Error('No active version.');
  return renderModelCard(ACTIVE.manifest, { repository, revision });
}

const byPath = (a: { path: string }, b: { path: string }) => (a.path < b.path ? -1 : 1);

/** What publishing version 2 to a repository would send, scanned: nothing found. */
export function publicationReview(repository: string): PublicationReview {
  if (!ACTIVE) throw new Error('No active version.');
  const card = cardFor(repository, null);
  const files = [
    { path: 'graduate.json', bytes: 9_814 },
    ...ACTIVE.manifest.integrity.files.map((file) => ({ path: file.path, bytes: file.size })),
    { path: 'README.md', bytes: Buffer.byteLength(card) },
  ].sort(byPath);
  return PublicationReviewSchema.parse({
    graduateId: STORY.graduateId,
    version: ACTIVE.version,
    name: 'Service desk',
    repository,
    visibility: 'private',
    files,
    bytes: files.reduce((sum, file) => sum + file.bytes, 0),
    card,
    findings: [],
    findingsDigest: hex('0'),
    notices: [],
  });
}

/** Version 1, published to the same repository the day it graduated. */
export const EARLIER_PUBLICATION: Publication = PublicationSchema.parse({
  id: 'pub_first',
  graduateId: STORY.graduateId,
  version: 1,
  destination: 'huggingface',
  repository: HUB.repository,
  visibility: 'private',
  revision: HUB.earlierCommit,
  url: `https://huggingface.co/${HUB.repository}`,
  digest: hex('1'),
  status: 'complete',
  createdAt: at(200),
  updatedAt: at(200),
});

/** The upload of version 2 partway, as the engine reports it. */
export function uploading(sentBytes: number): PublishProgress {
  const review = publicationReview(HUB.repository);
  const card = review.files.find((file) => file.path === 'README.md')?.bytes ?? 0;
  return {
    graduateId: STORY.graduateId,
    version: 2,
    repository: HUB.repository,
    stage: 'uploading',
    sentBytes,
    totalBytes: review.bytes - card,
  };
}

/** The returns desk as its author published it: version 1, ready on their computer. */
const RETURNS_MANIFEST = manifestFor({
  job: returnsJob,
  agentId: 'grd_returns',
  version: 1,
  createdAt: at(-3 * 24 * 60),
  status: 'ready',
  score: { pass: 56, total: 60 },
  tools: ['label_for'],
});

const RETURNS_SOURCE = {
  kind: 'huggingface' as const,
  repository: HUB.returns,
  revision: HUB.returnsCommit,
  url: `https://huggingface.co/${HUB.returns}/tree/${HUB.returnsCommit}`,
};

const RETURNS_AGENT: GraduateSummary = {
  ...graduate,
  id: 'grd_returns',
  name: returnsJob.name,
  manifest: {
    ...graduate.manifest,
    id: 'grd_returns',
    name: returnsJob.name,
    jobId: returnsJob.id,
  },
  activeVersion: 1,
  versions: 1,
  status: 'needs_attention',
};

const RETURNS_VERSION = GraduateVersionSchema.parse({
  graduateId: 'grd_returns',
  version: 1,
  origin: { agentId: 'grd_returns', version: 1, digest: hex('7') },
  state: 'accepted',
  active: true,
  evaluation: 'ready',
  contractVersion: 1,
  digest: hex('7'),
  source: RETURNS_SOURCE,
  path: 'graduates/grd_returns/versions/1',
  manifest: RETURNS_MANIFEST,
  createdAt: at(400),
  acceptedAt: at(400),
});

/** As the download installs it: nothing granted, its model described but not loaded. */
function returnsInstallation(bound: boolean): Installation {
  const checks: InstallCheck[] = READY_CHECKS.map((check) => {
    if (check.kind === 'resources_bound' && !bound) {
      return {
        ...check,
        status: 'failed',
        detail:
          'Choose a folder for data/: it should hold orders.csv, returns.csv, pickups.csv, policy.md.',
        folders: [{ name: 'data', problem: 'not_chosen' }],
      };
    }
    if (check.kind === 'model_responds' && !bound) {
      return {
        id: 'model-responds',
        kind: 'model_responds',
        status: 'skipped',
        detail: 'Not asked for.',
        skipped: 'not_asked',
      };
    }
    return check;
  });
  return InstallationSchema.parse(
    installation('grd_returns', {
      version: 1,
      bindings: bound ? { data: 'C:\\Users\\dana\\Documents\\Larchwood\\Records' } : {},
      grants: {
        writes: 'ask',
        resources: { data: bound ? 'read_write' : 'none', output: 'none' },
      },
      status: bound ? 'ready' : 'needs_attention',
      reasons: bound
        ? []
        : [
            'Choose a folder for data/: it should hold orders.csv, returns.csv, pickups.csv, policy.md.',
          ],
      checks,
    }),
  );
}

const HUB_INSTALL: HubInstallResult = HubInstallResultSchema.parse({
  graduate: RETURNS_AGENT,
  version: 1,
  installation: returnsInstallation(false),
  alreadyInstalled: false,
  source: RETURNS_SOURCE,
});

/** What the engine says of a base of another build than the one the trained weights need. */
export const OTHER_BUILD_REASON = `muse-glimmer:30b on this computer is another build (weights sha256:5c0e17ab92d4) than the one its adapter was trained on (sha256:${'a'.repeat(12)}). It needs the exact base it was trained on, the build whose weights are sha256:${'a'.repeat(64)}: add that build to Ollama under a name of its own, then set this agent's model to that name. That build is about 18 GB.`;

/** Version 2, whose trained weights need a base this computer has under another name. */
export function otherBuildInstallation(): Installation {
  return InstallationSchema.parse(
    installation(STORY.graduateId, {
      status: 'blocked',
      reasons: [OTHER_BUILD_REASON],
      checks: [
        passed(
          'compatibility',
          'compatibility',
          "win32/x64, 32 GB of memory, llama.cpp with its adapter, on its base from Ollama's store.",
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
            'adapter-runtime',
            'adapter_runtime',
            'llama-server build 10472, at C:\\Tools\\llama.cpp\\llama-server.exe.',
          ),
          build: 10472,
        },
        {
          id: 'model-available',
          kind: 'model_available',
          status: 'failed',
          detail: OTHER_BUILD_REASON,
          sameBuild: false,
          modelProblem: 'other_build',
        },
        {
          id: 'model-responds',
          kind: 'model_responds',
          status: 'skipped',
          detail: 'Skipped: this computer cannot run it as it is.',
          skipped: 'after_failure',
        },
      ],
    }),
  );
}

/** The exact build, added to Ollama under a name of its own, as the reason says to. */
export const EXACT_BUILD = 'muse-glimmer-trained:30b';

/** Ollama here, with the base of another build, the exact build under its own name, and more. */
export const LOCAL_MODELS: LocalRuntimes = {
  ollama: {
    running: true,
    version: '0.40.9',
    baseUrl: OLLAMA_BASE_URL,
    models: [
      { id: 'muse-glimmer:30b', sizeBytes: 18_157_010_252 },
      { id: EXACT_BUILD, sizeBytes: 18_157_010_252 },
      { id: 'muse-glimmer:30b-iq2', sizeBytes: 10_746_373_364 },
    ],
  },
  lmstudio: { running: false, baseUrl: LMSTUDIO_BASE_URL, models: [] },
  gpu: { name: 'NVIDIA GeForce RTX 4070', memoryBytes: 12 * 1024 ** 3, shared: false },
};

/** Ready to run on the exact build, once it is chosen. */
function exactBuildInstallation(model: string): Installation {
  const base = otherBuildInstallation();
  return InstallationSchema.parse({
    ...base,
    model: { ...base.model, model },
    status: 'ready',
    reasons: [],
    checks: base.checks.map((check) =>
      check.kind === 'model_available'
        ? {
            id: 'model-available',
            kind: 'model_available',
            status: 'passed',
            detail: `${model} in Ollama's store, the build its adapter was trained on (sha256:${'a'.repeat(12)}), and its adapter as installed.`,
            sameBuild: true,
          }
        : check.kind === 'model_responds'
          ? {
              id: 'model-responds',
              kind: 'model_responds',
              status: 'skipped',
              detail: 'Not asked for.',
              skipped: 'not_asked',
            }
          : check,
    ),
  });
}

export interface HubSeed {
  /** Where the Hugging Face token comes from. */
  token: HubTokenStatus['source'];
  publications: Publication[];
  /** The agent's installation here, when a test needs another than the ready one. */
  installation?: Installation;
}

/**
 * Answers the Hugging Face, publishing, Hub install and model channels in the main process, with
 * state. `graduates:publish` waits until the test settles it (`settlePublish`), so a capture can
 * show it on its way. Install it after the workspace and versions fakes, whose calls it records
 * alongside theirs.
 */
export async function installHubFake(app: ElectronApplication, seed: HubSeed): Promise<void> {
  const data = {
    seed,
    agent: AGENT_WITH_VERSIONS,
    versions: VERSIONS,
    activeInstallation: seed.installation ?? installation(STORY.graduateId),
    reviewTemplate: publicationReview('{{repository}}'),
    hub: HUB,
    install: HUB_INSTALL,
    returnsVersion: RETURNS_VERSION,
    returnsBound: returnsInstallation(true),
    local: LOCAL_MODELS,
    exact: exactBuildInstallation(EXACT_BUILD),
  };
  await app.evaluate(({ ipcMain }, data) => {
    type Pending = { resolve: (value: unknown) => void; reject: (error: Error) => void };
    type Fake = {
      calls: { channel: string; args: unknown[] }[];
      publishing?: Pending & { repository: string; version: number };
      hub?: { token: unknown };
    };
    const fake = (globalThis as unknown as { fakeEngine: Fake }).fakeEngine;
    const state = { token: data.seed.token };
    fake.hub = state;
    let publications = data.seed.publications.map((entry) => ({ ...entry }));
    let agents = [{ ...data.agent }];
    let active = { ...data.activeInstallation };
    let returns = { ...data.install.installation };
    const repositoryIn = (text: string, repository: string) =>
      text.replaceAll('{{repository}}', repository);

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

    handle('connections:huggingFace', () => ({ source: state.token }));
    handle('connections:detectLocal', () => data.local);
    // A key's name is recorded, never its value.
    ipcMain.removeHandler('secrets:set');
    ipcMain.handle('secrets:set', (_event, ref: unknown) => {
      fake.calls.push({ channel: 'secrets:set', args: [ref] });
      if (ref === 'huggingface') state.token = 'saved';
      return { ok: true, value: undefined };
    });
    handle('secrets:clear', (ref: string) => {
      if (ref === 'huggingface') state.token = null;
    });
    handle('app:openLink', () => undefined);
    handle('graduates:list', () => agents);
    handle('graduates:versions', (graduateId: string) =>
      graduateId === 'grd_returns' ? [data.returnsVersion] : data.versions,
    );
    handle('graduates:installation', (graduateId: string) =>
      graduateId === 'grd_returns' ? returns : active,
    );
    handle('graduates:publications', () => publications);
    handle(
      'graduates:reviewPublication',
      (_id: string, request: { repository: string; visibility?: string }) => ({
        ...data.reviewTemplate,
        repository: request.repository,
        visibility: request.visibility ?? 'private',
        card: repositoryIn(data.reviewTemplate.card, request.repository),
      }),
    );
    handle(
      'graduates:publish',
      (_id: string, request: { repository: string }) =>
        new Promise((resolve, reject) => {
          fake.publishing = { resolve, reject, repository: request.repository, version: 2 };
        }),
    );
    handle('graduates:installFromHub', () => {
      agents = [...agents.filter((agent) => agent.id !== 'grd_returns'), data.install.graduate];
      return data.install;
    });
    handle('graduates:bind', (graduateId: string, request: { model?: { model: string } }) => {
      if (graduateId === 'grd_returns') {
        returns = { ...data.returnsBound };
        return returns;
      }
      if (request.model) {
        const { model } = request.model;
        active = { ...data.exact, model: { ...data.exact.model, ...request.model } };
        // The list's view of the agent names the model this computer now runs it on.
        agents = agents.map((agent) =>
          agent.id === data.agent.id
            ? {
                ...agent,
                status: 'ready',
                manifest: { ...agent.manifest, student: { ...agent.manifest.student, model } },
              }
            : agent,
        );
      }
      return active;
    });
    handle('graduates:verify', (graduateId: string) =>
      graduateId === 'grd_returns' ? returns : active,
    );
    handle('graduates:remove', (graduateId: string) => {
      agents = agents.filter((agent) => agent.id !== graduateId);
    });
    handle('graduates:rejectVersion', () => data.returnsVersion);

    Object.assign(fake, {
      settlePublish(outcome: 'complete' | 'failed', message: string) {
        const pending = fake.publishing;
        if (!pending) throw new Error('Nothing is publishing.');
        fake.publishing = undefined;
        const at = new Date().toISOString();
        const existing = publications.find(
          (entry) => entry.repository === pending.repository && entry.version === pending.version,
        );
        const record = {
          id: existing?.id ?? `pub_${publications.length + 1}`,
          graduateId: data.agent.id,
          version: pending.version,
          destination: 'huggingface' as const,
          repository: pending.repository,
          visibility: 'private' as const,
          digest: '2'.repeat(64),
          createdAt: existing?.createdAt ?? at,
          updatedAt: at,
          ...(outcome === 'complete'
            ? {
                status: 'complete' as const,
                revision: data.hub.commit,
                url: `https://huggingface.co/${pending.repository}`,
              }
            : { status: 'failed' as const, error: message }),
        };
        publications = [...publications.filter((entry) => entry.id !== record.id), record];
        if (outcome === 'complete') {
          pending.resolve({ publication: record, files: [], alreadyPublished: false, notes: [] });
        } else {
          pending.reject(new Error(message));
        }
      },
    });
  }, data);
}

/** Ends the publication the screen started: published at `HUB.commit`, or failed with `message`. */
export async function settlePublish(
  app: ElectronApplication,
  outcome: 'complete' | 'failed',
  message = '',
): Promise<void> {
  await app.evaluate(
    (_electron, { outcome, message }) => {
      (
        globalThis as unknown as {
          fakeEngine: { settlePublish: (outcome: string, message: string) => void };
        }
      ).fakeEngine.settlePublish(outcome, message);
    },
    { outcome, message },
  );
}

/** Sends a publication's progress, as the engine would while it uploads. */
export async function emitPublishProgress(
  app: ElectronApplication,
  progress: PublishProgress,
): Promise<void> {
  await app.evaluate((_electron, progress) => {
    (
      globalThis as unknown as {
        fakeEngine: { broadcast: (channel: string, payload: unknown) => void };
      }
    ).fakeEngine.broadcast('graduates:onPublishProgress', progress);
  }, progress);
}

/** Whether the screen has started a publication the test hasn't settled yet. */
export function isPublishing(app: ElectronApplication): Promise<boolean> {
  return app.evaluate(
    () =>
      (globalThis as unknown as { fakeEngine: { publishing?: unknown } }).fakeEngine.publishing !==
      undefined,
  );
}
