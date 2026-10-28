import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { harnessToFiles, hashHarness, sha256Bytes } from '@architect/harness';
import {
  contractTerms,
  HarnessSchema,
  JobContractSchema,
  type Harness,
  type HarnessTool,
  type Job,
  type Machine,
  type StudentEndpoint,
} from '@architect/shared';
import type { z } from 'zod';
import { sameComputerGrants, storedFolder } from '../../src/graduates/bindings';
import { resourcesFor, type AdapterFile, type VersionFacts } from '../../src/graduates/build';
import { ContractBook } from '../../src/graduates/contracts';
import { GraduateLibrary } from '../../src/graduates/library';
import { registerVersion, writeVersionFolder } from '../../src/graduates/versions';
import { DataPaths } from '../../src/loop/paths';
import { openEngineStore, type EngineStore } from '../../src/store/engine-store';
import type { StoredVersion } from '../../src/store/records';
import { reportFor } from '../agent-host/graduates';
import { FakeStudent } from '../fakes/adapters';
import { ManualClock } from '../fakes/clock';
import { makeJob, SAMPLE_CONTENT } from './fixtures';

/** A computer with Architect on it: a data folder, its database, and a graduate library. */
export interface Computer {
  dataDir: string;
  paths: DataPaths;
  store: EngineStore;
  library: GraduateLibrary;
  contracts: ContractBook;
  clock: ManualClock;
  /** Tool loads and model checks, in the order they happened: proof of what ran. */
  loaded: string[];
  students: FakeStudent[];
  machine: Machine;
  /** Closes the database, as quitting the app would. */
  close(): void;
  /** Opens the same data folder again, as restarting the app would. */
  restart(): Computer;
  remove(): Promise<void>;
}

/** The digest Ollama's store gives the base's GGUF file, as the adapter runtime reports it. */
export const GLIMMER_GGUF = `sha256:${'a1'.repeat(32)}`;

export const THIS_MACHINE: Machine = {
  os: 'win32',
  arch: 'x64',
  memoryBytes: 32 * 1024 ** 3,
};

/** Architect started on an existing data folder. */
export function attach(dataDir: string, machine: Machine, clock: ManualClock): Computer {
  const paths = new DataPaths(dataDir);
  const store = openEngineStore(paths.database);
  const contracts = new ContractBook(store, clock);
  const loaded: string[] = [];
  const students: FakeStudent[] = [];
  const library = new GraduateLibrary({
    store,
    paths,
    clock,
    contracts,
    machine: () => computer.machine,
    deps: {
      runtime: {
        createSandbox: () => ({ dispose: () => undefined }),
        toolLoadProblem: async (_sandbox, tool) => {
          loaded.push(`tool:${tool.name}`);
          return tool.code.includes('syntax error') ? 'SyntaxError on line 1' : null;
        },
      },
      adapters: {
        createStudent: (endpoint: StudentEndpoint) => {
          loaded.push(`model:${endpoint.model}`);
          const student = new FakeStudent(
            endpoint,
            () => 'ready',
            () => 'sha256:glimmer',
          );
          students.push(student);
          return student;
        },
      },
    },
  });
  const computer: Computer = {
    dataDir,
    paths,
    store,
    library,
    contracts,
    clock,
    loaded,
    students,
    machine,
    close: () => store.close(),
    restart: () => {
      store.close();
      return attach(dataDir, computer.machine, clock);
    },
    remove: async () => {
      try {
        store.close();
      } catch {
        // Already closed by the test.
      }
      await rm(dataDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
    },
  };
  return computer;
}

export async function newComputer(machine: Machine = THIS_MACHINE): Promise<Computer> {
  const dataDir = await mkdtemp(join(tmpdir(), 'architect-computer-'));
  return attach(dataDir, machine, new ManualClock());
}

export const PRICE_TOOL: HarnessTool = {
  name: 'invoice_total',
  description: 'Totals an invoice in cents.',
  parameters: { type: 'object', properties: { lines: { type: 'array' } }, required: ['lines'] },
  code: 'function run(args, ctx) {\n  return { total_cents: args.lines.length };\n}\n',
};

export function harnessWith(
  name: string,
  overrides: Partial<z.input<typeof HarnessSchema>> = {},
): Harness {
  const harness = HarnessSchema.parse({
    meta: { format: 1, name, version: 3, hash: '' },
    system: 'You are the service desk of Ferncliff Home Services.',
    retrieval: {},
    decoding: { maxSteps: 4 },
    guardrails: {},
    ...overrides,
  });
  return { ...harness, meta: { ...harness.meta, hash: hashHarness(harness) } };
}

export interface VersionOptions {
  graduateId: string;
  job?: Job;
  harness?: Harness;
  /** Bytes of a LoRA adapter file to ship with the version. */
  adapter?: string;
  /** The adapter's identity beyond its file, when a test needs it to differ: scale, job, base. */
  adapterIdentity?: Partial<
    Pick<AdapterFile, 'scale' | 'trainingJobId' | 'standIn' | 'baseDigest'>
  >;
  /** The local version it derives from. */
  parent?: number;
  /** A model endpoint on this computer for its installation. */
  baseUrl?: string;
  state?: 'candidate' | 'accepted';
  /** Leave out the locked-test report: a version nothing measured. */
  unevaluated?: boolean;
}

/** The job a computer's graduates are made for, with its data folder holding the sample tables. */
export async function sampleJob(computer: Computer, id = 'job_desk'): Promise<Job> {
  const job = makeJob({ id });
  const dataDir = computer.paths.dataDir(job.id);
  await mkdir(dataDir, { recursive: true });
  for (const [name, content] of Object.entries(SAMPLE_CONTENT)) {
    await writeFile(join(dataDir, name), content, 'utf8');
  }
  return job;
}

/**
 * Adds a version to an agent the way graduation and improvement do: its package written to its
 * own folder and recorded, the agent and its installation created with its first version.
 */
export async function addVersion(
  computer: Computer,
  options: VersionOptions,
): Promise<StoredVersion> {
  const { store, paths } = computer;
  const job = options.job ?? makeJob({ id: 'job_desk' });
  const harness = options.harness ?? harnessWith(job.name);
  const version = (store.versions.list(options.graduateId).at(-1)?.version ?? 0) + 1;
  const contract = JobContractSchema.parse({ ...contractTerms(job), version: 1 });
  let adapter: AdapterFile | undefined;
  if (options.adapter !== undefined) {
    const source = join(computer.dataDir, `adapter-${options.graduateId}-${version}.gguf`);
    await writeFile(source, options.adapter);
    adapter = {
      path: 'adapter/adapter.gguf',
      format: 'gguf_lora',
      sha256: sha256Bytes(options.adapter),
      sizeBytes: Buffer.byteLength(options.adapter),
      baseDigest: GLIMMER_GGUF,
      scale: 1,
      ...options.adapterIdentity,
      source,
    };
  }
  const facts: VersionFacts = {
    agentId: options.graduateId,
    name: job.name,
    version,
    ...(options.parent === undefined
      ? {}
      : {
          parent: {
            agentId: options.graduateId,
            version: options.parent,
            digest: store.versions.get(options.graduateId, options.parent)?.digest ?? '',
          },
        }),
    createdAt: new Date(computer.clock.now()).toISOString(),
    method: 'architect',
    contract,
    modelLabel: 'Glimmer',
    base: { name: 'muse-glimmer:30b', digest: 'sha256:glimmer', sizeBytes: 1024 ** 3 },
    contextLength: 16_384,
    runtime: 'ollama',
    ...(adapter === undefined ? {} : { adapter }),
    harness: { meta: harness.meta, files: harnessToFiles(harness) },
    report: options.unevaluated ? null : reportFor(job),
    lineage: [],
    columns: { 'customers.csv': ['customer_id', 'name', 'city', 'terms_days'] },
    rounds: 0,
    keptChanges: 0,
    testedHere: true,
  };
  const written = await writeVersionFolder(store, paths, facts);
  const data = paths.workspaceDir(options.graduateId);
  await mkdir(data, { recursive: true });
  for (const [name, content] of Object.entries(SAMPLE_CONTENT)) {
    await writeFile(join(data, name), content, 'utf8');
  }
  await mkdir(paths.outputDir(options.graduateId), { recursive: true });
  const at = new Date(computer.clock.now()).toISOString();
  return store.transaction(() =>
    registerVersion(store, paths, {
      graduateId: options.graduateId,
      name: job.name,
      version,
      written,
      ...(options.parent === undefined ? {} : { parent: options.parent }),
      state: options.state ?? 'accepted',
      installation: {
        graduateId: options.graduateId,
        model: {
          runtime: 'ollama',
          baseUrl: options.baseUrl ?? 'http://127.0.0.1:11434',
          model: 'muse-glimmer:30b',
        },
        bindings: {
          data: storedFolder(paths, data),
          output: storedFolder(paths, paths.outputDir(options.graduateId)),
        },
        grants: sameComputerGrants(
          { contract, resources: resourcesFor(contract, facts.columns) },
          job.permissions.writes,
        ),
        createdAt: at,
        updatedAt: at,
      },
      at,
    }),
  );
}
