import { createHash } from 'node:crypto';
import { lstatSync } from 'node:fs';
import { lstat, mkdir, readdir, readFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import {
  dataPath,
  DATA_FOLDER,
  GuardError,
  OUTPUT_FOLDER,
  SKILLS_FOLDER,
  type DataFile,
  type FileChange,
  type RowDiff,
  type WriteToolName,
} from '@architect/shared';
import { writeFileAtomic } from '../data/atomic-write';
import { parseCsv } from '../data/csv';
import { DataError, SaveError } from '../data/errors';
import type { FileInfo, TableSnapshot } from '../data/types';
import type { SandboxData } from '../sandbox/types';
import { filePatch, patchStats, rowDiff, type FilePatch } from './diff';
import { agentPath, isWithin, parentOf, unsafeName } from './paths';
import { count, fromDisk, lineCount, normalizeBreaks, toDisk, type TextFormat } from './text';

export type FilesMode = 'scratch' | 'live';
export type FileArea = 'data' | 'output' | 'skills';

/** A file in the agent's folder. */
export interface AgentFile {
  /** Its path in the agent's folder, e.g. `data/orders.csv`. */
  path: string;
  area: FileArea;
  /** A table is one of the job's CSV data files; every other file is text. */
  kind: 'table' | 'text';
  writable: boolean;
  description?: string;
  lines: number;
}

/** The `output/` folder of a job that allows one. */
export interface OutputFolder {
  description?: string;
  /**
   * Where the folder is on disk, for a live store: the files already in it are read when the
   * store opens, and approved changes are saved there. A scratch store starts it empty.
   */
  dir?: string;
}

export interface AgentFilesOptions {
  /** The folder holding the job's data files. */
  dataDir: string;
  files: readonly DataFile[];
  output?: OutputFolder;
  /** Each skill's file by its path, `skills/<name>/SKILL.md`. Skills are read-only. */
  skills?: Readonly<Record<string, string>>;
  /** `scratch` keeps changes in memory; `live` saves each applied change to disk at once. */
  mode: FilesMode;
}

/** A change that has been checked and diffed but not applied, so it can be shown for approval. */
export interface PlannedChange {
  readonly path: string;
  readonly op: WriteToolName;
  /** For people, e.g. "Add 1 row to data/returns.csv". */
  readonly summary: string;
  /** For the agent once it is applied, e.g. "Added 1 row to data/returns.csv." */
  readonly done: string;
  readonly patch: string;
  /** For a table, the rows the change adds, removes and changes. */
  readonly rows?: RowDiff;
  /** False when the new text is the text the file already has. */
  readonly changes: boolean;
}

/** What a checker reads of an attempt's end state: the job's tables, now and as they started. */
export interface CheckedFiles {
  /** Every table as it is now, by data file name, e.g. `returns.csv`. */
  tables(): Record<string, TableSnapshot>;
  /** Every table as it was when the files were opened. */
  originalTables(): Record<string, TableSnapshot>;
}

/**
 * The agent's folder: the job's data files under `data/`, an `output/` folder when the job
 * allows one, and the harness's skills under `skills/`. Every path is a logical one, every read
 * and change is checked against the job's permissions, and a table must stay valid CSV with
 * its header.
 */
export interface AgentFiles extends CheckedFiles {
  readonly mode: FilesMode;
  /** True when the job allows an output folder. */
  readonly hasOutput: boolean;
  /** True when the agent may change some file: a writable data file, or the output folder. */
  readonly writable: boolean;
  /** Every file, in path order. */
  list(): AgentFile[];
  file(path: string): AgentFile | undefined;
  /** True for the agent's folder itself, its top folders and any folder inside them. */
  isFolder(path: string): boolean;
  /** A file's text, with LF line breaks. Throws for a folder or a path with nothing at it. */
  read(path: string): string;
  /** The rows of a table as it is now, by its path; undefined for any other file. */
  tableAt(path: string): TableSnapshot | undefined;
  /** Every file's text as it is now, by path. */
  texts(): Record<string, string>;
  /**
   * A sha256 of each data file as it would be on disk now, by path: at the start of an attempt,
   * the bytes of the data it starts from.
   */
  dataHashes(): Record<string, string>;
  /** Checks and diffs a new text for a file, without applying it. */
  plan(op: WriteToolName, path: string, text: string): PlannedChange;
  /** Applies a planned change unless its file changed since; a live store saves it at once. */
  apply(plan: PlannedChange): Promise<void>;
  /** The files whose text differs from `since`, an earlier `texts()`, each as a diff from it. */
  changesSince(since: Readonly<Record<string, string>>): FileChange[];
  /** The job's data files as a harness tool sees them, by name. */
  sandboxData(): SandboxData;
}

/** Files read from an output folder at most, and the largest one read. */
const MAX_OUTPUT_FILES = 500;
const MAX_OUTPUT_FILE_BYTES = 1024 * 1024;
const LF: TextFormat = { linebreak: '\n', bom: false };

interface FileState {
  readonly path: string;
  readonly area: FileArea;
  readonly kind: 'table' | 'text';
  readonly writable: boolean;
  readonly description?: string;
  /** The data file's declared name. */
  readonly name?: string;
  /** Where a live store saves it. */
  readonly disk?: string;
  readonly format: TextFormat;
  /** The text when the store opened, or null for a file made since. */
  readonly initial: string | null;
  /** The file as it was on disk when the store opened, for data files. */
  readonly raw?: string;
  /** For a table: the header every change must keep. */
  readonly columns?: readonly string[];
  text: string;
  version: number;
}

interface PlanState {
  readonly state: FileState | null;
  readonly version: number;
  readonly text: string;
}

/** Opens the agent's folder. Undeclared and linked data files can't be read or written through it. */
export async function openAgentFiles(options: AgentFilesOptions): Promise<AgentFiles> {
  const names = options.files.map((file) => file.name);
  const twice = names.find((name, index) => names.indexOf(name) !== index);
  if (twice !== undefined) throw new DataError(`${twice} is declared twice in the job.`);

  const states: FileState[] = [];
  for (const file of options.files) states.push(await openDataFile(options.dataDir, file));
  for (const [path, text] of Object.entries(options.skills ?? {})) {
    states.push(textState(path, 'skills', text, false));
  }
  if (options.output?.dir !== undefined) {
    states.push(...(await openOutputFiles(options.output.dir)));
  }
  return new FolderFiles(options, states);
}

async function openDataFile(dataDir: string, file: DataFile): Promise<FileState> {
  const root = resolve(dataDir);
  const disk = resolve(root, file.name);
  const inside = relative(root, disk);
  if (inside === '' || inside.startsWith('..') || isAbsolute(inside)) {
    throw new GuardError('permission', `${file.name} is outside the job's data folder.`);
  }
  const info = await lstat(disk).catch((error: NodeJS.ErrnoException) => {
    if (error.code === 'ENOENT') {
      throw new DataError(`${file.name} is declared in the job but missing from its data folder.`);
    }
    throw error;
  });
  if (info.isSymbolicLink() || !info.isFile()) {
    throw new GuardError(
      'permission',
      `${file.name} in the job's data folder is not a plain file, so it isn't read.`,
    );
  }
  const raw = await readFile(disk, 'utf8');
  const { text, format } = fromDisk(raw);
  const path = dataPath(file.name);
  const columns = file.kind === 'table' ? parseCsv(path, text).columns : undefined;
  return {
    path,
    area: 'data',
    kind: file.kind,
    writable: file.access === 'write',
    ...(file.description === undefined ? {} : { description: file.description }),
    name: file.name,
    disk,
    format,
    initial: text,
    raw,
    ...(columns === undefined ? {} : { columns }),
    text,
    version: 0,
  };
}

function textState(
  path: string,
  area: FileArea,
  raw: string,
  writable: boolean,
  disk?: string,
): FileState {
  const { text, format } = fromDisk(raw);
  return {
    path,
    area,
    kind: 'text',
    writable,
    ...(disk === undefined ? {} : { disk }),
    format,
    initial: text,
    text,
    version: 0,
  };
}

/** The plain files in an output folder, its subfolders included, skipping links and big files. */
async function openOutputFiles(dir: string): Promise<FileState[]> {
  const found: FileState[] = [];
  const walk = async (folder: string, prefix: string): Promise<void> => {
    const entries = await readdir(folder, { withFileTypes: true }).catch(
      (error: NodeJS.ErrnoException) => {
        if (error.code === 'ENOENT') return [];
        throw error;
      },
    );
    for (const entry of entries.sort((a, b) => compare(a.name, b.name))) {
      if (found.length >= MAX_OUTPUT_FILES) return;
      const path = `${prefix}/${entry.name}`;
      const disk = join(folder, entry.name);
      if (entry.isDirectory()) await walk(disk, path);
      else if (entry.isFile() && unsafeName(path.slice(OUTPUT_FOLDER.length + 1)) === null) {
        const info = await lstat(disk);
        if (info.size > MAX_OUTPUT_FILE_BYTES) continue;
        found.push(textState(path, 'output', await readFile(disk, 'utf8'), true, disk));
      }
    }
  };
  await walk(dir, OUTPUT_FOLDER);
  return found;
}

class FolderFiles implements AgentFiles {
  readonly mode: FilesMode;
  readonly hasOutput: boolean;
  private readonly files = new Map<string, FileState>();
  private readonly plans = new WeakMap<PlannedChange, PlanState>();
  /** Parsed tables by path: at most the text the store opened with and the latest one. */
  private readonly parsed = new Map<string, { text: string; table: TableSnapshot }[]>();

  constructor(
    private readonly options: AgentFilesOptions,
    states: readonly FileState[],
  ) {
    this.mode = options.mode;
    this.hasOutput = options.output !== undefined;
    for (const state of states) this.files.set(state.path, state);
  }

  get writable(): boolean {
    return this.hasOutput || [...this.files.values()].some((state) => state.writable);
  }

  list(): AgentFile[] {
    return [...this.files.values()]
      .sort((a, b) => compare(a.path, b.path))
      .map((state) => this.describe(state));
  }

  file(path: string): AgentFile | undefined {
    const state = this.files.get(path);
    return state ? this.describe(state) : undefined;
  }

  isFolder(path: string): boolean {
    if (path === '' || path === DATA_FOLDER) return true;
    if (path === OUTPUT_FOLDER && this.hasOutput) return true;
    return [...this.files.keys()].some((file) => file.startsWith(`${path}/`));
  }

  read(raw: string): string {
    const path = agentPath(raw);
    const state = this.files.get(path);
    if (state) return state.text;
    if (this.isFolder(path)) {
      throw new DataError(
        `${path === '' ? 'That' : path} is a folder. List it with ls${path === '' ? '' : ` ${path}`}.`,
      );
    }
    throw new DataError(this.missing(path));
  }

  tableAt(path: string): TableSnapshot | undefined {
    const state = this.files.get(path);
    return state?.kind === 'table' ? this.table(state.path, state.text) : undefined;
  }

  texts(): Record<string, string> {
    return Object.fromEntries([...this.files.values()].map((state) => [state.path, state.text]));
  }

  dataHashes(): Record<string, string> {
    return Object.fromEntries(
      this.dataStates().map((state) => {
        const bytes =
          state.text === state.initial && state.raw !== undefined
            ? state.raw
            : toDisk(state.text, state.format);
        return [state.path, `sha256-${createHash('sha256').update(bytes).digest('hex')}`];
      }),
    );
  }

  plan(op: WriteToolName, raw: string, newText: string): PlannedChange {
    const path = agentPath(raw);
    const state = this.files.get(path) ?? null;
    if (state) {
      if (!state.writable) throw new GuardError('permission', this.readOnly(state));
    } else {
      this.checkNewFile(path);
    }
    const text = normalizeBreaks(newText);
    if (state?.kind === 'table') this.checkTable(state, text);
    const before = state ? state.text : null;
    const rows = state ? this.rowsBetween(state, before ?? '', text) : undefined;
    const patch = filePatch(path, before, text);
    const plan: PlannedChange = Object.freeze({
      path,
      op,
      ...describeChange(op, path, before, text, patch, rows),
      patch: patch.patch,
      ...(rows === undefined ? {} : { rows }),
      changes: before !== text,
    });
    this.plans.set(plan, { state, version: state?.version ?? 0, text });
    return plan;
  }

  async apply(plan: PlannedChange): Promise<void> {
    const planned = this.plans.get(plan);
    if (!planned) throw new Error('This change was planned by different files.');
    const current = this.files.get(plan.path) ?? null;
    if (current !== planned.state || (current && current.version !== planned.version)) {
      throw new DataError(`${plan.path} changed after this change was planned. Make it again.`);
    }
    if (!plan.changes) return;
    const state = current ?? this.newOutputFile(plan.path);
    const previous = { text: state.text, version: state.version };
    state.text = planned.text;
    state.version += 1;
    if (!current) this.files.set(state.path, state);
    if (this.mode !== 'live') return;
    try {
      await this.save(state);
    } catch (error) {
      state.text = previous.text;
      state.version = previous.version;
      if (!current) this.files.delete(state.path);
      throw new SaveError(
        `The change couldn't be saved, so nothing was written: ${saveProblem(error, state.path)}`,
      );
    }
  }

  changesSince(since: Readonly<Record<string, string>>): FileChange[] {
    return [...this.files.values()]
      .sort((a, b) => compare(a.path, b.path))
      .flatMap((state): FileChange[] => {
        const before = Object.hasOwn(since, state.path) ? (since[state.path] ?? '') : null;
        if (before === state.text) return [];
        const rows = this.rowsBetween(state, before ?? '', state.text);
        return [
          {
            path: state.path,
            patch: filePatch(state.path, before, state.text).patch,
            ...(rows === undefined ? {} : { rows }),
          },
        ];
      });
  }

  tables(): Record<string, TableSnapshot> {
    return Object.fromEntries(
      this.dataStates()
        .filter((state) => state.kind === 'table')
        .map((state) => [state.name ?? state.path, this.table(state.path, state.text)]),
    );
  }

  originalTables(): Record<string, TableSnapshot> {
    return Object.fromEntries(
      this.dataStates()
        .filter((state) => state.kind === 'table')
        .map((state) => [state.name ?? state.path, this.table(state.path, state.initial ?? '')]),
    );
  }

  sandboxData(): SandboxData {
    const files: FileInfo[] = [];
    const tables: Record<string, TableSnapshot> = {};
    const texts: Record<string, string> = {};
    for (const state of this.dataStates()) {
      const name = state.name ?? state.path;
      const info: FileInfo = {
        name,
        kind: state.kind,
        access: state.writable ? 'write' : 'read',
      };
      if (state.description !== undefined) info.description = state.description;
      if (state.kind === 'table') {
        const table = this.table(state.path, state.text);
        tables[name] = table;
        info.rows = table.rows.length;
        info.columns = [...table.columns];
      } else {
        texts[name] = state.text;
      }
      files.push(info);
    }
    return { files, tables, texts };
  }

  private dataStates(): FileState[] {
    return [...this.files.values()].filter((state) => state.area === 'data');
  }

  private describe(state: FileState): AgentFile {
    return {
      path: state.path,
      area: state.area,
      kind: state.kind,
      writable: state.writable,
      ...(state.description === undefined ? {} : { description: state.description }),
      lines: lineCount(state.text),
    };
  }

  /** A table's rows for a text, parsed once per text it keeps: the opened one and the latest. */
  private table(path: string, text: string): TableSnapshot {
    const entries = this.parsed.get(path) ?? [];
    const hit = entries.find((entry) => entry.text === text);
    if (hit) return hit.table;
    const { columns, rows } = parseCsv(path, text);
    const table: TableSnapshot = { columns: Object.freeze(columns), rows: Object.freeze(rows) };
    const initial = this.files.get(path)?.initial;
    const kept = entries.filter((entry) => entry.text === initial);
    this.parsed.set(path, [...kept, { text, table }]);
    return table;
  }

  /** How a table's rows changed between two texts; undefined for a text file or a huge change. */
  private rowsBetween(state: FileState, before: string, after: string): RowDiff | undefined {
    if (state.kind !== 'table' || !state.columns) return undefined;
    const rowsOf = (text: string) => (text === '' ? [] : this.table(state.path, text).rows);
    return rowDiff(state.columns, rowsOf(before), rowsOf(after));
  }

  /** A table's new text must parse, keep the header line and give every row all its values. */
  private checkTable(state: FileState, text: string): void {
    let columns: string[];
    try {
      columns = parseCsv(state.path, text).columns;
    } catch (error) {
      if (!(error instanceof DataError)) throw error;
      throw new DataError(`Nothing was changed: ${error.message}`);
    }
    const header = state.columns ?? [];
    if (columns.length !== header.length || columns.some((column, at) => column !== header[at])) {
      throw new DataError(
        `Nothing was changed: ${state.path} has to keep its header line, ${header.join(',')}, as its first line.`,
      );
    }
  }

  private checkNewFile(path: string): void {
    if (isWithin(path, SKILLS_FOLDER)) {
      throw new GuardError('permission', `${SKILLS_FOLDER}/ is read-only.`);
    }
    const elsewhere = this.hasOutput ? ` New files go in ${OUTPUT_FOLDER}/.` : '';
    if (isWithin(path, DATA_FOLDER)) {
      throw new GuardError(
        'permission',
        `There is no ${path}, and ${DATA_FOLDER}/ holds only the job's own files.${elsewhere}`,
      );
    }
    if (!this.hasOutput) {
      throw new GuardError(
        'permission',
        `This job has no folder for new files, so ${path || 'that'} can't be created.`,
      );
    }
    if (!isWithin(path, OUTPUT_FOLDER) || path === OUTPUT_FOLDER) {
      throw new GuardError(
        'permission',
        `New files go in ${OUTPUT_FOLDER}/, like ${OUTPUT_FOLDER}/report.md.`,
      );
    }
    if (this.isFolder(path)) throw new DataError(`${path} is a folder.`);
    const problem = unsafeName(path.slice(OUTPUT_FOLDER.length + 1));
    if (problem !== null) throw new DataError(`${path} can't be created: ${problem}.`);
    const blocking = [...this.files.keys()].find((file) => isWithin(path, file));
    if (blocking !== undefined) throw new DataError(`${blocking} is a file, not a folder.`);
    const twin = [...this.files.keys()].find((file) => file.toLowerCase() === path.toLowerCase());
    if (twin !== undefined) {
      throw new DataError(
        `${twin} is already there, and on many computers a name that differs only in capitals is the same file. Write to ${twin}, or pick another name.`,
      );
    }
    this.checkDisk(path);
  }

  /**
   * In a live output folder, a new file's path must lead to nothing on disk yet, and through no
   * link: a file the store didn't open (one too big, say) is never replaced unseen, and nothing
   * is written outside the folder.
   */
  private checkDisk(path: string): void {
    const dir = this.options.output?.dir;
    if (this.mode !== 'live' || dir === undefined) return;
    const parts = path.slice(OUTPUT_FOLDER.length + 1).split('/');
    let disk = dir;
    for (const [index, part] of parts.entries()) {
      disk = join(disk, part);
      const shown = [OUTPUT_FOLDER, ...parts.slice(0, index + 1)].join('/');
      const info = lstatSync(disk, { throwIfNoEntry: false });
      if (info === undefined) return;
      if (info.isSymbolicLink()) {
        throw new GuardError(
          'permission',
          `${shown} is a link on this computer, so nothing is written through it.`,
        );
      }
      if (index === parts.length - 1) {
        throw new DataError(
          `${path} is already on this computer but wasn't opened here, so it isn't replaced.`,
        );
      }
      if (!info.isDirectory()) throw new DataError(`${shown} is a file, not a folder.`);
    }
  }

  private newOutputFile(path: string): FileState {
    const dir = this.options.output?.dir;
    const relativePath = path.slice(OUTPUT_FOLDER.length + 1);
    return {
      path,
      area: 'output',
      kind: 'text',
      writable: true,
      ...(dir === undefined ? {} : { disk: join(dir, ...relativePath.split('/')) }),
      format: LF,
      initial: null,
      text: '',
      version: 0,
    };
  }

  private async save(state: FileState): Promise<void> {
    if (state.disk === undefined) {
      throw new Error(`${state.path} has no place on this computer to be saved to.`);
    }
    await mkdir(dirname(state.disk), { recursive: true });
    writeFileAtomic(state.disk, toDisk(state.text, state.format));
  }

  private readOnly(state: FileState): string {
    if (state.area === 'skills') return `${state.path} is read-only: skills can't be changed.`;
    const writable = [...this.files.values()]
      .filter((other) => other.writable && other.area === 'data')
      .map((other) => other.path);
    const hint =
      writable.length > 0
        ? `Only ${writable.join(', ')} can be changed.`
        : 'No data file can be changed in this job.';
    return `${state.path} is read-only for this job. ${hint}`;
  }

  private missing(path: string): string {
    const folder = parentOf(path);
    if (folder !== '' && this.isFolder(folder)) {
      const inFolder = [...this.files.keys()]
        .filter((file) => parentOf(file) === folder)
        .sort(compare)
        .slice(0, 30)
        .map((file) => file.slice(folder.length + 1));
      return inFolder.length === 0
        ? `There is no ${path}: ${folder}/ is empty.`
        : `There is no ${path}. In ${folder}/ there are: ${inFolder.join(', ')}.`;
    }
    const tops = [DATA_FOLDER, ...(this.hasOutput ? [OUTPUT_FOLDER] : [])];
    if (this.isFolder(SKILLS_FOLDER)) tops.push(SKILLS_FOLDER);
    return `There is no ${path}. Your folders are ${tops.map((top) => `${top}/`).join(', ')}.`;
  }
}

/**
 * Why a file couldn't be written, in words a person can act on: the usual causes by name (another
 * program holding the file, a read-only file, a full disk), anything else as the system said it.
 */
export function saveProblem(error: unknown, path: string): string {
  const name = path.split('/').at(-1) ?? path;
  const code = (error as NodeJS.ErrnoException | null)?.code;
  if (code === 'EBUSY') return `${name} is open in another program.`;
  if (code === 'EPERM' || code === 'EACCES') {
    return `${name} is read-only, or another program has it open.`;
  }
  if (code === 'ENOSPC') return 'the disk is full.';
  return error instanceof Error ? error.message : String(error);
}

/** One line for people and one for the agent, saying what a change does to its file. */
function describeChange(
  op: WriteToolName,
  path: string,
  before: string | null,
  after: string,
  { patch, whole }: FilePatch,
  rows: RowDiff | undefined,
): { summary: string; done: string } {
  if (before === after) {
    return {
      summary: `No change to ${path}`,
      done: `${path} already has this text, so nothing changed.`,
    };
  }
  if (before === null) {
    const lines = count(lineCount(after), 'line');
    return { summary: `Create ${path} (${lines})`, done: `Created ${path} (${lines}).` };
  }
  if (whole && !rows) {
    const lines = count(lineCount(after), 'line');
    return { summary: `Rewrite ${path} (${lines})`, done: `Rewrote ${path} (${lines}).` };
  }
  if (rows) {
    const { added, changed, removed } = {
      added: rows.added.length,
      changed: rows.changed.length,
      removed: rows.removed.length,
    };
    if (changed === 0 && removed === 0 && added > 0) {
      return {
        summary: `Add ${count(added, 'row')} to ${path}`,
        done: `Added ${count(added, 'row')} to ${path}.`,
      };
    }
    if (added === 0 && removed === 0 && changed > 0) {
      return {
        summary: `Change ${count(changed, 'row')} in ${path}`,
        done: `Changed ${count(changed, 'row')} in ${path}.`,
      };
    }
    if (added === 0 && changed === 0 && removed > 0) {
      return {
        summary: `Remove ${count(removed, 'row')} from ${path}`,
        done: `Removed ${count(removed, 'row')} from ${path}.`,
      };
    }
    const parts = [
      added > 0 && `${count(added, 'row')} added`,
      changed > 0 && `${count(changed, 'row')} changed`,
      removed > 0 && `${count(removed, 'row')} removed`,
    ].filter(Boolean);
    if (parts.length === 0) {
      return {
        summary: `Rewrite ${path} with the same rows`,
        done: `Rewrote ${path}; its rows are the same.`,
      };
    }
    return {
      summary: `Update ${path}: ${parts.join(', ')}`,
      done: `Updated ${path}: ${parts.join(', ')}.`,
    };
  }
  const { added, removed } = patchStats(patch);
  if (op === 'append' || removed === 0) {
    // An append only adds lines; a "removed" line is the old last line gaining its line break.
    const lines = count(added - (op === 'append' ? removed : 0), 'line');
    return { summary: `Add ${lines} to ${path}`, done: `Added ${lines} to ${path}.` };
  }
  const lines = `${count(added, 'line')} added, ${removed.toLocaleString('en-US')} removed`;
  return { summary: `Change ${path}: ${lines}`, done: `Changed ${path}: ${lines}.` };
}

/** Code-unit order, the same on every machine and locale. */
function compare(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}
