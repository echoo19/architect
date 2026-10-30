import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { extname, join } from 'node:path';
import {
  DRAFTING_LIMITS,
  STUDY_LIMITS,
  StudyRecordSchema,
  type FileEdit,
  type Job,
  type JsonSchemaObject,
  type Organization,
  type StudyBrief,
  type StudyClaim,
  type StudyQuote,
  type StudyRecord,
  type StudyState,
} from '@architect/shared';
import { z } from 'zod';
import type { LeakDetector } from '../mentor/gate';
import { readAttachments, type Attached } from './files';
import { list, objectOf, text } from './json-parts';
import { quotesFrom } from './passages';
import { cleanText, foldKey } from './values';

/*
 * The study of a field job's material (decision 069). The teacher reads the train organizations'
 * own files and writes a short brief: the skills, how they connect, the rules it found with the
 * passages they rest on, where the organizations differ, what is unclear and what is out of scope.
 * A transfer organization's files are never opened here, and its name never leaves in a request.
 */

/** The organizations a job is taught on, whose material the teacher may read. */
export function trainOrganizations(job: Job): Organization[] {
  return (job.organizations ?? []).filter((org) => org.role === 'train');
}

/** Whether a job is studied before it trains: one that lists organizations it is taught on. */
export function isStudied(job: Job): boolean {
  return trainOrganizations(job).length > 0;
}

/** The files of an organization the teacher reads: tables and text. */
const READABLE = new Set(['.csv', '.md', '.markdown', '.txt']);

/** One train organization's files, read. */
export interface OrgMaterial {
  org: Organization;
  attached: Attached;
}

async function readableNames(dir: string, org: Organization): Promise<string[]> {
  let names: string[];
  try {
    names = await readdir(dir);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    names = [];
  }
  const kept = names.filter((name) => READABLE.has(extname(name).toLowerCase())).sort();
  if (kept.length === 0) {
    throw new Error(
      `${org.name} has no files to study yet. Its tables and policy belong in orgs/${org.id}/data/ in the job's folder.`,
    );
  }
  return kept;
}

/**
 * The train organizations' files, each read whole. Only train organizations are read: the
 * folder of a transfer one is never opened (invariant 1). A policy too long to read whole is
 * refused, as drafting refuses one, since a rule read from part of it can miss what matters.
 */
export async function readMaterial(
  job: Job,
  dirOf: (orgId: string) => string,
): Promise<OrgMaterial[]> {
  const material: OrgMaterial[] = [];
  for (const org of trainOrganizations(job)) {
    const dir = dirOf(org.id);
    const names = await readableNames(dir, org);
    const attached = await readAttachments(names.map((name) => join(dir, name)));
    const long = attached.files.find(
      (file) => (file.text?.length ?? 0) > DRAFTING_LIMITS.maxTextChars,
    );
    if (long !== undefined) {
      throw new Error(
        `${org.name}'s ${long.name} is longer than the ${DRAFTING_LIMITS.maxTextChars.toLocaleString('en-US')} characters Architect reads from one text file. Keep only the part the job needs.`,
      );
    }
    material.push({ org, attached });
  }
  return material;
}

/** Each train organization's file with the hash of its bytes, as they are now. */
export async function materialFiles(
  job: Job,
  dirOf: (orgId: string) => string,
): Promise<StudyRecord['files']> {
  const files: StudyRecord['files'] = [];
  for (const org of trainOrganizations(job)) {
    const dir = dirOf(org.id);
    let names: string[];
    try {
      names = await readableNames(dir, org);
    } catch {
      continue;
    }
    for (const name of names) {
      const bytes = await readFile(join(dir, name));
      files.push({ org: org.id, name, sha256: createHash('sha256').update(bytes).digest('hex') });
    }
  }
  return files;
}

/**
 * Whether a text names any of `marks` as a word, without regard to case. Marks shorter than three
 * letters are too common to tell apart and are not looked for.
 */
function namesAny(marks: readonly string[]): (content: string) => boolean {
  const patterns = marks
    .map((mark) => mark.trim())
    .filter((mark) => mark.length >= 3)
    .map(
      (mark) =>
        new RegExp(
          `(^|[^\\p{L}\\p{N}])${mark.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}($|[^\\p{L}\\p{N}])`,
          'iu',
        ),
    );
  return (content) => patterns.some((pattern) => pattern.test(content));
}

/**
 * Finds a transfer organization's id or name in a text, whether the job still lists it or only
 * the vault's seal remembers it (the library's copy of the job drops it), so that a request that
 * would carry one is refused before it leaves (invariant 1).
 */
export function transferDetector(
  job: Job,
  sealed: readonly { id: string; name: string }[] = [],
): LeakDetector {
  const listed = (job.organizations ?? []).filter((org) => org.role === 'transfer');
  const marks = [...listed, ...sealed.filter(({ id }) => !listed.some((org) => org.id === id))].map(
    (org) => ({ id: org.id, names: namesAny([org.id, org.name]) }),
  );
  return {
    scan(content) {
      const matchedIds = marks.filter((mark) => mark.names(content)).map((mark) => mark.id);
      return { leaked: matchedIds.length > 0, matchedIds };
    },
  };
}

// The reply

const QuoteReplySchema = z.object({ org: z.string(), file: z.string(), passage: z.string() });
const ClaimReplySchema = z.object({ text: z.string(), quotes: z.array(QuoteReplySchema) });
const SkillReplySchema = ClaimReplySchema.extend({
  taskType: z.string(),
  needs: z.array(z.string()),
  steps: z.array(z.string()),
});

export const StudyReplySchema = z.object({
  skills: z.array(SkillReplySchema),
  connections: z.array(ClaimReplySchema),
  rules: z.array(ClaimReplySchema),
  differences: z.array(ClaimReplySchema),
  questions: z.array(z.string()),
  outOfScope: z.array(z.string()),
});
export type StudyReply = z.infer<typeof StudyReplySchema>;

/** The reply format, as a JSON Schema: every key required, as strict decoding wants. */
export function studyJsonSchema(): JsonSchemaObject {
  const quote = objectOf({
    org: text("The organization's id, as given in its heading."),
    file: text('The file the passage is in, by its name.'),
    passage: text('The words, copied exactly from that file.'),
  });
  const quotes = list(
    `Up to ${STUDY_LIMITS.maxQuotes} passages that show it, each copied word for word. Empty when nothing in the files says it.`,
    quote,
  );
  const claim = objectOf({ text: text('One or two plain sentences.'), quotes });
  return objectOf({
    skills: list(
      'One skill for each task type of the job.',
      objectOf({
        taskType: text('The task type id, exactly as listed.'),
        text: text('What the skill is, in one plain sentence.'),
        needs: list("The files the skill reads, by their names in an organization's folder."),
        steps: list(
          `Up to ${STUDY_LIMITS.maxSteps} steps, the same for every organization. Say which file to read for what, never what a file says: no numbers, labels or organization names.`,
        ),
        quotes,
      }),
    ),
    connections: list('How the skills connect, such as one that uses another.', claim),
    rules: list('The rules the material states, such as a policy.', claim),
    differences: list('Where the organizations differ, each with a passage from each.', claim),
    questions: list('What the material leaves unclear, as short plain questions.'),
    outOfScope: list('What the job does not cover, as short plain statements.'),
  });
}

// Checking the reply

type Checked = { ok: true; brief: StudyBrief } | { ok: false; problems: string[] };

/**
 * The brief a reply makes, or what is wrong with it. Every passage is looked for word for word in
 * the file of the organization it names; one that isn't there is taken out and counted, and a
 * claim left with none is marked as the teacher's own. A skill per task type, files that exist,
 * and steps that hold no organization's facts are required, and their absence goes back to the
 * teacher once.
 */
export function checkStudy(json: unknown, job: Job, material: readonly OrgMaterial[]): Checked {
  const parsed = StudyReplySchema.safeParse(json);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return {
      ok: false,
      problems: [
        `The reply doesn't follow the schema${issue === undefined ? '' : ` at ${issue.path.join('.')}: ${issue.message}`}.`,
      ],
    };
  }
  const reply = parsed.data;
  const problems: string[] = [];
  let dropped = 0;

  // Each file of each organization, made ready to find a passage in, by the folded names.
  const files = new Map<string, Map<string, (passage: string) => boolean>>();
  for (const { org, attached } of material) {
    files.set(
      foldKey(org.id),
      new Map(
        attached.files.map((file) => [
          foldKey(file.name),
          quotesFrom(file.text ?? file.bytes.toString('utf8')),
        ]),
      ),
    );
  }
  const orgOf = (named: string): Organization | undefined =>
    material.find(
      ({ org }) => foldKey(org.id) === foldKey(named) || foldKey(org.name) === foldKey(named),
    )?.org;
  const fileNames = new Map(
    material.flatMap(({ attached }) =>
      attached.files.map((file) => [foldKey(file.name), file.name] as const),
    ),
  );

  const verified = (quotes: StudyReply['skills'][number]['quotes']): StudyQuote[] => {
    const kept: StudyQuote[] = [];
    for (const quote of quotes.slice(0, STUDY_LIMITS.maxQuotes)) {
      const passage = cleanText(quote.passage);
      const org = orgOf(quote.org);
      const found =
        org !== undefined &&
        passage.length <= STUDY_LIMITS.maxPassageChars &&
        files.get(foldKey(org.id))?.get(foldKey(quote.file))?.(passage) === true;
      if (!found || org === undefined) {
        dropped += 1;
        continue;
      }
      kept.push({ org: org.id, file: fileNames.get(foldKey(quote.file)) ?? quote.file, passage });
    }
    dropped += Math.max(0, quotes.length - STUDY_LIMITS.maxQuotes);
    return kept;
  };
  const claims = (items: StudyReply['rules'], what: string): StudyClaim[] => {
    if (items.length > STUDY_LIMITS.maxItems) {
      problems.push(`List at most ${STUDY_LIMITS.maxItems} ${what}.`);
    }
    return items.flatMap((item) => {
      const said = cleanText(item.text);
      if (said === '') return [];
      if (said.length > STUDY_LIMITS.maxTextChars) {
        problems.push(
          `Say each of the ${what} in at most ${STUDY_LIMITS.maxTextChars} characters.`,
        );
      }
      const quotes = verified(item.quotes);
      return [{ text: said, quotes, own: quotes.length === 0 }];
    });
  };

  // The steps are the harness's shared procedure, so they hold no organization's facts.
  const namesOrg = namesAny(material.flatMap(({ org }) => [org.id, org.name]));
  const types = new Map(job.taskTypes.map((type) => [foldKey(type.id), type]));
  const seen = new Set<string>();
  const skills = reply.skills.flatMap((skill) => {
    const type = types.get(foldKey(skill.taskType));
    if (type === undefined) {
      problems.push(`"${skill.taskType}" is not a task type of this job.`);
      return [];
    }
    if (seen.has(type.id)) {
      problems.push(`The task type "${type.id}" has two skills. Give it one.`);
      return [];
    }
    seen.add(type.id);
    const needs = skill.needs.map((need) => {
      const name = fileNames.get(foldKey(need.replace(/^data\//, '')));
      if (name === undefined) {
        problems.push(`The skill "${type.id}" needs "${need}", which no organization has.`);
      }
      return name ?? need;
    });
    const steps = skill.steps.map(cleanText).filter((step) => step !== '');
    if (steps.length === 0 || steps.length > STUDY_LIMITS.maxSteps) {
      problems.push(`Give the skill "${type.id}" 1 to ${STUDY_LIMITS.maxSteps} steps.`);
    }
    for (const step of steps) {
      if (/\d/.test(step) || namesOrg(step)) {
        problems.push(
          `A step of "${type.id}" holds an organization's facts ("${step.slice(0, 80)}"). Steps are shared by every organization: say which file to read, never a number, label or name from it.`,
        );
      }
    }
    const quotes = verified(skill.quotes);
    return [
      {
        taskType: type.id,
        label: type.label,
        text: cleanText(skill.text) || type.label,
        needs: [...new Set(needs)],
        steps,
        quotes,
        own: quotes.length === 0,
      },
    ];
  });
  const missing = job.taskTypes.filter((type) => !seen.has(type.id));
  if (missing.length > 0) {
    problems.push(
      `Give every task type a skill. Missing: ${missing.map((type) => type.id).join(', ')}.`,
    );
  }
  const plainList = (items: readonly string[]): string[] =>
    items
      .map(cleanText)
      .filter((item) => item !== '')
      .slice(0, STUDY_LIMITS.maxItems);

  const brief: StudyBrief = {
    organizations: material.map(({ org }) => ({ id: org.id, name: org.name })),
    skills,
    connections: claims(reply.connections, 'connections'),
    rules: claims(reply.rules, 'rules'),
    differences: claims(reply.differences, 'differences'),
    questions: plainList(reply.questions),
    outOfScope: plainList(reply.outOfScope),
    dropped,
  };
  return problems.length > 0 ? { ok: false, problems } : { ok: true, brief };
}

// What the brief seeds

/** Where the shared procedure goes in a harness. */
export const PROCEDURE_PATH = 'skills/procedure/SKILL.md';

/**
 * The shared procedure a confirmed brief seeds the first harness with: for each skill, the files
 * to read and the steps. It holds no organization's facts, which stay in each one's files: the
 * agent reads the files of the organization it is working for, in `data/`.
 */
export function procedureEdit(brief: StudyBrief): FileEdit {
  const skills = brief.skills.map((skill) =>
    [
      `## ${skill.label} (${skill.taskType})`,
      ...(skill.needs.length > 0
        ? [`Read: ${skill.needs.map((name) => `data/${name}`).join(', ')}`]
        : []),
      ...skill.steps.map((step, at) => `${at + 1}. ${step}`),
    ].join('\n'),
  );
  const content = [
    '---',
    'name: procedure',
    "description: How to work any request from the organization's own files.",
    '---',
    "The files in data/ belong to the organization the request is about. Its labels, policy numbers, hints and videos are in them, and they differ from one organization to the next. Read them for every request, and never answer from what another organization's files said.",
    '',
    skills.join('\n\n'),
    '',
  ].join('\n');
  return { op: 'write', path: PROCEDURE_PATH, content };
}

// Where the study stands

/**
 * What a confirmation names: the material as it was studied, and the brief, read through their
 * schema so that a brief hashes the same just made as read back from its file.
 */
export function studyToken(record: StudyRecord): string {
  const { files, brief } = StudyRecordSchema.parse(record);
  return createHash('sha256').update(JSON.stringify({ files, brief })).digest('hex').slice(0, 16);
}

/** Whether two lists of files are the same files with the same bytes. */
function sameFiles(a: StudyRecord['files'], b: StudyRecord['files']): boolean {
  const key = (file: StudyRecord['files'][number]) => `${file.org}/${file.name}:${file.sha256}`;
  const left = a.map(key).sort();
  const right = b.map(key).sort();
  return left.length === right.length && left.every((item, at) => item === right[at]);
}

/** Where a job's study stands, from what was studied and the material as it is now. */
export function studyStateOf(record: StudyRecord | null, now: StudyRecord['files']): StudyState {
  if (record === null) return { state: 'unstudied', token: '' };
  if (!sameFiles(record.files, now)) {
    return {
      state: 'changed',
      token: '',
      brief: record.brief,
      problem: "The organizations' files changed since they were studied. Study them again.",
    };
  }
  const token = studyToken(record);
  return record.confirmedAt === undefined
    ? { state: 'needed', token, brief: record.brief }
    : { state: 'confirmed', token, brief: record.brief, confirmedAt: record.confirmedAt };
}
