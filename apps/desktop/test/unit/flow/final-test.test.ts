import { describe, expect, it } from 'vitest';
import { FINAL_TEST_MARKS, finalTestFacts } from '../../../src/renderer/src/flow/define/final-test';
import { makeJob } from './factories';

const onlineCopy = {
  label: 'Glimmer',
  local: {
    runtime: 'ollama',
    baseUrl: 'http://127.0.0.1:11434',
    model: 'muse-glimmer:30b',
    contextLength: 16_384,
  },
  trainOn: 'hosted',
  hosted: {
    runtime: 'openai_compatible',
    baseUrl: 'https://openrouter.ai/api/v1',
    model: 'meta/muse-glimmer-30b',
    secretRef: 'openrouter',
    contextLength: 16_384,
  },
} as const;

describe('where the final test runs', () => {
  const job = makeJob({ student: onlineCopy });

  it('says how long it takes on this computer, and that it is free', () => {
    expect(finalTestFacts(job, 'local')).toBe('About 2.5 hours for 60 tasks · Free');
  });

  it('says how long it takes on the online copy, and about what it costs', () => {
    expect(finalTestFacts(job, 'hosted')).toBe('About 15 minutes for 60 tasks · About $0.20');
  });

  it('names no cost for an online copy that has no price', () => {
    const unpriced = makeJob({
      student: {
        ...onlineCopy,
        hosted: { ...onlineCopy.hosted, baseUrl: 'https://llm.example.com/v1', model: 'copy' },
      },
    });
    expect(finalTestFacts(unpriced, 'hosted')).toBe('About 15 minutes for 60 tasks');
  });

  it('counts a single task as one', () => {
    const one = makeJob({
      student: onlineCopy,
      splits: { seed: 7, calibration: 10, train: 60, dev: 40, test: 1 },
    });
    expect(finalTestFacts(one, 'local')).toBe('About 5 minutes for 1 task · Free');
  });

  it('marks the agent ready when it passes here, and tested online when it passed there', () => {
    expect(FINAL_TEST_MARKS.local).toBe('The agent is marked ready when it passes.');
    expect(FINAL_TEST_MARKS.hosted).toBe(
      'The agent is marked as tested online. You can test it on this computer later.',
    );
  });
});
