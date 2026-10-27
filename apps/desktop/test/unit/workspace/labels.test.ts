import type { GraduateManifest, WorkspaceMessage } from '@architect/shared';
import { describe, expect, it } from 'vitest';
import {
  cellText,
  currentStep,
  inSentence,
  isTotalRow,
  listInSentence,
  previewRows,
  stepWords,
  suggestionsFor,
  taskTypeLabel,
  workedLabel,
  WRITE_MODE_LABELS,
  WRITE_MODE_MEANINGS,
  WRITE_MODES,
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
  it('names and explains every write mode the composer offers', () => {
    expect(WRITE_MODES).toEqual(['ask', 'allow', 'never']);
    for (const mode of WRITE_MODES) {
      expect(WRITE_MODE_LABELS[mode]).not.toBe('');
      expect(WRITE_MODE_MEANINGS[mode]).not.toBe('');
    }
  });

  it('says each step plainly, tools written in training included', () => {
    const step = (name: string, kind: 'tool' | 'skill', status: 'done' | 'running') =>
      ({ id: name, kind, name, detail: 'jobs.csv', status }) as const;
    expect(stepWords(step('read_table', 'tool', 'done'))).toEqual({
      action: 'Read',
      target: 'jobs.csv',
    });
    expect(stepWords(step('price-a-job', 'skill', 'running')).action).toBe('Loading the skill');
    expect(stepWords(step('invoice_total', 'tool', 'done')).action).toBe(
      'Ran the tool invoice_total',
    );
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

  it('spots the row that sums a table', () => {
    expect(isTotalRow(['Total', '$486.20'])).toBe(true);
    expect(isTotalRow([' grand total ', 12])).toBe(true);
    expect(isTotalRow(['Totals'])).toBe(true);
    expect(isTotalRow(['Subtotal', '$450.00'])).toBe(false);
    expect(isTotalRow([48620, 'Total'])).toBe(false);
    expect(isTotalRow([])).toBe(false);
  });

  it('keeps a closing total row in a table preview', () => {
    const rows = [['Labor'], ['Parts'], ['Trip fee'], ['Discount'], ['Tax'], ['Total']];
    expect(previewRows(rows, 4)).toEqual([['Labor'], ['Parts'], ['Trip fee'], ['Total']]);
    expect(previewRows(rows.slice(0, 5), 4)).toEqual(rows.slice(0, 4));
    expect(previewRows(rows.slice(0, 3), 4)).toEqual(rows.slice(0, 3));
  });

  it('lists labels the way a sentence does', () => {
    expect(listInSentence(['Invoices', 'Overdue balances', 'Scheduling'])).toBe(
      'invoices, overdue balances or scheduling',
    );
    expect(listInSentence(['Invoices', 'VAT returns'], 'and')).toBe('invoices and VAT returns');
    expect(listInSentence(['Invoices'])).toBe('invoices');
    expect(listInSentence([])).toBe('');
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
    expect(
      suggestionsFor(manifest, [
        {
          id: 'invoice',
          label: 'Invoices',
          description: 'Price a finished job and add its invoice',
        },
        { id: 'refunds', label: 'Refunds', description: 'Refund a charge' },
      ]),
    ).toEqual([
      'Price a finished job and add its invoice',
      'Who owes us money?',
      'Book the next free slot',
    ]);
  });
});
