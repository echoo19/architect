import { statSync } from 'node:fs';
import type { WrittenPackage } from '@architect/harness';
import type {
  Harness,
  Job,
  JobContract,
  LineageEntry,
  ReportCard,
  Round,
  Run,
} from '@architect/shared';
import type { DataPaths } from '../loop/paths';
import type { EngineStore } from '../store/engine-store';
import type { GraduateFreeze, StoredInstallation } from '../store/records';
import { sameComputerGrants } from './bindings';
import { resourcesFor, tableColumns, type AdapterFile, type VersionFacts } from './build';
import { sameComputerBindings, seedDataFolder, writeVersionFolder } from './versions';

/** The round whose kept change made a version, and whether it was a whole draft. */
function origin(rounds: readonly Round[], version: number): { round?: number; draft?: true } {
  const made = rounds.find(
    (round) => round.candidateVersion === version && round.decision === 'kept',
  );
  if (made === undefined) return {};
  return made.draft ? { round: made.index, draft: true } : { round: made.index };
}

export interface RunGraduation {
  job: Job;
  run: Run;
  contract: JobContract;
  freeze: GraduateFreeze;
  harness: Harness;
  /** The harness as files, from the same harness package that saved its versions. */
  harnessFiles: Readonly<Record<string, string>>;
  report: ReportCard;
  rounds: readonly Round[];
  lineage: readonly LineageEntry[];
}

/**
 * The adapter a frozen graduate was tested with, as its package ships it: the GGUF file named
 * the way the adapter runtime loads it (decision 038), at the scale its locked test used.
 */
export function adapterFile(paths: DataPaths, freeze: GraduateFreeze): AdapterFile {
  const adapter = freeze.configuration?.adapter;
  if (!adapter) throw new Error('The frozen graduate has no adapter.');
  if (adapter.baseDigest === undefined) {
    throw new Error(
      "The runtime that served this graduate's adapter didn't report its base model's digest, so the package can't name the base it loads on.",
    );
  }
  const source = paths.fromStored(adapter.path);
  return {
    path: 'adapter/adapter.gguf',
    format: 'gguf_lora',
    sha256: adapter.sha256,
    sizeBytes: statSync(source).size,
    baseDigest: adapter.baseDigest,
    scale: adapter.scale,
    trainingJobId: adapter.id,
    ...(adapter.standIn ? { standIn: true as const } : {}),
    source,
  };
}

/** What a finished run's frozen graduate becomes: version 1 of a new agent. */
export async function graduationFacts(
  paths: DataPaths,
  input: RunGraduation,
): Promise<VersionFacts> {
  const { job, freeze, report, contract, harness } = input;
  return {
    agentId: freeze.graduateId,
    name: job.name,
    version: 1,
    createdAt: report.createdAt,
    method: input.run.method,
    contract,
    modelLabel: job.student.label,
    base: {
      name: freeze.student.model,
      ...(freeze.student.digest === undefined ? {} : { digest: freeze.student.digest }),
      ...(freeze.student.quantization === undefined
        ? {}
        : { quantization: freeze.student.quantization }),
      ...(freeze.student.sizeBytes === undefined ? {} : { sizeBytes: freeze.student.sizeBytes }),
    },
    contextLength: job.student.local.contextLength,
    runtime: job.student.local.runtime,
    ...(freeze.configuration?.adapter ? { adapter: adapterFile(paths, freeze) } : {}),
    harness: {
      meta: harness.meta,
      files: input.harnessFiles,
      ...origin(input.rounds, freeze.harnessVersion),
    },
    report,
    lineage: input.lineage,
    columns: await tableColumns(paths.dataDir(job.id), contract),
    rounds: report.cost.rounds,
    keptChanges: input.lineage.filter((entry) => entry.decision === 'kept').length,
    testedHere: true,
  };
}

/**
 * Writes the graduate's version 1 and prepares its installation on this computer: the model
 * endpoint its job used locally, its own copy of the job's data for `data/`, an `output/`
 * folder, and the write mode its job allowed. The same computer needs no export, no import and
 * no new approvals to use it. Recording it is the caller's, in the transaction that finishes
 * the run.
 */
export async function prepareGraduate(
  store: EngineStore,
  paths: DataPaths,
  input: RunGraduation,
): Promise<{ written: WrittenPackage; installation: StoredInstallation }> {
  const facts = await graduationFacts(paths, input);
  const written = await writeVersionFolder(store, paths, facts);
  const { job, freeze, contract, report } = input;
  const data = paths.workspaceDir(freeze.graduateId);
  await seedDataFolder(data, paths.dataDir(job.id), contract.inputs.files);
  const installation: StoredInstallation = {
    graduateId: freeze.graduateId,
    model: {
      runtime: job.student.local.runtime,
      baseUrl: job.student.local.baseUrl,
      model: freeze.student.model,
    },
    bindings: await sameComputerBindings(paths, freeze.graduateId, contract, data),
    grants: sameComputerGrants(
      { contract, resources: resourcesFor(contract, facts.columns) },
      job.permissions.writes,
    ),
    createdAt: report.createdAt,
    updatedAt: report.createdAt,
  };
  return { written, installation };
}
