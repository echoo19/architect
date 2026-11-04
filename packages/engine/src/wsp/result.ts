import type {
  WspArm,
  WspComparison,
  WspExperiment,
  WspMeasurement,
  WspResult,
  WspSplit,
} from '@architect/shared';
import { compare, gain } from './metrics';

/*
 * What an Architect WSP experiment showed (decision 109), from its stored measurements only:
 * the frozen candidate against the base and each control, on dev once the run ends and on the
 * sealed examples once it is qualified. "Improved" needs the brief's least gain over the base
 * with the interval clear of zero on the gaining side, and no control at least as good.
 */

const ARM_WORDS: Record<WspArm, string> = {
  base: 'the base',
  decoding: 'the decoding control',
  instructions: 'the instruction control',
  candidate: 'the candidate',
};

const NOT_RUN = [
  {
    arm: 'Fine-tuning (QLoRA)',
    reason:
      "Fine-tuning learns from a field's verified lessons, and this experiment has prompts and checks rather than lessons. Compare the two in Experiments on a field.",
  },
];

const DEPLOYMENT = {
  status: 'not-verified' as const,
  reason:
    "Measured on the evaluator: transformers on this computer's CPU, in full precision. No GGUF or quantized build of the candidate was made and checked on a local runtime, so it isn't a local agent yet.",
};

function find(experiment: WspExperiment, arm: WspArm, split: WspSplit, candidateId?: string): WspMeasurement | undefined {
  return experiment.measurements.find(
    (item) => item.arm === arm && item.split === split && (arm !== 'candidate' || item.candidateId === candidateId),
  );
}

function signed(value: number): string {
  return `${value >= 0 ? '+' : '−'}${Math.abs(value).toFixed(1)}`;
}

export function wspResult(experiment: WspExperiment, split: 'dev' | 'qualification'): WspResult {
  const brief = experiment.brief!;
  const metric = brief.target.metric;
  const notRun = [
    ...NOT_RUN,
    ...(brief.controls.instructions === null
      ? [{ arm: 'Instruction control', reason: 'The brief proposed no system instruction to compare with.' }]
      : []),
  ];
  const where = split === 'dev' ? 'on dev' : 'on the sealed examples';
  const candidateId = experiment.frozen?.candidateId ?? null;
  if (candidateId === null) {
    const tried = experiment.iterations.filter((item) => item.outcome === 'edit').length;
    return {
      verdict: 'no-candidate',
      summary:
        tried === 0
          ? 'No program made an edit the runner accepted, so there is no candidate.'
          : tried === 1
            ? "The one candidate didn't gain over the base on dev, so it wasn't kept."
            : `None of the ${tried} candidates gained over the base on dev, so none was kept.`,
      candidateId: null,
      comparisons: [],
      regressions: [],
      notRun,
      deployment: DEPLOYMENT,
    };
  }
  const candidate = find(experiment, 'candidate', split, candidateId);
  const comparisons: WspComparison[] = [];
  for (const arm of ['base', 'decoding', 'instructions'] as const) {
    const other = find(experiment, arm, split);
    if (candidate === undefined || other === undefined) continue;
    for (const kind of ['pass_rate', 'loop_rate'] as const) {
      const item = compare(candidate, other, kind);
      if (item !== null) comparisons.push(item);
    }
  }
  const target = (arm: WspArm) => comparisons.find((item) => item.against === arm && item.metric === metric);
  const overBase = target('base');
  const regressions: string[] = [];
  const other = metric === 'pass_rate' ? 'loop_rate' : 'pass_rate';
  const sideways = comparisons.find((item) => item.against === 'base' && item.metric === other);
  if (sideways !== undefined && gain(other, sideways.points) < -10) {
    regressions.push(
      `${other === 'pass_rate' ? 'Pass rate' : 'Loop rate'} ${signed(sideways.points)} points against the base ${where}.`,
    );
  }
  if (candidate !== undefined) {
    const base = find(experiment, 'base', split);
    const lost = base?.outcomes.filter((outcome, index) => outcome.passed === true && candidate.outcomes[index]?.passed === false).length ?? 0;
    if (lost > 0) regressions.push(`${lost} ${lost === 1 ? 'example' : 'examples'} the base passed ${where} now fail.`);
  }
  if (overBase === undefined) {
    return {
      verdict: 'not-established',
      summary: `The candidate has no ${metric === 'pass_rate' ? 'pass rate' : 'loop rate'} ${where} to compare with the base's.`,
      candidateId,
      comparisons,
      regressions,
      notRun,
      deployment: DEPLOYMENT,
    };
  }
  const gained = gain(metric, overBase.points);
  const clear = metric === 'pass_rate' ? overBase.low > 0 : overBase.high < 0;
  const wrong = metric === 'pass_rate' ? overBase.high < 0 : overBase.low > 0;
  const controls = (['decoding', 'instructions'] as const)
    .map((arm) => target(arm))
    .filter((item): item is WspComparison => item !== undefined);
  const beaten = controls.find((item) => gain(metric, item.points) <= 0);
  const name = metric === 'pass_rate' ? 'pass rate' : 'loop rate';
  const verdict = wrong ? 'regressed' : clear && gained >= brief.target.minPoints && beaten === undefined ? 'improved' : 'not-established';
  const lead = `The candidate's ${name} is ${signed(overBase.points)} points against the base ${where} (95% interval ${signed(overBase.low)} to ${signed(overBase.high)}, ${overBase.n} examples)`;
  const tail =
    verdict === 'improved'
      ? ', past the brief\'s target, and ahead of every control.'
      : verdict === 'regressed'
        ? ', worse than the base.'
        : beaten !== undefined
          ? `, and ${ARM_WORDS[beaten.against]} does at least as well, so the edit isn't shown to be what helped.`
          : gained < brief.target.minPoints
            ? `, short of the brief's ${brief.target.minPoints}-point target.`
            : ', but the interval reaches zero, so the gain is not established.';
  return {
    verdict,
    summary: `${lead}${tail}`,
    candidateId,
    comparisons,
    regressions,
    notRun,
    deployment: DEPLOYMENT,
  };
}

