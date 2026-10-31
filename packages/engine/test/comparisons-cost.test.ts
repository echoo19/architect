import {
  costUsd,
  FREE_PRICING,
  mentorPreset,
  STUDENT_PRESETS,
  type TokenPricing,
} from '@architect/shared';
import { afterEach, describe, expect, it } from 'vitest';
import { DEFAULT_CONFIG, DEFAULT_MODELS, runComparison } from '../src/comparisons';
import { perThousandOf } from '../src/comparisons/report';
import { systemClock } from '../src/loop/deps';
import { comparisonWorld, RETURNS_DESK, type ComparisonWorld } from './support/comparison-world';

/*
 * What 1,000 requests cost, on every row of a comparison's final test: one way, from the tokens
 * each attempt recorded, at the listed price of the model that answered, whoever answered.
 */

const worlds: ComparisonWorld[] = [];

afterEach(async () => {
  for (const world of worlds.splice(0)) await world.close();
});

const SPARK = mentorPreset('meta-spark').pricing;
const GLIMMER = (() => {
  const pricing = STUDENT_PRESETS.find((preset) => preset.key === DEFAULT_MODELS.student)?.pricing;
  if (!pricing) throw new Error('The hosted Glimmer preset has no price.');
  return pricing;
})();
/** A dry-run attempt: two calls, 30,000 tokens read and 800 written in all. */
const ATTEMPT = { inputTokens: 30_000, outputTokens: 800 };
const at = (pricing: TokenPricing) => 1000 * costUsd(pricing, ATTEMPT);

describe('cost per 1,000 requests', () => {
  it('prices the tokens each attempt recorded at the model that answered', () => {
    const attempts = [{ usage: ATTEMPT }, { usage: { inputTokens: 10_000, outputTokens: 400 } }];
    const expected = (1000 * (costUsd(SPARK, ATTEMPT) + costUsd(SPARK, attempts[1]!.usage))) / 2;
    expect(perThousandOf(attempts, SPARK)).toBeCloseTo(expected, 9);
    expect(perThousandOf([{ usage: ATTEMPT }], SPARK)).toBeCloseTo(40.9, 9);
    expect(perThousandOf([{ usage: ATTEMPT }], GLIMMER)).toBeCloseTo(at(GLIMMER), 9);
  });

  it('gives no figure when a charge is not recorded in full, never a partial one', () => {
    // An attempt that recorded no usage would make the sum, and the model, look cheaper.
    expect(
      perThousandOf([{ usage: ATTEMPT }, { usage: { inputTokens: 0, outputTokens: 0 } }], SPARK),
    ).toBeNull();
    expect(perThousandOf([{ usage: ATTEMPT }], undefined)).toBeNull();
    expect(perThousandOf([], SPARK)).toBeNull();
    // On this computer nothing is billed, whatever a runtime reported.
    expect(perThousandOf([{ usage: { inputTokens: 0, outputTokens: 0 } }], FREE_PRICING)).toBe(0);
  });

  it("gives Spark's references and the teacher alone one price, and the student its own", async () => {
    const world = comparisonWorld({ clock: systemClock });
    worlds.push(world);
    const { report } = await runComparison(
      {
        jobDir: RETURNS_DESK,
        out: world.out,
        config: {
          ...DEFAULT_CONFIG,
          arms: ['bare', 'reference', 'teacher'],
          caps: { studentUsd: 30, sparkUsd: 10, computeUsd: 0, localMinutes: 0 },
          concurrency: 4,
        },
        models: DEFAULT_MODELS,
        confirm: true,
        planOnly: false,
      },
      world.env,
    );
    const row = (backend: string, arm: string) =>
      report.backends
        .find((table) => table.backend === backend)
        ?.rows.find((item) => item.arm === arm && item.seed === 101);
    // The same model on the same kind of attempt costs the same, however its charges were filed:
    // a reference's go to its own ledger, the teacher's to the student's.
    expect(row('reference', 'reference')?.perThousandUsd).toBeCloseTo(at(SPARK), 6);
    expect(row('teacher', 'teacher')?.perThousandUsd).toBeCloseTo(at(SPARK), 6);
    expect(row('hosted', 'bare')?.perThousandUsd).toBeCloseTo(at(GLIMMER), 6);
    expect(at(SPARK)).toBeGreaterThan(at(GLIMMER));
  }, 180_000);
});
