import { describe, expect, it } from 'vitest';
import {
  AGENT_INTERVENTIONS,
  allowedInterventions,
  contractTerms,
  fileOffLimits,
  HARNESS_SURFACE,
  INTERVENTION_LABELS,
  InterventionTypeSchema,
  interventionsForFile,
  JobContractSchema,
  JobSchema,
  mayIntervene,
  sameContractTerms,
  storedInterventions,
  type InterventionType,
} from '../src';

/** A job file as it was written before the teacher's choice existed. */
const OLD_JOB_FILE = {
  format: 1,
  id: 'job_desk',
  name: 'Service desk',
  description: 'Invoices for a home-services office.',
  createdAt: '2026-10-27T09:00:00.000Z',
  taskTypes: [{ id: 'invoice', label: 'Invoices' }],
  data: { files: [{ name: 'invoices.csv', kind: 'table', access: 'write' }] },
  permissions: { writes: 'ask', unseenFiles: 'never' },
  checker: { kind: 'builtin' },
  requirements: { passRate: 0.9 },
  budget: { maxRounds: 4, maxMentorUsd: 1, maxWallMinutes: 60 },
  mentor: { kind: 'coding_agent', agent: 'claude_code', label: 'Mentor' },
  student: {
    label: 'Glimmer',
    local: { runtime: 'ollama', baseUrl: 'http://127.0.0.1:11434', model: 'muse-glimmer:30b' },
  },
  startingHarness: { kind: 'blank' },
  splits: { seed: 1, calibration: 0, train: 1, dev: 1, test: 1 },
  evaluation: { trainBatch: 1, minDevGain: 1, maxTypeRegression: 0 },
};

const ALL: InterventionType[] = ['procedure', 'retrieval', 'helper', 'weights', 'clarification'];

function issueOf(interventions: unknown): string | undefined {
  const parsed = JobSchema.safeParse({ ...OLD_JOB_FILE, interventions });
  return parsed.success ? undefined : parsed.error.issues[0]?.message;
}

describe('what the mentor may change, as a job holds it', () => {
  it('reads a job file from before the choice as allowing every kind', () => {
    const job = JobSchema.parse(OLD_JOB_FILE);
    expect(job.interventions).toBeUndefined();
    expect(allowedInterventions(job)).toEqual(ALL);
    for (const type of ALL) expect(mayIntervene(job, type)).toBe(true);
  });

  it('keeps the menu the mentor chooses from and the kinds a job can list the same five', () => {
    expect(InterventionTypeSchema.options).toEqual(ALL);
    expect(Object.keys(INTERVENTION_LABELS)).toEqual(ALL);
    expect(AGENT_INTERVENTIONS).toEqual(['procedure', 'retrieval', 'helper', 'weights']);
  });

  it('takes any list that keeps a way to change the agent', () => {
    for (const list of [
      ['procedure'],
      ['weights'],
      ['helper', 'clarification'],
      ['weights', 'clarification'],
      ALL,
    ]) {
      expect(JobSchema.parse({ ...OLD_JOB_FILE, interventions: list }).interventions).toEqual(list);
    }
  });

  it('refuses a list with nothing that changes the agent, with the reason', () => {
    const reason =
      'Keep at least one way to change the agent: instructions and steps, what it reads when, small tools or its weights. Questions alone teach nothing.';
    expect(issueOf([])).toBe(reason);
    expect(issueOf(['clarification'])).toBe(reason);
  });

  it('refuses a kind listed twice, and a kind that is not on the menu', () => {
    expect(issueOf(['procedure', 'procedure'])).toBe('List each kind of change once.');
    expect(issueOf(['procedure', 'telepathy'])).toMatch(/Invalid option/);
    expect(issueOf('procedure')).toBeDefined();
  });

  it("allows the kinds in the menu's order, whatever order the file listed them in", () => {
    const job = JobSchema.parse({
      ...OLD_JOB_FILE,
      interventions: ['clarification', 'helper', 'procedure'],
    });
    expect(allowedInterventions(job)).toEqual(['procedure', 'helper', 'clarification']);
    expect(mayIntervene(job, 'helper')).toBe(true);
    expect(mayIntervene(job, 'weights')).toBe(false);
    expect(mayIntervene(job, 'retrieval')).toBe(false);
  });

  it('stores a job that allows everything as it was, and any other choice as a list in order', () => {
    expect(storedInterventions(ALL)).toBeUndefined();
    expect(storedInterventions([...ALL].reverse())).toBeUndefined();
    expect(storedInterventions(new Set<InterventionType>(['weights', 'procedure']))).toEqual([
      'procedure',
      'weights',
    ]);
  });
});

describe('where the choice goes with a job', () => {
  const job = JobSchema.parse(OLD_JOB_FILE);
  const narrowed = JobSchema.parse({ ...OLD_JOB_FILE, interventions: ['procedure'] });

  it('travels in the job, which is what a job file holds', () => {
    const copy = JobSchema.parse(JSON.parse(JSON.stringify(narrowed)));
    expect(copy.interventions).toEqual(['procedure']);
  });

  it('is no part of what a graduate promises, so a contract and its package leave it out', () => {
    expect(contractTerms(narrowed)).toEqual(contractTerms(job));
    expect(JSON.stringify(contractTerms(narrowed))).not.toContain('interventions');
    // Changing it is no new version of the contract.
    const recorded = JobContractSchema.parse({ ...contractTerms(job), version: 2 });
    expect(sameContractTerms(recorded, contractTerms(narrowed))).toBe(true);
    // A package's contract is strict: the choice can't ride along in one by mistake.
    expect(
      JobContractSchema.safeParse({ ...contractTerms(job), version: 1, interventions: ['weights'] })
        .success,
    ).toBe(false);
  });
});

describe('which kinds of change may write a harness file', () => {
  it('gives each file of the harness surface to the kinds that write it, or to none', () => {
    // One path for each pattern of the surface; a new pattern fails this until it is placed here.
    const samples: Record<string, readonly InterventionType[] | null> = {
      'AGENTS.md': ['procedure'],
      'skills/price-a-job/SKILL.md': ['procedure', 'retrieval'],
      'tools/invoice_total.js': ['helper'],
      'tools/invoice_total.json': ['helper'],
      'examples/after-hours.json': ['retrieval'],
      'retrieval.yaml': ['retrieval'],
      'decoding.yaml': null,
      'guardrails.yaml': null,
    };
    expect(HARNESS_SURFACE).toHaveLength(7);
    for (const [path, kinds] of Object.entries(samples)) {
      expect(
        HARNESS_SURFACE.some((pattern) => pattern.test(path)),
        path,
      ).toBe(true);
      expect(interventionsForFile(path), path).toEqual(kinds);
    }
  });

  it('finds the first file a job keeps the mentor from writing', () => {
    const noTools = { interventions: ['procedure', 'retrieval', 'weights'] as InterventionType[] };
    expect(fileOffLimits(['AGENTS.md', 'tools/sum.js', 'tools/sum.json'], noTools)).toEqual({
      path: 'tools/sum.js',
      kinds: ['helper'],
    });
    expect(fileOffLimits(['AGENTS.md', 'skills/a/SKILL.md', 'retrieval.yaml'], noTools)).toBeNull();
    expect(fileOffLimits(['tools/sum.js'], {})).toBeNull();
  });

  it('lets either kind that could write a skill write it', () => {
    const procedureOnly = { interventions: ['procedure'] as InterventionType[] };
    const retrievalOnly = { interventions: ['retrieval'] as InterventionType[] };
    const helperOnly = { interventions: ['helper'] as InterventionType[] };
    expect(fileOffLimits(['skills/a/SKILL.md'], procedureOnly)).toBeNull();
    expect(fileOffLimits(['skills/a/SKILL.md'], retrievalOnly)).toBeNull();
    expect(fileOffLimits(['skills/a/SKILL.md'], helperOnly)).toEqual({
      path: 'skills/a/SKILL.md',
      kinds: ['procedure', 'retrieval'],
    });
  });

  it('leaves decoding and guardrails to every job that lets the mentor change a harness', () => {
    const weightsOnly = { interventions: ['weights'] as InterventionType[] };
    expect(fileOffLimits(['decoding.yaml', 'guardrails.yaml'], weightsOnly)).toBeNull();
  });
});
