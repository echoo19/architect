import type { GraduateManifest, WorkspaceMessage } from '@architect/shared';
import { describe, expect, it } from 'vitest';
import {
  cellText,
  currentStep,
  inSentence,
  nextWriteMode,
  suggestionsFor,
  taskTypeLabel,
  workedLabel,
} from '../../../src/renderer/src/workspace/labels';

const message = (patch: Partial<WorkspaceMessage>): WorkspaceMessage => ({
  id: 'msg_1',
  chatId: 'cht_1',
  role: 'agent',
  createdAt: '2026-10-27T15:00:00.000Z',
  text: '',
  steps: [],
  blocks: [],
  status: 'done',
  ...patch,
});

const step = (id: string, status: 'running' | 'done', ms?: number) => ({
  id,
  kind: 'tool' as const,
  name: 'read_table',
  detail: `${id}.csv`,
  status,
  ...(ms === undefined ? {} : { ms }),
});

describe('workspace labels', () => {
  it('cycles the write modes in the composer order', () => {
    expect(nextWriteMode('ask')).toBe('allow');
    expect(nextWriteMode('allow')).toBe('never');
    expect(nextWriteMode('never')).toBe('ask');
  });

  it('says how long the agent worked', () => {
    expect(workedLabel(message({ workedMs: 3200 }))).toBe('Worked for 3s');
    expect(workedLabel(message({ workedMs: 200 }))).toBe('Worked for 1s');
    expect(workedLabel(message({ workedMs: 72_000 }))).toBe('Worked for 1m 12s');
    expect(workedLabel(message({ workedMs: 120_000 }))).toBe('Worked for 2m');
    expect(workedLabel(message({ steps: [step('a', 'done', 900), step('b', 'done', 1300)] }))).toBe(
      'Worked for 2s',
    );
    expect(workedLabel(message({ steps: [step('a', 'done'), step('b', 'done')] }))).toBe('2 steps');
  });

  it('names the running step, else the latest', () => {
    expect(currentStep([step('a', 'done'), step('b', 'running')])?.id).toBe('b');
    expect(currentStep([step('a', 'done'), step('b', 'done')])?.id).toBe('b');
    expect(currentStep([])).toBeUndefined();
  });

  it('puts labels mid-sentence without breaking acronyms', () => {
    expect(inSentence('Overdue balances')).toBe('overdue balances');
    expect(inSentence('VAT returns')).toBe('VAT returns');
    expect(inSentence('Refunds')).toBe('refunds');
  });

  it('writes table cells for people', () => {
    expect([cellText(null), cellText(true), cellText(false), cellText(48620)]).toEqual([
      '',
      'Yes',
      'No',
      '48620',
    ]);
  });

  it('suggests the task types the agent handles, and names refused ones', () => {
    const manifest = {
      test: {
        perType: [
          { type: 'invoice', label: 'Price a finished job', pass: 19, total: 20, refused: false },
          { type: 'refunds', label: 'Refunds', pass: 0, total: 4, refused: true },
          { type: 'overdue', label: 'Who owes us money?', pass: 20, total: 20, refused: false },
          {
            type: 'schedule',
            label: 'Book the next free slot',
            pass: 16,
            total: 20,
            refused: false,
          },
          { type: 'extra', label: 'Fourth', pass: 1, total: 1, refused: false },
        ],
      },
    } as unknown as GraduateManifest;
    expect(suggestionsFor(manifest)).toEqual([
      'Price a finished job',
      'Who owes us money?',
      'Book the next free slot',
    ]);
    expect(taskTypeLabel(manifest, 'refunds')).toBe('Refunds');
    expect(taskTypeLabel(manifest, 'warranty_claims')).toBe('Warranty claims');
  });
});
