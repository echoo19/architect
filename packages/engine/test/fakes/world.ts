import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  GraduateManifestSchema,
  HarnessSchema,
  RunEventSchema,
  type Job,
  type RunEvent,
  type StudentChatRequest,
  type Task,
} from '@architect/shared';
import { RunController } from '../../src/loop/controller';
import type { EngineHostDeps } from '../../src/loop/deps';
import { JobLibrary } from '../../src/loop/jobs';
import { DataPaths } from '../../src/loop/paths';
import { openEngineStore, type EngineStore } from '../../src/store/engine-store';
import { FakeMentor, FakeStudent } from './adapters';
import { ManualClock } from './clock';
import {
  applyEdits,
  blankHarness,
  diffHarness,
  FileVersions,
  harnessToFiles,
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
        HarnessSchema.parse(JSON.parse(await readFile(join(dir, 'harness.json'), 'utf8'))),
      writeGraduate: async (dir, graduate) => {
        await mkdir(dir, { recursive: true });
        await writeFile(join(dir, 'graduate.json'), JSON.stringify(graduate, null, 2));
      },
      readGraduate: async (dir) => ({
        manifest: GraduateManifestSchema.parse(
          JSON.parse(await readFile(join(dir, 'graduate.json'), 'utf8')).manifest,
        ),
      }),
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
