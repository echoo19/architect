import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { JobSchema } from '@architect/shared';
import { describe, expect, it } from 'vitest';
import {
  comparisonJob,
  DEFAULT_CONFIG,
  DEFAULT_MODELS,
  modelInputs,
  needsConfirmation,
  paired,
  parseGpuMemory,
  parseProcessMemory,
  project,
  wilson,
  type ComparisonConfig,
} from '../src/comparisons';
import type { SweepAttempt } from '../src/comparisons/records';
import { RETURNS_DESK } from './support/comparison-world';

describe('the 95% Wilson interval', () => {
  // Worked by hand from (p + z²/2n ± z·sqrt(p(1-p)/n + z²/4n²)) / (1 + z²/n), z = 1.959964.
  it.each([
    [48, 60, 0.682182, 0.881715],
    [30, 60, 0.37735, 0.62265],
    [0, 10, 0, 0.277533],
    [10, 10, 0.722467, 1],
    [36, 45, 0.66177, 0.891039],
  ])('gives %i of %i as %f to %f', (pass, total, low, high) => {
    const interval = wilson(pass, total);
    expect(interval?.low).toBeCloseTo(low, 5);
    expect(interval?.high).toBeCloseTo(high, 5);
  });

  it('has no interval for nothing counted, and refuses a count past its total', () => {
    expect(wilson(0, 0)).toBeNull();
    expect(() => wilson(7, 6)).toThrow("7 passes out of 6 can't be counted.");
  });
});

describe('paired counts', () => {
  it('counts scenario by scenario, only scenarios both arms took', () => {
    const a = new Map([
      ['t1', true],
      ['t2', true],
      ['t3', false],
      ['t4', false],
      ['t5', true],
    ]);
    const b = new Map([
      ['t1', true],
      ['t2', false],
      ['t3', true],
      ['t4', false],
      ['t6', true],
    ]);
    expect(paired(a, b)).toEqual({ scenarios: 4, aOnly: 1, bOnly: 1, both: 1, neither: 1 });
    expect(paired(b, a)).toEqual({ scenarios: 4, aOnly: 1, bOnly: 1, both: 1, neither: 1 });
  });
});

/** Fifteen priced calibration attempts at exactly a cent each, 20 s apiece. */
function calibration(usd = 0.01): SweepAttempt[] {
  return Array.from({ length: 15 }, (_, index) => ({
    taskId: `refund-${index}`,
    taskType: 'refund',
    target: 'hosted' as const,
    pass: index % 3 !== 0,
    refused: false,
    latencyMs: 20_000,
    usage: { inputTokens: 30_000, outputTokens: 800 },
    usd,
    seed: 1,
    at: '2026-10-28T12:00:00.000Z',
  }));
}

function config(changes: Partial<ComparisonConfig>): ComparisonConfig {
  return {
    ...DEFAULT_CONFIG,
    arms: [
      'bare',
      'draft',
      'targeted',
      'reference',
      'repeat',
      'fixed',
      'weights-one-shot',
      'weights-targeted',
    ],
    caps: { studentUsd: 15, sparkUsd: 16, computeUsd: 8.1, localMinutes: 0 },
    ...changes,
  };
}

const source = JobSchema.parse(JSON.parse(readFileSync(join(RETURNS_DESK, 'job.json'), 'utf8')));

describe('the projection', () => {
  const planned = (changes: Partial<ComparisonConfig>) => {
    const settings = config(changes);
    const job = comparisonJob(source, settings, DEFAULT_MODELS);
    return project(
      job,
      settings,
      modelInputs(job, settings, calibration(), { attempts: [], reading: null }),
    );
  };

  it('counts each arm at the most its caps allow', () => {
    const arms = Object.fromEntries(planned({}).arms.map((arm) => [arm.arm, arm]));
    // 45 dev and 60 test tasks; a round is 12 train attempts and four dev runs of 45.
    expect(arms['bare']?.hostedAttempts).toBe(105);
    expect(arms['draft']?.hostedAttempts).toBe(150);
    expect(arms['targeted']?.hostedAttempts).toBe(45 + 2 * (12 + 180) + 60);
    expect(arms['repeat']?.hostedAttempts).toBe(180);
    expect(arms['reference']?.sparkAttempts).toBe(60);
    expect(arms['bare']?.studentUsd).toBeCloseTo(1.05, 9);
    expect(arms['targeted']?.studentUsd).toBeCloseTo(4.89, 9);
    // Each training job counts at its whole authorization: 90 minutes at $1.80 an hour.
    expect(arms['weights-targeted']?.computeUsd).toBeCloseTo(5.4, 9);
    // 45 dev attempts six at a time and 60 locked-test attempts one at a time, 20 s apiece.
    expect(arms['bare']?.wallMinutes).toBeCloseTo(((45 / 6 + 60) * 20) / 60, 9);
    // Spark's 60 tasks, one at a time, at the student's measured time.
    expect(arms['reference']?.wallMinutes).toBeCloseTo((60 * 20) / 60, 9);
  });

  it("funds arms in decision 037's order and drops the latest that no longer fits", () => {
    const projection = planned({});
    const funded = projection.arms.filter((arm) => arm.funded).map((arm) => arm.arm);
    expect(funded).toEqual(['bare', 'draft', 'targeted', 'reference', 'repeat']);
    const fixed = projection.arms.find((arm) => arm.arm === 'fixed');
    // Arms 1 to 5 reserve $11.09 of the $15 with the 1.2 headroom; the fixed arm needs $5.87.
    expect(fixed).toMatchObject({ funded: false, blockedBy: 'money' });
    expect(fixed?.reason).toBe(
      "It needs $5.87 of the hosted student's budget, and $3.91 is left after the comparisons before it.",
    );
    const weights = projection.arms.find((arm) => arm.arm === 'weights-one-shot');
    expect(weights).toMatchObject({ funded: false, blockedBy: 'prerequisite' });
    expect(needsConfirmation(projection)).toBe(true);
    expect(projection.funded.studentUsd).toBeCloseTo(1.05 + 1.5 + 4.89 + 1.8, 9);
  });

  it('gives an earlier arm its money first, and a later arm on another budget still runs', () => {
    const projection = planned({
      caps: { studentUsd: 9, sparkUsd: 16, computeUsd: 0, localMinutes: 0 },
    });
    const funded = projection.arms.filter((arm) => arm.funded).map((arm) => arm.arm);
    // $8.93 for bare, draft and targeted; the repeat's $2.16 no longer fits, Spark's reference does.
    expect(funded).toEqual(['bare', 'draft', 'targeted', 'reference']);
    expect(projection.arms.find((arm) => arm.arm === 'repeat')?.blockedBy).toBe('money');
  });

  it('waits for no confirmation when only a prerequisite keeps an arm out', () => {
    const projection = planned({
      arms: ['bare', 'draft', 'targeted', 'reference', 'repeat', 'weights-one-shot'],
    });
    expect(projection.arms.find((arm) => arm.arm === 'weights-one-shot')?.blockedBy).toBe(
      'prerequisite',
    );
    expect(needsConfirmation(projection)).toBe(false);
  });

  it('says which inputs were measured and which assumed', () => {
    const settings = config({});
    const job = comparisonJob(source, settings, DEFAULT_MODELS);
    const inputs = modelInputs(job, settings, calibration(), { attempts: [], reading: null });
    expect(inputs.studentUsd).toMatchObject({ value: 0.01, source: 'measured' });
    expect(inputs.studentSeconds).toMatchObject({ value: 20, source: 'measured' });
    expect(inputs.localSeconds.source).toBe('assumed');
    expect(inputs.sparkCallUsd.source).toBe('assumed');
    // Spark's standard price: 40,000 tokens in at $1.25 and 6,000 out at $4.25 a million.
    expect(inputs.sparkCallUsd.value).toBeCloseTo(0.0755, 9);
    const unmeasured = modelInputs(job, settings, [], { attempts: [], reading: null });
    expect(unmeasured.studentUsd).toMatchObject({ value: 0.01, source: 'assumed' });
  });
});

describe('the comparison job', () => {
  it('pins the hosted student to one provider and declares both locked-test seeds', () => {
    const job = comparisonJob(source, config({}), DEFAULT_MODELS);
    expect(job.student.trainOn).toBe('hosted');
    expect(job.student.hosted).toMatchObject({
      model: 'meta/muse-glimmer-30b',
      providers: ['DeepInfra'],
      secretRef: 'openrouter',
    });
    expect(job.mentor).toMatchObject({ model: 'muse-spark-1.3', secretRef: 'meta' });
    // Graduates pin, and local tests run on, the 2-bit build that fits a 12 GB GPU.
    expect(job.student.local).toMatchObject({ runtime: 'ollama', model: 'muse-glimmer:30b-iq2' });
    expect(job.evaluation.lockedTestSeeds).toEqual([101, 102]);
  });
});

describe('the system meter', () => {
  it("reads a server's memory from tasklist and ps, and the GPU's from nvidia-smi", () => {
    const tasklist = [
      '"System","4","Services","0","2,344 K"',
      '"ollama.exe","1200","Console","1","1,024 K"',
      '"ollama.exe","3400","Console","1","8,388,608 K"',
    ].join('\r\n');
    expect(parseProcessMemory(tasklist, 'win32', ['ollama'])).toBe(1024 * (1024 + 8_388_608));
    const ps = ['  2048 /usr/local/bin/llama-server', '   512 /bin/zsh'].join('\n');
    expect(parseProcessMemory(ps, 'darwin', ['llama-server'])).toBe(2048 * 1024);
    expect(parseProcessMemory(ps, 'darwin', ['ollama'])).toBeNull();
    expect(parseGpuMemory('11264\n')).toBe(11264 * 1024 * 1024);
    expect(parseGpuMemory('')).toBeNull();
  });
});
