import { readFile } from 'node:fs/promises';
import { harnessToFiles, readGraduate, type GraduateFolder } from '@architect/harness';
import {
  contractTerms,
  JobContractSchema,
  JobSchema,
  type Job,
  type JobContract,
} from '@architect/shared';
import type { Clock } from '../loop/deps';
import type { DataPaths } from '../loop/paths';
import { isoNow } from '../loop/time';
import type { EngineStore } from '../store/engine-store';
import type { GraduateRecord } from '../store/records';
import { sameComputerGrants } from './bindings';
import { resourcesFor, tableColumns, type VersionFacts } from './build';
import type { ContractBook } from './contracts';
import {
  registerVersion,
  sameComputerBindings,
  seedDataFolder,
  writeVersionFolder,
} from './versions';

export interface LegacyContext {
  store: EngineStore;
  paths: DataPaths;
  clock: Clock;
  contracts: ContractBook;
}

/** The job a format 1 graduate's run used, or the job's current file, or null when neither is here. */
async function legacyJob(paths: DataPaths, folder: GraduateFolder): Promise<Job | null> {
  const { jobId, runId } = folder.manifest;
  for (const file of [paths.runJobFile(jobId, runId), paths.jobFile(jobId)]) {
    try {
      return JobSchema.parse(JSON.parse(await readFile(file, 'utf8')));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue;
      throw error;
    }
  }
  return null;
}

/**
 * A contract for a format 1 graduate whose job isn't on this computer, from what its manifest
 * recorded: its task types and its bar. It names no files, since the manifest never did.
 */
export function contractFromManifest(folder: GraduateFolder): JobContract {
  const { manifest } = folder;
  const taskTypes = manifest.test.perType.map((type) => ({ id: type.type, label: type.label }));
  return JobContractSchema.parse({
    version: 1,
    jobId: manifest.jobId,
    name: manifest.name,
    description: `${manifest.name}, made before job contracts were recorded.`,
    capabilities: {
      taskTypes: taskTypes.length > 0 ? taskTypes : [{ id: 'general', label: 'General' }],
      does: [],
      doesNot: [],
    },
    inputs: { request: 'text', files: [] },
    outputs: { answer: 'text', files: [] },
    boundaries: { writes: 'ask', unseenFiles: 'never', network: 'none' },
    acceptance: {
      passRate: manifest.requirements.passRate.target,
      ...(manifest.requirements.p95LatencyMs === undefined
        ? {}
        : { p95LatencyMs: manifest.requirements.p95LatencyMs.target }),
    },
  });
}

/** What a format 1 folder says, as the facts of its version 1. */
export function legacyFacts(
  folder: GraduateFolder,
  contract: JobContract,
  columns: Readonly<Record<string, string[]>>,
  testedHere: boolean,
): VersionFacts {
  const { manifest, harness, report, lineage } = folder;
  const { student } = manifest;
  return {
    agentId: manifest.id,
    name: manifest.name,
    version: 1,
    createdAt: manifest.createdAt,
    method: manifest.method,
    contract,
    modelLabel: student.label,
    base: {
      name: student.model,
      ...(student.digest === undefined ? {} : { digest: student.digest }),
      ...(student.quantization === undefined ? {} : { quantization: student.quantization }),
      ...(student.sizeBytes === undefined ? {} : { sizeBytes: student.sizeBytes }),
    },
    contextLength: student.contextLength,
    runtime: student.runtime,
    harness: {
      meta: harness.meta,
      files: harnessToFiles(harness),
      ...(manifest.harness.round === undefined ? {} : { round: manifest.harness.round }),
      ...(manifest.harness.draft === undefined ? {} : { draft: manifest.harness.draft }),
    },
    report,
    lineage,
    columns,
    rounds: report.cost.rounds,
    keptChanges: lineage.filter((entry) => entry.decision === 'kept').length,
    testedHere,
  };
}

/**
 * Converts a graduate made before versions into its version 1, in place: the format 1 folder is
 * read and checked, a package is written beside it, and the machine settings its manifest held
 * (the model endpoint) become its installation, with its workspace folder and write mode as
 * they were. The format 1 files stay where they are.
 */
async function upgradeOne(ctx: LegacyContext, record: GraduateRecord): Promise<void> {
  const { store, paths } = ctx;
  const folder = await readGraduate(paths.fromStored(record.path));
  const { manifest } = folder;
  const job = await legacyJob(paths, folder);
  const contract =
    job === null
      ? contractFromManifest(folder)
      : store.jobs.get(job.id)
        ? ctx.contracts.ensure(job)
        : JobContractSchema.parse({ ...contractTerms(job), version: 1 });
  const columns = job === null ? {} : await tableColumns(paths.dataDir(job.id), contract);
  const runHere = store.runs.get(manifest.runId) !== null;
  const facts = legacyFacts(folder, contract, columns, runHere);
  const written = await writeVersionFolder(store, paths, facts);

  const data = paths.workspaceDir(record.id);
  if (job !== null) await seedDataFolder(data, paths.dataDir(job.id), contract.inputs.files);
  const bindings = await sameComputerBindings(paths, record.id, contract, data);
  const at = isoNow(ctx.clock);
  store.transaction(() => {
    registerVersion(store, paths, {
      graduateId: record.id,
      name: record.name,
      version: 1,
      written,
      ...(runHere ? { runId: manifest.runId } : {}),
      state: manifest.acceptedAt ? 'accepted' : 'candidate',
      ...(manifest.acceptedAt === undefined ? {} : { acceptedAt: manifest.acceptedAt }),
      installation: {
        graduateId: record.id,
        model: {
          runtime: manifest.student.runtime,
          baseUrl: manifest.student.baseUrl,
          model: manifest.student.model,
        },
        bindings,
        grants: sameComputerGrants(
          { contract, resources: resourcesFor(contract, columns) },
          record.settings?.writeMode ?? job?.permissions.writes ?? 'ask',
        ),
        createdAt: at,
        updatedAt: at,
      },
      at: manifest.createdAt,
    });
  });
}

/**
 * Converts every graduate still in format 1. One that can't be converted (its files were changed
 * after it was saved, say) is left as it was and reported; the rest still convert.
 */
export async function upgradeLegacyGraduates(ctx: LegacyContext): Promise<Map<string, string>> {
  const failures = new Map<string, string>();
  // Oldest first, so a job's contract versions are numbered in the order its graduates were made.
  for (const record of ctx.store.graduates.list().reverse()) {
    if (record.manifest === null || record.activeVersion !== null) continue;
    if (ctx.store.versions.list(record.id).length > 0) continue;
    try {
      await upgradeOne(ctx, record);
    } catch (error) {
      failures.set(
        record.id,
        `Its folder from before versions couldn't be converted: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
  return failures;
}
