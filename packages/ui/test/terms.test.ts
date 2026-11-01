import { describe, expect, it } from 'vitest';
import { defineTerm, type LabTerm } from '../src';

const TERMS: LabTerm[] = [
  'harness',
  'baseHarness',
  'engineeredHarness',
  'loraAdapter',
  'heldOutChecks',
  'sealedFinalTest',
  'riskCertificate',
  'regressionSuite',
  'fineTuningPlan',
  'clusterLaunchBundle',
  'onPremise',
];

describe("the Lab's terms", () => {
  it('explains each in one plain sentence', () => {
    for (const term of TERMS) {
      const sentence = defineTerm(term);
      expect(sentence).toMatch(/^[A-Z][^.]*\.$/);
      expect(sentence.split(' ').length).toBeLessThanOrEqual(16);
    }
  });

  it("names the field's own teacher", () => {
    expect(defineTerm('heldOutChecks')).toBe(
      'Tasks Spark never sees, used to keep or roll back each change.',
    );
    expect(defineTerm('heldOutChecks', 'Qwen3 235B')).toContain('Qwen3 235B never sees');
  });
});
