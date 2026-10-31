import { mkdir, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { extname, join } from 'node:path';
import {
  slugify,
  type DraftOrganization,
  type Job,
  type Organization,
  type SplitConfig,
  type Task,
  type TaskSpec,
} from '@architect/shared';
import type { LeakDetector } from '../mentor/gate';
import type { TaskSplits } from '../loop/deps';
import { writeJsonFile, writeJsonLines } from '../loop/files';
import { orgDataDir } from '../loop/organizations';
import { divide } from './division';
import { describeAttached, digestOf, readAttachments, shownRowsOf, type Attached } from './files';
import {
  generateTasks,
  MIN_PER_TYPE,
  seedFrom,
  splitSizes,
  type Generation,
  type TypeInput,
} from './generate';
import { transferDetector } from './study';
import type { Table } from './table';

/*
 * A field of several organizations drafted from their folders (decision 083). The teacher drafts
 * the job's specification once, from the taught organizations' files; Architect then
 * makes each organization's tasks from that specification and its own files, with the same
 * template step a one-organization job uses, and imports the job as a job folder. The files of an
 * organization the agent never sees are read here and never described to the teacher.
 */

/** An organization's files, as drafting reads them. */
export interface OrgFiles {
  org: Organization;
  attached: Attached;
}

export interface FieldSource {
  taught: OrgFiles[];
  sealed: OrgFiles[];
}

/** What a folder may hold that drafting reads: tables, text and Markdown. */
const READ = new Set(['.csv', '.txt', '.md', '.markdown']);

function namesOf(attached: Attached): string[] {
  return attached.files.map((file) => file.name).sort();
}

/**
 * Reads each organization's folder: its CSV, text and Markdown files, as attachments are read. The
 * organizations must have one taught on, distinct names, and the same files, with the same columns
 * in each table, so that one specification fits them all.
 */
export async function readField(organizations: readonly DraftOrganization[]): Promise<FieldSource> {
  if (!organizations.some((org) => org.role === 'train')) {
    throw new Error('Mark at least one organization as taught on.');
  }
  const ids = new Set<string>();
  const read: OrgFiles[] = [];
  for (const entry of organizations) {
    const name = entry.name.trim();
    const id = slugify(name);
    if (ids.has(id))
      throw new Error(`Two organizations are called ${name}. Give each its own name.`);
    ids.add(id);
    const listed = await readdir(entry.folder, { withFileTypes: true }).catch(() => null);
    if (listed === null) {
      throw new Error(
        `${name}'s folder can't be opened. Check that it is still where you left it.`,
      );
    }
    const files = listed
      .filter((item) => item.isFile() && READ.has(extname(item.name).toLowerCase()))
      .map((item) => join(entry.folder, item.name));
    if (files.length === 0) {
      throw new Error(`${name}'s folder holds no CSV, text or Markdown files.`);
    }
    read.push({
      org: { id, name, synthetic: false, role: entry.role },
      attached: await readAttachments(files),
    });
  }
  const [first] = read.filter((item) => item.org.role === 'train');
  if (first === undefined) throw new Error('Mark at least one organization as taught on.');
  const expected = namesOf(first.attached);
  for (const item of read) {
    const names = namesOf(item.attached);
    const missing = expected.filter((name) => !names.includes(name));
    const extra = names.filter((name) => !expected.includes(name));
    if (missing.length > 0 || extra.length > 0) {
      throw new Error(
        `Every organization needs the same files. ${item.org.name}'s folder ${missing.length > 0 ? `lacks ${missing.join(', ')}` : `also has ${extra.join(', ')}`}, which ${first.org.name}'s ${missing.length > 0 ? 'has' : "doesn't"}.`,
      );
    }
    for (const file of item.attached.files) {
      const theirs = first.attached.files.find((other) => other.name === file.name);
      const same =
        file.table === undefined ||
        (theirs?.table !== undefined &&
          [...file.table.columns].sort().join('\n') ===
            [...theirs.table.columns].sort().join('\n'));
      if (!same) {
        throw new Error(
          `Every organization's tables need the same columns. ${item.org.name}'s ${file.name} has different columns from ${first.org.name}'s.`,
        );
      }
    }
  }
  return {
    taught: read.filter((item) => item.org.role === 'train'),
    sealed: read.filter((item) => item.org.role === 'transfer'),
  };
}

/** Everything the taught organizations' files hold, together, for the limits drafting holds them to. */
export function allTaught(field: FieldSource): Attached {
  return { files: field.taught.flatMap((item) => item.attached.files), tasks: null };
}

/**
 * What the teacher is told of the field's files: each taught organization's files, described as a
 * one-organization job's are, under the organization's name. No sealed organization is in it.
 */
export function describeField(field: FieldSource): string {
  return field.taught
    .map((item) => `## ${item.org.name}\n\n${describeAttached(item.attached)}`)
    .join('\n\n');
}

function tablesOf(attached: Attached): Map<string, Table> {
  return new Map(
    attached.files.flatMap((file) =>
      file.table === undefined ? [] : ([[file.name, file.table]] as const),
    ),
  );
}

/** One organization's tasks of these kinds, made from its own files. */
function generateAt(item: OrgFiles, inputs: readonly TypeInput[], passRate: number): Generation {
  const seed = seedFrom([
    item.org.id,
    ...digestOf(item.attached),
    ...inputs.map((input) => JSON.stringify([input.id, input.spec])),
  ]);
  // The teacher was shown the first rows of a taught organization's tables, so no request is made
  // whose answer those rows decide. It was shown nothing of a sealed one.
  const shown =
    item.org.role === 'train' ? shownRowsOf(item.attached) : new Map<string, Set<number>>();
  return generateTasks(inputs, tablesOf(item.attached), seed, { shown, passRate });
}

/**
 * What is wrong with the kinds of task at each organization taught on, in the words the teacher is
 * told, which name no value of a row it was not shown. A kind its files support too few requests
 * of is a problem the first time; the second time it is left to `makeFieldTasks`.
 */
export function taughtProblems(
  field: FieldSource,
  inputs: readonly TypeInput[],
  passRate: number,
  final: boolean,
): { problems: string[]; shown: string[] } {
  const problems: string[] = [];
  const shown: string[] = [];
  for (const item of field.taught) {
    const generation = generateAt(item, inputs, passRate);
    const at = (type: { id: string; label: string }, text: string) =>
      `At ${item.org.name}, task type "${type.id}" (${type.label}): ${text}`;
    for (const type of generation.rejected) {
      for (const problem of type.problems) {
        problems.push(at(type, problem));
        shown.push(at(type, type.inFull.get(problem) ?? problem));
      }
    }
    if (!final) {
      for (const type of generation.thin) {
        const thin = at(
          type,
          `its files support only ${type.available} different ${type.available === 1 ? 'request' : 'requests'}, and at least ${MIN_PER_TYPE} are needed. Use a column with more different values, or drop this type.`,
        );
        problems.push(thin);
        shown.push(thin);
      }
    }
  }
  return { problems, shown };
}

/** Stops any request to the teacher that names an organization the agent never sees (invariant 1). */
export function sealedDetector(field: FieldSource): LeakDetector {
  return transferDetector({ organizations: field.sealed.map((item) => item.org) });
}

/** The tasks of every organization, or why the field can't be made, in words for the person. */
export type FieldTasks =
  | {
      kind: 'made';
      /** The kinds of task kept, as the first taught organization's tables spell them, with their rule. */
      types: { id: string; spec: TaskSpec; rule: string }[];
      /** The taught organizations' tasks that divide into the job's sets, and how. */
      taught: Task[];
      split: SplitConfig;
      sealed: Task[];
      /** What Architect left out, for the record: no sealed organization is named. */
      notes: string[];
      /** The same, naming each organization, for the person. */
      told: string[];
    }
  | { kind: 'ended'; message: string };

/**
 * Makes each organization's tasks from one specification: the template step of a one-organization
 * job, run on each organization's own files, with every task marked with its organization and
 * its family kept inside it. A kind of task that some organization's files can't make, or make
 * too few of, is left out of the whole job, so every organization is asked the same kinds.
 */
export function makeFieldTasks(
  field: FieldSource,
  specs: readonly TypeInput[],
  passRate: number,
  split: (tasks: Task[], config: SplitConfig) => TaskSplits,
): FieldTasks {
  let inputs = [...specs];
  const notes: string[] = [];
  const told: string[] = [];
  const all = [...field.taught, ...field.sealed];
  for (;;) {
    const made = all.map((item) => ({ item, generation: generateAt(item, inputs, passRate) }));
    const left = new Map<string, { label: string; org: Organization; why: string }>();
    for (const { item, generation } of made) {
      for (const type of generation.rejected) {
        const first = type.problems[0] ?? '';
        left.set(type.id, {
          label: type.label,
          org: item.org,
          why: type.inFull.get(first) ?? first,
        });
      }
      for (const type of generation.thin) {
        left.set(type.id, {
          label: type.label,
          org: item.org,
          why: `its files support only ${type.available} different ${type.available === 1 ? 'request' : 'requests'} of that kind.`,
        });
      }
    }
    if (left.size > 0) {
      for (const [, type] of left) {
        const sealed = type.org.role === 'transfer';
        notes.push(
          `Left out "${type.label}": ${sealed ? 'an organization kept for the final test' : type.org.name} couldn't make it from its files.`,
        );
        told.push(`I left out "${type.label}": at ${type.org.name}, ${type.why}`);
      }
      inputs = inputs.filter((input) => !left.has(input.id));
      if (inputs.length === 0) {
        return {
          kind: 'ended',
          message: `${told.join('\n')}\n\nNo kind of task is left that every organization's files can make. Check that each folder holds the same records, then describe the field again.`,
        };
      }
      continue;
    }
    const tagged = made.map(({ item, generation }) => ({
      item,
      tasks: generation.tasks.map((task) => ({
        ...task,
        id: `${item.org.id}-${task.id}`,
        family: `${item.org.id}:${task.family}`,
        org: item.org.id,
      })),
    }));
    const empty = tagged.find(({ tasks }) => tasks.length === 0);
    if (empty !== undefined) {
      return {
        kind: 'ended',
        message: `${empty.item.org.name}'s files make no task of the kinds drafted, so nothing would test the agent there. Check its folder, then describe the field again.`,
      };
    }
    const taught = tagged
      .filter(({ item }) => item.org.role === 'train')
      .flatMap(({ tasks }) => tasks);
    const seed = seedFrom(
      field.taught.flatMap((item) => [item.org.id, ...digestOf(item.attached)]),
    );
    const division = divide(taught, seed, split, () => []);
    if (division.kind !== 'divided') {
      return {
        kind: 'ended',
        message: `The organizations you teach on support only ${taught.length} different tasks I can check and divide, and training needs more. Add rows to their records, or teach on another organization, and describe the field again.`,
      };
    }
    const spelled = made.find(({ item }) => item.org.role === 'train')?.generation.types ?? [];
    return {
      kind: 'made',
      types: spelled.map((type) => ({ id: type.id, spec: type.spec, rule: type.rule })),
      taught: division.tasks,
      split: { seed: division.seed, ...splitSizes(division.tasks.length) },
      sealed: tagged
        .filter(({ item }) => item.org.role === 'transfer')
        .flatMap(({ tasks }) => tasks),
      notes,
      told,
    };
  }
}

/**
 * Writes the field as a job folder (`docs/JOB_FORMAT.md`) in a new temporary folder and returns
 * the job file's path: `job.json`, `tasks.jsonl`, and each organization's files at
 * `orgs/<id>/data/`.
 */
export async function writeJobFolder(
  job: Job,
  tasks: readonly Task[],
  field: FieldSource,
): Promise<{ file: string; remove: () => Promise<void> }> {
  const folder = await mkdtemp(join(tmpdir(), 'architect-field-'));
  const remove = () => rm(folder, { recursive: true, force: true });
  try {
    await writeJsonFile(join(folder, 'job.json'), job);
    await writeJsonLines(join(folder, 'tasks.jsonl'), [...tasks]);
    for (const item of [...field.taught, ...field.sealed]) {
      const data = orgDataDir(folder, item.org.id);
      await mkdir(data, { recursive: true });
      for (const file of item.attached.files) await writeFile(join(data, file.name), file.bytes);
    }
  } catch (error) {
    await remove();
    throw error;
  }
  return { file: join(folder, 'job.json'), remove };
}
