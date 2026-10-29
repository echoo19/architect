import type { Intervention, MentoringProgress } from '@architect/shared';
import { describe, expect, it } from 'vitest';
import type { MentoringRecords } from '../../../src/renderer/src/api/mentoring';
import type { QueryState } from '../../../src/renderer/src/api/query';
import {
  answerEffect,
  isOpen,
  questionMissing,
  questionOfRound,
  questionView,
} from '../../../src/renderer/src/flow/train/questions';
import { AT, makeRound } from './factories';

const NAMES = { mentor: 'Spark', student: 'Glimmer' };

function asked(overrides: Partial<Intervention> = {}): Intervention {
  return {
    id: 'itv_1',
    runId: 'run_1',
    round: 2,
    type: 'clarification',
    title: 'Ask about overdue',
    hypothesis: 'Overdue is ambiguous on the due date.',
    findings: [],
    setAside: [],
    edits: [],
    workedExamples: [],
    practicePerFinding: 0,
    question: 'Should an invoice due today count as overdue?',
    predicted: { devDeltaMin: 0, devDeltaMax: 0, rationale: 'It asks, it changes nothing.' },
    estimatedCost: { mentorUsd: 0, computeUsd: 0, minutes: 0 },
    verificationPlan: '',
    parent: { harnessVersion: 1, adapter: null },
    status: 'accepted',
    createdAt: AT,
    ...overrides,
  };
}

const progress: MentoringProgress = {
  runId: 'run_1',
  experiments: { total: 0, kept: 0, reverted: 0, rejected: 0, invalid: 0, stopped: 0 },
  dev: { baseline: null, current: null },
  lessons: { verified: 0, rejected: 0, byKind: {} },
  clarifications: 1,
  spent: {
    mentorUsd: 0,
    mentorInputTokens: 0,
    mentorOutputTokens: 0,
    studentUsd: 0,
    studentInputTokens: 0,
    studentOutputTokens: 0,
    computeUsd: 0,
    computeMinutes: 0,
    examples: 0,
    trainedTokens: 0,
    attempts: 0,
    minutes: 0,
  },
  budget: { maxRounds: 12, maxMentorUsd: 5, maxComputeUsd: 0, maxWallMinutes: 180 },
};

function records(...interventions: Intervention[]): QueryState<MentoringRecords> {
  return {
    status: 'success',
    data: { lessons: [], interventions, experiments: [], progress, categories: [] },
    error: undefined,
    reload: () => undefined,
  };
}

const answer = { text: 'No, only from tomorrow.', changesCriteria: false, at: AT };

describe('the question a round asked', () => {
  it('is the clarification of the round, when the runner took it', () => {
    const round = makeRound(2, { status: 'clarifying' });
    expect(questionOfRound(round, [asked()])).toMatchObject({ id: 'itv_1' });
    expect(questionOfRound(round, [asked({ round: 3 })])).toBeUndefined();
    expect(questionOfRound(round, [asked({ type: 'procedure' })])).toBeUndefined();
    expect(questionOfRound(round, [asked({ status: 'invalid' })])).toBeUndefined();
  });

  it('is open while its round waits and nothing has answered it', () => {
    expect(isOpen(makeRound(2, { status: 'clarifying' }), asked())).toBe(true);
    expect(isOpen(makeRound(2, { status: 'clarifying' }), asked({ answer }))).toBe(false);
    expect(isOpen(makeRound(2, { status: 'decided' }), asked({ answer }))).toBe(false);
  });
});

describe('what the screen shows of the question of a round', () => {
  it('is nothing for a round that asked none, or none yet', () => {
    expect(questionView(null, records())).toBeNull();
    expect(questionView(makeRound(2, { status: 'decided' }), records())).toBeNull();
    expect(questionView(makeRound(2, { status: 'attempting' }), records())).toBeNull();
  });

  it('is the question, once the records hold it', () => {
    const view = questionView(makeRound(2, { status: 'clarifying' }), records(asked()));
    expect(view).toMatchObject({ state: 'ready', intervention: { question: expect.any(String) } });
  });

  it('keeps showing the question after it is answered, so the round can say what became of it', () => {
    const view = questionView(makeRound(2, { status: 'decided' }), records(asked({ answer })));
    expect(view).toMatchObject({ state: 'ready', intervention: { answer: { text: answer.text } } });
  });

  it('is waiting while the records are read again, whatever the old ones held', () => {
    const waiting = makeRound(2, { status: 'clarifying' });
    const again: QueryState<MentoringRecords> = {
      ...records(),
      status: 'loading',
      error: undefined,
    };
    expect(questionView(waiting, again)).toEqual({ state: 'loading' });
    expect(questionView(waiting, again, true)).toEqual({ state: 'loading' });
  });

  it('is waiting for the records to be read once more when they hold no question yet', () => {
    expect(questionView(makeRound(2, { status: 'clarifying' }), records())).toEqual({
      state: 'loading',
    });
  });

  it('says the question is not there once the records were read again for it and still lack it', () => {
    const reload = () => undefined;
    const view = questionView(
      makeRound(2, { status: 'clarifying' }),
      { ...records(), reload },
      true,
    );
    expect(view).toMatchObject({
      state: 'error',
      error: { message: expect.stringContaining("isn't in the records") },
      reload,
    });
  });

  it('shows the question when the records read again hold it', () => {
    const view = questionView(makeRound(2, { status: 'clarifying' }), records(asked()), true);
    expect(view).toMatchObject({ state: 'ready', intervention: { id: 'itv_1' } });
  });

  it('is waiting while the records are read, and says so when they cannot be', () => {
    const waiting = makeRound(2, { status: 'clarifying' });
    const loading: QueryState<MentoringRecords> = {
      status: 'loading',
      data: undefined,
      error: undefined,
      reload: () => undefined,
    };
    expect(questionView(waiting, loading)).toEqual({ state: 'loading' });
    const failed: QueryState<MentoringRecords> = {
      status: 'error',
      data: undefined,
      error: new Error('No.'),
      reload: () => undefined,
    };
    expect(questionView(waiting, failed)).toMatchObject({
      state: 'error',
      error: { message: 'No.' },
    });
  });
});

describe('a question the records read so far do not hold', () => {
  const waiting = makeRound(2, { status: 'clarifying' });

  it('is missing from a round that waits for its answer, when the records lack it', () => {
    expect(questionMissing(waiting, records())).toBe(true);
    expect(questionMissing(waiting, records(asked({ round: 3 })))).toBe(true);
  });

  it('is not missing when the records hold it, or when the round asks nothing', () => {
    expect(questionMissing(waiting, records(asked()))).toBe(false);
    expect(questionMissing(makeRound(2, { status: 'decided' }), records())).toBe(false);
    expect(questionMissing(makeRound(2, { status: 'evaluating' }), records())).toBe(false);
    expect(questionMissing(null, records())).toBe(false);
  });

  it('is not missing while the records are being read or could not be', () => {
    const loading: QueryState<MentoringRecords> = {
      ...records(),
      status: 'loading',
      error: undefined,
    };
    const failed: QueryState<MentoringRecords> = {
      status: 'error',
      data: undefined,
      error: new Error('No.'),
      reload: () => undefined,
    };
    expect(questionMissing(waiting, loading)).toBe(false);
    expect(questionMissing(waiting, failed)).toBe(false);
  });
});

describe('what the mentor did with an answer', () => {
  it('says nothing before there is one', () => {
    expect(answerEffect(asked(), NAMES)).toBeNull();
  });

  it('says it kept it, and shows it from here on, for an ordinary answer', () => {
    expect(answerEffect(asked({ answer }), NAMES)).toBe(
      'Spark kept it as what you meant, and sees it with every round from here on.',
    );
  });

  it('says the run stopped when the answer changes what counts as success', () => {
    const effect = answerEffect(asked({ answer: { ...answer, changesCriteria: true } }), NAMES);
    expect(effect).toContain('this run stopped');
    expect(effect).toContain('Train again on the changed job.');
  });
});
