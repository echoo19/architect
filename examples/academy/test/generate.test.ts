import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, relative, sep } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ACADEMY_SEEDS, buildAcademy, buildJobFiles, generateJob, jobDir } from '../src';
import { LETTERS } from '../src/academy/build';
import { COLUMNS } from '../src/academy/files';
import { csvColumns } from '../src/lib/csv';
import { errorsBehind, readPolicy } from '../src/reference/rules';
import { SKILLS } from '../src/tasks/build';
import { job, paramsOf } from './helpers';

async function filesUnder(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { recursive: true, withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile())
    .map((entry) => relative(dir, join(entry.parentPath, entry.name)).split(sep).join('/'))
    .sort();
}

const generated = buildJobFiles();
const academies = generated.academies;

describe('generating the job', () => {
  it('gives identical bytes for the same seeds', () => {
    const again = buildJobFiles();
    expect([...again.files.keys()]).toEqual([...generated.files.keys()]);
    for (const [path, text] of generated.files) expect(again.files.get(path), path).toBe(text);
  });

  it('matches the committed job folder byte for byte', async () => {
    const outDir = await mkdtemp(join(tmpdir(), 'academy-'));
    try {
      await generateJob(outDir);
      const written = await filesUnder(outDir);
      expect(await filesUnder(jobDir)).toEqual(written);
      for (const path of written) {
        const fresh = await readFile(join(outDir, path), 'utf8');
        expect(await readFile(join(jobDir, path), 'utf8'), path).toBe(fresh);
      }
    } finally {
      await rm(outDir, { recursive: true, force: true });
    }
  });

  it('builds another academy from another seed', () => {
    const other = buildAcademy(7);
    expect(other.tasks).toHaveLength(48);
    expect(other.files.get('questions.csv')).not.toBe(academies[0]!.files.get('questions.csv'));
  });
});

describe('the organizations', () => {
  const organizations = job.job().organizations ?? [];

  it('are three train academies and one transfer academy, all synthetic', () => {
    expect(organizations.map((org) => org.role)).toEqual(ACADEMY_SEEDS.map((s) => s.role));
    expect(organizations.filter((org) => org.role === 'transfer')).toHaveLength(1);
    expect(organizations.every((org) => org.synthetic)).toBe(true);
    expect(new Set(organizations.map((org) => org.id)).size).toBe(4);
    expect(new Set(organizations.map((org) => org.name)).size).toBe(4);
  });

  it('each have the same files, in the documented columns', async () => {
    for (const org of organizations) {
      expect((await filesUnder(job.dataDir(org.id))).sort(), org.id).toEqual(
        ['policy.md', ...Object.keys(COLUMNS)].sort(),
      );
      for (const [name, columns] of Object.entries(COLUMNS)) {
        expect(csvColumns(job.file(`orgs/${org.id}/data/${name}`)), `${org.id} ${name}`).toEqual(
          columns,
        );
      }
    }
    expect(
      job
        .job()
        .data.files.map((file) => file.name)
        .sort(),
    ).toEqual(['policy.md', ...Object.keys(COLUMNS)].sort());
  });

  it('differ in topic labels, ids, video folders and policy numbers', () => {
    for (const [i, a] of academies.entries()) {
      for (const b of academies.slice(i + 1)) {
        const pair = `${a.organization.id} and ${b.organization.id}`;
        expect(
          a.academy.topics.map((t) => t.label),
          pair,
        ).not.toEqual(b.academy.topics.map((t) => t.label));
        expect(
          a.academy.topics.map((t) => t.folder),
          pair,
        ).not.toEqual(b.academy.topics.map((t) => t.folder));
        const errorIds = (g: typeof a) => g.academy.errors.map((e) => `${e.error_id} ${e.name}`);
        expect(errorIds(a), pair).not.toEqual(errorIds(b));
        expect(a.academy.style.policy, pair).not.toEqual(b.academy.style.policy);
      }
    }
    const policies = academies.map((a) => a.academy.style.policy);
    expect(new Set(policies.map((p) => p.practiceCount)).size).toBe(4);
    expect(new Set(policies.map((p) => `${p.escalateWrong} in ${p.escalateDays}`)).size).toBe(4);
  });

  it('state their policy numbers in policy.md, where the reference reads them', () => {
    for (const { academy, files } of academies) {
      expect(readPolicy(files.get('policy.md')!), academy.style.id).toEqual(academy.style.policy);
    }
  });
});

describe('the academy files', () => {
  it('name, for every wrong choice in a bank, an error the reference finds from the text alone', () => {
    for (const { academy } of academies) {
      for (const question of academy.questions) {
        const row = Object.fromEntries([
          ['question_id', question.question_id],
          ['stem', question.item.stem],
          ...question.item.choices.map((c, i) => [`choice_${'abcd'[i]}`, c]),
          ['correct', LETTERS[question.item.correct]!],
        ] as [string, string][]);
        const errors = academy.errors
          .filter((e) => e.topic === question.topic)
          .map((e) => ({ error_id: e.error_id, name: e.name }));
        question.item.choices.forEach((_, i) => {
          if (i === question.item.correct) return;
          const built = academy.errors
            .filter((e) => question.item.errors[i]!.includes(e.code))
            .map((e) => e.error_id)
            .sort();
          expect(errorsBehind(row, LETTERS[i]!, errors).sort(), question.question_id).toEqual(
            built,
          );
        });
      }
    }
  });

  it('give every topic one general hint, and tie every other hint to an error of its topic', () => {
    for (const { academy } of academies) {
      for (const topic of academy.topics) {
        const hints = academy.hints.filter((h) => h.topic === topic.label);
        expect(
          hints.filter((h) => h.error_id === ''),
          topic.label,
        ).toHaveLength(1);
        for (const hint of hints.filter((h) => h.error_id !== '')) {
          expect(academy.errors.find((e) => e.error_id === hint.error_id)?.topic).toBe(topic.label);
        }
      }
    }
  });

  it('give every question four different choices, one of them right', () => {
    for (const { academy } of academies) {
      for (const question of academy.questions) {
        expect(new Set(question.item.choices).size, question.question_id).toBe(4);
        expect(question.item.errors.filter((e) => e.length === 0)).toHaveLength(1);
      }
    }
  });
});

describe('the tasks', () => {
  const tasks = job.allTasks();

  it('have ids unique across academies, and families that never cross an academy', () => {
    expect(new Set(tasks.map((task) => task.id)).size).toBe(tasks.length);
    for (const task of tasks) {
      expect(task.id.startsWith(`${task.org}-`), task.id).toBe(true);
      expect(task.family.startsWith(`${task.org}:`), task.id).toBe(true);
    }
  });

  it('give each academy eight tasks of each skill', () => {
    for (const org of job.orgs()) {
      for (const skill of SKILLS) {
        expect(
          tasks.filter((t) => t.org === org && t.type === skill),
          `${org} ${skill}`,
        ).toHaveLength(8);
      }
    }
  });

  it('fill the split of the train academies exactly', () => {
    const { splits } = job.job();
    const train = new Set(
      (job.job().organizations ?? []).filter((o) => o.role === 'train').map((o) => o.id),
    );
    expect(tasks.filter((t) => train.has(t.org!))).toHaveLength(
      splits.calibration + splits.train + splits.dev + splits.test,
    );
  });

  it("ask solve about questions that are not in the academy's bank", () => {
    for (const task of job.tasksOfType('solve')) {
      const stem = (task.meta?.request as { stem: string }).stem;
      const bank = job.table(task.org!, 'questions.csv').map((row) => row.stem);
      expect(bank.includes(stem), task.id).toBe(false);
    }
  });

  it('include diagnoses whose wrong choice two errors produce', () => {
    const sets = job
      .tasksOfType('diagnose')
      .filter((t) => (paramsOf(t).errors as string[]).length > 1);
    expect(sets.length).toBeGreaterThanOrEqual(3);
  });

  it('include a few assignments where fewer questions qualify than the policy asks for', () => {
    const short = [...job.tasksOfType('assign'), ...job.tasksOfType('after_wrong')].filter(
      (t) => Number(paramsOf(t).expected_count) < Number(paramsOf(t).count),
    );
    expect(short.length).toBeGreaterThanOrEqual(2);
    expect(short.length).toBeLessThanOrEqual(8);
  });

  it('open the tutoring turns with the same wrong answer at every academy, acted on differently', () => {
    const first = job
      .orgs()
      .map((org) => job.allTasks().find((t) => t.id === `${org}-after_wrong-01`)!);
    for (const task of first) {
      expect(task.meta?.demo, task.id).toBe('nearer-noun');
      const academy = academies.find((a) => a.organization.id === task.org)!.academy;
      const nearer = academy.errors.find((e) => e.code === 'agreement-nearer-noun')!.error_id;
      expect(paramsOf(task).errors, task.id).toEqual([nearer]);
    }
    // The demo pair: Wrenfield assigns 2 and leaves no note; Lakemont assigns 5 and leaves one.
    const turn = (org: string) => paramsOf(first.find((t) => t.org === org)!);
    expect([turn('wrenfield').expected_count, turn('wrenfield').escalate]).toEqual([2, false]);
    expect([turn('lakemont').expected_count, turn('lakemont').escalate]).toEqual([5, true]);
  });
});
