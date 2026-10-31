import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { CodedError, GuardError, StudyStateSchema, type Job } from '@architect/shared';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { PROCEDURE_PATH } from '../src/drafting/study';
import { JobStudy } from '../src/drafting/studying';
import { startingHarness } from '../src/loop/setup';
import { payloadText } from '../src/mentor/gate';
import { defaultJob, task } from './fakes/job';
import { draftingWorld, TEACHER, type DraftingWorld } from './support/drafting-world';

/*
 * The study of a field job's material (decision 069), with a scripted teacher: what it is sent,
 * how its brief is held to the files, that a transfer organization never reaches it, the cap, the
 * confirmation that lets training start, and the shared procedure the brief seeds the harness with.
 */

const NORTHSIDE_POLICY = `# Tutoring policy

After a wrong answer, assign 3 practice questions of the same topic, not yet attempted.
Escalate to staff after 4 wrong answers in a row on one topic.
`;
const LAKEVIEW_POLICY = `# How we tutor

After a wrong answer, assign 5 practice questions of the same topic, not yet attempted.
Escalate to staff after 3 wrong answers in a row on one topic.
`;
/** The transfer academy's own words, which must never reach the teacher. */
const HARBOR_POLICY = `# Harbor rules

After a wrong answer, assign 2 practice questions. Marker: quiet-heron-policy.
`;

function questions(prefix: string): string {
  const rows = ['id,topic,difficulty,question'];
  for (let n = 1; n <= 12; n += 1) {
    rows.push(`${prefix}-${n},${n % 2 === 0 ? 'Linear equations' : 'Ratios'},${(n % 3) + 1},Q${n}`);
  }
  return `${rows.join('\n')}\n`;
}

function academyJob(): Job {
  return defaultJob({
    id: 'tutor',
    name: 'Tutor',
    description: 'Help a student right after a wrong answer, from the academy files.',
    taskTypes: [
      { id: 'diagnose', label: 'Diagnose' },
      { id: 'assign', label: 'Assign practice' },
    ],
    mentor: TEACHER,
    startingHarness: { kind: 'blank' },
    organizations: [
      { id: 'northside', name: 'Northside Prep', synthetic: true, role: 'train' },
      { id: 'lakeview', name: 'Lakeview Tutors', synthetic: true, role: 'train' },
      { id: 'harbor', name: 'Harbor Learning', synthetic: true, role: 'transfer' },
    ],
  });
}

/** A reply as the teacher fills it, with one passage that is in no file. */
function brief(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    skills: [
      {
        taskType: 'diagnose',
        text: 'Name the topic and the right choice of a missed question.',
        needs: ['questions.csv'],
        steps: ['Find the question in questions.csv by its id.', 'Read its topic label there.'],
        quotes: [{ org: 'northside', file: 'questions.csv', passage: 'id,topic,difficulty' }],
      },
      {
        taskType: 'assign',
        text: 'Set follow-up practice of the same topic.',
        needs: ['policy.md', 'questions.csv'],
        steps: [
          'Read in policy.md how many practice questions to assign.',
          'Pick that many questions of the same topic from questions.csv.',
        ],
        quotes: [],
      },
    ],
    connections: [{ text: 'A tutoring turn diagnoses first, then assigns practice.', quotes: [] }],
    rules: [
      {
        text: 'Practice is of the same topic and not yet attempted.',
        quotes: [
          {
            org: 'northside',
            file: 'policy.md',
            passage: 'assign 3 practice questions of the same topic, not yet attempted',
          },
          { org: 'lakeview', file: 'policy.md', passage: 'Practice is always free.' },
        ],
      },
    ],
    differences: [
      {
        text: 'Northside assigns three questions; Lakeview assigns five.',
        quotes: [
          { org: 'northside', file: 'policy.md', passage: 'assign 3 practice questions' },
          { org: 'Lakeview Tutors', file: 'Policy.md', passage: 'assign 5 practice questions' },
        ],
      },
    ],
    questions: ['Does a skipped question count as wrong?'],
    outOfScope: ['Grading essays.'],
    ...overrides,
  };
}

let world: DraftingWorld;
let job: Job;
let study: JobStudy;

function writeOrg(id: string, policy: string): void {
  const dir = world.paths.orgDataDir(job.id, id);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'policy.md'), policy);
  writeFileSync(join(dir, 'questions.csv'), questions(id.slice(0, 2).toUpperCase()));
}

beforeEach(async () => {
  world = draftingWorld();
  job = await world.jobs.save(academyJob());
  writeOrg('northside', NORTHSIDE_POLICY);
  writeOrg('lakeview', LAKEVIEW_POLICY);
  // The worst case: a transfer academy's files in the job's own folder. Study never opens them.
  writeOrg('harbor', HARBOR_POLICY);
  study = new JobStudy({
    jobs: world.jobs,
    paths: world.paths,
    deps: world.deps,
    clock: world.clock,
  });
});

afterEach(() => world.cleanup());

describe('studying a field job', () => {
  it("writes a brief from the train academies' files, each passage found in the file it names", async () => {
    world.mentor.script = () => brief();
    const state = await study.study(job.id);
    expect(StudyStateSchema.parse(state).state).toBe('needed');
    const { brief: made } = state;
    if (made === undefined) throw new Error('Expected a brief.');

    expect(made.organizations).toEqual([
      { id: 'northside', name: 'Northside Prep' },
      { id: 'lakeview', name: 'Lakeview Tutors' },
    ]);
    expect(made.skills.map((skill) => [skill.taskType, skill.label, skill.own])).toEqual([
      ['diagnose', 'Diagnose', false],
      ['assign', 'Assign practice', true],
    ]);
    // A passage in no file is taken out; the one left keeps the claim cited.
    expect(made.rules[0]?.quotes).toEqual([
      {
        org: 'northside',
        file: 'policy.md',
        passage: 'assign 3 practice questions of the same topic, not yet attempted',
      },
    ]);
    expect(made.rules[0]?.own).toBe(false);
    expect(made.dropped).toBe(1);
    // An organization named by its name and a file by another case are still found, in its file.
    expect(made.differences[0]?.quotes.map((quote) => [quote.org, quote.file])).toEqual([
      ['northside', 'policy.md'],
      ['lakeview', 'policy.md'],
    ]);
    // Nothing in the files says how the skills connect: it is the teacher's own reading.
    expect(made.connections[0]?.own).toBe(true);
    expect(made.questions).toEqual(['Does a skipped question count as wrong?']);

    // Kept beside the job: opening it again shows the brief without another call.
    expect(world.mentor.requests).toHaveLength(1);
    expect(await study.study(job.id)).toEqual(state);
    expect(world.mentor.requests).toHaveLength(1);
    expect((await world.jobs.studyRecord(job.id))?.cost.calls).toBe(1);
  });

  it("never sends a transfer academy's name or files to the teacher", async () => {
    world.mentor.script = () => brief();
    await study.study(job.id);
    const sent = world.mentor.requests.map(payloadText).join('\n');
    expect(sent).toContain('Northside Prep');
    expect(sent).toContain('assign 5 practice questions');
    expect(sent).not.toMatch(/harbor/i);
    expect(sent).not.toContain('quiet-heron-policy');
    expect(sent).not.toContain('assign 2 practice questions');
  });

  it("refuses to study, with no call, when a train academy's files name a transfer academy", async () => {
    writeOrg('lakeview', `${LAKEVIEW_POLICY}\nWe share staff with Harbor Learning.\n`);
    world.mentor.script = () => brief();
    const error = await study.study(job.id).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(GuardError);
    expect((error as GuardError).guard).toBe('split');
    expect(world.mentor.requests).toHaveLength(0);
  });

  it("refuses, with no call, a mention of a transfer academy that only the vault's seal remembers", async () => {
    // As an import leaves it: the library's job lists no transfer academy, the vault's seal does.
    const kept = {
      ...job,
      organizations: job.organizations?.filter((org) => org.role === 'train'),
    };
    const harbor = job.organizations?.find((org) => org.id === 'harbor');
    if (harbor === undefined) throw new Error('Expected the transfer academy.');
    world.vault.seal(
      job.id,
      [{ ...task('test', 'assign', 1), org: 'harbor' }],
      [],
      [],
      [{ org: harbor, files: [{ name: 'policy.md', content: Buffer.from(HARBOR_POLICY) }] }],
    );
    await world.jobs.save(kept as Job);
    writeOrg(
      'lakeview',
      `${LAKEVIEW_POLICY}
We share staff with Harbor Learning.
`,
    );
    world.mentor.script = () => brief();
    const error = await study.study(job.id).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(GuardError);
    expect((error as GuardError).message).toMatch(/kept for the final test/);
    expect(world.mentor.requests).toHaveLength(0);
  });

  it('sends a brief back once when a step holds an academy fact or a task type has no skill', async () => {
    const [diagnose] = brief()['skills'] as object[];
    world.mentor.script = (_request, call) =>
      call === 1
        ? brief({
            skills: [
              {
                ...diagnose,
                needs: ['grades.csv'],
                steps: ['Northside Prep labels it ALG-3.'],
              },
              { taskType: 'tutor', text: 'x', needs: [], steps: ['Read it.'], quotes: [] },
            ],
          })
        : brief();
    const state = await study.study(job.id);
    expect(state.state).toBe('needed');
    expect(world.mentor.requests).toHaveLength(2);
    const fix = world.mentor.requests[1]?.messages.at(-1)?.content ?? '';
    expect(fix).toContain('holds an organization');
    expect(fix).toContain('"tutor" is not a task type');
    expect(fix).toContain('no organization has');
    expect(fix).toContain('Missing: assign');
  });

  it('stops after a second brief that still cannot be used, and keeps nothing', async () => {
    world.mentor.script = () => brief({ skills: [] });
    await expect(study.study(job.id)).rejects.toThrow("The study couldn't be used");
    expect(world.mentor.requests).toHaveLength(2);
    expect(await world.jobs.studyRecord(job.id)).toBeNull();
    expect((await world.jobs.studyState(job.id))?.state).toBe('unstudied');
  });

  it('keeps under its cap: a call that could cost more never starts', async () => {
    const capped = new JobStudy({
      jobs: world.jobs,
      paths: world.paths,
      deps: world.deps,
      clock: world.clock,
      capUsd: 0.0001,
    });
    world.mentor.script = () => brief();
    const error = await capped.study(job.id).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(GuardError);
    expect((error as GuardError).guard).toBe('budget');
    expect(world.mentor.requests).toHaveLength(0);
  });
});

describe('confirming a brief', () => {
  it('lets training start only once the person confirms the brief they read', async () => {
    await expect(world.jobs.requireConfirmedRules(job)).rejects.toMatchObject({
      code: 'study_unconfirmed',
    });
    world.mentor.script = () => brief();
    const state = await study.study(job.id);
    await expect(world.jobs.requireConfirmedRules(job)).rejects.toBeInstanceOf(CodedError);

    await expect(world.jobs.confirmStudy(job.id, 'not-the-token')).rejects.toMatchObject({
      code: 'study_unconfirmed',
    });
    const confirmed = await world.jobs.confirmStudy(job.id, state.token);
    expect(confirmed.state).toBe('confirmed');
    expect(confirmed.confirmedAt).toBeDefined();
    await expect(world.jobs.requireConfirmedRules(job)).resolves.toBeUndefined();
    expect((await world.jobs.taskPlan(job.id)).study?.state).toBe('confirmed');

    // A file that changes after the study asks for the study again; a transfer one changes nothing.
    writeOrg('harbor', `${HARBOR_POLICY}\nMore.\n`);
    expect((await world.jobs.studyState(job.id))?.state).toBe('confirmed');
    writeOrg('lakeview', `${LAKEVIEW_POLICY}\nNew rule.\n`);
    expect((await world.jobs.studyState(job.id))?.state).toBe('changed');
    await expect(world.jobs.requireConfirmedRules(job)).rejects.toMatchObject({
      code: 'study_unconfirmed',
    });
  });

  it('seeds the first harness with the shared procedure, holding no academy facts', async () => {
    world.mentor.script = () => brief();
    const state = await study.study(job.id);
    const jobDir = world.paths.jobDir(job.id);
    const before = await startingHarness(job, jobDir, world.deps.harness);
    expect(before.skills).toEqual([]);

    await world.jobs.confirmStudy(job.id, state.token);
    const after = await startingHarness(job, jobDir, world.deps.harness);
    expect(after.skills.map((skill) => skill.name)).toEqual(['procedure']);
    const files = world.deps.harness.harnessToFiles(after);
    const procedure = files[PROCEDURE_PATH] ?? '';
    expect(procedure).toContain('## Assign practice (assign)');
    expect(procedure).toContain('Read: data/policy.md, data/questions.csv');
    expect(procedure).toContain('1. Read in policy.md how many practice questions to assign.');
    expect(procedure).not.toMatch(/Northside|Lakeview|Harbor/);
    expect(procedure).not.toMatch(/assign [0-9]/);
  });

  it('leaves a job without organizations as it was', async () => {
    const plain = await world.jobs.save(defaultJob({ id: 'desk', mentor: TEACHER }));
    expect(await world.jobs.studyState(plain.id)).toBeNull();
    await expect(study.study(plain.id)).rejects.toThrow('lists no organizations');
  });
});
