import { existsSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  HarnessSchema,
  RunEventSchema,
  type Job,
  type RunEvent,
  type StudentChatRequest,
  type Task,
} from '@architect/shared';
import { RunController } from '../../src/loop/controller';
import type { AdapterServeRequest, EngineHostDeps } from '../../src/loop/deps';
import { JobLibrary } from '../../src/loop/jobs';
import { DataPaths } from '../../src/loop/paths';
import { openEngineStore, type EngineStore } from '../../src/store/engine-store';
import { FakeActor, FakeMentor, FakeStudent } from './adapters';
import { ManualClock } from './clock';
import {
  applyEdits,
  blankHarness,
  diffHarness,
  FileVersions,
  harnessToFiles,
  importFolder,
  readPackaged,
  templateHarness,
} from './harness';
import { defaultJob, defaultTasks, writeJobFolder } from './job';
import { FakeRuntime, FakeVault } from './runtime';

/** Everything a controller needs, wired with fakes, in a temporary folder. */
export interface World {
  root: string;
  dataDir: string;
  jobFile: string;
  clock: ManualClock;
  runtime: FakeRuntime;
  vault: FakeVault;
  mentor: FakeMentor;
  students: FakeStudent[];
  /** The mentor's model each time a session made it the agent, for corrections. */
  actors: FakeActor[];
  /** How many times the mentor's price the actor charges. */
  actorPriceScale: number;
  /** Every llama.cpp student asked for, with the adapters it loads and its scales. */
  adapterRequests: AdapterServeRequest[];
  mentorsCreated: number;
  studentReply: (request: StudentChatRequest, call: number) => string;
  /** The build the local student reports; change it to swap the model under a frozen graduate. */
  localDigest: string;
  deps: EngineHostDeps;
  cleanup(): void;
}

export async function createWorld(
  options: { job?: Partial<Job>; tasks?: Task[] } = {},
): Promise<World> {
  const root = mkdtempSync(join(tmpdir(), 'architect-loop-'));
  const runtime = new FakeRuntime();
  const mentor = new FakeMentor();
  const secrets = new Map([
    ['meta', 'mentor-secret'],
    ['openrouter', 'student-secret'],
  ]);
  const jobFile = await writeJobFolder(
    join(root, 'source'),
    defaultJob(options.job),
    options.tasks ?? defaultTasks(),
  );
  const world: World = {
    root,
    dataDir: join(root, 'data'),
    jobFile,
    clock: new ManualClock(),
    runtime,
    vault: new FakeVault(runtime),
    mentor,
    students: [],
    actors: [],
    actorPriceScale: 1,
    adapterRequests: [],
    mentorsCreated: 0,
    studentReply: () => '',
    localDigest: 'sha256:fake',
    deps: {} as EngineHostDeps,
    cleanup: () => rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 }),
  };
  world.deps = {
    runtime,
    vault: world.vault,
    harness: {
      versions: (dir) => new FileVersions(dir),
      applyEdits,
      diffHarness,
      harnessToFiles,
      blankHarness,
      templateHarness,
      importHarness: async (dir) =>
        existsSync(join(dir, 'harness.json'))
          ? HarnessSchema.parse(JSON.parse(await readFile(join(dir, 'harness.json'), 'utf8')))
          : importFolder(dir),
      readPackaged,
    },
    adapters: {
      createMentor: () => {
        world.mentorsCreated += 1;
        return mentor;
      },
      createStudent: (endpoint) => {
        const student = new FakeStudent(
          endpoint,
          (request, call) => world.studentReply(request, call),
          () => world.localDigest,
        );
        world.students.push(student);
        return student;
      },
      createActor: (config) => {
        if (config.kind !== 'model') throw new Error('Only a model mentor can act.');
        const actor = new FakeActor(
          {
            runtime: 'openai_compatible',
            baseUrl: config.baseUrl,
            model: config.model,
            contextLength: 16_384,
          },
          () => 'ANSWER: {"ok":true}',
        );
        actor.priceScale = world.actorPriceScale;
        world.actors.push(actor);
        return actor;
      },
      // A llama-server student: its model names the adapters it applies, so a test's pass rule
      // can tell adapter-on from adapter-off.
      createAdapterStudent: (request) => {
        const applied = Object.entries(request.scales)
          .filter(([, scale]) => scale !== 0)
          .map(([key, scale]) => `${key}@${scale}`);
        const student = new FakeStudent(
          {
            runtime: 'openai_compatible',
            baseUrl: 'http://127.0.0.1:8081',
            model: `${request.model}+${applied.join(',') || 'base'}`,
            contextLength: 16_384,
          },
          (chat, call) => world.studentReply(chat, call),
          () => world.localDigest,
        );
        world.adapterRequests.push(request);
        world.students.push(student);
        return student;
      },
    },
    secrets: { get: async (ref) => secrets.get(ref) },
    sampleJobFile: jobFile,
  };
  return world;
}

export interface Engine {
  paths: DataPaths;
  store: EngineStore;
  jobs: JobLibrary;
  controller: RunController;
  events: RunEvent[];
  errors: unknown[];
  close(): Promise<void>;
}

/** Opens the engine on the world's data folder, as the host does on startup. */
export function openEngine(world: World, options: { concurrency?: number } = {}): Engine {
  mkdirSync(world.dataDir, { recursive: true });
  const paths = new DataPaths(world.dataDir);
  const store = openEngineStore(paths.database);
  const jobs = new JobLibrary(store, paths, world.deps, world.clock);
  const errors: unknown[] = [];
  const controller = new RunController({
    store,
    paths,
    jobs,
    deps: world.deps,
    clock: world.clock,
    concurrency: options.concurrency,
    onError: (error) => errors.push(error),
  });
  const events: RunEvent[] = [];
  controller.onEvent((event) => events.push(RunEventSchema.parse(event)));
  return {
    paths,
    store,
    jobs,
    controller,
    events,
    errors,
    close: async () => {
      await controller.close();
      store.close();
    },
  };
}
