import { readFile, rm, stat } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { isLoopbackUrl } from '@architect/adapters';
import { parseReportJson, sha256File } from '@architect/harness';
import {
  GrantsSchema,
  GuardError,
  type BindRequest,
  type GraduateSettings,
  type GraduateSummary,
  type GraduateVersion,
  type Installation,
  type Machine,
  type ModelBinding,
  type PackageManifest,
  type ReportCard,
  type StudentAdapter,
  type VersionEvent,
} from '@architect/shared';
import type { AdapterDeps, Clock, RuntimeDeps } from '../loop/deps';
import type { DataPaths } from '../loop/paths';
import { isoNow } from '../loop/time';
import type { EngineStore } from '../store/engine-store';
import type { GraduateRecord, StoredInstallation, StoredVersion } from '../store/records';
import { lesserGrant, storedFolder } from './bindings';
import {
  checkInstallation,
  fitChecks,
  thisMachine,
  type CheckDeps,
  type FitResult,
} from './checks';
import type { ContractBook } from './contracts';
import { upgradeLegacyGraduates } from './legacy';
import { installationView, versionInfo, workspaceView } from './view';

export interface LibraryContext {
  store: EngineStore;
  paths: DataPaths;
  clock: Clock;
  contracts: ContractBook;
  /** The sandbox for the tool check and a student for the model checks: all a library needs. */
  deps: {
    runtime: Pick<RuntimeDeps, 'createSandbox' | 'toolLoadProblem'>;
    adapters: Pick<AdapterDeps, 'createStudent'>;
  };
  /** This computer, for the compatibility check; tests stand in other machines. */
  machine?: () => Machine;
}

/** Runs one task at a time per key, so two changes to one agent never interleave. */
export class KeyedLock {
  private readonly tails = new Map<string, Promise<unknown>>();

  run<T>(key: string, task: () => Promise<T>): Promise<T> {
    const previous = this.tails.get(key) ?? Promise.resolve();
    const next = previous.then(task, task);
    const tail = next.catch(() => undefined);
    this.tails.set(key, tail);
    void tail.then(() => {
      if (this.tails.get(key) === tail) this.tails.delete(key);
    });
    return next;
  }
}

/**
 * Agents and their versions on this computer (decision 039). A version never changes once it is
 * written; what changes is which one is active, which ones the user accepted, and how this
 * computer is set up to run them. Promotion and rollback move the active version in one
 * transaction, so a chat never sees half of either.
 */
export class GraduateLibrary {
  readonly lock = new KeyedLock();
  private failures = new Map<string, string>();
  /** Why a graduate's install checks couldn't run when they were last tried, by id. */
  private readonly checkFailures = new Map<string, string>();

  constructor(readonly ctx: LibraryContext) {}

  /**
   * Starts the library: clears what an import or export cut short left in staging, then converts
   * graduates from before versions. Those that can't be converted are listed as blocked.
   */
  async upgrade(): Promise<void> {
    await rm(this.ctx.paths.stagingDir(), { recursive: true, force: true });
    this.failures = await upgradeLegacyGraduates(this.ctx);
  }

  private now(): string {
    return isoNow(this.ctx.clock);
  }

  agent(graduateId: string): GraduateRecord {
    const record = this.ctx.store.graduates.get(graduateId);
    if (!record) throw new Error(`There is no graduate "${graduateId}".`);
    return record;
  }

  version(graduateId: string, version: number): StoredVersion {
    const stored = this.ctx.store.versions.get(graduateId, version);
    if (!stored) throw new Error(`${this.agent(graduateId).name} has no version ${version}.`);
    return stored;
  }

  private installationOf(graduateId: string): StoredInstallation {
    const installation = this.ctx.store.installations.get(graduateId);
    if (!installation) {
      throw new Error(`${this.agent(graduateId).name} isn't installed on this computer.`);
    }
    return installation;
  }

  summaryOf(record: GraduateRecord): GraduateSummary | null {
    const { store, paths } = this.ctx;
    const versions = store.versions.list(record.id);
    const active = versions.find((version) => version.version === record.activeVersion) ?? null;
    const shown = active ?? versions.at(-1) ?? null;
    const installation = store.installations.get(record.id);
    if (shown === null || installation === null) {
      if (record.manifest === null) return null;
      return {
        id: record.id,
        name: record.name,
        manifest: record.manifest,
        path: paths.fromStored(record.path),
        activeVersion: null,
        versions: versions.length,
        status: 'blocked',
        reasons: [
          this.failures.get(record.id) ??
            "Its folder from before versions hasn't been converted yet.",
        ],
      };
    }
    const checks = active ? store.installationChecks.get(record.id, active.version) : null;
    const couldNotCheck = this.checkFailures.get(record.id);
    return {
      id: record.id,
      name: record.name,
      manifest: workspaceView(shown, installation.model),
      path: paths.fromStored(shown.path),
      activeVersion: active?.version ?? null,
      versions: versions.length,
      status: active === null ? 'blocked' : (checks?.status ?? 'unchecked'),
      reasons:
        active === null
          ? ['It has no version that can run yet.']
          : (checks?.reasons ?? (couldNotCheck === undefined ? [] : [couldNotCheck])),
    };
  }

  /**
   * Runs the active version's installation checks when none are stored, so a graduate made,
   * converted, promoted or rolled back here never shows as unchecked. The model isn't loaded:
   * that it answers is checked on request (`verify`). When the checks can't run at all, why
   * becomes the reason it shows, and the next call tries again.
   */
  ensureChecked(graduateId: string): Promise<void> {
    return this.lock.run(graduateId, async () => {
      const { store } = this.ctx;
      const agent = store.graduates.get(graduateId);
      if (!agent || agent.activeVersion === null || !store.installations.get(graduateId)) return;
      if (store.installationChecks.get(graduateId, agent.activeVersion)) return;
      try {
        await this.checkNow(graduateId, { loadModel: false });
        this.checkFailures.delete(graduateId);
      } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        this.checkFailures.set(graduateId, `Its install checks couldn't run: ${reason}`);
      }
    });
  }

  /** Every agent, each one's active version checked first if it never was. */
  async listChecked(): Promise<GraduateSummary[]> {
    for (const record of this.ctx.store.graduates.list()) await this.ensureChecked(record.id);
    return this.list();
  }

  /**
   * Whether this computer can run a package and serves its base model, before anything is
   * installed: the compatibility and model checks an installation would run, nothing loaded.
   */
  fit(manifest: PackageManifest, model: ModelBinding): Promise<FitResult> {
    return fitChecks(
      {
        machine: this.ctx.machine ?? thisMachine,
        createStudent: (binding, contextLength) => this.checkStudent(binding, contextLength),
      },
      manifest,
      model,
    );
  }

  /** A student on this computer's runtime, for the model checks. */
  private checkStudent(binding: ModelBinding, contextLength: number): StudentAdapter {
    return this.ctx.deps.adapters.createStudent(
      {
        runtime: binding.runtime,
        baseUrl: binding.baseUrl,
        model: binding.model,
        contextLength,
      },
      {},
    );
  }

  summary(graduateId: string): GraduateSummary {
    const summary = this.summaryOf(this.agent(graduateId));
    if (!summary) throw new Error(`There is no graduate "${graduateId}".`);
    return summary;
  }

  list(): GraduateSummary[] {
    return this.ctx.store.graduates.list().flatMap((record) => this.summaryOf(record) ?? []);
  }

  versions(graduateId: string): GraduateVersion[] {
    const { activeVersion } = this.agent(graduateId);
    return this.ctx.store.versions
      .list(graduateId)
      .map((version) => versionInfo(this.ctx.paths, version, activeVersion));
  }

  history(graduateId: string): VersionEvent[] {
    this.agent(graduateId);
    return this.ctx.store.versionEvents.list(graduateId);
  }

  /**
   * The report card a version carries (the active one by default): its own locked test, read
   * from its folder and held to its checksum, wherever the version was made. It is the author's
   * result, never this computer's checks.
   */
  async report(graduateId: string, which?: number): Promise<ReportCard> {
    const agent = this.agent(graduateId);
    const number = which ?? agent.activeVersion;
    if (number === null) throw new Error(`${agent.name} has no version that can run yet.`);
    const stored = this.version(graduateId, number);
    const file = stored.manifest.evidence.files?.report;
    if (file === undefined) {
      throw new Error(`No locked test measured version ${number} of ${agent.name}.`);
    }
    const path = join(this.ctx.paths.fromStored(stored.path), ...file.split('/'));
    const listed = stored.manifest.integrity.files.find((entry) => entry.path === file);
    if (listed === undefined || (await sha256File(path)) !== listed.sha256) {
      throw new Error(
        `The report of version ${number} of ${agent.name} changed on disk after it was made.`,
      );
    }
    return parseReportJson(await readFile(path, 'utf8'));
  }

  /** Accepts the version a run made. Its agent's first version is already the active one. */
  acceptRun(runId: string): GraduateSummary {
    const made = this.ctx.store.versions.forRun(runId);
    if (!made) throw new Error('This run has no graduate yet.');
    this.acceptVersion(made.graduateId, made.version);
    return this.summary(made.graduateId);
  }

  /** Accepting makes a version eligible to run; it doesn't make it the active one. */
  acceptVersion(graduateId: string, version: number): GraduateVersion {
    const { store } = this.ctx;
    store.transaction(() => {
      const stored = this.version(graduateId, version);
      if (stored.state === 'accepted') return;
      const at = this.now();
      store.versions.update({ ...stored, state: 'accepted', acceptedAt: at });
      store.versionEvents.insert({ graduateId, kind: 'accepted', version, at });
    });
    return this.versionInfoOf(graduateId, version);
  }

  rejectVersion(graduateId: string, version: number): GraduateVersion {
    const { store } = this.ctx;
    store.transaction(() => {
      const stored = this.version(graduateId, version);
      if (this.agent(graduateId).activeVersion === version) {
        throw new Error(
          `Version ${version} is the one chats run on. Promote or roll back to another version first.`,
        );
      }
      if (stored.state === 'rejected') return;
      const { acceptedAt: _accepted, ...rest } = stored;
      store.versions.update({ ...rest, state: 'rejected' });
      store.versionEvents.insert({ graduateId, kind: 'rejected', version, at: this.now() });
    });
    return this.versionInfoOf(graduateId, version);
  }

  private versionInfoOf(graduateId: string, version: number): GraduateVersion {
    return versionInfo(
      this.ctx.paths,
      this.version(graduateId, version),
      this.agent(graduateId).activeVersion,
    );
  }

  /**
   * Makes an accepted version the active one. One transaction moves the pointer and records
   * the event; the version's folder holds its harness and adapter together, so they switch as
   * one. Chats already answering finish on the version they started with. A version imported
   * from elsewhere never inherits permission to write without asking: anyone holding an export
   * can make a package that continues it.
   */
  promote(graduateId: string, version: number): GraduateSummary {
    return this.activate(graduateId, version, 'promoted');
  }

  /** Makes an earlier accepted version active again, harness and adapter together. */
  rollback(graduateId: string, version: number): GraduateSummary {
    return this.activate(graduateId, version, 'rolled_back');
  }

  private activate(
    graduateId: string,
    version: number,
    kind: 'promoted' | 'rolled_back',
  ): GraduateSummary {
    const { store } = this.ctx;
    store.transaction(() => {
      const agent = this.agent(graduateId);
      const stored = this.version(graduateId, version);
      if (stored.state !== 'accepted') {
        throw new Error(
          `Version ${version} of ${agent.name} hasn't been accepted. Accept it before it can run.`,
        );
      }
      if (agent.activeVersion === version) return;
      if (
        kind === 'rolled_back' &&
        (agent.activeVersion === null || version > agent.activeVersion)
      ) {
        throw new Error(
          `Version ${version} isn't earlier than the active version, so that would be a promotion.`,
        );
      }
      store.graduates.update({ ...agent, activeVersion: version });
      const installation = store.installations.get(graduateId);
      if (stored.origin !== undefined && installation?.grants.writes === 'allow') {
        store.installations.put({
          ...installation,
          grants: { ...installation.grants, writes: 'ask' },
          updatedAt: this.now(),
        });
      }
      store.versionEvents.insert({
        graduateId,
        kind,
        version,
        ...(agent.activeVersion === null ? {} : { from: agent.activeVersion }),
        at: this.now(),
      });
    });
    return this.summary(graduateId);
  }

  /** This computer's installation of the agent, with a version's last checks: the active one's by default. */
  installation(graduateId: string, which?: number): Installation {
    const agent = this.agent(graduateId);
    const installation = this.installationOf(graduateId);
    const version =
      which ?? agent.activeVersion ?? this.ctx.store.versions.list(graduateId).at(-1)?.version;
    if (version === undefined) throw new Error(`${agent.name} has no versions.`);
    return installationView(
      this.ctx.paths,
      installation,
      version,
      this.ctx.store.installationChecks.get(graduateId, version),
    );
  }

  /**
   * Binds resources to folders and changes grants or the model endpoint. A folder must exist; a
   * grant never exceeds what the active version asks for; a model endpoint must be on this
   * computer. Only what the request names changes: the installation is read again and merged in
   * one transaction, so a change made meanwhile (a write mode, say) isn't undone. It is checked
   * again afterwards, without loading the model.
   */
  bind(graduateId: string, request: BindRequest): Promise<Installation> {
    return this.lock.run(graduateId, async () => {
      const { store, paths } = this.ctx;
      const agent = this.agent(graduateId);
      const version = this.version(graduateId, agent.activeVersion ?? 1);
      const resources = new Map(
        version.manifest.resources.map((resource) => [resource.name, resource]),
      );
      const folders: Record<string, string> = {};
      for (const [name, folder] of Object.entries(request.bindings ?? {})) {
        if (!resources.has(name)) {
          throw new Error(`${agent.name} has no resource called "${name}".`);
        }
        const absolute = resolve(folder);
        if (!(await stat(absolute).catch(() => null))?.isDirectory()) {
          throw new Error(`${absolute} isn't a folder.`);
        }
        folders[name] = storedFolder(paths, absolute);
      }
      if (request.model && !isLoopbackUrl(request.model.baseUrl)) {
        throw new GuardError(
          'network',
          `${new URL(request.model.baseUrl).host} isn't this computer. A graduate only runs on a local model.`,
        );
      }
      store.transaction(() => {
        const installation = this.installationOf(graduateId);
        const named = request.grants?.resources ?? {};
        store.installations.put({
          ...installation,
          bindings: { ...installation.bindings, ...folders },
          grants: GrantsSchema.parse({
            writes: request.grants?.writes ?? installation.grants.writes,
            resources: Object.fromEntries(
              [...resources.values()].map((resource) => [
                resource.name,
                lesserGrant(
                  named[resource.name] ?? installation.grants.resources[resource.name] ?? 'none',
                  resource.access,
                ),
              ]),
            ),
          }),
          model: request.model ?? installation.model,
          updatedAt: this.now(),
        });
      });
      await this.checkNow(graduateId, { loadModel: false });
      return this.installation(graduateId);
    });
  }

  /** Runs the active version's installation checks again. */
  verify(graduateId: string, options: { loadModel?: boolean } = {}): Promise<Installation> {
    return this.lock.run(graduateId, async () => {
      await this.checkNow(graduateId, { loadModel: options.loadModel ?? true });
      return this.installation(graduateId);
    });
  }

  /** Checks a version (the active one by default) and stores the result. Callers hold the lock. */
  async checkNow(
    graduateId: string,
    options: { loadModel: boolean; version?: number },
  ): Promise<void> {
    const { store } = this.ctx;
    const agent = this.agent(graduateId);
    const number = options.version ?? agent.activeVersion;
    if (number === null) throw new Error(`${agent.name} has no version that can run yet.`);
    const sandbox = await this.ctx.deps.runtime.createSandbox();
    try {
      const deps: CheckDeps = {
        paths: this.ctx.paths,
        machine: this.ctx.machine ?? thisMachine,
        toolLoadProblem: (tool) => this.ctx.deps.runtime.toolLoadProblem(sandbox, tool),
        createStudent: (binding, contextLength) => this.checkStudent(binding, contextLength),
        now: () => this.now(),
      };
      const checks = await checkInstallation(
        deps,
        this.version(graduateId, number),
        this.installationOf(graduateId),
        { loadModel: options.loadModel },
      );
      store.installationChecks.put(checks);
    } finally {
      await sandbox.dispose();
    }
  }

  /** The workspace's write mode: what this computer granted, which starts as the job's. */
  settings(graduateId: string): GraduateSettings {
    const installation = this.ctx.store.installations.get(graduateId);
    if (installation) return { writeMode: installation.grants.writes };
    return { writeMode: this.agent(graduateId).settings?.writeMode ?? 'ask' };
  }

  updateSettings(graduateId: string, patch: Partial<GraduateSettings>): GraduateSettings {
    const { store } = this.ctx;
    store.transaction(() => {
      const installation = this.installationOf(graduateId);
      if (patch.writeMode === undefined) return;
      store.installations.put({
        ...installation,
        grants: { ...installation.grants, writes: patch.writeMode },
        updatedAt: this.now(),
      });
    });
    return this.settings(graduateId);
  }

  /** Removes the agent, every version and its installation. Its data folders stay where they are. */
  async remove(graduateId: string): Promise<void> {
    const record = this.agent(graduateId);
    this.ctx.store.graduates.remove(record.id);
    this.failures.delete(record.id);
    this.checkFailures.delete(record.id);
    await rm(this.ctx.paths.fromStored(record.path), { recursive: true, force: true });
  }
}
