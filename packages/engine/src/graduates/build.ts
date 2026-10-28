import { readFile } from 'node:fs/promises';
import { arch, platform, totalmem } from 'node:os';
import { join } from 'node:path';
import {
  EVIDENCE_FILES,
  lineageToJsonl,
  metaToFile,
  reportToJson,
  renderReportMarkdown,
  sanitizeLineage,
  type ManifestDraft,
  type PackageEntry,
} from '@architect/harness';
import {
  ADAPTER_RUNTIMES,
  AUTHOR_EVALUATION_LABEL,
  KNOWN_RUNTIMES,
  PACKAGE_KIND,
  PACKAGE_SCHEMA,
  type AdapterRef,
  type BaseModel,
  type EvaluationStatus,
  type HarnessMeta,
  type JobContract,
  type LineageEntry,
  type Method,
  type PackageEvidence,
  type PackageRequirements,
  type PackageResource,
  type ReportCard,
  type SmokeCheck,
  type VersionRef,
} from '@architect/shared';
import { parseCsv } from '../data/csv';

/** Where a package keeps its harness: a folder of its own, whatever the harness format holds. */
export const HARNESS_DIR = 'harness';

/** An adapter file to ship with a version, already checksummed. */
export interface AdapterFile extends AdapterRef {
  /** The file on disk. */
  source: string;
}

/** Everything a version's package says, gathered by graduation or by converting a format 1 folder. */
export interface VersionFacts {
  agentId: string;
  name: string;
  version: number;
  parent?: VersionRef;
  createdAt: string;
  method: Method;
  contract: JobContract;
  /** The student's short name, e.g. "Glimmer". */
  modelLabel: string;
  base: BaseModel;
  contextLength: number;
  /** The runtime the student ran on where it was made. */
  runtime: string;
  adapter?: AdapterFile;
  harness: {
    /** Its `migratedFrom` names the format and hash it had before it was migrated, if it was. */
    meta: HarnessMeta;
    /** The harness files as the harness package writes them, `harness.yaml` aside. */
    files: Readonly<Record<string, string>>;
    round?: number;
    draft?: true;
  };
  /**
   * The locked test measured the harness before it was migrated: a graduate made in an older
   * format. A run frozen in one and tested since measured it migrated, as it runs now.
   */
  testedBeforeMigration?: true;
  /** The locked test's report card; null when no locked test measured this version. */
  report: ReportCard | null;
  lineage: readonly LineageEntry[];
  /** Header of each table the contract names, from the author's files. */
  columns: Readonly<Record<string, string[]>>;
  rounds: number;
  keptChanges: number;
  /**
   * Whether the locked test ran on this computer, so its platform and memory describe where it
   * was tested. Not so for a format 1 folder from elsewhere, whose manifest never said.
   */
  testedHere: boolean;
}

const MIB = 1024 ** 2;

const SMOKE_CHECKS: readonly SmokeCheck[] = [
  {
    id: 'harness-valid',
    kind: 'harness_valid',
    description: 'The harness files parse, and they are the harness the graduate was tested with.',
  },
  {
    id: 'tools-load',
    kind: 'tools_load',
    description: "Each helper tool's code loads in the sandbox. No tool is called.",
  },
  {
    id: 'resources-bound',
    kind: 'resources_bound',
    description:
      'Every required folder is bound and holds the files and columns the contract names.',
  },
  {
    id: 'model-available',
    kind: 'model_available',
    description: 'The local runtime serves the base model, and the same build when it can tell.',
  },
  {
    id: 'model-responds',
    kind: 'model_responds',
    description: 'The model answers a short request; the time to its reply is recorded.',
  },
];

/**
 * The logical folders a contract's files live in: `data` for the job's files, and `output` for
 * files the agent creates, when the contract allows an output folder.
 */
export function resourcesFor(
  contract: JobContract,
  columns: Readonly<Record<string, string[]>>,
): PackageResource[] {
  const files = contract.inputs.files;
  const writes = files.some((file) => file.access === 'write');
  const accepts = [
    ...new Set(files.map((file) => (file.kind === 'table' ? 'text/csv' : 'text/plain'))),
  ];
  const data: PackageResource = {
    name: 'data',
    kind: 'folder',
    required: files.length > 0,
    description: `The job's own files: ${files.map((file) => file.name).join(', ') || 'none'}.`,
    accepts: accepts.length > 0 ? accepts : ['text/plain'],
    access: writes ? 'read_write' : 'read',
    files: files.map((file) =>
      columns[file.name] === undefined ? file : { ...file, columns: columns[file.name] },
    ),
  };
  const output = contract.outputs.folder;
  if (output === undefined) return [data];
  return [
    data,
    {
      name: 'output',
      kind: 'folder',
      required: false,
      description: output.description ?? 'Where files the agent creates are saved.',
      accepts: ['text/plain', 'text/csv', 'text/markdown'],
      access: 'read_write',
      files: [],
    },
  ];
}

/** The header of each table in a data folder, for the contract's files that are there. */
export async function tableColumns(
  dataDir: string,
  contract: JobContract,
): Promise<Record<string, string[]>> {
  const columns: Record<string, string[]> = {};
  for (const file of contract.inputs.files) {
    if (file.kind !== 'table') continue;
    let content: string;
    try {
      content = await readFile(join(dataDir, file.name), 'utf8');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue;
      throw error;
    }
    columns[file.name] = parseCsv(file.name, content).columns;
  }
  return columns;
}

/**
 * A harness-only graduate runs on any local runtime that serves its base weights, the one it was
 * made on first; only an adapter narrows that, to runtimes that can load one.
 */
function compatibleRuntimes(madeOn: string): string[] {
  return [madeOn, ...KNOWN_RUNTIMES.filter((runtime) => runtime !== madeOn)];
}

/** Ready only when the locked test met every bar on a local student (decision 009). */
function statusOf(report: ReportCard | null): EvaluationStatus {
  if (report === null) return 'unevaluated';
  const met = report.requirements.passRate.met && (report.requirements.p95LatencyMs?.met ?? true);
  return met && report.testedOn === 'local' ? 'ready' : 'experimental';
}

function evidenceOf(facts: VersionFacts): PackageEvidence {
  const { report, contract } = facts;
  const counts = {
    testTasks: report?.test.score.total ?? 0,
    rounds: facts.rounds,
    keptChanges: facts.keptChanges,
  };
  if (report === null) {
    return {
      label: AUTHOR_EVALUATION_LABEL,
      status: 'unevaluated',
      contractVersion: contract.version,
      counts,
    };
  }
  return {
    label: AUTHOR_EVALUATION_LABEL,
    status: statusOf(report),
    contractVersion: contract.version,
    summary: {
      score: report.test.score,
      perType: report.test.perType,
      passRate: report.requirements.passRate,
      ...(report.requirements.p95LatencyMs === undefined
        ? {}
        : { p95LatencyMs: report.requirements.p95LatencyMs }),
    },
    counts,
    provenance: {
      method: report.method,
      mentor: report.mentor,
      student: {
        label: report.student.label,
        model: report.student.model,
        runtime: report.student.runtime,
      },
      testedOn: report.testedOn,
      ranOffline: report.test.ranOffline,
      jobId: report.jobId,
      runId: report.runId,
      evaluatedAt: report.createdAt,
    },
    files: { ...EVIDENCE_FILES },
  };
}

function requirementsOf(facts: VersionFacts): PackageRequirements {
  const { report, base } = facts;
  const limitations: string[] = [];
  if (report !== null) {
    const types = report.test.perType.map((type) => type.label).join(', ');
    limitations.push(
      `Measured on ${report.test.score.total} locked-test tasks (${types}); it says nothing about other kinds of request.`,
    );
    if (report.testedOn === 'hosted') {
      limitations.push(
        'The locked test ran on a hosted copy of the student, not on a local model.',
      );
    }
  } else {
    limitations.push('No locked test measured this version.');
  }
  if (report !== null && !facts.testedHere) {
    limitations.push("Where its locked test ran wasn't recorded.");
  }
  if (base.digest === undefined && base.revision === undefined && facts.adapter === undefined) {
    limitations.push(
      "The base model's exact build wasn't recorded, so another copy can't be confirmed identical.",
    );
  }
  const from = facts.harness.meta.migratedFrom;
  if (from !== undefined) {
    limitations.push(
      facts.testedBeforeMigration && report !== null
        ? `Its locked test ran on its harness as format ${from.format} wrote it, with the tools of that time; it now runs migrated to format ${facts.harness.meta.format}, which no locked test has measured.`
        : `It was trained on its harness as format ${from.format} wrote it, with the tools of that time, and migrated to format ${facts.harness.meta.format} before its locked test.`,
    );
  }
  if (facts.adapter?.standIn === true) {
    limitations.push(
      'Its adapter came from the stand-in training backend: it was built, not trained, and changes nothing.',
    );
  }
  return {
    tested:
      report === null || !facts.testedHere
        ? []
        : [
            {
              os: platform(),
              arch: arch(),
              backend: report.testedOn === 'hosted' ? 'hosted' : facts.runtime,
              target: report.testedOn,
              memoryBytes: totalmem(),
            },
          ],
    measured: report === null ? {} : { latencyMs: report.test.latencyMs },
    minimum:
      base.sizeBytes === undefined
        ? {}
        : {
            // The weights plus room for the context cache and the runtime: an estimate.
            memoryBytes: Math.ceil(base.sizeBytes * 1.15 + 512 * MIB),
            diskBytes: base.sizeBytes + (facts.adapter?.sizeBytes ?? 0),
          },
    limitations,
  };
}

/**
 * A locked-test result belongs to the contract it measured. One taken under another bar, or over
 * task types the contract doesn't name, never becomes this version's evidence.
 */
function assertMeasuredUnder(report: ReportCard, contract: JobContract): void {
  const bar = report.requirements.passRate.target;
  if (bar !== contract.acceptance.passRate) {
    throw new Error(
      `The locked test measured against a ${Math.round(bar * 100)}% bar, but contract version ${contract.version} asks for ${Math.round(contract.acceptance.passRate * 100)}%. A result never carries over to another contract.`,
    );
  }
  const types = new Set(contract.capabilities.taskTypes.map((type) => type.id));
  const other = report.test.perType.find((type) => !types.has(type.type));
  if (other !== undefined) {
    throw new Error(
      `The locked test covered ${other.label}, which contract version ${contract.version} doesn't name. A result never carries over to another contract.`,
    );
  }
}

/**
 * The manifest draft and files of one version's package. Nothing machine-specific goes in: no
 * endpoint, folder or key. The evidence is the author's, labelled as such, with the change
 * history stripped of the mentor's diagnoses and task ids.
 */
export function buildPackage(facts: VersionFacts): {
  draft: ManifestDraft;
  entries: PackageEntry[];
} {
  const { harness, report, adapter } = facts;
  if (report !== null) assertMeasuredUnder(report, facts.contract);
  const entries: PackageEntry[] = [
    ...Object.entries(harness.files).map(([path, content]) => ({
      path: `${HARNESS_DIR}/${path}`,
      content,
    })),
    { path: `${HARNESS_DIR}/harness.yaml`, content: metaToFile(harness.meta) },
  ];
  if (report !== null) {
    entries.push(
      { path: EVIDENCE_FILES.report, content: reportToJson(report) },
      { path: EVIDENCE_FILES.reportMarkdown, content: renderReportMarkdown(report) },
      { path: EVIDENCE_FILES.lineage, content: lineageToJsonl(sanitizeLineage(facts.lineage)) },
    );
  }
  if (adapter) entries.push({ path: adapter.path, source: adapter.source });

  const notices = [
    "The harness (instructions, skills, tools and examples) was written from the author's tasks and can quote them.",
  ];
  if (adapter && adapter.standIn !== true) {
    notices.push(
      "Trained weights may retain information from the data they were trained on; leaving files out of a package doesn't make it anonymous.",
    );
  }
  const draft: ManifestDraft = {
    schema: PACKAGE_SCHEMA,
    kind: PACKAGE_KIND,
    identity: {
      agentId: facts.agentId,
      name: facts.name,
      version: facts.version,
      ...(facts.parent === undefined ? {} : { parent: facts.parent }),
      createdAt: facts.createdAt,
      method: facts.method,
    },
    contract: facts.contract,
    model: {
      label: facts.modelLabel,
      base: facts.base,
      ...(adapter === undefined
        ? {}
        : {
            adapter: {
              path: adapter.path,
              format: adapter.format,
              sha256: adapter.sha256,
              sizeBytes: adapter.sizeBytes,
              baseDigest: adapter.baseDigest,
              scale: adapter.scale,
              ...(adapter.trainingJobId === undefined
                ? {}
                : { trainingJobId: adapter.trainingJobId }),
              ...(adapter.standIn === undefined ? {} : { standIn: adapter.standIn }),
            },
          }),
      inference: { contextLength: facts.contextLength },
      runtime: { compatible: adapter ? [...ADAPTER_RUNTIMES] : compatibleRuntimes(facts.runtime) },
    },
    harness: {
      format: harness.meta.format,
      path: HARNESS_DIR,
      hash: harness.meta.hash,
      version: harness.meta.version,
      ...(harness.round === undefined ? {} : { round: harness.round }),
      ...(harness.draft === undefined ? {} : { draft: harness.draft }),
      ...(harness.meta.migratedFrom === undefined
        ? {}
        : { migratedFrom: harness.meta.migratedFrom }),
    },
    resources: resourcesFor(facts.contract, facts.columns),
    requirements: requirementsOf(facts),
    evidence: evidenceOf(facts),
    verification: { checks: [...SMOKE_CHECKS], fixtures: [] },
    terms: {
      baseModel: `Uses ${facts.base.name}, which isn't included. Its own licence and terms apply wherever it runs.`,
      notices,
    },
  };
  return { draft, entries };
}
