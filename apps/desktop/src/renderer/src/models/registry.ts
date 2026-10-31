import type {
  GraduateSummary,
  GraduateVersion,
  OrgTypeResult,
  ReportCard,
  Score,
} from '@architect/shared';
import { orgScores } from '../lab/items';
import { percentOf } from '../lib/format';
import { quantizationLabel, shortModelName } from '../lib/names';

/** One version of one agent, with the report card its own final test left, when it took one. */
export interface ModelRow {
  key: string;
  agent: GraduateSummary;
  version: GraduateVersion;
  /** Null when no final test measured this version. */
  report: ReportCard | null;
  /** Why its report card couldn't be read, when it couldn't. */
  reportError: Error | null;
}

export const rowKey = (graduateId: string, version: number) => `${graduateId}:${version}`;

export type ModelStatus =
  'active' | 'candidate' | 'imported' | 'experimental' | 'kept' | 'set_aside';

export const STATUS_WORDS: Record<ModelStatus, string> = {
  active: 'Active',
  candidate: 'Candidate',
  imported: 'Imported',
  experimental: 'Experimental',
  kept: 'Kept',
  set_aside: 'Set aside',
};

export const imported = (version: GraduateVersion) =>
  version.origin !== undefined || version.source !== undefined;

/**
 * What a version is now, in one word: the one chats run on, one waiting to be accepted, one that
 * came from another computer, one its final test didn't vouch for, one kept for going back to, or
 * one set aside.
 */
export function statusOf(version: GraduateVersion): ModelStatus {
  if (version.active) return 'active';
  if (version.state === 'rejected') return 'set_aside';
  if (version.state === 'candidate') return 'candidate';
  if (imported(version)) return 'imported';
  if (version.evaluation === 'experimental') return 'experimental';
  return 'kept';
}

export type RegistryFilter = 'all' | 'active' | 'candidates' | 'imported';

export function matchesFilter(row: ModelRow, filter: RegistryFilter): boolean {
  switch (filter) {
    case 'all':
      return true;
    case 'active':
      return row.version.active;
    case 'candidates':
      return row.version.state === 'candidate';
    case 'imported':
      return imported(row.version);
  }
}

/** The base model as people know it, with how it is quantized: "Glimmer · 4-bit". */
export function baseModelOf(version: GraduateVersion): string {
  const { label, base } = version.manifest.model;
  const name = shortModelName(label);
  return base.quantization ? `${name} · ${quantizationLabel(base.quantization)}` : name;
}

export const fieldOf = (version: GraduateVersion) => version.manifest.contract.name;

const RUNTIMES: Record<string, string> = {
  ollama: 'Ollama',
  'llama.cpp': 'llama.cpp',
  openai_compatible: 'OpenAI-compatible',
};

/** The local runtime a version runs on first, as people write its name. */
export const runtimeName = (runtime: string | undefined) =>
  runtime === undefined ? undefined : (RUNTIMES[runtime] ?? runtime);

export const shortHash = (hash: string) => hash.replace(/^sha256:/, '').slice(0, 7);

/** Matches the words typed against the agent, its field, model, harness, status and version. */
export function matchesSearch(row: ModelRow, search: string): boolean {
  const words = search.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return true;
  const { version } = row;
  const haystack = [
    row.agent.name,
    fieldOf(version),
    baseModelOf(version),
    version.manifest.model.base.name,
    shortHash(version.manifest.harness.hash),
    version.manifest.model.adapter ? shortHash(version.manifest.model.adapter.sha256) : '',
    STATUS_WORDS[statusOf(version)],
    `v${version.version}`,
  ]
    .join(' ')
    .toLowerCase();
  return words.every((word) => haystack.includes(word));
}

/** What the check tasks are, where a header or a label names them. */
export const CHECK_HINT =
  'Tasks scored at the end of teaching. Spark sees only the score, never the tasks.';

export interface RowScores {
  /** The final test at the organizations it trained on (the job's own, for a one-organization job). */
  seen: Score | null;
  /** At generated organizations it never saw. */
  unseen: Score | null;
  /** At real organizations it never saw. */
  real: Score | null;
  /** The check tasks, at the end of teaching: not the final test. */
  check: Score | null;
}

const NONE: RowScores = { seen: null, unseen: null, real: null, check: null };

/** A row's scores from its report card. What wasn't measured is null, never zero. */
export function scoresOf(row: Pick<ModelRow, 'report' | 'version'>): RowScores {
  const { report } = row;
  if (!report) {
    const summary = row.version.manifest.evidence.summary;
    return summary ? { ...NONE, seen: summary.score } : NONE;
  }
  const check = report.dev.final;
  const perOrg = report.test.perOrg;
  if (perOrg && perOrg.length > 0) return { ...orgScores(perOrg), check };
  return { ...NONE, seen: report.test.score.total === 0 ? null : report.test.score, check };
}

/** A score as a number to sort by; null stays null so it sorts last. */
export const sortScore = (score: Score | null) =>
  score === null || score.total === 0 ? null : percentOf(score);

/**
 * Whether two versions can be set side by side: two versions of one agent, or versions of two
 * agents made for the same job.
 */
export function comparable(a: ModelRow, b: ModelRow): boolean {
  if (a.key === b.key) return false;
  if (a.agent.id === b.agent.id) return true;
  return a.version.manifest.contract.jobId === b.version.manifest.contract.jobId;
}

/** The older of two versions first, so a comparison reads from before to after. */
export function ordered(a: ModelRow, b: ModelRow): [ModelRow, ModelRow] {
  const at = (row: ModelRow) => Date.parse(row.version.createdAt);
  if (a.agent.id === b.agent.id) return a.version.version <= b.version.version ? [a, b] : [b, a];
  return at(a) <= at(b) ? [a, b] : [b, a];
}

/** Where an organization stands to the agent: taught on, never seen, or never seen and real. */
export type OrgGroup = 'seen' | 'unseen' | 'real';

export const GROUP_LABELS: Record<OrgGroup, string> = {
  seen: 'Taught on',
  unseen: 'Never seen',
  real: 'Never seen, real',
};

const GROUP_ORDER: OrgGroup[] = ['seen', 'unseen', 'real'];

interface Measured {
  type: string;
  label: string;
  org: string;
  orgName: string;
  group: OrgGroup;
  score: Score;
}

/** A card's final test cell by cell: per organization, or the job's own when it has one. */
function measuredCells(report: ReportCard): Measured[] {
  const perOrg: readonly OrgTypeResult[] | undefined = report.test.perOrg;
  if (perOrg && perOrg.length > 0) {
    return perOrg.map((result) => ({
      type: result.type,
      label: result.label,
      org: result.org,
      orgName: result.orgName,
      group: result.seen ? 'seen' : result.synthetic ? 'unseen' : 'real',
      score: { pass: result.pass, total: result.total },
    }));
  }
  return report.test.perType
    .filter((type) => type.total > 0)
    .map((type) => ({
      type: type.type,
      label: type.label,
      org: '',
      orgName: 'Final test',
      group: 'seen' as const,
      score: { pass: type.pass, total: type.total },
    }));
}

/** One cell of a comparison: both results, measured on the same tasks. */
export interface DeltaCell {
  before: Score;
  after: Score;
  /** Percentage points, after minus before. */
  points: number;
}

export interface ScoreComparison {
  groups: { group: OrgGroup; label: string; columns: { org: string; name: string }[] }[];
  /** One row per skill; a cell is null where the two weren't measured on the same tasks. */
  rows: { type: string; label: string; cells: (DeltaCell | null)[] }[];
  /** Every skill together at each organization, where every skill there compares. */
  totals: (DeltaCell | null)[];
}

export type Comparison =
  | { kind: 'compared'; scores: ScoreComparison }
  /** No cell was measured on the same tasks by both, and why, in a few words. */
  | { kind: 'apart'; reason: string };

const delta = (before: Score, after: Score): DeltaCell => ({
  before,
  after,
  points: percentOf(after) - percentOf(before),
});

/**
 * Two versions' results side by side, skill by organization, wherever both were measured on the
 * same tasks: the same job's final test, the same skill at the same organization, the same number
 * of tasks. A version made on another computer was tested on that computer's tasks, so it never
 * compares with one made here.
 */
export function compareScores(a: ModelRow, b: ModelRow): Comparison {
  if (!a.report || !b.report) {
    return { kind: 'apart', reason: 'One of them took no final test.' };
  }
  if (a.report.jobId !== b.report.jobId) {
    return { kind: 'apart', reason: "They weren't measured on the same tasks." };
  }
  return compareCards(a.report, b.report);
}

/**
 * Two cards side by side, cell by cell, where both measured the same skill at the same
 * organization on as many tasks: for cards of one job, or of a field and its version carried to
 * another model, whose final test is the same sealed one (decision 095).
 */
export function compareCards(earlier: ReportCard, later: ReportCard): Comparison {
  const before = measuredCells(earlier);
  const after = measuredCells(later);
  const find = (cells: Measured[], type: string, org: string) =>
    cells.find((cell) => cell.type === type && cell.org === org);

  const columns: (Measured & { group: OrgGroup })[] = [];
  const rows: { type: string; label: string }[] = [];
  for (const cell of [...before, ...after]) {
    if (!columns.some((column) => column.org === cell.org)) columns.push(cell);
    if (!rows.some((row) => row.type === cell.type)) rows.push(cell);
  }
  const groups = GROUP_ORDER.map((group) => ({
    group,
    label: GROUP_LABELS[group],
    columns: columns
      .filter((column) => column.group === group)
      .map((column) => ({ org: column.org, name: column.orgName })),
  })).filter((group) => group.columns.length > 0);
  const orgs = groups.flatMap((group) => group.columns);

  const cellOf = (type: string, org: string): DeltaCell | null => {
    const from = find(before, type, org);
    const to = find(after, type, org);
    if (!from || !to || from.score.total !== to.score.total || from.score.total === 0) return null;
    return delta(from.score, to.score);
  };
  const grid = rows.map((row) => ({
    ...row,
    cells: orgs.map((org) => cellOf(row.type, org.org)),
  }));
  if (grid.every((row) => row.cells.every((cell) => cell === null))) {
    return { kind: 'apart', reason: "They weren't measured on the same tasks." };
  }
  const totals = orgs.map((org, index) => {
    const measured = rows.filter(
      (row) => find(before, row.type, org.org) || find(after, row.type, org.org),
    );
    const cells = measured.map((row) => grid[rows.indexOf(row)]?.cells[index] ?? null);
    if (cells.length === 0 || cells.some((cell) => cell === null)) return null;
    const sum = (side: 'before' | 'after') =>
      cells.reduce<Score>(
        (total, cell) => ({
          pass: total.pass + (cell?.[side].pass ?? 0),
          total: total.total + (cell?.[side].total ?? 0),
        }),
        { pass: 0, total: 0 },
      );
    return delta(sum('before'), sum('after'));
  });
  return { kind: 'compared', scores: { groups, rows: grid, totals } };
}

/** "+8", "−3", "0": percentage points, with a true minus sign. */
export function formatPoints(points: number): string {
  if (points > 0) return `+${points}`;
  if (points < 0) return `−${Math.abs(points)}`;
  return '0';
}
