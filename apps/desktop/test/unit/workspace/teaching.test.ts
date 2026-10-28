import type { Correction, CorrectionProposal, Improvement } from '@architect/shared';
import { describe, expect, it } from 'vitest';
import { fromBefore, typeChanges } from '../../../src/renderer/src/flow/improve/ImprovementView';
import { phaseView } from '../../../src/renderer/src/flow/train/phase';
import {
  budgetLine,
  canApply,
  canQueue,
  correctionStatus,
  evidenceText,
  flaggedSummary,
  lessonChange,
  proposeFailure,
  runningImprovement,
  shortRequest,
} from '../../../src/renderer/src/workspace/teach/lessons';
import { makeJob, makeRun } from '../flow/factories';

const NAMES = { mentor: 'Spark', student: 'Glimmer' };

function proposal(patch: Partial<CorrectionProposal>): CorrectionProposal {
  return { kind: 'procedure', lesson: 'A lesson.', reason: 'Because.', ...patch };
}

function correction(patch: Partial<Correction>): Correction {
  return {
    id: 'cor_1',
    graduateId: 'grd_1',
    version: 2,
    chatId: 'cht_1',
    messageId: 'msg_1',
    wrong: 'It was wrong.',
    proposal: proposal({ instruction: 'Do it this way.' }),
    status: 'proposed',
    mentorModel: 'muse-spark-1.3',
    costUsd: 0.01,
    sharedAt: '2026-10-28T09:00:00.000Z',
    createdAt: '2026-10-28T09:00:00.000Z',
    updatedAt: '2026-10-28T09:00:00.000Z',
    ...patch,
  };
}

function improvement(patch: Partial<Improvement>): Improvement {
  return {
    runId: 'run_1',
    graduateId: 'grd_1',
    fromVersion: 2,
    status: 'finished',
    corrections: ['cor_1'],
    budget: { maxRounds: 12, maxMentorUsd: 5 },
    spentUsd: 0.6,
    dev: { before: { pass: 37, total: 40 }, after: { pass: 39, total: 40 } },
    perType: [],
    promotion: { allowed: true, reason: 'Accept it, then promote it.' },
    ...patch,
  };
}

describe('a proposed lesson', () => {
  it('says the change it would make for each kind, and whether it can be queued or applied', () => {
    const procedure = proposal({ instruction: 'Ask which day first.' });
    expect(lessonChange(procedure)).toEqual({
      title: 'Adds to its instructions',
      detail: 'Ask which day first.',
    });
    expect(canApply(procedure)).toBe(true);
    expect(canQueue('procedure')).toBe(true);

    const weakness = proposal({ kind: 'weakness' });
    expect(lessonChange(weakness)).toEqual({ title: 'Practice on tasks like this one' });
    expect(canApply(weakness)).toBe(false);
    expect(canQueue('weakness')).toBe(true);

    const ambiguous = proposal({ kind: 'ambiguous', question: 'Today, or month end?' });
    expect(lessonChange(ambiguous)).toEqual({
      title: 'None until you say which you meant',
      detail: 'Today, or month end?',
    });
    expect(canQueue('ambiguous')).toBe(false);
    expect(canQueue('invalid')).toBe(false);
    // A source lesson the mentor gave no instruction can't be applied as one.
    expect(canApply(proposal({ kind: 'source' }))).toBe(false);
  });

  it('carries the files and rows the person named as evidence, or nothing', () => {
    expect(evidenceText([], '  ')).toBeUndefined();
    expect(evidenceText(['invoices.csv', 'payments.csv'], '')).toBe(
      'Files it should have used: data/invoices.csv, data/payments.csv',
    );
    expect(evidenceText([], 'INV-3018,2026-10-02,paid\n')).toBe(
      'Rows it should have used:\nINV-3018,2026-10-02,paid',
    );
  });

  it("says why none could be proposed in the app's words", () => {
    expect(
      proposeFailure(
        "Refused a mentor call: its payload matched 2 locked test tasks, in the person's request.",
        'Spark',
      ),
    ).toEqual({
      text: 'Nothing was sent: this exchange quotes a task from its final test, which Spark must never see.',
      // The same exchange is refused however it is described, so it isn't offered again.
      retry: false,
    });
    const budget =
      'Reading this exchange could cost up to $0.31, more than the $0.25 a correction may.';
    expect(proposeFailure(budget, 'Spark')).toEqual({ text: budget, retry: true });
  });

  it('shortens the request it answered to one line', () => {
    expect(shortRequest('Who still owes us\nmoney?')).toBe('Who still owes us money?');
    expect(shortRequest('x'.repeat(80), 10)).toBe(`${'x'.repeat(9)}…`);
  });
});

describe('the flagged answers', () => {
  it('count what waits for the person and what is queued, and say where each stands', () => {
    const list = [
      correction({ id: 'cor_a', status: 'proposed' }),
      correction({ id: 'cor_b', status: 'queued' }),
      correction({ id: 'cor_c', status: 'queued', runId: 'run_1' }),
      correction({ id: 'cor_d', status: 'used', candidateVersion: 3 }),
      correction({ id: 'cor_e', status: 'discarded' }),
    ];
    expect(flaggedSummary(list)).toBe('1 waiting for you · 2 in the queue');
    expect(flaggedSummary([])).toBeNull();
    expect(list.map((item) => correctionStatus(item, true))).toEqual([
      'Waiting for you',
      'In the queue',
      'Being taught',
      'Taught in version 3',
      'Discarded',
    ]);
    expect(correctionStatus(correction({ status: 'applied', candidateVersion: 4 }), false)).toBe(
      'In version 4',
    );
  });
});

describe('Improve agent', () => {
  it('states its budget from the job, with compute only when it may train', () => {
    expect(budgetLine({ maxRounds: 10, maxMentorUsd: 5, maxWallMinutes: 240 }, 'Spark')).toBe(
      '10 rounds, $5 of Spark and 4 h',
    );
    expect(
      budgetLine(
        { maxRounds: 4, maxMentorUsd: 2.5, maxWallMinutes: 90, maxComputeUsd: 2.7 },
        'Spark',
      ),
    ).toBe('4 rounds, $2.50 of Spark, $2.70 of compute and 1 h 30 min');
  });

  it('finds the improvement still going', () => {
    expect(runningImprovement([])).toBeNull();
    expect(runningImprovement([improvement({ status: 'finished' })])).toBeNull();
    const paused = improvement({ status: 'paused' });
    expect(runningImprovement([paused, improvement({ status: 'finished' })])).toBe(paused);
  });

  it('writes a new version where a training run takes its final test', () => {
    const view = (patch: Parameters<typeof makeRun>[0]) =>
      phaseView(makeRun(patch), NAMES, false, true);
    expect(view({ status: 'testing', phase: 'testing' })).toEqual({
      stage: null,
      motion: 'idle',
      frozen: false,
      text: 'Writing its new version',
    });
    expect(view({ status: 'paused', phase: 'testing' })).toMatchObject({
      stage: null,
      text: 'Paused',
    });
    expect(view({ status: 'finished', phase: 'done', graduateId: 'grd_1' }).text).toBe(
      'Made a new version',
    );
    expect(view({ status: 'finished', phase: 'done' }).text).toBe(
      'No change was kept, so it made no version',
    );
    expect(view({ status: 'stopped', phase: 'done' }).text).toBe('Improving stopped');
    // In its rounds it reads as any run does.
    expect(view({ phase: 'attempting' }).text).toBe('Glimmer is working through practice tasks');
  });

  it("reports what improved and what didn't, per task type, from its own measurements", () => {
    const job = makeJob();
    const result = improvement({
      perType: [
        {
          type: 'overdue',
          before: { type: 'overdue', pass: 11, total: 13 },
          after: { type: 'overdue', pass: 13, total: 13 },
        },
        {
          type: 'invoice',
          before: { type: 'invoice', pass: 13, total: 14 },
          after: { type: 'invoice', pass: 13, total: 14 },
        },
        {
          type: 'scheduling',
          before: { type: 'scheduling', pass: 13, total: 13 },
          after: { type: 'scheduling', pass: 12, total: 13 },
        },
      ],
    });
    const { better, notBetter } = typeChanges(result, job);
    expect(better.map((change) => change.label)).toEqual(['Overdue balances']);
    expect(notBetter.map((change) => change.label)).toEqual(['Invoices', 'Scheduling']);
    expect(fromBefore({ pass: 37, total: 40 }, { pass: 39, total: 40 })).toBe('Up from 93%');
    expect(fromBefore({ pass: 13, total: 13 }, { pass: 12, total: 13 })).toBe('Down from 100%');
    expect(fromBefore({ pass: 13, total: 14 }, { pass: 13, total: 14 })).toBe('Same as before');
  });
});
